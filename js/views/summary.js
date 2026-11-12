// Resumo pré-consulta (IA no modo B): só copia o pedido pronto para colar na IA.
import { html, useState } from '../lib/preact.js';
import { patientCode } from '../lib/util.js';
import { summaryPrompt, copyText } from '../lib/prompts.js';

export function SummaryCard({ data }) {
  const [state, setState] = useState(null); // null | 'ok' | texto (quando não deu para copiar)

  async function copy() {
    const text = summaryPrompt(data);
    setState((await copyText(text)) ? 'ok' : text);
    setTimeout(() => setState((s) => (s === 'ok' ? null : s)), 4000);
  }

  return html`
    <section class="card summary-card">
      <div>
        <h2 class="card-title" style="margin-bottom:4px">🧠 Resumo pré-consulta</h2>
        <p class="muted small" style="margin:0">Copia o histórico completo, sem nome, e-mail ou telefone (só ${patientCode(data.patient.code)}, sexo e idade), para colar na sua IA.</p>
      </div>
      <button class="btn btn-primary" onClick=${copy}>${state === 'ok' ? '✓ Copiado! Cole na sua IA' : '📋 Copiar pedido de resumo'}</button>
      ${state && state !== 'ok' && html`
        <div class="field" style="width:100%">
          <span class="field-hint">Não consegui copiar sozinho. Clique no texto, use Ctrl+A e Ctrl+C:</span>
          <textarea rows="6" readonly value=${state} onFocus=${(e) => e.target.select()}></textarea>
        </div>`}
    </section>`;
}
