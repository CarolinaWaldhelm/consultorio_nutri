// Motor de cálculos metabólicos (especificação §3.6). Cálculos em código; a IA só sugere o fator de atividade.
import { html, useState, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate, ageFrom, todayISO, daysBetween, latestOf, classifyBMI, OBJECTIVES, OBJECTIVE_LABEL, SEX_LABEL } from '../lib/util.js';
import {
  ACTIVITY_LEVELS, ACTIVITY, DEFAULT_ADJUST, FORMULAS, allFormulas, recommend, energyPlan, bmi, idealWeight, adjustedWeight,
  referenceWeight, DEFAULT_MACROS, PROTEIN_RANGE, macroPlan, macroWarnings,
} from '../lib/energy.js';
import { copyText } from '../lib/prompts.js';
import { ErrorBox } from './common.js';
import { fmtNum } from './body.js';

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const kcal = (n) => (n == null ? '–' : `${Math.round(n).toLocaleString('pt-BR')} kcal`);

function activityPrompt(text, sexAge) {
  const levels = ACTIVITY_LEVELS.map((a) => `- ${a.label} (${String(a.factor).replace('.', ',')}): ${a.hint}`).join('\n');
  return `Você é assistente de uma nutricionista. Classifique o nível de atividade física do paciente (${sexAge}) a partir do relato abaixo,
para uso como fator de atividade no cálculo do gasto energético total (GET = TMB × fator).

Escolha UMA destas opções:
${levels}

Responda em 2 linhas:
NÍVEL: <nome exato da opção>
JUSTIFICATIVA: <1 ou 2 frases, considerando frequência, duração e intensidade>

RELATO DE ATIVIDADE FÍSICA:
${text}`;
}

export function CalcCard({ patient, measurements, consultations, calculations, settings, onSaved, onDeleted, onSettingsSaved }) {
  const age = ageFrom(patient.birth_date);
  const today = todayISO();
  const adjustDefaults = { ...DEFAULT_ADJUST, ...(settings?.adjust_defaults || {}) };
  const macroDefaults = { ...DEFAULT_MACROS, ...(settings?.macro_defaults || {}) };

  const w = latestOf(measurements, 'peso');
  const h = latestOf(measurements, 'altura');
  const lm = measurements
    .filter((m) => m.metric === 'massa_magra' && m.source === 'consulta' && daysBetween(m.date, today) <= 60)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const activityFrom = [...consultations].sort((a, b) => b.date.localeCompare(a.date)).find((c) => c.anamnesis?.atividade_fisica?.trim());
  const lastObjective = [...consultations].sort((a, b) => b.date.localeCompare(a.date)).find((c) => c.objective)?.objective || null;
  const lastCalc = calculations[0];

  const [sex, setSex] = useState(patient.sex || '');
  const [weight, setWeight] = useState(w ? String(w.value).replace('.', ',') : '');
  const [height, setHeight] = useState(h ? String(h.value).replace('.', ',') : '');
  const [lean, setLean] = useState(lm ? String(lm.value).replace('.', ',') : '');
  const [level, setLevel] = useState(lastCalc?.activity_level || null);
  const [objective, setObjective] = useState(lastObjective || lastCalc?.objective || null);
  const [adjust, setAdjust] = useState(String(adjustDefaults[lastObjective || lastCalc?.objective] ?? 0));
  const [chosen, setChosen] = useState(null); // fórmula escolhida manualmente
  const initialObjective = lastObjective || lastCalc?.objective;
  const [refWeight, setRefWeight] = useState(null); // null = usar o sugerido pelo IMC
  const [proteinGkg, setProteinGkg] = useState(String(macroDefaults[initialObjective]?.protein_gkg ?? 1.6).replace('.', ','));
  const [fatPct, setFatPct] = useState(String(macroDefaults[initialObjective]?.fat_pct ?? 30));
  const [copied, setCopied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedMsg, setSavedMsg] = useState('');

  const input = { sex: sex || null, age, weight: num(weight), height: num(height), leanMass: num(lean) };
  const bmiValue = bmi(input.weight, input.height);
  const results = useMemo(() => allFormulas(input), [sex, age, weight, height, lean]);
  const rec = recommend({ leanMass: input.leanMass, activityKey: level, bmiValue });
  const formula = chosen && results[chosen] != null ? chosen : rec.key;
  const tmb = results[formula];
  const factor = level ? ACTIVITY[level].factor : null;
  const adjustPct = Number(String(adjust).replace(',', '.')) || 0;
  const plan = energyPlan({ tmb, factor, adjustPct });
  const bmiClass = bmiValue ? classifyBMI(bmiValue, age) : '';
  const suggestedRef = referenceWeight(input.weight, input.height, bmiClass);
  const ref = refWeight != null ? num(refWeight) : suggestedRef?.value ?? null;
  const pGkg = num(proteinGkg);
  const fPct = num(fatPct);
  const macros = plan ? macroPlan({ target: plan.target, refWeight: ref, proteinGkg: pGkg, fatPct: fPct }) : null;
  const macroAlerts = macroWarnings(macros, objective);
  const missing = [!sex && 'sexo', age == null && 'data de nascimento', !input.weight && 'peso', !input.height && 'altura'].filter(Boolean);

  function pickObjective(k) {
    setObjective(k);
    setAdjust(String(adjustDefaults[k] ?? 0));
    setProteinGkg(String(macroDefaults[k]?.protein_gkg ?? 1.6).replace('.', ','));
    setFatPct(String(macroDefaults[k]?.fat_pct ?? 30));
  }

  async function saveMacroDefaults() {
    if (!objective || pGkg == null || fPct == null) return;
    const value = { ...macroDefaults, [objective]: { protein_gkg: pGkg, fat_pct: fPct } };
    await run(supabase.from('app_settings').upsert({ key: 'macro_defaults', value }));
    onSettingsSaved({ ...settings, macro_defaults: value });
    alert(`Padrão de macros de "${OBJECTIVE_LABEL[objective]}" salvo: proteína ${String(pGkg).replace('.', ',')} g/kg · lipídios ${fPct}%`);
  }

  async function copyActivity() {
    const text = activityPrompt(activityFrom.anamnesis.atividade_fisica, [SEX_LABEL[sex], age != null && `${age} anos`].filter(Boolean).join(', '));
    setCopied((await copyText(text)) ? 'ok' : text);
  }

  async function save() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const [row] = await run(supabase.from('calculations').insert({
        patient_id: patient.id,
        date: today,
        inputs: { sex, age, weight: input.weight, height: input.height, lean_mass: input.leanMass, bmi: bmiValue && Math.round(bmiValue * 10) / 10, activity_text_date: activityFrom?.date || null },
        formula,
        tmb,
        activity_level: level,
        activity_factor: factor,
        get_kcal: plan.get,
        objective,
        adjust_pct: adjustPct,
        target_kcal: plan.target,
        macros: macros && {
          ref_weight: ref,
          ref_kind: refWeight != null ? 'manual' : suggestedRef?.kind,
          protein_gkg: pGkg,
          fat_pct: fPct,
          protein_g: Math.round(macros.protein.g),
          fat_g: Math.round(macros.fat.g),
          carb_g: Math.round(macros.carb.g),
          carb_pct: Math.round(macros.carb.pct),
        },
      }).select('*'));
      onSaved(row);
      setSavedMsg(`Cálculo salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  async function saveDefaults() {
    if (!objective) return;
    const value = { ...adjustDefaults, [objective]: adjustPct };
    await run(supabase.from('app_settings').upsert({ key: 'adjust_defaults', value }));
    onSettingsSaved({ ...settings, adjust_defaults: value });
    alert(`Padrão de "${OBJECTIVE_LABEL[objective]}" salvo: ${adjustPct > 0 ? '+' : ''}${adjustPct}%`);
  }

  async function remove(id) {
    if (!confirm('Apagar este cálculo do histórico?')) return;
    await run(supabase.from('calculations').delete().eq('id', id));
    onDeleted(id);
  }

  return html`
    <section class="card">
      <h2 class="card-title">🧮 Motor de cálculos</h2>
      <${ErrorBox} error=${error} />

      <div class="calc-grid">
        <div>
          <div class="calc-step">1. Dados do paciente</div>
          <div class="calc-inputs">
            <label class="field"><span class="field-label">Sexo</span>
              <select value=${sex} onChange=${(e) => setSex(e.target.value)}>
                <option value="">Escolha…</option><option value="F">Feminino</option><option value="M">Masculino</option>
              </select>
            </label>
            <label class="field"><span class="field-label">Idade</span><input value=${age ?? ''} disabled /></label>
            <label class="field"><span class="field-label">Peso (kg)</span><input inputmode="decimal" value=${weight} onInput=${(e) => setWeight(e.target.value)} /></label>
            <label class="field"><span class="field-label">Altura (cm)</span><input inputmode="decimal" value=${height} onInput=${(e) => setHeight(e.target.value)} /></label>
            <label class="field"><span class="field-label">Massa magra (kg)</span><input inputmode="decimal" value=${lean} placeholder="opcional" onInput=${(e) => setLean(e.target.value)} /></label>
          </div>
          <p class="muted small">
            ${w ? `Peso de ${fmtDate(w.date)}` : 'Sem peso registrado'} · ${h ? `altura de ${fmtDate(h.date)}` : 'sem altura registrada'}
            ${lm ? ` · massa magra de ${fmtDate(lm.date)}` : ' · massa magra: só entra se registrada por você nos últimos 60 dias'}.
            Você pode ajustar os valores para este cálculo.
          </p>
          ${bmiValue && html`<p><strong>IMC ${fmtNum(bmiValue, 1)}</strong> · ${classifyBMI(bmiValue, age)}${age >= 60 ? ' (critério para idosos)' : ''}</p>`}
          ${missing.length > 0 && html`<div class="alert">Faltam: <strong>${missing.join(', ')}</strong>. ${!sex ? 'Escolha o sexo acima (ou no cadastro).' : ''}</div>`}

          <div class="calc-step">2. Fator de atividade</div>
          ${activityFrom
            ? html`<div class="quote"><div class="muted small">Relato de ${fmtDate(activityFrom.date)}:</div>${activityFrom.anamnesis.atividade_fisica}</div>
                <button class="btn btn-sm" onClick=${copyActivity}>${copied === 'ok' ? '✓ Copiado! Cole na sua IA' : '📋 Copiar pedido de sugestão para a IA'}</button>
                ${copied && copied !== 'ok' && html`<textarea rows="5" readonly value=${copied} onFocus=${(e) => e.target.select()}></textarea>`}`
            : html`<p class="muted small">Nenhum relato de atividade física nas anamneses. Escolha o nível abaixo.</p>`}
          <div class="chips" style="margin-top:10px">
            ${ACTIVITY_LEVELS.map((a) => html`
              <button type="button" class=${'chip' + (level === a.key ? ' on' : '')} title=${a.hint} onClick=${() => setLevel(a.key)}>
                ${a.label} · ${String(a.factor).replace('.', ',')}
              </button>`)}
          </div>

          <div class="calc-step">3. Objetivo</div>
          <div class="chips">
            ${OBJECTIVES.map(([k, l]) => html`<button type="button" class=${'chip' + (objective === k ? ' on' : '')} onClick=${() => pickObjective(k)}>${l}</button>`)}
          </div>
          <div class="adjust-row">
            <label>Ajuste sobre o GET
              <input inputmode="decimal" value=${adjust} onInput=${(e) => setAdjust(e.target.value)} /> %
            </label>
            ${objective && adjustPct !== adjustDefaults[objective] && html`<button class="btn btn-sm btn-ghost" onClick=${saveDefaults}>Salvar ${adjustPct}% como padrão de “${OBJECTIVE_LABEL[objective]}”</button>`}
          </div>
          <p class="muted small">Padrões: ${OBJECTIVES.map(([k, l]) => `${l} ${adjustDefaults[k] > 0 ? '+' : ''}${adjustDefaults[k]}%`).join(' · ')}</p>
        </div>

        <div>
          <div class="calc-step">4. Fórmula da TMB</div>
          <table class="table formulas">
            <tbody>
              ${Object.entries(FORMULAS).map(([k, f]) => html`
                <tr class=${formula === k ? 'selected' : ''} onClick=${() => results[k] != null && setChosen(k)}>
                  <td><input type="radio" checked=${formula === k} disabled=${results[k] == null} /></td>
                  <td>
                    <strong>${f.label}</strong> ${rec.key === k && html`<span class="badge badge-green">recomendada</span>`}
                    <div class="muted small">${f.equation}</div>
                    ${k === 'harris_ajustado' && input.height && input.weight && html`<div class="muted small">Peso ideal ${fmtNum(idealWeight(input.height))} kg · peso ajustado ${fmtNum(adjustedWeight(input.weight, input.height))} kg</div>`}
                  </td>
                  <td class="num">${results[k] == null ? html`<span class="muted small">${k === 'katch' ? 'precisa de massa magra' : 'faltam dados'}</span>` : kcal(results[k])}</td>
                </tr>`)}
            </tbody>
          </table>
          <p class="muted small">💡 ${rec.reason}</p>

          <div class="calc-step">5. Resultado</div>
          ${!plan && html`<p class="muted">${!tmb ? 'Complete os dados do paciente.' : 'Escolha o fator de atividade.'}</p>`}
          ${plan && html`
            <div class="stats">
              <div class="stat"><div class="stat-label">TMB (${FORMULAS[formula].label})</div><div class="stat-value">${kcal(tmb)}</div></div>
              <div class="stat"><div class="stat-label">GET (× ${String(factor).replace('.', ',')})</div><div class="stat-value">${kcal(plan.get)}</div></div>
              <div class="stat stat-main"><div class="stat-label">Meta${objective ? ' · ' + OBJECTIVE_LABEL[objective] : ''} (${adjustPct > 0 ? '+' : ''}${adjustPct}%)</div><div class="stat-value">${kcal(plan.target)}</div></div>
            </div>
            ${plan.belowTmb && html`<div class="alert alert-error">⚠️ A meta ficou abaixo da TMB (${kcal(tmb)}). Revise o ajuste.</div>`}

            <div class="calc-step">6. Macronutrientes</div>
            <div class="macro-inputs">
              <label class="field"><span class="field-label">Peso de referência (kg)</span>
                <input inputmode="decimal" value=${refWeight ?? (suggestedRef ? String(suggestedRef.value).replace('.', ',') : '')} onInput=${(e) => setRefWeight(e.target.value)} />
              </label>
              <label class="field"><span class="field-label">Proteína (g/kg)</span>
                <input inputmode="decimal" value=${proteinGkg} onInput=${(e) => setProteinGkg(e.target.value)} />
              </label>
              <label class="field"><span class="field-label">Lipídios (% do VET)</span>
                <input inputmode="decimal" value=${fatPct} onInput=${(e) => setFatPct(e.target.value)} />
              </label>
            </div>
            <p class="muted small">
              ${suggestedRef && html`Sugerido pelo IMC: <strong>${suggestedRef.reason}</strong> (${fmtNum(suggestedRef.value)} kg). `}
              ${input.weight && input.height && html`
                <button class="link-btn" onClick=${() => setRefWeight(String(input.weight).replace('.', ','))}>usar peso atual (${fmtNum(input.weight)})</button> ·
                <button class="link-btn" onClick=${() => setRefWeight(String(Math.round(adjustedWeight(input.weight, input.height) * 10) / 10).replace('.', ','))}>usar peso ajustado (${fmtNum(adjustedWeight(input.weight, input.height))})</button>
                ${refWeight != null && html` · <button class="link-btn" onClick=${() => setRefWeight(null)}>voltar ao sugerido</button>`}`}
            </p>
            ${macros && html`
              <table class="table macros">
                <thead><tr><th></th><th>g</th><th>g/kg</th><th>kcal</th><th>% VET</th></tr></thead>
                <tbody>
                  ${[['Proteínas', macros.protein], ['Lipídios', macros.fat], ['Carboidratos', macros.carb]].map(([l, m]) => html`
                    <tr><td><strong>${l}</strong></td><td>${fmtNum(m.g, 0)} g</td><td>${fmtNum(m.gkg, 1)}</td><td>${fmtNum(m.kcal, 0)}</td><td>${fmtNum(m.pct, 0)}%</td></tr>`)}
                </tbody>
              </table>`}
            ${macroAlerts.map((t) => html`<div class="alert">⚠️ ${t}</div>`)}
            <p class="muted small">
              Faixas: proteína ${objective ? (PROTEIN_RANGE[objective] || []).map((v) => String(v).replace('.', ',')).join('–') : '1,2–2,2'} g/kg ·
              lipídios 20–35% do VET (0,8–1,2 g/kg) · carboidratos o restante (geralmente 40–60%).
            </p>
            ${objective && (pGkg !== macroDefaults[objective]?.protein_gkg || fPct !== macroDefaults[objective]?.fat_pct) && pGkg != null && fPct != null && html`
              <button class="btn btn-sm btn-ghost" onClick=${saveMacroDefaults}>Salvar proteína ${String(pGkg).replace('.', ',')} g/kg e lipídios ${fPct}% como padrão de “${OBJECTIVE_LABEL[objective]}”</button>`}

            <div class="actions" style="justify-content:flex-start">
              <button class="btn btn-primary" onClick=${save} disabled=${busy}>💾 Salvar cálculo no histórico</button>
              ${savedMsg && html`<span class="muted small">✓ ${savedMsg}</span>`}
            </div>`}
        </div>
      </div>

      ${calculations.length > 0 && html`
        <div class="calc-step" style="margin-top:18px">Histórico de cálculos</div>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Data</th><th>Peso</th><th>Fórmula</th><th>TMB</th><th>Fator</th><th>GET</th><th>Objetivo</th><th>Meta</th><th>P / L / C</th><th></th></tr></thead>
            <tbody>
              ${calculations.map((c) => html`
                <tr>
                  <td>${fmtDate(c.date)}</td>
                  <td>${c.inputs?.weight ? fmtNum(c.inputs.weight) + ' kg' : '–'}</td>
                  <td>${FORMULAS[c.formula]?.label || c.formula}</td>
                  <td>${kcal(c.tmb)}</td>
                  <td>${String(c.activity_factor).replace('.', ',')}</td>
                  <td>${kcal(c.get_kcal)}</td>
                  <td>${c.objective ? OBJECTIVE_LABEL[c.objective] : '–'} (${c.adjust_pct > 0 ? '+' : ''}${c.adjust_pct}%)</td>
                  <td><strong>${kcal(c.target_kcal)}</strong></td>
                  <td class="small">${c.macros ? `${c.macros.protein_g} / ${c.macros.fat_g} / ${c.macros.carb_g} g` : '–'}${c.macros?.ref_weight ? html`<div class="muted">ref. ${fmtNum(c.macros.ref_weight)} kg</div>` : ''}</td>
                  <td><button class="btn btn-sm btn-danger-ghost" onClick=${() => remove(c.id)}>Apagar</button></td>
                </tr>`)}
            </tbody>
          </table>
        </div>`}
    </section>`;
}
