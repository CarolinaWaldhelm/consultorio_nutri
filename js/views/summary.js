// Resumo pré-consulta e perguntas sobre o histórico (IA no modo B).
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate } from '../lib/util.js';
import { summaryPrompt, questionPrompt, copyText } from '../lib/prompts.js';
import { AutoText, ErrorBox } from './common.js';

function CopyButton({ build, label }) {
  const [state, setState] = useState(null); // null | 'ok' | text (quando não deu para copiar)
  async function click() {
    const text = build();
    if (!text) return;
    setState((await copyText(text)) ? 'ok' : text);
    setTimeout(() => setState((s) => (s === 'ok' ? null : s)), 4000);
  }
  return html`
    <button class="btn" onClick=${click}>${state === 'ok' ? '✓ Copiado! Cole na sua IA' : label}</button>
    ${state && state !== 'ok' && html`
      <div class="field" style="margin-top:10px">
        <span class="field-hint">Não consegui copiar sozinho. Selecione o texto abaixo (Ctrl+A) e copie (Ctrl+C):</span>
        <textarea rows="6" readonly value=${state} onFocus=${(e) => e.target.select()}></textarea>
      </div>`}`;
}

export function SummaryCard({ data }) {
  const pid = data.patient.id;
  const [notes, setNotes] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    run(supabase.from('ai_notes').select('*').eq('patient_id', pid).eq('kind', 'resumo').order('created_at', { ascending: false }))
      .then(setNotes)
      .catch((err) => { setNotes([]); setError(err); });
  }, [pid]);

  async function save() {
    if (!draft.trim()) return;
    try {
      const [row] = await run(supabase.from('ai_notes').insert({ patient_id: pid, kind: 'resumo', content: draft.trim() }).select('*'));
      setNotes([row, ...notes]);
      setDraft('');
      setPasting(false);
    } catch (err) {
      setError(err);
    }
  }

  async function remove(id) {
    if (!confirm('Apagar este resumo?')) return;
    await run(supabase.from('ai_notes').delete().eq('id', id));
    setNotes(notes.filter((n) => n.id !== id));
  }

  const latest = notes?.[0];
  const shown = showAll ? notes : latest ? [latest] : [];

  return html`
    <section class="card">
      <h2 class="card-title">🧠 Resumo pré-consulta e memória</h2>
      <${ErrorBox} error=${error} />
      <p class="muted small">
        1) Copie o pedido · 2) cole na IA que você já usa (ChatGPT, Claude…) · 3) cole a resposta aqui e salve.
        O pedido vai sem nome, e-mail ou telefone: só o código ${'P-' + String(data.patient.code).padStart(4, '0')}, sexo e idade.
      </p>
      <div class="actions" style="justify-content:flex-start;margin-top:8px">
        <${CopyButton} label="📋 Copiar pedido de resumo" build=${() => summaryPrompt(data)} />
        <button class="btn" onClick=${() => setPasting(!pasting)}>📥 Colar resposta da IA</button>
      </div>

      ${pasting && html`
        <div class="field" style="margin-top:12px">
          <span class="field-label">Resposta da IA</span>
          <${AutoText} rows=${6} value=${draft} onInput=${setDraft} placeholder="Cole aqui o resumo que a IA devolveu" />
          <div class="actions" style="justify-content:flex-start">
            <button class="btn btn-primary" onClick=${save} disabled=${!draft.trim()}>💾 Salvar resumo</button>
            <button class="btn btn-ghost" onClick=${() => { setPasting(false); setDraft(''); }}>Cancelar</button>
          </div>
        </div>`}

      ${notes && notes.length === 0 && !pasting && html`<p class="muted" style="margin-top:12px">Nenhum resumo salvo ainda.</p>`}
      ${shown.map((n) => html`
        <div class="summary-note">
          <div class="summary-head">
            <strong>Resumo de ${fmtDate(n.created_at.slice(0, 10))}</strong>
            <button class="btn btn-sm btn-danger-ghost" onClick=${() => remove(n.id)}>Apagar</button>
          </div>
          <div class="qa-a">${n.content}</div>
        </div>`)}
      ${notes && notes.length > 1 && html`
        <button class="btn btn-sm btn-ghost" onClick=${() => setShowAll(!showAll)}>
          ${showAll ? 'Mostrar só o mais recente' : `Ver resumos anteriores (${notes.length - 1})`}
        </button>`}

      <div class="field" style="margin-top:18px">
        <span class="field-label">Perguntar sobre o histórico</span>
        <input value=${question} onInput=${(e) => setQuestion(e.target.value)}
          placeholder="Ex.: Qual meta de água combinamos nas últimas consultas?" />
        <div class="actions" style="justify-content:flex-start;margin-top:8px">
          <${CopyButton} label="📋 Copiar pergunta para a IA" build=${() => question.trim() && questionPrompt(data, question.trim())} />
        </div>
      </div>
    </section>`;
}
