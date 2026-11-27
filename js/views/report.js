// Relatório de evolução para o paciente: monta uma página com os gráficos e abre a janela de impressão
// ("Salvar como PDF"). A página é desenhada fora da tela para os gráficos terem tamanho certo.
import { html, render, useState } from '../lib/preact.js';
import { fmtDate, todayISO, latestOf, classifyBMI, ageFrom } from '../lib/util.js';
import { METRICS } from '../lib/metrics.js';
import { bmi } from '../lib/energy.js';
import { dateOf } from '../lib/questionnaires.js';
import { Modal } from './common.js';
import { MARKER, markerOf, labGroup, labOrder, referenceFor, referenceStatus, ageAt } from '../lib/labs.js';
import { MetricChart } from './charts.js';
import { seriesOf, fmtNum } from './body.js';

function bodySeries(measurements) {
  return METRICS.filter((m) => m.key !== 'altura').map((m) => ({ m, points: seriesOf(measurements, m.key) })).filter((s) => s.points.length >= 2);
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

// Cores da identidade visual (tirada da logo): verde-oliva, terracota, azul-lavanda, mostarda, creme.
const C = { green: '#55654f', olive: '#8a8b4c', terra: '#c4622f', blue: '#6a7596', red: '#c0473a', mustard: '#c99a3a' };

/** Últimos dois resultados de cada exame, agrupados como na ficha. */
function labTable(results, sex, birthDate) {
  const by = new Map();
  for (const r of [...results].sort((a, b) => b.date.localeCompare(a.date))) {
    const k = markerOf(r);
    if (!by.has(k)) by.set(k, { marker: k, label: k === r.marker ? r.label : MARKER[k]?.label || r.label, unit: r.unit, vals: [] });
    if (by.get(k).vals.length < 2) by.get(k).vals.push(r);
  }
  const ageNow = ageAt(birthDate, todayISO());
  return [...by.values()].sort((a, b) => labOrder(a.marker) - labOrder(b.marker) || a.label.localeCompare(b.label))
    .map((x) => ({ ...x, group: labGroup(x.marker), ref: referenceFor(x.marker, sex, ageNow),
      status: (r) => referenceStatus(x.marker, r.value, r.unit, sex, ageAt(birthDate, r.date)) }));
}

function firstDate(data) {
  const today = todayISO();
  const ds = [...(data.consultations || []).map((c) => c.date), ...(data.appointments || []).map((a) => a.date), ...(data.measurements || []).map((m) => m.date)]
    .filter((d) => d && d <= today).sort();
  return ds[0] || null;
}

const sign = (n, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n), digits)}`;

function Report({ data, parts, message, brand }) {
  const { patient, measurements } = data;
  const age = ageFrom(patient.birth_date);
  const w = latestOf(measurements, 'peso');
  const h = latestOf(measurements, 'altura');
  const b = w && h ? bmi(Number(w.value), Number(h.value)) : null;
  const body = bodySeries(measurements);
  const qs = questionSeries(data.responses || [], data.questionnaires || []);
  const labs = labTable(data.labResults || [], patient.sex, patient.birth_date);
  const since = firstDate(data);
  // Resumo em números: peso atual, variação desde a primeira medida, IMC e cintura.
  const peso = seriesOf(measurements, 'peso');
  const cint = seriesOf(measurements, 'cintura');
  const tiles = [
    w && { label: 'Peso atual', value: `${fmtNum(w.value)} kg`, sub: fmtDate(w.date) },
    peso.length >= 2 && { label: 'Variação de peso', value: `${sign(peso[peso.length - 1].value - peso[0].value)} kg`, sub: `desde ${fmtDate(peso[0].date)}` },
    b && { label: 'IMC', value: fmtNum(b, 1), sub: classifyBMI(b, age) },
    cint.length >= 2 && { label: 'Cintura', value: `${sign(cint[cint.length - 1].value - cint[0].value)} cm`, sub: `${fmtNum(cint[cint.length - 1].value)} cm hoje` },
  ].filter(Boolean);
  const footer = [brand.report_name, brand.report_title, brand.report_crn && `CRN ${brand.report_crn}`, brand.report_instagram, brand.report_contact].filter(Boolean);

  return html`
    <div class="report rpt">
      <header class="rpt-head">
        ${brand.report_logo && html`<img class="rpt-logo" src=${brand.report_logo} alt="" />`}
        <div class="rpt-head-text">
          <div class="rpt-kicker">Relatório de acompanhamento nutricional</div>
          <h1 class="rpt-name">${patient.name}</h1>
          <div class="rpt-meta">
            ${age != null ? `${age} anos · ` : ''}${since ? `Acompanhamento desde ${fmtDate(since)} · ` : ''}Emitido em ${fmtDate(todayISO())}
          </div>
        </div>
      </header>
      <div class="rpt-dots" aria-hidden="true">${[C.terra, C.olive, C.blue, C.mustard, C.red, C.green].map((c) => html`<i style=${'background:' + c}></i>`)}</div>

      ${message && html`<div class="rpt-message">${message}</div>`}

      ${parts.body && html`
        <section class="rpt-section">
          <h2><i style=${'background:' + C.terra}></i>Composição corporal</h2>
          ${tiles.length > 0 && html`<div class="rpt-tiles">${tiles.map((t) => html`
            <div class="rpt-tile"><div class="rpt-tile-label">${t.label}</div><div class="rpt-tile-value">${t.value}</div><div class="rpt-tile-sub">${t.sub}</div></div>`)}</div>`}
          ${body.length ? html`<div class="report-charts">${body.map(({ m, points }) => html`<${MetricChart} key=${m.key} label=${m.label} unit=${m.unit} points=${points} color=${C.green} />`)}</div>`
            : html`<p class="rpt-muted">Ainda não há medidas suficientes para os gráficos.</p>`}
        </section>`}

      ${parts.labs && labs.length > 0 && html`
        <section class="rpt-section">
          <h2><i style=${'background:' + C.blue}></i>Exames laboratoriais</h2>
          <table class="rpt-table">
            <thead><tr><th>Exame</th><th class="num">Resultado</th><th class="num">Anterior</th><th>Referência</th></tr></thead>
            <tbody>
              ${labs.map((x, i) => {
                const prev = i ? labs[i - 1].group : null;
                const g = x.group;
                const head = !prev || prev.key !== g.key;
                const cell = (r) => { if (!r) return html`<span class="rpt-muted">—</span>`; const st = x.status(r);
                  return html`<span class=${'rpt-val' + (st && st !== 'ok' ? ' out' : st === 'ok' ? ' ok' : '')}>${String(r.value).replace('.', ',')}${st === 'high' ? ' ↑' : st === 'low' ? ' ↓' : ''}</span><span class="rpt-date">${fmtDate(r.date).slice(0, 5)}/${r.date.slice(2, 4)}</span>`; };
                return html`
                  ${head && g.section && (!prev || prev.section !== g.section) && html`<tr class="rpt-group"><td colspan="4">${g.section}</td></tr>`}
                  ${head && html`<tr class=${g.section ? 'rpt-subgroup' : 'rpt-group'}><td colspan="4">${g.label}</td></tr>`}
                  <tr><td>${x.label} <span class="rpt-unit">${x.unit || ''}</span></td><td class="num">${cell(x.vals[0])}</td><td class="num">${cell(x.vals[1])}</td><td class="rpt-ref">${x.ref?.text || '—'}</td></tr>`;
              })}
            </tbody>
          </table>
          <p class="rpt-note"><span class="rpt-val ok">verde</span> dentro da referência · <span class="rpt-val out">terracota ↑↓</span> acima ou abaixo. Referências gerais; vale sempre a do seu laudo.</p>
        </section>`}

      ${parts.questions && qs.length > 0 && html`
        <section class="rpt-section">
          <h2><i style=${'background:' + C.mustard}></i>Questionários semanais</h2>
          <div class="report-charts">${qs.map((q) => html`<${MetricChart} key=${q.key} label=${q.label} unit="" points=${q.points} color=${C.blue} />`)}</div>
        </section>`}

      ${footer.length > 0 && html`
        <div class="rpt-sign">
          <div class="rpt-dots" aria-hidden="true">${[C.terra, C.olive, C.blue, C.mustard, C.red, C.green].map((c) => html`<i style=${'background:' + c}></i>`)}</div>
          <div class="rpt-sign-name">${brand.report_name || ''}</div>
          <div class="rpt-sign-meta">${footer.slice(brand.report_name ? 1 : 0).join(' · ')}</div>
        </div>`}
    </div>`;
}

/** Rodapé de cada página (nome · profissão · CRN · Instagram) e número da página, nas margens do PDF. */
function pageStyle(brand) {
  const parts = [brand.report_name, brand.report_title, brand.report_crn && `CRN ${brand.report_crn}`, brand.report_instagram, brand.report_contact].filter(Boolean);
  const text = parts.join('  ·  ').replace(/["\\\n]/g, ' ');
  // As caixas de cima vazias e as de baixo com o nosso rodapé substituem o cabeçalho/rodapé automático do navegador
  // (data, título "Consultório Nutri" e endereço da página).
  return `@page { size: A4; margin: 14mm 13mm 18mm;
    @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; } @bottom-left { content: ""; }
    @bottom-center { content: "${text}"; font: 7.5pt 'Avenir Next', 'Segoe UI', sans-serif; letter-spacing: .06em; color: #858b7f; }
    @bottom-right { content: counter(page) "/" counter(pages); font: 7.5pt sans-serif; color: #c4622f; } }`;
}

function printReport(props) {
  const style = document.createElement('style');
  style.id = 'rpt-page-style';
  style.textContent = pageStyle(props.brand || {});
  document.head.appendChild(style);
  // Nome sugerido do arquivo PDF: "Relatório - Nome do paciente - 27-11-2026".
  const oldTitle = document.title;
  document.title = `Relatório - ${props.data.patient.name} - ${fmtDate(todayISO()).replace(/\//g, '-')}`;
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  render(html`<${Report} ...${props} />`, root);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    render(null, root);
    style.remove();
    document.title = oldTitle;
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
      ${!(data.settings || {}).report_logo && html`<p class="muted small">Dica: envie sua logo e os dados do rodapé em <a href="#/config">Configurações → Relatório em PDF</a>.</p>`}
      <label class="checkbox-line"><input type="checkbox" checked=${parts.body} onChange=${() => toggle('body')} /> Composição corporal (peso, IMC e gráficos)</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.labs} onChange=${() => toggle('labs')} /> Exames laboratoriais (tabela com o último resultado e o anterior)</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.questions} onChange=${() => toggle('questions')} /> Questionários semanais (gráficos das escalas)</label>
      <label class="field" style="margin-top:12px"><span class="field-label">Mensagem para o paciente (opcional)</span>
        <textarea rows="3" value=${message} onInput=${(e) => setMessage(e.target.value)} placeholder="Ex.: Parabéns pela evolução neste mês!"></textarea>
      </label>
      <div class="actions">
        <button class="btn" onClick=${onClose}>Cancelar</button>
        <button class="btn btn-primary" onClick=${() => { printReport({ data, parts, message: message.trim(), brand: data.settings || {} }); onClose(); }}>🖨️ Gerar PDF</button>
      </div>
    <//>`;
}
