// Regras de envio dos questionários (especificação §4.2) e montagem da mensagem do WhatsApp.
import { daysBetween, todayISO, onlyDigits } from './util.js';

export const DEFAULT_FREQUENCY = 7;
export const PAUSE_BEFORE_CONSULT_DAYS = 3;
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
export function planSends({ patients, sends, soonIds, frequency = DEFAULT_FREQUENCY, today = todayISO() }) {
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
    if (p.status !== 'ativo' || !p.questionnaires_active || !p.last_consult) continue;
    const mine = byPatient.get(p.id) || [];
    const sinceConsult = mine.filter((s) => dateOf(s.created_at) >= p.last_consult);

    // Lembrete: enviado há 3+ dias, sem resposta, link ainda válido, sem lembrete anterior.
    const open = sinceConsult.find((s) => !s.answered_at && !s.expired_at);
    if (open && !open.resent_at && daysBetween(dateOf(open.sent_at), today) >= REMIND_AFTER_DAYS && !soonIds.has(p.id)) {
      reminders.push({ patient: p, send: open });
    }

    const days = daysBetween(p.last_consult, today);
    if (days < frequency) continue;
    const cycleStart = addDays(p.last_consult, Math.floor(days / frequency) * frequency);
    if (sinceConsult.some((s) => dateOf(s.created_at) >= cycleStart)) continue; // já enviado neste ciclo

    const lastTwo = sinceConsult.slice(0, AUTO_PAUSE_UNANSWERED);
    if (lastTwo.length === AUTO_PAUSE_UNANSWERED && lastTwo.every((s) => !s.answered_at)) { autoPaused.push({ patient: p }); continue; }
    if (soonIds.has(p.id)) { soon.push({ patient: p }); continue; }
    if (!whatsappNumber(p.phone)) { noPhone.push({ patient: p }); continue; }
    due.push({ patient: p, cycleStart, previousOpen: open || null });
  }

  const byName = (a, b) => a.patient.name.localeCompare(b.patient.name);
  return { due: due.sort(byName), noPhone: noPhone.sort(byName), autoPaused: autoPaused.sort(byName), soon: soon.sort(byName), reminders: reminders.sort(byName) };
}

/** Pacientes com consulta nos próximos N dias (planilha do Nutrium + agenda já vinculada). */
export function consultSoonIds(patients, agendaPatientIdsByDate, today = todayISO(), n = PAUSE_BEFORE_CONSULT_DAYS) {
  const ids = new Set();
  for (const p of patients) if (p.next_consult && daysBetween(today, p.next_consult) <= n) ids.add(p.id);
  for (const [date, id] of agendaPatientIdsByDate) if (date >= today && daysBetween(today, date) <= n) ids.add(id);
  return ids;
}

export { dateOf };
