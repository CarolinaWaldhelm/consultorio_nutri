// Lembrete de consulta pelo WhatsApp: lista quem tem consulta na data escolhida (padrão: amanhã),
// para conferir, selecionar e enviar um por um, igual aos questionários. Guarda quem já recebeu.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO, nowHM } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, hasEnded } from '../lib/agenda.js';
import { apptReminderList, fillApptMessage, whatsappUrl, whatsappNumber, newToken, confirmLink, DEFAULT_APPT_MESSAGE } from '../lib/questionnaires.js';
import { RESPONSE_LABEL, prefsText, attendanceOf, STATUS_LABEL, CANCEL_REASONS } from '../lib/appointments.js';
import { syncSnapshot, cancelledEvents } from '../lib/snapshot.js';
import { ErrorBox, Loading } from './common.js';

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function plusDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const weekday = (iso) => WEEKDAY[new Date(iso + 'T12:00:00Z').getUTCDay()];

/** Consultas de uma data: agenda do Google (vinculadas aos pacientes) ou, sem agenda, planilha do Nutrium. */
export async function loadDayAppointments(date, patients) {
  let events = null;
  try { events = await loadAgenda(); } catch { events = null; }
  if (events) {
    return { source: 'google', list: consultationEvents(events, date, date).map((ev) => ({ ...ev, ...matchEvent(ev, patients) })) };
  }
  const rows = await run(supabase.from('nutrium_appointments').select('*').eq('date', date));
  const byId = new Map(patients.map((p) => [p.id, p]));
  return {
    source: 'nutrium',
    list: rows.map((a) => ({ key: 'n' + a.id, start: a.date, time: a.start_time, patient: byId.get(a.patient_id) || null, patientName: byId.get(a.patient_id)?.name || '' })),
  };
}

export function ApptRemindersTab({ data, reload }) {
  const today = todayISO();
  const [date, setDate] = useState(plusDays(today, 1));
  const [day, setDay] = useState(null); // { source, list, sent }
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [queue, setQueue] = useState(null);
  const [phones, setPhones] = useState({});
  const seen = useRef(new Set());
  const template = data.settings.whatsapp_appt_message || DEFAULT_APPT_MESSAGE;

  async function load() {
    setError(null);
    try {
      const [{ source, list }, sent] = await Promise.all([
        loadDayAppointments(date, data.patients),
        run(supabase.from('appointment_reminders').select('*').eq('event_date', date)),
      ]);
      setDay({ source, list, sent });
    } catch (err) {
      setError(err);
      setDay({ source: null, list: [], sent: [] });
    }
  }
  useEffect(() => { setDay(null); setQueue(null); seen.current = new Set(); setSelected(new Set()); load(); }, [date, data]);

  const groups = useMemo(() => (day ? apptReminderList({ events: day.list, sent: day.sent }) : null), [day]);
  // Quem entra na lista já vem marcado (desmarcados por você continuam desmarcados).
  useEffect(() => {
    if (!groups) return;
    const fresh = groups.toSend.map((e) => e.key).filter((k) => !seen.current.has(k));
    if (fresh.length) { fresh.forEach((k) => seen.current.add(k)); setSelected((s) => new Set([...s, ...fresh])); }
  }, [groups]);

  if (!day || !groups) return html`<${Loading} text="Lendo as consultas…" />`;
  const byKey = new Map(groups.toSend.map((e) => [e.key, e]));
  const selCount = groups.toSend.filter((e) => selected.has(e.key)).length;
  const allOn = groups.toSend.length > 0 && selCount === groups.toSend.length;
  const toggle = (k) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function sendOne(ev) {
    const win = window.open('', '_blank');
    try {
      const token = newToken();
      await run(supabase.from('appointment_reminders').insert({ patient_id: ev.patient.id, event_key: ev.key, event_date: ev.start, event_time: ev.time || null, token }));
      const text = fillApptMessage(template, { name: ev.patient.name, date: ev.start, time: ev.time, link: ev.meet, confirm: confirmLink(token) }, today);
      const url = whatsappUrl(ev.patient.phone, text);
      if (win) win.location.href = url; else window.open(url, '_blank');
      await load();
      return true;
    } catch (err) {
      win?.close();
      setError(err);
      return false;
    }
  }
  async function queueSend() {
    const ev = byKey.get(queue.ids[queue.pos]);
    if (!ev || (await sendOne(ev))) setQueue((q) => (q.pos + 1 >= q.ids.length ? null : { ...q, pos: q.pos + 1 }));
  }
  const queueSkip = () => setQueue((q) => (q.pos + 1 >= q.ids.length ? null : { ...q, pos: q.pos + 1 }));
  async function undo(row) {
    if (!confirm('Desmarcar este lembrete como enviado? Ele volta para a lista de envio.')) return;
    await run(supabase.from('appointment_reminders').delete().eq('id', row.id));
    load();
  }
  async function savePhone(ev) {
    const v = (phones[ev.key] || '').trim();
    if (!whatsappNumber(v)) { setError(new Error(`Telefone de ${ev.patient.name} incompleto: use DDD + número (ex.: 11 98765-4321).`)); return; }
    await run(supabase.from('patients').update({ phone: v }).eq('id', ev.patient.id));
    reload();
  }

  const current = queue && byKey.get(queue.ids[queue.pos]);
  const total = groups.toSend.length + groups.sent.length + groups.noPhone.length + groups.unlinked.length;

  return html`
    <${ErrorBox} error=${error} />
    <${TodayCard} data=${data} />
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📲 Enviar lembretes</h2>
        <div class="row-actions">
          <button class=${'btn btn-sm' + (date === plusDays(today, 1) ? ' btn-primary' : '')} onClick=${() => setDate(plusDays(today, 1))}>Amanhã</button>
          <input type="date" class="date-pick" value=${date} min=${today} onInput=${(e) => e.target.value && setDate(e.target.value)} />
        </div>
      </div>
      <p class="muted small" style="margin-top:0">
        Consultas de <strong>${weekday(date)}, ${fmtDate(date)}</strong>
        ${day.source === 'google' ? ' (Google Agenda)' : day.source === 'nutrium' ? ' (planilha do Nutrium: conecte a agenda em Configurações para ver as marcações mais recentes)' : ''}.
        Na sexta, escolha a data de segunda para lembrar as consultas do início da semana.
        A mensagem leva um link para o paciente confirmar; a resposta aparece aqui sozinha.
      </p>
      ${total === 0 && html`<p class="muted">Nenhuma consulta nesta data.</p>`}

      ${current && html`
        <div class="send-queue card">
          <div class="muted small">Enviando ${queue.pos + 1} de ${queue.ids.length}</div>
          <h2>${current.patient.name} <span class="muted small">· ${current.time || ''}</span></h2>
          <div class="row-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" onClick=${queueSend}>📲 Abrir WhatsApp de ${current.patient.name.split(' ')[0]}</button>
            <button class="btn btn-ghost" onClick=${queueSkip}>Pular</button>
            <button class="btn btn-ghost" onClick=${() => setQueue(null)}>Parar</button>
          </div>
        </div>`}

      ${groups.toSend.length > 0 && html`
        <div class="row-actions" style="justify-content:flex-start;margin:8px 0">
          <button class="btn btn-sm" onClick=${() => setSelected(new Set(groups.toSend.map((e) => e.key)))}>☑ Marcar todos</button>
          <button class="btn btn-sm" disabled=${!selCount} onClick=${() => setSelected(new Set())}>☐ Desmarcar todos</button>
          <span class="spacer"></span>
          <button class="btn btn-primary" disabled=${!selCount || !!queue}
            onClick=${() => setQueue({ ids: groups.toSend.filter((e) => selected.has(e.key)).map((e) => e.key), pos: 0 })}>📲 Enviar para os selecionados (${selCount})</button>
        </div>`}

      ${(groups.toSend.length > 0 || groups.sent.length > 0) && html`
        <table class="table">
          <thead><tr>
            <th style="width:36px"><input type="checkbox" aria-label="Marcar ou desmarcar todos" checked=${allOn} disabled=${!groups.toSend.length}
              onChange=${() => setSelected(allOn ? new Set() : new Set(groups.toSend.map((e) => e.key)))} /></th>
            <th>Horário</th><th>Paciente</th><th>Telefone</th><th>Resposta</th><th></th>
          </tr></thead>
          <tbody>
            ${groups.toSend.map((ev) => html`
              <tr>
                <td><input type="checkbox" aria-label=${'Selecionar ' + ev.patient.name} checked=${selected.has(ev.key)} onChange=${() => toggle(ev.key)} /></td>
                <td><strong>${ev.time || '—'}</strong></td>
                <td><a href=${'#/paciente/' + ev.patient.id}>${ev.patient.name}</a>${ev.meet ? html` <span class="badge" title=${ev.meet}>🎥 link</span>` : ''}</td>
                <td class="muted small">${ev.patient.phone}</td>
                <td class="muted small">—</td>
                <td></td>
              </tr>`)}
            ${groups.sent.map((ev) => html`
              <tr class="row-sent">
                <td><input type="checkbox" checked disabled aria-label="Já enviado" /></td>
                <td>${ev.time || '—'}</td>
                <td>${ev.patient.name}</td>
                <td class="muted small">${ev.patient.phone || ''}</td>
                <td class=${'resp resp-' + (ev.sentRow.response || 'none')} title=${ev.sentRow.response_note || ''}>
                  ${RESPONSE_LABEL[ev.sentRow.response || null]}
                  ${ev.sentRow.response === 'remarcar' && ev.sentRow.response_prefs && html`<div class="resp-prefs">🗓️ ${prefsText(ev.sentRow.response_prefs)}</div>`}
                  ${ev.sentRow.response_note ? html`<div class="muted small">“${ev.sentRow.response_note}”</div>` : ''}
                </td>
                <td class="row-actions"><span class="badge badge-green">✓ Enviado</span><button class="btn btn-sm btn-ghost" onClick=${() => undo(ev.sentRow)}>Desfazer</button></td>
              </tr>`)}
          </tbody>
        </table>`}
    </section>

    ${groups.noPhone.length > 0 && html`
      <section class="card phone-request">
        <h2 class="card-title">📞 Sem telefone <span class="muted small">(${groups.noPhone.length} com consulta nesta data)</span></h2>
        <p class="muted small">Digite o WhatsApp com DDD e salve: o paciente entra na lista de envio acima.</p>
        <table class="table">
          <tbody>
            ${groups.noPhone.map((ev) => html`
              <tr>
                <td>${ev.time || '—'}</td>
                <td><a href=${'#/paciente/' + ev.patient.id}>${ev.patient.name}</a></td>
                <td><input type="tel" class="phone-input" placeholder="11 98765-4321" value=${phones[ev.key] || ''}
                  onInput=${(e) => setPhones({ ...phones, [ev.key]: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && savePhone(ev)} /></td>
                <td class="row-actions"><button class="btn btn-sm btn-primary" disabled=${!(phones[ev.key] || '').trim()} onClick=${() => savePhone(ev)}>Salvar</button></td>
              </tr>`)}
          </tbody>
        </table>
      </section>`}

    ${groups.unlinked.length > 0 && html`
      <section class="card">
        <h2 class="card-title">⚠️ Consultas não vinculadas <span class="muted small">(${groups.unlinked.length})</span></h2>
        <p class="muted small">O sistema não reconheceu estes pacientes. Na tela inicial, clique na consulta no calendário para vincular (ou criar o cadastro);
          depois eles aparecem aqui para o lembrete.</p>
        <ul>${groups.unlinked.map((ev) => html`<li>${ev.time || ''} — ${ev.patientName}</li>`)}</ul>
      </section>`}`;
}

/** Consultas de hoje e a resposta de cada paciente ao lembrete. */
function TodayCard({ data }) {
  const today = todayISO();
  const [items, setItems] = useState(null);
  const [now, setNow] = useState(nowHM());
  const [err, setErr] = useState(null);
  const load = async () => {
    // Atualiza a fotografia da agenda antes, para saber quais consultas de hoje foram canceladas.
    try { const evs = await loadAgenda(); if (evs) await syncSnapshot(evs, data.patients, { force: true }); } catch { /* segue sem */ }
    return loadNow();
  };
  const loadNow = () => Promise.all([
    loadDayAppointments(today, data.patients),
    cancelledEvents(today, today, data.patients).catch(() => []),
    run(supabase.from('appointment_reminders').select('*').eq('event_date', today)),
    run(supabase.from('appointment_attendance').select('*').eq('event_date', today)),
    run(supabase.from('consultations').select('patient_id, date').eq('date', today)),
  ]).then(([{ list: active }, cancelled, rems, att, consults]) => {
    const activeKeys = new Set(active.map((ev) => `${ev.uid || ev.key}|${ev.start}`));
    const list = [...active, ...cancelled.filter((c) => !activeKeys.has(c.key))];
    const byKey = new Map(rems.map((r) => [r.event_key, r]));
    const attByKey = new Map(att.map((r) => [r.event_key, r]));
    const consultDays = new Set(consults.map((c) => `${c.patient_id}|${c.date}`));
    setItems(list.map((ev) => ({ ...ev, key: ev.cancelled ? ev.key : `${ev.uid || ev.key}|${ev.start}` }))
      .map((ev) => ({ ...ev, reminder: byKey.get(ev.key) || null, attendance: attendanceOf(ev, attByKey, consultDays) }))
      .sort((a, b) => (a.time || '').localeCompare(b.time || '')));
  }).catch(() => setItems([]));
  useEffect(() => {
    load();
    const t = setInterval(() => setNow(nowHM()), 60 * 1000);
    return () => clearInterval(t);
  }, [data]);

  // Comparecimento ao vivo: vai direto para as estatísticas (mesma tabela da aba "Confirmar comparecimento").
  async function mark(ev, status) {
    setErr(null);
    try {
      if (ev.attendance.row) await run(supabase.from('appointment_attendance').update({ status, marked_at: new Date().toISOString() }).eq('id', ev.attendance.row.id));
      else await run(supabase.from('appointment_attendance').insert({ patient_id: ev.patient.id, event_key: ev.key, event_date: ev.start, event_time: ev.time || null, status }));
      await loadNow();
    } catch (e) { setErr(e); }
  }
  async function clear(ev) {
    await run(supabase.from('appointment_attendance').delete().eq('id', ev.attendance.row.id));
    loadNow();
  }

  if (!items) return html`<section class="card"><h2 class="card-title">📋 Consultas de hoje</h2><p class="muted">Carregando…</p></section>`;
  const count = (r) => items.filter((i) => (r === 'none' ? !i.reminder : i.reminder && (i.reminder.response || null) === r)).length;
  const summary = [['confirmado', '✅ confirmaram'], ['remarcar', '📅 querem remarcar'], ['nao_vai', '❌ não vão'], [null, '⏳ sem resposta'], ['none', 'sem lembrete']]
    .map(([k, l]) => [count(k), l]).filter(([n]) => n > 0);
  const came = items.filter((i) => i.attendance?.status === 'veio').length;
  const missed = items.filter((i) => i.attendance?.status === 'faltou').length;
  const cancelledN = items.filter((i) => i.cancelled).length;

  return html`
    <section class="card today-card">
      <h2 class="card-title">📋 Consultas de hoje <span class="muted small">(${weekday(today)}, ${fmtDate(today)} · ${items.length})</span></h2>
      ${items.length === 0 && html`<p class="muted">Nenhuma consulta hoje.</p>`}
      ${summary.length > 0 && html`<p class="today-summary">${summary.map(([n, l], i) => html`${i ? ' · ' : ''}<strong>${n}</strong> ${l}`)}
        ${(came || missed) ? html`<span class="muted"> — compareceram ${came}, não apareceram ${missed}</span>` : ''}
        ${cancelledN ? html`<span class="muted"> · 🚫 ${cancelledN} cancelada(s)</span>` : ''}</p>`}
      <${ErrorBox} error=${err} />
      ${items.length > 0 && html`
        <table class="table">
          <thead><tr><th>Horário</th><th>Paciente</th><th>Confirmação</th><th>Compareceu?</th></tr></thead>
          <tbody>
            ${items.map((ev) => {
              const r = ev.reminder;
              const past = hasEnded(ev, today, now);
              return html`
                <tr class=${past ? 'row-sent' : ''}>
                  <td><strong class=${ev.cancelled ? 'strike' : ''}>${ev.time || '—'}</strong>${ev.cancelled
                    ? html` <span class="badge badge-red">🚫 Cancelada</span>${ev.movedTo ? html` <span class="badge badge-blue">remarcada para ${fmtDate(ev.movedTo).slice(0, 5)}</span>` : ''}`
                    : past ? html` <span class="muted small">(já passou)</span>` : ''}</td>
                  <td>${ev.patient ? html`<a href=${'#/paciente/' + ev.patient.id}>${ev.patient.name}</a>` : html`${ev.patientName} <span class="badge badge-warn">não vinculado</span>`}</td>
                  <td class=${'resp resp-' + (r?.response || 'none')}>
                    ${r ? RESPONSE_LABEL[r.response || null] : html`<span class="muted">sem lembrete enviado</span>`}
                    ${r?.response === 'remarcar' && r.response_prefs && html`<div class="resp-prefs">🗓️ ${prefsText(r.response_prefs)}</div>`}
                    ${r?.response_note ? html`<div class="muted small">“${r.response_note}”</div>` : ''}
                  </td>
                  <td class="attend-cell">
                    ${!ev.patient ? html`<span class="muted small">vincule para marcar</span>` : ev.cancelled ? html`
                      <div class="muted small">Motivo do cancelamento:</div>
                      ${CANCEL_REASONS.map(([k, l]) => html`
                        <button class=${'btn btn-sm' + (ev.attendance.status === k ? ' btn-primary' : '')} onClick=${() => mark(ev, k)}>${ev.attendance.status === k ? '✓ ' : ''}${l}</button>`)}
                      ${ev.attendance.row && html`<button class="btn btn-sm btn-ghost" onClick=${() => clear(ev)}>Limpar</button>`}
                      ${ev.attendance.auto && ev.attendance.status === 'remarcou' && html`<div class="muted small">(remarcada: detectado pela agenda)</div>`}` : html`
                      ${ev.attendance.status === 'veio' && html`<span class="badge badge-green">✔ Veio${ev.attendance.auto ? ' (consulta registrada)' : ''}</span>`}
                      ${ev.attendance.status === 'faltou' && html`<span class="badge badge-red">✖ Faltou</span>`}
                      ${ev.attendance.status !== 'veio' && html`<button class="btn btn-sm" onClick=${() => mark(ev, 'veio')}>✔ Veio</button>`}
                      ${ev.attendance.status !== 'faltou' && html`<button class="btn btn-sm" onClick=${() => mark(ev, 'faltou')}>✖ Faltou</button>`}
                      ${ev.attendance.row && html`<button class="btn btn-sm btn-ghost" title="Apagar a marcação" onClick=${() => clear(ev)}>Limpar</button>`}`}
                  </td>
                </tr>`;
            })}
          </tbody>
        </table>`}
    </section>`;
}
