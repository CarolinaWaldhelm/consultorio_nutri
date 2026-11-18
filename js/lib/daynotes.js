// Texto consolidado de um dia de atendimento, para colar no Nutrium.
// (Fica no computador da nutricionista: não vai para IA nenhuma, por isso pode ter o nome do paciente.)
import { fmtDate, OBJECTIVE_LABEL, SOURCE_RANK } from './util.js';
import { METRIC, METRICS } from './metrics.js';
import { FORMULAS, ACTIVITY } from './energy.js';
import { FIELDS, TYPE_LABEL } from '../views/anamnesis.js';

const n = (v, d = 1) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d });
const kcal = (v) => `${Math.round(Number(v)).toLocaleString('pt-BR')} kcal`;

/** Datas que têm alguma anotação (consulta, medida registrada na consulta ou cálculo), da mais recente. */
export function datesWithNotes({ consultations, measurements, calculations }) {
  return [...new Set([
    ...consultations.map((c) => c.date),
    ...measurements.filter((m) => m.source === 'consulta').map((m) => m.date),
    ...calculations.map((c) => c.date),
  ])].sort().reverse();
}

export function dayNotesText({ patient, consultations, measurements, calculations }, date) {
  const out = [];
  const consult = consultations.find((c) => c.date === date);
  out.push(`${patient.name} — ${consult ? TYPE_LABEL[consult.type] : 'Anotações'} de ${fmtDate(date)}`);

  if (consult) {
    if (consult.objective) out.push(`Objetivo: ${OBJECTIVE_LABEL[consult.objective]}`);
    for (const [k, label] of FIELDS[consult.type]) {
      if (k === '@objetivo') continue;
      const v = consult.anamnesis?.[k]?.trim();
      if (v) out.push('', `${label.toUpperCase()}`, v);
    }
  }

  // Medidas do dia, com a comparação com o registro anterior de cada uma.
  const today = measurements.filter((m) => m.date === date && m.source === 'consulta');
  if (today.length) {
    out.push('', 'MEDIDAS');
    for (const def of METRICS) {
      const m = today.find((x) => x.metric === def.key);
      if (!m) continue;
      const prev = measurements
        .filter((x) => x.metric === def.key && x.date < date)
        .sort((a, b) => b.date.localeCompare(a.date) || SOURCE_RANK[b.source] - SOURCE_RANK[a.source])[0];
      const unit = def.unit === 'nível' ? '' : ' ' + def.unit;
      let line = `${def.label}: ${n(m.value)}${unit}`;
      if (prev) {
        const diff = Number(m.value) - Number(prev.value);
        line += ` (anterior ${n(prev.value)}${unit} em ${fmtDate(prev.date)}; ${diff > 0 ? '+' : ''}${n(diff)}${unit})`;
      }
      out.push(line);
    }
  }

  // Cálculo do dia (o último salvo, se houver mais de um).
  const calc = calculations.filter((c) => c.date === date).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (calc) {
    out.push('', 'CÁLCULO ENERGÉTICO');
    const inp = calc.inputs || {};
    const data = [inp.weight && `peso ${n(inp.weight)} kg`, inp.height && `altura ${n(inp.height)} cm`, inp.bmi && `IMC ${n(inp.bmi)}`, inp.lean_mass && `massa magra ${n(inp.lean_mass)} kg`].filter(Boolean);
    if (data.length) out.push(`Dados: ${data.join(', ')}`);
    out.push(`TMB: ${kcal(calc.tmb)} (${FORMULAS[calc.formula]?.label || calc.formula})`);
    out.push(`Fator de atividade: ${String(calc.activity_factor).replace('.', ',')} (${ACTIVITY[calc.activity_level]?.label || calc.activity_level})`);
    out.push(`GET: ${kcal(calc.get_kcal)}`);
    out.push(`Meta: ${kcal(calc.target_kcal)}${calc.objective ? ` — ${OBJECTIVE_LABEL[calc.objective]}` : ''} (${calc.adjust_pct > 0 ? '+' : ''}${calc.adjust_pct}%)`);
    const m = calc.macros;
    if (m) {
      const fatKcal = m.fat_g * 9;
      const carbPct = m.carb_pct ?? Math.round(((m.carb_g * 4) / calc.target_kcal) * 100);
      const protPct = Math.round(((m.protein_g * 4) / calc.target_kcal) * 100);
      out.push(`Macros (peso de referência ${n(m.ref_weight)} kg): Proteínas ${m.protein_g} g (${n(m.protein_gkg)} g/kg · ${protPct}%) · Lipídios ${m.fat_g} g (${m.fat_pct}% · ${Math.round(fatKcal)} kcal) · Carboidratos ${m.carb_g} g (${carbPct}%)`);
    }
  }

  if (out.length === 1) out.push('', '(Sem anotações nesta data.)');
  return out.join('\n');
}

export { METRIC };
