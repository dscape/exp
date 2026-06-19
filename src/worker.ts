import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { ChessResultsImportError, fetchChessResultsEventImport, chessResultsUrlWithParams, CHESS_RESULTS_USER_AGENT } from './lib/chess-results';
import { fetchChessResultsPgnDatabase } from './lib/chess-results-pgn';
import { parsePairingRows, parseStandingRows } from './lib/chess-results-live';
import { getPool, query } from './lib/db';
import { combinedRating, previousCalendarMonth } from './lib/fide-rankings';
import { createDatabaseBackup } from './lib/db-backup';
import { applyChessResultsImportToEvent } from './lib/event-imports';
import { recoverIndividualStanding } from './lib/chess-results-standings';
import { individualMedalCandidates, medalTypeForPlace, podiumMedalName, type MedalCandidate } from './lib/medals';
import type { ParsedPgnGame } from './lib/pgn';
import { findTournamentPlayer, type TournamentEntry } from './lib/tournament-matching';

type Job = { id: string; type: string; payload: Record<string, unknown>; attempts: number };

const workerId = `worker-${process.pid}-${Date.now()}`;
const CHESS_RESULTS_MIN_INTERVAL_MS = Number(process.env.CHESS_RESULTS_MIN_INTERVAL_MS ?? 2500);
let lastChessResultsFetchAt = 0;
const FIDE_URLS = {
  standard: 'https://ratings.fide.com/download/standard_rating_list_xml.zip',
  rapid: 'https://ratings.fide.com/download/rapid_rating_list_xml.zip',
  blitz: 'https://ratings.fide.com/download/blitz_rating_list_xml.zip',
} as const;

async function main() {
  if (!getPool()) throw new Error('DATABASE_URL is required for worker. Use `npm run dev` for local DB + migrations + worker, or export DATABASE_URL before `npm run worker`.');
  await scheduleRecurringJobs();
  console.log(`Escola worker started: ${workerId}`);
  while (true) {
    const job = await claimJob();
    if (!job) {
      await sleep(5000);
      await scheduleRecurringJobs();
      continue;
    }
    await runJob(job);
  }
}

async function scheduleRecurringJobs() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (process.env.FIDE_SYNC_ENABLED !== 'false' && now.getDate() <= 7) {
    await enqueueOnce(`fide.importMonthly:${today}`, 'fide.importMonthly', { listMonth: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10) });
  }
  if (process.env.CHESS_RESULTS_SYNC_ENABLED !== 'false') {
    const pollMinutes = Number(process.env.CHESS_RESULTS_ROUND_POLL_MINUTES ?? 60);
    const events = await query<{ id: string; chess_results_url: string }>("select id::text, chess_results_url from events where chess_results_url ~* 'tnr[0-9]+\\.aspx' and status = 'ongoing'");
    for (const event of events.rows) {
      await enqueueOnce(`chess:${event.id}:${Math.floor(Date.now() / (pollMinutes * 60_000))}`, 'chessResults.syncEvent', { eventId: event.id, url: event.chess_results_url });
    }

    const completedWithoutAutoMedals = await query<{ id: string; chess_results_url: string }>(
      `select e.id::text, e.chess_results_url
       from events e
       where e.chess_results_url ~* 'tnr[0-9]+\\.aspx'
         and e.status = 'completed'
         and not exists (select 1 from medals m where m.event_id=e.id and m.source='auto')
       order by e.ends_on desc nulls last, e.updated_at desc
       limit 20`,
    );
    for (const event of completedWithoutAutoMedals.rows) {
      await enqueueOnce(`chess:final-medals:v2:${event.id}`, 'chessResults.syncEvent', { eventId: event.id, url: event.chess_results_url, force: true, reason: 'final-medals' });
    }
  }
  await enqueueOnce(`events.lifecycle:${today}`, 'events.lifecycle', {});
  await enqueueOnce(`backup:${today}`, 'backups.nightly', {});
}

async function enqueueOnce(key: string, type: string, payload: Record<string, unknown>) {
  const exists = await query('select 1 from worker_jobs where payload->>\'_dedupe\'=$1 limit 1', [key]);
  if (exists.rowCount) return;
  await query('insert into worker_jobs (type, payload) values ($1,$2::jsonb)', [type, JSON.stringify({ ...payload, _dedupe: key })]);
}

async function claimJob(): Promise<Job | null> {
  const result = await query<Job>(
    `update worker_jobs set status='running', locked_at=now(), locked_by=$1, attempts=attempts+1, updated_at=now()
     where id = (
       select id from worker_jobs
       where status='queued' and run_after <= now()
       order by created_at
       for update skip locked
       limit 1
     )
     returning id::text, type, payload, attempts`,
    [workerId],
  );
  return result.rows[0] ?? null;
}

async function runJob(job: Job) {
  try {
    let result: unknown = {};
    if (job.type === 'fide.importMonthly') result = await importFideMonthly(String(job.payload.listMonth ?? new Date().toISOString().slice(0, 10)));
    else if (job.type === 'chessResults.importEvent') result = await fetchChessResultsEventImport(String(job.payload.url), rateLimitedChessResultsFetch);
    else if (job.type === 'chessResults.syncEvent') result = await syncChessResults(String(job.payload.eventId), String(job.payload.url), Boolean(job.payload.force));
    else if (job.type === 'events.lifecycle') result = await syncEventLifecycle();
    else if (job.type === 'medals.recompute') result = await recomputeMedals(String(job.payload.eventId ?? ''));
    else if (job.type === 'backups.nightly') result = await recordBackupHeartbeat();
    else throw new Error(`Unknown job type ${job.type}`);
    await query("update worker_jobs set status='succeeded', last_error=null, result=$2::jsonb, updated_at=now() where id=$1::uuid", [job.id, JSON.stringify(result ?? {})]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = isPermanentJobError(error);
    const delayMinutes = Math.min(180, 5 * 2 ** Math.max(0, job.attempts - 1));
    console.error(`Job ${job.type} failed`, error);
    await query(
      "update worker_jobs set status=case when $4 then 'failed'::job_status when attempts >= 5 then 'failed'::job_status else 'queued'::job_status end, last_error=$2, run_after=case when $4 then now() else now() + ($3::text || ' minutes')::interval end, updated_at=now() where id=$1::uuid",
      [job.id, message, String(delayMinutes), permanent],
    );
  }
}

function isPermanentJobError(error: unknown) {
  return error instanceof ChessResultsImportError && error.code === 'tournament_not_found';
}

async function importFideMonthly(listMonth: string) {
  const watched = await query<{ id: string; fide_id: string }>('select id::text, fide_id from players where fide_id is not null');
  const watchedIds = new Map(watched.rows.map((row) => [row.fide_id, row.id]));
  const matchedByType: Partial<Record<keyof typeof FIDE_URLS, number>> = {};
  for (const [ratingType, url] of Object.entries(FIDE_URLS) as Array<[keyof typeof FIDE_URLS, string]>) {
    const response = await fetch(url, { headers: { 'user-agent': 'EscolaXadrezPorto/1.0 best-effort fide importer' } });
    if (!response.ok) throw new Error(`FIDE ${ratingType} download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const importRow = await query<{ id: string }>(
      `insert into fide_imports (list_month, rating_type, source_url, source_file_hash, status, started_at)
       values ($1::date,$2::rating_type,$3,$4,'running',now())
       on conflict (list_month, rating_type, source_file_hash) do update set status='running', started_at=now()
       returning id::text`,
      [listMonth, ratingType, url, hash],
    );
    const zip = new AdmZip(buffer);
    const entry = zip.getEntries().find((e) => e.entryName.endsWith('.xml'));
    if (!entry) throw new Error(`No XML entry found in ${url}`);
    const xml = entry.getData().toString('utf8');
    const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
    const parsed = parser.parse(xml);
    const players = extractFidePlayers(parsed);
    let matched = 0;
    for (const item of players) {
      const fideId = String(item.fideid ?? item.fide_id ?? item.id ?? '');
      const playerId = watchedIds.get(fideId);
      if (!playerId) continue;
      const rating = Number(item.rating ?? item.rtng ?? item.standard_rating ?? item.rapid_rating ?? item.blitz_rating ?? 0) || null;
      const games = Number(item.games ?? item.g ?? 0) || null;
      const k = Number(item.k ?? item.k_factor ?? 0) || null;
      await query(
        `insert into fide_rating_snapshots (player_id, fide_id, list_month, rating_type, rating, games, k_factor, title, federation)
         values ($1::uuid,$2,$3::date,$4::rating_type,$5,$6,$7,$8,$9)
         on conflict (fide_id, list_month, rating_type) do update set rating=excluded.rating, games=excluded.games, k_factor=excluded.k_factor, title=excluded.title, federation=excluded.federation, imported_at=now()`,
        [playerId, fideId, listMonth, ratingType, rating, games, k, item.title ?? null, item.country ?? item.fed ?? null],
      );
      matched++;
    }
    matchedByType[ratingType] = matched;
    await query("update fide_imports set status='succeeded', finished_at=now(), message=$2 where id=$1::uuid", [importRow.rows[0].id, `Matched ${matched} club players`]);
  }
  return { listMonth, matchedByType, rankingChanges: await fideRankingChangeSummary(listMonth) };
}

async function fideRankingChangeSummary(listMonth: string) {
  const previousMonth = previousCalendarMonth(listMonth);
  if (!previousMonth) return { skipped: true, reason: 'invalid-list-month' };
  const rows = await query<{ player_id: string; name: string; list_month: string; rating_type: string; rating: number | null }>(
    `select p.id::text player_id, p.name, s.list_month::text, s.rating_type::text, s.rating
     from players p
     join fide_rating_snapshots s on s.player_id=p.id
     where s.list_month in ($1::date, $2::date)
     order by p.name, s.list_month, s.rating_type`,
    [listMonth, previousMonth],
  );
  const byPlayer = new Map<string, { name: string; current: Record<string, number>; previous: Record<string, number> }>();
  for (const row of rows.rows) {
    if (!row.rating) continue;
    const entry = byPlayer.get(row.player_id) ?? { name: row.name, current: {}, previous: {} };
    const bucket = row.list_month === listMonth ? entry.current : entry.previous;
    bucket[row.rating_type] = row.rating;
    byPlayer.set(row.player_id, entry);
  }
  const changes = [...byPlayer.entries()].map(([playerId, entry]) => {
    const current = combinedRating(entry.current.standard ?? 0, entry.current.rapid ?? 0, entry.current.blitz ?? 0);
    const previous = combinedRating(entry.previous.standard ?? 0, entry.previous.rapid ?? 0, entry.previous.blitz ?? 0);
    return {
      playerId,
      name: entry.name,
      current,
      previous,
      delta: current > 0 && previous > 0 ? current - previous : undefined,
    };
  }).filter((entry) => entry.current > 0);
  const currentRanks = rankChanges(changes, 'current');
  const previousRanks = rankChanges(changes, 'previous');
  const ranked = changes.map((entry) => ({
    ...entry,
    rank: currentRanks.get(entry.playerId),
    rankDelta: previousRanks.get(entry.playerId) && currentRanks.get(entry.playerId)
      ? previousRanks.get(entry.playerId)! - currentRanks.get(entry.playerId)!
      : undefined,
  }));
  return {
    previousMonth,
    players: ranked.length,
    bestRatingGains: ranked.filter((entry) => entry.delta !== undefined).sort((a, b) => b.delta! - a.delta!).slice(0, 5),
    biggestRankGains: ranked.filter((entry) => entry.rankDelta !== undefined).sort((a, b) => b.rankDelta! - a.rankDelta!).slice(0, 5),
  };
}

function rankChanges<T extends { playerId: string; current: number; previous: number }>(rows: T[], key: 'current' | 'previous') {
  return new Map(
    rows
      .filter((row) => row[key] > 0)
      .slice()
      .sort((a, b) => b[key] - a[key])
      .map((row, index) => [row.playerId, index + 1]),
  );
}

function extractFidePlayers(parsed: unknown): Array<Record<string, unknown>> {
  const queue: unknown[] = [parsed];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      if (node.some((item) => item && typeof item === 'object' && ('fideid' in item || 'fide_id' in item))) return node as Array<Record<string, unknown>>;
      queue.push(...node);
      continue;
    }
    queue.push(...Object.values(node));
  }
  return [];
}

async function syncChessResults(eventId: string, url: string, force = false) {
  if (!url || url === 'undefined') return { skipped: true, reason: 'missing-url' };
  const event = await query<{ status: string; ends_on: string | null }>('select status::text, ends_on::text from events where id=$1::uuid limit 1', [eventId]);
  if (!force && (event.rows[0]?.status === 'completed' || (event.rows[0]?.ends_on && event.rows[0].ends_on < new Date().toISOString().slice(0, 10)))) return { skipped: true, reason: 'completed-immutable' };

  const run = await query<{ id: string }>('insert into event_sync_runs (event_id, source_url, status, started_at) values ($1::uuid,$2,\'running\',now()) returning id::text', [eventId, url]);
  try {
    const imported = await fetchChessResultsEventImport(url, rateLimitedChessResultsFetch);
    const registrationSync = await applyChessResultsImportToEvent(eventId, imported, { replaceDeadlines: false });

    const standingsUrl = chessResultsUrlWithParams(url, { art: imported.format === 'team' ? '0' : '1', lan: '10' });
    const pairingsUrl = chessResultsUrlWithParams(url, { art: '2', lan: '10' });
    const standingsHtml = await fetchText(standingsUrl);
    const pairingsHtml = await fetchText(pairingsUrl);
    await storeSnapshot(eventId, standingsUrl, standingsHtml);
    await storeSnapshot(eventId, pairingsUrl, pairingsHtml);
    const standings = parseStandingRows(standingsHtml).slice(0, 80);
    const pairings = parsePairingRows(pairingsHtml).slice(0, 80);
    await query('delete from event_standings where event_id=$1::uuid and round_number=0', [eventId]);
    await query('delete from event_pairings where event_id=$1::uuid and round_number=0', [eventId]);
    let standingsCount = 0;
    for (const row of standings) {
      await query(
        `insert into event_standings (event_id, round_number, position, player_name, club, fide_id, points, tie_breaks, raw)
         values ($1::uuid,0,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         on conflict (event_id, round_number, position, player_name) do update set club=excluded.club, fide_id=excluded.fide_id, points=excluded.points, tie_breaks=excluded.tie_breaks, raw=excluded.raw, updated_at=now()`,
        [eventId, row.position, row.name, row.club ?? null, row.fideId ?? null, row.points, JSON.stringify(row.tieBreaks ?? []), JSON.stringify(row.raw)],
      );
      standingsCount++;
    }
    let pairingCount = 0;
    for (const row of pairings) {
      await query(
        `insert into event_pairings (event_id, round_number, board, white_name, black_name, result, raw)
         values ($1::uuid,0,$2,$3,$4,$5,$6::jsonb)
         on conflict (event_id, round_number, board) do update set white_name=excluded.white_name, black_name=excluded.black_name, result=excluded.result, raw=excluded.raw, updated_at=now()`,
        [eventId, row.board, row.white, row.black, row.result ?? null, JSON.stringify(row.raw)],
      );
      pairingCount++;
    }
    const medalStats = shouldRecomputeMedals(event.rows[0], imported.status) ? await recomputeMedals(eventId) : { skipped: true, reason: 'event-not-completed' };
    const pgnStats = await importChessResultsGames(eventId, url, imported.initialRanking);
    const stats = { standingsCount, pairingCount, initialRankingCount: imported.initialRanking.length, teamMemberCount: imported.teamMembers?.length ?? 0, confirmedRegistrationCount: registrationSync.confirmedRegistrations, medals: medalStats, pgn: pgnStats };
    await query("update event_sync_runs set status='succeeded', finished_at=now(), message=$2, stats=$3::jsonb where id=$1::uuid", [run.rows[0].id, `Imported ${standingsCount} standings, ${pairingCount} pairings, ${imported.initialRanking.length} initial ranking rows, ${imported.teamMembers?.length ?? 0} team members, confirmed ${registrationSync.confirmedRegistrations} registrations, recomputed medals and imported ${pgnStats.imported ?? 0} PGN games`, JSON.stringify(stats)]);
    return stats;
  } catch (error) {
    await query("update event_sync_runs set status='failed', finished_at=now(), message=$2 where id=$1::uuid", [run.rows[0].id, error instanceof Error ? error.message : String(error)]);
    throw error;
  }
}

async function importChessResultsGames(
  eventId: string,
  url: string,
  initialRanking: TournamentEntry[] = [],
) {
  try {
    const pgnImport = await fetchChessResultsPgnDatabase(url, rateLimitedChessResultsFetch);
    if (!pgnImport.games.length) return { imported: 0, matched: 0, total: 0, rounds: pgnImport.rounds, skipped: true, reason: 'no-pgn-games' };

    const playerRows = await query<{ id: string; external_key: string | null; name: string; fide_id: string | null }>(
      'select id::text, external_key, name, fide_id from players where active',
    );
    const players = playerRows.rows.map((player) => ({
      id: player.id,
      externalKey: player.external_key,
      name: player.name,
      fideId: player.fide_id,
    }));
    let matched = 0;
    let imported = 0;
    for (const game of pgnImport.games) {
      const whitePlayer = findTournamentPlayer(players, { name: game.white }, initialRanking);
      const blackPlayer = findTournamentPlayer(players, { name: game.black }, initialRanking);
      if (!whitePlayer && !blackPlayer) continue;
      matched++;
      imported += await insertPgnGame(eventId, game, whitePlayer?.id, blackPlayer?.id, pgnImport.sourceUrl);
    }

    return { imported, matched, total: pgnImport.games.length, rounds: pgnImport.rounds };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Chess-Results PGN import failed', message);
    return { imported: 0, matched: 0, total: 0, skipped: true, reason: message };
  }
}

async function insertPgnGame(
  eventId: string,
  game: ParsedPgnGame,
  whitePlayerId: string | undefined,
  blackPlayerId: string | undefined,
  sourceUrl: string,
) {
  const result = await query<{ id: string }>(
    `insert into games (event_id, white_player_id, black_player_id, white_name, black_name, result, eco, pgn, headers, played_on)
     select $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10::date
     where not exists (select 1 from games where md5(pgn)=md5($8))
     returning id::text`,
    [
      eventId,
      whitePlayerId ?? null,
      blackPlayerId ?? null,
      game.white,
      game.black,
      game.result,
      game.eco || null,
      game.pgn,
      JSON.stringify({ ...game.headers, source: 'chess-results', sourceUrl }),
      game.playedOn ?? null,
    ],
  );
  const gameId = result.rows[0]?.id;
  if (!gameId) return 0;
  for (const [index, move] of game.moves.entries()) {
    await query('insert into game_moves (game_id, ply, san) values ($1::uuid,$2,$3) on conflict do nothing', [gameId, index + 1, move]);
  }
  return 1;
}

async function fetchText(url: string) {
  const response = await rateLimitedChessResultsFetch(url, { headers: { 'user-agent': CHESS_RESULTS_USER_AGENT, accept: 'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

async function storeSnapshot(eventId: string, url: string, html: string) {
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  await query('insert into event_raw_snapshots (event_id, source_url, snapshot_hash, content) values ($1::uuid,$2,$3,$4) on conflict do nothing', [eventId, url, hash, html.slice(0, 1_000_000)]);
}

type MedalStanding = {
  position: number;
  seed?: number;
  playerName: string;
  club?: string;
  fideId?: string;
  points?: string;
  category?: string;
  sex?: string;
  playerId?: string;
  kind?: 'individual' | 'team';
  teamName?: string;
};

type MedalPlayer = {
  id: string;
  name: string;
  fide_id: string | null;
  sex: string | null;
  category_label: string | null;
};

type MedalStartListRow = {
  seed: number | null;
  player_name: string;
  club: string | null;
  fide_id: string | null;
  category: string | null;
  raw: unknown;
};

async function rateLimitedChessResultsFetch(url: string, init?: RequestInit) {
  const waitMs = CHESS_RESULTS_MIN_INTERVAL_MS - (Date.now() - lastChessResultsFetchAt);
  if (waitMs > 0) await sleep(waitMs);
  lastChessResultsFetchAt = Date.now();
  const headers = new Headers(init?.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', CHESS_RESULTS_USER_AGENT);
  return fetch(url, { ...init, headers });
}

async function syncEventLifecycle() {
  const completed = await query<{ id: string; chess_results_url: string | null }>(
    "update events set status='completed', updated_at=now() where ends_on is not null and ends_on < current_date and status in ('ongoing','registration_open','upcoming') returning id::text, chess_results_url",
  );
  const ongoing = await query(
    "update events set status='ongoing', updated_at=now() where starts_on is not null and ends_on is not null and current_date between starts_on and ends_on and status in ('registration_open','upcoming')",
  );

  for (const event of completed.rows) {
    if (event.chess_results_url && /tnr[0-9]+\.aspx/i.test(event.chess_results_url)) {
      await enqueueOnce(`chess:completed:v1:${event.id}`, 'chessResults.syncEvent', { eventId: event.id, url: event.chess_results_url, force: true, reason: 'completed-event' });
    } else {
      await enqueueOnce(`medals:completed:v1:${event.id}`, 'medals.recompute', { eventId: event.id });
    }
  }

  return { completed: completed.rowCount, ongoing: ongoing.rowCount };
}

async function recomputeMedals(eventId: string) {
  if (!eventId) return { skipped: true, reason: 'missing-event-id' };

  const [standingRows, teamMemberRows, startListRows, playerRows] = await Promise.all([
    query<{ position: number; player_name: string; club: string | null; fide_id: string | null; points: string | null; raw: unknown }>(
      `select position, player_name, club, fide_id, points::text, raw
       from event_standings
       where event_id=$1::uuid and round_number=0
       order by position`,
      [eventId],
    ),
    query<{ player_name: string; club: string | null; fide_id: string | null; seed: number | null; raw: unknown }>(
      `select player_name, club, fide_id, seed, raw
       from event_start_lists
       where event_id=$1::uuid and raw->>'kind'='team-member'
       order by club, seed nulls last, player_name`,
      [eventId],
    ),
    query<MedalStartListRow>(
      `select player_name, club, fide_id, seed, category, raw
       from event_start_lists
       where event_id=$1::uuid and coalesce(raw->>'kind', '') <> 'team-member'
       order by seed nulls last, player_name`,
      [eventId],
    ),
    query<MedalPlayer>('select id::text, name, fide_id, sex, category_label from players where active'),
  ]);

  if (!standingRows.rowCount) return { skipped: true, reason: 'no-standings' };

  const players = playerRows.rows;
  const standings: MedalStanding[] = standingRows.rows.map((row) => {
    const raw = parseStandingRaw(row.raw);
    const recovered = recoverIndividualStanding(row.raw);
    const seed = recovered?.seed ?? raw.seed;
    const playerName = recovered?.name ?? row.player_name;
    const startListRow = findMedalStartListRow(startListRows.rows, {
      seed,
      name: playerName,
      fideId: recovered?.fideId ?? row.fide_id ?? raw.fideId,
    });
    const club = firstClub(recovered?.club, raw.club, row.club, startListRow?.club);
    const fideId = recovered?.fideId ?? row.fide_id ?? raw.fideId ?? startListRow?.fide_id ?? undefined;
    const matchedPlayer = matchMedalPlayer(playerName, fideId, club, players);
    const category = categoryCode(recovered?.category) ?? categoryCode(raw.category) ?? categoryCode(startListRow?.category) ?? playerCategoryCode(matchedPlayer?.category_label);
    const sex = recovered?.sex ?? raw.sex ?? sexCode(recovered?.category) ?? sexCode(raw.category) ?? sexCode(startListRow?.category) ?? playerSexCode(matchedPlayer?.sex);
    return {
      position: row.position,
      seed,
      playerName,
      club,
      fideId,
      points: recovered?.points ?? row.points ?? undefined,
      category,
      sex,
      playerId: matchedPlayer?.id,
      kind: raw.kind === 'team' ? 'team' : 'individual',
      teamName: raw.teamName,
    };
  });

  const teamStandings = standings.filter((standing) => standing.kind === 'team');
  const candidates = teamStandings.length
    ? dedupeMedalCandidates(teamMedalCandidates(teamStandings, teamMemberRows.rows, players))
    : individualMedalCandidates(standings);

  await query("delete from medals where event_id=$1::uuid and source='auto'", [eventId]);
  for (const candidate of candidates) {
    await query(
      `insert into medals (event_id, player_id, medal_type, source, place, label)
       values ($1::uuid,$2::uuid,$3::medal_type,'auto',$4,$5)
       on conflict do nothing`,
      [eventId, candidate.playerId, candidate.type, candidate.place ?? null, candidate.label ?? null],
    );
  }

  return {
    inserted: candidates.length,
    overall: candidates.filter((candidate) => candidate.competition === 'overall').length,
    team: candidates.filter((candidate) => candidate.competition === 'team').length,
    category: candidates.filter((candidate) => candidate.competition === 'category').length,
    female: candidates.filter((candidate) => candidate.competition === 'female').length,
  };
}

function shouldRecomputeMedals(event: { status?: string | null; ends_on?: string | null } | undefined, importedStatus?: string) {
  const today = new Date().toISOString().slice(0, 10);
  return importedStatus === 'completed' || event?.status === 'completed' || Boolean(event?.ends_on && event.ends_on < today);
}

function teamMedalCandidates(
  standings: MedalStanding[],
  teamMembers: Array<{ player_name: string; club: string | null; fide_id: string | null; seed: number | null; raw: unknown }>,
  players: MedalPlayer[],
): MedalCandidate[] {
  const podium = standings.filter((standing) => standing.position <= 3 && standing.teamName);
  const candidates: MedalCandidate[] = [];
  for (const team of podium) {
    const medalType = medalTypeForPlace(team.position);
    if (!medalType) continue;
    const teamName = team.teamName ?? team.playerName;
    for (const member of teamMembers.filter((row) => sameTeamName(row.club, teamName))) {
      const matchedPlayer = matchMedalPlayer(member.player_name, member.fide_id, member.club ?? undefined, players);
      if (!matchedPlayer) continue;
      candidates.push({
        playerId: matchedPlayer.id,
        type: medalType,
        competition: 'team',
        place: team.position,
        label: `${podiumMedalName(medalType)} por equipas · ${teamName}`,
      });
    }
  }
  return candidates;
}

function dedupeMedalCandidates(candidates: MedalCandidate[]) {
  const seen = new Set<string>();
  const deduped: MedalCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.playerId}:${candidate.type}:${candidate.label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function parseStandingRaw(raw: unknown) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const standing = record.standing && typeof record.standing === 'object' && !Array.isArray(record.standing)
      ? (record.standing as Record<string, unknown>)
      : {};
    return {
      kind: stringValue(record.kind),
      teamName: stringValue(record.teamName) ?? stringValue(standing.name),
      seed: numberValue(record.seed),
      category: stringValue(record.category),
      sex: stringValue(record.sex),
      club: stringValue(record.club),
      fideId: stringValue(record.fideId),
    };
  }

  if (Array.isArray(raw)) {
    const cells = raw.map((cell) => String(cell ?? '').trim()).filter(Boolean);
    const category = cells.find((cell) => isCategoryCode(cell));
    const sex = cells.find((cell) => isFemaleStanding(cell));
    const club = cells.find((cell) => isEfanorClub(cell)) ?? cells.find((cell) => /clube|club|fc|xadrez|gama|leça|leca|paredes/i.test(cell));
    return { category, sex, club, fideId: cells.find((cell) => /^\d{5,12}$/.test(cell)) };
  }

  return {} as { kind?: string; teamName?: string; seed?: number; category?: string; sex?: string; club?: string; fideId?: string };
}

function matchMedalPlayer(name: string, fideId: string | undefined | null, club: string | undefined, players: MedalPlayer[]) {
  const normalizedFideId = normalizeFideId(fideId);
  if (normalizedFideId) {
    const byFideId = players.find((player) => normalizeFideId(player.fide_id) === normalizedFideId);
    if (byFideId) return byFideId;
  }

  const normalizedName = normalizePersonName(name);
  const exact = players.filter((player) => normalizePersonName(player.name) === normalizedName);
  if (exact.length === 1) return exact[0];

  if (!isEfanorClub(club)) return undefined;
  const importedTokens = nameTokens(normalizedName);
  const fuzzy = players.filter((player) => {
    const playerTokens = [...nameTokens(normalizePersonName(player.name))];
    return playerTokens.length >= 2 && playerTokens.every((token) => importedTokens.has(token));
  });
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

function findMedalStartListRow(
  startList: MedalStartListRow[],
  standing: { seed?: number; name: string; fideId?: string | null },
) {
  const fideId = normalizeFideId(standing.fideId);
  if (fideId) {
    const byFideId = startList.find((row) => normalizeFideId(row.fide_id) === fideId);
    if (byFideId) return byFideId;
  }

  if (standing.seed) {
    const bySeed = startList.find((row) => row.seed === standing.seed);
    if (bySeed) return bySeed;
  }

  const normalizedName = normalizePersonName(standing.name);
  const byName = startList.filter((row) => normalizePersonName(row.player_name) === normalizedName);
  return byName.length === 1 ? byName[0] : undefined;
}

function firstClub(...values: Array<string | null | undefined>) {
  return values.find((value): value is string => {
    if (!value) return false;
    return !/^\d+$/.test(value);
  });
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeFideId(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\D/g, '') || trimmed.toLowerCase();
}

function normalizePersonName(name: string) {
  const reordered = name.includes(',')
    ? `${name.split(',').slice(1).join(' ')} ${name.split(',')[0]}`
    : name;
  return reordered
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function nameTokens(normalizedName: string) {
  const ignored = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e']);
  return new Set(normalizedName.split(/\s+/).filter((token) => token.length > 1 && !ignored.has(token)));
}

function categoryCode(value?: string | null) {
  return value?.split(/\s+/).find((part) => isCategoryCode(part));
}

function sexCode(value?: string | null) {
  return value?.split(/\s+/).find((part) => isFemaleStanding(part));
}

function isCategoryCode(value: string) {
  return /^(U\d{1,2}|S\d{2}|SEN|SENIOR|VET|VETERANO)/i.test(value.trim());
}

function playerCategoryCode(categoryLabel?: string | null) {
  if (!categoryLabel) return undefined;
  const sub = categoryLabel.match(/Sub-(\d+)/i)?.[1];
  if (sub) return `U${sub.padStart(2, '0')}`;
  const veteran = categoryLabel.match(/S(\d+)/i)?.[1];
  if (veteran) return `S${veteran}`;
  if (/s[eé]nior/i.test(categoryLabel)) return 'SEN';
  return undefined;
}

function playerSexCode(sex?: string | null) {
  return sex === 'F' ? 'w' : undefined;
}

function isFemaleStanding(sex?: string) {
  return /^(w|f|female|feminino)$/i.test(sex ?? '');
}

function isEfanorClub(club?: string) {
  return /efanor|xadrez\s+col[eé]gio\s+efanor|col[eé]gio\s+efanor/i.test(club ?? '');
}

function sameTeamName(a?: string | null, b?: string | null) {
  return normalizeTeamName(a ?? '') === normalizeTeamName(b ?? '');
}

function normalizeTeamName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function recordBackupHeartbeat() {
  const backup = await createDatabaseBackup();
  const payload = {
    at: new Date().toISOString(),
    fileName: backup.fileName,
    bytes: backup.bytes,
    format: backup.format,
    path: backup.filePath,
  };
  await query('insert into audit_log (action, entity_type, after) values ($1,$2,$3::jsonb)', ['database_backup', 'system', JSON.stringify(payload)]);
  return payload;
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
