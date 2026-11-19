// Janela de resumo do paciente, aberta ao clicar numa consulta do calendário.
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, ageFrom, daysAgoLabel, OBJECTIVE_LABEL, patientCode } from '../lib/util.js';
import { responseStats } from '../lib/questionnaires.js';
import { Modal, Loading, go } from './common.js';

const clip = (t, n = 400) => (t && t.length > n ? t.slice(0, n).trimEnd() + '…' : t);

export function PatientPeek({ event, onClose }) {
  const p = event.patient;
  const [d, setD] = useState(null);

  useEffect(() => {
    Promise.all([
      run(supabase.from('consultations').select('*').eq('patient_id', p.id).order('date', { ascending: false }).limit(1)),
      run(supabase.from('questionnaire_sends').select('*').eq('patient_id', p.id)),
      run(supabase.from('patients').select('phone').eq('id', p.id)),
    ]).then(([consults, sends, pat]) => setD({ last: consults[0] || null, sends, phone: pat[0]?.phone || p.phone || null }))
      .catch(() => setD({ last: null, sends: [], phone: p.phone || null }));
  }, [p.id]);

  const age = ageFrom(p.birth_date);
  const timeText = `${fmtDate(event.start)}${event.time ? ' às ' + event.time : ''}`;

  let body = html`<${Loading} />`;
  if (d) {
    const last = d.last;
    const a = last?.anamnesis || {};
    // Primeira consulta: os objetivos que ela relatou. Retorno: o resumo do mês.
    const story = last && (last.type === 'inicial'
      ? { label: 'Objetivos da consulta', text: a.objetivos?.trim() }
      : { label: 'Resumo do mês', text: a.resumo_mes?.trim() });
    const stats = responseStats(d.sends);
    const none = html`<span class="muted">—</span>`;
    body = html`
      <dl class="peek-list">
        <dt>Última consulta</dt>
        <dd>${p.last_consult ? `${fmtDate(p.last_consult)} (${daysAgoLabel(p.last_consult).toLowerCase()})` : 'nenhuma: primeira consulta'}</dd>
        ${story && html`<dt>${story.label}</dt><dd>${story.text ? clip(story.text) : none}</dd>`}
        <dt>Objetivo</dt><dd>${last?.objective ? OBJECTIVE_LABEL[last.objective] : none}</dd>
        <dt>Combinados</dt><dd>${a.combinados?.trim() ? clip(a.combinados.trim()) : none}</dd>
        <dt>Questionários</dt><dd>${stats.closed > 0 ? `responde ${stats.rate}% (${stats.answered} de ${stats.closed})` : none}</dd>
        <dt>Telefone</dt><dd>${d.phone || none}</dd>
      </dl>
      ${!last && html`<p class="muted small">Ainda não há anotações deste paciente no sistema.</p>`}`;
  }

  return html`
    <${Modal} title=${p.name} onClose=${onClose}>
      <p class="muted" style="margin-top:0">
        ${patientCode(p.code)}${age != null ? ` · ${age} anos` : ''} · consulta ${timeText}
        ${!p.last_consult && html` <span class="cal-badge">1ª consulta</span>`}
      </p>
      ${body}
      <div class="actions">
        <button class="btn" onClick=${onClose}>Fechar</button>
        <button class="btn btn-primary" onClick=${() => { onClose(); go('/paciente/' + p.id); }}>Abrir ficha do paciente →</button>
      </div>
    <//>`;
}
