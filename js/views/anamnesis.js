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

export function AnamnesisDrawer({ consultation, patientName, otherDates, onSaved, onDeleted, onClose, onNew }) {
  const [c, setC] = useState(consultation);
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | error
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const pending = useRef(null);
  const timer = useRef(null);

  // Se outra consulta for aberta, troca o conteúdo (salvando a anterior).
  useEffect(() => { setC(consultation); }, [consultation.id]);

  useEffect(() => {
    document.body.classList.add('drawer-open');
    return () => document.body.classList.remove('drawer-open');
  }, []);

  const isEmpty = (x) => !Object.values(x.anamnesis || {}).some((v) => String(v ?? '').trim());

  async function save(next) {
    clearTimeout(timer.current);
    pending.current = null;
    setStatus('saving');
    try {
      await run(supabase.from('consultations').update({
        date: next.date, type: next.type, objective: next.objective, anamnesis: next.anamnesis,
      }).eq('id', next.id));
      setStatus('saved');
      setSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
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

  async function saveNow() {
    await save(pending.current || c);
  }

  async function close() {
    const current = pending.current || c;
    // Consulta aberta e fechada sem nenhuma anotação: não fica no histórico.
    if (isEmpty(current)) {
      clearTimeout(timer.current);
      pending.current = null;
      try { await run(supabase.from('consultations').delete().eq('id', current.id)); onDeleted(current.id); return; } catch { /* segue fechando */ }
    }
    if (pending.current) await save(pending.current);
    onClose();
  }

  async function newOne() {
    if (isEmpty(pending.current || c)) { await close(); onNew(); return; }
    if (pending.current) await save(pending.current);
    onNew();
  }

  function changeDate(value) {
    if (!value || value === c.date) return;
    if (otherDates.includes(value)) {
      alert(`Já existe outra consulta registrada em ${fmtDate(value)}. Abra essa consulta pelo histórico de anamneses.`);
      return;
    }
    if (!confirm(`Mudar a data DESTA consulta de ${fmtDate(c.date)} para ${fmtDate(value)}?\n\nPara registrar uma consulta diferente, use "➕ Outra consulta".`)) return;
    change({ date: value });
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

  const label = { saved: savedAt ? `Salvo ✓ às ${savedAt}` : 'Salvo ✓', dirty: 'Editando…', saving: 'Salvando…', error: 'Erro ao salvar' }[status];

  return html`
    <aside class="drawer" aria-label="Painel de anotações">
      <header class="drawer-head">
        <div>
          <div class="drawer-title">📋 ${patientName}</div>
          <div class=${'save-status ' + status}>${label}</div>
        </div>
        <div class="drawer-head-actions">
          <button class="btn btn-primary btn-sm" onClick=${saveNow} disabled=${status === 'saving'}>💾 Salvar</button>
          <button class="icon-btn" onClick=${close} aria-label="Fechar painel">✕</button>
        </div>
      </header>
      <div class="drawer-meta">
        <label class="drawer-date">
          <span class="field-hint">Data desta consulta</span>
          <input type="date" value=${c.date} onChange=${(e) => { changeDate(e.target.value); e.target.value = c.date; }} />
        </label>
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
          <button class="btn btn-primary" onClick=${async () => { await saveNow(); close(); }}>💾 Salvar e fechar</button>
          <button class="btn" onClick=${newOne}>➕ Outra consulta</button>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-danger-ghost" onClick=${remove}>Apagar consulta</button>
        </div>
        <p class="muted small">Consulta de ${fmtDate(c.date)}. Além do botão Salvar, o texto também é salvo sozinho enquanto você digita. Se fechar sem escrever nada, a consulta não fica no histórico.</p>
      </div>
    </aside>`;
}
