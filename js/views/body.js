// Composição corporal: medidas atuais, gráficos, histórico e entrada de medições.
import { html, useState, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO, latestOf, classifyBMI, SOURCE_LABEL, SOURCE_RANK } from '../lib/util.js';
import { METRICS, METRIC, parseMeasurementsText, bioimpedancePrompt } from '../lib/metrics.js';
import { copyText } from '../lib/prompts.js';
import { bmi } from '../lib/energy.js';
import { Modal, ErrorBox, AutoText } from './common.js';
import { MetricChart } from './charts.js';

export const fmtNum = (n, d = 1) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d });

/** Uma série por medida: um ponto por data (no mesmo dia vale a origem de maior prioridade). */
function seriesOf(measurements, key) {
  const byDate = new Map();
  for (const m of measurements) {
    if (m.metric !== key) continue;
    const prev = byDate.get(m.date);
    if (!prev || SOURCE_RANK[m.source] > SOURCE_RANK[prev.source]) byDate.set(m.date, m);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ date: m.date, value: Number(m.value), source: m.source }));
}

export function BodyCard({ measurements, age, onAdd, onDeleted }) {
  const [showHistory, setShowHistory] = useState(false);
  const weight = latestOf(measurements, 'peso');
  const height = latestOf(measurements, 'altura');
  const bmiValue = weight && height ? bmi(Number(weight.value), Number(height.value)) : null;

  const series = useMemo(
    () => METRICS.filter((m) => m.key !== 'altura').map((m) => ({ m, points: seriesOf(measurements, m.key) })).filter((s) => s.points.length >= 2),
    [measurements],
  );
  const latestOthers = METRICS.filter((m) => !['peso', 'altura'].includes(m.key))
    .map((m) => ({ m, last: latestOf(measurements, m.key) })).filter((x) => x.last);

  // Histórico agrupado por data + origem.
  const groups = useMemo(() => {
    const g = new Map();
    for (const m of measurements) {
      const k = `${m.date}|${m.source}`;
      if (!g.has(k)) g.set(k, { date: m.date, source: m.source, items: [] });
      g.get(k).items.push(m);
    }
    return [...g.values()].sort((a, b) => b.date.localeCompare(a.date) || SOURCE_RANK[b.source] - SOURCE_RANK[a.source]);
  }, [measurements]);

  async function removeGroup(gr) {
    const what = gr.items.map((i) => METRIC[i.metric]?.label || i.metric).join(', ');
    const extra = gr.source !== 'consulta' ? '\n\nAtenção: este registro veio do Nutrium e volta na próxima importação.' : '';
    if (!confirm(`Apagar as medidas de ${fmtDate(gr.date)} (${what})?${extra}`)) return;
    const ids = gr.items.map((i) => i.id);
    await run(supabase.from('measurements').delete().in('id', ids));
    onDeleted(ids);
  }

  return html`
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">⚖️ Composição corporal</h2>
        <button class="btn btn-primary btn-sm" onClick=${onAdd}>➕ Medição / Bioimpedância</button>
      </div>
      ${!measurements.length && html`<p class="muted">Nenhuma medida ainda. Use “Medição / Bioimpedância” ou importe a planilha do Nutrium (peso e altura).</p>`}
      ${measurements.length > 0 && html`
        <div class="stats">
          ${weight && html`<div class="stat"><div class="stat-label">Peso</div><div class="stat-value">${fmtNum(weight.value)} kg</div><div class="stat-sub">${fmtDate(weight.date)} · ${SOURCE_LABEL[weight.source]}</div></div>`}
          ${height && html`<div class="stat"><div class="stat-label">Altura</div><div class="stat-value">${fmtNum(height.value)} cm</div><div class="stat-sub">${fmtDate(height.date)} · ${SOURCE_LABEL[height.source]}</div></div>`}
          ${bmiValue && html`<div class="stat"><div class="stat-label">IMC</div><div class="stat-value">${fmtNum(bmiValue, 1)}</div><div class="stat-sub">${classifyBMI(bmiValue, age)}${age >= 60 ? ' (critério para idosos)' : ''}</div></div>`}
          ${latestOthers.map(({ m, last }) => html`
            <div class="stat"><div class="stat-label">${m.label}</div><div class="stat-value">${fmtNum(last.value)} ${m.unit === 'nível' ? '' : m.unit}</div><div class="stat-sub">${fmtDate(last.date)}</div></div>`)}
        </div>

        ${series.length === 0 && html`<p class="muted small" style="margin-top:12px">Os gráficos de evolução aparecem quando houver pelo menos 2 registros da mesma medida.</p>`}
        ${series.length > 0 && html`<div class="charts">${series.map(({ m, points }) => html`<${MetricChart} key=${m.key} label=${m.label} unit=${m.unit} points=${points} />`)}</div>`}

        <button class="btn btn-sm btn-ghost" style="margin-top:10px" onClick=${() => setShowHistory(!showHistory)}>
          ${showHistory ? '▾' : '▸'} Histórico de medições (${groups.length} registro(s))
        </button>
        ${showHistory && html`
          <table class="table">
            <thead><tr><th>Data</th><th>Medidas</th><th>Origem</th><th></th></tr></thead>
            <tbody>
              ${groups.map((gr) => html`
                <tr>
                  <td>${fmtDate(gr.date)}</td>
                  <td>${gr.items.map((i) => `${METRIC[i.metric]?.label || i.metric} ${fmtNum(i.value)}${METRIC[i.metric]?.unit === 'nível' ? '' : ' ' + (METRIC[i.metric]?.unit || i.unit || '')}`).join(' · ')}</td>
                  <td class="muted small">${SOURCE_LABEL[gr.source]}</td>
                  <td><button class="btn btn-sm btn-danger-ghost" onClick=${() => removeGroup(gr)}>Apagar</button></td>
                </tr>`)}
            </tbody>
          </table>`}`}
    </section>`;
}

/** Modal com as 3 formas de entrada; todas terminam na mesma tabela de revisão. */
export function MeasurementModal({ patientId, onClose, onSaved }) {
  const [mode, setMode] = useState('texto');
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayISO());
  const [values, setValues] = useState({});
  const [leftovers, setLeftovers] = useState([]);
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function read() {
    const r = parseMeasurementsText(text);
    setValues(Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, String(v).replace('.', ',')])));
    if (r.date) setDate(r.date);
    setLeftovers(r.leftovers);
    setReviewed(true);
  }

  async function copyPrompt() {
    const ok = await copyText(bioimpedancePrompt());
    setCopied(ok ? 'ok' : bioimpedancePrompt());
  }

  const filled = Object.entries(values).filter(([, v]) => String(v).trim() !== '');
  const invalid = filled.filter(([, v]) => !Number.isFinite(Number(String(v).replace(',', '.'))) || Number(String(v).replace(',', '.')) <= 0);

  async function save() {
    if (!filled.length || invalid.length) return;
    setBusy(true);
    try {
      const rows = filled.map(([k, v]) => ({
        patient_id: patientId, date, metric: k, value: Number(String(v).replace(',', '.')), unit: METRIC[k].unit, source: 'consulta',
      }));
      // Mesma data + medida registrada na consulta: substitui o valor anterior.
      await run(supabase.from('measurements').delete().eq('patient_id', patientId).eq('date', date).eq('source', 'consulta').in('metric', rows.map((r) => r.metric)));
      const saved = await run(supabase.from('measurements').insert(rows).select('*'));
      onSaved(saved, rows.map((r) => r.metric), date);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const showTable = mode === 'tabela' || reviewed;

  return html`
    <${Modal} title="Medição / Bioimpedância" onClose=${onClose} wide>
      <div class="seg" style="margin-bottom:14px">
        ${[['texto', '✍️ Texto livre'], ['foto', '📷 Foto da bioimpedância'], ['tabela', '📋 Tabela']].map(([k, l]) => html`
          <button class=${mode === k ? 'on' : ''} onClick=${() => { setMode(k); setReviewed(false); }}>${l}</button>`)}
      </div>

      ${mode === 'foto' && !reviewed && html`
        <ol class="steps">
          <li><button class="btn btn-sm" onClick=${copyPrompt}>${copied === 'ok' ? '✓ Copiado!' : '📋 Copiar instruções para a IA'}</button></li>
          <li>Na IA que você já usa, cole as instruções e <strong>anexe a foto ou print</strong> da bioimpedância.</li>
          <li>Copie a resposta da IA e cole abaixo.</li>
        </ol>
        ${copied && copied !== 'ok' && html`<textarea rows="5" readonly value=${copied} onFocus=${(e) => e.target.select()}></textarea>`}`}

      ${(mode === 'texto' || mode === 'foto') && !reviewed && html`
        <label class="field">
          <span class="field-label">${mode === 'texto' ? 'Digite ou cole as medidas, de qualquer jeito' : 'Resposta da IA'}</span>
          <${AutoText} rows=${4} value=${text} onInput=${setText}
            placeholder=${mode === 'texto' ? 'Ex.: peso 54,2 cintura 71 quadril 98 gordura 22%' : 'Peso: 70,5\n% Gordura: 21,3\n…'} />
        </label>
        <div class="actions">
          <button class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" onClick=${read} disabled=${!text.trim()}>Ler medidas →</button>
        </div>`}

      ${showTable && html`
        ${reviewed && html`<div class="alert">Confira os valores lidos antes de salvar. Você pode corrigir, apagar ou completar qualquer campo.</div>`}
        ${leftovers.length > 0 && html`<div class="alert">Não reconheci: <strong>${leftovers.join(' · ')}</strong>. Se for uma medida da lista, digite na tabela.</div>`}
        <label class="field" style="max-width:220px">
          <span class="field-label">Data da medição</span>
          <input type="date" value=${date} max=${todayISO()} onInput=${(e) => setDate(e.target.value)} />
        </label>
        <div class="measure-grid">
          ${[...new Set(METRICS.map((m) => m.group))].map((g) => html`
            <div class="measure-group">
              <div class="measure-group-title">${g}</div>
              ${METRICS.filter((m) => m.group === g).map((m) => html`
                <label class=${'measure-row' + (values[m.key] ? ' filled' : '')}>
                  <span>${m.label}</span>
                  <input inputmode="decimal" value=${values[m.key] || ''} onInput=${(e) => setValues({ ...values, [m.key]: e.target.value })} />
                  <span class="muted small">${m.unit}</span>
                </label>`)}
            </div>`)}
        </div>
        ${invalid.length > 0 && html`<div class="alert alert-error">Valor inválido em: ${invalid.map(([k]) => METRIC[k].label).join(', ')}</div>`}
        <${ErrorBox} error=${error} />
        <div class="actions">
          ${reviewed && html`<button class="btn btn-ghost" onClick=${() => setReviewed(false)}>← Voltar ao texto</button>`}
          <span class="spacer"></span>
          <button class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" onClick=${save} disabled=${busy || !filled.length || invalid.length}>
            ${busy ? 'Salvando…' : `✓ Confirmar e salvar (${filled.length})`}
          </button>
        </div>`}
    <//>`;
}
