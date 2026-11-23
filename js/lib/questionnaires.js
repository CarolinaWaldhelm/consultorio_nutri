// Regras de envio dos questionários (especificação §4.2) e montagem da mensagem do WhatsApp.
import { daysBetween, todayISO, onlyDigits } from './util.js';
import { ACTIVE_DAYS } from './nutrium.js';

export const DEFAULT_FREQUENCY = 7;
/** Data de início dos questionários: antes dela não conta prazo (editável em "Mensagem e frequência"). */
export const DEFAULT_START_DATE = '2026-11-19';
export const PAUSE_BEFORE_CONSULT_DAYS = 0; // não envia no dia da consulta (na véspera, envia)
export const REMIND_AFTER_DAYS = 3;
export const AUTO_PAUSE_UNANSWERED = 2;

export const DEFAULT_MESSAGE = `Oi, [Nome], tudo bem? Aqui é a Anna Carolina, sua nutricionista! 😊

Separei um questionário rápido para acompanharmos juntos como foi a sua semana. Esse registro semanal é super importante para construirmos o seu histórico de evolução, celebrar suas melhoras e mapearmos o que precisamos ajustar ao longo do nosso acompanhamento.

Leva só uns 2 minutinhos para responder:
👉 [Link]

Qualquer dúvida ou dificuldade com o link, é só me chamar por aqui. Um abraço e boa semana! 🌱`;

export const DEFAULT_REMINDER = `Oi, [Nome]! Passando para lembrar do questionário da semana 😊 Leva só uns 2 minutinhos:
👉 [Link]

Um abraço! 🌱`;

export const QUESTION_TYPES = {
  scale: 'Escala (ex.: 0 a 5)',
  text: 'Texto livre',
  choice: 'Múltipla escolha',
};

const dateOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Token aleatório (128 bits) para o link do paciente. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function formLink(token) {
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}q.html?t=${token}`;
}

/** Telefone → formato do WhatsApp (55 + DDD + número). */
export function whatsappNumber(phone) {
  let d = onlyDigits(phone);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 ? d : null;
}

export function fillMessage(template, patientName, link) {
  const first = String(patientName || '').trim().split(/\s+/)[0] || '';
  return template
    .replace(/\[(nome|primeiro nome)\]/gi, first)
    .replace(/\[(link|inserir link do question[aá]rio)\]/gi, link);
}

export function whatsappUrl(phone, text) {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/**
 * Classifica os pacientes para o envio de hoje.
 * patients: linhas de patient_overview; sends: todos os envios; soonIds: pacientes com consulta nos próximos 3 dias.
 */
export function planSends({ patients, sends, soonIds, frequency = DEFAULT_FREQUENCY, startDate = DEFAULT_START_DATE, today = todayISO() }) {
  const byPatient = new Map();
  for (const s of sends) {
    if (!byPatient.has(s.patient_id)) byPatient.set(s.patient_id, []);
    byPatient.get(s.patient_id).push(s);
  }
  for (const list of byPatient.values()) list.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const due = [];
  const noPhone = [];
  const autoPaused = [];
  const soon = [];
  const reminders = [];

  for (const p of patients) {
    if (!p.questionnaires_active || !p.last_consult) continue;
    if (daysBetween(p.last_consult, today) > ACTIVE_DAYS) continue; // mais de 100 dias sem consulta: fora das listas
    const mine = byPatient.get(p.id) || [];
    const sinceConsult = mine.filter((s) => dateOf(s.created_at) >= p.last_consult);

    // Lembrete: enviado há 3+ dias, sem resposta, link ainda válido, sem lembrete anterior.
    const open = sinceConsult.find((s) => !s.answered_at && !s.expired_at);
    if (open && !open.resent_at && daysBetween(dateOf(open.sent_at), today) >= REMIND_AFTER_DAYS && !soonIds.has(p.id)) {
      reminders.push({ patient: p, send: open });
    }

    // Próximo envio: 7 dias depois do último questionário enviado (desde a consulta) ou, se ainda não houve
    // nenhum, 7 dias depois da última consulta.
    // A contagem nunca começa antes da data de início dos questionários.
    const lastSend = sinceConsult[0];
    let anchor = lastSend ? dateOf(lastSend.sent_at) : p.last_consult;
    if (startDate && anchor < startDate) anchor = startDate;
    if (daysBetween(anchor, today) < frequency) continue;

    const lastTwo = sinceConsult.slice(0, AUTO_PAUSE_UNANSWERED);
    if (lastTwo.length === AUTO_PAUSE_UNANSWERED && lastTwo.every((s) => !s.answered_at)) {
      autoPaused.push({ patient: p, sentDates: lastTwo.map((s) => dateOf(s.sent_at)).reverse() });
      continue;
    }
    if (soonIds.has(p.id)) { soon.push({ patient: p }); continue; }
    if (!whatsappNumber(p.phone)) { noPhone.push({ patient: p }); continue; }
    due.push({ patient: p, anchor, fromSend: !!lastSend, previousOpen: open || null });
  }

  // Quem já parou de receber (2 sem resposta) aparece só na lista própria, não nos lembretes.
  const pausedIds = new Set(autoPaused.map((x) => x.patient.id));
  const byName = (a, b) => a.patient.name.localeCompare(b.patient.name);
  return {
    due: due.sort(byName), noPhone: noPhone.sort(byName), autoPaused: autoPaused.sort(byName), soon: soon.sort(byName),
    reminders: reminders.filter((r) => !pausedIds.has(r.patient.id)).sort(byName),
  };
}

/** Pacientes com consulta hoje (N = 0) ou nos próximos N dias (planilha do Nutrium + agenda já vinculada). */
export function consultSoonIds(patients, agendaPatientIdsByDate, today = todayISO(), n = PAUSE_BEFORE_CONSULT_DAYS) {
  const ids = new Set();
  for (const p of patients) if (p.next_consult && daysBetween(today, p.next_consult) <= n) ids.add(p.id);
  for (const [date, id] of agendaPatientIdsByDate) if (date >= today && daysBetween(today, date) <= n) ids.add(id);
  return ids;
}

export { dateOf };

/**
 * Taxa de resposta. Um envio só entra na conta quando já está "fechado": respondido, vencido, ou enviado há
 * 7 dias ou mais. Os ainda em aberto aparecem separados, para não puxar a taxa para baixo à toa.
 * sinceISO: só envios a partir dessa data (ou null para todos).
 */
export function responseStats(sends, { sinceISO = null, today = todayISO() } = {}) {
  const list = sends.filter((s) => !sinceISO || dateOf(s.sent_at) >= sinceISO);
  const closed = list.filter((s) => s.answered_at || s.expired_at || daysBetween(dateOf(s.sent_at), today) >= 7);
  const answered = closed.filter((s) => s.answered_at);
  const withReminder = closed.filter((s) => s.resent_at);
  const afterReminder = withReminder.filter((s) => s.answered_at && s.answered_at > s.resent_at);
  const beforeReminderWindow = answered.filter((s) => !s.resent_at || s.answered_at <= s.resent_at);
  const hours = answered.map((s) => (new Date(s.answered_at) - new Date(s.sent_at)) / 36e5).sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  const median = !hours.length ? null : hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  return {
    total: list.length,
    open: list.length - closed.length,
    closed: closed.length,
    answered: answered.length,
    rate: pct(answered.length, closed.length),
    reminders: withReminder.length,
    answeredAfterReminder: afterReminder.length,
    reminderRate: pct(afterReminder.length, withReminder.length),
    answeredWithoutReminder: beforeReminderWindow.length,
    medianHours: median,
  };
}

/** "em 5 horas", "em 2 dias" */
export function durationLabel(hours) {
  if (hours == null) return '–';
  if (hours < 1) return 'em menos de 1 hora';
  if (hours < 24) return `em ${Math.round(hours)} hora${Math.round(hours) > 1 ? 's' : ''}`;
  const d = Math.round(hours / 24);
  return `em ${d} dia${d > 1 ? 's' : ''}`;
}

// ---------- Lembrete de consulta (véspera) ----------

export const DEFAULT_APPT_MESSAGE = `Oi, [Nome], tudo bem? 😊

Passando para lembrar da sua consulta de nutrição [Quando], [Data], às [Hora].
[Link da consulta]

Qualquer imprevisto, é só me avisar por aqui. Até lá! 🌱`;

const WEEKDAY_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Monta a mensagem: [Nome], [Quando] (amanhã / na segunda-feira…), [Data] (dd/mm), [Hora], [Link da consulta]. */
export function fillApptMessage(template, { name, date, time, link }, today = todayISO()) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const d = new Date(date + 'T12:00:00Z');
  const diff = daysBetween(today, date);
  const when = diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : `na ${WEEKDAY_FULL[d.getUTCDay()]}`.replace('na sábado', 'no sábado').replace('na domingo', 'no domingo');
  const ddmm = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return template
    .replace(/\[(nome|primeiro nome)\]/gi, first)
    .replace(/\[quando\]/gi, when)
    .replace(/\[data\]/gi, ddmm)
    .replace(/\[hora\]/gi, time || '')
    .replace(/[ \t]*\[link da consulta\][ \t]*/gi, link ? `Link da chamada: ${link}` : '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ às \./, '.')
    .trim();
}

/**
 * Consultas de uma data para o lembrete. events: consultas da agenda já vinculadas (ev.patient) ou da planilha.
 * sent: linhas de appointment_reminders. Devolve { toSend, sent, noPhone, unlinked }.
 */
export function apptReminderList({ events, sent }) {
  const sentKeys = new Map(sent.map((r) => [r.event_key, r]));
  const out = { toSend: [], sent: [], noPhone: [], unlinked: [] };
  for (const ev of events) {
    const key = `${ev.uid || ev.key}|${ev.start}`;
    const item = { ...ev, key };
    if (!ev.patient) out.unlinked.push(item);
    else if (sentKeys.has(key)) out.sent.push({ ...item, sentRow: sentKeys.get(key) });
    else if (!whatsappNumber(ev.patient.phone)) out.noPhone.push(item);
    else out.toSend.push(item);
  }
  const byTime = (a, b) => (a.time || '').localeCompare(b.time || '');
  for (const k of Object.keys(out)) out[k].sort(byTime);
  return out;
}
