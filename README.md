# Escola de Xadrez do Porto

Next.js + PostgreSQL application for the Escola de Xadrez do Porto club portal. The implementation ports the provided design prototype into production-oriented code with responsive desktop/tablet/mobile layouts.

## Scope implemented

- Login and access-request flows
- Main club shell with role-aware navigation
- Mural with post-it creation, image preview, markdown help, dragging, removal, WhatsApp share links and toast feedback
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

```bash
cp .env.example .env
# edit APP_DOMAIN / APP_BASE_URL / DATABASE_URL as needed
docker compose up -d --build
```

Services:

- `postgres`: PostgreSQL database
- `migrate`: applies migrations only. Run `npm run db:seed` manually for one-time demo/bootstrap seeding.
- `web`: Next.js standalone app
- `worker`: background job runner
- `caddy`: reverse proxy / TLS

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
