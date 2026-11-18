// Ficha do paciente: exames laboratoriais (anexar laudo, leitura pela IA no modo B, revisão, histórico e gráficos).
import { html, useState, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, todayISO } from '../lib/util.js';
import { MARKERS, MARKER, parseLabText, labPrompt, keyForLabel, findMarker } from '../lib/labs.js';
import { copyText } from '../lib/prompts.js';
import { Modal, ErrorBox, AutoText } from './common.js';
import { MetricChart } from './charts.js';

const BUCKET = 'exames';
const MAX_BYTES = 10 * 1024 * 1024;
const fmt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const markerOrder = (k) => { const i = MARKERS.findIndex((m) => m.key === k); return i < 0 ? 999 : i; };

/** Fotos grandes são reduzidas (máx. 1800 px, JPEG) para caber no espaço gratuito. */
async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.size < 600 * 1024) return file;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

export function LabsCard({ patientId, exams, results, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [showCharts, setShowCharts] = useState(false);

  // Tabela: um biomarcador por linha, as datas (mais recentes primeiro) nas colunas.
  const dates = useMemo(() => [...new Set(results.map((r) => r.date))].sort().reverse(), [results]);
  const shownDates = dates.slice(0, 6);
  const rows = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      if (!m.has(r.marker)) m.set(r.marker, { marker: r.marker, label: r.label, unit: r.unit, byDate: {} });
      m.get(r.marker).byDate[r.date] = r;
    }
    return [...m.values()].sort((a, b) => markerOrder(a.marker) - markerOrder(b.marker) || a.label.localeCompare(b.label));
  }, [results]);
  const series = rows.map((r) => ({ ...r, points: Object.values(r.byDate).sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date, value: Number(x.value) })) }))
    .filter((r) => r.points.length >= 2);

  async function openFile(exam) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(exam.file_path, 120);
    if (error) { alert('Não foi possível abrir o arquivo: ' + error.message); return; }
    window.open(data.signedUrl, '_blank');
  }

  async function removeExam(exam) {
    if (!confirm(`Apagar o exame de ${fmtDate(exam.date)} e todos os resultados dele?`)) return;
    if (exam.file_path) await supabase.storage.from(BUCKET).remove([exam.file_path]);
    await run(supabase.from('lab_exams').delete().eq('id', exam.id));
    onChanged();
  }

  return html`
    <section class="card" id="exames">
      <div class="card-title-row">
        <h2 class="card-title">🧪 Exames laboratoriais</h2>
        <button class="btn btn-primary btn-sm" onClick=${() => setAdding(true)}>📄 Anexar exame</button>
      </div>
      ${!exams.length && html`<p class="muted">Nenhum exame registrado.</p>`}
      ${rows.length > 0 && html`
        <div class="table-scroll">
          <table class="table labs">
            <thead><tr><th>Exame</th>${shownDates.map((d) => html`<th class="num">${fmtDate(d)}</th>`)}</tr></thead>
            <tbody>
              ${rows.map((r) => html`
                <tr>
                  <td>${r.label} <span class="muted small">${r.unit || ''}</span></td>
                  ${shownDates.map((d) => html`<td class="num">${r.byDate[d] ? fmt(r.byDate[d].value) : ''}</td>`)}
                </tr>`)}
            </tbody>
          </table>
        </div>
        ${dates.length > shownDates.length && html`<p class="muted small">Mostrando as 6 datas mais recentes de ${dates.length}.</p>`}`}
      ${exams.length > 0 && html`
        <div class="exam-list">
          ${exams.map((e) => html`
            <div class="exam-item">
              <span><strong>${fmtDate(e.date)}</strong> <span class="muted small">· ${results.filter((r) => r.exam_id === e.id).length} resultado(s)</span></span>
              <span class="row-actions">
                ${e.file_path && html`<button class="btn btn-sm" onClick=${() => openFile(e)}>📎 Ver laudo</button>`}
                <button class="btn btn-sm btn-danger-ghost" onClick=${() => removeExam(e)}>Apagar</button>
              </span>
            </div>`)}
        </div>`}
      ${series.length > 0 && html`
        <button class="btn btn-sm btn-ghost" onClick=${() => setShowCharts(!showCharts)}>${showCharts ? '▾' : '▸'} Gráficos de evolução (${series.length})</button>
        ${showCharts && html`<div class="charts">${series.map((s) => html`<${MetricChart} key=${s.marker} label=${s.label} unit=${s.unit || ''} points=${s.points} />`)}</div>`}`}
    </section>
    ${adding && html`<${LabModal} patientId=${patientId} onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); onChanged(); }} />`}`;
}

function LabModal({ patientId, onClose, onSaved }) {
  const [file, setFile] = useState(null);
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
    if (file && file.size > MAX_BYTES * 2) return setError(new Error('Arquivo grande demais (máximo 10 MB).'));
    setBusy(true);
    try {
      let file_path = null;
      let file_name = null;
      if (file) {
        const f = await compressImage(file);
        if (f.size > MAX_BYTES) throw new Error('Arquivo grande demais (máximo 10 MB). Tente uma foto menor ou o PDF.');
        const ext = (f.name.match(/\.(\w+)$/)?.[1] || 'bin').toLowerCase();
        file_path = `${patientId}/${date}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        file_name = file.name;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(file_path, f, { contentType: f.type || undefined });
        if (upErr) throw upErr;
      }
      const [exam] = await run(supabase.from('lab_exams').insert({ patient_id: patientId, date, file_path, file_name }).select('*'));
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
    <${Modal} title="Anexar exame laboratorial" onClose=${onClose} wide>
      ${!rows && html`
        <ol class="steps">
          <li>
            <strong>Laudo (opcional):</strong> escolha o PDF ou a foto para guardar junto.
            <input type="file" accept="application/pdf,image/*" style="margin-top:6px" onChange=${(e) => setFile(e.target.files[0] || null)} />
          </li>
          <li><button class="btn btn-sm" onClick=${copy}>${copied === 'ok' ? '✓ Copiado!' : '📋 Copiar instruções para a IA'}</button>
            Cole na IA que você usa e <strong>anexe o mesmo laudo</strong>.</li>
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
          <thead><tr><th>Exame</th><th>Valor</th><th>Unidade</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r, i) => html`
              <tr>
                <td><input value=${r.label} onInput=${(e) => upd(i, { label: e.target.value })} list="lab-markers" />
                  ${!findMarker(r.label) && r.label && html`<div class="muted small">fora da lista padrão (fica com esse nome)</div>`}
                  ${r.note && html`<div class="muted small">${r.note}</div>`}</td>
                <td><input inputmode="decimal" value=${r.value} onInput=${(e) => upd(i, { value: e.target.value })} /></td>
                <td><input value=${r.unit} onInput=${(e) => upd(i, { unit: e.target.value })} /></td>
                <td><button class="btn btn-sm btn-ghost" onClick=${() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
              </tr>`)}
          </tbody>
        </table>
        <datalist id="lab-markers">${MARKERS.map((m) => html`<option value=${m.label} />`)}</datalist>
        <button class="btn btn-sm btn-ghost" onClick=${() => setRows([...rows, { label: '', value: '', unit: '' }])}>+ resultado</button>
        ${file && html`<p class="muted small">Laudo anexado: ${file.name}</p>`}
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
