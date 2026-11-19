// Janela de resumo do paciente, aberta ao clicar numa consulta do calendário.
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, ageFrom, daysAgoLabel, latestOf, classifyBMI, OBJECTIVE_LABEL, patientCode } from '../lib/util.js';
import { bmi } from '../lib/energy.js';
import { responseStats, dateOf } from '../lib/questionnaires.js';
import { referenceStatus } from '../lib/labs.js';
import { Modal, Loading, go } from './common.js';
import { TYPE_LABEL } from './anamnesis.js';

const fmt = (n, d = 1) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d });
const clip = (t, n = 220) => (t && t.length > n ? t.slice(0, n).trimEnd() + '…' : t);

export function PatientPeek({ event, onClose }) {
  const p = event.patient;
  const [d, setD] = useState(null);

  useEffect(() => {
    Promise.all([
      run(supabase.from('consultations').select('*').eq('patient_id', p.id).order('date', { ascending: false }).limit(3)),
      run(supabase.from('measurements').select('*').eq('patient_id', p.id).in('metric', ['peso', 'altura']).order('date', { ascending: false })),
      run(supabase.from('calculations').select('*').eq('patient_id', p.id).order('created_at', { ascending: false }).limit(1)),
      run(supabase.from('questionnaire_sends').select('*').eq('patient_id', p.id)),
      run(supabase.from('questionnaire_responses').select('submitted_at').eq('patient_id', p.id).order('submitted_at', { ascending: false }).limit(1)),
      run(supabase.from('lab_results').select('*').eq('patient_id', p.id).order('date', { ascending: false })),
      run(supabase.from('patients').select('sex, birth_date, phone').eq('id', p.id)),
    ]).then(([consults, meas, calcs, sends, resp, labs, pat]) => setD({ consults, meas, calc: calcs[0], sends, lastResp: resp[0], labs, pat: pat[0] || {} }))
      .catch(() => setD({ consults: [], meas: [], calc: null, sends: [], lastResp: null, labs: [], pat: {} }));
  }, [p.id]);

  const age = ageFrom(p.birth_date);
  const first = !p.last_consult;
  const timeText = `${fmtDate(event.start)}${event.time ? ' às ' + event.time : ''}`;

  let body = html`<${Loading} />`;
  if (d) {
    const w = latestOf(d.meas, 'peso');
    const h = latestOf(d.meas, 'altura');
    const b = w && h ? bmi(Number(w.value), Number(h.value)) : null;
    const prevW = w && d.meas.filter((m) => m.metric === 'peso' && m.date < w.date).sort((a, c) => c.date.localeCompare(a.date))[0];
    const last = d.consults[0];
    const objective = d.consults.find((c) => c.objective)?.objective;
    const combinados = d.consults.find((c) => c.anamnesis?.combinados?.trim())?.anamnesis.combinados;
    const stats = responseStats(d.sends);
    // Exames: último resultado de cada biomarcador, só os fora da referência.
    const seen = new Set();
    const outOfRange = [];
    for (const r of d.labs) {
      if (seen.has(r.marker)) continue;
      seen.add(r.marker);
      const st = referenceStatus(r.marker, r.value, r.unit, d.pat.sex);
      if (st === 'low' || st === 'high') outOfRange.push(`${r.label} ${fmt(r.value, 2)} ${st === 'high' ? '↑' : '↓'}`);
    }
    body = html`
      <div class="peek-grid">
        <div class="stat"><div class="stat-label">Última consulta</div><div class="stat-value small-value">${p.last_consult ? fmtDate(p.last_consult) : '—'}</div><div class="stat-sub">${p.last_consult ? daysAgoLabel(p.last_consult) : 'primeira consulta'}</div></div>
        <div class="stat"><div class="stat-label">Peso</div><div class="stat-value small-value">${w ? `${fmt(w.value)} kg` : '—'}</div>
          <div class="stat-sub">${w ? fmtDate(w.date) : ''}${prevW ? ` · ${Number(w.value) - Number(prevW.value) > 0 ? '+' : ''}${fmt(Number(w.value) - Number(prevW.value))} kg` : ''}</div></div>
        <div class="stat"><div class="stat-label">IMC</div><div class="stat-value small-value">${b ? fmt(b) : '—'}</div><div class="stat-sub">${b ? classifyBMI(b, age) : ''}</div></div>
        <div class="stat"><div class="stat-label">Meta calórica</div><div class="stat-value small-value">${d.calc ? `${Math.round(d.calc.target_kcal).toLocaleString('pt-BR')} kcal` : '—'}</div><div class="stat-sub">${d.calc ? fmtDate(d.calc.date) : ''}</div></div>
      </div>
      <dl class="peek-list">
        ${objective && html`<dt>Objetivo</dt><dd>${OBJECTIVE_LABEL[objective]}</dd>`}
        ${last && html`<dt>Última anotação</dt><dd>${fmtDate(last.date)} · ${TYPE_LABEL[last.type]}</dd>`}
        ${combinados && html`<dt>Combinados</dt><dd>${clip(combinados)}</dd>`}
        ${stats.closed > 0 && html`<dt>Questionários</dt><dd>responde ${stats.rate}% (${stats.answered} de ${stats.closed})${d.lastResp ? ` · última resposta em ${fmtDate(dateOf(d.lastResp.submitted_at))}` : ''}</dd>`}
        ${outOfRange.length > 0 && html`<dt>Exames fora da referência</dt><dd class="lab-out">${outOfRange.join(' · ')}</dd>`}
        ${d.pat.phone && html`<dt>Telefone</dt><dd>${d.pat.phone}</dd>`}
      </dl>
      ${!last && !w && html`<p class="muted small">Ainda não há anotações deste paciente no sistema.</p>`}`;
  }

  return html`
    <${Modal} title=${p.name} onClose=${onClose}>
      <p class="muted" style="margin-top:0">
        ${patientCode(p.code)}${age != null ? ` · ${age} anos` : ''} · consulta ${timeText}
        ${first && html` <span class="cal-badge">1ª consulta</span>`}
      </p>
      ${body}
      <div class="actions">
        <button class="btn" onClick=${onClose}>Fechar</button>
        <button class="btn btn-primary" onClick=${() => { onClose(); go('/paciente/' + p.id); }}>Abrir ficha do paciente →</button>
      </div>
    <//>`;
}
