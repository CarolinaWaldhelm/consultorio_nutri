// Página que o paciente abre pelo link do lembrete de consulta: confirma, pede para remarcar ou avisa que não vai.
import { html, render, useState, useEffect } from './lib/preact.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const token = new URLSearchParams(location.search).get('t') || '';
const WEEKDAY = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const OPTIONS = [
  ['confirmado', '✅ Confirmo minha consulta'],
  ['remarcar', '📅 Preciso remarcar'],
  ['nao_vai', '❌ Não vou poder ir'],
];
const DAYS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado']];
const SLOTS = [['09-11', '09:00 às 11:00'], ['11-13', '11:00 às 13:00'], ['14-17', '14:00 às 17:00']];

const THANKS = {
  confirmado: ['💚', 'Consulta confirmada!', 'Obrigada! Até lá. 🌱'],
  remarcar: ['📅', 'Pedido de remarcação enviado', 'Sua nutricionista vai falar com você para combinar um novo horário.'],
  nao_vai: ['🙏', 'Obrigada por avisar', 'Sua nutricionista vai entrar em contato.'],
};

function when(date, time) {
  const d = new Date(date + 'T12:00:00Z');
  return `${WEEKDAY[d.getUTCDay()]}, ${date.slice(8, 10)}/${date.slice(5, 7)}${time ? ` às ${time}` : ''}`;
}

function Done({ icon, title, text, children }) {
  return html`<div class="form-done"><div class="big">${icon}</div><h1>${title}</h1><p class="muted">${text}</p>${children}</div>`;
}

function Confirm() {
  const [st, setSt] = useState({ status: 'loading' });
  const [choice, setChoice] = useState(null);
  const [note, setNote] = useState('');
  const [days, setDays] = useState([]);
  const [slots, setSlots] = useState([]);
  const toggle = (list, set, v) => { set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]); setError(''); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    supabase.rpc('get_appointment', { p_token: token }).then(({ data, error: err }) => setSt(err ? { status: 'error' } : data));
  }, []);

  async function send(resp) {
    setError('');
    if (resp === 'remarcar' && (!days.length || !slots.length)) {
      setError('Escolha pelo menos um dia da semana e um horário que ficam melhores para você.');
      return;
    }
    const prefs = resp === 'remarcar' ? { days, slots } : null;
    setBusy(true);
    const { data, error: err } = await supabase.rpc('respond_appointment', { p_token: token, p_response: resp, p_note: note.trim() || null, p_prefs: prefs });
    setBusy(false);
    if (err) { setError('Não foi possível enviar agora. Verifique a internet e tente de novo.'); return; }
    if (data === 'closed') { setSt({ ...st, open: false }); return; }
    if (data !== 'ok') { setSt({ status: 'invalid' }); return; }
    setDone(resp);
  }

  if (st.status === 'loading') return html`<div class="loading">Carregando…</div>`;
  if (st.status === 'error') return html`<${Done} icon="📶" title="Não foi possível abrir" text="Verifique a sua internet e abra o link de novo." />`;
  if (st.status !== 'ok') return html`<${Done} icon="🔗" title="Link inválido" text="Confira se o link foi copiado inteiro, ou fale com a sua nutricionista." />`;

  if (done) {
    const [icon, title, text] = THANKS[done];
    return html`<${Done} icon=${icon} title=${title} text=${text}>
      <p class="muted small">Consulta: ${when(st.date, st.time)}</p>
      <button class="btn btn-ghost" onClick=${() => { setSt({ ...st, response: done }); setDone(null); setChoice(null); }}>Mudar minha resposta</button>
    <//>`;
  }
  if (!st.open) {
    return html`<${Done} icon="⏳" title="Esta consulta já passou" text="Para marcar uma nova, fale com a sua nutricionista." />`;
  }

  const name = st.first_name ? `, ${st.first_name}` : '';
  return html`
    <div class="form-wrap">
      <div class="form-hero">
        <h1>Olá${name}! 👋</h1>
        <p>Sua consulta de nutrição está marcada para</p>
        <p class="confirm-when">${when(st.date, st.time)}</p>
        ${st.response && html`<p class="muted small">Sua resposta atual: <strong>${OPTIONS.find((o) => o[0] === st.response)?.[1]}</strong>. Pode mudar abaixo.</p>`}
      </div>
      <div class="choices confirm-choices">
        ${OPTIONS.map(([k, label]) => html`
          <button type="button" class=${choice === k ? 'on' : ''} disabled=${busy}
            onClick=${() => (k === 'confirmado' ? send(k) : setChoice(k))}>${label}</button>`)}
      </div>
      ${choice === 'remarcar' && html`
        <div class="form-q" style="margin-top:12px">
          <span class="form-q-label">Quais dias da semana ficam melhores?</span>
          <div class="pick-chips">${DAYS.map(([k, l]) => html`
            <button type="button" class=${days.includes(k) ? 'on' : ''} aria-pressed=${days.includes(k)} onClick=${() => toggle(days, setDays, k)}>${l}</button>`)}</div>
          <span class="form-q-label" style="margin-top:14px">E quais horários?</span>
          <div class="pick-chips">${SLOTS.map(([k, l]) => html`
            <button type="button" class=${slots.includes(k) ? 'on' : ''} aria-pressed=${slots.includes(k)} onClick=${() => toggle(slots, setSlots, k)}>${l}</button>`)}</div>
          <p class="muted small">Pode marcar mais de um. Sua nutricionista vai ver na agenda e te propor um horário.</p>
        </div>`}
      ${choice && choice !== 'confirmado' && html`
        <div class="form-q" style="margin-top:12px">
          <span class="form-q-label">Quer deixar um recado? <span class="muted small">(opcional)</span></span>
          <textarea rows="3" maxlength="1000" value=${note} onInput=${(e) => setNote(e.target.value)}
            placeholder=${choice === 'remarcar' ? 'Ex.: a partir da semana que vem' : 'Ex.: tive um imprevisto'}></textarea>
          <button class="btn btn-primary form-submit" disabled=${busy} onClick=${() => send(choice)}>${busy ? 'Enviando…' : 'Enviar'}</button>
        </div>`}
      ${error && html`<div class="alert alert-error">${error}</div>`}
    </div>`;
}

render(html`<${Confirm} />`, document.getElementById('confirm'));
