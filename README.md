# Escola de Xadrez do Porto

Next.js + PostgreSQL application for the Escola de Xadrez do Porto club portal. The implementation ports the provided design prototype into production-oriented code with responsive desktop/tablet/mobile layouts.

## Scope implemented

- Login and access-request flows
- Main club shell with role-aware navigation
- Mural with post-it creation, markdown help, dragging, removal, WhatsApp share links and toast feedback
- Events list, filters, recommendations, event creation, Chess-Results URL detection/import, detail pages for upcoming/ongoing/completed events, registration management, documents and WhatsApp sharing
- FIDE ratings leaderboard with month/type/group/search/sort controls
- Player profiles with live tournament card, ratings, chart, medals, recent events, games and PGN download
- Game viewer with board, move navigation and moderator/admin annotations
- Trophy room with season filter, podium, totals and medal table
- Account management with pending/active/disabled accounts, role changes, profile completeness flags, moderator/admin profile editing and manual password reset
- PostgreSQL schema for all persistent entities
- Worker architecture for FIDE imports, best-effort Chess-Results sync, lifecycle, medal recomputation and backup heartbeat
- Docker Compose deployment for VPS with Postgres, web, worker and Caddy

## Key product decisions

- `Clássicas` = FIDE Standard
- `Semi-Rápidas` = FIDE Rapid
- `Rápidas` = FIDE Blitz
- WhatsApp integration is share links only (`wa.me`)
- Chess-Results sync is best-effort, rate-limited through the worker queue, and records failures without blocking the app
- Payments are not tracked in the app
- Profile edits are moderator/admin-only
- Password resets are manual moderator/admin flows; no reset emails
- Incomplete profiles are marked in `Gestão` for later completion

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts a local Postgres container when no `DATABASE_URL` is exported, waits for the database, applies pending migrations, seeds only an empty database, then runs both Next.js and the worker. Use `npm run dev:web` for the old web-only Next dev server, or `npm run dev:prepare` to run only the database/migration/empty-seed preparation.

```bash
npm run build
npm run test:visual
```

The app falls back to seed data when `DATABASE_URL` is not configured in web-only mode.

## Database

```bash
npm run dev:prepare
# or, against a custom database:
DATABASE_URL=postgres://escola:escola@localhost:5432/escola npm run db:migrate
DATABASE_URL=postgres://escola:escola@localhost:5432/escola npm run db:seed
```

## Spreadsheet imports

Export the roster and event spreadsheets as CSV, then run:

```bash
DATABASE_URL=postgres://escola:escola@localhost:5432/escola npm run import:roster -- roster.csv
DATABASE_URL=postgres://escola:escola@localhost:5432/escola npm run import:events -- events.csv
```

Roster headers supported: `name,email,role,status,fide_id,date_of_birth,phone,category,sex`.
Event headers supported: `season,name,location,distance_km,month,date_label,type,status,chess_results_url,regulation_url,deadline`.

## VPS / Docker

Copy the example environment and replace the placeholders with production values. Use URL-safe random secrets so the same password can be used in `POSTGRES_PASSWORD` and `DATABASE_URL` without URL encoding surprises.

```bash
cp .env.example .env
openssl rand -hex 32 # use for POSTGRES_PASSWORD and DATABASE_URL
openssl rand -base64 24 # use once for INITIAL_ADMIN_PASSWORD
```

Set at least:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL=postgres://<user>:<password>@postgres:5432/<db>`
- `APP_DOMAIN=xadrez.example.pt`
- `APP_BASE_URL=https://xadrez.example.pt`

Deploy or update the app:

```bash
docker compose up -d --build
```

Run the seed exactly once after the first deploy, with `INITIAL_ADMIN_PASSWORD` set in `.env` or passed only for that command:

```bash
docker compose run --rm seed
```

After logging in with the initial admin password, remove or blank `INITIAL_ADMIN_PASSWORD` in `.env`. Normal deploys run migrations only and never run seed data.

Services:

- `postgres`: PostgreSQL database
- `migrate`: applies migrations only
- `seed`: one-time bootstrap seed service behind the `seed` profile
- `web`: Next.js standalone app
- `worker`: background job runner and nightly database backup creator
- `caddy`: reverse proxy / TLS
- `backup-sync`: optional rclone offsite backup sync behind the `backup` profile

Nightly backups are written under the `uploads` Docker volume at `/app/uploads/backups`. To sync them offsite, configure `ops/rclone/rclone.conf`, set `RCLONE_REMOTE` in `.env`, then run:

```bash
docker compose --profile backup up -d backup-sync
```

## Workers

Run locally:

```bash
DATABASE_URL=postgres://escola:escola@localhost:5432/escola npm run worker
```

Job types:

- `fide.importMonthly`
- `chessResults.importEvent`
- `chessResults.syncEvent`
- `events.lifecycle`
- `medals.recompute`
- `backups.nightly`

FIDE monthly worker imports use official XML zip downloads. Seeded historical ratings are generated per student from FIDE profile chart data and stored in `src/lib/fide-history-seed.json`; refresh them with `npm run fide:history` before reseeding. Chess-Results parsing is best-effort HTML/PDF parsing with raw snapshots, imported initial rankings and sync-run records for audit/debugging. PDF deadline extraction can be tested with `npm run extract:deadlines -- <pdf-url-or-path> [YYYY-MM-DD]`.
