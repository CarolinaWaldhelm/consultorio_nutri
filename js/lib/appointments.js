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
 * Comparecimento de uma consulta: marcação manual; "veio" se houver consulta registrada no software nesse dia;
 * se o paciente respondeu pelo link que quer remarcar / não vai, já fica resolvido (não precisa marcar veio/faltou);
 * cancelada que reapareceu em outra data = remarcada; senão, null (a marcar).
 */
export function attendanceOf(ev, attendanceByKey, consultDays, reminder = null) {
  const manual = attendanceByKey.get(ev.key);
  if (manual) return { status: manual.status, auto: false, row: manual };
  if (ev.patient && consultDays.has(`${ev.patient.id}|${ev.start}`)) return { status: 'veio', auto: true };
  if (reminder?.response === 'remarcar') return { status: 'remarcou', auto: true, byLink: true };
  if (reminder?.response === 'nao_vai') return { status: 'cancelou', auto: true, byLink: true };
  if (ev.cancelled && ev.movedTo) return { status: 'remarcou', auto: true };
  return { status: null, auto: false };
}

/**
 * Cancelou ou remarcou DEPOIS de confirmar pelo lembrete: teve a chance de avisar e não avisou, então conta como falta.
 */
export function lateAfterConfirm(i) {
  return ['cancelou', 'remarcou'].includes(i.attendance?.status) && i.reminder?.response === 'confirmado';
}

/** Situação que vale para as estatísticas: 'veio', 'faltou' (inclui cancelamento depois de confirmar) ou outra. */
export function effectiveStatus(i) {
  return lateAfterConfirm(i) ? 'faltou' : i.attendance?.status || null;
}

/**
 * Estatísticas de um período. items: consultas que já passaram, com { reminder, attendance, rebooked }.
 * Agrupa pela resposta ao lembrete e mostra como cada grupo terminou.
 */
export function attendanceStats(items) {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const st = (i) => effectiveStatus(i);
  const resp = (i) => (i.reminder ? i.reminder.response || null : 'none');
  // Grupos que precisam de "veio / faltou": confirmaram, não responderam, sem lembrete.
  const outcome = (list) => {
    const came = list.filter((i) => st(i) === 'veio').length;
    const missed = list.filter((i) => st(i) === 'faltou').length;
    const late = list.filter(lateAfterConfirm).length;
    const dayCancel = list.filter((i) => !lateAfterConfirm(i) && ['cancelou', 'remarcou'].includes(st(i))).length;
    const pending = list.filter((i) => !st(i)).length;
    return { n: list.length, came, missed, late, dayCancel, pending, rate: pct(came, came + missed) };
  };
  // Grupos que avisaram pelo link: remarcaram depois ou sumiram?
  const followUp = (list) => {
    const rebooked = list.filter((i) => i.rebooked);
    return { n: list.length, rebooked: rebooked.length, gone: list.filter((i) => !i.rebooked) };
  };
  const confirmed = outcome(items.filter((i) => resp(i) === 'confirmado'));
  const silent = outcome(items.filter((i) => resp(i) === null));
  const noReminder = outcome(items.filter((i) => resp(i) === 'none'));
  const askedResched = followUp(items.filter((i) => resp(i) === 'remarcar'));
  const saidNo = followUp(items.filter((i) => resp(i) === 'nao_vai'));
  const reminded = items.filter((i) => i.reminder);
  const known = items.filter((i) => ['veio', 'faltou'].includes(st(i)));
  const missed = known.filter((i) => st(i) === 'faltou').length;
  // Em cima da hora: avisou pelo link (o lembrete vai na véspera) ou desmarcou no dia.
  const lastMinute = askedResched.n + saidNo.n + confirmed.late + silent.dayCancel + noReminder.dayCancel;
  return {
    total: items.length,
    pending: confirmed.pending + silent.pending + noReminder.pending,
    reminded: reminded.length,
    confirmRate: pct(reminded.filter((i) => i.reminder.response === 'confirmado').length, reminded.length),
    answeredRate: pct(reminded.filter((i) => i.reminder.response).length, reminded.length),
    confirmed, silent, noReminder, askedResched, saidNo,
    known: known.length, missed, missRate: pct(missed, known.length),
    lastMinute, lastMinuteRate: pct(lastMinute, items.length),
  };
}

/** Pacientes que mais faltam (só quem faltou pelo menos 1 vez; cancelar depois de confirmar conta como falta). */
export function missRanking(items) {
  const by = new Map();
  for (const i of items) {
    const st = effectiveStatus(i);
    if (!i.patient || !['veio', 'faltou'].includes(st)) continue;
    const r = by.get(i.patient.id) || { patient: i.patient, total: 0, missed: 0 };
    r.total += 1;
    if (st === 'faltou') r.missed += 1;
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
