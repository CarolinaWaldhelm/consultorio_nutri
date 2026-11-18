// Exames laboratoriais: lista de biomarcadores com unidade padrão, leitura do texto da IA e conversões.
import { norm } from './util.js';

// conv: unidade de origem (normalizada) → multiplicador para chegar na unidade padrão.
export const MARKERS = [
  { key: 'glicemia', label: 'Glicemia de jejum', unit: 'mg/dL', aliases: ['glicemia de jejum', 'glicose de jejum', 'glicemia', 'glicose'], conv: { 'mmol/l': 18.016 } },
  { key: 'hba1c', label: 'Hemoglobina glicada (HbA1c)', unit: '%', aliases: ['hemoglobina glicada', 'hba1c', 'a1c', 'glicohemoglobina'] },
  { key: 'insulina', label: 'Insulina de jejum', unit: 'µUI/mL', aliases: ['insulina de jejum', 'insulina'] },
  { key: 'homa_ir', label: 'HOMA-IR', unit: '', aliases: ['homa-ir', 'homa ir', 'homa'] },
  { key: 'colesterol_total', label: 'Colesterol total', unit: 'mg/dL', aliases: ['colesterol total', 'colesterol'], conv: { 'mmol/l': 38.67 } },
  { key: 'hdl', label: 'HDL', unit: 'mg/dL', aliases: ['hdl colesterol', 'colesterol hdl', 'hdl-c', 'hdl'], conv: { 'mmol/l': 38.67 } },
  { key: 'ldl', label: 'LDL', unit: 'mg/dL', aliases: ['ldl colesterol', 'colesterol ldl', 'ldl-c', 'ldl'], conv: { 'mmol/l': 38.67 } },
  { key: 'nao_hdl', label: 'Colesterol não-HDL', unit: 'mg/dL', aliases: ['colesterol nao hdl', 'nao hdl', 'nao-hdl'], conv: { 'mmol/l': 38.67 } },
  { key: 'triglicerideos', label: 'Triglicerídeos', unit: 'mg/dL', aliases: ['triglicerideos', 'triglicerides', 'triglicerídios', 'tg'], conv: { 'mmol/l': 88.57 } },
  { key: 'tgo', label: 'TGO (AST)', unit: 'U/L', aliases: ['tgo', 'ast', 'aspartato aminotransferase'] },
  { key: 'tgp', label: 'TGP (ALT)', unit: 'U/L', aliases: ['tgp', 'alt', 'alanina aminotransferase'] },
  { key: 'ggt', label: 'Gama GT', unit: 'U/L', aliases: ['gama gt', 'gamaglutamiltransferase', 'ggt'] },
  { key: 'creatinina', label: 'Creatinina', unit: 'mg/dL', aliases: ['creatinina'] },
  { key: 'ureia', label: 'Ureia', unit: 'mg/dL', aliases: ['ureia'] },
  { key: 'acido_urico', label: 'Ácido úrico', unit: 'mg/dL', aliases: ['acido urico'] },
  { key: 'tsh', label: 'TSH', unit: 'µUI/mL', aliases: ['tsh'] },
  { key: 't4_livre', label: 'T4 livre', unit: 'ng/dL', aliases: ['t4 livre', 't4l'] },
  { key: 'hemoglobina', label: 'Hemoglobina', unit: 'g/dL', aliases: ['hemoglobina'] },
  { key: 'hematocrito', label: 'Hematócrito', unit: '%', aliases: ['hematocrito'] },
  { key: 'ferritina', label: 'Ferritina', unit: 'ng/mL', aliases: ['ferritina'] },
  { key: 'ferro', label: 'Ferro sérico', unit: 'µg/dL', aliases: ['ferro serico', 'ferro'] },
  { key: 'vitamina_d', label: 'Vitamina D (25-OH)', unit: 'ng/mL', aliases: ['25-hidroxivitamina d', '25 oh vitamina d', 'vitamina d', '25-oh d', 'vit d'], conv: { 'nmol/l': 1 / 2.496 } },
  { key: 'vitamina_b12', label: 'Vitamina B12', unit: 'pg/mL', aliases: ['vitamina b12', 'b12', 'cobalamina'] },
  { key: 'acido_folico', label: 'Ácido fólico', unit: 'ng/mL', aliases: ['acido folico', 'folato'] },
  { key: 'pcr', label: 'Proteína C reativa', unit: 'mg/L', aliases: ['proteina c reativa ultrassensivel', 'proteina c reativa', 'pcr-us', 'pcr us', 'pcr'], conv: { 'mg/dl': 10 } },
  { key: 'sodio', label: 'Sódio', unit: 'mEq/L', aliases: ['sodio'] },
  { key: 'potassio', label: 'Potássio', unit: 'mEq/L', aliases: ['potassio'] },
  { key: 'calcio', label: 'Cálcio', unit: 'mg/dL', aliases: ['calcio total', 'calcio'] },
  { key: 'magnesio', label: 'Magnésio', unit: 'mg/dL', aliases: ['magnesio'] },
  { key: 'zinco', label: 'Zinco', unit: 'µg/dL', aliases: ['zinco'] },
];
export const MARKER = Object.fromEntries(MARKERS.map((m) => [m.key, m]));

const ALIASES = MARKERS.flatMap((m) => m.aliases.map((a) => ({ alias: norm(a), m }))).sort((a, b) => b.alias.length - a.alias.length);
const normUnit = (u) => norm(u).replace(/\s+/g, '').replace('μ', 'µ');

/** Encontra o biomarcador da lista pelo nome (ou null). */
export function findMarker(name) {
  const n = norm(name).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const hit = ALIASES.find(({ alias }) => n === alias || n.startsWith(alias + ' ') || n.endsWith(' ' + alias));
  return hit?.m || null;
}

export function keyForLabel(label) {
  return findMarker(label)?.key || 'outro_' + norm(label).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Lê linhas "Nome: valor unidade" (e "Data: DD/MM/AAAA").
 * Devolve { date, rows: [{key, label, value, unit, note}] }, já na unidade padrão quando houver conversão conhecida.
 */
export function parseLabText(text) {
  let date = null;
  const rows = [];
  for (const raw of String(text || '').split(/\n+/)) {
    const line = raw.replace(/\*\*/g, '').replace(/^[-•\s]+/, '').trim();
    if (!line) continue;
    const dm = line.match(/^data(?: do exame| da coleta)?\s*[:=-]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
    if (dm) {
      const y = dm[3].length === 2 ? '20' + dm[3] : dm[3];
      date = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      continue;
    }
    const m = line.match(/^(.+?)\s*[:=]\s*([<>]?\s*-?\d+(?:[.,]\d+)?)\s*([^\s(;]*)/);
    if (!m) continue;
    const label = m[1].trim();
    let value = Number(m[2].replace(/[<>\s]/g, '').replace(',', '.'));
    let unit = m[3].trim();
    if (!Number.isFinite(value)) continue;
    const def = findMarker(label);
    let note = '';
    if (def) {
      const f = def.conv?.[normUnit(unit)];
      if (f) { note = `convertido de ${unit}`; value = Math.round(value * f * 100) / 100; unit = def.unit; }
      else if (!unit) unit = def.unit;
    }
    rows.push({ key: def ? def.key : keyForLabel(label), label: def ? def.label : label, value, unit, note });
  }
  return { date, rows };
}

/** Pedido para a IA ler o laudo (PDF ou foto). */
export function labPrompt() {
  const list = MARKERS.map((m) => `${m.label}: <valor>${m.unit ? ' ' + m.unit : ''}`).join('\n');
  return `Leia o laudo de exames laboratoriais anexado (PDF ou foto).
Responda SOMENTE com linhas no formato "Nome: valor unidade", uma por exame, sem comentários.
Use exatamente os nomes e as unidades abaixo quando o exame aparecer no laudo (converta a unidade se o laudo usar outra).
Para exames que não estão na lista, use o nome que aparece no laudo e a unidade do laudo.
Não invente valores e não inclua os valores de referência.
Comece com a data da coleta, se houver: "Data: DD/MM/AAAA".

Data: DD/MM/AAAA
${list}`;
}
