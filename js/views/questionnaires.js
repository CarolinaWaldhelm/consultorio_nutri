// Aba Questionários: envios de hoje, modelos, log de envios e configurações de envio.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, daysBetween, todayISO, daysAgoLabel } from '../lib/util.js';
import { loadAgenda, consultationEvents, matchEvent, windowDays } from '../lib/agenda.js';
import {
  planSends, consultSoonIds, newToken, formLink, fillMessage, whatsappUrl, dateOf,
  DEFAULT_FREQUENCY, DEFAULT_MESSAGE, DEFAULT_REMINDER, QUESTION_TYPES,
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
  return { frequency, ...planSends({ patients: data.patients, sends: data.sends, soonIds, frequency }) };
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
  const [done, setDone] = useState({}); // patientId -> send criado agora
  const [error, setError] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const def = data.questionnaires.find((q) => q.is_default && q.active);
  const message = data.settings.whatsapp_message || DEFAULT_MESSAGE;
  const reminder = data.settings.whatsapp_reminder || DEFAULT_REMINDER;

  async function send(p) {
    // Abre a janela já no clique (o navegador bloqueia janelas abertas depois).
    const win = window.open('', '_blank');
    try {
      const token = newToken();
      const [row] = await run(supabase.from('questionnaire_sends').insert({ patient_id: p.id, questionnaire_id: def.id, token }).select('*'));
      // O link anterior, se ainda não respondido, vence.
      await run(supabase.from('questionnaire_sends').update({ expired_at: new Date().toISOString() })
        .eq('patient_id', p.id).is('answered_at', null).is('expired_at', null).neq('id', row.id));
      setDone((d) => ({ ...d, [p.id]: row }));
      const url = whatsappUrl(p.phone, fillMessage(message, p.name, formLink(token)));
      if (win) win.location.href = url; else window.open(url, '_blank');
    } catch (err) {
      win?.close();
      setError(err);
    }
  }

  async function undo(p) {
    const row = done[p.id];
    if (!confirm(`Desfazer o envio para ${p.name}? O link deixa de funcionar.`)) return;
    await run(supabase.from('questionnaire_sends').delete().eq('id', row.id));
    setDone((d) => { const n = { ...d }; delete n[p.id]; return n; });
  }

  async function remind({ patient, send: s }) {
    const win = window.open('', '_blank');
    try {
      await run(supabase.from('questionnaire_sends').update({ resent_at: new Date().toISOString() }).eq('id', s.id));
      setDone((d) => ({ ...d, ['r:' + patient.id]: true }));
      const url = whatsappUrl(patient.phone, fillMessage(reminder, patient.name, formLink(s.token)));
      if (win) win.location.href = url; else window.open(url, '_blank');
    } catch (err) {
      win?.close();
      setError(err);
    }
  }

  async function pause(p) {
    if (!confirm(`Pausar os questionários de ${p.name}? Dá para reativar na ficha do paciente.`)) return;
    await run(supabase.from('patients').update({ questionnaires_active: false }).eq('id', p.id));
    reload();
  }

  if (!def) {
    return html`
      <section class="card empty">
        <h2>Ainda não há questionário padrão</h2>
        <p>Crie o questionário (ou use o exemplo pronto) em “Modelos” e marque como padrão.</p>
        <button class="btn btn-primary" onClick=${goModels}>Ir para Modelos</button>
      </section>`;
  }

  const sentCount = Object.keys(done).filter((k) => !k.startsWith('r:')).length;
  return html`
    <${ErrorBox} error=${error} />
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">Enviar hoje <span class="muted small">(${plan.due.length}${sentCount ? ` · ${sentCount} enviado(s)` : ''})</span></h2>
        <span class="muted small">Questionário: <strong>${def.name}</strong> · a cada ${plan.frequency} dias após a última consulta</span>
      </div>
      ${plan.due.length === 0 && html`<p class="muted">Ninguém para receber hoje. 🎉</p>`}
      ${plan.due.length > 0 && html`
        <p class="muted small">Clique em “Enviar”: o WhatsApp abre na conversa do paciente com a mensagem pronta. Só falta apertar enviar lá.</p>
        <table class="table">
          <thead><tr><th>Paciente</th><th>Última consulta</th><th></th></tr></thead>
          <tbody>
            ${plan.due.map(({ patient: p }) => html`
              <tr>
                <td><a href=${'#/paciente/' + p.id}>${p.name}</a></td>
                <td>${fmtDate(p.last_consult)} <span class="muted small">(${daysAgoLabel(p.last_consult).toLowerCase()})</span></td>
                <td class="row-actions">
                  ${done[p.id]
                    ? html`<span class="badge badge-green">✓ Enviado</span><button class="btn btn-sm btn-ghost" onClick=${() => undo(p)}>Desfazer</button>`
                    : html`<button class="btn btn-sm btn-ghost" onClick=${() => pause(p)}>Pausar paciente</button><button class="btn btn-sm btn-primary" onClick=${() => send(p)}>📲 Enviar</button>`}
                </td>
              </tr>`)}
          </tbody>
        </table>`}
    </section>

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
                  ${done['r:' + r.patient.id]
                    ? html`<span class="badge badge-green">✓ Lembrete enviado</span>`
                    : html`<button class="btn btn-sm" onClick=${() => remind(r)}>📲 Reenviar lembrete</button>`}
                </td>
              </tr>`)}
          </tbody>
        </table>
      </section>`}

    ${plan.noPhone.length > 0 && html`
      <section class="card">
        <h2 class="card-title">📞 Sem telefone <span class="muted small">(deveriam receber hoje)</span></h2>
        <p class="muted small">Abra a ficha e use “Editar cadastro” para colocar o telefone com DDD.</p>
        <div class="chips">${plan.noPhone.map(({ patient: p }) => html`<a class="chip" href=${'#/paciente/' + p.id}>${p.name}</a>`)}</div>
      </section>`}

    ${(plan.soon.length > 0 || plan.autoPaused.length > 0) && html`
      <button class="btn btn-sm btn-ghost" onClick=${() => setShowSkipped(!showSkipped)}>
        ${showSkipped ? '▾' : '▸'} Não recebem hoje: ${plan.soon.length} com consulta em até 3 dias · ${plan.autoPaused.length} pausado(s) automaticamente
      </button>
      ${showSkipped && html`
        <section class="card">
          ${plan.soon.length > 0 && html`<p><strong>Consulta em até 3 dias:</strong> ${plan.soon.map((x) => x.patient.name).join(', ')}</p>`}
          ${plan.autoPaused.length > 0 && html`
            <p><strong>Pausados automaticamente</strong> (2 questionários seguidos sem resposta; voltam a receber depois da próxima consulta):
              ${plan.autoPaused.map((x) => x.patient.name).join(', ')}</p>`}
        </section>`}`}`;
}

// ---------------------------------------------------------------- Log

function LogTab({ data }) {
  const [viewing, setViewing] = useState(null);
  const [onlyAnswered, setOnlyAnswered] = useState(false);
  const pById = useMemo(() => new Map(data.patients.map((p) => [p.id, p])), [data]);
  const qById = useMemo(() => new Map(data.questionnaires.map((q) => [q.id, q])), [data]);
  const today = todayISO();
  const rows = data.sends.filter((s) => !onlyAnswered || s.answered_at).slice(0, 200);

  return html`
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
      <label class="adjust-row">Enviar a cada <input type="number" min="1" max="60" value=${freq} onInput=${(e) => setFreq(e.target.value)} /> dias, contados a partir da última consulta.</label>
      <p class="muted small">Não envia se houver consulta marcada nos próximos 3 dias. Lembrete depois de 3 dias sem resposta. Pausa automática depois de 2 questionários seguidos sem resposta (volta na próxima consulta).</p>
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
