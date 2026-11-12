// Google Agenda pelo endereço secreto iCal: leitura dos eventos e vínculo com os pacientes.
import { supabase } from './db.js';
import { norm, todayISO } from './util.js';

const TZ = 'America/Sao_Paulo';
export const TITLE_PREFIX = 'consulta de nutricao';

function unescapeText(s) {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** Data e hora de um DTSTART, no horário de Brasília. */
function parseStart(params, value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  if (!hh) return { date: `${y}-${mo}-${d}`, time: null };
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(dt).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  // Com TZID (ou sem fuso): hora local como está escrita.
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mi}` };
}

/** Lê um arquivo .ics e devolve os eventos. */
export function parseICS(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { attendees: [], organizer: null, status: null }; continue; }
    if (line === 'END:VEVENT') { if (ev?.start) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    switch (name.toUpperCase()) {
      case 'UID': ev.uid = value; break;
      case 'SUMMARY': ev.summary = unescapeText(value); break;
      case 'STATUS': ev.status = value.toUpperCase(); break;
      case 'DTSTART': { const s = parseStart(params, value); if (s) { ev.start = s.date; ev.time = s.time; } break; }
      case 'ORGANIZER': ev.organizer = value.replace(/^mailto:/i, '').trim().toLowerCase(); break;
      case 'ATTENDEE': {
        const mail = value.replace(/^mailto:/i, '').trim().toLowerCase();
        if (mail.includes('@')) ev.attendees.push(mail);
        break;
      }
      default:
    }
  }
  return events;
}

/**
 * Só as consultas ("Consulta de nutrição - Nome"), não canceladas, entre duas datas.
 * O e-mail da dona da agenda (organizador, ou que aparece em muitas consultas) é tirado dos convidados,
 * para nunca ser usado no vínculo com um paciente.
 */
export function consultationEvents(events, from, to) {
  const all = events.filter((e) => e.summary && norm(e.summary).startsWith(TITLE_PREFIX) && e.status !== 'CANCELLED');
  const owners = new Set(all.map((e) => e.organizer).filter(Boolean));
  const count = new Map();
  for (const e of all) for (const m of new Set(e.attendees)) count.set(m, (count.get(m) || 0) + 1);
  for (const [m, n] of count) if (all.length >= 4 && n > all.length / 3) owners.add(m);
  return all
    .filter((e) => e.start >= from && e.start <= to)
    .map((e) => ({
      ...e,
      attendees: e.attendees.filter((m) => !owners.has(m)),
      patientName: e.summary.replace(/^[^-–]*[-–]\s*/, '').trim(),
    }))
    .sort((a, b) => (a.start + (a.time || '')).localeCompare(b.start + (b.time || '')));
}

/** Vínculo: 1º e-mail do convidado, 2º nome do título (ou nome alternativo salvo). */
export function matchEvent(ev, patients) {
  for (const mail of ev.attendees) {
    const p = patients.find((x) => (x.emails || []).includes(mail) || x.email_primary === mail);
    if (p) return { patient: p, how: 'e-mail' };
  }
  const n = norm(ev.patientName);
  const p = patients.find((x) => x.name_norm === n || (x.aliases || []).includes(n));
  return p ? { patient: p, how: 'nome' } : { patient: null, how: null };
}

let cache = null; // { at, events }

/** Busca a agenda (via banco). Devolve null se não houver endereço configurado. */
export async function loadAgenda({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.events;
  const { data, error } = await supabase.rpc('fetch_calendar');
  if (error) throw error;
  if (data == null) { cache = null; return null; }
  cache = { at: Date.now(), events: parseICS(data) };
  return cache.events;
}

export function clearAgendaCache() {
  cache = null;
}

/** Datas de hoje até daqui a N dias. */
export function windowDays(n) {
  const from = todayISO();
  const d = new Date(from + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return { from, to: d.toISOString().slice(0, 10) };
}
