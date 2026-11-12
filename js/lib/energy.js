// Motor de cálculos: fórmulas de TMB, fator de atividade e meta calórica. Tudo em código, nada por IA.

export const ACTIVITY_LEVELS = [
  { key: 'sedentario', label: 'Sedentário', factor: 1.2, hint: 'Pouco ou nenhum exercício' },
  { key: 'leve', label: 'Levemente ativo', factor: 1.375, hint: 'Exercício leve 1–3x/semana' },
  { key: 'moderado', label: 'Moderadamente ativo', factor: 1.55, hint: 'Exercício moderado 3–5x/semana' },
  { key: 'muito', label: 'Muito ativo', factor: 1.725, hint: 'Exercício intenso 6–7x/semana' },
  { key: 'extremo', label: 'Extremamente ativo', factor: 1.9, hint: 'Treino muito intenso ou trabalho físico pesado' },
];
export const ACTIVITY = Object.fromEntries(ACTIVITY_LEVELS.map((a) => [a.key, a]));

/** Ajuste padrão sobre o GET para cada objetivo (editável nas configurações e em cada cálculo). */
export const DEFAULT_ADJUST = { perda_peso: -20, recomposicao: -10, manutencao: 0, ganho_massa: 10 };

export const FORMULAS = {
  mifflin: {
    label: 'Mifflin-St Jeor',
    equation: 'H: 10·P + 6,25·A − 5·I + 5 · M: 10·P + 6,25·A − 5·I − 161',
    needs: ['sex', 'weight', 'height', 'age'],
    calc: ({ sex, weight, height, age }) => 10 * weight + 6.25 * height - 5 * age + (sex === 'M' ? 5 : -161),
  },
  harris: {
    label: 'Harris-Benedict revisada',
    equation: 'H: 88,362 + 13,397·P + 4,799·A − 5,677·I · M: 447,593 + 9,247·P + 3,098·A − 4,330·I',
    needs: ['sex', 'weight', 'height', 'age'],
    calc: ({ sex, weight, height, age }) => (sex === 'M'
      ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
      : 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age),
  },
  harris_ajustado: {
    label: 'Harris-Benedict com peso ajustado',
    equation: 'Harris-Benedict com P = peso ideal + 0,25 × (peso atual − peso ideal); peso ideal = IMC 22 × altura²',
    needs: ['sex', 'weight', 'height', 'age'],
    calc: (x) => FORMULAS.harris.calc({ ...x, weight: adjustedWeight(x.weight, x.height) }),
  },
  katch: {
    label: 'Katch-McArdle',
    equation: '370 + 21,6 × massa magra (kg)',
    needs: ['leanMass'],
    calc: ({ leanMass }) => 370 + 21.6 * leanMass,
  },
};

export const idealWeight = (heightCm) => 22 * (heightCm / 100) ** 2;
export const adjustedWeight = (weight, heightCm) => {
  const ideal = idealWeight(heightCm);
  return ideal + 0.25 * (weight - ideal);
};

export function bmi(weight, heightCm) {
  return weight && heightCm ? weight / (heightCm / 100) ** 2 : null;
}

/** Calcula todas as fórmulas possíveis com os dados disponíveis. */
export function allFormulas(input) {
  const out = {};
  for (const [key, f] of Object.entries(FORMULAS)) {
    const ok = f.needs.every((n) => input[n] != null && input[n] !== '' && !(typeof input[n] === 'number' && !Number.isFinite(input[n])));
    out[key] = ok ? Math.round(f.calc(input)) : null;
  }
  return out;
}

/** Fórmula recomendada e o motivo (regra da especificação §3.6). */
export function recommend({ leanMass, activityKey, bmiValue }) {
  const veryActive = activityKey === 'muito' || activityKey === 'extremo';
  if (leanMass && veryActive) {
    return {
      key: 'katch',
      reason: 'Há massa magra recente e o paciente é muito ativo: a Katch-McArdle considera a composição corporal.'
        + (bmiValue >= 30 ? ' Atenção: em obesidade, a bioimpedância pode ser menos precisa.' : ''),
    };
  }
  return {
    key: 'mifflin',
    reason: bmiValue >= 30
      ? 'Obesidade: a Mifflin-St Jeor com peso atual é a de melhor precisão em adultos não hospitalizados, inclusive com obesidade.'
      : 'É a fórmula de melhor precisão em adultos não hospitalizados.',
  };
}

export function energyPlan({ tmb, factor, adjustPct }) {
  if (!tmb || !factor) return null;
  const get = Math.round(tmb * factor);
  const target = Math.round(get * (1 + (adjustPct || 0) / 100));
  return { get, target, belowTmb: target < tmb };
}

// ---------- Peso de referência e macronutrientes ----------

/** Eutrofia/baixo peso: peso atual. Sobrepeso/obesidade: peso ajustado. */
export function referenceWeight(weight, heightCm, bmiClass) {
  if (!weight || !heightCm) return null;
  const heavy = /sobrepeso|obesidade/i.test(bmiClass || '');
  return heavy
    ? { value: Math.round(adjustedWeight(weight, heightCm) * 10) / 10, kind: 'ajustado', reason: `${bmiClass}: peso ajustado` }
    : { value: weight, kind: 'atual', reason: `${bmiClass || 'Eutrofia'}: peso atual` };
}

/** Padrão inicial por objetivo (editável nas configurações e em cada cálculo). */
export const DEFAULT_MACROS = {
  perda_peso: { protein_gkg: 2.0, fat_pct: 30 },
  ganho_massa: { protein_gkg: 2.0, fat_pct: 25 },
  recomposicao: { protein_gkg: 1.6, fat_pct: 30 },
  manutencao: { protein_gkg: 1.6, fat_pct: 30 },
};

/** Faixas de referência (só para alertas; nada é bloqueado). */
export const PROTEIN_RANGE = {
  perda_peso: [1.6, 2.2], ganho_massa: [1.6, 2.2], recomposicao: [1.6, 2.2], manutencao: [1.2, 1.6],
};
export const FAT_PCT_RANGE = [20, 35];
export const FAT_GKG_RANGE = [0.8, 1.2];
export const CARB_PCT_RANGE = [40, 60];

/** Distribuição: proteína em g/kg do peso de referência, gordura em % do VET, carboidrato completa o VET. */
export function macroPlan({ target, refWeight, proteinGkg, fatPct }) {
  if (!target || !refWeight || proteinGkg == null || fatPct == null) return null;
  const pG = proteinGkg * refWeight;
  const pK = pG * 4;
  const fK = (target * fatPct) / 100;
  const fG = fK / 9;
  const cK = target - pK - fK;
  const cG = cK / 4;
  const pct = (k) => (k / target) * 100;
  return {
    protein: { g: pG, gkg: proteinGkg, kcal: pK, pct: pct(pK) },
    fat: { g: fG, gkg: fG / refWeight, kcal: fK, pct: fatPct },
    carb: { g: cG, gkg: cG / refWeight, kcal: cK, pct: pct(cK) },
  };
}

export function macroWarnings(m, objective) {
  if (!m) return [];
  const w = [];
  const [pmin, pmax] = PROTEIN_RANGE[objective] || [1.2, 2.2];
  if (m.protein.gkg < pmin || m.protein.gkg > pmax) w.push(`Proteína fora da faixa de ${String(pmin).replace('.', ',')}–${String(pmax).replace('.', ',')} g/kg para este objetivo.`);
  if (m.fat.pct < FAT_PCT_RANGE[0] || m.fat.pct > FAT_PCT_RANGE[1]) w.push('Lipídios fora da faixa de 20–35% do VET.');
  if (m.carb.kcal < 0) w.push('Proteína + lipídios passam do VET: não sobra caloria para carboidrato.');
  else if (m.carb.pct < CARB_PCT_RANGE[0] || m.carb.pct > CARB_PCT_RANGE[1]) w.push('Carboidratos fora da faixa usual de 40–60% do VET.');
  return w;
}
