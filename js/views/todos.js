// Lembretes da tela inicial: o que não foi feito fica até ser feito; o que foi marcado como feito
// continua visível (riscado) só até a meia-noite do dia em que foi marcado.
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { todayISO } from '../lib/util.js';
import { dateOf } from '../lib/questionnaires.js';

export function TodoCard() {
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  async function load() {
    try {
      const today = todayISO();
      const rows = await run(supabase.from('todos').select('*').order('created_at'));
      // Feitos em dias anteriores: apagados (não ocupam espaço).
      const old = rows.filter((r) => r.done_at && dateOf(r.done_at) < today).map((r) => r.id);
      if (old.length) await run(supabase.from('todos').delete().in('id', old));
      setItems(rows.filter((r) => !old.includes(r.id)));
    } catch (err) {
      setError(err);
      setItems([]);
    }
  }
  useEffect(() => {
    load();
    // Passou da meia-noite com a página aberta: atualiza.
    let day = todayISO();
    const t = setInterval(() => { if (todayISO() !== day) { day = todayISO(); load(); } }, 60 * 1000);
    return () => clearInterval(t);
  }, []);

  async function add(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      const [row] = await run(supabase.from('todos').insert({ text: t.slice(0, 500) }).select('*'));
      setItems((xs) => [...xs, row]);
    } catch (err) { setError(err); }
  }
  async function toggle(it) {
    const done_at = it.done_at ? null : new Date().toISOString();
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, done_at } : x)));
    await run(supabase.from('todos').update({ done_at }).eq('id', it.id)).catch(setError);
  }
  async function remove(it) {
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    await run(supabase.from('todos').delete().eq('id', it.id)).catch(setError);
  }

  const pending = (items || []).filter((x) => !x.done_at);
  const done = (items || []).filter((x) => x.done_at);
  return html`
    <section class="card todo-card">
      <h2 class="card-title">✅ Lembretes <span class="muted small">${pending.length ? `(${pending.length} pendente${pending.length > 1 ? 's' : ''})` : ''}</span></h2>
      ${error && html`<div class="alert alert-error">Não foi possível salvar o lembrete. ${/todos/.test(String(error.message)) ? 'Rode o arquivo do banco (schema.sql) de novo no Supabase.' : error.message}</div>`}
      <form class="todo-add" onSubmit=${add}>
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Novo lembrete…" title="Digite e aperte Enter" maxlength="500" />
        <button class="btn btn-sm" disabled=${!text.trim()}>+</button>
      </form>
      ${items && !items.length && html`<p class="muted small">Nada pendente.</p>`}
      <ul class="todo-list">
        ${[...pending, ...done].map((it) => html`
          <li class=${it.done_at ? 'done' : ''}>
            <label>
              <input type="checkbox" checked=${!!it.done_at} onChange=${() => toggle(it)} />
              <span>${it.text}</span>
            </label>
            <button class="icon-btn small" title="Apagar" aria-label="Apagar lembrete" onClick=${() => remove(it)}>✕</button>
          </li>`)}
      </ul>
      ${done.length > 0 && html`<p class="muted small">Os feitos somem à meia-noite.</p>`}
    </section>`;
}
