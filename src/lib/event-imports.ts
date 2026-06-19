import crypto from 'node:crypto';
import { query } from './db';
import { calculateEventDistanceKm, DEFAULT_EVENT_DISTANCE_KM } from './event-distance';
import type { ChessResultsEventImport, EventDeadline, EventDocumentRecord, EventStartListEntry, EventTeamMember, EventTeamStanding } from './types';

export async function applyChessResultsImportToEvent(
  eventId: string,
  imported: ChessResultsEventImport,
  options: { updateEvent?: boolean; replaceDeadlines?: boolean } = {},
) {
  if (options.updateEvent !== false) await updateEventFromImport(eventId, imported);
  await storeEventDeadlines(eventId, imported.deadlines, Boolean(options.replaceDeadlines));
  await storeEventDocuments(eventId, imported.documents, imported.regulationUrl);
  await storeEventStartList(eventId, imported.initialRanking);
  await storeEventTeamStandings(eventId, imported.teamStandings ?? []);
  await storeEventTeamMembers(eventId, imported.teamMembers ?? []);
  const registrationRows = imported.format === 'team'
    ? [...imported.initialRanking, ...(imported.teamMembers ?? []).map(teamMemberToStartListEntry)]
    : imported.initialRanking;
  const registrationSync = await syncEventRegistrationsFromStartList(eventId, registrationRows);
  return { confirmedRegistrations: registrationSync.confirmed };
}

export async function storeEventStartList(eventId: string, rows: EventStartListEntry[]) {
  const payload = rows
    .filter((row) => row.name)
    .map((row) => ({
      source_player_id: startListSourcePlayerId(row),
      source_id: row.sourceId ?? null,
      player_name: row.name,
      club: row.club ?? null,
      fide_id: row.fideId ?? null,
      federation: row.federation ?? null,
      rating: row.rating ?? null,
      seed: row.number ?? null,
      title: row.title ?? null,
      category: row.category ?? null,
      raw: row.raw ?? {},
    }));
  if (!payload.length) return;
  await query(
    `with rows as (
       select * from jsonb_to_recordset($2::jsonb) as row(source_player_id text, source_id text, player_name text, club text, fide_id text, federation text, rating integer, seed integer, title text, category text, raw jsonb)
     )
     insert into event_start_lists (event_id, source_player_id, source_id, player_name, club, fide_id, federation, rating, seed, title, category, raw)
     select $1::uuid, source_player_id, source_id, player_name, club, fide_id, federation, rating, seed, title, category, raw from rows
     on conflict (event_id, source_player_id) do update set source_id=excluded.source_id, player_name=excluded.player_name, club=excluded.club, fide_id=excluded.fide_id, federation=excluded.federation, rating=excluded.rating, seed=excluded.seed, title=excluded.title, category=excluded.category, raw=excluded.raw, updated_at=now()`,
    [eventId, JSON.stringify(payload)],
  );
}

export async function storeEventTeamStandings(eventId: string, rows: EventTeamStanding[]) {
  const payload = rows
    .filter((row) => row.name)
    .map((row) => ({
      position: row.position,
      player_name: row.name,
      club: row.name,
      points: parseScore(row.matchPoints ?? row.boardPoints),
      tie_breaks: row.tieBreaks ?? [],
      raw: { ...rawObject(row.raw), kind: 'team', teamName: row.name, standing: row },
    }));
  if (!payload.length) return;
  await query("delete from event_standings where event_id=$1::uuid and round_number=0 and raw->>'kind'='team'", [eventId]);
  await query(
    `with rows as (
       select * from jsonb_to_recordset($2::jsonb) as row(position integer, player_name text, club text, points numeric, tie_breaks jsonb, raw jsonb)
     )
     insert into event_standings (event_id, round_number, position, player_name, club, points, tie_breaks, raw)
     select $1::uuid, 0, position, player_name, club, points, tie_breaks, raw from rows
     on conflict (event_id, round_number, position, player_name) do update set club=excluded.club, points=excluded.points, tie_breaks=excluded.tie_breaks, raw=excluded.raw, updated_at=now()`,
    [eventId, JSON.stringify(payload)],
  );
}

export async function storeEventTeamMembers(eventId: string, rows: EventTeamMember[]) {
  const payload = rows
    .filter((row) => row.name && row.teamName)
    .map((row) => ({
      source_player_id: teamMemberSourcePlayerId(row),
      source_id: row.fideId ?? null,
      player_name: row.name,
      club: row.teamName,
      fide_id: row.fideId ?? null,
      federation: row.federation ?? null,
      rating: row.rating ?? null,
      seed: row.board ?? null,
      title: row.title ?? null,
      raw: { ...rawObject(row.raw), kind: 'team-member', teamName: row.teamName, teamRank: row.teamRank, points: row.points, games: row.games, performance: row.performance },
    }));
  if (!payload.length) return;
  await query("delete from event_start_lists where event_id=$1::uuid and raw->>'kind'='team-member'", [eventId]);
  await query(
    `with rows as (
       select * from jsonb_to_recordset($2::jsonb) as row(source_player_id text, source_id text, player_name text, club text, fide_id text, federation text, rating integer, seed integer, title text, raw jsonb)
     )
     insert into event_start_lists (event_id, source_player_id, source_id, player_name, club, fide_id, federation, rating, seed, title, raw)
     select $1::uuid, source_player_id, source_id, player_name, club, fide_id, federation, rating, seed, title, raw from rows
     on conflict (event_id, source_player_id) do update set source_id=excluded.source_id, player_name=excluded.player_name, club=excluded.club, fide_id=excluded.fide_id, federation=excluded.federation, rating=excluded.rating, seed=excluded.seed, title=excluded.title, raw=excluded.raw, updated_at=now()`,
    [eventId, JSON.stringify(payload)],
  );
}

export async function syncEventRegistrationsFromStartList(eventId: string, rows: EventStartListEntry[]) {
  if (!rows.length) return { confirmed: 0 };

  const players = await query<{ id: string; name: string; fide_id: string | null }>('select id::text, name, fide_id from players');
  const playersByFideId = new Map<string, { id: string; name: string; fide_id: string | null }>();
  const playersByName = new Map<string, { id: string; name: string; fide_id: string | null }[]>();

  for (const player of players.rows) {
    const fideId = normalizeFideId(player.fide_id);
    if (fideId) playersByFideId.set(fideId, player);

    const name = normalizePersonName(player.name);
    playersByName.set(name, [...(playersByName.get(name) ?? []), player]);
  }

  const seenPlayerIds = new Set<string>();
  const confirmations = [];

  for (const row of rows) {
    const match = matchStartListRow(row, playersByFideId, playersByName);
    if (!match || seenPlayerIds.has(match.player.id)) continue;
    seenPlayerIds.add(match.player.id);
    confirmations.push({ player_id: match.player.id, notes: chessResultsConfirmationNote(match.kind, row) });
  }

  if (confirmations.length) {
    await query(
      `with rows as (
         select * from jsonb_to_recordset($2::jsonb) as row(player_id uuid, notes text)
       )
       insert into event_registrations (event_id, player_id, status, notes)
       select $1::uuid, player_id, 'confirmed'::registration_status, notes from rows
       on conflict (event_id, player_id) do update set
         status='confirmed'::registration_status,
         notes=case
           when event_registrations.notes is null or event_registrations.notes = '' or event_registrations.notes like 'Confirmado por Chess-Results%'
           then excluded.notes
           else event_registrations.notes
         end,
         updated_at=now()`,
      [eventId, JSON.stringify(confirmations)],
    );
  }

  return { confirmed: confirmations.length };
}

export async function storeEventDeadlines(eventId: string, deadlines: EventDeadline[], replace = false) {
  if (replace) await query('delete from event_deadlines where event_id=$1::uuid', [eventId]);
  const existing = await query<{ label: string; deadline_label: string }>('select label, deadline_label from event_deadlines where event_id=$1::uuid', [eventId]);
  const seen = new Set(existing.rows.map((row) => `${row.label}:${row.deadline_label}`));
  for (const [index, deadline] of deadlines.entries()) {
    const key = `${deadline.label}:${deadline.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await query(
      'insert into event_deadlines (event_id, label, deadline_on, deadline_label, sort_order) values ($1::uuid,$2,$3::date,$4,$5)',
      [eventId, deadline.label, deadline.date ?? null, deadline.value, index],
    );
  }
}

export async function storeEventDocuments(eventId: string, documents: EventDocumentRecord[], regulationUrl?: string) {
  const allDocuments = [...documents];
  if (regulationUrl && !allDocuments.some((document) => document.url === regulationUrl)) allDocuments.unshift({ label: 'Regulamento', url: regulationUrl });
  for (const [index, document] of allDocuments.entries()) {
    if (!document.url) continue;
    await query(
      `insert into event_documents (event_id, label, url, sort_order)
       values ($1::uuid,$2,$3,$4)
       on conflict (event_id, url) do update set label=excluded.label, sort_order=least(event_documents.sort_order, excluded.sort_order)`,
      [eventId, document.label || 'Documento', document.url, index],
    );
  }
}

async function updateEventFromImport(eventId: string, imported: ChessResultsEventImport) {
  const current = await query<{ distance_km: number }>('select distance_km from events where id=$1::uuid limit 1', [eventId]);
  const shouldCalculateDistance = [0, DEFAULT_EVENT_DISTANCE_KM].includes(Number(current.rows[0]?.distance_km ?? 0));
  const distanceKm = shouldCalculateDistance
    ? await calculateEventDistanceKm({ location: imported.location, name: imported.name, documents: imported.documents })
    : undefined;

  await query(
    `update events
     set name=coalesce($2,name),
         location=coalesce($3,location),
         month_label=coalesce($4,month_label),
         date_label=coalesce($5,date_label),
         starts_on=coalesce($6::date,starts_on),
         ends_on=coalesce($7::date,ends_on),
         type=coalesce($8::event_type,type),
         status=coalesce($9::event_status,status),
         chess_results_url=coalesce($10,chess_results_url),
         chess_results_tnr=coalesce($11,chess_results_tnr),
         regulation_url=coalesce($12,regulation_url),
         participants_label=coalesce($13,participants_label),
         distance_km=coalesce($14::integer,distance_km),
         source_metadata=source_metadata || $15::jsonb,
         updated_at=now()
     where id=$1::uuid`,
    [
      eventId,
      imported.name ?? null,
      imported.location ?? null,
      imported.month ?? null,
      imported.dateLabel ?? null,
      imported.startsOn ?? null,
      imported.endsOn ?? null,
      imported.type ?? null,
      imported.status ?? null,
      imported.chessResultsUrl ?? null,
      imported.chessResultsTnr ?? null,
      imported.regulationUrl ?? null,
      imported.participantsLabel ?? null,
      distanceKm ?? null,
      JSON.stringify({ chessResultsImport: { sourceUrl: imported.sourceUrl, fetchedAt: imported.fetchedAt, format: imported.format ?? 'individual', warnings: imported.warnings ?? [] } }),
    ],
  );
}

function matchStartListRow(
  row: EventStartListEntry,
  playersByFideId: Map<string, { id: string; name: string; fide_id: string | null }>,
  playersByName: Map<string, { id: string; name: string; fide_id: string | null }[]>,
) {
  const fideId = normalizeFideId(row.fideId);
  if (fideId) {
    const player = playersByFideId.get(fideId);
    if (player) return { player, kind: 'ID FIDE' };
  }

  const nameMatches = playersByName.get(normalizePersonName(row.name)) ?? [];
  if (nameMatches.length === 1 && (!row.club || isEfanorClub(row.club))) return { player: nameMatches[0], kind: 'nome' };

  if (isEfanorClub(row.club)) {
    const importedTokens = nameTokens(normalizePersonName(row.name));
    const fuzzyMatches = [...playersByName.values()]
      .flat()
      .filter((player) => {
        const playerTokens = [...nameTokens(normalizePersonName(player.name))];
        return playerTokens.length >= 2 && playerTokens.every((token) => importedTokens.has(token));
      });
    if (fuzzyMatches.length === 1) return { player: fuzzyMatches[0], kind: 'nome parcial' };
  }

  return null;
}

function chessResultsConfirmationNote(kind: string, row: EventStartListEntry) {
  const source = row.number ? `seed ${row.number}` : row.fideId ? `FIDE ${row.fideId}` : 'ranking inicial';
  return `Confirmado por Chess-Results (${kind}, ${source}).`;
}

function startListSourcePlayerId(row: EventStartListEntry) {
  return row.sourceId || row.fideId || (row.number ? `seed:${row.number}` : `name:${stableHash(row.name)}`);
}

function rawObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function teamMemberSourcePlayerId(row: EventTeamMember) {
  return `team:${stableHash(row.teamName)}:${row.board ?? 'x'}:${row.fideId ?? stableHash(row.name)}`;
}

function teamMemberToStartListEntry(row: EventTeamMember): EventStartListEntry {
  return {
    number: row.board,
    name: row.name,
    sourceId: row.fideId ?? teamMemberSourcePlayerId(row),
    fideId: row.fideId,
    federation: row.federation,
    rating: row.rating,
    club: row.teamName,
    title: row.title,
    raw: row.raw,
  };
}

function parseScore(value?: string) {
  if (!value) return null;
  const parsed = Number(value.replace('½', '.5').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFideId(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\D/g, '') || trimmed.toLowerCase();
}

function isEfanorClub(club?: string) {
  return /efanor|xadrez\s+col[eé]gio\s+efanor|col[eé]gio\s+efanor/i.test(club ?? '');
}

function nameTokens(normalizedName: string) {
  const ignored = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e']);
  return new Set(normalizedName.split(/\s+/).filter((token) => token.length > 1 && !ignored.has(token)));
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

function stableHash(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}
