// Lateral esquerda da ficha: as recomendações ativas (aba Recomendações) com um botão liga/desliga para este
// paciente. As ligadas vão para o relatório em PDF.
import { html, useState, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { norm } from '../lib/util.js';
import { copyOrShow } from '../lib/prompts.js';

export function PatientRecs({ patientId, recs, selected, onChange }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const on = useMemo(() => new Map(selected.map((s) => [s.recommendation_id, s])), [selected]);
  // Aparecem as ativas e também as que já estão ligadas para o paciente (mesmo que depois tenham sido desativadas).
  const list = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean);
    return recs
      .filter((r) => r.active !== false || on.has(r.id))
      .filter((r) => { const hay = norm(`${r.title} ${r.category || ''} ${r.body}`); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.title.localeCompare(b.title));
  }, [recs, q, on]);

  async function toggle(r) {
    setError(null);
    setBusy(r.id);
    try {
      if (on.has(r.id)) {
        await run(supabase.from('patient_recommendations').delete().eq('id', on.get(r.id).id));
        onChange(selected.filter((s) => s.recommendation_id !== r.id));
      } else {
        const [row] = await run(supabase.from('patient_recommendations').insert({ patient_id: patientId, recommendation_id: r.id }).select('*'));
        onChange([...selected, row]);
      }
    } catch (err) { setError(err); }
    setBusy(null);
  }
  async function copyAll() {
    const chosen = recs.filter((r) => on.has(r.id));
    await copyOrShow(chosen.map((r) => `*${r.title}*\n${r.body}`).join('\n\n'));
    setCopied('all');
    setTimeout(() => setCopied(null), 2500);
  }

  const count = recs.filter((r) => on.has(r.id)).length;
  return html`
    <section class="card prec">
      <h2 class="card-title">💬 Recomendações</h2>
      <p class="muted small" style="margin:0 0 8px">Ligue as que valem para este paciente: elas vão para o relatório em PDF.</p>
      ${recs.length === 0
        ? html`<p class="muted small">Nenhuma recomendação ainda. Crie em <a href="#/recomendacoes">Recomendações</a>.</p>`
        : html`
          <input type="search" class="prec-search" placeholder="🔍 Buscar" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Buscar recomendação" />
          <div class="prec-count small">
            <strong>${count}</strong> ligada${count === 1 ? '' : 's'}
            ${count > 0 && html`<button class="link-btn" onClick=${copyAll}>${copied === 'all' ? '✓ copiadas' : '📋 copiar ligadas'}</button>`}
          </div>
          ${error && html`<p class="alert small">${error.message || String(error)}</p>`}
          <div class="prec-list">
            ${list.map((r, i) => {
              const newCat = i === 0 || (list[i - 1].category || '') !== (r.category || '');
              const isOn = on.has(r.id);
              return html`
                ${newCat && html`<div class="prec-cat">${r.category || 'Sem categoria'}</div>`}
                <label class=${'prec-item' + (isOn ? ' on' : '')} title=${r.body}>
                  <input type="checkbox" class="switch" checked=${isOn} disabled=${busy === r.id} onChange=${() => toggle(r)} />
                  <span>${r.title}${r.active === false ? html` <span class="muted small">(inativa)</span>` : ''}</span>
                </label>`;
            })}
            ${list.length === 0 && html`<p class="muted small">Nada encontrado.</p>`}
          </div>`}
    </section>`;
}
