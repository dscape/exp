import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionAccountFromToken } from '@/lib/auth';
import { isChessResultsUrl } from '@/lib/chess-results-url';
import { getPool, query } from '@/lib/db';
import { applyChessResultsImportToEvent } from '@/lib/event-imports';
import { loadAppData } from '@/lib/repository';
import { normalizeBirthDate } from '@/lib/dates';
import { createDatabaseBackup } from '@/lib/db-backup';
import { parsePgnGames } from '@/lib/pgn';
import { resolveEventDistanceKm } from '@/lib/event-distance';
import { hashPassword, hashSessionToken, verifyPassword } from '@/lib/passwords';
import { normalizeFideId, normalizePersonName } from '@/lib/tournament-matching';
import { seedAccountCredentials, seedData } from '@/lib/seed-data';
import type { Account, AppData, ChessResultsEventImport, EventDeadline, ProfileStatus, Role, UserStatus } from '@/lib/types';

export const runtime = 'nodejs';

const MUTATION_ROLES: Role[] = ['admin', 'moderator'];

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash?: string;
  role: string;
  status: string;
  profile_status: string;
  profile_missing_fields: unknown;
  fide_id: string | null;
  date_of_birth: string | null;
  phone: string | null;
};

type AccessRequestRow = {
  id: string;
  student_name: string;
  guardian_email: string;
  password_hash: string;
  status: string;
  fide_id: string | null;
  date_of_birth: string | null;
  phone: string | null;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (path === 'bootstrap') return await bootstrap(request);
  if (path === 'auth/me') return await currentSession(request);
  if (path.startsWith('jobs/')) {
    const session = await requireSession(request);
    if (!session.ok) return session.response;
    return await jobStatus(path.split('/')[1]);
  }
  if (path === 'backups/latest') return await databaseBackupDownload(request);
  if (path === 'health') return NextResponse.json({ ok: true, database: Boolean(getPool()) });
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  try {
    if (path === 'games/upload') {
      const session = await requireRole(request, MUTATION_ROLES);
      if (!session.ok) return session.response;
      return await gameUpload(request);
    }
  } catch (error) {
    console.error(`API ${path} failed`, error);
    return NextResponse.json({ ok: false, error: 'Erro interno do servidor.' }, { status: 500 });
  }

  const body = await readBody(request);
  try {
    if (path === 'auth/login') return await login(body);
    if (path === 'auth/logout') return await logout(request);
    if (path === 'access-requests') return await accessRequest(body);

    if (path === 'events/registrations') {
      const session = await requireSession(request);
      if (!session.ok) return session.response;
      return await eventRegistration(body, session.account);
    }

    if (path === 'mural-posts') return await withRole(request, MUTATION_ROLES, (account) => muralPost(body, account));
    if (path === 'mural-posts/delete') return await withRole(request, MUTATION_ROLES, () => deleteById('mural_posts', body?.id));
    if (path === 'chess-results/import') return await withRole(request, MUTATION_ROLES, () => chessResultsImport(body));
    if (path === 'events') return await withRole(request, MUTATION_ROLES, () => eventCreate(body));
    if (path === 'events/recommend') return await withRole(request, MUTATION_ROLES, () => eventRecommend(body));
    if (path === 'events/sync') return await withRole(request, MUTATION_ROLES, () => eventSync(body));
    if (path === 'medals') return await withRole(request, MUTATION_ROLES, (account) => medalCreate(body, account));
    if (path === 'medals/delete') return await withRole(request, MUTATION_ROLES, () => deleteById('medals', body?.id));
    if (path === 'games/annotations') return await withRole(request, MUTATION_ROLES, (account) => gameAnnotationUpdate(body, account));
    if (path === 'accounts/update') return await withRole(request, MUTATION_ROLES, () => accountUpdate(body));
    if (path === 'accounts/manual-password') return await withRole(request, MUTATION_ROLES, () => manualPassword(body));
    if (path === 'jobs/enqueue') return await withRole(request, MUTATION_ROLES, () => enqueueJob(body));
  } catch (error) {
    console.error(`API ${path} failed`, error);
    return NextResponse.json({ ok: false, error: 'Erro interno do servidor.' }, { status: 500 });
  }
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

async function readBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function bootstrap(request: NextRequest) {
  if (!getPool()) return NextResponse.json(await loadAppData());
  const session = await requireSession(request, false);
  if (!session.ok) return NextResponse.json(publicApiData());
  return NextResponse.json(await loadAppData());
}

async function withRole(request: NextRequest, roles: Role[], handler: (account: Account) => Promise<NextResponse>) {
  const session = await requireRole(request, roles);
  return session.ok ? handler(session.account) : session.response;
}

async function requireRole(request: NextRequest, roles: Role[]) {
  const session = await requireSession(request);
  if (!session.ok) return session;
  if (!roles.includes(session.account.role)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Sem permissões.' }, { status: 403 }) };
  }
  return session;
}

async function requireSession(request: NextRequest, clearInvalidCookie = true) {
  if (!getPool()) return { ok: true as const, account: seedData.accounts[0] ?? demoAccount() };
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const account = await sessionAccountFromToken(token);
  if (account) return { ok: true as const, account };
  const response = NextResponse.json({ ok: false, error: 'Sessão inválida.' }, { status: 401 });
  if (token && clearInvalidCookie) response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return { ok: false as const, response };
}

function publicApiData(): AppData {
  return { accounts: [], players: [], posts: [], events: [], medals: [], games: [], workerRuns: [] };
}

function demoAccount(): Account {
  return { id: 'demo', name: 'Demo', email: 'demo@example.test', role: 'admin', status: 'active', profileStatus: 'complete', missingFields: [] };
}

async function login(body: any) {
  const identifier = String(body?.identifier ?? body?.email ?? body?.loginUser ?? '').trim();
  const password = String(body?.password ?? '');
  if (!identifier || !password) return badRequest('Indica o utilizador e a palavra-passe.');

  const result = await findLoginAccount(identifier);
  if (!result || !(await verifyPassword(password, result.passwordHash))) {
    return NextResponse.json({ ok: false, error: 'Credenciais inválidas.' }, { status: 401 });
  }

  if (result.account.status !== 'active') {
    const error = result.account.status === 'pending' ? 'A conta ainda está pendente de aprovação.' : 'A conta está desativada.';
    return NextResponse.json({ ok: false, error }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true, account: result.account });
  if (result.userId && getPool()) {
    if (result.passwordHash.startsWith('manual:')) {
      await query('update users set password_hash=$2, updated_at=now() where id::text=$1', [result.userId, await hashPassword(password)]);
    }
    const token = randomBytes(32).toString('base64url');
    await query('delete from user_sessions where expires_at < now()');
    await query("insert into user_sessions (user_id, token_hash, expires_at) values ($1::uuid, $2, now() + interval '30 days')", [result.userId, hashSessionToken(token)]);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  }
  return response;
}

async function currentSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const account = await sessionAccountFromToken(token);
  if (!account) {
    const response = NextResponse.json({ ok: false }, { status: 401 });
    if (token) response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  }
  return NextResponse.json({ ok: true, account });
}

async function logout(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && getPool()) await query('delete from user_sessions where token_hash=$1', [hashSessionToken(token)]);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}

async function canDownloadBackups(request: NextRequest) {
  const account = await sessionAccountFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  return account?.role === 'admin' || account?.role === 'moderator';
}

async function findLoginAccount(identifier: string): Promise<{ account: Account; passwordHash: string; userId?: string } | null> {
  if (getPool()) {
    const users = await query<UserRow>(
      `select id::text, name, email, password_hash, role::text, status::text, profile_status::text, profile_missing_fields, fide_id, date_of_birth::text, phone
       from users
       where lower(email) = lower($1) or lower(name) = lower($1)
       order by (status = 'active') desc, created_at desc
       limit 1`,
      [identifier],
    );
    const user = users.rows[0];
    if (!user?.password_hash) return null;
    return { account: accountFromUserRow(user), passwordHash: user.password_hash, userId: user.id };
  }

  const account = seedData.accounts.find(
    (candidate) => candidate.email.toLowerCase() === identifier.toLowerCase() || candidate.name.toLowerCase() === identifier.toLowerCase(),
  );
  const credentials = account
    ? seedAccountCredentials.find((credential) => credential.email.toLowerCase() === account.email.toLowerCase())
    : undefined;
  if (!account || !credentials) return null;
  return { account, passwordHash: credentials.passwordHash };
}

async function accessRequest(body: any) {
  const validation = validateAccessRequest(body);
  if (!validation.ok) return badRequest(validation.error);

  const { studentName, dateOfBirth, fideId, guardianEmail, phone, message, password } = validation.value;
  const missingFields = profileMissingFields({ fideId, dateOfBirth, phone });
  const account = pendingAccount(`access-request:local-${Date.now()}`, studentName, guardianEmail, fideId, dateOfBirth, phone);

  if (!getPool()) return NextResponse.json({ ok: true, stored: false, account });

  const existing = await query<{ status: string }>('select status::text from users where lower(email) = lower($1) limit 1', [guardianEmail]);
  if (existing.rows[0] && existing.rows[0].status !== 'pending') {
    return NextResponse.json({ ok: false, error: 'Já existe uma conta com esse email.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await query<AccessRequestRow>(
    `insert into access_requests (student_name, date_of_birth, fide_id, guardian_email, phone, whatsapp_consent, message, password_hash)
     values ($1, $2::date, $3, $4, $5, true, $6, $7)`,
    [studentName, dateOfBirth, fideId, guardianEmail, phone, message, passwordHash],
  );

  const users = await query<UserRow>(
    `insert into users (name, email, password_hash, role, status, profile_status, profile_missing_fields, fide_id, date_of_birth, phone, whatsapp_consent_at, must_change_password)
     values ($1, $2, $3, 'student', 'pending', $4::profile_status, $5::jsonb, $6, $7::date, $8, now(), false)
     on conflict (email) do update set name=excluded.name, password_hash=excluded.password_hash, role='student', status='pending', profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields, fide_id=excluded.fide_id, date_of_birth=excluded.date_of_birth, phone=excluded.phone, whatsapp_consent_at=now(), must_change_password=false, updated_at=now()
     where users.status = 'pending'
     returning id::text, name, email, role::text, status::text, profile_status::text, profile_missing_fields, fide_id, date_of_birth::text, phone`,
    [studentName, guardianEmail, passwordHash, profileStatus(missingFields), JSON.stringify(missingFields), fideId, dateOfBirth, phone],
  );

  if (!users.rows[0]) return NextResponse.json({ ok: false, error: 'Já existe uma conta com esse email.' }, { status: 409 });
  return NextResponse.json({ ok: true, account: accountFromUserRow(users.rows[0]) });
}

async function muralPost(body: any, account: Account) {
  const id = validUuidOrNull(body?.id);
  if (!getPool()) return NextResponse.json({ ok: true, stored: false, id });
  const inserted = await query<{ id: string }>(
    `insert into mural_posts (id, tag, title, body_markdown, tint, board_x, board_y, rotation, z_index, author_id, published_at)
     values (coalesce($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,coalesce($11::date, current_date))
     returning id::text`,
    [id, body.tag ?? 'Nota', body.title, body.body, body.tint, body.x ?? 0, body.y ?? 0, body.rotation ?? '0deg', body.z ?? 1, account.id, normalizePostDate(body.date)],
  );
  return NextResponse.json({ ok: true, id: inserted.rows[0].id });
}

async function chessResultsImport(body: any) {
  if (!getPool()) return NextResponse.json({ ok: false, error: 'Base de dados/worker indisponível.' }, { status: 503 });
  const url = String(body?.url ?? '').trim();
  if (!url || !isChessResultsUrl(url)) return badRequest('Indica um URL Chess-Results válido.');
  const inserted = await query<{ id: string }>(
    `insert into worker_jobs (type, payload)
     values ('chessResults.importEvent', $1::jsonb)
     returning id::text`,
    [JSON.stringify({ url, interactive: true })],
  );
  return NextResponse.json({ ok: true, jobId: inserted.rows[0].id });
}

async function jobStatus(id: string) {
  if (!id || !getPool()) return NextResponse.json({ ok: false }, { status: 404 });
  const job = await query<{ id: string; type: string; status: string; last_error: string | null; result: unknown; updated_at: string }>(
    "select id::text, type, status::text, last_error, result, updated_at::text from worker_jobs where id::text=$1 limit 1",
    [id],
  );
  const row = job.rows[0];
  if (!row) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, job: { id: row.id, type: row.type, status: row.status, error: row.last_error, result: row.result, updatedAt: row.updated_at } });
}

async function databaseBackupDownload(request: NextRequest) {
  if (!getPool()) return NextResponse.json({ ok: false, error: 'Base de dados indisponível.' }, { status: 503 });
  const allowed = await canDownloadBackups(request);
  if (!allowed) return NextResponse.json({ ok: false, error: 'Sem permissões.' }, { status: 403 });
  const backup = await createDatabaseBackup();
  const content = await import('node:fs/promises').then((fs) => fs.readFile(backup.filePath));
  return new NextResponse(content, {
    headers: {
      'content-type': backup.mimeType,
      'content-disposition': `attachment; filename="${backup.fileName}"`,
      'cache-control': 'no-store',
    },
  });
}

async function gameUpload(request: NextRequest) {
  if (!getPool()) return NextResponse.json({ ok: false, error: 'Base de dados indisponível.' }, { status: 503 });
  const form = await request.formData();
  const playerId = String(form.get('playerId') ?? '').trim();
  const file = form.get('file');
  if (!playerId) return badRequest('Atleta inválido.');
  if (!(file instanceof File)) return badRequest('Escolhe um ficheiro PGN.');
  const player = await resolvePlayer(playerId);
  if (!player) return NextResponse.json({ ok: false, error: 'Atleta não encontrado.' }, { status: 404 });

  const pgnText = await file.text();
  const parsedGames = parsePgnGames(pgnText, {
    event: String(form.get('eventName') ?? '').trim() || undefined,
    playedOn: optionalIsoDate(form.get('playedOn')) ?? undefined,
    white: String(form.get('white') ?? '').trim() || player.name,
    black: String(form.get('black') ?? '').trim() || undefined,
    result: String(form.get('result') ?? '').trim() || undefined,
    eco: String(form.get('eco') ?? '').trim() || undefined,
  });
  const playerNames = await query<{ id: string; external_key: string | null; name: string; fide_id: string | null }>('select id::text, external_key, name, fide_id from players');
  const matchedGames = parsedGames.filter((game) => pgnGameBelongsToPlayer(game, player.name));
  if (!matchedGames.length) return badRequest('O PGN não contém partidas deste atleta.');

  let imported = 0;
  const eventIdsByName = new Map<string, string | null>();
  for (const game of matchedGames) {
    const whitePlayer = matchPlayerByName(playerNames.rows, game.white);
    const blackPlayer = matchPlayerByName(playerNames.rows, game.black);
    const eventId = await findCachedGameEventId(game.event, eventIdsByName);
    const inserted = await query<{ id: string }>(
      `insert into games (event_id, white_player_id, black_player_id, white_name, black_name, result, eco, pgn, headers, played_on)
       values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10::date)
       returning id::text`,
      [
        eventId,
        whitePlayer?.id ?? null,
        blackPlayer?.id ?? null,
        game.white,
        game.black,
        game.result,
        game.eco || null,
        game.pgn,
        JSON.stringify({ Event: game.event, White: game.white, Black: game.black, Result: game.result, ECO: game.eco || undefined }),
        game.playedOn ?? null,
      ],
    );
    if (game.moves.length) {
      await query(
        'insert into game_moves (game_id, ply, san) select $1::uuid, ordinality::integer, san from unnest($2::text[]) with ordinality as moves(san, ordinality) on conflict do nothing',
        [inserted.rows[0].id, game.moves],
      );
    }
    imported++;
  }

  return NextResponse.json({ ok: true, imported });
}

async function eventCreate(body: any) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  const imported = normalizeEventImport(body?.chessResultsImport, body?.deadlines);
  const distanceKm = await resolveEventDistanceKm({
    location: body.location ?? imported?.location,
    name: body.name ?? imported?.name,
    documents: imported?.documents ?? body.documents,
    explicitDistanceKm: body.distanceKm,
  });
  const inserted = await query<{ id: string }>(
    `insert into events (external_key, season, name, location, distance_km, month_label, date_label, starts_on, ends_on, type, status, chess_results_url, chess_results_tnr, regulation_url, participants_label, source_metadata, provisional, recommended)
     values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::event_type,$11::event_status,$12,$13,$14,$15,$16::jsonb,false,false)
     returning id::text`,
    [
      body.id,
      body.season,
      body.name,
      body.location,
      distanceKm,
      body.month,
      body.dateLabel,
      optionalIsoDate(body.startsOn),
      optionalIsoDate(body.endsOn),
      body.type,
      body.status,
      body.chessResultsUrl,
      body.chessResultsTnr ?? imported?.chessResultsTnr ?? null,
      body.regulationUrl ?? null,
      body.participantsLabel ?? 'A definir',
      JSON.stringify(imported ? { chessResultsImport: { sourceUrl: imported.sourceUrl, fetchedAt: imported.fetchedAt, format: imported.format ?? 'individual' } } : {}),
    ],
  );
  if (imported) {
    await applyChessResultsImportToEvent(inserted.rows[0].id, imported, { updateEvent: false, replaceDeadlines: true });
  } else {
    for (const [index, deadline] of normalizeDeadlines(body.deadlines).entries()) {
      await query('insert into event_deadlines (event_id, label, deadline_on, deadline_label, sort_order) values ($1::uuid,$2,$3::date,$4,$5)', [inserted.rows[0].id, deadline.label, deadline.date ?? null, deadline.value, index]);
    }
  }
  let syncResult: Awaited<ReturnType<typeof waitForWorkerJobCompletion>> | undefined;
  if (body.chessResultsUrl && isChessResultsUrl(body.chessResultsUrl)) {
    const jobId = await insertWorkerJob('chessResults.syncEvent', { eventId: inserted.rows[0].id, url: body.chessResultsUrl, force: true, reason: 'new-event' });
    if (imported?.status === 'completed' || body.status === 'completed') syncResult = await waitForWorkerJobCompletion(jobId, 45_000);
  }
  return NextResponse.json({ ok: true, id: inserted.rows[0].id, sync: syncResult });
}

async function eventRecommend(body: any) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  await query('update events set recommended = not recommended, updated_at=now() where id::text=$1 or external_key=$1', [body.eventId]);
  return NextResponse.json({ ok: true });
}

async function eventSync(body: any) {
  if (!getPool()) return NextResponse.json({ ok: false, error: 'Base de dados/worker indisponível.' }, { status: 503 });
  const requestedId = String(body?.eventId ?? '').trim();
  if (!requestedId) return badRequest('Evento inválido.');

  const events = await query<{ id: string; status: string; chess_results_url: string | null }>(
    'select id::text, status::text, chess_results_url from events where id::text=$1 or external_key=$1 limit 1',
    [requestedId],
  );
  const event = events.rows[0];
  if (!event) return NextResponse.json({ ok: false, error: 'Evento não encontrado.' }, { status: 404 });
  if (!event.chess_results_url || !isChessResultsUrl(event.chess_results_url)) return badRequest('Este evento não tem URL Chess-Results válido.');

  const automatic = Boolean(body?.automatic);
  if (automatic && event.status !== 'ongoing') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-live' });
  }

  const recentJob = await query<{ id: string; status: string; created_at: string }>(
    `select id::text, status::text, created_at::text
     from worker_jobs
     where type='chessResults.syncEvent'
       and payload->>'eventId'=$1
       and (status in ('queued','running') or created_at > now() - interval '1 minute')
     order by created_at desc
     limit 1`,
    [event.id],
  );
  if (recentJob.rows[0]) {
    return NextResponse.json({
      ok: true,
      debounced: true,
      jobId: recentJob.rows[0].id,
      status: recentJob.rows[0].status,
      message: 'Sincronização recente; a usar o pedido já existente.',
    });
  }

  const recentRun = await query<{ status: string; created_at: string }>(
    `select status::text, created_at::text
     from event_sync_runs
     where event_id=$1::uuid
       and created_at > now() - interval '1 minute'
     order by created_at desc
     limit 1`,
    [event.id],
  );
  if (recentRun.rows[0]) {
    return NextResponse.json({
      ok: true,
      debounced: true,
      status: recentRun.rows[0].status,
      message: 'Chess-Results foi sincronizado há menos de 1 minuto.',
    });
  }

  const inserted = await query<{ id: string }>(
    `insert into worker_jobs (type, payload)
     values ('chessResults.syncEvent', $1::jsonb)
     returning id::text`,
    [
      JSON.stringify({
        eventId: event.id,
        url: event.chess_results_url,
        force: !automatic,
        reason: automatic ? 'live-event-visit' : 'manual-event-sync',
      }),
    ],
  );

  return NextResponse.json({ ok: true, jobId: inserted.rows[0].id, status: 'queued' });
}

async function eventRegistration(body: any, account: Account) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  const player = await resolvePlayer(String(body?.playerId ?? ''));
  if (!player) return NextResponse.json({ ok: false, error: 'Atleta não encontrado.' }, { status: 404 });
  if (!canMutatePlayerRegistration(account, player)) return NextResponse.json({ ok: false, error: 'Sem permissões.' }, { status: 403 });
  const action = body?.action === 'select' || body?.action === 'withdraw' ? body.action : 'toggle';
  await query(
    `with e as (select id from events where id::text=$1 or external_key=$1), p as (select id from players where id::text=$2 or external_key=$2 or fide_id=$2)
     insert into event_registrations (event_id, player_id, status)
     select e.id, p.id, case when $3 = 'withdraw' then 'withdrawn'::registration_status else 'selected'::registration_status end from e,p
     on conflict (event_id, player_id) do update set
       status = case
         when $3 = 'select' and event_registrations.status = 'withdrawn' then 'selected'::registration_status
         when $3 = 'select' then event_registrations.status
         when $3 = 'withdraw' then 'withdrawn'::registration_status
         when event_registrations.status = 'withdrawn' then 'selected'::registration_status
         else 'withdrawn'::registration_status
       end,
       updated_at=now()`,
    [body.eventId, player.id, action],
  );
  return NextResponse.json({ ok: true });
}

async function medalCreate(body: any, account: Account) {
  const id = validUuidOrNull(body?.id);
  if (!getPool()) return NextResponse.json({ ok: true, stored: false, id });
  const inserted = await query<{ id: string }>(
    `insert into medals (id, event_id, player_id, medal_type, source, place, label, awarded_by)
     select coalesce($7::uuid, gen_random_uuid()), e.id, p.id, $3::medal_type, $4::medal_source, $5, $6, $8::uuid from events e, players p where (e.id::text=$1 or e.external_key=$1) and (p.id::text=$2 or p.external_key=$2 or p.fide_id=$2)
     on conflict do nothing
     returning id::text`,
    [body.eventId, body.playerId, body.type, body.source ?? 'manual', body.place ?? null, body.label ?? null, id, account.id],
  );
  return NextResponse.json({ ok: true, id: inserted.rows[0]?.id ?? id });
}

async function accountUpdate(body: any) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  const patch = body.patch ?? body;
  const id = String(body.id ?? body.accountId ?? '');
  if (!id) return badRequest('Conta inválida.');
  if (isAccessRequestAccountId(id)) return await accessRequestAccountUpdate(id, patch);

  const dateOfBirth = optionalBirthDate(patch.dateOfBirth);
  if (dateOfBirth === false) return badRequest('Data de nascimento inválida.');
  const email = typeof patch.email === 'string' ? patch.email.trim().toLowerCase() : null;

  await query(
    `update users set name=coalesce($2,name), email=coalesce($3,email), fide_id=coalesce($4,fide_id), date_of_birth=coalesce($5::date,date_of_birth), phone=coalesce($6,phone), profile_status=coalesce($7::profile_status, profile_status), profile_missing_fields=coalesce($8::jsonb, profile_missing_fields), status=coalesce($9::user_status,status), role=coalesce($10::user_role, role), updated_at=now()
     where id::text=$1`,
    [id, patch.name ?? null, email, patch.fideId ?? null, dateOfBirth || null, patch.phone ?? null, patch.profileStatus ?? null, patch.missingFields ? JSON.stringify(patch.missingFields) : null, patch.status ?? null, roleToDb(patch.role) ?? null],
  );
  if (patch.status === 'disabled') await query('delete from user_sessions where user_id=$1::uuid', [id]);
  return NextResponse.json({ ok: true });
}

async function accessRequestAccountUpdate(id: string, patch: any) {
  const requestId = id.replace('access-request:', '');
  const dateOfBirth = optionalBirthDate(patch.dateOfBirth);
  if (dateOfBirth === false) return badRequest('Data de nascimento inválida.');
  const email = typeof patch.email === 'string' ? patch.email.trim().toLowerCase() : null;
  const status = userStatusToDb(patch.status);

  await query(
    `update access_requests set student_name=coalesce($2,student_name), guardian_email=coalesce($3,guardian_email), fide_id=coalesce($4,fide_id), date_of_birth=coalesce($5::date,date_of_birth), phone=coalesce($6,phone), status=coalesce($7::user_status,status)
     where id::text=$1`,
    [requestId, patch.name ?? null, email, patch.fideId ?? null, dateOfBirth || null, patch.phone ?? null, status],
  );

  if (status === 'active') {
    const account = await createUserFromAccessRequest(requestId, 'active');
    if (!account) return badRequest('Pedido de acesso não encontrado.');
    return NextResponse.json({ ok: true, account });
  }

  return NextResponse.json({ ok: true });
}

async function createUserFromAccessRequest(requestId: string, status: UserStatus) {
  const requests = await query<AccessRequestRow>(
    'select id::text, student_name, guardian_email, password_hash, status::text, fide_id, date_of_birth::text, phone from access_requests where id::text=$1 limit 1',
    [requestId],
  );
  const request = requests.rows[0];
  if (!request) return null;

  const dateOfBirth = request.date_of_birth;
  const fideId = request.fide_id;
  const phone = request.phone;
  const missingFields = profileMissingFields({ fideId, dateOfBirth, phone });
  const passwordHash = await normalizedStoredPasswordHash(request.password_hash);
  const users = await query<UserRow>(
    `insert into users (name, email, password_hash, role, status, profile_status, profile_missing_fields, fide_id, date_of_birth, phone, whatsapp_consent_at, must_change_password)
     values ($1, $2, $3, 'student', $4::user_status, $5::profile_status, $6::jsonb, $7, $8::date, $9, now(), false)
     on conflict (email) do update set name=excluded.name, password_hash=case when excluded.password_hash <> '' then excluded.password_hash else users.password_hash end, status=excluded.status, profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields, fide_id=excluded.fide_id, date_of_birth=excluded.date_of_birth, phone=excluded.phone, whatsapp_consent_at=now(), updated_at=now()
     returning id::text, name, email, role::text, status::text, profile_status::text, profile_missing_fields, fide_id, date_of_birth::text, phone`,
    [request.student_name, request.guardian_email.toLowerCase(), passwordHash, status, profileStatus(missingFields), JSON.stringify(missingFields), fideId, dateOfBirth, phone],
  );
  await query('update access_requests set status=$2::user_status, reviewed_at=now() where id::text=$1', [requestId, status]);
  return users.rows[0] ? accountFromUserRow(users.rows[0]) : null;
}

async function manualPassword(body: any) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  const id = String(body.accountId ?? '');
  const value = String(body.value ?? '');
  if (!id || !value) return badRequest('Conta ou palavra-passe inválida.');
  const passwordHash = await hashPassword(value);

  if (isAccessRequestAccountId(id)) {
    const requestId = id.replace('access-request:', '');
    await query('update access_requests set password_hash=$2 where id::text=$1', [requestId, passwordHash]);
    await query('insert into audit_log (action, entity_type, entity_id, after) values ($1,$2,$3,$4::jsonb)', ['manual_password_reset', 'access_request', requestId, JSON.stringify({ at: new Date().toISOString() })]);
    return NextResponse.json({ ok: true });
  }

  await query('update users set password_hash=$2, must_change_password=true, updated_at=now() where id::text=$1', [id, passwordHash]);
  await query('insert into audit_log (action, entity_type, entity_id, after) values ($1,$2,$3,$4::jsonb)', ['manual_password_reset', 'user', id, JSON.stringify({ at: new Date().toISOString() })]);
  return NextResponse.json({ ok: true });
}

async function gameAnnotationUpdate(body: any, account: Account) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  const gameId = String(body?.gameId ?? '').trim();
  const ply = Number(body?.ply);
  const text = String(body?.body ?? '');
  if (!validUuidOrNull(gameId) || !Number.isInteger(ply) || ply < 1) return badRequest('Anotação inválida.');

  if (text.trim()) {
    await query(
      `insert into game_annotations (game_id, ply, author_id, body)
       values ($1::uuid,$2,$3::uuid,$4)
       on conflict (game_id, ply) do update set author_id=excluded.author_id, body=excluded.body, updated_at=now()`,
      [gameId, ply, account.id, text],
    );
  } else {
    await query('delete from game_annotations where game_id=$1::uuid and ply=$2', [gameId, ply]);
  }
  return NextResponse.json({ ok: true });
}

async function enqueueJob(body: any) {
  if (!getPool()) return NextResponse.json({ ok: true, stored: false });
  await insertWorkerJob(String(body.type ?? ''), body.payload ?? {});
  return NextResponse.json({ ok: true });
}

async function insertWorkerJob(type: string, payload: Record<string, unknown>) {
  const inserted = await query<{ id: string }>(
    'insert into worker_jobs (type, payload) values ($1,$2::jsonb) returning id::text',
    [type, JSON.stringify(payload)],
  );
  return inserted.rows[0].id;
}

async function resolvePlayer(id: string) {
  const result = await query<{ id: string; external_key: string | null; name: string; fide_id: string | null }>(
    'select id::text, external_key, name, fide_id from players where id::text=$1 or external_key=$1 or fide_id=$1 limit 1',
    [id],
  );
  return result.rows[0] ?? null;
}

function canMutatePlayerRegistration(account: Account, player: { name: string; fide_id: string | null }) {
  if (account.role === 'admin' || account.role === 'moderator') return true;
  if (account.fideId && normalizeFideId(account.fideId) === normalizeFideId(player.fide_id)) return true;
  return normalizePersonName(account.name) === normalizePersonName(player.name);
}

function matchPlayerByName(
  players: Array<{ id: string; external_key: string | null; name: string; fide_id: string | null }>,
  name: string,
) {
  const normalized = normalizePgnPersonName(name);
  const matches = players.filter((player) => normalizePgnPersonName(player.name) === normalized);
  return matches.length === 1 ? matches[0] : null;
}

async function findCachedGameEventId(eventName: string, cache: Map<string, string | null>) {
  const name = eventName.trim();
  if (!name) return null;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  const result = await query<{ id: string }>(
    'select id::text from events where lower(name)=lower($1) or lower($1) like lower(name) || \'%\' order by starts_on desc nulls last limit 1',
    [name],
  );
  const eventId = result.rows[0]?.id ?? null;
  cache.set(key, eventId);
  return eventId;
}

function pgnGameBelongsToPlayer(game: { white: string; black: string }, playerName: string) {
  const player = normalizePgnPersonName(playerName);
  return normalizePgnPersonName(game.white) === player || normalizePgnPersonName(game.black) === player;
}

function normalizePgnPersonName(name: string) {
  const reordered = name.includes(',') ? `${name.split(',').slice(1).join(' ')} ${name.split(',')[0]}` : name;
  return reordered
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

async function waitForWorkerJobCompletion(jobId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await query<{ status: string; last_error: string | null; result: unknown }>(
      'select status::text, last_error, result from worker_jobs where id=$1::uuid limit 1',
      [jobId],
    );
    const job = result.rows[0];
    if (job?.status === 'succeeded') return { status: 'succeeded' as const, result: job.result };
    if (job?.status === 'failed') return { status: 'failed' as const, error: job.last_error ?? 'Sincronização falhou.' };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { status: 'pending' as const, jobId };
}

async function deleteById(table: string, id?: string) {
  if (!id || !getPool()) return NextResponse.json({ ok: true, stored: false });
  if (!['mural_posts', 'medals'].includes(table)) throw new Error('invalid table');
  await query(`delete from ${table} where id::text=$1`, [id]);
  return NextResponse.json({ ok: true });
}

function validateAccessRequest(body: any):
  | { ok: true; value: { studentName: string; dateOfBirth: string; fideId: string | null; guardianEmail: string; phone: string | null; message: string | null; password: string } }
  | { ok: false; error: string } {
  const studentName = String(body?.studentName ?? '').trim();
  const dateOfBirth = normalizeBirthDate(body?.dateOfBirth);
  const fideId = String(body?.fideId ?? '').trim() || null;
  const guardianEmail = String(body?.guardianEmail ?? '').trim().toLowerCase();
  const phone = String(body?.phone ?? '').trim() || null;
  const message = String(body?.message ?? '').trim() || null;
  const password = String(body?.password ?? '');
  const confirmPassword = String(body?.confirmPassword ?? '');

  if (!studentName) return { ok: false, error: 'Indica o nome do aluno.' };
  if (!dateOfBirth) return { ok: false, error: 'Indica uma data de nascimento válida.' };
  if (!guardianEmail || !/^\S+@\S+\.\S+$/.test(guardianEmail)) return { ok: false, error: 'Indica um email válido.' };
  if (password.length < 8) return { ok: false, error: 'A palavra-passe tem de ter pelo menos 8 caracteres.' };
  if (password !== confirmPassword) return { ok: false, error: 'As palavras-passe não coincidem.' };

  return { ok: true, value: { studentName, dateOfBirth, fideId, guardianEmail, phone, message, password } };
}

function optionalBirthDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeBirthDate(value) ?? false;
}

function validUuidOrNull(value: unknown) {
  const text = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function normalizePostDate(value: unknown) {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function optionalIsoDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeDeadlines(value: unknown): EventDeadline[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((deadline, index) => ({
      label: String(deadline?.label ?? (index ? `${index + 1}.º Prazo` : 'Prazo de inscrição')).trim(),
      value: String(deadline?.value ?? '').trim(),
      date: optionalIsoDate(deadline?.date) ?? undefined,
      sourceUrl: typeof deadline?.sourceUrl === 'string' ? deadline.sourceUrl : undefined,
    }))
    .filter((deadline) => deadline.value);
}

function normalizeEventImport(value: unknown, deadlines: unknown): ChessResultsEventImport | null {
  if (!value || typeof value !== 'object') return null;
  const imported = value as ChessResultsEventImport;
  if (!imported.sourceUrl || !isChessResultsUrl(imported.sourceUrl)) return null;
  return {
    ...imported,
    deadlines: normalizeDeadlines(deadlines).length ? normalizeDeadlines(deadlines) : normalizeDeadlines(imported.deadlines),
    documents: Array.isArray(imported.documents) ? imported.documents : [],
    initialRanking: Array.isArray(imported.initialRanking) ? imported.initialRanking : [],
    teamStandings: Array.isArray(imported.teamStandings) ? imported.teamStandings : [],
    teamMembers: Array.isArray(imported.teamMembers) ? imported.teamMembers : [],
    fetchedAt: imported.fetchedAt ?? new Date().toISOString(),
  };
}

function accountFromUserRow(row: UserRow): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: roleFromDb(row.role),
    status: userStatusFromDb(row.status),
    profileStatus: profileStatusFromDb(row.profile_status),
    missingFields: Array.isArray(row.profile_missing_fields) ? row.profile_missing_fields.map(String) : [],
    fideId: row.fide_id ?? undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    phone: row.phone ?? undefined,
  };
}

function pendingAccount(id: string, name: string, email: string, fideId: string | null, dateOfBirth: string | null, phone: string | null): Account {
  const missingFields = profileMissingFields({ fideId, dateOfBirth, phone });
  return {
    id,
    name,
    email,
    role: 'student',
    status: 'pending',
    profileStatus: profileStatus(missingFields),
    missingFields,
    fideId: fideId ?? undefined,
    dateOfBirth: dateOfBirth ?? undefined,
    phone: phone ?? undefined,
  };
}

function profileMissingFields(input: { fideId?: string | null; dateOfBirth?: string | null; phone?: string | null }) {
  const fields = [];
  if (!input.fideId) fields.push('ID FIDE');
  if (!input.dateOfBirth) fields.push('data de nascimento');
  if (!input.phone) fields.push('telefone');
  return fields;
}

function profileStatus(missingFields: string[]): ProfileStatus {
  return missingFields.length ? 'incomplete' : 'complete';
}

async function normalizedStoredPasswordHash(storedHash: string) {
  if (storedHash.startsWith('manual:')) return await hashPassword(storedHash.slice('manual:'.length));
  return storedHash;
}

function roleFromDb(role: string): Role {
  return role === 'admin' ? 'admin' : role === 'moderator' ? 'moderator' : 'student';
}

function userStatusFromDb(status: string): UserStatus {
  return status === 'active' ? 'active' : status === 'disabled' ? 'disabled' : 'pending';
}

function profileStatusFromDb(status: string): ProfileStatus {
  return status === 'complete' ? 'complete' : 'incomplete';
}

function roleToDb(role?: string) {
  if (!role) return null;
  return role === 'student' ? 'student' : role === 'moderator' ? 'moderator' : role === 'admin' ? 'admin' : null;
}

function userStatusToDb(status?: string) {
  if (!status) return null;
  return status === 'pending' ? 'pending' : status === 'active' ? 'active' : status === 'disabled' ? 'disabled' : null;
}

function isAccessRequestAccountId(id: string) {
  return id.startsWith('access-request:');
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
