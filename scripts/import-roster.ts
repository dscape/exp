import fs from 'node:fs/promises';
import { query } from '../src/lib/db';
import { parseCsv } from './csv';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import:roster -- roster.csv');
  process.exit(1);
}

function missing(row: Record<string, string>) { return ['date_of_birth', 'fide_id', 'phone', 'sex'].filter((field) => !row[field]); }
function role(value?: string) { const v = value?.toLowerCase(); return v === 'admin' ? 'admin' : v?.startsWith('mod') ? 'moderator' : 'student'; }
function status(value?: string) { const v = value?.toLowerCase(); return v?.startsWith('des') ? 'disabled' : v?.startsWith('pend') ? 'pending' : 'active'; }

async function main() {
  const rows = parseCsv(await fs.readFile(file!, 'utf8'));
  for (const row of rows) {
    const missingFields = missing(row);
    if (row.email) {
      await query(
        `insert into users (name, email, password_hash, role, status, profile_status, profile_missing_fields, phone, date_of_birth, fide_id, whatsapp_consent_at, must_change_password)
         values ($1,$2,'',$3::user_role,$4::user_status,$5::profile_status,$6::jsonb,$7,$8::date,$9,now(),true)
         on conflict (email) do update set name=excluded.name, role=excluded.role, status=excluded.status, profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields, phone=excluded.phone, date_of_birth=excluded.date_of_birth, fide_id=excluded.fide_id`,
        [row.name, row.email, role(row.role), status(row.status), missingFields.length ? 'incomplete' : 'complete', JSON.stringify(missingFields), row.phone || null, row.date_of_birth || null, row.fide_id || null],
      );
    }
    if (row.name) {
      const externalKey = row.external_key || (row.email ? `email:${row.email.toLowerCase()}` : '');
      if (!row.fide_id && !externalKey) throw new Error(`Roster row for ${row.name} needs fide_id, external_key, or email to be re-imported safely.`);
      const params = [externalKey || null, row.name, row.fide_id || null, row.date_of_birth || null, row.category || row.category_label || null, row.sex || null, missingFields.length ? 'incomplete' : 'complete', JSON.stringify(missingFields)];
      if (row.fide_id) {
        await query(
          `insert into players (external_key, name, fide_id, date_of_birth, category_label, sex, profile_status, profile_missing_fields)
           values ($1,$2,$3,$4::date,$5,$6,$7::profile_status,$8::jsonb)
           on conflict (fide_id) do update set external_key=coalesce(excluded.external_key, players.external_key), name=excluded.name, date_of_birth=excluded.date_of_birth, category_label=excluded.category_label, sex=excluded.sex, profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields`,
          params,
        );
      } else {
        await query(
          `insert into players (external_key, name, fide_id, date_of_birth, category_label, sex, profile_status, profile_missing_fields)
           values ($1,$2,$3,$4::date,$5,$6,$7::profile_status,$8::jsonb)
           on conflict (external_key) do update set name=excluded.name, date_of_birth=excluded.date_of_birth, category_label=excluded.category_label, sex=excluded.sex, profile_status=excluded.profile_status, profile_missing_fields=excluded.profile_missing_fields`,
          params,
        );
      }
    }
  }
  console.log(`Imported ${rows.length} roster rows`);
}

main().catch((error) => { console.error(error); process.exit(1); });
