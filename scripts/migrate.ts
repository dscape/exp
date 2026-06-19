import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, query } from '../src/lib/db';

async function main() {
  await query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(process.cwd(), 'migrations');
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const already = await query('select 1 from schema_migrations where name=$1', [file]);
    if (already.rowCount) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    console.log(`Applying ${file}`);
    const pool = getPool();
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
