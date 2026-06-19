import { Pool, type QueryResult, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  const db = getPool();
  if (!db) throw new Error('DATABASE_URL is not configured');
  return db.query<T>(text, params);
}

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = getPool();
  if (!db) throw new Error('DATABASE_URL is not configured');
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function isDatabaseReady() {
  try {
    const db = getPool();
    if (!db) return false;
    await db.query('select 1');
    return true;
  } catch {
    return false;
  }
}
