import { seedAccountCredentials, seedData } from './seed-data';
import type { Account, AppData, EventRecord, EventRegistrationRecord, EventTeamMember, EventTeamStanding, GameRecord, Medal, MuralPost, Player, PlayerRatingHistoryPoint, RatingType, WorkerRun } from './types';
import { getPool, isDatabaseReady, query } from './db';
import { DEFAULT_EVENT_DISTANCE_KM, estimateEventDistanceKm } from './event-distance';
import { combinedRating } from './fide-rankings';
import { hashPassword } from './passwords';
import { recoverIndividualStanding } from './chess-results-standings';
import { findTournamentPlayer, isClubTournamentName, isEfanorClub } from './tournament-matching';

export const publicAppData: AppData = {
  accounts: [],
  players: [],
  posts: [],
  events: [],
  medals: [],
  games: [],
  workerRuns: [],
};

function dbRole(role: Account['role']) {
  return role === 'moderator' ? 'moderator' : role;
}

function uiRole(role: string): Account['role'] {
  return role === 'moderator' ? 'moderator' : role === 'admin' ? 'admin' : 'student';
}

function dbEventType(type: EventRecord['type']) {
  return type;
}

function uiEventStatus(status: string): EventRecord['status'] {
  if (['draft', 'upcoming', 'registration_open', 'ongoing', 'completed', 'cancelled'].includes(status)) return status as EventRecord['status'];
  return 'upcoming';
}

function uiEventDistanceKm(distanceKm: number, location: string, name: string) {
  const storedDistance = Number(distanceKm) || 0;
  if (storedDistance !== DEFAULT_EVENT_DISTANCE_KM) return storedDistance;
  return estimateEventDistanceKm({ location, name }) ?? 0;
}

type FideSnapshotRow = {
  fide_id: string;
  list_month: string;
  rating_type: string;
  rating: number | null;
  games: number | null;
};

function fideSnapshotHistories(rows: FideSnapshotRow[]) {
  const histories = new Map<string, Map<string, PlayerRatingHistoryPoint>>();
  for (const row of rows) {
    if (!isRatingType(row.rating_type) || !row.rating) continue;
    const months = histories.get(row.fide_id) ?? new Map<string, PlayerRatingHistoryPoint>();
    const point = months.get(row.list_month) ?? { listMonth: row.list_month };
    point[row.rating_type] = row.rating;
    const gamesKey = `${row.rating_type}Games` as const;
    if (row.games !== null) point[gamesKey] = row.games;
    months.set(row.list_month, point);
    histories.set(row.fide_id, months);
  }

  return new Map(
    [...histories.entries()].map(([fideId, months]) => [
      fideId,
      [...months.values()].sort((a, b) => a.listMonth.localeCompare(b.listMonth)),
    ]),
  );
}

function latestRating(history: PlayerRatingHistoryPoint[], ratingType: RatingType) {
  for (let index = history.length - 1; index >= 0; index--) {
    const rating = history[index][ratingType];
    if (rating) return rating;
  }
  return undefined;
}

function isRatingType(value: string): value is RatingType {
  return value === 'standard' || value === 'rapid' || value === 'blitz';
}

function profileMissingFields(input: { fide_id?: string | null; date_of_birth?: string | null; phone?: string | null }) {
  const fields = [];
  if (!input.fide_id) fields.push('ID FIDE');
  if (!input.date_of_birth) fields.push('data de nascimento');
  if (!input.phone) fields.push('telefone');
  return fields;
}

export async function loadAppData(): Promise<AppData> {
  const pool = getPool();
  if (!pool) return seedData;
  if (!(await isDatabaseReady())) throw new Error('Database is not ready');

    const [users, accessRequests, playerRows, postRows, eventRows, medalRows, runRows] = await Promise.all([
      query('select id::text, name, email, role::text, status::text, profile_status::text, profile_missing_fields, fide_id, date_of_birth::text, phone from users order by created_at'),
      query(`select concat('access-request:', ar.id::text) id, ar.student_name as name, ar.guardian_email as email, 'student' as role, ar.status::text, ar.fide_id, ar.date_of_birth::text, ar.phone
             from access_requests ar
             where ar.status = 'pending'
               and not exists (select 1 from users u where lower(u.email) = lower(ar.guardian_email))
             order by ar.created_at`),
      query('select coalesce(external_key, id::text) id, name, fide_id, date_of_birth::text, category_label, sex, profile_status::text, profile_missing_fields, active from players order by name'),
      query("select p.id::text, p.tag, p.title, p.body_markdown, p.tint, p.board_x, p.board_y, p.rotation, p.z_index, coalesce(u.name, 'Secretaria') author, p.published_at::date::text date from mural_posts p left join users u on u.id = p.author_id order by p.published_at"),
      query('select coalesce(external_key, id::text) id, external_key, season, name, location, distance_km, month_label, date_label, starts_on::text, ends_on::text, type::text, status::text, chess_results_url, regulation_url, participants_label, provisional, recommended, source_metadata from events order by season, starts_on nulls last, created_at'),
      query('select m.id::text, coalesce(e.external_key, m.event_id::text) event_id, coalesce(p.external_key, m.player_id::text) player_id, m.medal_type::text, m.source::text, m.place, m.label from medals m join events e on e.id=m.event_id join players p on p.id=m.player_id order by m.awarded_at'),
      query("select id::text, type, status::text, coalesce(last_error, '') as message, to_char(updated_at, 'DD Mon HH24:MI') updated_at, result, payload, attempts from worker_jobs order by updated_at desc limit 20"),
    ]);

    const accounts: Account[] = [
      ...users.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: uiRole(row.role),
        status: row.status,
        profileStatus: row.profile_status,
        missingFields: Array.isArray(row.profile_missing_fields) ? row.profile_missing_fields : [],
        fideId: row.fide_id ?? undefined,
        dateOfBirth: row.date_of_birth ?? undefined,
        phone: row.phone ?? undefined,
      })),
      ...accessRequests.rows.map((row) => {
        const missingFields = profileMissingFields(row);
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          role: uiRole(row.role),
          status: row.status,
          profileStatus: missingFields.length ? 'incomplete' : 'complete',
          missingFields,
          fideId: row.fide_id ?? undefined,
          dateOfBirth: row.date_of_birth ?? undefined,
          phone: row.phone ?? undefined,
        };
      }),
    ];

    let players: Player[] = playerRows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      fideId: row.fide_id ?? undefined,
      dateOfBirth: row.date_of_birth ?? undefined,
      category: row.category_label ?? 'Outros',
      sex: row.sex ?? undefined,
      standard: 0,
      rapid: 0,
      blitz: 0,
      combined: 0,
      active: row.active,
      profileStatus: row.profile_status,
      missingFields: Array.isArray(row.profile_missing_fields) ? row.profile_missing_fields : [],
    }));

    const fideSnapshots = await query<FideSnapshotRow>('select fide_id, list_month::text, rating_type::text, rating, games from fide_rating_snapshots order by fide_id, list_month, rating_type');
    if (fideSnapshots.rowCount) {
      const histories = fideSnapshotHistories(fideSnapshots.rows);
      players = players.map((player) => {
        const ratingHistory = player.fideId ? histories.get(player.fideId) : undefined;
        if (!ratingHistory?.length) return player;
        const standard = latestRating(ratingHistory, 'standard') ?? player.standard;
        const rapid = latestRating(ratingHistory, 'rapid') ?? player.rapid;
        const blitz = latestRating(ratingHistory, 'blitz') ?? player.blitz;
        return { ...player, standard, rapid, blitz, combined: combinedRating(standard, rapid, blitz), ratingHistory };
      });
    }

    const posts: MuralPost[] = postRows.rows.map((row) => ({
      id: row.id,
      tag: row.tag,
      title: row.title,
      body: row.body_markdown,
      author: row.author,
      date: row.date,
      tint: row.tint,
      rotation: row.rotation,
      x: Number(row.board_x),
      y: Number(row.board_y),
      z: Number(row.z_index),
    }));

    const deadlines = await query('select coalesce(e.external_key, d.event_id::text) event_id, d.label, d.deadline_label, d.deadline_on::text from event_deadlines d join events e on e.id=d.event_id order by d.sort_order');
    const documents = await query('select coalesce(e.external_key, d.event_id::text) event_id, d.label, d.url from event_documents d join events e on e.id=d.event_id order by d.sort_order');
    const startLists = await query('select coalesce(e.external_key, s.event_id::text) event_id, s.seed, s.source_id, s.player_name, s.club, s.fide_id, s.federation, s.rating, s.title, s.category, s.raw from event_start_lists s join events e on e.id=s.event_id order by s.seed nulls last, s.player_name');
    const registrations = await query('select coalesce(e.external_key, r.event_id::text) event_id, coalesce(p.external_key, r.player_id::text) player_id, r.status::text, r.notes from event_registrations r join events e on e.id=r.event_id join players p on p.id=r.player_id where r.status <> \'withdrawn\' order by r.created_at');
    const deadlinesByEvent = new Map<string, EventRecord['deadlines']>();
    deadlines.rows.forEach((d) => deadlinesByEvent.set(d.event_id, [...(deadlinesByEvent.get(d.event_id) ?? []), { label: d.label, value: d.deadline_label, date: d.deadline_on ?? undefined }]));
    const documentsByEvent = new Map<string, NonNullable<EventRecord['documents']>>();
    documents.rows.forEach((d) => documentsByEvent.set(d.event_id, [...(documentsByEvent.get(d.event_id) ?? []), { label: d.label, url: d.url }]));
    const startListsByEvent = new Map<string, NonNullable<EventRecord['initialRanking']>>();
    const teamMembersByEvent = new Map<string, EventTeamMember[]>();
    startLists.rows.forEach((row) => {
      if (isTeamMemberRaw(row.raw)) {
        teamMembersByEvent.set(row.event_id, [
          ...(teamMembersByEvent.get(row.event_id) ?? []),
          teamMemberFromStartListRow(row),
        ]);
        return;
      }
      startListsByEvent.set(row.event_id, [...(startListsByEvent.get(row.event_id) ?? []), { number: row.seed ?? undefined, name: row.player_name, sourceId: row.source_id ?? undefined, fideId: row.fide_id ?? undefined, federation: row.federation ?? undefined, rating: row.rating ?? undefined, club: row.club ?? undefined, title: row.title ?? undefined, category: row.category ?? undefined, raw: row.raw }]);
    });
    const regsByEvent = new Map<string, string[]>();
    const regDetailsByEvent = new Map<string, EventRegistrationRecord[]>();
    registrations.rows.forEach((r) => {
      regsByEvent.set(r.event_id, [...(regsByEvent.get(r.event_id) ?? []), r.player_id]);
      regDetailsByEvent.set(r.event_id, [
        ...(regDetailsByEvent.get(r.event_id) ?? []),
        { playerId: r.player_id, status: r.status, notes: r.notes ?? undefined },
      ]);
    });

    const events: EventRecord[] = eventRows.rows.map((row) => {
      const format = eventFormatFromMetadata(row.source_metadata) ?? (teamMembersByEvent.has(row.id) ? 'team' : undefined);
      return {
        id: row.id,
        season: row.season,
        month: row.month_label,
        dateLabel: row.date_label,
        startsOn: row.starts_on ?? undefined,
        endsOn: row.ends_on ?? undefined,
        name: row.name,
        location: row.location,
        type: dbEventType(row.type),
        format,
        distanceKm: uiEventDistanceKm(row.distance_km, row.location, row.name),
        participantsLabel: row.participants_label,
        status: uiEventStatus(row.status),
        chessResultsUrl: row.chess_results_url,
        regulationUrl: row.regulation_url ?? undefined,
        provisional: row.provisional,
        recommended: row.recommended,
        deadlines: deadlinesByEvent.get(row.id) ?? [],
        documents: documentsByEvent.get(row.id),
        initialRanking: startListsByEvent.get(row.id),
        teamMembers: teamMembersByEvent.get(row.id),
        registrations: regsByEvent.get(row.id) ?? [],
        registrationDetails: regDetailsByEvent.get(row.id) ?? [],
      };
    });

    const importedPairings = await query<{ event_id: string; round_number: number; board: number; white_name: string | null; black_name: string | null; result: string | null }>('select coalesce(e.external_key, ep.event_id::text) event_id, ep.round_number, ep.board, ep.white_name, ep.black_name, ep.result from event_pairings ep join events e on e.id=ep.event_id order by ep.round_number desc, ep.board');
    const importedStandings = await query<{ event_id: string; round_number: number; position: number; player_name: string; club: string | null; fide_id: string | null; points: string | null; tie_breaks: unknown; raw: unknown }>('select coalesce(e.external_key, es.event_id::text) event_id, es.round_number, es.position, es.player_name, es.club, es.fide_id, es.points::text, es.tie_breaks, es.raw from event_standings es join events e on e.id=es.event_id order by es.round_number desc, es.position');
    const pairingsByEvent = groupRowsByEventId(importedPairings.rows);
    const standingsByEvent = groupRowsByEventId(importedStandings.rows);
    const matchPlayers = players.map((player) => ({ id: player.id, name: player.name, fideId: player.fideId }));
    const eventsWithImports = events.map((event) => {
      const allStandings = (standingsByEvent.get(event.id) ?? [])
        .filter((row) => String(row.player_name ?? '').length < 140 && !/^Nota:|Search for/i.test(String(row.player_name ?? '')));
      const teamStandings = allStandings.map(teamStandingFromStandingRow).filter(Boolean) as EventTeamStanding[];
      const standings = allStandings
        .filter((row) => !isTeamStandingRaw(row.raw))
        .map(individualStandingFromStandingRow)
        .filter((row) => row.player_name.length < 140 && !/^Nota:|Search for/i.test(row.player_name))
        .slice(0, 30);
      const pairings = (pairingsByEvent.get(event.id) ?? []).slice(0, 30);
      const startList = event.initialRanking ?? [];
      if (!standings.length && !pairings.length && !teamStandings.length) return event;
      return {
        ...event,
        format: event.format ?? (teamStandings.length ? 'team' : undefined),
        teamStandings: teamStandings.length ? teamStandings : event.teamStandings,
        live: standings.length || pairings.length
          ? {
              round: standings[0]?.round_number ?? pairings[0]?.round_number ?? event.live?.round ?? 0,
              totalRounds: event.live?.totalRounds ?? 0,
              nextRound: event.live?.nextRound ?? 'Atualizado por Chess-Results',
              standings: standings.map((row) => ({ position: row.position, name: row.player_name, club: row.club ?? '', fideId: row.fide_id ?? undefined, points: String(row.points ?? ''), us: Boolean(findTournamentPlayer(matchPlayers, { name: row.player_name, fideId: row.fide_id, club: row.club }, startList)) || isEfanorClub(row.club) })),
              pairings: pairings.map((row) => ({ board: row.board, white: row.white_name ?? '', black: row.black_name ?? '', result: row.result ?? undefined, whiteUs: isClubTournamentName(row.white_name, startList, matchPlayers), blackUs: isClubTournamentName(row.black_name, startList, matchPlayers) })),
            }
          : event.live,
      };
    });

    const medals: Medal[] = medalRows.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      playerId: row.player_id,
      type: row.medal_type,
      source: row.source,
      place: row.place ?? undefined,
      label: row.label ?? undefined,
    }));

    const games = await loadGames();

    const workerRuns: WorkerRun[] = runRows.rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      message: row.message || '',
      updatedAt: row.updated_at,
      result: row.result,
      payload: row.payload,
      attempts: row.attempts,
    }));

    return { accounts, players, posts, events: eventsWithImports, medals, games, workerRuns };
}

async function loadGames(): Promise<GameRecord[]> {
  const [gameRows, moveRows, annotationRows] = await Promise.all([
    query(
      `select g.id::text,
              coalesce(g.white_name, '') white,
              coalesce(g.black_name, '') black,
              coalesce(e.name, g.headers->>'Event', 'Partida PGN') event,
              g.result,
              coalesce(g.eco, g.headers->>'ECO', '') eco,
              g.pgn,
              g.played_on::text,
              coalesce(wp.external_key, g.white_player_id::text) white_player_id,
              coalesce(bp.external_key, g.black_player_id::text) black_player_id
       from games g
       left join events e on e.id = g.event_id
       left join players wp on wp.id = g.white_player_id
       left join players bp on bp.id = g.black_player_id
       order by g.played_on desc nulls last, g.created_at desc`,
    ),
    query('select game_id::text, ply, san from game_moves order by game_id, ply'),
    query('select game_id::text, ply, body from game_annotations order by game_id, ply'),
  ]);

  const movesByGame = new Map<string, string[]>();
  for (const row of moveRows.rows) {
    const moves = movesByGame.get(row.game_id) ?? [];
    moves[Number(row.ply) - 1] = row.san;
    movesByGame.set(row.game_id, moves);
  }
  const annotationsByGame = new Map<string, Record<number, string>>();
  for (const row of annotationRows.rows) {
    const annotations = annotationsByGame.get(row.game_id) ?? {};
    annotations[Number(row.ply) - 1] = row.body;
    annotationsByGame.set(row.game_id, annotations);
  }

  return gameRows.rows.map((row) => ({
    id: row.id,
    white: row.white,
    black: row.black,
    event: row.event,
    result: row.result,
    eco: row.eco,
    moves: (movesByGame.get(row.id) ?? []).filter(Boolean),
    annotations: annotationsByGame.get(row.id) ?? {},
    pgn: row.pgn ?? undefined,
    playedOn: row.played_on ?? undefined,
    whitePlayerId: row.white_player_id ?? undefined,
    blackPlayerId: row.black_player_id ?? undefined,
  }));
}

export async function seedDatabase() {
  if (!(await isDatabaseReady())) throw new Error('Database is not ready');

  const seedPasswordHashes = new Map(
    seedAccountCredentials.map((credential) => [credential.email.toLowerCase(), credential.passwordHash]),
  );
  const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim();
  const productionSeed = process.env.NODE_ENV === 'production';

  for (const account of seedData.accounts) {
    const configuredAdminHash = account.role === 'admin' && initialAdminPassword ? await hashPassword(initialAdminPassword) : undefined;
    const passwordHash = configuredAdminHash ?? (!productionSeed ? seedPasswordHashes.get(account.email.toLowerCase()) : undefined) ?? '';
    const status = account.role === 'admin' && productionSeed && !initialAdminPassword ? 'disabled' : account.status;
    await query(
      `insert into users (name, email, password_hash, role, status, profile_status, profile_missing_fields, fide_id, date_of_birth, phone, whatsapp_consent_at, must_change_password)
       values ($1,$2,$3, $4::user_role, $5::user_status, $6::profile_status, $7::jsonb, $8, $9, $10, now(), $11)
       on conflict (email) do update set name=excluded.name, password_hash=case when excluded.password_hash <> '' then excluded.password_hash else users.password_hash end, role=excluded.role, status=excluded.status, profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields, fide_id=excluded.fide_id, date_of_birth=excluded.date_of_birth, phone=excluded.phone, must_change_password=excluded.must_change_password`,
      [account.name, account.email, passwordHash, dbRole(account.role), status, account.profileStatus, JSON.stringify(account.missingFields), account.fideId ?? null, account.dateOfBirth ?? null, account.phone ?? null, !passwordHash],
    );
  }

  for (const player of seedData.players) {
    await query(
      `insert into players (external_key, name, fide_id, date_of_birth, category_label, sex, active, profile_status, profile_missing_fields)
       values ($1,$2,$3,$4,$5,$6,$7,$8::profile_status,$9::jsonb)
       on conflict (fide_id) do update set external_key=excluded.external_key, name=excluded.name, date_of_birth=excluded.date_of_birth, category_label=excluded.category_label, sex=excluded.sex, active=excluded.active, profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields`,
      [player.id, player.name, player.fideId ?? null, player.dateOfBirth ?? null, player.category, player.sex ?? null, player.active, player.profileStatus, JSON.stringify(player.missingFields)],
    );
  }

  await seedFideRatingSnapshots();

  for (const post of seedData.posts) {
    const author = await query<{ id: string }>('select id::text from users where name=$1 limit 1', [post.author]);
    await query(
      `insert into mural_posts (id, tag, title, body_markdown, tint, board_x, board_y, rotation, z_index, author_id, published_at)
       values ($1::uuid, $2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::date)
       on conflict (id) do update set tag=excluded.tag, title=excluded.title, body_markdown=excluded.body_markdown, tint=excluded.tint, board_x=excluded.board_x, board_y=excluded.board_y, rotation=excluded.rotation, z_index=excluded.z_index, author_id=excluded.author_id, published_at=excluded.published_at`,
      [stableUuid(post.id), post.tag, post.title, post.body, post.tint, post.x, post.y, post.rotation, post.z, author.rows[0]?.id ?? null, post.date],
    );
  }

  for (const event of seedData.events) {
    await query(
      `insert into events (external_key, season, name, location, distance_km, month_label, date_label, type, status, chess_results_url, regulation_url, participants_label, provisional, recommended)
       values ($1,$2,$3,$4,$5,$6,$7,$8::event_type,$9::event_status,$10,$11,$12,$13,$14)
       on conflict (external_key) do update set season=excluded.season, name=excluded.name, location=excluded.location, distance_km=excluded.distance_km, month_label=excluded.month_label, date_label=excluded.date_label, type=excluded.type, status=excluded.status, chess_results_url=excluded.chess_results_url, regulation_url=excluded.regulation_url, participants_label=excluded.participants_label, provisional=excluded.provisional, recommended=excluded.recommended`,
      [event.id, event.season, event.name, event.location, event.distanceKm, event.month, event.dateLabel, event.type, event.status, event.chessResultsUrl, event.regulationUrl ?? null, event.participantsLabel, event.provisional ?? false, event.recommended ?? false],
    );
    const eventId = await query<{ id: string }>('select id::text from events where external_key=$1', [event.id]);
    if (!eventId.rows[0]) continue;
    await query('delete from event_deadlines where event_id=$1::uuid', [eventId.rows[0].id]);
    for (const [index, deadline] of event.deadlines.entries()) {
      await query('insert into event_deadlines (event_id, label, deadline_label, sort_order) values ($1::uuid,$2,$3,$4)', [eventId.rows[0].id, deadline.label, deadline.value, index]);
    }
  }

  for (const event of seedData.events) {
    for (const playerId of event.registrations) {
      await query(
        `insert into event_registrations (event_id, player_id)
         select e.id, p.id from events e, players p where e.external_key=$1 and p.external_key=$2
         on conflict (event_id, player_id) do update set status='selected', updated_at=now()`,
        [event.id, playerId],
      );
    }
  }

  for (const medal of seedData.medals) {
    await query(
      `insert into medals (event_id, player_id, medal_type, source, place, label)
       select e.id, p.id, $3::medal_type, $4::medal_source, $5, $6 from events e, players p where e.external_key=$1 and p.external_key=$2
       on conflict do nothing`,
      [medal.eventId, medal.playerId, medal.type, medal.source, medal.place ?? null, medal.label ?? null],
    );
  }
}

async function seedFideRatingSnapshots() {
  const rows = seedData.players.flatMap((player) => ratingSnapshotRows(player));
  for (let index = 0; index < rows.length; index += 1000) {
    const chunk = rows.slice(index, index + 1000);
    await query(
      `with seed_rows as (
         select * from jsonb_to_recordset($1::jsonb) as row(fide_id text, list_month date, rating_type text, rating integer, games integer)
       )
       insert into fide_rating_snapshots (player_id, fide_id, list_month, rating_type, rating, games)
       select p.id, row.fide_id, row.list_month, row.rating_type::rating_type, row.rating, row.games
       from seed_rows row
       join players p on p.fide_id = row.fide_id
       on conflict (fide_id, list_month, rating_type) do update set
         player_id=excluded.player_id,
         rating=excluded.rating,
         games=excluded.games,
         imported_at=now()`,
      [JSON.stringify(chunk)],
    );
  }
}

function ratingSnapshotRows(player: Player) {
  if (!player.fideId) return [];
  return (player.ratingHistory ?? []).flatMap((point) =>
    (['standard', 'rapid', 'blitz'] as RatingType[])
      .map((ratingType) => ({
        fide_id: player.fideId,
        list_month: point.listMonth,
        rating_type: ratingType,
        rating: point[ratingType],
        games: point[`${ratingType}Games`],
      }))
      .filter((row) => row.rating),
  );
}

function groupRowsByEventId<T extends { event_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.event_id, [...(grouped.get(row.event_id) ?? []), row]);
  return grouped;
}

function eventFormatFromMetadata(value: unknown): EventRecord['format'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const metadata = value as { chessResultsImport?: { format?: unknown } };
  return metadata.chessResultsImport?.format === 'team' ? 'team' : metadata.chessResultsImport?.format === 'individual' ? 'individual' : undefined;
}

function isTeamMemberRaw(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).kind === 'team-member');
}

function isTeamStandingRaw(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).kind === 'team');
}

function teamMemberFromStartListRow(row: Record<string, any>): EventTeamMember {
  const raw = rawRecord(row.raw);
  return {
    teamName: stringValue(raw.teamName) ?? row.club ?? '',
    teamRank: numberValue(raw.teamRank),
    board: row.seed ?? numberValue(raw.board),
    title: row.title ?? undefined,
    name: row.player_name,
    fideId: row.fide_id ?? undefined,
    federation: row.federation ?? undefined,
    rating: row.rating ?? undefined,
    points: stringValue(raw.points),
    games: numberValue(raw.games),
    performance: numberValue(raw.performance),
    raw: row.raw,
  };
}

function teamStandingFromStandingRow(row: Record<string, any>): EventTeamStanding | null {
  if (!isTeamStandingRaw(row.raw)) return null;
  const raw = rawRecord(row.raw);
  const standing = rawRecord(raw.standing);
  const tieBreaks = Array.isArray(standing.tieBreaks)
    ? standing.tieBreaks.map(String)
    : Array.isArray(row.tie_breaks)
      ? row.tie_breaks.map(String)
      : undefined;
  return {
    position: Number(row.position),
    seed: numberValue(standing.seed),
    name: stringValue(standing.name) ?? stringValue(raw.teamName) ?? row.player_name,
    played: numberValue(standing.played),
    wins: numberValue(standing.wins),
    draws: numberValue(standing.draws),
    losses: numberValue(standing.losses),
    matchPoints: stringValue(standing.matchPoints) ?? (row.points != null ? String(row.points).replace('.', ',') : undefined),
    boardPoints: stringValue(standing.boardPoints),
    tieBreaks,
    averageRating: numberValue(standing.averageRating),
    captain: stringValue(standing.captain),
    raw: row.raw,
  };
}

type ImportedStandingRow = {
  round_number: number;
  position: number;
  player_name: string;
  club?: string | null;
  fide_id?: string | null;
  points?: string | null;
  raw?: unknown;
};

function individualStandingFromStandingRow(row: Record<string, any>): ImportedStandingRow {
  const recovered = recoverIndividualStanding(row.raw);
  return {
    round_number: Number(row.round_number),
    position: Number(row.position),
    player_name: recovered?.name ?? String(row.player_name ?? ''),
    club: recovered?.club ?? row.club ?? undefined,
    fide_id: recovered?.fideId ?? row.fide_id ?? undefined,
    points: recovered?.points ?? (row.points != null ? String(row.points) : undefined),
    raw: row.raw,
  };
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stableUuid(seed: string) {
  const hex = Buffer.from(seed.padEnd(16, '0')).toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
