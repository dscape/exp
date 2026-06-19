create index if not exists worker_jobs_payload_dedupe_idx on worker_jobs ((payload->>'_dedupe')) where payload ? '_dedupe';
