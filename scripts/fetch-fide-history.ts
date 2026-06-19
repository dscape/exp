import fs from 'node:fs/promises';
import { players } from '../src/lib/seed-data';
import type { RatingType } from '../src/lib/types';

type FideChartRow = {
  date_2?: string | null;
  rating?: string | null;
  period_games?: string | null;
  rapid_rtng?: string | null;
  rapid_games?: string | null;
  blitz_rtng?: string | null;
  blitz_games?: string | null;
};

type FideHistorySeedRow = {
  fideId: string;
  listMonth: string;
  ratingType: RatingType;
  rating: number;
  games?: number;
};

const OUTPUT = process.argv[2] ?? 'src/lib/fide-history-seed.json';
const FIDE_CHART_URL = 'https://ratings.fide.com/a_chart_data.phtml';
const RATING_TYPES: RatingType[] = ['standard', 'rapid', 'blitz'];
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

async function main() {
  const fideIds = [...new Set(players.map((player) => player.fideId).filter(Boolean) as string[])];
  const snapshots: FideHistorySeedRow[] = [];

  for (const [index, fideId] of fideIds.entries()) {
    const rows = await fetchFideChartRows(fideId);
    const playerSnapshots = chartRowsToSnapshots(fideId, rows);
    snapshots.push(...playerSnapshots);
    console.log(`${index + 1}/${fideIds.length} FIDE ${fideId}: ${playerSnapshots.length} snapshots`);
    await sleep(250);
  }

  const deduped = dedupeSnapshots(snapshots).sort(compareSnapshots);
  await fs.writeFile(OUTPUT, `${JSON.stringify(deduped)}\n`);
  console.log(`Wrote ${deduped.length} FIDE rating snapshots to ${OUTPUT}`);
}

async function fetchFideChartRows(fideId: string) {
  const url = `${FIDE_CHART_URL}?event=${encodeURIComponent(fideId)}&period=all`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'user-agent': 'EscolaXadrezPorto/1.0 fide-history-seed',
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  if (!response.ok) throw new Error(`FIDE ${fideId} chart fetch failed: ${response.status}`);
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error(`FIDE ${fideId} chart response is not an array`);
  return payload as FideChartRow[];
}

function chartRowsToSnapshots(fideId: string, rows: FideChartRow[]) {
  const snapshots: FideHistorySeedRow[] = [];
  for (const row of rows) {
    const listMonth = parseFideMonth(row.date_2);
    if (!listMonth) continue;
    pushSnapshot(snapshots, fideId, listMonth, 'standard', row.rating, row.period_games);
    pushSnapshot(snapshots, fideId, listMonth, 'rapid', row.rapid_rtng, row.rapid_games);
    pushSnapshot(snapshots, fideId, listMonth, 'blitz', row.blitz_rtng, row.blitz_games);
  }
  return snapshots;
}

function pushSnapshot(
  snapshots: FideHistorySeedRow[],
  fideId: string,
  listMonth: string,
  ratingType: RatingType,
  rawRating: string | null | undefined,
  rawGames: string | null | undefined,
) {
  const rating = parseInteger(rawRating);
  if (!rating || rating <= 0) return;
  const games = parseInteger(rawGames);
  snapshots.push({ fideId, listMonth, ratingType, rating, ...(games !== undefined ? { games } : {}) });
}

function parseFideMonth(value: string | null | undefined) {
  const match = String(value ?? '').trim().match(/^(\d{4})[-\s]([A-Za-z]{3})$/);
  if (!match) return undefined;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return undefined;
  return `${match[1]}-${String(month).padStart(2, '0')}-01`;
}

function parseInteger(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function dedupeSnapshots(snapshots: FideHistorySeedRow[]) {
  return [...new Map(snapshots.map((snapshot) => [snapshotKey(snapshot), snapshot])).values()];
}

function snapshotKey(snapshot: FideHistorySeedRow) {
  return `${snapshot.fideId}:${snapshot.listMonth}:${snapshot.ratingType}`;
}

function compareSnapshots(a: FideHistorySeedRow, b: FideHistorySeedRow) {
  return (
    a.fideId.localeCompare(b.fideId) ||
    a.listMonth.localeCompare(b.listMonth) ||
    RATING_TYPES.indexOf(a.ratingType) - RATING_TYPES.indexOf(b.ratingType)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
