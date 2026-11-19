// Rotinas: tarefas que se repetem todo dia ou todo mês. Aparecem até serem ticadas; ticada, some até o
// próximo dia (diária) ou o próximo mês (mensal). A mensal aparece a partir de um dia do mês escolhido.
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { todayISO, fmtDate } from '../lib/util.js';
import { dateOf } from '../lib/questionnaires.js';
import { Modal, ErrorBox } from './common.js';

export function isPending(r, today = todayISO()) {
  const done = r.last_done_at ? dateOf(r.last_done_at) : null;
  if (r.frequency === 'diaria') return !done || done < today;
  // Mensal: feita neste mês = não aparece. A partir do dia escolhido, aparece até ser feita.
  // Antes do dia, só aparece se a do mês passado também ficou sem fazer.
  const month = today.slice(0, 7);
  if (done && done.slice(0, 7) === month) return false;
  if (Number(today.slice(8, 10)) >= (r.month_day || 1)) return true;
  return !!done && done.slice(0, 7) < prevMonth(today);
}
function prevMonth(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function RoutinesCard() {
  const [items, setItems] = useState(null);
  const [managing, setManaging] = useState(false);
  const [showPlan, setShowPlan] = useState(false); // ver tudo o que está programado
  const [undo, setUndo] = useState(null); // { item, previous }
  const [error, setError] = useState(null);
  const [today, setToday] = useState(todayISO());

  const load = () => run(supabase.from('routines').select('*').order('position').order('created_at'))
    .then(setItems).catch((err) => { setError(err); setItems([]); });
  useEffect(() => {
    load();
    const t = setInterval(() => setToday(todayISO()), 60 * 1000); // virou o dia: as diárias voltam
    return () => clearInterval(t);
  }, []);

  async function tick(r) {
    const previous = r.last_done_at;
    const now = new Date().toISOString();
    setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, last_done_at: now } : x)));
    setUndo({ item: r, previous });
    setTimeout(() => setUndo((u) => (u?.item.id === r.id ? null : u)), 6000);
    await run(supabase.from('routines').update({ last_done_at: now }).eq('id', r.id)).catch(setError);
  }
  async function undoTick() {
    const { item, previous } = undo;
    setUndo(null);
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, last_done_at: previous } : x)));
    await run(supabase.from('routines').update({ last_done_at: previous }).eq('id', item.id)).catch(setError);
  }

  const daily = (items || []).filter((r) => r.frequency === 'diaria');
  const monthly = (items || []).filter((r) => r.frequency === 'mensal');
  const pendDaily = daily.filter((r) => isPending(r, today));
  const pendMonthly = monthly.filter((r) => isPending(r, today));

  const Row = (r) => html`
    <li>
      <label><input type="checkbox" onChange=${() => tick(r)} /><span>${r.text}</span></label>
    </li>`;

  return html`
    <section class="card todo-card routines-card">
      <h2 class="card-title" style="margin-bottom:4px">🔁 Rotinas</h2>
      <div class="routine-actions">
        ${items?.length > 0 && html`<button class="btn btn-sm btn-ghost" aria-expanded=${showPlan} onClick=${() => setShowPlan(!showPlan)}>${showPlan ? '▾ Vencimentos' : '▸ Vencimentos'}</button>`}
        <button class="btn btn-sm btn-ghost" onClick=${() => setManaging(true)}>⚙️ Gerenciar</button>
      </div>
      ${error && html`<div class="alert alert-error">Não foi possível carregar as rotinas. ${/routines/.test(String(error.message)) ? 'Rode o arquivo do banco (schema.sql) de novo no Supabase.' : error.message}</div>`}
      ${items && !items.length && html`<p class="muted small">Nenhuma rotina ainda. Clique em ⚙️ Gerenciar para criar as do dia a dia e as do mês.</p>`}
      ${daily.length > 0 && html`
        <div class="routine-group">Hoje ${pendDaily.length ? html`<span class="muted small">(${pendDaily.length})</span>` : ''}</div>
        ${pendDaily.length ? html`<ul class="todo-list">${pendDaily.map(Row)}</ul>` : html`<p class="muted small">✓ Todas as rotinas de hoje feitas.</p>`}`}
      ${monthly.length > 0 && html`
        <div class="routine-group">Este mês ${pendMonthly.length ? html`<span class="muted small">(${pendMonthly.length})</span>` : ''}</div>
        ${pendMonthly.length ? html`<ul class="todo-list">${pendMonthly.map(Row)}</ul>` : html`<p class="muted small">✓ Nada pendente este mês.</p>`}`}
      ${showPlan && html`<div class="routine-plan"><div class="routine-group">Todas as rotinas</div><${Plan} items=${items} today=${today} /></div>`}
      ${undo && html`<div class="undo-bar">✓ “${undo.item.text}” feito <button class="link-btn" onClick=${undoTick}>Desfazer</button></div>`}
    </section>
    ${managing && html`<${RoutinesModal} items=${items || []} onClose=${() => { setManaging(false); load(); }} />`}`;
}

/** Data de vencimento: diária = hoje (ou amanhã, se já feita); mensal = o dia do mês escolhido. */
export function dueDate(r, today = todayISO()) {
  const done = r.last_done_at ? dateOf(r.last_done_at) : null;
  const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (r.frequency === 'diaria') return done === today ? plusDays(today, 1) : today;
  const day = String(r.month_day || 1).padStart(2, '0');
  const month = today.slice(0, 7);
  const next = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
  if (done && done.slice(0, 7) === month) return `${next(month)}-${day}`; // feita: vence no mês que vem
  if (isPending(r, today) && Number(today.slice(8, 10)) < Number(day)) return `${prevMonth(today)}-${day}`; // atrasada do mês passado
  return `${month}-${day}`;
}

/** Tudo o que está programado, com a data em que cada rotina vence. */
function Plan({ items, today }) {
  const label = (d) => {
    const diff = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5);
    if (diff < 0) return { cls: 'late', text: `venceu ${fmtDate(d).slice(0, 5)}` };
    if (diff === 0) return { cls: 'today', text: 'vence hoje' };
    if (diff === 1) return { cls: '', text: `vence amanhã (${fmtDate(d).slice(0, 5)})` };
    return { cls: '', text: `vence ${fmtDate(d).slice(0, 5)}` };
  };
  const sorted = [...items].sort((a, b) => dueDate(a, today).localeCompare(dueDate(b, today)) || a.text.localeCompare(b.text));
  return html`
    <ul class="plan-list">
      ${sorted.map((r) => {
        const l = label(dueDate(r, today));
        return html`
          <li>
            <span>${r.text} <span class="muted small">· ${r.frequency === 'diaria' ? 'todo dia' : `todo mês, dia ${r.month_day || 1}`}</span></span>
            <span class=${'plan-status ' + l.cls}>${l.text}</span>
          </li>`;
      })}
    </ul>`;
}

function RoutinesModal({ items, onClose }) {
  const [list, setList] = useState(items);
  const [text, setText] = useState('');
  const [frequency, setFrequency] = useState('diaria');
  const [day, setDay] = useState('1');
  const [error, setError] = useState(null);

  async function add(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    try {
      const [row] = await run(supabase.from('routines').insert({
        text: t.slice(0, 300), frequency, month_day: frequency === 'mensal' ? Math.min(28, Math.max(1, Number(day) || 1)) : null, position: list.length,
      }).select('*'));
      setList([...list, row]);
      setText('');
    } catch (err) { setError(err); }
  }
  async function update(r, patch) {
    setList(list.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    await run(supabase.from('routines').update(patch).eq('id', r.id)).catch(setError);
  }
  async function remove(r) {
    if (!confirm(`Apagar a rotina “${r.text}”?`)) return;
    setList(list.filter((x) => x.id !== r.id));
    await run(supabase.from('routines').delete().eq('id', r.id)).catch(setError);
  }

  return html`
    <${Modal} title="Rotinas" onClose=${onClose}>
      <p class="muted small">As <strong>diárias</strong> aparecem todo dia até você ticar. As <strong>mensais</strong> aparecem a partir do dia
        do mês escolhido e ficam até você ticar; ticada, só volta no mês seguinte.</p>
      <form class="routine-add" onSubmit=${add}>
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Ex.: Conferir respostas dos questionários" maxlength="300" />
        <select value=${frequency} onChange=${(e) => setFrequency(e.target.value)}>
          <option value="diaria">Todo dia</option>
          <option value="mensal">Todo mês</option>
        </select>
        ${frequency === 'mensal' && html`<label class="small">a partir do dia <input type="number" min="1" max="28" value=${day} onInput=${(e) => setDay(e.target.value)} /></label>`}
        <button class="btn btn-primary btn-sm" disabled=${!text.trim()}>Adicionar</button>
      </form>
      <${ErrorBox} error=${error} />
      ${[['diaria', 'Todo dia'], ['mensal', 'Todo mês']].map(([f, label]) => {
        const rows = list.filter((r) => r.frequency === f);
        return rows.length > 0 && html`
          <div class="routine-group">${label}</div>
          <ul class="todo-list">
            ${rows.map((r) => html`
              <li>
                <input class="routine-text" value=${r.text} onChange=${(e) => e.target.value.trim() && update(r, { text: e.target.value.trim() })} />
                ${f === 'mensal' && html`<label class="small nowrap">dia <input type="number" min="1" max="28" class="routine-day" value=${r.month_day || 1}
                  onChange=${(e) => update(r, { month_day: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} /></label>`}
                <button class="icon-btn small" title="Apagar" aria-label="Apagar rotina" onClick=${() => remove(r)}>✕</button>
              </li>`)}
          </ul>`;
      })}
      <div class="actions"><button class="btn btn-primary" onClick=${onClose}>Concluir</button></div>
    <//>`;
}
