// Lembretes de consulta: confirmação, comparecimento e estatísticas.
import { todayISO, daysBetween } from './util.js';

export const RESPONSE_LABEL = { confirmado: '✅ Confirmou', remarcar: '📅 Quer remarcar', nao_vai: '❌ Não vai', null: '⏳ Sem resposta' };
export const STATUS_LABEL = { veio: '✔ Veio', faltou: '✖ Não apareceu', cancelou: '🚫 Paciente cancelou', remarcou: '📅 Remarcou' };
export const CANCEL_REASONS = [['faltou', 'Não apareceu'], ['cancelou', 'Paciente cancelou'], ['remarcou', 'Pediu para remarcar']];
export const RESPONSE_SHORT = { confirmado: 'confirmou', remarcar: 'quer remarcar', nao_vai: 'não vai' };

const DAY_SHORT = { seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb' };
const DAY_ORDER = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const SLOT_LABEL = { '09-11': '9h–11h', '11-13': '11h–13h', '14-17': '14h–17h' };

/** Preferência de remarcação em texto curto: "seg, qua · 9h–11h, 14h–17h". */
export function prefsText(prefs) {
  if (!prefs) return '';
  const days = DAY_ORDER.filter((d) => (prefs.days || []).includes(d)).map((d) => DAY_SHORT[d]);
  const slots = ['09-11', '11-13', '14-17'].filter((x) => (prefs.slots || []).includes(x)).map((x) => SLOT_LABEL[x]);
  return [days.join(', '), slots.join(', ')].filter(Boolean).join(' · ');
}

/**
 * Comparecimento de uma consulta que já passou: marcação manual ('veio' | 'faltou'); sem marcação,
 * "veio" se houver consulta registrada no software para o paciente nesse dia; senão, null (a confirmar).
 */
export function attendanceOf(ev, attendanceByKey, consultDays) {
  const manual = attendanceByKey.get(ev.key);
  if (manual) return { status: manual.status, auto: false, row: manual };
  // Cancelada (sumiu da agenda): se o mesmo evento foi para outra data, conta como remarcada; senão, falta o motivo.
  if (ev.cancelled) return ev.movedTo ? { status: 'remarcou', auto: true } : { status: null, auto: false };
  if (ev.patient && consultDays.has(`${ev.patient.id}|${ev.start}`)) return { status: 'veio', auto: true };
  return { status: null, auto: false };
}

/**
 * Estatísticas de um período. items: consultas que já passaram, com { reminder, attendance }.
 */
export function attendanceStats(items) {
  // Comparecimento conta só veio/faltou; canceladas e remarcadas aparecem à parte.
  const known = items.filter((i) => ['veio', 'faltou'].includes(i.attendance.status));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const came = (list) => list.filter((i) => i.attendance.status === 'veio').length;
  const reminded = items.filter((i) => i.reminder);
  const byResp = (r) => known.filter((i) => (i.reminder?.response || null) === r && i.reminder);
  const confirmed = byResp('confirmado');
  const silent = byResp(null);
  const cancelled = known.filter((i) => ['nao_vai', 'remarcar'].includes(i.reminder?.response));
  const noReminder = known.filter((i) => !i.reminder);
  const missed = known.filter((i) => i.attendance.status === 'faltou');
  return {
    total: items.length,
    pending: items.filter((i) => !i.attendance.status).length,
    known: known.length,
    reminded: reminded.length,
    confirmRate: pct(reminded.filter((i) => i.reminder.response === 'confirmado').length, reminded.length),
    answeredRate: pct(reminded.filter((i) => i.reminder.response).length, reminded.length),
    confirmed: { n: confirmed.length, came: came(confirmed), rate: pct(came(confirmed), confirmed.length) },
    silent: { n: silent.length, came: came(silent), rate: pct(came(silent), silent.length) },
    cancelled: { n: cancelled.length, came: came(cancelled), rate: pct(came(cancelled), cancelled.length) },
    noReminder: { n: noReminder.length, came: came(noReminder), rate: pct(came(noReminder), noReminder.length) },
    missed: missed.length,
    cancelledByPatient: items.filter((i) => i.attendance.status === 'cancelou').length,
    rescheduled: items.filter((i) => i.attendance.status === 'remarcou').length,
    cancelledNoReason: items.filter((i) => i.cancelled && !i.attendance.status).length,
    missRate: pct(missed.length, known.length),
  };
}

/** Pacientes que mais faltam (só quem faltou pelo menos 1 vez). */
export function missRanking(items) {
  const by = new Map();
  for (const i of items) {
    if (!i.patient || !['veio', 'faltou'].includes(i.attendance.status)) continue;
    const r = by.get(i.patient.id) || { patient: i.patient, total: 0, missed: 0 };
    r.total += 1;
    if (i.attendance.status === 'faltou') r.missed += 1;
    by.set(i.patient.id, r);
  }
  return [...by.values()].filter((r) => r.missed > 0).sort((a, b) => b.missed - a.missed || b.missed / b.total - a.missed / a.total);
}

export function periodStart(period, today = todayISO()) {
  if (period === 'all') return '2000-01-01';
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - Number(period));
  return d.toISOString().slice(0, 10);
}

export { daysBetween };
