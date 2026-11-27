// Página "Recomendações": textos prontos (creatina, whey protein…) para copiar e mandar ao paciente.
// Cada recomendação é um cartão separado (título, categoria e texto), com busca e filtro por categoria.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { norm } from '../lib/util.js';
import { copyOrShow } from '../lib/prompts.js';
import { Modal, Field, ErrorBox, Loading, AutoText } from './common.js';

export function RecommendationsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState(null); // {} = nova; objeto = editar
  const [copied, setCopied] = useState(null);
  const [open, setOpen] = useState({}); // cartões com o texto inteiro aberto

  const load = () => run(supabase.from('recommendations').select('*').order('title')).then(setItems).catch(setError);
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => [...new Set((items || []).map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const shown = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean);
    return (items || [])
      .filter((r) => !cat || r.category === cat)
      .filter((r) => { const hay = norm(`${r.title} ${r.category || ''} ${r.body}`); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.title.localeCompare(b.title));
  }, [items, q, cat]);

  async function copy(r) {
    await copyOrShow(r.body);
    setCopied(r.id);
    setTimeout(() => setCopied((x) => (x === r.id ? null : x)), 2500);
  }
  async function remove(r) {
    if (!confirm(`Apagar a recomendação "${r.title}"?`)) return;
    try { await run(supabase.from('recommendations').delete().eq('id', r.id)); load(); } catch (err) { setError(err); }
  }

  if (!items && !error) return html`<${Loading} />`;
  return html`
    <div class="page-head">
      <h1>Recomendações</h1>
      <button class="btn btn-primary" onClick=${() => setEditing({})}>+ Nova recomendação</button>
    </div>
    <${ErrorBox} error=${error} />
    <section class="card rec-toolbar">
      <input type="search" class="rec-search" placeholder="🔍 Buscar (ex.: creatina, whey, intestino…)" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Buscar recomendação" />
      ${categories.length > 0 && html`
        <div class="seg rec-cats">
          <button class=${!cat ? 'on' : ''} onClick=${() => setCat('')}>Todas (${items.length})</button>
          ${categories.map((c) => html`<button class=${cat === c ? 'on' : ''} onClick=${() => setCat(cat === c ? '' : c)}>${c} (${items.filter((r) => r.category === c).length})</button>`)}
        </div>`}
    </section>

    ${items && items.length === 0 && html`
      <section class="card empty">
        <h2>Nenhuma recomendação ainda</h2>
        <p>Crie seus textos prontos (uso de creatina, como comprar e usar whey protein…) e depois é só copiar e colar para o paciente.</p>
        <button class="btn btn-primary" onClick=${() => setEditing({})}>+ Nova recomendação</button>
      </section>`}
    ${items && items.length > 0 && shown.length === 0 && html`<p class="muted">Nada encontrado para “${q}”.</p>`}

    ${shown.length > 0 && html`
      <section class="card rec-list">
        ${shown.map((r, i) => {
          const isOpen = open[r.id];
          const newCat = i === 0 || (shown[i - 1].category || '') !== (r.category || '');
          return html`
            ${newCat && html`<div class="rec-cat-head">${r.category || 'Sem categoria'}</div>`}
            <div class=${'rec-row' + (isOpen ? ' open' : '')} key=${r.id}>
              <div class="rec-row-main">
                <button class="rec-row-title" onClick=${() => setOpen({ ...open, [r.id]: !isOpen })} aria-expanded=${!!isOpen}>
                  <span class="muted">${isOpen ? '▾' : '▸'}</span> ${r.title}
                </button>
                ${!isOpen && html`<div class="rec-row-preview muted small">${r.body.replace(/\s+/g, ' ').slice(0, 160)}${r.body.length > 160 ? '…' : ''}</div>`}
                ${isOpen && html`<div class="rec-body">${r.body}</div>`}
              </div>
              <span class="row-actions rec-row-actions">
                <button class=${'btn btn-sm ' + (copied === r.id ? 'btn-primary' : '')} onClick=${() => copy(r)}>${copied === r.id ? '✓ Copiado' : '📋 Copiar'}</button>
                <button class="btn btn-sm btn-ghost" onClick=${() => setEditing(r)}>✏️ Editar</button>
                <button class="btn btn-sm btn-ghost" onClick=${() => remove(r)}>Apagar</button>
              </span>
            </div>`;
        })}
      </section>`}

    ${editing && html`<${RecEditor} rec=${editing} categories=${categories} onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}`;
}

function RecEditor({ rec, categories, onClose, onSaved }) {
  const [title, setTitle] = useState(rec.title || '');
  const [category, setCategory] = useState(rec.category || '');
  const [body, setBody] = useState(rec.body || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    const row = { title: title.trim(), category: category.trim() || null, body: body.trim(), updated_at: new Date().toISOString() };
    try {
      if (rec.id) await run(supabase.from('recommendations').update(row).eq('id', rec.id));
      else await run(supabase.from('recommendations').insert(row));
      onSaved();
    } catch (err) { setError(err); setBusy(false); }
  }

  return html`
    <${Modal} title=${rec.id ? 'Editar recomendação' : 'Nova recomendação'} onClose=${onClose} wide>
      <${Field} label="Título">
        <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="Ex.: Creatina — como usar" maxlength="200" />
      <//>
      <${Field} label="Categoria (opcional, para filtrar)">
        <input value=${category} onInput=${(e) => setCategory(e.target.value)} list="rec-cats" placeholder="Ex.: Suplementos" maxlength="80" />
        <datalist id="rec-cats">${categories.map((c) => html`<option value=${c} />`)}</datalist>
      <//>
      <${Field} label="Texto que vai para o paciente">
        <${AutoText} rows=${10} value=${body} onInput=${setBody} placeholder="Escreva aqui exatamente o que você quer mandar." />
      <//>
      <${ErrorBox} error=${error} />
      <div class="actions">
        <button class="btn" onClick=${onClose}>Cancelar</button>
        <button class="btn btn-primary" disabled=${busy || !title.trim() || !body.trim()} onClick=${save}>${busy ? 'Salvando…' : '💾 Salvar'}</button>
      </div>
    <//>`;
}
