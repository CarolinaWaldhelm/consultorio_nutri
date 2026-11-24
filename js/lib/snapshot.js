// "Fotografia" da agenda: guarda as consultas vistas. Se uma consulta já vista some da agenda (cancelada
// no Nutrium), ela continua aparecendo como cancelada. Se o mesmo evento aparece em outra data, foi remarcada.
import { supabase, run, chunks } from './db.js';
import { todayISO } from './util.js';
import { consultationEvents, matchEvent } from './agenda.js';

let lastSync = 0;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Atualiza a fotografia com a agenda lida agora (no máximo a cada 2 minutos, salvo force). */
export async function syncSnapshot(allEvents, patients, { force = false } = {}) {
  if (!allEvents || (!force && Date.now() - lastSync < 2 * 60 * 1000)) return;
  lastSync = Date.now();
  const today = todayISO();
  const from = addDays(today, -3);
  const to = addDays(today, 60);
  const current = consultationEvents(allEvents, from, to).map((ev) => ({ ...ev, ...matchEvent(ev, patients) }));
  const now = new Date().toISOString();
  const rows = current.map((ev) => ({
    event_key: `${ev.uid}|${ev.start}`, uid: ev.uid, patient_id: ev.patient?.id || null, patient_name: ev.patient?.name || ev.patientName,
    event_date: ev.start, event_time: ev.time || null, end_time: ev.endTime || null, last_seen_at: now, cancelled_at: null, moved_to: null,
  }));
  for (const part of chunks(rows, 200)) await run(supabase.from('calendar_snapshot').upsert(part));

  const existing = await run(supabase.from('calendar_snapshot').select('*').gte('event_date', from).lte('event_date', to).is('cancelled_at', null));
  const keys = new Set(rows.map((r) => r.event_key));
  const missing = existing.filter((r) => !keys.has(r.event_key));
  // Proteção: se a agenda veio vazia de repente, não marca tudo como cancelado.
  if (!rows.length && missing.length > 3) return;
  const dateByUid = new Map(rows.map((r) => [r.uid, r.event_date]));
  for (const r of missing) {
    const moved = r.uid && dateByUid.get(r.uid) && dateByUid.get(r.uid) !== r.event_date ? dateByUid.get(r.uid) : null;
    await run(supabase.from('calendar_snapshot').update({ cancelled_at: now, moved_to: moved }).eq('event_key', r.event_key));
  }
}

/** Consultas canceladas (sumiram da agenda) entre duas datas, no formato dos eventos da agenda. */
export async function cancelledEvents(from, to, patients) {
  const rows = await run(supabase.from('calendar_snapshot').select('*').gte('event_date', from).lte('event_date', to).not('cancelled_at', 'is', null));
  const byId = new Map(patients.map((p) => [p.id, p]));
  return rows.map((r) => ({
    uid: r.uid, key: r.event_key, start: r.event_date, time: r.event_time, endDate: r.event_date, endTime: r.end_time,
    patient: (r.patient_id && byId.get(r.patient_id)) || null, patientName: r.patient_name || '',
    cancelled: true, movedTo: r.moved_to || null,
  }));
}
