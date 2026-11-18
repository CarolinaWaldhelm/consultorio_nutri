// Relatório de evolução para o paciente: monta uma página com os gráficos e abre a janela de impressão
// ("Salvar como PDF"). A página é desenhada fora da tela para os gráficos terem tamanho certo.
import { html, render, useState } from '../lib/preact.js';
import { fmtDate, todayISO, latestOf, classifyBMI, ageFrom } from '../lib/util.js';
import { METRICS } from '../lib/metrics.js';
import { bmi } from '../lib/energy.js';
import { dateOf } from '../lib/questionnaires.js';
import { Modal } from './common.js';
import { MetricChart } from './charts.js';
import { seriesOf, fmtNum } from './body.js';

function bodySeries(measurements) {
  return METRICS.filter((m) => m.key !== 'altura').map((m) => ({ m, points: seriesOf(measurements, m.key) })).filter((s) => s.points.length >= 2);
}
function labSeries(results) {
  const by = new Map();
  for (const r of results) {
    if (!by.has(r.marker)) by.set(r.marker, { label: r.label, unit: r.unit, points: [] });
    by.get(r.marker).points.push({ date: r.date, value: Number(r.value) });
  }
  return [...by.entries()].map(([k, s]) => ({ key: k, ...s, points: s.points.sort((a, b) => a.date.localeCompare(b.date)) })).filter((s) => s.points.length >= 2);
}
function questionSeries(responses, questionnaires) {
  const out = [];
  for (const q of questionnaires) {
    for (const qq of q.questions.filter((x) => x.type === 'scale')) {
      const points = responses.filter((r) => r.questionnaire_id === q.id && typeof r.answers?.[qq.id] === 'number')
        .map((r) => ({ date: dateOf(r.submitted_at), value: r.answers[qq.id] })).sort((a, b) => a.date.localeCompare(b.date));
      if (points.length >= 2) out.push({ key: q.id + qq.id, label: qq.label, points });
    }
  }
  return out;
}

function Report({ data, parts, message }) {
  const { patient, measurements } = data;
  const age = ageFrom(patient.birth_date);
  const w = latestOf(measurements, 'peso');
  const h = latestOf(measurements, 'altura');
  const b = w && h ? bmi(Number(w.value), Number(h.value)) : null;
  const body = bodySeries(measurements);
  const labs = labSeries(data.labResults || []);
  const qs = questionSeries(data.responses || [], data.questionnaires || []);
  return html`
    <div class="report">
      <header class="report-head">
        <div>
          <div class="report-kicker">Relatório de acompanhamento nutricional</div>
          <h1>${patient.name}</h1>
        </div>
        <div class="muted">${fmtDate(todayISO())}</div>
      </header>
      ${message && html`<p class="report-message">${message}</p>`}
      ${parts.body && html`
        <h2>Composição corporal</h2>
        <div class="stats">
          ${w && html`<div class="stat"><div class="stat-label">Peso</div><div class="stat-value">${fmtNum(w.value)} kg</div><div class="stat-sub">${fmtDate(w.date)}</div></div>`}
          ${b && html`<div class="stat"><div class="stat-label">IMC</div><div class="stat-value">${fmtNum(b, 1)}</div><div class="stat-sub">${classifyBMI(b, age)}</div></div>`}
        </div>
        ${body.length ? html`<div class="report-charts">${body.map(({ m, points }) => html`<${MetricChart} key=${m.key} label=${m.label} unit=${m.unit} points=${points} />`)}</div>`
          : html`<p class="muted">Ainda não há medidas suficientes para os gráficos.</p>`}`}
      ${parts.labs && labs.length > 0 && html`
        <h2>Exames laboratoriais</h2>
        <div class="report-charts">${labs.map((s) => html`<${MetricChart} key=${s.key} label=${s.label} unit=${s.unit || ''} points=${s.points} />`)}</div>`}
      ${parts.questions && qs.length > 0 && html`
        <h2>Questionários semanais</h2>
        <div class="report-charts">${qs.map((s) => html`<${MetricChart} key=${s.key} label=${s.label} unit="" points=${s.points} />`)}</div>`}
    </div>`;
}

function printReport(props) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  render(html`<${Report} ...${props} />`, root);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    render(null, root);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Espera os gráficos desenharem antes de abrir a impressão.
  setTimeout(() => window.print(), 1200);
}

export function ReportModal({ data, onClose }) {
  const [parts, setParts] = useState({ body: true, labs: (data.labResults || []).length > 0, questions: (data.responses || []).length > 1 });
  const [message, setMessage] = useState('');
  const toggle = (k) => setParts({ ...parts, [k]: !parts[k] });
  return html`
    <${Modal} title="Relatório em PDF para o paciente" onClose=${onClose}>
      <p class="muted">Escolha o que entra. Na janela que abrir, escolha <strong>“Salvar como PDF”</strong> como impressora.</p>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.body} onChange=${() => toggle('body')} /> Composição corporal (peso, IMC e gráficos)</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.labs} onChange=${() => toggle('labs')} /> Exames laboratoriais (gráficos)</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.questions} onChange=${() => toggle('questions')} /> Questionários semanais (gráficos das escalas)</label>
      <label class="field" style="margin-top:12px"><span class="field-label">Mensagem para o paciente (opcional)</span>
        <textarea rows="3" value=${message} onInput=${(e) => setMessage(e.target.value)} placeholder="Ex.: Parabéns pela evolução neste mês!"></textarea>
      </label>
      <div class="actions">
        <button class="btn" onClick=${onClose}>Cancelar</button>
        <button class="btn btn-primary" onClick=${() => { printReport({ data, parts, message: message.trim() }); onClose(); }}>🖨️ Gerar PDF</button>
      </div>
    <//>`;
}
