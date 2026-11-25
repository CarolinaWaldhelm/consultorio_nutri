// Página "Lembretes de consulta": enviar lembretes (com as consultas de hoje), estatísticas e mensagem.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO, nowHM } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, hasEnded } from '../lib/agenda.js';
import { fillApptMessage, DEFAULT_APPT_MESSAGE, DEFAULT_RETURN_MESSAGE, fillReturnMessage } from '../lib/questionnaires.js';
import { attendanceOf, attendanceStats, missRanking, periodStart } from '../lib/appointments.js';
import { syncSnapshot, cancelledEvents } from '../lib/snapshot.js';
import { ErrorBox, Loading, AutoText } from './common.js';
import { ApptRemindersTab } from './apptreminders.js';

async function loadBase() {
  const [patients, settingsRows] = await Promise.all([
    run(supabase.from('patient_overview').select('*').order('name')),
    run(supabase.from('app_settings').select('*')),
  ]);
  return { patients, settings: Object.fromEntries(settingsRows.map((r) => [r.key, r.value])) };
}

/** Consultas que já passaram entre duas datas, com lembrete/resposta e comparecimento. */
async function loadPast(from, patients) {
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
  list = list.filter((ev) => ev.cancelled ? ev.start <= today : hasEnded(ev, today, now));
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
  const [period, setPeriod] = useState('30');
  const [past, setPast] = useState(null);
  // As estatísticas contam só consultas que receberam lembrete, a partir do primeiro lembrete enviado.
  useEffect(() => {
    setPast(null);
    run(supabase.from('appointment_reminders').select('event_date').order('event_date').limit(1))
      .then((first) => {
        if (!first.length) return { items: [], first: null };
        const from = [periodStart(period), first[0].event_date].sort().pop();
        return loadPast(from, data.patients).then((r) => ({ ...r, first: first[0].event_date }));
      })
      .then(setPast).catch(() => setPast({ items: [] }));
  }, [period]);
  const items = useMemo(() => (past ? past.items.filter((i) => i.patient && i.reminder) : []), [past]);
  const st = useMemo(() => attendanceStats(items), [items]);
  const ranking = useMemo(() => missRanking(items), [items]);
  const p = (v) => (v == null ? '–' : `${v}%`);

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📊 Confirmação e comparecimento</h2>
        <div class="seg">${[['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['all', 'Desde o início']].map(([k, l]) => html`<button class=${period === k ? 'on' : ''} onClick=${() => setPeriod(k)}>${l}</button>`)}</div>
      </div>
      ${past?.first && html`<p class="muted small" style="margin-top:0">Contando só as consultas que receberam lembrete, desde o primeiro lembrete (${fmtDate(past.first)}).</p>`}
      ${!past ? html`<${Loading} />` : st.total === 0 ? html`<p class="muted">Nenhuma consulta com lembrete neste período.</p>` : html`
        <div class="stats">
          <div class="stat stat-main"><div class="stat-label">Dos que confirmaram, vieram</div><div class="stat-value">${p(st.confirmed.rate)}</div><div class="stat-sub">${st.confirmed.came} de ${st.confirmed.came + st.confirmed.missed}</div></div>
          <div class="stat"><div class="stat-label">Dos que não responderam, vieram</div><div class="stat-value">${p(st.silent.rate)}</div><div class="stat-sub">${st.silent.came} de ${st.silent.came + st.silent.missed}</div></div>
          <div class="stat"><div class="stat-label">Desmarcaram em cima da hora</div><div class="stat-value">${p(st.lastMinuteRate)}</div><div class="stat-sub">${st.lastMinute} de ${st.total} lembrete(s)</div></div>
          <div class="stat"><div class="stat-label">Faltas no geral</div><div class="stat-value">${p(st.missRate)}</div><div class="stat-sub">${st.missed} de ${st.known} · responderam o lembrete: ${p(st.answeredRate)}</div></div>
        </div>

        <h3 class="calc-step">Como terminou cada grupo</h3>
        <div class="table-wrap"><table class="table outcome-table">
          <thead><tr><th>Resposta ao lembrete</th><th class="num">Consultas</th><th class="num">Vieram</th><th class="num">Faltaram</th><th class="num">Desmarcaram no dia</th><th class="num">Sem marcação</th></tr></thead>
          <tbody>
            ${[['✅ Confirmaram', st.confirmed], ['⏳ Não responderam', st.silent]].filter(([, g]) => g.n).map(([l, g]) => html`
              <tr>
                <td>${l}</td><td class="num">${g.n}</td>
                <td class="num">${g.came}${g.rate != null ? html` <span class="muted small">(${g.rate}%)</span>` : ''}</td>
                <td class="num">${g.missed ? html`<span class="text-danger">${g.missed}</span>` : 0}${g.late ? html`<div class="muted small">${g.late} desmarcou(aram) depois de confirmar</div>` : ''}</td>
                <td class="num">${g.dayCancel}</td>
                <td class="num">${g.pending ? html`<strong>${g.pending}</strong>` : 0}</td>
              </tr>`)}
          </tbody>
        </table></div>
        <p class="muted small">Quem <strong>confirmou</strong> e depois cancelou ou remarcou conta como <strong>falta</strong>. Quem não respondeu e desmarcou no dia aparece em “Desmarcaram no dia”.
          ${st.pending ? html` ${st.pending} consulta(s) ficaram sem “Veio / Faltou” marcado (nem consulta registrada no dia) e ficam fora das porcentagens.` : ''}</p>

        ${(st.askedResched.n > 0 || st.saidNo.n > 0) && html`
          <h3 class="calc-step">Avisaram pelo link do lembrete</h3>
          <div class="table-wrap"><table class="table outcome-table">
            <thead><tr><th>Resposta</th><th class="num">Consultas</th><th class="num">Marcaram de novo</th><th>Ainda sem nova consulta</th></tr></thead>
            <tbody>
              ${[['📅 Pediram para remarcar', st.askedResched], ['❌ Disseram que não iam', st.saidNo]].filter(([, g]) => g.n).map(([l, g]) => html`
                <tr>
                  <td>${l}</td><td class="num">${g.n}</td><td class="num">${g.rebooked}</td>
                  <td>${g.gone.length === 0 ? html`<span class="muted">—</span>` : g.gone.map((i, k) => html`${k ? ', ' : ''}<a href=${'#/paciente/' + i.patient.id}>${i.patient.name}</a>`)}</td>
                </tr>`)}
            </tbody>
          </table></div>
          <p class="muted small">Esses não precisam de “veio / faltou”: o lembrete vai na véspera, então contam como desmarcação em cima da hora. “Ainda sem nova consulta” = não aparece nenhuma consulta depois dessa, nem marcada.</p>`}

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
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const tomorrow = (() => { const d = new Date(todayISO() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const hasConfirm = /\[link de confirma[cç][aã]o\]/i.test(appt);

  async function save() {
    try {
      await run(supabase.from('app_settings').upsert([{ key: 'whatsapp_appt_message', value: appt }, { key: 'whatsapp_return_message', value: ret }]));
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
    </section>`;
}
