import fs from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Pool } from 'pg';

const DEFAULT_DATABASE_URL = 'postgres://escola:escola@localhost:5432/escola';
const DEV_COMPOSE_FILES = ['-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function main() {
  const args = new Set(process.argv.slice(2));
  const shellDatabaseUrl = process.env.DATABASE_URL;
  loadEnvFiles(['.env.local', '.env']);

  if (!shellDatabaseUrl && process.env.DATABASE_URL && databaseHost(process.env.DATABASE_URL) === 'postgres') {
    console.warn('DATABASE_URL points at Docker service host "postgres"; using localhost for local npm dev.');
    process.env.DATABASE_URL = localizeDatabaseUrl(process.env.DATABASE_URL);
  }
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
  process.env.POSTGRES_USER ??= 'escola';
  process.env.POSTGRES_PASSWORD ??= 'escola';
  process.env.POSTGRES_DB ??= 'escola';
  process.env.APP_DOMAIN ??= 'localhost';
  process.env.APP_BASE_URL ??= 'http://localhost:3000';
  process.env.UPLOAD_DIR ??= './uploads';
  process.env.BACKUP_DIR ??= './uploads/backups';
  process.env.CHESS_RESULTS_SYNC_ENABLED ??= 'true';
  process.env.FIDE_SYNC_ENABLED ??= 'true';

  const shouldStartLocalPostgres = !shellDatabaseUrl && isLocalDatabaseUrl(process.env.DATABASE_URL) && process.env.DEV_POSTGRES !== 'false';
  if (shouldStartLocalPostgres) startLocalPostgres();

  await waitForDatabase(process.env.DATABASE_URL);
  runChecked(npm, ['run', 'db:migrate']);
  if (process.env.DEV_SEED !== 'false' && (await databaseLooksEmpty(process.env.DATABASE_URL))) {
    runChecked(npm, ['run', 'db:seed']);
  }

  if (args.has('--prepare-only')) return;

  console.log('\nDev environment ready. Starting Next.js and worker...\n');
  await runProcesses([
    [npm, ['run', 'dev:web']],
    [npm, ['run', 'worker']],
  ]);
}

function loadEnvFiles(files: string[]) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = unquoteEnvValue(match[2]);
    }
  }
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function startLocalPostgres() {
  if (!dockerComposeAvailable()) {
    console.warn('Docker Compose not found. Assuming PostgreSQL is already running.');
    return;
  }
  console.log('Starting local PostgreSQL container...');
  runChecked('docker', ['compose', ...DEV_COMPOSE_FILES, 'up', '-d', 'postgres']);
}

function dockerComposeAvailable() {
  return spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
}

function isLocalDatabaseUrl(value: string) {
  const host = databaseHost(value);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function databaseHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function localizeDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    url.hostname = 'localhost';
    return url.toString();
  } catch {
    return DEFAULT_DATABASE_URL;
  }
}

async function waitForDatabase(connectionString: string) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < 60_000) {
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1500 });
    try {
      await pool.query('select 1');
      await pool.end();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await pool.end().catch(() => undefined);
      await sleep(1000);
    }
  }
  throw new Error(`PostgreSQL is not reachable at ${redactDatabaseUrl(connectionString)}. Last error: ${lastError}`);
}

async function databaseLooksEmpty(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query<{ users: string; events: string }>('select (select count(*) from users)::text as users, (select count(*) from events)::text as events');
    return Number(result.rows[0]?.users ?? 0) === 0 && Number(result.rows[0]?.events ?? 0) === 0;
  } finally {
    await pool.end();
  }
}

function runChecked(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runProcesses(commands: Array<[string, string[]]>) {
  return new Promise<void>((resolve) => {
    const children: ChildProcess[] = [];
    let shuttingDown = false;

    const shutdown = (code = 0) => {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const child of children) child.kill('SIGTERM');
      windowlessExit(code);
      resolve();
    };

    for (const [command, args] of commands) {
      const child = spawn(command, args, { stdio: 'inherit', env: process.env });
      children.push(child);
      child.on('exit', (code, signal) => {
        if (shuttingDown) return;
        console.log(`\n${command} ${args.join(' ')} exited (${signal ?? code}). Stopping dev stack...`);
        shutdown(code ?? 1);
      });
    }

    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));
  });
}

function windowlessExit(code: number) {
  setTimeout(() => process.exit(code), 250);
}

function redactDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return value;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
