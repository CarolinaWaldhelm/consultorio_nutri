// Páginas "Recomendações" (textos prontos para mandar ao paciente) e "Condutas" (anotações dela: doses de
// suplementação etc.). Mesma tela, mesma tabela (coluna kind), lista por categoria com busca.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { norm } from '../lib/util.js';
import { copyOrShow } from '../lib/prompts.js';
import { Modal, Field, ErrorBox, Loading, AutoText } from './common.js';

const KINDS = {
  recomendacao: {
    title: 'Recomendações', one: 'recomendação', newLabel: '+ Nova recomendação',
    search: '🔍 Buscar (ex.: creatina, whey, intestino…)',
    empty: 'Crie seus textos prontos (uso de creatina, como comprar e usar whey protein…) e depois é só copiar e colar para o paciente.',
    titlePh: 'Ex.: Creatina — como usar', catPh: 'Ex.: Suplementos', bodyLabel: 'Texto que vai para o paciente',
    bodyPh: 'Escreva aqui exatamente o que você quer mandar.',
  },
  conduta: {
    title: 'Condutas', one: 'conduta', newLabel: '+ Nova conduta',
    search: '🔍 Buscar (ex.: vitamina D, ferro, magnésio…)',
    empty: 'Salve suas condutas (doses de suplementação, protocolos, ajustes…) para consultar e copiar quando precisar.',
    titlePh: 'Ex.: Vitamina D — reposição', catPh: 'Ex.: Suplementação', bodyLabel: 'Conduta (dose, forma de uso, duração, observações)',
    bodyPh: 'Ex.: 25(OH)D abaixo de 20 ng/mL: … UI/dia por 8 semanas, depois manutenção de …',
  },
};

export function RecommendationsPage({ kind = 'recomendacao' }) {
  const K = KINDS[kind];
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState(null); // {} = nova; objeto = editar
  const [copied, setCopied] = useState(null);
  const [open, setOpen] = useState({}); // cartões com o texto inteiro aberto

  const load = () => run(supabase.from('recommendations').select('*').eq('kind', kind).order('title')).then(setItems).catch(setError);
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
    if (!confirm(`Apagar a ${K.one} "${r.title}"?`)) return;
    try { await run(supabase.from('recommendations').delete().eq('id', r.id)); load(); } catch (err) { setError(err); }
  }

  if (!items && !error) return html`<${Loading} />`;
  return html`
    <div class="page-head">
      <h1>${K.title}</h1>
      <button class="btn btn-primary" onClick=${() => setEditing({})}>${K.newLabel}</button>
    </div>
    <${ErrorBox} error=${error} />
    <section class="card rec-toolbar">
      <input type="search" class="rec-search" placeholder=${K.search} value=${q} onInput=${(e) => setQ(e.target.value)} aria-label=${'Buscar ' + K.one} />
      ${categories.length > 0 && html`
        <div class="seg rec-cats">
          <button class=${!cat ? 'on' : ''} onClick=${() => setCat('')}>Todas (${items.length})</button>
          ${categories.map((c) => html`<button class=${cat === c ? 'on' : ''} onClick=${() => setCat(cat === c ? '' : c)}>${c} (${items.filter((r) => r.category === c).length})</button>`)}
        </div>`}
    </section>

    ${items && items.length === 0 && html`
      <section class="card empty">
        <h2>Nenhuma ${K.one} ainda</h2>
        <p>${K.empty}</p>
        <button class="btn btn-primary" onClick=${() => setEditing({})}>${K.newLabel}</button>
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

    ${editing && html`<${RecEditor} rec=${editing} kind=${kind} categories=${categories} onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}`;
}

function RecEditor({ rec, kind, categories, onClose, onSaved }) {
  const K = KINDS[kind];
  const [title, setTitle] = useState(rec.title || '');
  const [category, setCategory] = useState(rec.category || '');
  const [body, setBody] = useState(rec.body || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    const row = { kind, title: title.trim(), category: category.trim() || null, body: body.trim(), updated_at: new Date().toISOString() };
    try {
      if (rec.id) await run(supabase.from('recommendations').update(row).eq('id', rec.id));
      else await run(supabase.from('recommendations').insert(row));
      onSaved();
    } catch (err) { setError(err); setBusy(false); }
  }

  return html`
    <${Modal} title=${(rec.id ? 'Editar ' : 'Nova ') + K.one} onClose=${onClose} wide>
      <${Field} label="Título">
        <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder=${K.titlePh} maxlength="200" />
      <//>
      <${Field} label="Categoria (opcional, para filtrar)">
        <input value=${category} onInput=${(e) => setCategory(e.target.value)} list="rec-cats" placeholder=${K.catPh} maxlength="80" />
        <datalist id="rec-cats">${categories.map((c) => html`<option value=${c} />`)}</datalist>
      <//>
      <${Field} label=${K.bodyLabel}>
        <${AutoText} rows=${10} value=${body} onInput=${setBody} placeholder=${K.bodyPh} />
      <//>
      <${ErrorBox} error=${error} />
      <div class="actions">
        <button class="btn" onClick=${onClose}>Cancelar</button>
        <button class="btn btn-primary" disabled=${busy || !title.trim() || !body.trim()} onClick=${save}>${busy ? 'Salvando…' : '💾 Salvar'}</button>
      </div>
    <//>`;
}
