import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { norm, fmtDate, daysAgoLabel, daysBetween, todayISO, onlyDigits, unique } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, windowDays } from '../lib/agenda.js';
import { planSends, consultSoonIds, DEFAULT_FREQUENCY } from '../lib/questionnaires.js';
import { Modal, Field, ErrorBox, Loading, go } from './common.js';

const ALERT_DAYS = 50;
const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function dayLabel(iso) {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  const d = new Date(iso + 'T12:00:00');
  return `${WEEKDAY[d.getDay()]} ${fmtDate(iso).slice(0, 5)}`;
}
function plusDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Home() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState(null);
  const [agenda, setAgenda] = useState({ state: 'loading', events: [] }); // loading | ok | off | error
  const [q, setQ] = useState('');
  const [newFor, setNewFor] = useState(null); // { name, email } para o cadastro rápido
  const [linking, setLinking] = useState(null); // evento a vincular
  const [filter, setFilter] = useState('ativos');
  const [qdata, setQdata] = useState(null); // envios + configurações, para o aviso de questionários

  const loadPatients = () => run(supabase.from('patient_overview').select('*').order('name')).then(setPatients).catch(setError);

  async function refreshAgenda(force = false) {
    setAgenda((a) => ({ ...a, state: 'loading' }));
    try {
      const events = await loadAgenda({ force });
      if (events == null) setAgenda({ state: 'off', events: [] });
      else setAgenda({ state: 'ok', events });
    } catch (err) {
      setAgenda({ state: 'error', events: [], error: err });
    }
  }

  useEffect(() => {
    loadPatients();
    refreshAgenda();
    Promise.all([
      run(supabase.from('questionnaire_sends').select('patient_id, created_at, sent_at, answered_at, expired_at, resent_at')),
      run(supabase.from('questionnaires').select('id').eq('is_default', true).eq('active', true)),
      run(supabase.from('app_settings').select('*').eq('key', 'questionnaire_frequency_days')),
    ]).then(([sends, defs, freq]) => setQdata({ sends, hasDefault: defs.length > 0, frequency: Number(freq[0]?.value) || DEFAULT_FREQUENCY }))
      .catch(() => setQdata(null));
  }, []);

  const today = todayISO();

  // Próximas consultas: agenda do Google (ou planilha do Nutrium, se a agenda não estiver conectada).
  const upcoming = useMemo(() => {
    if (!patients) return [];
    if (agenda.state === 'ok') {
      const { from, to } = windowDays(7);
      return consultationEvents(agenda.events, from, to).map((ev) => ({ ...ev, ...matchEvent(ev, patients) }));
    }
    return patients
      .filter((p) => p.next_consult && daysBetween(today, p.next_consult) <= 7)
      .sort((a, b) => (a.next_consult + (a.next_time || '')).localeCompare(b.next_consult + (b.next_time || '')))
      .map((p) => ({ uid: p.id, start: p.next_consult, time: p.next_time, patientName: p.name, patient: p, attendees: [] }));
  }, [patients, agenda]);

  // Pacientes com consulta marcada (agenda dos próximos 60 dias ou planilha), para o alerta de 50 dias.
  const scheduled = useMemo(() => {
    const ids = new Set((patients || []).filter((p) => p.next_consult).map((p) => p.id));
    if (agenda.state === 'ok' && patients) {
      const { from, to } = windowDays(60);
      for (const ev of consultationEvents(agenda.events, from, to)) {
        const m = matchEvent(ev, patients);
        if (m.patient) ids.add(m.patient.id);
      }
    }
    return ids;
  }, [patients, agenda]);

  // Última atividade: consulta ou resposta de questionário.
  const lastActivity = (p) => [p.last_consult, p.last_response].filter(Boolean).sort().pop() || null;
  const overdue = useMemo(() => (patients || [])
    .filter((p) => p.status === 'ativo' && lastActivity(p) && daysBetween(lastActivity(p), today) > ALERT_DAYS)
    .filter((p) => !scheduled.has(p.id))
    .filter((p) => !p.snooze_until || p.snooze_until <= today)
    .sort((a, b) => lastActivity(a).localeCompare(lastActivity(b))), [patients, scheduled]);

  const toSend = useMemo(() => {
    if (!qdata?.hasDefault || !patients) return null;
    const pairs = agenda.state === 'ok'
      ? consultationEvents(agenda.events, ...Object.values(windowDays(7))).map((ev) => [ev.start, matchEvent(ev, patients).patient?.id]).filter(([, id]) => id)
      : [];
    const plan = planSends({ patients, sends: qdata.sends, soonIds: consultSoonIds(patients, pairs), frequency: qdata.frequency });
    return { due: plan.due.length, reminders: plan.reminders.length };
  }, [qdata, patients, agenda]);

  const list = useMemo(() => {
    const nq = norm(q);
    return (patients || [])
      .filter((p) => (filter === 'todos' ? true : filter === 'inativos' ? p.status === 'inativo' : p.status === 'ativo'))
      .filter((p) => !nq || norm(p.name).includes(nq))
      .sort((a, b) => (b.last_consult || '').localeCompare(a.last_consult || '') || a.name.localeCompare(b.name));
  }, [patients, q, filter]);

  async function updatePatient(id, patch) {
    await run(supabase.from('patients').update(patch).eq('id', id));
    await loadPatients();
  }

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!patients) return html`<${Loading} />`;

  return html`
    <div class="page-head">
      <h1>Pacientes</h1>
      <button class="btn btn-primary" onClick=${() => setNewFor({ name: q })}>+ Cadastro rápido</button>
    </div>

    <div class="search">
      <span>🔍</span>
      <input type="search" placeholder="Buscar paciente por nome…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
    </div>

    ${patients.length === 0 && html`
      <div class="card empty">
        <h2>Nenhum paciente ainda</h2>
        <p>Comece importando a planilha do Nutrium. Ela traz todos os pacientes, as consultas e os pesos.</p>
        <a class="btn btn-primary" href="#/importar">Importar planilha do Nutrium</a>
      </div>`}

    ${!q && toSend && (toSend.due > 0 || toSend.reminders > 0) && html`
      <section class="card home-banner">
        <span>📨 <strong>${toSend.due}</strong> questionário(s) para enviar hoje${toSend.reminders ? html` · <strong>${toSend.reminders}</strong> lembrete(s)` : ''}</span>
        <a class="btn btn-primary btn-sm" href="#/questionarios">Abrir envios de hoje</a>
      </section>`}

    ${!q && html`
      <section class="card">
        <div class="card-title-row">
          <h2 class="card-title">📅 Próximas consultas
            <span class="muted small">${agenda.state === 'ok' ? '(Google Agenda, próximos 7 dias)' : '(pela planilha do Nutrium)'}</span>
          </h2>
          ${agenda.state === 'ok' && html`<button class="btn btn-sm btn-ghost" onClick=${() => refreshAgenda(true)}>↻ Atualizar</button>`}
          ${agenda.state === 'loading' && html`<span class="muted small">Lendo a agenda…</span>`}
        </div>
        ${agenda.state === 'off' && html`<div class="alert">A agenda do Google ainda não está conectada. <a href="#/config">Conectar agora</a></div>`}
        ${agenda.state === 'error' && html`<div class="alert alert-error">Não consegui ler a agenda do Google: ${agenda.error?.message || agenda.error}. Mostrando as consultas da planilha do Nutrium. <a href="#/config">Ver configurações</a></div>`}
        ${upcoming.length === 0 && agenda.state !== 'loading' && html`<p class="muted">Nenhuma consulta nos próximos 7 dias.</p>`}
        ${upcoming.length > 0 && html`
          <table class="table">
            <thead><tr><th>Quando</th><th>Paciente</th><th>Última consulta</th><th>Dias passados</th></tr></thead>
            <tbody>
              ${upcoming.map((ev) => ev.patient
                ? html`
                  <tr class="row-link" onClick=${() => go('/paciente/' + ev.patient.id)}>
                    <td><strong>${dayLabel(ev.start)}</strong> ${ev.time || ''}</td>
                    <td>${ev.patient.name}</td>
                    <td>${ev.patient.last_consult ? fmtDate(ev.patient.last_consult) : html`<span class="badge badge-blue">Primeira consulta</span>`}</td>
                    <td>${daysAgoLabel(ev.patient.last_consult)}</td>
                  </tr>`
                : html`
                  <tr>
                    <td><strong>${dayLabel(ev.start)}</strong> ${ev.time || ''}</td>
                    <td>${ev.patientName} <span class="badge badge-warn">⚠️ não vinculado</span></td>
                    <td colspan="2">
                      <button class="btn btn-sm" onClick=${() => setLinking(ev)}>🔗 Vincular a paciente</button>
                      <button class="btn btn-sm" onClick=${() => setNewFor({ name: ev.patientName, emails: ev.attendees })}>➕ Criar cadastro</button>
                    </td>
                  </tr>`)}
            </tbody>
          </table>`}
      </section>`}

    ${!q && overdue.length > 0 && html`
      <section class="card">
        <h2 class="card-title">⏰ Sem retorno há mais de ${ALERT_DAYS} dias <span class="muted small">(${overdue.length}, sem consulta marcada)</span></h2>
        <table class="table">
          <thead><tr><th>Paciente</th><th>Última consulta</th><th>Dias sem contato</th><th></th></tr></thead>
          <tbody>
            ${overdue.map((p) => html`
              <tr>
                <td><a href=${'#/paciente/' + p.id}>${p.name}</a></td>
                <td>${fmtDate(p.last_consult)}${p.last_response && p.last_response > p.last_consult ? html`<div class="muted small">respondeu questionário em ${fmtDate(p.last_response)}</div>` : ''}</td>
                <td class="text-warn">${daysBetween(lastActivity(p), today)}</td>
                <td class="row-actions">
                  <button class="btn btn-sm" title="Some deste alerta por 7 dias" onClick=${() => updatePatient(p.id, { snooze_until: plusDays(today, 7) })}>Lembrar em 7 dias</button>
                  <button class="btn btn-sm btn-ghost" title="Para de receber questionários e sai da lista de ativos" onClick=${() => updatePatient(p.id, { status: 'inativo', questionnaires_active: false, inactive_reason: null })}>Marcar como inativo</button>
                </td>
              </tr>`)}
          </tbody>
        </table>
        <p class="muted small">Se o paciente marcar consulta (na agenda ou no Nutrium), ele sai deste alerta sozinho.</p>
      </section>`}

    ${patients.length > 0 && html`
      <section class="card">
        <div class="card-title-row">
          <h2 class="card-title">${q ? `Resultados para “${q}”` : 'Todos os pacientes'} <span class="muted small">(${list.length})</span></h2>
          <div class="seg">
            ${['ativos', 'inativos', 'todos'].map((f) => html`
              <button class=${filter === f ? 'on' : ''} onClick=${() => setFilter(f)}>${f[0].toUpperCase() + f.slice(1)}</button>`)}
          </div>
        </div>
        ${list.length === 0 && html`
          <p class="muted">Nenhum paciente encontrado.
            ${q && html` <button class="btn btn-sm" onClick=${() => setNewFor({ name: q })}>Cadastrar “${q}”</button>`}
          </p>`}
        ${list.length > 0 && html`
          <table class="table">
            <thead><tr><th>Paciente</th><th>Última consulta</th><th>Dias passados</th><th class="hide-sm">Próxima</th></tr></thead>
            <tbody>
              ${list.map((p) => html`
                <tr class="row-link" onClick=${() => go('/paciente/' + p.id)}>
                  <td>
                    ${p.name}
                    ${!p.phone && html` <span class="badge badge-warn" title="Sem telefone: necessário para os questionários">sem telefone</span>`}
                    ${p.status === 'inativo' && html` <span class="badge">inativo</span>`}
                  </td>
                  <td>${p.last_consult ? fmtDate(p.last_consult) : '–'}</td>
                  <td class=${p.last_consult && daysBetween(p.last_consult, today) > ALERT_DAYS ? 'text-warn' : ''}>${daysAgoLabel(p.last_consult)}</td>
                  <td class="hide-sm">${p.next_consult ? fmtDate(p.next_consult) : ''}</td>
                </tr>`)}
            </tbody>
          </table>`}
      </section>`}

    ${newFor && html`<${NewPatientModal} initialName=${newFor.name} emails=${newFor.emails || []} onClose=${() => setNewFor(null)} />`}
    ${linking && html`
      <${LinkModal}
        event=${linking}
        patients=${patients}
        onClose=${() => setLinking(null)}
        onLinked=${async () => { setLinking(null); await loadPatients(); }}
      />`}`;
}

/** Vincula um evento da agenda a um paciente: guarda o e-mail do convidado e o nome do título no cadastro. */
function LinkModal({ event, patients, onClose, onLinked }) {
  const [q, setQ] = useState(event.patientName.split(' ')[0] || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nq = norm(q);
  const options = patients.filter((p) => !nq || p.name_norm.includes(nq)).slice(0, 30);

  async function link(p) {
    setBusy(true);
    try {
      await run(supabase.from('patients').update({
        emails: unique([...(p.emails || []), ...event.attendees.filter((m) => !(p.emails || []).includes(m))]).slice(0, 10),
        aliases: unique([...(p.aliases || []), norm(event.patientName)]),
      }).eq('id', p.id));
      onLinked();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return html`
    <${Modal} title="Vincular consulta a um paciente" onClose=${onClose}>
      <p>Na agenda: <strong>${event.patientName}</strong>${event.attendees.length ? html` <span class="muted small">(${event.attendees.join(', ')})</span>` : ''}</p>
      <p class="muted small">Escolha quem é. Nas próximas vezes, o sistema reconhece sozinho.</p>
      <input placeholder="Buscar paciente…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
      <ul class="pick-list">
        ${options.map((p) => html`<li><button class="btn btn-block" disabled=${busy} onClick=${() => link(p)}>${p.name}${p.birth_date ? html` <span class="muted small">· nasc. ${fmtDate(p.birth_date)}</span>` : ''}</button></li>`)}
        ${options.length === 0 && html`<li class="muted">Nenhum paciente com esse nome.</li>`}
      </ul>
      <${ErrorBox} error=${error} />
    <//>`;
}

function NewPatientModal({ initialName, emails = [], onClose }) {
  const [form, setForm] = useState({ name: initialName || '', birth_date: '', phone: '', sex: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const name = form.name.trim().replace(/\s+/g, ' ');
      const [row] = await run(supabase.from('patients').insert({
        name,
        name_norm: norm(name),
        birth_date: form.birth_date || null,
        phone: onlyDigits(form.phone) ? form.phone.trim() : null,
        sex: form.sex || null,
        email_primary: emails[0] || null,
        emails,
        aliases: initialName && norm(initialName) !== norm(name) ? [norm(initialName)] : [],
      }).select('id'));
      go('/paciente/' + row.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return html`
    <${Modal} title="Cadastro rápido" onClose=${onClose}>
      <form onSubmit=${save}>
        <${Field} label="Nome completo"><input required value=${form.name} onInput=${set('name')} autofocus /><//>
        <div class="grid-2">
          <${Field} label="Data de nascimento"><input type="date" required value=${form.birth_date} onInput=${set('birth_date')} /><//>
          <${Field} label="Sexo">
            <select value=${form.sex} onChange=${set('sex')}>
              <option value="">Não informado</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </select>
          <//>
        </div>
        <${Field} label="Telefone (WhatsApp)" hint="Com DDD. Ex.: 11 98765-4321">
          <input type="tel" value=${form.phone} onInput=${set('phone')} placeholder="11 98765-4321" />
        <//>
        ${emails.length > 0 && html`<p class="muted small">E-mail da agenda: ${emails.join(', ')}</p>`}
        <p class="muted small">Os demais dados chegam na próxima importação da planilha do Nutrium.</p>
        <${ErrorBox} error=${error} />
        <div class="actions">
          <button type="button" class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" disabled=${busy}>${busy ? 'Salvando…' : 'Cadastrar'}</button>
        </div>
      </form>
    <//>`;
}
