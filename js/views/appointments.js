// Página "Lembretes de consulta": enviar lembretes (com as consultas de hoje), estatísticas e mensagem.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO, nowHM } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, hasEnded } from '../lib/agenda.js';
import { fillApptMessage, DEFAULT_APPT_MESSAGE, DEFAULT_RETURN_MESSAGE, fillReturnMessage, DEFAULT_REBOOK_MESSAGE, fillRebookMessage } from '../lib/questionnaires.js';
import { attendanceOf, missRanking, reminderOutcomes } from '../lib/appointments.js';
import { syncSnapshot, cancelledEvents } from '../lib/snapshot.js';
import { ErrorBox, Loading, AutoText, usePeriod } from './common.js';
import { ApptRemindersTab } from './apptreminders.js';

async function loadBase() {
  const [patients, settingsRows] = await Promise.all([
    run(supabase.from('patient_overview').select('*').order('name')),
    run(supabase.from('app_settings').select('*')),
  ]);
  return { patients, settings: Object.fromEntries(settingsRows.map((r) => [r.key, r.value])) };
}

/** Consultas que já passaram entre duas datas, com lembrete/resposta e comparecimento. */
async function loadPast(from, patients, to = null) {
  const today = todayISO();
  const now = nowHM();
  let events = null;
  try { events = await loadAgenda(); } catch { events = null; }
  let list;
  // Datas de consulta de cada paciente (passadas e futuras), para saber quem marcou de novo depois de desmarcar.
  const datesOf = new Map();
  const addDate = (id, d) => { if (id && d) { if (!datesOf.has(id)) datesOf.set(id, []); datesOf.get(id).push(d); } };
  if (events) {
    const far = new Date(); far.setDate(far.getDate() + 180);
    for (const ev of consultationEvents(events, from, far.toISOString().slice(0, 10))) addDate(matchEvent(ev, patients).patient?.id, ev.start);
  }
  for (const p of patients) { addDate(p.id, p.last_consult); addDate(p.id, p.next_consult); }
  if (events) {
    try { await syncSnapshot(events, patients); } catch { /* segue sem */ }
    list = consultationEvents(events, from, today).map((ev) => ({ ...ev, ...matchEvent(ev, patients), key: `${ev.uid}|${ev.start}` }));
    const keys = new Set(list.map((ev) => ev.key));
    const cancelled = await cancelledEvents(from, today, patients).catch(() => []);
    list = [...list, ...cancelled.filter((c) => !keys.has(c.key))];
  } else {
    const rows = await run(supabase.from('nutrium_appointments').select('*').gte('date', from).lte('date', today));
    const byId = new Map(patients.map((p) => [p.id, p]));
    list = rows.map((a) => ({ key: `n${a.id}|${a.date}`, start: a.date, time: a.start_time, endDate: a.date, endTime: a.end_time, patient: byId.get(a.patient_id) || null, patientName: byId.get(a.patient_id)?.name || '' }));
  }
  list = list.filter((ev) => (ev.cancelled ? ev.start <= today : hasEnded(ev, today, now)) && (!to || ev.start <= to));
  const [reminders, attendance, consults] = await Promise.all([
    run(supabase.from('appointment_reminders').select('*').gte('event_date', from)),
    run(supabase.from('appointment_attendance').select('*').gte('event_date', from)),
    run(supabase.from('consultations').select('patient_id, date').gte('date', from)),
  ]);
  const remByKey = new Map(reminders.map((r) => [r.event_key, r]));
  const attByKey = new Map(attendance.map((r) => [r.event_key, r]));
  const consultDays = new Set(consults.map((c) => `${c.patient_id}|${c.date}`));
  for (const c of consults) addDate(c.patient_id, c.date);
  const rebooked = (ev) => !!ev.movedTo || (ev.patient && (datesOf.get(ev.patient.id) || []).some((d) => d > ev.start));
  const items = list.map((ev) => {
    const reminder = remByKey.get(ev.key) || null;
    return { ...ev, reminder, rebooked: rebooked(ev), attendance: attendanceOf(ev, attByKey, consultDays, reminder) };
  })
    .sort((a, b) => (b.start + (b.time || '')).localeCompare(a.start + (a.time || '')));
  return { source: events ? 'google' : 'nutrium', items };
}

export function AppointmentsPage({ initialTab = 'enviar' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(['enviar', 'estatisticas', 'mensagem'].includes(initialTab) ? initialTab : 'enviar');
  const reload = () => loadBase().then(setData).catch(setError);
  useEffect(() => { reload(); }, []);

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const tabs = [['enviar', '📲 Enviar lembretes'], ['estatisticas', '📊 Estatísticas'], ['mensagem', '⚙️ Mensagem']];
  return html`
    <div class="page-head"><h1>Lembretes de consulta</h1></div>
    <div class="seg tabs">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => { setTab(k); reload(); }}>${l}</button>`)}</div>
    ${tab === 'enviar' && html`<${ApptRemindersTab} data=${data} reload=${reload} />`}
    ${tab === 'estatisticas' && html`<${StatsTab} data=${data} />`}
    ${tab === 'mensagem' && html`<${MessageTab} data=${data} reload=${reload} />`}`;
}

// ---------------------------------------------------------------- Estatísticas

function StatsTab({ data }) {
  const today = todayISO();
  const [first, setFirst] = useState(undefined); // data do primeiro lembrete enviado
  useEffect(() => {
    run(supabase.from('appointment_reminders').select('event_date').order('event_date').limit(1))
      .then((r) => setFirst(r[0]?.event_date || null)).catch(() => setFirst(null));
  }, []);
  const [range, picker, pkey] = usePeriod(first || today, today);
  const [past, setPast] = useState(null);
  // As estatísticas contam só consultas que receberam lembrete, a partir do primeiro lembrete enviado.
  useEffect(() => {
    if (first === undefined) return;
    setPast(null);
    if (!first) { setPast({ items: [] }); return; }
    const from = [range.from || first, first].sort().pop();
    loadPast(from, data.patients, range.to).then(setPast).catch(() => setPast({ items: [] }));
  }, [first, pkey]);
  const items = useMemo(() => (past ? past.items.filter((i) => i.patient && i.reminder) : []), [past]);
  const st = useMemo(() => reminderOutcomes(items), [items]);
  const ranking = useMemo(() => missRanking(items), [items]);
  const p = (v) => (v == null ? '–' : `${v}%`);
  const Tile = (label, n, rate, sub, cls = '') => html`
    <div class=${'stat ' + cls}><div class="stat-label">${label}</div><div class="stat-value">${n}</div><div class="stat-sub">${rate != null ? `${rate}% · ` : ''}${sub}</div></div>`;

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📊 Confirmação e comparecimento</h2>
        ${picker}
      </div>
      ${first && html`<p class="muted small" style="margin-top:0">Só as consultas que receberam lembrete, desde o primeiro lembrete (${fmtDate(first)}).</p>`}
      ${!past ? html`<${Loading} />` : st.total === 0 ? html`<p class="muted">Nenhuma consulta com lembrete neste período.</p>` : html`
        <h3 class="calc-step">✅ Confirmaram <span class="muted small">(${st.confirmed.n})</span></h3>
        <div class="stats">
          ${Tile('Confirmou e veio', st.confirmed.came, st.confirmed.cameRate, 'dos que confirmaram', 'stat-good')}
          ${Tile('Confirmou e faltou', st.confirmed.missed, st.confirmed.missedRate, 'inclui quem desmarcou depois de confirmar', 'stat-bad')}
        </div>
        <h3 class="calc-step">⏳ Não responderam ao lembrete <span class="muted small">(${st.silent.n})</span></h3>
        <div class="stats">
          ${Tile('Não respondeu e veio', st.silent.came, st.silent.cameRate, 'dos que não responderam', 'stat-good')}
          ${Tile('Não respondeu e faltou', st.silent.missed, st.silent.missedRate, 'dos que não responderam', 'stat-bad')}
        </div>
        <h3 class="calc-step">Desmarcações e faltas <span class="muted small">(de ${st.total} consulta(s) com lembrete)</span></h3>
        <div class="stats">
          ${Tile('⚡ Desmarcou em cima da hora', st.lastMinute, st.lastMinuteRate, 'cancelou no dia da consulta ou depois de confirmar')}
          ${Tile('✖ Falta sem aviso', st.noShow, st.noShowRate, 'não avisou, não pediu para remarcar, não apareceu', 'stat-bad')}
        </div>
        ${st.pending > 0 && html`<p class="muted small">${st.pending} consulta(s) ficaram sem “Veio / Faltou” marcado e estão fora das porcentagens.</p>`}
        ${ranking.length > 0 && html`
          <h3 class="calc-step">Quem mais falta</h3>
          <p class="muted small" style="margin-top:0">Inclui quem confirmou e depois desmarcou.</p>
          <table class="table">
            <thead><tr><th>Paciente</th><th class="num">Faltas</th><th class="num">Consultas</th></tr></thead>
            <tbody>${ranking.slice(0, 15).map((r) => html`
              <tr><td><a href=${'#/paciente/' + r.patient.id}>${r.patient.name}</a></td><td class="num"><span class="rate rate-low">${r.missed}</span></td><td class="num">${r.total}</td></tr>`)}</tbody>
          </table>`}`}
    </section>`;
}

// ---------------------------------------------------------------- Mensagem

function MessageTab({ data, reload }) {
  const [appt, setAppt] = useState(data.settings.whatsapp_appt_message || DEFAULT_APPT_MESSAGE);
  const [ret, setRet] = useState(data.settings.whatsapp_return_message || DEFAULT_RETURN_MESSAGE);
  const [reb, setReb] = useState(data.settings.whatsapp_rebook_message || DEFAULT_REBOOK_MESSAGE);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const tomorrow = (() => { const d = new Date(todayISO() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const hasConfirm = /\[link de confirma[cç][aã]o\]/i.test(appt);

  async function save() {
    try {
      await run(supabase.from('app_settings').upsert([{ key: 'whatsapp_appt_message', value: appt }, { key: 'whatsapp_return_message', value: ret }, { key: 'whatsapp_rebook_message', value: reb }]));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      reload();
    } catch (err) { setError(err); }
  }

  return html`
    <section class="card">
      <h2 class="card-title">Mensagem do lembrete de consulta</h2>
      <p class="muted small">Use <strong>[Nome]</strong>, <strong>[Quando]</strong> (vira “amanhã”, “hoje” ou “na segunda-feira”), <strong>[Data]</strong>,
        <strong>[Hora]</strong>, <strong>[Link da consulta]</strong> (videochamada do evento; se não houver, a linha some) e
        <strong>[Link de confirmação]</strong> (o link para o paciente confirmar).</p>
      ${!hasConfirm && html`
        <div class="alert">Sem <strong>[Link de confirmação]</strong>, o paciente não recebe o link para confirmar e as estatísticas ficam sem dados.
          <button class="link-btn" onClick=${() => setAppt(appt.trimEnd() + '\n\nPode confirmar sua presença por aqui?\n👉 [Link de confirmação]')}>Incluir o link no final</button></div>`}
      <${AutoText} rows=${8} value=${appt} onInput=${setAppt} />
      <h3 class="calc-step">Como fica</h3>
      <div class="quote">${fillApptMessage(appt, { name: 'Maria Silva', date: tomorrow, time: '14:30', link: 'https://meet.google.com/abc-defg-hij', confirm: 'https://…/c.html?t=…' })}</div>
      <${ErrorBox} error=${error} />
      <div class="actions" style="justify-content:flex-start">
        <button class="btn btn-primary" onClick=${save}>💾 Salvar</button>
        ${saved && html`<span class="muted small">✓ Salvo</span>`}
        <button class="btn btn-ghost btn-sm" onClick=${() => setAppt(DEFAULT_APPT_MESSAGE)}>Voltar ao texto original</button>
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">Mensagem de retorno (sem retorno há mais de 50 dias)</h2>
      <p class="muted small">Usada nos botões “Copiar mensagem” e “WhatsApp” da tabela de sem retorno, na tela inicial.
        Use <strong>[Nome]</strong> para o primeiro nome e <strong>[Dias]</strong> para os dias desde a última consulta.</p>
      <${AutoText} rows=${7} value=${ret} onInput=${setRet} />
      <h3 class="calc-step">Como fica</h3>
      <div class="quote">${fillReturnMessage(ret, 'Maria Silva', 63)}</div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn btn-primary" onClick=${save}>💾 Salvar</button>
        ${saved && html`<span class="muted small">✓ Salvo</span>`}
        <button class="btn btn-ghost btn-sm" onClick=${() => setRet(DEFAULT_RETURN_MESSAGE)}>Voltar ao texto original</button>
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">Mensagem para quem cancelou</h2>
      <p class="muted small">Usada no botão “📋 Mensagem para remarcar” das consultas canceladas, em “Consultas de hoje”. Use <strong>[Nome]</strong> para o primeiro nome e
        <strong>[Data]</strong> para quando era a consulta: vira sozinho “de hoje”, “de amanhã”, “de ontem” ou “do dia 25/11”.</p>
      <${AutoText} rows=${6} value=${reb} onInput=${setReb} />
      <h3 class="calc-step">Como fica</h3>
      <div class="quote">${fillRebookMessage(reb, 'Maria Silva', todayISO())}</div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn btn-primary" onClick=${save}>💾 Salvar</button>
        ${saved && html`<span class="muted small">✓ Salvo</span>`}
        <button class="btn btn-ghost btn-sm" onClick=${() => setReb(DEFAULT_REBOOK_MESSAGE)}>Voltar ao texto original</button>
      </div>
    </section>`;
}
