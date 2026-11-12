// Lista fixa de medidas e leitura de texto livre ("peso 54,2 cintura 71 gordura 22%").
import { norm } from './util.js';

export const METRICS = [
  { key: 'peso', label: 'Peso', unit: 'kg', group: 'Básicas', aliases: ['peso', 'massa corporal', 'weight'] },
  { key: 'altura', label: 'Altura', unit: 'cm', group: 'Básicas', aliases: ['altura', 'estatura', 'height'] },
  { key: 'cintura', label: 'Cintura', unit: 'cm', group: 'Circunferências', aliases: ['perimetro da cintura', 'circunferencia da cintura', 'cintura', 'waist'] },
  { key: 'quadril', label: 'Quadril', unit: 'cm', group: 'Circunferências', aliases: ['perimetro do quadril', 'circunferencia do quadril', 'quadril', 'hip'] },
  { key: 'abdomen', label: 'Abdômen', unit: 'cm', group: 'Circunferências', aliases: ['perimetro abdominal', 'circunferencia abdominal', 'abdominal', 'abdomen'] },
  { key: 'braco', label: 'Braço', unit: 'cm', group: 'Circunferências', aliases: ['perimetro do braco', 'circunferencia do braco', 'braco'] },
  { key: 'coxa', label: 'Coxa', unit: 'cm', group: 'Circunferências', aliases: ['perimetro da coxa', 'circunferencia da coxa', 'coxa'] },
  { key: 'gordura_pct', label: '% Gordura', unit: '%', group: 'Bioimpedância', aliases: ['percentual de gordura', 'porcentagem de gordura', 'porcentagem de massa gorda', '% de gordura', '% gordura', 'gordura %', 'gordura corporal', 'pgc', 'body fat %', 'body fat', 'gordura'] },
  { key: 'massa_gorda', label: 'Massa gorda', unit: 'kg', group: 'Bioimpedância', aliases: ['massa de gordura', 'massa gorda', 'body fat mass'] },
  { key: 'massa_magra', label: 'Massa magra', unit: 'kg', group: 'Bioimpedância', aliases: ['massa livre de gordura', 'massa magra', 'fat free mass', 'lean mass', 'mlg'] },
  { key: 'massa_muscular', label: 'Massa muscular esquelética', unit: 'kg', group: 'Bioimpedância', aliases: ['massa muscular esqueletica', 'musculo esqueletico', 'skeletal muscle mass', 'massa muscular', 'mme', 'smm'] },
  { key: 'agua_pct', label: 'Água corporal', unit: '%', group: 'Bioimpedância', aliases: ['agua corporal total', 'agua corporal', 'agua', 'tbw'] },
  { key: 'gordura_visceral', label: 'Gordura visceral', unit: 'nível', group: 'Bioimpedância', aliases: ['nivel de gordura visceral', 'gordura visceral', 'visceral'] },
  { key: 'tmb_aparelho', label: 'TMB do aparelho', unit: 'kcal', group: 'Bioimpedância', aliases: ['taxa metabolica basal', 'tmb do aparelho', 'tmb', 'bmr'] },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIASES = METRICS.flatMap((m) => m.aliases.map((a) => ({ alias: norm(a), key: m.key })))
  .sort((a, b) => b.alias.length - a.alias.length);

/**
 * Lê texto livre e devolve { date, values: {metric: number}, leftovers: [trechos não reconhecidos] }.
 * Aceita "peso 54,2", "Peso: 54.2 kg", "gordura 22%", "altura 1,62" (vira 162 cm), "Data: 12/11/2026".
 */
export function parseMeasurementsText(text) {
  let s = norm(text).replace(/\*/g, ' ');
  const values = {};
  let date = null;

  const dm = s.match(/data(?: do exame)?\s*[:=-]?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dm) {
    const y = dm[3].length === 2 ? '20' + dm[3] : dm[3];
    date = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    s = s.replace(dm[0], ' ');
  }

  for (const { alias, key } of ALIASES) {
    const re = new RegExp(`(^|[^a-z%])${escape(alias)}(?![a-z])[^0-9\\n]{0,25}?(\\d+(?:[.,]\\d+)?)\\s*(kg|cm|%|kcal|m|l)?`, 'g');
    s = s.replace(re, (whole, pre, num, unit) => {
      let k = key;
      let v = Number(num.replace(',', '.'));
      // "gordura 12 kg" é massa gorda; "gordura 22%" é percentual.
      if (k === 'gordura_pct' && unit === 'kg') k = 'massa_gorda';
      if (k === 'agua_pct' && (unit === 'l' || unit === 'kg')) return whole; // água em litros: fica como sobra
      if (k === 'altura' && v < 3) v = Math.round(v * 100);
      if (values[k] == null && Number.isFinite(v)) values[k] = v;
      return pre + ' '.repeat(whole.length - pre.length);
    });
  }

  const leftovers = s.split(/[\n;]+/).map((x) => x.replace(/[\s,.:=-]+/g, ' ').trim()).filter((x) => /\d/.test(x));
  return { date, values, leftovers };
}

/** Pedido para a IA ler a foto/print do laudo de bioimpedância. */
export function bioimpedancePrompt() {
  const lines = METRICS.map((m) => `${m.label}: <valor em ${m.unit}>`).join('\n');
  return `Leia a imagem anexada (laudo ou print de bioimpedância / avaliação corporal).
Responda SOMENTE com as linhas abaixo, uma por linha, usando exatamente estes nomes e as unidades indicadas.
Coloque apenas as medidas que aparecem na imagem; não invente nem calcule valores que não estão lá.
Se houver a data do exame, inclua a linha "Data: DD/MM/AAAA".

Data: DD/MM/AAAA
${lines}`;
}
