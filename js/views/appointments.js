// Página "Lembretes de consulta": enviar lembretes, confirmar comparecimento, estatísticas e mensagem.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO, nowHM } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, hasEnded } from '../lib/agenda.js';
import { fillApptMessage, DEFAULT_APPT_MESSAGE } from '../lib/questionnaires.js';
import { RESPONSE_LABEL, attendanceOf, attendanceStats, missRanking, periodStart } from '../lib/appointments.js';
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
  if (events) {
    list = consultationEvents(events, from, today).map((ev) => ({ ...ev, ...matchEvent(ev, patients), key: `${ev.uid}|${ev.start}` }));
  } else {
    const rows = await run(supabase.from('nutrium_appointments').select('*').gte('date', from).lte('date', today));
    const byId = new Map(patients.map((p) => [p.id, p]));
    list = rows.map((a) => ({ key: `n${a.id}|${a.date}`, start: a.date, time: a.start_time, endDate: a.date, endTime: a.end_time, patient: byId.get(a.patient_id) || null, patientName: byId.get(a.patient_id)?.name || '' }));
  }
  list = list.filter((ev) => hasEnded(ev, today, now));
  const [reminders, attendance, consults] = await Promise.all([
    run(supabase.from('appointment_reminders').select('*').gte('event_date', from)),
    run(supabase.from('appointment_attendance').select('*').gte('event_date', from)),
    run(supabase.from('consultations').select('patient_id, date').gte('date', from)),
  ]);
  const remByKey = new Map(reminders.map((r) => [r.event_key, r]));
  const attByKey = new Map(attendance.map((r) => [r.event_key, r]));
  const consultDays = new Set(consults.map((c) => `${c.patient_id}|${c.date}`));
  const items = list.map((ev) => ({ ...ev, reminder: remByKey.get(ev.key) || null, attendance: attendanceOf(ev, attByKey, consultDays) }))
    .sort((a, b) => (b.start + (b.time || '')).localeCompare(a.start + (a.time || '')));
  return { source: events ? 'google' : 'nutrium', items };
}

export function AppointmentsPage({ initialTab = 'enviar' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const reload = () => loadBase().then(setData).catch(setError);
  useEffect(() => { reload(); }, []);

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const tabs = [['enviar', '📲 Enviar lembretes'], ['comparecimento', '✔ Confirmar comparecimento'], ['estatisticas', '📊 Estatísticas'], ['mensagem', '⚙️ Mensagem']];
  return html`
    <div class="page-head"><h1>Lembretes de consulta</h1></div>
    <div class="seg tabs">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => { setTab(k); reload(); }}>${l}</button>`)}</div>
    ${tab === 'enviar' && html`<${ApptRemindersTab} data=${data} reload=${reload} />`}
    ${tab === 'comparecimento' && html`<${AttendanceTab} data=${data} />`}
    ${tab === 'estatisticas' && html`<${StatsTab} data=${data} />`}
    ${tab === 'mensagem' && html`<${MessageTab} data=${data} reload=${reload} />`}`;
}

// ---------------------------------------------------------------- Comparecimento

function AttendanceTab({ data }) {
  const [days, setDays] = useState('14');
  const [past, setPast] = useState(null);
  const [error, setError] = useState(null);
  const load = () => loadPast(periodStart(days), data.patients).then(setPast).catch((err) => { setError(err); setPast({ items: [] }); });
  useEffect(() => { setPast(null); load(); }, [days]);

  async function mark(item, status) {
    try {
      if (item.attendance.row) await run(supabase.from('appointment_attendance').update({ status, marked_at: new Date().toISOString() }).eq('id', item.attendance.row.id));
      else await run(supabase.from('appointment_attendance').insert({ patient_id: item.patient.id, event_key: item.key, event_date: item.start, event_time: item.time || null, status }));
      load();
    } catch (err) { setError(err); }
  }
  async function clear(item) {
    await run(supabase.from('appointment_attendance').delete().eq('id', item.attendance.row.id));
    load();
  }

  if (!past) return html`<${Loading} text="Lendo as consultas…" />`;
  const linked = past.items.filter((i) => i.patient);
  const pending = linked.filter((i) => !i.attendance.status);
  const marked = linked.filter((i) => i.attendance.status);
  const unlinked = past.items.filter((i) => !i.patient);

  const Row = (i) => html`
    <tr>
      <td>${fmtDate(i.start).slice(0, 5)} <span class="muted small">${i.time || ''}</span></td>
      <td><a href=${'#/paciente/' + i.patient.id}>${i.patient.name}</a></td>
      <td class="muted small">${i.reminder ? RESPONSE_LABEL[i.reminder.response || null] : 'sem lembrete'}</td>
      <td class="row-actions">
        ${i.attendance.status === 'veio' && html`<span class="badge badge-green">✔ Veio${i.attendance.auto ? ' (consulta registrada)' : ''}</span>`}
        ${i.attendance.status === 'faltou' && html`<span class="badge badge-red">✖ Faltou</span>`}
        ${i.attendance.status !== 'veio' && html`<button class="btn btn-sm" onClick=${() => mark(i, 'veio')}>✔ Veio</button>`}
        ${i.attendance.status !== 'faltou' && html`<button class="btn btn-sm" onClick=${() => mark(i, 'faltou')}>✖ Faltou</button>`}
        ${i.attendance.row && html`<button class="btn btn-sm btn-ghost" title="Apagar a marcação" onClick=${() => clear(i)}>Limpar</button>`}
      </td>
    </tr>`;

  return html`
    <${ErrorBox} error=${error} />
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">A confirmar <span class="muted small">(${pending.length})</span></h2>
        <div class="seg">${[['7', '7 dias'], ['14', '14 dias'], ['30', '30 dias'], ['90', '90 dias']].map(([k, l]) => html`<button class=${days === k ? 'on' : ''} onClick=${() => setDays(k)}>${l}</button>`)}</div>
      </div>
      <p class="muted small" style="margin-top:0">Consultas que já passaram. Quando você usa “Iniciar consulta” na ficha, o comparecimento é marcado sozinho; aqui ficam as que faltam marcar.</p>
      ${pending.length === 0 ? html`<p class="muted">Tudo marcado. 🎉</p>` : html`
        <table class="table"><thead><tr><th>Quando</th><th>Paciente</th><th>Confirmação</th><th></th></tr></thead><tbody>${pending.map(Row)}</tbody></table>`}
    </section>
    ${marked.length > 0 && html`
      <section class="card">
        <h2 class="card-title">Já marcadas <span class="muted small">(${marked.length})</span></h2>
        <table class="table"><thead><tr><th>Quando</th><th>Paciente</th><th>Confirmação</th><th></th></tr></thead><tbody>${marked.map(Row)}</tbody></table>
      </section>`}
    ${unlinked.length > 0 && html`<p class="muted small">⚠️ ${unlinked.length} consulta(s) não vinculada(s) a paciente ficaram de fora (vincule pelo calendário da tela inicial).</p>`}`;
}

// ---------------------------------------------------------------- Estatísticas

function StatsTab({ data }) {
  const [period, setPeriod] = useState('30');
  const [past, setPast] = useState(null);
  useEffect(() => { setPast(null); loadPast(periodStart(period), data.patients).then(setPast).catch(() => setPast({ items: [] })); }, [period]);
  const items = useMemo(() => (past ? past.items.filter((i) => i.patient) : []), [past]);
  const st = useMemo(() => attendanceStats(items), [items]);
  const ranking = useMemo(() => missRanking(items), [items]);
  const p = (v) => (v == null ? '–' : `${v}%`);

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📊 Confirmação e comparecimento</h2>
        <div class="seg">${[['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['all', 'Desde o início']].map(([k, l]) => html`<button class=${period === k ? 'on' : ''} onClick=${() => setPeriod(k)}>${l}</button>`)}</div>
      </div>
      ${!past ? html`<${Loading} />` : st.total === 0 ? html`<p class="muted">Nenhuma consulta neste período.</p>` : html`
        <div class="stats">
          <div class="stat stat-main"><div class="stat-label">Dos que confirmaram, vieram</div><div class="stat-value">${p(st.confirmed.rate)}</div><div class="stat-sub">${st.confirmed.came} de ${st.confirmed.n}</div></div>
          <div class="stat"><div class="stat-label">Dos que não responderam, vieram</div><div class="stat-value">${p(st.silent.rate)}</div><div class="stat-sub">${st.silent.came} de ${st.silent.n}</div></div>
          <div class="stat"><div class="stat-label">Confirmaram pelo link</div><div class="stat-value">${p(st.confirmRate)}</div><div class="stat-sub">de ${st.reminded} lembrete(s) · ${p(st.answeredRate)} responderam algo</div></div>
          <div class="stat"><div class="stat-label">Faltas no geral</div><div class="stat-value">${p(st.missRate)}</div><div class="stat-sub">${st.missed} de ${st.known} consulta(s)</div></div>
        </div>
        <p class="muted small">
          ${st.cancelled.n ? `Avisaram que não iam ou pediram para remarcar: ${st.cancelled.n} (${st.cancelled.came} acabou(aram) vindo). ` : ''}
          ${st.noReminder.n ? `Sem lembrete enviado: ${st.noReminder.n} consulta(s), ${p(st.noReminder.rate)} vieram. ` : ''}
          ${st.pending ? html`<strong>${st.pending} consulta(s) ainda sem comparecimento marcado</strong> ficam fora da conta (aba “Confirmar comparecimento”).` : ''}
        </p>
        ${ranking.length > 0 && html`
          <h3 class="calc-step">Quem mais falta</h3>
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
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const tomorrow = (() => { const d = new Date(todayISO() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const hasConfirm = /\[link de confirma[cç][aã]o\]/i.test(appt);

  async function save() {
    try {
      await run(supabase.from('app_settings').upsert({ key: 'whatsapp_appt_message', value: appt }));
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
    </section>`;
}
