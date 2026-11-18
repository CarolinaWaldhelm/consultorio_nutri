// Resumo pré-consulta (IA no modo B): só copia o pedido pronto para colar na IA.
import { html, useState } from '../lib/preact.js';
import { patientCode } from '../lib/util.js';
import { summaryPrompt, insightsPrompt, copyText } from '../lib/prompts.js';

export function SummaryCard({ data }) {
  const [state, setState] = useState(null); // null | 'resumo' | 'insights' | texto (quando não deu para copiar)

  async function copy(kind) {
    const text = kind === 'insights' ? insightsPrompt(data) : summaryPrompt(data);
    setState((await copyText(text)) ? kind : text);
    setTimeout(() => setState((s) => (s === kind ? null : s)), 4000);
  }
  const done = state === 'resumo' || state === 'insights';

  return html`
    <section class="card summary-card">
      <div>
        <h2 class="card-title" style="margin-bottom:4px">🧠 Resumo pré-consulta e insights</h2>
        <p class="muted small" style="margin:0">Copia o histórico completo, sem nome, e-mail ou telefone (só ${patientCode(data.patient.code)}, sexo e idade), para colar na sua IA.</p>
      </div>
      <span class="row-actions">
        <button class="btn btn-primary" onClick=${() => copy('resumo')}>${state === 'resumo' ? '✓ Copiado! Cole na sua IA' : '📋 Copiar pedido de resumo'}</button>
        <button class="btn" title="Condutas baseadas em evidência para o perfil do paciente, com as fontes" onClick=${() => copy('insights')}>${state === 'insights' ? '✓ Copiado! Cole na sua IA' : '📚 Copiar pedido de insights'}</button>
      </span>
      ${state && !done && html`
        <div class="field" style="width:100%">
          <span class="field-hint">Não consegui copiar sozinho. Clique no texto, use Ctrl+A e Ctrl+C:</span>
          <textarea rows="6" readonly value=${state} onFocus=${(e) => e.target.select()}></textarea>
        </div>`}
    </section>`;
}
