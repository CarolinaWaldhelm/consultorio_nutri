// Ficha do paciente: questionários respondidos, gráficos das escalas e ativar/pausar.
import { html, useState, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate } from '../lib/util.js';
import { dateOf } from '../lib/questionnaires.js';
import { MetricChart } from './charts.js';
import { AnswersView } from './questionnaires.js';

export function QuestionnaireCard({ patient, responses, questionnaires, sends, onToggle }) {
  const [expanded, setExpanded] = useState(null);
  const qById = useMemo(() => new Map(questionnaires.map((q) => [q.id, q])), [questionnaires]);
  const last = responses[0];
  const pending = sends.find((s) => !s.answered_at && !s.expired_at);

  // Um gráfico por pergunta de escala, separado por modelo de questionário.
  const charts = useMemo(() => {
    const out = [];
    for (const q of questionnaires) {
      const mine = responses.filter((r) => r.questionnaire_id === q.id).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
      for (const question of q.questions.filter((x) => x.type === 'scale')) {
        const points = mine.filter((r) => typeof r.answers?.[question.id] === 'number')
          .map((r) => ({ date: dateOf(r.submitted_at), value: r.answers[question.id] }));
        if (points.length >= 2) out.push({ key: q.id + question.id, label: question.label, model: q.name, points });
      }
    }
    return out;
  }, [responses, questionnaires]);

  async function toggle() {
    const next = !patient.questionnaires_active;
    await run(supabase.from('patients').update({ questionnaires_active: next }).eq('id', patient.id));
    onToggle(next);
  }

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📝 Questionários</h2>
        <span class="row-actions">
          <span class=${'badge ' + (patient.questionnaires_active ? 'badge-green' : '')}>${patient.questionnaires_active ? 'Envio ativo' : 'Envio pausado'}</span>
          <button class="btn btn-sm" onClick=${toggle}>${patient.questionnaires_active ? 'Pausar envio' : 'Reativar envio'}</button>
        </span>
      </div>
      ${pending && html`<p class="muted small">🟡 Questionário enviado em ${fmtDate(dateOf(pending.sent_at))}, aguardando resposta.</p>`}
      ${!responses.length && html`<p class="muted">Nenhum questionário respondido ainda.</p>`}
      ${last && html`
        <div class="summary-note">
          <div class="summary-head"><strong>Última resposta · ${fmtDate(dateOf(last.submitted_at))}</strong><span class="muted small">${qById.get(last.questionnaire_id)?.name || ''}</span></div>
          <${AnswersView} questionnaire=${qById.get(last.questionnaire_id)} answers=${last.answers} />
        </div>`}
      ${charts.length > 0 && html`
        <div class="charts">${charts.map((c) => html`<${MetricChart} key=${c.key} label=${c.label} unit="" points=${c.points} />`)}</div>`}
      ${responses.length > 0 && charts.length === 0 && html`<p class="muted small" style="margin-top:10px">Os gráficos aparecem a partir de 2 respostas.</p>`}
      ${responses.length > 1 && html`
        <details class="q-history">
          <summary>Histórico de respostas (${responses.length})</summary>
          <ul class="history">
            ${responses.map((r) => html`
              <li class="history-item">
                <div class="history-row" onClick=${() => setExpanded(expanded === r.id ? null : r.id)}>
                  <span>${expanded === r.id ? '▾' : '▸'} <strong>${fmtDate(dateOf(r.submitted_at))}</strong> · ${qById.get(r.questionnaire_id)?.name || ''}</span>
                </div>
                ${expanded === r.id && html`<div class="history-body"><${AnswersView} questionnaire=${qById.get(r.questionnaire_id)} answers=${r.answers} /></div>`}
              </li>`)}
          </ul>
        </details>`}
    </section>`;
}
