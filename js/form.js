// Formulário que o paciente abre pelo link do WhatsApp. Não exige login: o link (token) identifica o envio.
import { html, render, useState, useEffect } from './lib/preact.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const token = new URLSearchParams(location.search).get('t') || '';

function Done({ icon, title, text }) {
  return html`<div class="form-done"><div class="big">${icon}</div><h1>${title}</h1><p class="muted">${text}</p></div>`;
}

function Form() {
  const [state, setState] = useState({ status: 'loading' });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.rpc('get_questionnaire', { p_token: token }).then(({ data, error: err }) => {
      if (err) setState({ status: 'error' });
      else setState(data);
    });
  }, []);

  const set = (id, v) => { setAnswers({ ...answers, [id]: v }); setError(''); };

  async function submit(e) {
    e.preventDefault();
    const filled = Object.values(answers).filter((v) => v !== '' && v != null);
    if (!filled.length) { setError('Responda pelo menos uma pergunta antes de enviar.'); return; }
    setBusy(true);
    setError('');
    const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim().slice(0, 4000) : v]));
    const { data, error: err } = await supabase.rpc('submit_questionnaire', { p_token: token, p_answers: clean });
    setBusy(false);
    if (err) { setError('Não foi possível enviar agora. Verifique a internet e tente de novo.'); return; }
    setState({ ...state, status: data === 'ok' ? 'thanks' : data });
  }

  const name = state.first_name ? `, ${state.first_name}` : '';
  switch (state.status) {
    case 'loading': return html`<div class="loading">Carregando…</div>`;
    case 'thanks': return html`<${Done} icon="💚" title=${`Obrigada${name}!`} text="Suas respostas foram enviadas para a sua nutricionista. Boa semana! 🌱" />`;
    case 'answered': return html`<${Done} icon="✅" title=${`Tudo certo${name}!`} text="Este questionário já foi respondido. Obrigada!" />`;
    case 'expired': return html`<${Done} icon="⏳" title="Este link expirou" text="Já existe um questionário mais recente, ou este não está mais disponível. Fale com a sua nutricionista." />`;
    case 'ok': break;
    case 'error': return html`<${Done} icon="📶" title="Não foi possível abrir" text="Verifique a sua internet e abra o link de novo." />`;
    default: return html`<${Done} icon="🔗" title="Link inválido" text="Confira se o link foi copiado inteiro, ou peça um novo à sua nutricionista." />`;
  }

  return html`
    <form class="form-wrap" onSubmit=${submit}>
      <div class="form-hero">
        <h1>Olá${name}! 👋</h1>
        <p class="muted">${state.title}</p>
      </div>
      ${state.questions.map((q) => html`
        <div class="form-q">
          <span class="form-q-label">${q.label}</span>
          ${q.type === 'scale' && html`
            <div class="scale" role="radiogroup" aria-label=${q.label}>
              ${Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((n) => html`
                <button type="button" role="radio" aria-checked=${answers[q.id] === n} class=${answers[q.id] === n ? 'on' : ''} onClick=${() => set(q.id, n)}>${n}</button>`)}
            </div>
            ${(q.min_label || q.max_label) && html`<div class="scale-legend"><span>${q.min} = ${q.min_label || ''}</span><span>${q.max} = ${q.max_label || ''}</span></div>`}`}
          ${q.type === 'choice' && html`
            <div class="choices" role="radiogroup" aria-label=${q.label}>
              ${q.options.map((o) => html`<button type="button" role="radio" aria-checked=${answers[q.id] === o} class=${answers[q.id] === o ? 'on' : ''} onClick=${() => set(q.id, o)}>${o}</button>`)}
            </div>`}
          ${q.type === 'text' && html`<textarea rows="4" maxlength="4000" value=${answers[q.id] || ''} onInput=${(e) => set(q.id, e.target.value)} placeholder="Escreva aqui…"></textarea>`}
        </div>`)}
      ${error && html`<div class="alert alert-error">${error}</div>`}
      <button class="btn btn-primary form-submit" disabled=${busy}>${busy ? 'Enviando…' : 'Enviar respostas'}</button>
    </form>`;
}

render(html`<${Form} />`, document.getElementById('form'));
