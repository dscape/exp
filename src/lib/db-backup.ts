import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { query } from './db';

export type DatabaseBackup = {
  filePath: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  format: 'sql' | 'json';
};

export async function createDatabaseBackup(): Promise<DatabaseBackup> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = backupDir();
  await mkdir(dir, { recursive: true });

  const sql = await tryPgDump(dir, stamp);
  if (sql) return sql;

  const fileName = `escola-db-${stamp}.json`;
  const filePath = path.join(dir, fileName);
  await writeJsonBackup(filePath);
  await copyFile(filePath, path.join(dir, 'latest.json'));
  return { filePath, fileName, mimeType: 'application/json; charset=utf-8', bytes: (await stat(filePath)).size, format: 'json' };
}

export async function latestDatabaseBackup() {
  const dir = backupDir();
  try {
    const latestSql = path.join(dir, 'latest.sql');
    const content = await readFile(latestSql);
    return { filePath: latestSql, fileName: 'escola-db-latest.sql', mimeType: 'application/sql; charset=utf-8', content };
  } catch {
    // Fall through.
  }
  try {
    const latestJson = path.join(dir, 'latest.json');
    const content = await readFile(latestJson);
    return { filePath: latestJson, fileName: 'escola-db-latest.json', mimeType: 'application/json; charset=utf-8', content };
  } catch {
    const backup = await createDatabaseBackup();
    return { ...backup, content: await readFile(backup.filePath) };
  }
}

function backupDir() {
  const root = process.env.BACKUP_DIR ?? path.join(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'), 'backups');
  return root;
}

async function tryPgDump(dir: string, stamp: string): Promise<DatabaseBackup | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  const fileName = `escola-db-${stamp}.sql`;
  const filePath = path.join(dir, fileName);
  try {
    await runPgDumpToFile(databaseUrl, filePath);
    await copyFile(filePath, path.join(dir, 'latest.sql'));
    return { filePath, fileName, mimeType: 'application/sql; charset=utf-8', bytes: (await stat(filePath)).size, format: 'sql' };
  } catch (error) {
    console.warn('pg_dump backup failed; falling back to JSON backup', error instanceof Error ? error.message : error);
    return null;
  }
}

async function runPgDumpToFile(databaseUrl: string, filePath: string) {
  const child = spawn('pg_dump', ['--no-owner', '--no-acl', databaseUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

  const output = createWriteStream(filePath);
  const stream = pipeline(child.stdout, output);
  const [code] = await Promise.all([
    once(child, 'close').then(([exitCode]) => exitCode as number | null),
    stream,
  ]);
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString('utf8') || `pg_dump exited with ${code}`);
}

async function writeJsonBackup(filePath: string) {
  const output = createWriteStream(filePath);
  try {
    await writeChunk(output, `{"generatedAt":${JSON.stringify(new Date().toISOString())},"format":"escola-xadrez-porto-json-backup-v1","tables":{`);
    const tables = await query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'
       order by table_name`,
    );

    for (const [tableIndex, table] of tables.rows.entries()) {
      const name = table.table_name;
      if (tableIndex) await writeChunk(output, ',');
      await writeChunk(output, `${JSON.stringify(name)}:[`);
      const rows = await query(`select * from ${quoteIdentifier(name)}`);
      for (const [rowIndex, row] of rows.rows.entries()) {
        if (rowIndex) await writeChunk(output, ',');
        await writeChunk(output, JSON.stringify(row));
      }
      await writeChunk(output, ']');
    }

    await writeChunk(output, '}}\n');
  } finally {
    output.end();
    await once(output, 'finish');
  }
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: string) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
