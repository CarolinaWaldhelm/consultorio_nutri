// Aba Questionários: envios de hoje, modelos, log de envios e configurações de envio.
import { html, useState, useEffect, useMemo, useRef } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, daysBetween, todayISO, daysAgoLabel } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, windowDays } from '../lib/agenda.js';
import {
  planSends, consultSoonIds, newToken, formLink, fillMessage, whatsappUrl, whatsappNumber, dateOf, responseStats, durationLabel,
  DEFAULT_FREQUENCY, DEFAULT_START_DATE, DEFAULT_MESSAGE, DEFAULT_REMINDER, QUESTION_TYPES,
} from '../lib/questionnaires.js';
import { Modal, Field, ErrorBox, Loading, AutoText } from './common.js';

export async function loadQuestionnaireData() {
  const [patients, questionnaires, sends, settingsRows] = await Promise.all([
    run(supabase.from('patient_overview').select('*').order('name')),
    run(supabase.from('questionnaires').select('*').order('created_at', { ascending: false })),
    run(supabase.from('questionnaire_sends').select('*').order('created_at', { ascending: false })),
    run(supabase.from('app_settings').select('*')),
  ]);
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  let agendaPairs = [];
  try {
    const events = await loadAgenda();
    if (events) {
      const { from, to } = windowDays(7);
      agendaPairs = consultationEvents(events, from, to)
        .map((ev) => [ev.start, matchEvent(ev, patients).patient?.id]).filter(([, id]) => id);
    }
  } catch { /* sem agenda: usa só a planilha */ }
  return { patients, questionnaires, sends, settings, agendaPairs };
}

export function sendPlan(data) {
  const frequency = Number(data.settings.questionnaire_frequency_days) || DEFAULT_FREQUENCY;
  const soonIds = consultSoonIds(data.patients, data.agendaPairs);
  const startDate = data.settings.questionnaire_start_date || DEFAULT_START_DATE;
  return { frequency, startDate, ...planSends({ patients: data.patients, sends: data.sends, soonIds, frequency, startDate }) };
}

export function QuestionnairesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('envios');

  const reload = () => loadQuestionnaireData().then(setData).catch(setError);
  useEffect(() => { reload(); }, []);

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;

  const tabs = [['envios', '📨 Envios de hoje'], ['log', '📋 Envios e respostas'], ['modelos', '🧩 Modelos'], ['config', '⚙️ Mensagem e frequência']];
  return html`
    <div class="page-head"><h1>Questionários</h1></div>
    <div class="seg tabs">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => { setTab(k); reload(); }}>${l}</button>`)}</div>
    ${tab === 'envios' && html`<${SendsTab} data=${data} reload=${reload} goModels=${() => setTab('modelos')} />`}
    ${tab === 'log' && html`<${LogTab} data=${data} />`}
    ${tab === 'modelos' && html`<${ModelsTab} data=${data} reload=${reload} />`}
    ${tab === 'config' && html`<${ConfigTab} data=${data} reload=${reload} />`}`;
}

// ---------------------------------------------------------------- Envios de hoje

function SendsTab({ data, reload, goModels }) {
  const plan = useMemo(() => sendPlan(data), [data]);
  const [selected, setSelected] = useState(() => new Set(plan.due.map((d) => d.patient.id)));
  // Quem entrar na lista depois (ao atualizar) já vem marcado; desmarcados por você continuam desmarcados.
  const seen = useRef(new Set(plan.due.map((d) => d.patient.id)));
  useEffect(() => {
    const fresh = plan.due.map((d) => d.patient.id).filter((id) => !seen.current.has(id));
    if (fresh.length) { fresh.forEach((id) => seen.current.add(id)); setSelected((s) => new Set([...s, ...fresh])); }
  }, [plan]);
  const [queue, setQueue] = useState(null); // { ids: [...], pos } durante o envio
  const [sent, setSent] = useState({}); // patientId -> envio criado agora
  const [error, setError] = useState(null);
  const def = data.questionnaires.find((q) => q.is_default && q.active);
  const message = data.settings.whatsapp_message || DEFAULT_MESSAGE;
  const reminder = data.settings.whatsapp_reminder || DEFAULT_REMINDER;
  const byId = new Map(plan.due.map((d) => [d.patient.id, d.patient]));
  const dueBy = Object.fromEntries(plan.due.map((d) => [d.patient.id, d]));

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pending = plan.due.filter((d) => !sent[d.patient.id]);
  const allOn = pending.length > 0 && pending.every((d) => selected.has(d.patient.id));

  async function sendOne(p) {
    // Abre a janela já no clique (o navegador bloqueia janelas abertas depois).
    const win = window.open('', '_blank');
    try {
      const token = newToken();
      const [row] = await run(supabase.from('questionnaire_sends').insert({ patient_id: p.id, questionnaire_id: def.id, token }).select('*'));
      // O link anterior, se ainda não respondido, vence.
      await run(supabase.from('questionnaire_sends').update({ expired_at: new Date().toISOString() })
        .eq('patient_id', p.id).is('answered_at', null).is('expired_at', null).neq('id', row.id));
      setSent((d) => ({ ...d, [p.id]: row }));
      const url = whatsappUrl(p.phone, fillMessage(message, p.name, formLink(token)));
      if (win) win.location.href = url; else window.open(url, '_blank');
      return true;
    } catch (err) {
      win?.close();
      setError(err);
      return false;
    }
  }

  function startQueue() {
    const ids = plan.due.map((d) => d.patient.id).filter((id) => selected.has(id) && !sent[id]);
    if (ids.length) setQueue({ ids, pos: 0 });
  }
  async function queueSend() {
    const p = byId.get(queue.ids[queue.pos]);
    if (await sendOne(p)) setQueue((q) => (q.pos + 1 >= q.ids.length ? null : { ...q, pos: q.pos + 1 }));
  }
  const queueSkip = () => setQueue((q) => (q.pos + 1 >= q.ids.length ? null : { ...q, pos: q.pos + 1 }));

  async function stopFor(p) {
    if (!confirm(`Não enviar mais questionários para ${p.name}? Dá para reativar na ficha do paciente (seção Questionários).`)) return;
    await run(supabase.from('patients').update({ questionnaires_active: false }).eq('id', p.id));
    reload();
  }

  async function undo(p) {
    const row = sent[p.id];
    if (!confirm(`Desfazer o envio para ${p.name}? O link deixa de funcionar.`)) return;
    await run(supabase.from('questionnaire_sends').delete().eq('id', row.id));
    setSent((d) => { const n = { ...d }; delete n[p.id]; return n; });
  }

  async function remind({ patient, send: s }) {
    const win = window.open('', '_blank');
    try {
      await run(supabase.from('questionnaire_sends').update({ resent_at: new Date().toISOString() }).eq('id', s.id));
      setSent((d) => ({ ...d, ['r:' + patient.id]: true }));
      const url = whatsappUrl(patient.phone, fillMessage(reminder, patient.name, formLink(s.token)));
      if (win) win.location.href = url; else window.open(url, '_blank');
    } catch (err) {
      win?.close();
      setError(err);
    }
  }

  if (!def) {
    return html`
      <section class="card empty">
        <h2>Ainda não há questionário padrão</h2>
        <p>Crie o questionário (ou use o exemplo pronto) em “Modelos” e marque como padrão.</p>
        <button class="btn btn-primary" onClick=${goModels}>Ir para Modelos</button>
      </section>`;
  }

  const sentCount = Object.keys(sent).filter((k) => !k.startsWith('r:')).length;
  const selCount = pending.filter((d) => selected.has(d.patient.id)).length;
  const current = queue && byId.get(queue.ids[queue.pos]);

  return html`
    <${ErrorBox} error=${error} />

    ${current && html`
      <section class="card send-queue">
        <div class="muted small">Enviando ${queue.pos + 1} de ${queue.ids.length}</div>
        <h2>${current.name}</h2>
        <p class="muted small">O WhatsApp abre na conversa com a mensagem pronta: aperte enviar lá e volte aqui para o próximo.</p>
        <div class="row-actions" style="justify-content:flex-start">
          <button class="btn btn-primary" onClick=${queueSend}>📲 Abrir WhatsApp de ${current.name.split(' ')[0]}</button>
          <button class="btn btn-ghost" onClick=${queueSkip}>Pular</button>
          <button class="btn btn-ghost" onClick=${() => setQueue(null)}>Parar</button>
        </div>
      </section>`}

    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">Para enviar hoje <span class="muted small">(${plan.due.length}${sentCount ? ` · ${sentCount} enviado(s)` : ''})</span></h2>
        <span class="muted small">Questionário: <strong>${def.name}</strong> · ${plan.frequency} dias após a última consulta ou o último questionário</span>
      </div>
      ${plan.due.length === 0 && html`<p class="muted">Ninguém para receber hoje. 🎉</p>`}
      ${plan.due.length > 0 && html`
        <div class="row-actions" style="justify-content:flex-start;margin-bottom:8px">
          <button class="btn btn-sm" disabled=${!pending.length} onClick=${() => setSelected(new Set(pending.map((d) => d.patient.id)))}>☑ Marcar todos</button>
          <button class="btn btn-sm" disabled=${!selCount} onClick=${() => setSelected(new Set())}>☐ Desmarcar todos</button>
          <span class="spacer"></span>
          <button class="btn btn-primary" disabled=${!selCount || !!queue} onClick=${startQueue}>📲 Enviar para os selecionados (${selCount})</button>
        </div>
        <table class="table">
          <thead><tr><th style="width:36px"><input type="checkbox" aria-label="Marcar ou desmarcar todos" checked=${allOn} disabled=${!pending.length}
            onChange=${() => setSelected(allOn ? new Set() : new Set(pending.map((d) => d.patient.id)))} /></th><th>Paciente</th><th>Última consulta</th><th>Motivo</th><th></th></tr></thead>
          <tbody>
            ${plan.due.map(({ patient: p }) => html`
              <tr class=${sent[p.id] ? 'row-sent' : ''}>
                <td><input type="checkbox" aria-label=${'Selecionar ' + p.name} disabled=${!!sent[p.id]} checked=${!!sent[p.id] || selected.has(p.id)} onChange=${() => toggle(p.id)} /></td>
                <td><a href=${'#/paciente/' + p.id}>${p.name}</a></td>
                <td>${fmtDate(p.last_consult)} <span class="muted small">(${daysAgoLabel(p.last_consult).toLowerCase()})</span></td>
                <td class="muted small">${dueBy[p.id]?.fromSend ? `último questionário em ${fmtDate(dueBy[p.id].anchor)}` : 'primeiro após a consulta'}</td>
                <td class="row-actions">
                  ${sent[p.id]
                    ? html`<span class="badge badge-green">✓ Enviado</span><button class="btn btn-sm btn-ghost" onClick=${() => undo(p)}>Desfazer</button>`
                    : html`<button class="btn btn-sm btn-ghost" title="Tira este paciente dos envios (dá para reativar na ficha)" onClick=${() => stopFor(p)}>Não enviar para este paciente</button>`}
                </td>
              </tr>`)}
          </tbody>
        </table>
        <p class="muted small">Confira a lista, desmarque quem não deve receber e clique em “Enviar para os selecionados”.
          O WhatsApp exige um clique por pessoa (o envio sai do seu número), então o sistema vai abrindo um de cada vez.</p>`}
    </section>

    ${plan.noPhone.length > 0 && html`<${PhoneRequest} items=${plan.noPhone} onSaved=${reload} onStop=${stopFor} />`}

    ${plan.reminders.length > 0 && html`
      <section class="card">
        <h2 class="card-title">🔔 Lembretes <span class="muted small">(enviado há 3 dias ou mais, ainda sem resposta)</span></h2>
        <table class="table">
          <tbody>
            ${plan.reminders.map((r) => html`
              <tr>
                <td><a href=${'#/paciente/' + r.patient.id}>${r.patient.name}</a></td>
                <td class="muted small">enviado em ${fmtDate(dateOf(r.send.sent_at))}</td>
                <td class="row-actions">
                  ${sent['r:' + r.patient.id]
                    ? html`<span class="badge badge-green">✓ Lembrete enviado</span>`
                    : html`<button class="btn btn-sm" onClick=${() => remind(r)}>📲 Reenviar lembrete</button>`}
                </td>
              </tr>`)}
          </tbody>
        </table>
      </section>`}

    ${plan.autoPaused.length > 0 && html`
      <section class="card">
        <h2 class="card-title">⛔ Não responderam os 2 últimos <span class="muted small">(${plan.autoPaused.length}: pararam de receber)</span></h2>
        <p class="muted small">Pela regra, não recebem mais questionários até a próxima consulta. Vale um contato pessoal.</p>
        <table class="table">
          <tbody>
            ${plan.autoPaused.map(({ patient: p, sentDates }) => html`
              <tr>
                <td><a href=${'#/paciente/' + p.id}>${p.name}</a></td>
                <td class="muted small">sem resposta aos envios de ${sentDates.map((d) => fmtDate(d)).join(' e ')}</td>
                <td class="muted small">última consulta ${fmtDate(p.last_consult)}</td>
                <td class="row-actions"><button class="btn btn-sm btn-ghost" onClick=${() => stopFor(p)}>Não enviar para este paciente</button></td>
              </tr>`)}
          </tbody>
        </table>
      </section>`}

    ${plan.soon.length > 0 && html`
      <p class="muted small">Com consulta hoje (no dia da consulta não se envia): ${plan.soon.map((x) => x.patient.name).join(', ')}.</p>`}`;
}

/** Pede o telefone de quem deveria receber hoje: digitou e salvou, o paciente vai para a lista de envio. */
function PhoneRequest({ items, onSaved, onStop }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 10);

  async function save(p) {
    const v = (values[p.id] || '').trim();
    if (!whatsappNumber(v)) { setError(new Error(`Telefone de ${p.name} incompleto: use DDD + número (ex.: 11 98765-4321).`)); return; }
    setError(null);
    setBusy(p.id);
    try {
      await run(supabase.from('patients').update({ phone: v }).eq('id', p.id));
      await onSaved();
    } catch (err) {
      setError(err);
    }
    setBusy(null);
  }

  return html`
    <section class="card phone-request">
      <h2 class="card-title">📞 Atualize os telefones para enviar <span class="muted small">(${items.length} deveriam receber hoje)</span></h2>
      <p class="muted small">Estes pacientes já estão no prazo do questionário, mas não têm telefone. Digite o WhatsApp com DDD e salve:
        o paciente entra na lista de envio acima, já marcado. Se não quiser enviar para alguém, use “Não enviar para este paciente”.</p>
      <${ErrorBox} error=${error} />
      <table class="table">
        <tbody>
          ${shown.map(({ patient: p }) => html`
            <tr>
              <td><a href=${'#/paciente/' + p.id}>${p.name}</a></td>
              <td><input type="tel" class="phone-input" placeholder="11 98765-4321" value=${values[p.id] || ''}
                onInput=${(e) => setValues({ ...values, [p.id]: e.target.value })}
                onKeyDown=${(e) => e.key === 'Enter' && save(p)} /></td>
              <td class="row-actions">
                <button class="btn btn-sm btn-ghost" title="Tira este paciente dos envios (dá para reativar na ficha)" onClick=${() => onStop(p)}>Não enviar para este paciente</button>
                <button class="btn btn-sm btn-primary" disabled=${busy === p.id || !(values[p.id] || '').trim()} onClick=${() => save(p)}>${busy === p.id ? 'Salvando…' : 'Salvar'}</button>
              </td>
            </tr>`)}
        </tbody>
      </table>
      ${items.length > 10 && html`<button class="btn btn-sm btn-ghost show-more" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Mostrar menos' : `Mostrar todos (${items.length})`}</button>`}
    </section>`;
}

// ---------------------------------------------------------------- Log

const PERIODS = [['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['all', 'Desde o início']];
function sinceFor(period) {
  if (period === 'all') return null;
  const d = new Date(todayISO() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - Number(period));
  return d.toISOString().slice(0, 10);
}

/** Taxa de resposta geral, efeito do lembrete e taxa por paciente. */
function StatsCard({ data }) {
  const [period, setPeriod] = useState('30');
  const [showAll, setShowAll] = useState(false);
  const since = sinceFor(period);
  const st = useMemo(() => responseStats(data.sends, { sinceISO: since }), [data, period]);
  const perPatient = useMemo(() => {
    const by = new Map();
    for (const s of data.sends) {
      if (!by.has(s.patient_id)) by.set(s.patient_id, []);
      by.get(s.patient_id).push(s);
    }
    const names = new Map(data.patients.map((p) => [p.id, p.name]));
    return [...by].map(([id, list]) => ({ id, name: names.get(id) || '—', ...responseStats(list, { sinceISO: since }) }))
      .filter((r) => r.closed > 0)
      .sort((a, b) => a.rate - b.rate || b.closed - a.closed || a.name.localeCompare(b.name));
  }, [data, period]);
  const shown = showAll ? perPatient : perPatient.slice(0, 10);
  const pctText = (v) => (v == null ? '–' : `${v}%`);

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📊 Taxa de resposta</h2>
        <div class="seg">${PERIODS.map(([k, l]) => html`<button class=${period === k ? 'on' : ''} onClick=${() => setPeriod(k)}>${l}</button>`)}</div>
      </div>
      ${st.total === 0 && html`<p class="muted">Nenhum envio neste período.</p>`}
      ${st.total > 0 && html`
        <div class="stats">
          <div class="stat stat-main"><div class="stat-label">Taxa de resposta</div><div class="stat-value">${pctText(st.rate)}</div>
            <div class="stat-sub">${st.answered} de ${st.closed} questionário(s)</div></div>
          <div class="stat"><div class="stat-label">Responderam depois do lembrete</div><div class="stat-value">${pctText(st.reminderRate)}</div>
            <div class="stat-sub">${st.answeredAfterReminder} de ${st.reminders} lembrete(s)</div></div>
          <div class="stat"><div class="stat-label">Tempo típico de resposta</div><div class="stat-value small-value">${durationLabel(st.medianHours)}</div>
            <div class="stat-sub">metade responde nesse prazo</div></div>
          <div class="stat"><div class="stat-label">Em aberto</div><div class="stat-value">${st.open}</div>
            <div class="stat-sub">enviados há menos de 7 dias</div></div>
        </div>
        <p class="muted small">
          ${st.reminders > 0
            ? `O lembrete recuperou ${st.answeredAfterReminder} resposta(s): sem ele, a taxa seria ${pctText(st.closed ? Math.round((st.answeredWithoutReminder / st.closed) * 100) : null)}.`
            : 'Ainda não há lembretes enviados neste período para medir o efeito.'}${' '}Os questionários enviados há menos de 7 dias e ainda sem resposta ficam fora da conta.
        </p>
        ${perPatient.length > 0 && html`
          <h3 class="calc-step">Por paciente <span class="muted small">(menor taxa primeiro)</span></h3>
          <table class="table">
            <thead><tr><th>Paciente</th><th class="num">Respondidos</th><th class="num">Taxa</th></tr></thead>
            <tbody>
              ${shown.map((r) => html`
                <tr>
                  <td><a href=${'#/paciente/' + r.id}>${r.name}</a></td>
                  <td class="num">${r.answered} de ${r.closed}</td>
                  <td class="num"><span class=${'rate ' + (r.rate >= 70 ? 'rate-good' : r.rate >= 40 ? 'rate-mid' : 'rate-low')}>${r.rate}%</span></td>
                </tr>`)}
            </tbody>
          </table>
          ${perPatient.length > 10 && html`<button class="btn btn-sm btn-ghost show-more" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Mostrar menos' : `Mostrar todos (${perPatient.length})`}</button>`}`}`}
    </section>`;
}

function LogTab({ data }) {
  const [viewing, setViewing] = useState(null);
  const [onlyAnswered, setOnlyAnswered] = useState(false);
  const pById = useMemo(() => new Map(data.patients.map((p) => [p.id, p])), [data]);
  const qById = useMemo(() => new Map(data.questionnaires.map((q) => [q.id, q])), [data]);
  const today = todayISO();
  const rows = data.sends.filter((s) => !onlyAnswered || s.answered_at).slice(0, 200);

  return html`
    <${StatsCard} data=${data} />
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">Envios e respostas <span class="muted small">(${data.sends.length})</span></h2>
        <label class="checkbox-line small"><input type="checkbox" checked=${onlyAnswered} onChange=${(e) => setOnlyAnswered(e.target.checked)} /> Só respondidos</label>
      </div>
      ${rows.length === 0 && html`<p class="muted">Nenhum envio ainda.</p>`}
      ${rows.length > 0 && html`
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Paciente</th><th>Questionário</th><th>Enviado em</th><th>Situação</th></tr></thead>
            <tbody>
              ${rows.map((s) => {
                const p = pById.get(s.patient_id);
                const sent = dateOf(s.sent_at);
                return html`
                  <tr>
                    <td>${p ? html`<a href=${'#/paciente/' + p.id}>${p.name}</a>` : '—'}</td>
                    <td>${qById.get(s.questionnaire_id)?.name || '—'}</td>
                    <td>${fmtDate(sent)}${s.resent_at ? html` <span class="muted small">(lembrete ${fmtDate(dateOf(s.resent_at))})</span>` : ''}</td>
                    <td>
                      ${s.answered_at
                        ? html`<button class="badge badge-green as-link" onClick=${() => setViewing(s)}>🟢 Respondido (${daysAgoLabel(dateOf(s.answered_at)).toLowerCase()}) · ver</button>`
                        : s.expired_at
                          ? html`<span class="badge">⚪ Sem resposta (link vencido)</span>`
                          : html`<span class="badge badge-warn">🟡 Pendente (há ${daysBetween(sent, today)} dia(s))</span>`}
                    </td>
                  </tr>`;
              })}
            </tbody>
          </table>
        </div>`}
    </section>
    ${viewing && html`<${ResponseModal} send=${viewing} questionnaire=${qById.get(viewing.questionnaire_id)} patient=${pById.get(viewing.patient_id)} onClose=${() => setViewing(null)} />`}`;
}

export function AnswersView({ questionnaire, answers }) {
  const qs = questionnaire?.questions || [];
  return html`${qs.map((q) => {
    const v = answers?.[q.id];
    if (v == null || v === '') return null;
    return html`<div class="qa"><div class="qa-q">${q.label}</div><div class="qa-a">${q.type === 'scale' ? html`<strong>${v}</strong> <span class="muted small">(de ${q.min} a ${q.max})</span>` : v}</div></div>`;
  })}`;
}

function ResponseModal({ send, questionnaire, patient, onClose }) {
  const [resp, setResp] = useState(null);
  useEffect(() => {
    run(supabase.from('questionnaire_responses').select('*').eq('send_id', send.id)).then((r) => setResp(r[0] || {}));
  }, [send.id]);
  return html`
    <${Modal} title=${`${patient?.name || ''} · ${fmtDate(dateOf(send.answered_at))}`} onClose=${onClose}>
      ${!resp ? html`<${Loading} />` : html`<${AnswersView} questionnaire=${questionnaire} answers=${resp.answers} />`}
    <//>`;
}

// ---------------------------------------------------------------- Modelos

const EXAMPLE = {
  name: 'Acompanhamento semanal',
  questions: [
    { type: 'scale', label: 'Como funcionou seu intestino nesta semana?', min: 0, max: 5, min_label: 'Não funcionou', max_label: 'Funcionou super bem' },
    { type: 'scale', label: 'Como foi a qualidade do seu sono?', min: 0, max: 5, min_label: 'Muito ruim', max_label: 'Excelente' },
    { type: 'scale', label: 'Quanto você conseguiu seguir o plano alimentar?', min: 0, max: 5, min_label: 'Nada', max_label: 'Totalmente' },
    { type: 'choice', label: 'Quanta água você bebeu por dia, em média?', options: ['Menos de 1 litro', '1 a 2 litros', 'Mais de 2 litros'] },
    { type: 'text', label: 'Conte como foi a sua semana (alimentação, rotina, dificuldades, conquistas)' },
  ],
};
const qid = () => 'q' + Math.random().toString(36).slice(2, 8);

function ModelsTab({ data, reload }) {
  const [editing, setEditing] = useState(null); // questionário (novo ou existente)
  const [error, setError] = useState(null);
  const sendCount = useMemo(() => {
    const m = new Map();
    for (const s of data.sends) m.set(s.questionnaire_id, (m.get(s.questionnaire_id) || 0) + 1);
    return m;
  }, [data]);

  async function act(fn) {
    setError(null);
    try { await fn(); await reload(); } catch (err) { setError(err); }
  }
  const makeDefault = (q) => act(async () => {
    await run(supabase.from('questionnaires').update({ is_default: false }).eq('is_default', true));
    await run(supabase.from('questionnaires').update({ is_default: true, active: true }).eq('id', q.id));
  });
  const toggleActive = (q) => act(() => run(supabase.from('questionnaires').update({ active: !q.active, is_default: q.active ? false : q.is_default }).eq('id', q.id)));
  const remove = (q) => confirm(`Apagar o modelo "${q.name}"?`) && act(() => run(supabase.from('questionnaires').delete().eq('id', q.id)));
  const duplicate = (q) => setEditing({ name: q.name + ' (nova versão)', questions: q.questions.map((x) => ({ ...x, id: qid() })) });

  return html`
    <${ErrorBox} error=${error} />
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">Modelos de questionário</h2>
        <div class="row-actions">
          ${data.questionnaires.length === 0 && html`<button class="btn" onClick=${() => setEditing({ ...EXAMPLE, questions: EXAMPLE.questions.map((x) => ({ ...x, id: qid() })) })}>✨ Começar pelo exemplo</button>`}
          <button class="btn btn-primary" onClick=${() => setEditing({ name: '', questions: [] })}>➕ Criar novo questionário</button>
        </div>
      </div>
      <p class="muted small">Só um modelo é o <strong>padrão</strong> (é o que vai para todos). Um modelo que já foi enviado não pode ser editado, para não bagunçar o histórico:
        use “Nova versão a partir deste”, marque a nova como padrão e desative a antiga. As respostas antigas continuam guardadas.</p>
      ${data.questionnaires.length === 0 && html`<p class="muted">Nenhum modelo ainda.</p>`}
      <ul class="history">
        ${data.questionnaires.map((q) => {
          const used = sendCount.get(q.id) || 0;
          return html`
            <li class="history-item">
              <div class="history-row" style="cursor:default">
                <span>
                  <strong>${q.name}</strong>
                  ${q.is_default && html` <span class="badge badge-green">padrão</span>`}
                  ${!q.active && html` <span class="badge">inativo</span>`}
                  <span class="muted small"> · ${q.questions.length} pergunta(s) · ${used} envio(s)</span>
                </span>
                <span class="row-actions">
                  ${!q.is_default && q.active && html`<button class="btn btn-sm" onClick=${() => makeDefault(q)}>Definir como padrão</button>`}
                  ${used === 0
                    ? html`<button class="btn btn-sm" onClick=${() => setEditing(q)}>✏️ Editar</button>`
                    : html`<button class="btn btn-sm" onClick=${() => setEditing({ ...q, readOnly: true })}>👁️ Ver</button>`}
                  <button class="btn btn-sm" onClick=${() => duplicate(q)}>Nova versão a partir deste</button>
                  <button class="btn btn-sm btn-ghost" onClick=${() => toggleActive(q)}>${q.active ? 'Desativar' : 'Ativar'}</button>
                  ${used === 0 && html`<button class="btn btn-sm btn-danger-ghost" onClick=${() => remove(q)}>Apagar</button>`}
                </span>
              </div>
            </li>`;
        })}
      </ul>
    </section>
    ${editing && html`<${Editor} initial=${editing} isFirst=${data.questionnaires.length === 0} onClose=${() => setEditing(null)} onSaved=${async () => { setEditing(null); await reload(); }} />`}`;
}

function Editor({ initial, isFirst, onClose, onSaved }) {
  const [name, setName] = useState(initial.name || '');
  const [questions, setQuestions] = useState((initial.questions || []).map((q) => ({ ...q, id: q.id || qid() })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ro = !!initial.readOnly;

  const upd = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const add = (type) => setQuestions([...questions, {
    id: qid(), type, label: '',
    ...(type === 'scale' ? { min: 0, max: 5, min_label: '', max_label: '' } : {}),
    ...(type === 'choice' ? { options: ['', ''] } : {}),
  }]);
  const move = (i, d) => { const n = [...questions]; [n[i], n[i + d]] = [n[i + d], n[i]]; setQuestions(n); };

  async function save() {
    setError(null);
    const clean = questions.map((q) => ({
      ...q,
      label: q.label.trim(),
      ...(q.type === 'scale' ? { min: Number(q.min), max: Number(q.max) } : {}),
      ...(q.type === 'choice' ? { options: q.options.map((o) => o.trim()).filter(Boolean) } : {}),
    }));
    if (!name.trim()) return setError(new Error('Dê um nome ao questionário.'));
    if (!clean.length) return setError(new Error('Adicione pelo menos uma pergunta.'));
    if (clean.some((q) => !q.label)) return setError(new Error('Há pergunta sem texto.'));
    if (clean.some((q) => q.type === 'scale' && !(Number.isInteger(q.min) && Number.isInteger(q.max) && q.max > q.min && q.max - q.min <= 10))) {
      return setError(new Error('Nas escalas, use números inteiros com o máximo maior que o mínimo (até 10 pontos).'));
    }
    if (clean.some((q) => q.type === 'choice' && q.options.length < 2)) return setError(new Error('Múltipla escolha precisa de pelo menos 2 opções.'));
    setBusy(true);
    try {
      if (initial.id) await run(supabase.from('questionnaires').update({ name: name.trim(), questions: clean }).eq('id', initial.id));
      else await run(supabase.from('questionnaires').insert({ name: name.trim(), questions: clean, is_default: isFirst }));
      await onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return html`
    <${Modal} title=${ro ? 'Questionário (somente leitura)' : initial.id ? 'Editar questionário' : 'Novo questionário'} onClose=${onClose} wide>
      ${ro && html`<div class="alert">Este modelo já foi enviado e não pode ser editado. Use “Nova versão a partir deste”.</div>`}
      <${Field} label="Nome do questionário"><input value=${name} disabled=${ro} onInput=${(e) => setName(e.target.value)} placeholder="Ex.: Acompanhamento semanal" /><//>
      ${questions.map((q, i) => html`
        <div class="q-edit">
          <div class="q-edit-head">
            <span class="badge">${i + 1}. ${QUESTION_TYPES[q.type]}</span>
            ${!ro && html`
              <span class="row-actions">
                <button class="btn btn-sm btn-ghost" disabled=${i === 0} onClick=${() => move(i, -1)}>↑</button>
                <button class="btn btn-sm btn-ghost" disabled=${i === questions.length - 1} onClick=${() => move(i, 1)}>↓</button>
                <button class="btn btn-sm btn-danger-ghost" onClick=${() => setQuestions(questions.filter((_, j) => j !== i))}>Remover</button>
              </span>`}
          </div>
          <input value=${q.label} disabled=${ro} placeholder="Texto da pergunta" onInput=${(e) => upd(i, { label: e.target.value })} />
          ${q.type === 'scale' && html`
            <div class="q-scale">
              <label>De <input type="number" value=${q.min} disabled=${ro} onInput=${(e) => upd(i, { min: e.target.value })} /></label>
              <label>a <input type="number" value=${q.max} disabled=${ro} onInput=${(e) => upd(i, { max: e.target.value })} /></label>
              <input value=${q.min_label || ''} disabled=${ro} placeholder="Legenda do mínimo (ex.: não funcionou)" onInput=${(e) => upd(i, { min_label: e.target.value })} />
              <input value=${q.max_label || ''} disabled=${ro} placeholder="Legenda do máximo (ex.: funcionou super bem)" onInput=${(e) => upd(i, { max_label: e.target.value })} />
            </div>`}
          ${q.type === 'choice' && html`
            <div class="q-options">
              ${q.options.map((o, k) => html`
                <div class="q-option">
                  <input value=${o} disabled=${ro} placeholder=${'Opção ' + (k + 1)} onInput=${(e) => upd(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} />
                  ${!ro && q.options.length > 2 && html`<button class="btn btn-sm btn-ghost" onClick=${() => upd(i, { options: q.options.filter((_, m) => m !== k) })}>✕</button>`}
                </div>`)}
              ${!ro && html`<button class="btn btn-sm btn-ghost" onClick=${() => upd(i, { options: [...q.options, ''] })}>+ opção</button>`}
            </div>`}
        </div>`)}
      ${!ro && html`
        <div class="row-actions" style="justify-content:flex-start;margin:8px 0 4px">
          <button class="btn btn-sm" onClick=${() => add('scale')}>+ Escala (0 a 5)</button>
          <button class="btn btn-sm" onClick=${() => add('text')}>+ Texto livre</button>
          <button class="btn btn-sm" onClick=${() => add('choice')}>+ Múltipla escolha</button>
        </div>`}
      <${ErrorBox} error=${error} />
      <div class="actions">
        <button class="btn" onClick=${onClose}>${ro ? 'Fechar' : 'Cancelar'}</button>
        ${!ro && html`<button class="btn btn-primary" disabled=${busy} onClick=${save}>${busy ? 'Salvando…' : '💾 Salvar questionário'}</button>`}
      </div>
    <//>`;
}

// ---------------------------------------------------------------- Configurações de envio

function ConfigTab({ data, reload }) {
  const [freq, setFreq] = useState(String(data.settings.questionnaire_frequency_days || DEFAULT_FREQUENCY));
  const [start, setStart] = useState(data.settings.questionnaire_start_date || DEFAULT_START_DATE);
  const [msg, setMsg] = useState(data.settings.whatsapp_message || DEFAULT_MESSAGE);
  const [rem, setRem] = useState(data.settings.whatsapp_reminder || DEFAULT_REMINDER);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    const f = Number(freq);
    if (!Number.isInteger(f) || f < 1 || f > 60) return setError(new Error('A frequência deve ser um número de dias entre 1 e 60.'));
    const hasLink = (t) => /\[(link|inserir link do question[aá]rio)\]/i.test(t);
    if (!hasLink(msg) || !hasLink(rem)) return setError(new Error('As mensagens precisam ter [Link] no lugar onde vai o link do questionário.'));
    try {
      await run(supabase.from('app_settings').upsert([
        { key: 'questionnaire_frequency_days', value: f },
        { key: 'questionnaire_start_date', value: start || DEFAULT_START_DATE },
        { key: 'whatsapp_message', value: msg },
        { key: 'whatsapp_reminder', value: rem },
      ]));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      reload();
    } catch (err) {
      setError(err);
    }
  }

  return html`
    <section class="card">
      <h2 class="card-title">Frequência</h2>
      <label class="adjust-row">Enviar a cada <input type="number" min="1" max="60" value=${freq} onInput=${(e) => setFreq(e.target.value)} /> dias, contados a partir da última consulta ou do último questionário.</label>
      <label class="adjust-row">Começar a contar a partir de <input type="date" style="width:auto" value=${start} onInput=${(e) => setStart(e.target.value)} /> <span class="muted small">(antes dessa data não conta prazo; o primeiro envio sai ${freq} dias depois dela)</span></label>
      <p class="muted small">Envia N dias depois da última consulta ou do último questionário, até a véspera da próxima consulta; no dia da consulta não envia. A consulta zera a contagem. Quem não responde 2 seguidos para de receber até a próxima consulta. Quem não responde em 3 dias aparece na lista de lembretes.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Mensagem do WhatsApp</h2>
      <p class="muted small">Use <strong>[Nome]</strong> para o primeiro nome do paciente e <strong>[Link]</strong> para o link do questionário.</p>
      <${AutoText} rows=${8} value=${msg} onInput=${setMsg} />
      <h3 class="calc-step">Mensagem do lembrete</h3>
      <${AutoText} rows=${4} value=${rem} onInput=${setRem} />
      <h3 class="calc-step">Como fica</h3>
      <div class="quote">${fillMessage(msg, 'Maria Silva', formLink('exemplo-de-link'))}</div>
      <${ErrorBox} error=${error} />
      <div class="actions" style="justify-content:flex-start">
        <button class="btn btn-primary" onClick=${save}>💾 Salvar</button>
        ${saved && html`<span class="muted small">✓ Salvo</span>`}
        <button class="btn btn-ghost btn-sm" onClick=${() => { setMsg(DEFAULT_MESSAGE); setRem(DEFAULT_REMINDER); }}>Voltar ao texto original</button>
      </div>
    </section>`;
}
