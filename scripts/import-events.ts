import fs from 'node:fs/promises';
import { query } from '../src/lib/db';
import { parseCsv } from './csv';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import:events -- events.csv');
  process.exit(1);
}

function eventType(value?: string) {
  const v = value?.toLowerCase() ?? '';
  if (v.includes('semi') || v === 'sr' || v === 'rapid') return 'rapid';
  if (v.includes('ráp') || v.includes('rap') || v === 'ra' || v === 'blitz') return 'blitz';
  return 'standard';
}
function status(value?: string) {
  const v = value?.toLowerCase() ?? '';
  if (v.includes('concl')) return 'completed';
  if (v.includes('decor') || v.includes('ongoing')) return 'ongoing';
  if (v.includes('inscr')) return 'registration_open';
  if (v.includes('cancel')) return 'cancelled';
  return 'upcoming';
}

async function main() {
  const rows = parseCsv(await fs.readFile(file!, 'utf8'));
  for (const [index, row] of rows.entries()) {
    const externalKey = row.external_key || row.id || `sheet-${index + 1}`;
    const event = await query<{ id: string }>(
      `insert into events (external_key, season, name, location, distance_km, month_label, date_label, starts_on, ends_on, type, status, chess_results_url, regulation_url, participants_label, provisional)
       values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::event_type,$11::event_status,$12,$13,$14,$15)
       on conflict (external_key) do update set season=excluded.season, name=excluded.name, location=excluded.location, distance_km=excluded.distance_km, month_label=excluded.month_label, date_label=excluded.date_label, starts_on=excluded.starts_on, ends_on=excluded.ends_on, type=excluded.type, status=excluded.status, chess_results_url=excluded.chess_results_url, regulation_url=excluded.regulation_url, participants_label=excluded.participants_label, provisional=excluded.provisional
       returning id::text`,
      [externalKey, row.season || '2025/26', row.name, row.location || 'A definir', Number(row.distance_km || row.km || 0), row.month || row.mes || 'JUN', row.date_label || row.date || row.data || 'a definir', row.starts_on || null, row.ends_on || null, eventType(row.type || row.tipo), status(row.status || row.estado), row.chess_results_url || row.chess_results || row.url || null, row.regulation_url || row.regulamento || null, row.participants_label || row.participantes || 'A definir', /true|sim|yes|1/i.test(row.provisional || row.provisorio || '')],
    );
    await query('delete from event_deadlines where event_id=$1::uuid', [event.rows[0].id]);
    const deadline = row.deadline || row.prazo || row.prazo_final;
    if (deadline) await query('insert into event_deadlines (event_id, label, deadline_label, sort_order) values ($1::uuid,$2,$3,0)', [event.rows[0].id, 'Prazo Final', deadline]);
  }
  console.log(`Imported ${rows.length} event rows`);
}

main().catch((error) => { console.error(error); process.exit(1); });
