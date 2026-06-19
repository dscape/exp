create extension if not exists pgcrypto;

create type user_role as enum ('admin', 'moderator', 'student');
create type user_status as enum ('pending', 'active', 'disabled');
create type profile_status as enum ('incomplete', 'complete');
create type rating_type as enum ('standard', 'rapid', 'blitz');
create type event_type as enum ('standard', 'rapid', 'blitz');
create type event_status as enum ('draft', 'upcoming', 'registration_open', 'ongoing', 'completed', 'cancelled');
create type registration_status as enum ('selected', 'submitted', 'confirmed', 'withdrawn');
create type medal_type as enum ('gold', 'silver', 'bronze');
create type medal_source as enum ('auto', 'manual');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed');

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null default '',
  role user_role not null default 'student',
  status user_status not null default 'pending',
  profile_status profile_status not null default 'incomplete',
  profile_missing_fields jsonb not null default '[]'::jsonb,
  phone text,
  date_of_birth date,
  fide_id text,
  whatsapp_consent_at timestamptz,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  date_of_birth date not null,
  fide_id text,
  guardian_email text not null,
  phone text,
  message text,
  password_hash text not null default '',
  whatsapp_consent boolean not null default false,
  status user_status not null default 'pending',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  external_key text unique,
  name text not null,
  fide_id text unique,
  date_of_birth date,
  category_label text,
  sex text,
  active boolean not null default true,
  profile_status profile_status not null default 'incomplete',
  profile_missing_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists player_user_links (
  player_id uuid not null references players(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (player_id, user_id)
);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id),
  file_name text not null,
  mime_type text not null,
  byte_size integer not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists mural_posts (
  id uuid primary key default gen_random_uuid(),
  tag text not null default 'Nota',
  title text not null,
  body_markdown text not null,
  tint text not null default '#FCEBC4',
  board_x numeric not null default 0,
  board_y numeric not null default 0,
  rotation text not null default '0deg',
  z_index integer not null default 1,
  image_asset_id uuid references media_assets(id),
  author_id uuid references users(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  external_key text unique,
  season text not null,
  name text not null,
  location text not null,
  distance_km integer not null default 0,
  month_label text not null,
  date_label text not null,
  starts_on date,
  ends_on date,
  type event_type not null,
  status event_status not null default 'upcoming',
  chess_results_url text,
  chess_results_tnr text,
  regulation_url text,
  participants_label text not null default 'A definir',
  provisional boolean not null default false,
  recommended boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_deadlines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null,
  deadline_on date,
  deadline_label text not null,
  sort_order integer not null default 0
);

create table if not exists event_documents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null,
  url text not null,
  sort_order integer not null default 0
);

create table if not exists event_recommendations (
  event_id uuid not null references events(id) on delete cascade,
  recommended_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (event_id)
);

create table if not exists event_registrations (
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status registration_status not null default 'selected',
  notes text,
  registered_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, player_id)
);

create table if not exists event_import_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  source_type text not null,
  source_url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists event_sync_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  source_url text,
  status job_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  message text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists event_raw_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  source_url text not null,
  snapshot_hash text not null,
  content text not null,
  fetched_at timestamptz not null default now(),
  unique(event_id, source_url, snapshot_hash)
);

create table if not exists event_start_lists (
  event_id uuid not null references events(id) on delete cascade,
  source_player_id text not null,
  player_name text not null,
  club text,
  fide_id text,
  rating integer,
  seed integer,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, source_player_id)
);

create table if not exists event_standings (
  event_id uuid not null references events(id) on delete cascade,
  round_number integer not null default 0,
  position integer not null,
  player_name text not null,
  club text,
  fide_id text,
  points numeric,
  tie_breaks jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, round_number, position, player_name)
);

create table if not exists event_pairings (
  event_id uuid not null references events(id) on delete cascade,
  round_number integer not null,
  board integer not null,
  white_name text,
  black_name text,
  result text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, round_number, board)
);

create table if not exists fide_imports (
  id uuid primary key default gen_random_uuid(),
  list_month date not null,
  rating_type rating_type not null,
  source_url text not null,
  source_file_hash text not null,
  status job_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  message text,
  unique(list_month, rating_type, source_file_hash)
);

create table if not exists fide_rating_snapshots (
  player_id uuid not null references players(id) on delete cascade,
  fide_id text not null,
  list_month date not null,
  rating_type rating_type not null,
  rating integer,
  games integer,
  k_factor integer,
  title text,
  federation text,
  imported_at timestamptz not null default now(),
  primary key (fide_id, list_month, rating_type)
);

create table if not exists medals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  medal_type medal_type not null,
  source medal_source not null default 'manual',
  place integer,
  label text,
  awarded_by uuid references users(id),
  awarded_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  white_player_id uuid references players(id) on delete set null,
  black_player_id uuid references players(id) on delete set null,
  white_name text not null,
  black_name text not null,
  result text not null,
  eco text,
  pgn text not null,
  headers jsonb not null default '{}'::jsonb,
  played_on date,
  created_at timestamptz not null default now()
);

create table if not exists game_moves (
  game_id uuid not null references games(id) on delete cascade,
  ply integer not null,
  san text not null,
  uci text,
  fen_after text,
  primary key (game_id, ply)
);

create table if not exists game_annotations (
  game_id uuid not null references games(id) on delete cascade,
  ply integer not null,
  author_id uuid references users(id),
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, ply)
);

create table if not exists worker_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status job_status not null default 'queued',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists medals_unique_label_idx on medals(event_id, player_id, medal_type, coalesce(label, ''));
create index if not exists users_role_status_idx on users(role, status);
create index if not exists players_fide_idx on players(fide_id);
create index if not exists events_season_status_idx on events(season, status);
create index if not exists worker_jobs_pick_idx on worker_jobs(status, run_after, created_at);
