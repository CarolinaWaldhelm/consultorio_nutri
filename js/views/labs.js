// Ficha do paciente: exames laboratoriais (leitura pela IA no modo B, revisão, histórico e gráficos).
// Só a resposta da IA é guardada (sem o arquivo do laudo).
import { html, useState, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO } from '../lib/util.js';
import { MARKERS, MARKER, parseLabText, labPrompt, keyForLabel, findMarker, referenceFor, referenceStatus, ageAt, labGroup, labOrder, markerOf } from '../lib/labs.js';
import { copyText, labsInsightPrompt } from '../lib/prompts.js';
import { Modal, ErrorBox, AutoText } from './common.js';
import { MetricChart } from './charts.js';

const fmt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const markerOrder = labOrder;

const ARROW = { low: '↓', high: '↑' };
const STATUS_TITLE = { ok: 'Dentro da referência', low: 'Abaixo da referência', high: 'Acima da referência' };

/** Valor com cor e seta: verde dentro, vermelho fora (↑ acima, ↓ abaixo). */
export function LabValue({ marker, value, unit, sex, age = null }) {
  const st = referenceStatus(marker, value, unit, sex, age);
  return html`<span class=${'lab-val' + (st ? ' lab-' + (st === 'ok' ? 'ok' : 'out') : '')} title=${st ? STATUS_TITLE[st] : ''}>${fmt(value)}${st && st !== 'ok' ? ' ' + ARROW[st] : ''}</span>`;
}

export function LabsCard({ patientId, patient = null, sex, birthDate = null, exams, results, onChanged }) {
  const [insightCopied, setInsightCopied] = useState(null);
  async function copyInsight() {
    const text = labsInsightPrompt(patient || { sex, birth_date: birthDate }, results);
    if (await copyText(text)) { setInsightCopied('ok'); setTimeout(() => setInsightCopied(null), 3000); }
    else setInsightCopied(text);
  }
  // Referências por idade: idade do paciente em cada coleta (e hoje, para a coluna de referência).
  const ageOn = (d) => ageAt(birthDate, d);
  const ageNow = ageAt(birthDate, todayISO());
  const [adding, setAdding] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [open, setOpen] = useState(true); // recolher/abrir a seção
  const [allRows, setAllRows] = useState(false); // tabela: 10 linhas ou todas
  const ROWS = 10;
  const [viewing, setViewing] = useState(null);

  // Tabela: um biomarcador por linha e as datas em ordem cronológica nas colunas (as 6 mais recentes),
  // pela data da coleta, mesmo que um exame antigo seja lançado depois.
  const dates = useMemo(() => [...new Set(results.map((r) => r.date))].sort(), [results]);
  const shownDates = dates.slice(-6);
  const examsByDate = [...exams].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  const rows = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      const k = markerOf(r);
      if (!m.has(k)) m.set(k, { marker: k, label: k === r.marker ? r.label : MARKER[k].label, unit: r.unit, byDate: {} });
      m.get(k).byDate[r.date] = r;
    }
    return [...m.values()].sort((a, b) => markerOrder(a.marker) - markerOrder(b.marker) || a.label.localeCompare(b.label));
  }, [results]);
  const series = rows.map((r) => ({ ...r, points: Object.values(r.byDate).sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date, value: Number(x.value) })) }))
    .filter((r) => r.points.length >= 2);

  async function removeExam(exam) {
    if (!confirm(`Apagar o exame de ${fmtDate(exam.date)} e todos os resultados dele?`)) return;
    await run(supabase.from('lab_exams').delete().eq('id', exam.id));
    onChanged();
  }

  return html`
    <section class="card" id="exames">
      <div class="card-title-row">
        <button class="card-title collapse-title" aria-expanded=${open} onClick=${() => setOpen(!open)}>
          ${open ? '▾' : '▸'} 🧪 Exames laboratoriais <span class="muted small">${exams.length ? `(${exams.length} exame${exams.length > 1 ? 's' : ''})` : ''}</span>
        </button>
        <span class="row-actions">
          ${results.length > 0 && html`<button class="btn btn-sm" title="Copia o pedido de insights dos exames (sem nome) para colar na sua IA" onClick=${copyInsight}>${insightCopied === 'ok' ? '✓ Copiado! Cole na IA' : '💡 Insights dos exames'}</button>`}
          <button class="btn btn-primary btn-sm" onClick=${() => setAdding(true)}>📄 Registrar exame</button>
        </span>
      </div>
      ${insightCopied && insightCopied !== 'ok' && html`<p class="muted small">Não consegui copiar sozinho. Copie o texto abaixo (Ctrl+A, Ctrl+C):</p>
        <textarea rows="6" readonly value=${insightCopied} onFocus=${(e) => e.target.select()}></textarea>`}
      ${open && html`
      ${!exams.length && html`<p class="muted">Nenhum exame registrado.</p>`}
      ${rows.length > 0 && html`
        <div class="table-scroll">
          <table class="table labs">
            <thead><tr><th>Exame</th><th class="ref">Referência</th>${shownDates.map((d) => html`<th class="num">${fmtDate(d)}</th>`)}</tr></thead>
            <tbody>
              ${(allRows ? rows : rows.slice(0, ROWS)).map((r, i, list) => html`
                ${(() => {
                  const g = labGroup(r.marker), prev = i ? labGroup(list[i - 1].marker) : null;
                  if (prev && prev.key === g.key) return '';
                  const cols = 2 + shownDates.length;
                  return html`
                    ${g.section && (!prev || prev.section !== g.section) && html`<tr class="lab-group"><td colspan=${cols}>${g.section}</td></tr>`}
                    <tr class=${g.section ? 'lab-subgroup' : 'lab-group'}><td colspan=${cols}>${g.label}</td></tr>`;
                })()}
                <tr>
                  <td>${r.label} <span class="muted small">${r.unit || ''}</span></td>
                  ${(() => { const ref = referenceFor(r.marker, sex, ageNow); return html`
                  <td class="ref muted small" title=${ref?.note || ''}>${ref?.text || '—'}${ref?.ageLabel ? html` <span class="age-ref">(${ref.ageLabel})</span>` : ''}${ref?.note ? ' ⓘ' : ''}</td>`; })()}
                  ${shownDates.map((d) => html`<td class="num">${r.byDate[d] ? html`<${LabValue} marker=${r.marker} value=${r.byDate[d].value} unit=${r.byDate[d].unit} sex=${sex} age=${ageOn(d)} />` : ''}</td>`)}
                </tr>`)}
            </tbody>
          </table>
        </div>
        ${rows.length > ROWS && html`
          <button class="btn btn-sm btn-ghost show-more" onClick=${() => setAllRows(!allRows)}>
            ${allRows ? `Mostrar só ${ROWS} linhas` : `Mostrar tudo (${rows.length} exames)`}
          </button>`}
        <p class="muted small lab-legend">
          <span class="lab-val lab-ok">verde</span>${' dentro da referência · '}<span class="lab-val lab-out">vermelho ↑↓</span>${' acima ou abaixo. '}
          Referências gerais, ajustadas por sexo e idade${birthDate ? '' : ' (sem data de nascimento no cadastro: usa a faixa de adulto)'}${sex ? '' : ' (o sexo não está no cadastro: faixas que variam por sexo ficam sem cor)'};
          cada laboratório tem as suas, e em caso de dúvida vale a do laudo. Passe o mouse no ⓘ para ver observações.
          ${dates.length > shownDates.length ? ` Mostrando as 6 coletas mais recentes de ${dates.length}.` : ''}
        </p>`}
      ${exams.length > 0 && html`
        <div class="exam-list">
          ${examsByDate.map((e) => html`
            <div class="exam-item">
              <span><strong>${fmtDate(e.date)}</strong> <span class="muted small">· ${results.filter((r) => r.exam_id === e.id).length} resultado(s)</span></span>
              <span class="row-actions">
                ${e.notes && html`<button class="btn btn-sm" onClick=${() => setViewing(e)}>📄 Ver resposta da IA</button>`}
                <button class="btn btn-sm btn-danger-ghost" onClick=${() => removeExam(e)}>Apagar</button>
              </span>
            </div>`)}
        </div>`}
      ${series.length > 0 && html`
        <button class="btn btn-sm btn-ghost" onClick=${() => setShowCharts(!showCharts)}>${showCharts ? '▾' : '▸'} Gráficos de evolução (${series.length})</button>
        ${showCharts && html`<div class="charts">${series.map((s) => html`<${MetricChart} key=${s.marker} label=${s.label} unit=${s.unit || ''} points=${s.points} />`)}</div>`}`}
      `}
    </section>
    ${viewing && html`<${Modal} title=${`Exame de ${fmtDate(viewing.date)} · resposta da IA`} onClose=${() => setViewing(null)}><div class="qa-a">${viewing.notes}</div><//>`}
    ${adding && html`<${LabModal} patientId=${patientId} sex=${sex} age=${ageNow} onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); onChanged(); }} />`}`;
}

function LabModal({ patientId, sex, age = null, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState(null);
  const [copied, setCopied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function read() {
    const r = parseLabText(text);
    if (r.date) setDate(r.date);
    setRows(r.rows.map((x) => ({ ...x, value: String(x.value).replace('.', ',') })));
  }

  async function copy() {
    const t = labPrompt();
    setCopied((await copyText(t)) ? 'ok' : t);
  }

  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid = rows?.filter((r) => r.label.trim() && Number.isFinite(Number(String(r.value).replace(',', '.'))) && String(r.value).trim() !== '') || [];

  async function save() {
    setError(null);
    if (!valid.length) return setError(new Error('Nenhum resultado para salvar.'));
    setBusy(true);
    try {
      const [exam] = await run(supabase.from('lab_exams').insert({ patient_id: patientId, date, notes: text.trim().slice(0, 20000) || null }).select('*'));
      await run(supabase.from('lab_results').insert(valid.map((r) => {
        const def = findMarker(r.label);
        return {
          exam_id: exam.id, patient_id: patientId, date,
          marker: def ? def.key : keyForLabel(r.label),
          label: def ? def.label : r.label.trim(),
          value: Number(String(r.value).replace(',', '.')),
          unit: r.unit?.trim() || def?.unit || null,
        };
      })));
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return html`
    <${Modal} title="Registrar exame laboratorial" onClose=${onClose} wide>
      ${!rows && html`
        <ol class="steps">
          <li><button class="btn btn-sm" onClick=${copy}>${copied === 'ok' ? '✓ Copiado!' : '📋 Copiar instruções para a IA'}</button>
            Cole na IA que você usa e <strong>anexe o laudo</strong> (PDF ou foto) lá na IA.</li>
          <li>Copie a resposta da IA e cole abaixo. (Também dá para digitar: “Glicemia de jejum: 92”.)</li>
        </ol>
        ${copied && copied !== 'ok' && html`<textarea rows="5" readonly value=${copied} onFocus=${(e) => e.target.select()}></textarea>`}
        <${AutoText} rows=${6} value=${text} onInput=${setText} placeholder=${'Data: 05/11/2026\nGlicemia de jejum: 92 mg/dL\nLDL: 120 mg/dL\n…'} />
        <div class="actions">
          <button class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" disabled=${!text.trim()} onClick=${read}>Ler resultados →</button>
        </div>`}

      ${rows && html`
        <div class="alert">Confira os resultados antes de salvar: corrija, apague ou acrescente o que precisar.</div>
        <label class="field" style="max-width:220px"><span class="field-label">Data da coleta</span>
          <input type="date" value=${date} max=${todayISO()} onInput=${(e) => setDate(e.target.value)} />
        </label>
        <table class="table lab-review">
          <thead><tr><th>Exame</th><th>Valor</th><th>Unidade</th><th>Referência</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r, i) => html`
              <tr>
                <td><input value=${r.label} onInput=${(e) => upd(i, { label: e.target.value })} list="lab-markers" />
                  ${!findMarker(r.label) && r.label && html`<div class="muted small">fora da lista padrão (fica com esse nome)</div>`}
                  ${r.note && html`<div class="muted small">${r.note}</div>`}</td>
                <td><input inputmode="decimal" value=${r.value} onInput=${(e) => upd(i, { value: e.target.value })} /></td>
                <td><input value=${r.unit} onInput=${(e) => upd(i, { unit: e.target.value })} /></td>
                <td class="small">${(() => {
                  const def = findMarker(r.label);
                  const v = Number(String(r.value).replace(',', '.'));
                  if (!def || !Number.isFinite(v)) return '—';
                  return html`${referenceFor(def.key, sex, age)?.text || '—'} <${LabValue} marker=${def.key} value=${v} unit=${r.unit} sex=${sex} age=${age} />`;
                })()}</td>
                <td><button class="btn btn-sm btn-ghost" onClick=${() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
              </tr>`)}
          </tbody>
        </table>
        <datalist id="lab-markers">${MARKERS.map((m) => html`<option value=${m.label} />`)}</datalist>
        <button class="btn btn-sm btn-ghost" onClick=${() => setRows([...rows, { label: '', value: '', unit: '' }])}>+ resultado</button>
        <${ErrorBox} error=${error} />
        <div class="actions">
          <button class="btn btn-ghost" onClick=${() => setRows(null)}>← Voltar</button>
          <span class="spacer"></span>
          <button class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" disabled=${busy || !valid.length} onClick=${save}>${busy ? 'Salvando…' : `✓ Confirmar e salvar (${valid.length})`}</button>
        </div>`}
    <//>`;
}

export { MARKER };
