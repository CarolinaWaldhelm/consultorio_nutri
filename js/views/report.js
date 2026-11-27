// Relatório de evolução para o paciente: monta uma página com os gráficos e abre a janela de impressão
// ("Salvar como PDF"). A página é desenhada fora da tela para os gráficos terem tamanho certo.
import { html, render, useState, useEffect, useLayoutEffect, useRef } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
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
  const dots = html`<div class="rpt-dots" aria-hidden="true">${[C.terra, C.olive, C.blue, C.mustard, C.red, C.green].map((c) => html`<i style=${'background:' + c}></i>`)}</div>`;
  const sig = footer.length > 0 ? html`
    <div class="rpt-sign">
      ${dots}
      <div class="rpt-sign-name">${brand.report_name || ''}</div>
      <div class="rpt-sign-meta">${footer.slice(brand.report_name ? 1 : 0).join(' · ')}</div>
    </div>` : null;

  // O relatório é montado em blocos; o próprio site distribui os blocos nas folhas A4 (em vez de deixar o
  // navegador quebrar as páginas). Assim ele sabe qual é a última folha: nas outras vai a linha simples do
  // rodapé, e na última só a assinatura com os pontinhos.
  const blocks = [];
  const add = (key, el, opts = {}) => blocks.push({ key, el, ...opts });
  const h2 = (color, text) => html`<h2 class="rpt-h2"><i style=${'background:' + color}></i>${text}</h2>`;
  const chartRows = (list, color, keyPrefix) => {
    for (let i = 0; i < list.length; i += 2) {
      add(keyPrefix + i, html`<div class="report-charts">${list.slice(i, i + 2).map((x) => html`<${MetricChart} key=${x.key} label=${x.label} unit=${x.unit || ''} points=${x.points} color=${color} />`)}</div>`);
    }
  };
  add('head', html`
    <header class="rpt-head">
      ${brand.report_logo && html`<img class="rpt-logo" src=${brand.report_logo} alt="" />`}
      <div class="rpt-head-text">
        <div class="rpt-kicker">Relatório de acompanhamento nutricional</div>
        <h1 class="rpt-name">${patient.name}</h1>
        <div class="rpt-meta">${age != null ? `${age} anos · ` : ''}${since ? `Acompanhamento desde ${fmtDate(since)} · ` : ''}Emitido em ${fmtDate(todayISO())}</div>
      </div>
    </header>
    ${dots}`);
  if (message) add('msg', html`<div class="rpt-message">${message}</div>`);
  // Combinados da última consulta (campo "Combinados / Conduta" da anamnese).
  const lastCombo = [...(data.consultations || [])].sort((a, b) => b.date.localeCompare(a.date)).find((c) => c.anamnesis?.combinados?.trim());
  if (parts.combinados && lastCombo) {
    add('h-combo', h2(C.olive, 'Combinados'), { keepNext: true });
    add('combo', html`<div class="rpt-combo"><div class="rpt-combo-date">Consulta de ${fmtDate(lastCombo.date)}</div>${lastCombo.anamnesis.combinados.trim()}</div>`);
  }
  if (parts.body) {
    add('h-body', h2(C.terra, 'Composição corporal'), { keepNext: true });
    if (tiles.length) add('tiles', html`<div class="rpt-tiles">${tiles.map((t) => html`
      <div class="rpt-tile"><div class="rpt-tile-label">${t.label}</div><div class="rpt-tile-value">${t.value}</div><div class="rpt-tile-sub">${t.sub}</div></div>`)}</div>`);
    if (body.length) chartRows(body.map(({ m, points }) => ({ key: m.key, label: m.label, unit: m.unit, points })), C.green, 'bc');
    else add('b-none', html`<p class="rpt-muted">Ainda não há medidas suficientes para os gráficos.</p>`);
  }
  if (parts.labs && labs.length > 0) {
    add('h-labs', h2(C.blue, 'Exames laboratoriais'), { keepNext: true });
    const cell = (x, r) => {
      if (!r) return html`<span class="rpt-muted">—</span>`;
      const st = x.status(r);
      return html`<span class=${'rpt-val' + (st && st !== 'ok' ? ' out' : st === 'ok' ? ' ok' : '')}>${String(r.value).replace('.', ',')}${st === 'high' ? ' ↑' : st === 'low' ? ' ↓' : ''}</span><span class="rpt-date">${fmtDate(r.date).slice(0, 5)}/${r.date.slice(2, 4)}</span>`;
    };
    labs.forEach((x, i) => {
      const prev = i ? labs[i - 1].group : null;
      const g = x.group;
      if (!prev || prev.key !== g.key) {
        if (g.section && (!prev || prev.section !== g.section)) add('sec' + i, html`<tr class="rpt-group"><td colspan="4">${g.section}</td></tr>`, { row: true, keepNext: true });
        add('grp' + i, html`<tr class=${g.section ? 'rpt-subgroup' : 'rpt-group'}><td colspan="4">${g.label}</td></tr>`, { row: true, keepNext: true });
      }
      add('lab' + i, html`<tr><td>${x.label} <span class="rpt-unit">${x.unit || ''}</span></td><td class="num">${cell(x, x.vals[0])}</td><td class="num">${cell(x, x.vals[1])}</td><td class="rpt-ref">${x.ref?.text || '—'}</td></tr>`, { row: true });
    });
    add('lab-note', html`<p class="rpt-note"><span class="rpt-val ok">verde</span> dentro da referência · <span class="rpt-val out">terracota ↑↓</span> acima ou abaixo. Referências gerais; vale sempre a do seu laudo.</p>`);
  }
  if (parts.questions && (data.responses || []).length > 0) {
    add('h-q', h2(C.mustard, 'Questionários semanais'), { keepNext: true });
    const fmtAnswer = (q, v) => (q.type === 'scale' ? html`<strong>${v}</strong> <span class="rpt-muted">(de ${q.min} a ${q.max})</span>` : Array.isArray(v) ? v.join(', ') : String(v));
    for (const qn of data.questionnaires || []) {
      const rs = (data.responses || []).filter((r) => r.questionnaire_id === qn.id).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
      if (!rs.length) continue;
      const questions = (qn.questions || []).filter((q) => q.label);
      if (rs.length === 1) {
        // Uma resposta só: mostra a resposta inteira.
        const r = rs[0];
        add('q1-' + qn.id, html`<div class="rpt-q-date">Respondido em ${fmtDate(dateOf(r.submitted_at))}</div>`, { keepNext: true });
        questions.forEach((q) => {
          const v = r.answers?.[q.id];
          if (v == null || v === '') return;
          add('qa-' + q.id, html`<div class="rpt-qa"><div class="rpt-qa-q">${q.label}</div><div class="rpt-qa-a">${fmtAnswer(q, v)}</div></div>`);
        });
      } else {
        // Várias respostas: gráficos das escalas e as respostas escritas de cada data.
        chartRows(qs.filter((x) => x.key.startsWith(qn.id)), C.blue, 'qc-' + qn.id);
        questions.filter((q) => q.type !== 'scale').forEach((q) => {
          const answered = rs.filter((r) => r.answers?.[q.id] != null && r.answers[q.id] !== '');
          if (!answered.length) return;
          add('qt-' + q.id, html`<div class="rpt-qa-q rpt-qa-title">${q.label}</div>`, { keepNext: true });
          answered.forEach((r) => add('qt-' + q.id + r.id, html`<div class="rpt-qa-line"><span class="rpt-qa-when">${fmtDate(dateOf(r.submitted_at)).slice(0, 5)}</span><span>${fmtAnswer(q, r.answers[q.id])}</span></div>`));
        });
      }
    }
  }

  const cols = html`<colgroup><col style="width:46%" /><col style="width:16%" /><col style="width:16%" /><col style="width:22%" /></colgroup>`;
  const thead = html`<thead><tr><th>Exame</th><th class="num">Resultado</th><th class="num">Anterior</th><th>Referência</th></tr></thead>`;
  const [pages, setPages] = useState(null);
  const measure = useRef(null);
  useLayoutEffect(() => {
    if (pages || !measure.current) return;
    const root = measure.current;
    // Blocos comuns: cada um no seu quadro; linhas de exame: medidas todas dentro de uma tabela só (como saem na folha).
    const plain = [...root.querySelectorAll(':scope > [data-b]')].map((e) => e.getBoundingClientRect().height);
    const trs = [...root.querySelectorAll('[data-rows] tbody > tr')].map((e) => e.getBoundingClientRect().height);
    let pi = 0, ri = 0;
    const hs = blocks.map((b) => (b.row ? trs[ri++] : plain[pi++]));
    const theadH = root.querySelector('[data-rows] thead')?.getBoundingClientRect().height || 0;
    const sigH = root.querySelector('[data-sig]')?.getBoundingClientRect().height || 0;
    setPages(paginate(blocks, hs, theadH, sigH));
  });

  if (!pages) {
    return html`
      <div class="rpt rpt-measure" ref=${measure}>
        ${blocks.filter((b) => !b.row).map((b) => html`<div data-b class="rpt-block" key=${b.key}>${b.el}</div>`)}
        <div data-rows class="rpt-block"><table class="rpt-table">${cols}${thead}<tbody>${blocks.filter((b) => b.row).map((b) => b.el)}</tbody></table></div>
        <div data-sig class="rpt-block">${sig}</div>
      </div>`;
  }

  // Blocos de uma folha: linhas seguidas de exames viram uma tabela só, com o cabeçalho da tabela.
  const renderBlocks = (idx) => {
    const out = [];
    for (let k = 0; k < idx.length; k++) {
      const b = blocks[idx[k]];
      if (!b.row) { out.push(html`<div class="rpt-block" key=${b.key}>${b.el}</div>`); continue; }
      const rows = [];
      while (k < idx.length && blocks[idx[k]].row) { rows.push(blocks[idx[k]].el); k++; }
      k--;
      out.push(html`<div class="rpt-block"><table class="rpt-table">${cols}${thead}<tbody>${rows}</tbody></table></div>`);
    }
    return out;
  };
  return html`
    <div class="rpt">
      ${pages.map((p, n) => {
        const last = n === pages.length - 1;
        return html`
          <section class="rpt-sheet">
            <div class="rpt-sheet-body">${renderBlocks(p)}</div>
            ${last
              ? sig && html`<div class="rpt-sheet-sign">${sig}</div>`
              : html`<footer class="rpt-sheet-foot"><span>${footer.join('  ·  ')}</span><span class="rpt-pg">${n + 1}/${pages.length}</span></footer>`}
          </section>`;
      })}
    </div>`;
}

// Folha A4 (mm → px da tela, 96 por polegada): margem de cima 14 mm, rodapé reservado 20 mm.
const MM = 96 / 25.4;
const AVAIL = (297 - 14 - 20) * MM;
const SIG_BOTTOM = 8 * MM; // a assinatura fica 8 mm acima da borda de baixo da última folha

/** Distribui os blocos nas folhas. Devolve [[índices da folha 1], [folha 2], …]. */
function paginate(blocks, hs, theadH, sigH) {
  const pages = [[]];
  let used = 0;
  const cur = () => pages[pages.length - 1];
  const prevIsRow = () => { const p = cur(); return p.length > 0 && blocks[p[p.length - 1]].row; };
  const cost = (i, afterRow) => hs[i] + (blocks[i].row && !afterRow ? theadH : 0);
  for (let i = 0; i < blocks.length; i++) {
    let h = cost(i, prevIsRow());
    // Títulos (de seção, de grupo) não ficam sozinhos no pé da folha: vão juntos até o primeiro bloco de conteúdo.
    let need = h;
    for (let j = i; blocks[j].keepNext && j + 1 < blocks.length; j++) need += cost(j + 1, !!blocks[j].row);
    if (cur().length && used + need > AVAIL) { pages.push([]); used = 0; h = cost(i, false); }
    cur().push(i);
    used += h;
  }
  // A assinatura ocupa o pé da última folha; se não couber, abre uma folha nova para ela.
  const sigTop = (297 - 14) * MM - SIG_BOTTOM - sigH;
  if (sigH && used > sigTop - 10) { pages.push([]); used = 0; }
  // A última folha não fica só com a assinatura ou com um pedacinho: puxa da folha anterior um pedaço de pelo menos
  // ~4 cm (por exemplo, as últimas linhas da tabela), junto com os títulos que vêm logo antes dele.
  if (pages.length > 1 && used < 40 * MM) {
    const prev = pages[pages.length - 2];
    const last = cur();
    let h = used;
    const take = () => { const i = prev.pop(); last.unshift(i); h += hs[i]; };
    while (prev.length > 1 && (h < 40 * MM || blocks[prev[prev.length - 1]].keepNext)) take();
  }
  return pages;
}

/** Folha A4 sem margens do navegador: as margens, o rodapé e o número da página são desenhados pelo relatório
 * (e, sem margem, o navegador também não põe o cabeçalho/rodapé automático com data e título). */
function pageStyle() {
  return '@page { size: A4; margin: 0; }';
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
  const hasCombo = (data.consultations || []).some((c) => c.anamnesis?.combinados?.trim());
  const [parts, setParts] = useState({ combinados: hasCombo, body: true, labs: (data.labResults || []).length > 0, questions: (data.responses || []).length > 0 });
  const [message, setMessage] = useState('');
  const toggle = (k) => setParts({ ...parts, [k]: !parts[k] });
  // Logo e dados do rodapé: lidos na hora (podem ter sido salvos em Configurações depois de abrir a ficha).
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    run(supabase.from('app_settings').select('*').in('key', ['report_logo', 'report_name', 'report_title', 'report_crn', 'report_instagram', 'report_contact']))
      .then((rows) => setBrand(Object.fromEntries(rows.map((r) => [r.key, r.value]))))
      .catch(() => setBrand(data.settings || {}));
  }, []);
  return html`
    <${Modal} title="Relatório em PDF para o paciente" onClose=${onClose}>
      <p class="muted">Escolha o que entra. Na janela que abrir, escolha <strong>“Salvar como PDF”</strong> como impressora.</p>
      ${brand && (brand.report_logo && brand.report_name
        ? html`<p class="small brand-ok">✓ Logo e rodapé configurados (${brand.report_name}).</p>`
        : html`<p class="alert small">⚠️ ${!brand.report_logo && !brand.report_name ? 'Sua logo e seus dados ainda não foram salvos' : !brand.report_logo ? 'Sua logo ainda não foi salva' : 'Seu nome (rodapé) ainda não foi salvo'}.
            Vá em <a href="#/config" onClick=${onClose}>⚙️ Configurações → Relatório em PDF</a>, envie a logo, preencha os dados e clique em Salvar.</p>`)}
      <label class="checkbox-line"><input type="checkbox" checked=${parts.combinados} disabled=${!hasCombo} onChange=${() => toggle('combinados')} /> Combinados da última consulta${hasCombo ? '' : ' (nenhum registrado)'}</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.body} onChange=${() => toggle('body')} /> Composição corporal (peso, IMC e gráficos)</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.labs} onChange=${() => toggle('labs')} /> Exames laboratoriais (tabela com o último resultado e o anterior)</label>
      <label class="checkbox-line"><input type="checkbox" checked=${parts.questions} onChange=${() => toggle('questions')} /> Questionários semanais (uma resposta: a resposta completa; várias: gráficos e as respostas escritas de cada data)</label>
      <label class="field" style="margin-top:12px"><span class="field-label">Mensagem para o paciente (opcional)</span>
        <textarea rows="3" value=${message} onInput=${(e) => setMessage(e.target.value)} placeholder="Ex.: Parabéns pela evolução neste mês!"></textarea>
      </label>
      <div class="actions">
        <button class="btn" onClick=${onClose}>Cancelar</button>
        <button class="btn btn-primary" disabled=${!brand} onClick=${() => { printReport({ data, parts, message: message.trim(), brand: brand || {} }); onClose(); }}>🖨️ Gerar PDF</button>
      </div>
    <//>`;
}
