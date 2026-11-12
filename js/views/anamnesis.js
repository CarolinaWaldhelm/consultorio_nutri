// Painel lateral de anotações da consulta (anamnese inicial ou de retorno).
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { OBJECTIVES, fmtDate } from '../lib/util.js';
import { AutoText, ErrorBox } from './common.js';

export const FIELDS = {
  inicial: [
    ['objetivos', 'Objetivos da consulta'],
    ['@objetivo'],
    ['intestino_agua', 'Funcionamento do intestino e água'],
    ['sono', 'Qualidade do sono'],
    ['tabaco', 'Tabaco (cigarro)'],
    ['alcool', 'Álcool'],
    ['atividade_fisica', 'Atividade física', 'Tipo, dias por semana e duração. É a base do fator de atividade no motor de cálculos.'],
    ['doencas', 'Doenças diagnosticadas'],
    ['medicacoes', 'Medicações de uso contínuo'],
    ['mal_aceitos', 'Alimentos mal aceitos'],
    ['favoritos', 'Alimentos favoritos'],
    ['alergias', 'Alergias e intolerâncias'],
    ['exames_obs', 'Observações sobre exames iniciais'],
    ['combinados', 'Combinados / Conduta', 'O que foi alinhado com o paciente: metas, orientações.'],
  ],
  retorno: [
    ['intestino_agua', 'Relato sobre intestino e água'],
    ['sono', 'Relato de sono'],
    ['atividade_fisica', 'Relato de atividade física', 'Sempre preencher: o motor de cálculos usa o relato mais recente.'],
    ['@objetivo'],
    ['combinados', 'Combinados / Conduta', 'O que foi alinhado com o paciente: metas, orientações.'],
    ['resumo_mes', 'Resumo do mês', 'Inclua mudanças de medicação, novas doenças e adesão ao plano. Alimenta o resumo pré-consulta.'],
  ],
};

export const TYPE_LABEL = { inicial: 'Primeira consulta', retorno: 'Retorno' };

export function ObjectivePicker({ value, onChange }) {
  return html`
    <div class="field">
      <span class="field-label">Objetivo (seleção)</span>
      <div class="chips">
        ${OBJECTIVES.map(([k, label]) => html`
          <button type="button" class=${'chip' + (value === k ? ' on' : '')} onClick=${() => onChange(value === k ? null : k)}>${label}</button>`)}
      </div>
    </div>`;
}

export function AnamnesisDrawer({ consultation, patientName, onSaved, onDeleted, onClose }) {
  const [c, setC] = useState(consultation);
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | error
  const [error, setError] = useState(null);
  const pending = useRef(null);
  const timer = useRef(null);

  // Se outra consulta for aberta, troca o conteúdo (salvando a anterior).
  useEffect(() => { setC(consultation); }, [consultation.id]);

  async function save(next) {
    clearTimeout(timer.current);
    pending.current = null;
    setStatus('saving');
    try {
      await run(supabase.from('consultations').update({
        date: next.date, type: next.type, objective: next.objective, anamnesis: next.anamnesis,
      }).eq('id', next.id));
      setStatus('saved');
      setError(null);
      onSaved(next);
    } catch (err) {
      setStatus('error');
      setError(err);
      pending.current = next;
    }
  }

  function change(patch) {
    const next = { ...c, ...patch };
    setC(next);
    setStatus('dirty');
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 800);
  }

  const setField = (k) => (v) => change({ anamnesis: { ...c.anamnesis, [k]: v } });

  async function close() {
    if (pending.current) await save(pending.current);
    onClose();
  }

  // Salva antes de sair da página.
  useEffect(() => {
    const warn = (e) => { if (pending.current) { save(pending.current); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); if (pending.current) save(pending.current); };
  }, []);

  async function remove() {
    if (!confirm('Apagar esta consulta e todas as anotações dela? Isso não pode ser desfeito.')) return;
    clearTimeout(timer.current);
    pending.current = null;
    await run(supabase.from('consultations').delete().eq('id', c.id));
    onDeleted(c.id);
  }

  const label = { saved: 'Salvo ✓', dirty: 'Editando…', saving: 'Salvando…', error: 'Erro ao salvar' }[status];

  return html`
    <aside class="drawer" aria-label="Painel de anotações">
      <header class="drawer-head">
        <div>
          <div class="drawer-title">📋 ${patientName}</div>
          <div class=${'save-status ' + status}>${label}</div>
        </div>
        <button class="icon-btn" onClick=${close} aria-label="Fechar painel">✕</button>
      </header>
      <div class="drawer-meta">
        <input type="date" value=${c.date} onChange=${(e) => e.target.value && change({ date: e.target.value })} />
        <div class="seg">
          ${['inicial', 'retorno'].map((t) => html`
            <button class=${c.type === t ? 'on' : ''} onClick=${() => change({ type: t })}>${TYPE_LABEL[t]}</button>`)}
        </div>
      </div>
      <div class="drawer-body">
        <${ErrorBox} error=${error} />
        ${FIELDS[c.type].map(([k, label, hint]) => k === '@objetivo'
          ? html`<${ObjectivePicker} value=${c.objective} onChange=${(v) => change({ objective: v })} />`
          : html`
            <label class="field">
              <span class="field-label">${label}</span>
              <${AutoText} value=${c.anamnesis[k]} onInput=${setField(k)} />
              ${hint && html`<span class="field-hint">${hint}</span>`}
            </label>`)}
        <div class="drawer-foot">
          <span class="muted small">Consulta de ${fmtDate(c.date)} · salva automaticamente</span>
          <button class="btn btn-sm btn-danger-ghost" onClick=${remove}>Apagar consulta</button>
        </div>
      </div>
    </aside>`;
}
