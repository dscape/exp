import { query } from '../src/lib/db';

process.env.DATABASE_URL ??= 'postgres://escola:escola@localhost:5432/escola';

async function main() {
  await query("delete from worker_jobs where type like 'chessResults.%' or type = 'medals.recompute'");
  const result = await query('delete from events');
  console.log(`Deleted ${result.rowCount ?? 0} events and cascading event data.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
