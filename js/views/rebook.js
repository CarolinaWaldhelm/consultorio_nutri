// Quadro "Desmarcaram e não remarcaram": quem cancelou (ou avisou pelo lembrete que não vai) e ainda não tem nova consulta.
import { html, useState } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtShort, todayISO, daysBetween } from '../lib/util.js';
import { whatsappUrl, whatsappNumber, fillRebookMessage, DEFAULT_REBOOK_MESSAGE } from '../lib/questionnaires.js';
import { copyOrShow } from '../lib/prompts.js';
import { CopyName, usePaged } from './common.js';

const KEEP_DAYS = 30; // some da lista 30 dias depois da consulta desmarcada

/**
 * Monta a lista. cancelled: consultas que sumiram da agenda; saidNo: lembretes respondidos "não vou"
 * ({ event_key, event_date, patient_id }); activeEvents: consultas ainda na agenda (com .patient);
 * patients: patient_overview; lastMinute(ev): true se foi em cima da hora; dismissed: Set de chaves tiradas da lista.
 */
export function rebookList({ cancelled, saidNo, activeEvents, patients, isLost, dismissed, lastMinute, today = todayISO() }) {
  const byId = new Map(patients.map((p) => [p.id, p]));
  const activeByPatient = new Map();
  for (const ev of activeEvents) {
    if (!ev.patient) continue;
    if (!activeByPatient.has(ev.patient.id)) activeByPatient.set(ev.patient.id, []);
    activeByPatient.get(ev.patient.id).push(ev);
  }
  const items = [];
  for (const ev of cancelled) if (ev.patient) items.push({ key: ev.key, date: ev.start, patient: ev.patient, kind: 'cancelada', lastMinute: lastMinute(ev), movedTo: ev.movedTo });
  for (const r of saidNo) {
    const p = byId.get(r.patient_id);
    if (p && !items.some((i) => i.key === r.event_key)) items.push({ key: r.event_key, date: r.event_date, patient: p, kind: 'nao_vai', lastMinute: false });
  }
  const rebooked = (i) => !!i.movedTo
    || (i.patient.last_consult && i.patient.last_consult > i.date)
    || (i.patient.next_consult && i.patient.next_consult > i.date)
    || (activeByPatient.get(i.patient.id) || []).some((ev) => ev.start > i.date || (ev.start >= today && `${ev.uid}|${ev.start}` !== i.key && ev.start !== i.date));
  const best = new Map();
  for (const i of items) {
    if (daysBetween(i.date, today) > KEEP_DAYS || dismissed.has(i.key) || isLost(i.patient) || rebooked(i)) continue;
    const prev = best.get(i.patient.id);
    if (!prev || i.date > prev.date) best.set(i.patient.id, i);
  }
  return [...best.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function RebookCard({ items, message, onSent, onDismiss }) {
  const [copied, setCopied] = useState(null);
  const today = todayISO();
  const [shown, more] = usePaged(items, 'rebook');
  if (!items.length) return null;

  async function send(i, via) {
    const text = fillRebookMessage(message || DEFAULT_REBOOK_MESSAGE, i.patient.name, i.date);
    if (via === 'whatsapp') window.open(whatsappUrl(i.patient.phone, text), '_blank');
    else {
      await copyOrShow(text);
      setCopied(i.key);
      setTimeout(() => setCopied((x) => (x === i.key ? null : x)), 4000);
    }
    await run(supabase.from('patients').update({ return_msg_at: today }).eq('id', i.patient.id)).catch(() => {});
    onSent(i.patient.id, today);
  }

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">🔄 Desmarcaram e não remarcaram <span class="muted small">(${items.length})</span></h2>
        <a class="btn btn-sm btn-ghost" href="#/lembretes/mensagem" title="Mudar o texto da mensagem (vale para todos)">✏️ Editar mensagem</a>
      </div>
      <p class="muted small" style="margin-top:0">Cancelaram (ou avisaram pelo lembrete que não vão) e ainda não têm nova consulta. Saem da lista sozinhos ao remarcar, ou ${KEEP_DAYS} dias depois.</p>
      <table class="table">
        <thead><tr><th>Paciente</th><th>Consulta</th><th>Contato</th><th></th></tr></thead>
        <tbody>
          ${shown.map((i) => {
            const sentAt = i.patient.return_msg_at && i.patient.return_msg_at >= i.date ? i.patient.return_msg_at : null;
            return html`
              <tr>
                <td><a href=${'#/paciente/' + i.patient.id}>${i.patient.name}</a><${CopyName} name=${i.patient.name} /></td>
                <td>${fmtShort(i.date)}${i.lastMinute ? ' ⚡' : ''}<div class="muted small">${i.kind === 'nao_vai' ? '📩 avisou pelo lembrete' : i.lastMinute ? 'cancelou em cima da hora' : 'cancelada'}</div></td>
                <td>${sentAt ? html`✉️ ${fmtShort(sentAt)}` : html`<span class="muted small">nenhum ainda</span>`}</td>
                <td class="actions-cell"><div class="row-actions">
                  <button class="btn btn-sm" title="Copia a mensagem para colar no chat da Nutrium" onClick=${() => send(i, 'copy')}>${copied === i.key ? '✓ Copiada' : '📋 Copiar mensagem'}</button>
                  <button class="btn btn-sm" disabled=${!whatsappNumber(i.patient.phone)} title=${whatsappNumber(i.patient.phone) ? 'Abre o WhatsApp com a mensagem pronta' : 'Sem telefone no cadastro'} onClick=${() => send(i, 'whatsapp')}>📲 WhatsApp</button>
                  <button class="btn btn-sm btn-ghost" title="Tira este paciente desta lista" onClick=${() => onDismiss(i.key)}>Tirar da lista</button>
                </div></td>
              </tr>`;
          })}
        </tbody>
      </table>
      ${more}
    </section>`;
}
