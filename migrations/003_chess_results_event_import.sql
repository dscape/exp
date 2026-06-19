alter table worker_jobs add column if not exists result jsonb not null default '{}'::jsonb;

alter table events add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table event_start_lists add column if not exists source_id text;
alter table event_start_lists add column if not exists federation text;
alter table event_start_lists add column if not exists title text;
alter table event_start_lists add column if not exists category text;

delete from event_documents a
using event_documents b
where a.ctid < b.ctid and a.event_id = b.event_id and a.url = b.url;

create unique index if not exists event_documents_event_url_idx on event_documents(event_id, url);
create index if not exists event_start_lists_event_seed_idx on event_start_lists(event_id, seed);
