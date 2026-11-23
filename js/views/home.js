import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { norm, fmtDate, daysAgoLabel, daysBetween, todayISO, onlyDigits, unique } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, windowDays } from '../lib/agenda.js';
import { planSends, consultSoonIds, DEFAULT_FREQUENCY, DEFAULT_START_DATE } from '../lib/questionnaires.js';
import { BACKUP_EVERY_DAYS } from '../lib/backup.js';
import { ACTIVE_DAYS } from '../lib/nutrium.js';
import { Modal, Field, ErrorBox, Loading, go } from './common.js';
import { TodoCard } from './todos.js';
import { RoutinesCard } from './routines.js';
import { CalendarCard } from './calendar.js';
import { PatientPeek } from './peek.js';

const ALERT_DAYS = 50;
const FIRST_PAGE = 15; // itens visíveis em cada lista
const PAGE_STEP = 10; // "Mostrar mais"
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

/** Lista com os primeiros 15 itens, "Mostrar mais" de 10 em 10 e "Mostrar menos" (volta aos 15). */
function usePaged(items, resetKey) {
  const [n, setN] = useState(FIRST_PAGE);
  useEffect(() => setN(FIRST_PAGE), [resetKey]);
  const more = items.length - n;
  const buttons = more > 0 || n > FIRST_PAGE
    ? html`
      <div class="show-more">
        ${more > 0 && html`<button class="btn btn-sm btn-ghost" onClick=${() => setN(n + PAGE_STEP)}>Mostrar mais ${Math.min(PAGE_STEP, more)} (faltam ${more})</button>`}
        ${n > FIRST_PAGE && html`<button class="btn btn-sm btn-ghost" onClick=${() => setN(FIRST_PAGE)}>Mostrar menos</button>`}
      </div>`
    : null;
  return [items.slice(0, n), buttons];
}

export function Home() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState(null);
  const [agenda, setAgenda] = useState({ state: 'loading', events: [] }); // loading | ok | off | error
  const [q, setQ] = useState('');
  const [newFor, setNewFor] = useState(null); // { name, email } para o cadastro rápido
  const [linking, setLinking] = useState(null); // evento a vincular
  const [peek, setPeek] = useState(null); // consulta clicada no calendário (resumo do paciente)
  const [qdata, setQdata] = useState(null); // envios + configurações, para o aviso de questionários
  const [calPeriod, setCalPeriod] = useState(null); // período visível no calendário
  const [nutAppts, setNutAppts] = useState([]); // consultas da planilha (quando a agenda não está conectada)
  const [apptSent, setApptSent] = useState(null); // lembretes de consulta de amanhã já enviados
  const [apptMeta, setApptMeta] = useState({ rem: new Map(), att: new Map() }); // confirmações e faltas, para o calendário

  const loadPatients = () => run(supabase.from('patient_overview').select('*').order('name')).then(setPatients).catch(setError);

  async function refreshAgenda(force = false, quiet = false) {
    if (!quiet) setAgenda((a) => ({ ...a, state: 'loading' }));
    try {
      const events = await loadAgenda({ force });
      if (events == null) setAgenda({ state: 'off', events: [] });
      else setAgenda({ state: 'ok', events });
    } catch (err) {
      if (!quiet) setAgenda({ state: 'error', events: [], error: err });
    }
  }

  useEffect(() => {
    loadPatients();
    refreshAgenda();
    run(supabase.from('nutrium_appointments').select('*').gte('date', windowDays(-120).to)).then(setNutAppts).catch(() => {});
    run(supabase.from('appointment_reminders').select('event_key').eq('event_date', windowDays(1).to)).then(setApptSent).catch(() => setApptSent(null));
    Promise.all([
      run(supabase.from('appointment_reminders').select('event_key, response').gte('event_date', windowDays(-120).to)),
      run(supabase.from('appointment_attendance').select('event_key, status').gte('event_date', windowDays(-120).to)),
    ]).then(([rem, att]) => setApptMeta({ rem: new Map(rem.map((r) => [r.event_key, r.response])), att: new Map(att.map((r) => [r.event_key, r.status])) }))
      .catch(() => {});
    Promise.all([
      run(supabase.from('questionnaire_sends').select('patient_id, created_at, sent_at, answered_at, expired_at, resent_at')),
      run(supabase.from('questionnaires').select('id').eq('is_default', true).eq('active', true)),
      run(supabase.from('app_settings').select('*').in('key', ['questionnaire_frequency_days', 'questionnaire_start_date', 'last_backup_at'])),
    ]).then(([sends, defs, sets]) => {
      const get = (k) => sets.find((x) => x.key === k)?.value;
      setQdata({ sends, hasDefault: defs.length > 0, frequency: Number(get('questionnaire_frequency_days')) || DEFAULT_FREQUENCY, startDate: get('questionnaire_start_date') || DEFAULT_START_DATE, lastBackup: get('last_backup_at') || null });
    })
      .catch(() => setQdata(null));

    // Atualização automática: a agenda a cada 10 minutos e os pacientes a cada 5
    // (e sempre que você volta para esta aba do navegador).
    const cal = setInterval(() => refreshAgenda(true, true), 10 * 60 * 1000);
    const pts = setInterval(loadPatients, 5 * 60 * 1000);
    const onFocus = () => { loadPatients(); refreshAgenda(false, true); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(cal); clearInterval(pts); window.removeEventListener('focus', onFocus); };
  }, []);

  const today = todayISO();

  // Consultas do período visível no calendário: agenda do Google ou, sem ela, a planilha do Nutrium.
  const calendarEvents = useMemo(() => {
    if (!patients || !calPeriod) return [];
    if (agenda.state === 'ok') {
      return consultationEvents(agenda.events, calPeriod.from, calPeriod.to).map((ev) => {
        const key = `${ev.uid}|${ev.start}`;
        return { ...ev, ...matchEvent(ev, patients), confirm: apptMeta.rem.get(key) || null, attendance: apptMeta.att.get(key) || null };
      });
    }
    const byId = new Map(patients.map((p) => [p.id, p]));
    return nutAppts.filter((a) => a.date >= calPeriod.from && a.date <= calPeriod.to)
      .map((a) => ({ uid: 'n' + a.id, start: a.date, time: a.start_time, endDate: a.date, endTime: a.end_time, patient: byId.get(a.patient_id) || null, patientName: byId.get(a.patient_id)?.name || '', attendees: [] }))
      .filter((e) => e.patient);
  }, [patients, agenda, calPeriod, nutAppts, apptMeta]);

  // Pacientes com consulta marcada (agenda dos próximos 90 dias ou planilha).
  const scheduled = useMemo(() => {
    const ids = new Set((patients || []).filter((p) => p.next_consult).map((p) => p.id));
    if (agenda.state === 'ok' && patients) {
      const { from, to } = windowDays(90);
      for (const ev of consultationEvents(agenda.events, from, to)) {
        const m = matchEvent(ev, patients);
        if (m.patient) ids.add(m.patient.id);
      }
    }
    return ids;
  }, [patients, agenda]);

  // Mais de 100 dias da última consulta e nada marcado: sai das listas na hora (sem esperar a importação).
  const isArchived = (p) => !!p.last_consult && daysBetween(p.last_consult, today) > ACTIVE_DAYS && !scheduled.has(p.id);

  // Última atividade: consulta ou resposta de questionário.
  const lastActivity = (p) => [p.last_consult, p.last_response].filter(Boolean).sort().pop() || null;
  const overdue = useMemo(() => (patients || [])
    .filter((p) => !isArchived(p) && lastActivity(p) && daysBetween(lastActivity(p), today) > ALERT_DAYS)
    .filter((p) => !scheduled.has(p.id))
    .filter((p) => !p.snooze_until || p.snooze_until <= today)
    .sort((a, b) => lastActivity(a).localeCompare(lastActivity(b))), [patients, scheduled]);

  // Consultas de amanhã ainda sem lembrete (só com a agenda conectada).
  const apptToRemind = useMemo(() => {
    if (!patients || agenda.state !== 'ok' || !apptSent) return 0;
    const tomorrow = windowDays(1).to;
    const sentKeys = new Set(apptSent.map((r) => r.event_key));
    return consultationEvents(agenda.events, tomorrow, tomorrow)
      .filter((ev) => matchEvent(ev, patients).patient && !sentKeys.has(`${ev.uid}|${ev.start}`)).length;
  }, [patients, agenda, apptSent]);

  const toSend = useMemo(() => {
    if (!qdata?.hasDefault || !patients) return null;
    const pairs = agenda.state === 'ok'
      ? consultationEvents(agenda.events, ...Object.values(windowDays(7))).map((ev) => [ev.start, matchEvent(ev, patients).patient?.id]).filter(([, id]) => id)
      : [];
    const plan = planSends({ patients, sends: qdata.sends, soonIds: consultSoonIds(patients, pairs), frequency: qdata.frequency, startDate: qdata.startDate });
    return { due: plan.due.length, reminders: plan.reminders.length };
  }, [qdata, patients, agenda]);

  const list = useMemo(() => {
    const nq = norm(q);
    // Na busca aparecem todos (inclusive os que passaram do prazo); na lista, só os atuais.
    return (patients || [])
      .filter((p) => (nq ? norm(p.name).includes(nq) : !isArchived(p)))
      .sort((a, b) => (b.last_consult || '').localeCompare(a.last_consult || '') || a.name.localeCompare(b.name));
  }, [patients, q, scheduled]);

  const [overdueShown, overdueMore] = usePaged(overdue, 'overdue');
  const [listShown, listMore] = usePaged(list, q);

  async function updatePatient(id, patch) {
    await run(supabase.from('patients').update(patch).eq('id', id));
    await loadPatients();
  }

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!patients) return html`<${Loading} />`;

  return html`
    <div class="home-layout">
    <div class="home-main">
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

    ${!q && qdata && patients.length > 0 && (!qdata.lastBackup || daysBetween(qdata.lastBackup.slice(0, 10), today) >= BACKUP_EVERY_DAYS) && html`
      <section class="card home-banner backup-banner">
        <span>💾 ${qdata.lastBackup ? `Último backup em ${fmtDate(qdata.lastBackup.slice(0, 10))}.` : 'Você ainda não fez nenhum backup.'} Faça o backup semanal dos seus dados.</span>
        <a class="btn btn-sm" href="#/config">Fazer backup</a>
      </section>`}

    ${!q && apptToRemind > 0 && html`
      <section class="card home-banner">
        <span>📅 <strong>${apptToRemind}</strong> paciente(s) com consulta amanhã para lembrar pelo WhatsApp</span>
        <a class="btn btn-primary btn-sm" href="#/lembretes">Abrir lembretes de consulta</a>
      </section>`}

    ${!q && toSend && (toSend.due > 0 || toSend.reminders > 0) && html`
      <section class="card home-banner">
        <span>📨 <strong>${toSend.due}</strong> questionário(s) para enviar hoje${toSend.reminders ? html` · <strong>${toSend.reminders}</strong> lembrete(s)` : ''}</span>
        <a class="btn btn-primary btn-sm" href="#/questionarios">Abrir envios de hoje</a>
      </section>`}

    ${!q && html`
      <${CalendarCard}
        events=${calendarEvents}
        source=${agenda.state === 'ok' ? 'google' : 'nutrium'}
        state=${agenda.state}
        error=${agenda.error}
        onRefresh=${() => refreshAgenda(true)}
        onUnlinked=${setLinking}
        onPatient=${setPeek}
        onPeriod=${setCalPeriod}
      />`}

    ${!q && overdue.length > 0 && html`
      <section class="card">
        <h2 class="card-title">⏰ Sem retorno há mais de ${ALERT_DAYS} dias <span class="muted small">(${overdue.length}, sem consulta marcada)</span></h2>
        <table class="table">
          <thead><tr><th>Paciente</th><th>Última consulta</th><th>Dias sem contato</th><th></th></tr></thead>
          <tbody>
            ${overdueShown.map((p) => html`
              <tr>
                <td><a href=${'#/paciente/' + p.id}>${p.name}</a></td>
                <td>${fmtDate(p.last_consult)}${p.last_response && p.last_response > p.last_consult ? html`<div class="muted small">respondeu questionário em ${fmtDate(p.last_response)}</div>` : ''}</td>
                <td class="text-warn">${daysBetween(lastActivity(p), today)}</td>
                <td class="row-actions">
                  <button class="btn btn-sm" title="Some deste alerta por 7 dias" onClick=${() => updatePatient(p.id, { snooze_until: plusDays(today, 7) })}>Lembrar em 7 dias</button>
                </td>
              </tr>`)}
          </tbody>
        </table>
        ${overdueMore}
        <p class="muted small">Se o paciente marcar consulta (na agenda ou no Nutrium), ele sai deste alerta sozinho. Com mais de ${ACTIVE_DAYS} dias, sai de todas as listas.</p>
      </section>`}

    ${patients.length > 0 && html`
      <section class="card">
        <div class="card-title-row">
          <h2 class="card-title">${q ? `Resultados para “${q}”` : 'Todos os pacientes'} <span class="muted small">(${list.length})</span></h2>
        </div>
        ${list.length === 0 && html`
          <p class="muted">Nenhum paciente encontrado.
            ${q && html` <button class="btn btn-sm" onClick=${() => setNewFor({ name: q })}>Cadastrar “${q}”</button>`}
          </p>`}
        ${list.length > 0 && html`
          <table class="table">
            <thead><tr><th>Paciente</th><th>Última consulta</th><th>Dias passados</th><th class="hide-sm">Próxima</th></tr></thead>
            <tbody>
              ${listShown.map((p) => html`
                <tr class="row-link" onClick=${() => go('/paciente/' + p.id)}>
                  <td>
                    ${p.name}
                    ${!p.phone && html` <span class="badge badge-warn" title="Sem telefone: necessário para os questionários">sem telefone</span>`}
                    ${isArchived(p) && html` <span class="badge" title="Mais de ${ACTIVE_DAYS} dias sem consulta e nada marcado: fora das listas e dos questionários">+${ACTIVE_DAYS} dias</span>`}
                  </td>
                  <td>${p.last_consult ? fmtDate(p.last_consult) : '–'}</td>
                  <td class=${p.last_consult && daysBetween(p.last_consult, today) > ALERT_DAYS ? 'text-warn' : ''}>${daysAgoLabel(p.last_consult)}</td>
                  <td class="hide-sm">${p.next_consult ? fmtDate(p.next_consult) : ''}</td>
                </tr>`)}
            </tbody>
          </table>
          ${listMore}`}
        ${!q && html`<p class="muted small">Quem passou de ${ACTIVE_DAYS} dias da última consulta sem nada marcado sai da lista (volta sozinho ao marcar consulta) e só aparece na busca por nome.</p>`}
      </section>`}

    </div>
    <aside class="home-side"><${RoutinesCard} /><${TodoCard} /></aside>
    </div>

    ${peek && html`<${PatientPeek} event=${peek} onClose=${() => setPeek(null)} />`}
    ${newFor && html`<${NewPatientModal} initialName=${newFor.name} emails=${newFor.emails || []} onClose=${() => setNewFor(null)} />`}
    ${linking && html`
      <${LinkModal}
        event=${linking}
        patients=${patients}
        onClose=${() => setLinking(null)}
        onLinked=${async () => { setLinking(null); await loadPatients(); }}
        onCreate=${() => { const ev = linking; setLinking(null); setNewFor({ name: ev.patientName, emails: ev.attendees }); }}
      />`}`;
}

/** Vincula um evento da agenda a um paciente: guarda o e-mail do convidado e o nome do título no cadastro. */
function LinkModal({ event, patients, onClose, onLinked, onCreate }) {
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
      <div class="actions"><button class="btn" onClick=${onCreate}>➕ É paciente novo: criar cadastro</button></div>
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
