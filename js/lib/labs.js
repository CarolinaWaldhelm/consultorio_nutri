// Exames laboratoriais: lista de biomarcadores com unidade padrão, leitura do texto da IA e conversões.
import { norm } from './util.js';

// Cada exame tem uma chave, o nome padrão, a unidade padrão e os nomes alternativos (aliases).
// O nome do laudo precisa bater EXATAMENTE com um nome conhecido (sem acento, maiúsculas, parênteses ou hífens):
// assim "Glicose média estimada" nunca vira "Glicemia de jejum", "VLDL-colesterol" não vira "Colesterol total" e
// "Leucócitos (urina)" não vira o leucograma do sangue.
// conv: unidade de origem (normalizada) → multiplicador para chegar na unidade padrão.
// count: contagem (milhar com ponto: "6.500" = 6500).
export const MARKERS = [
  // Hemograma — eritrograma (série vermelha)
  { key: 'eritrocitos', label: 'Hemácias (eritrócitos)', unit: '10^6/µL', aliases: ['eritrocitos', 'hemacias', 'hemacias eritrocitos', 'contagem de eritrocitos', 'contagem de hemacias'] },
  { key: 'hemoglobina', label: 'Hemoglobina (Hb)', unit: 'g/dL', aliases: ['hemoglobina', 'hb', 'hemoglobina hb'] },
  { key: 'hematocrito', label: 'Hematócrito (Ht)', unit: '%', aliases: ['hematocrito', 'ht', 'hematocrito ht'] },
  { key: 'vcm', label: 'VCM', unit: 'fL', aliases: ['vcm', 'volume corpuscular medio', 'vcm volume corpuscular medio'] },
  { key: 'hcm', label: 'HCM', unit: 'pg', aliases: ['hcm', 'hemoglobina corpuscular media', 'hcm hemoglobina corpuscular media'] },
  { key: 'chcm', label: 'CHCM', unit: 'g/dL', aliases: ['chcm', 'concentracao de hemoglobina corpuscular media', 'chcm concentracao de hemoglobina corpuscular media'] },
  { key: 'rdw', label: 'RDW', unit: '%', aliases: ['rdw', 'rdw cv', 'amplitude de distribuicao dos globulos vermelhos'] },
  // Hemograma — leucograma (série branca)
  { key: 'leucocitos', label: 'Leucócitos totais', unit: '/µL', count: true, aliases: ['leucocitos', 'leucocitos totais', 'contagem de leucocitos', 'leucograma'] },
  { key: 'neutrofilos', label: 'Neutrófilos', unit: '/µL', count: true, aliases: ['neutrofilos', 'neutrofilos totais'] },
  { key: 'segmentados', label: 'Neutrófilos segmentados', unit: '/µL', count: true, aliases: ['segmentados', 'neutrofilos segmentados'] },
  { key: 'bastoes', label: 'Neutrófilos bastões', unit: '/µL', count: true, aliases: ['bastoes', 'bastonetes', 'neutrofilos bastoes', 'neutrofilos bastonetes'] },
  { key: 'linfocitos', label: 'Linfócitos', unit: '/µL', count: true, aliases: ['linfocitos', 'linfocitos totais', 'linfocitos tipicos'] },
  { key: 'monocitos', label: 'Monócitos', unit: '/µL', count: true, aliases: ['monocitos'] },
  { key: 'eosinofilos', label: 'Eosinófilos', unit: '/µL', count: true, aliases: ['eosinofilos'] },
  { key: 'basofilos', label: 'Basófilos', unit: '/µL', count: true, aliases: ['basofilos'] },
  // Hemograma — plaquetograma
  { key: 'plaquetas', label: 'Plaquetas', unit: '/µL', count: true, aliases: ['plaquetas', 'contagem de plaquetas', 'plaquetometria'] },
  { key: 'vpm', label: 'VPM', unit: 'fL', aliases: ['vpm', 'volume plaquetario medio', 'vpm volume plaquetario medio'] },
  // Perfil lipídico
  { key: 'colesterol_total', label: 'Colesterol total', unit: 'mg/dL', aliases: ['colesterol total', 'colesterol'], conv: { 'mmol/l': 38.67 } },
  { key: 'hdl', label: 'HDL-colesterol', unit: 'mg/dL', aliases: ['hdl colesterol', 'colesterol hdl', 'hdl c', 'hdl'], conv: { 'mmol/l': 38.67 } },
  { key: 'ldl', label: 'LDL-colesterol', unit: 'mg/dL', aliases: ['ldl colesterol', 'colesterol ldl', 'ldl c', 'ldl', 'ldl colesterol calculado', 'ldl colesterol dosado'], conv: { 'mmol/l': 38.67 } },
  { key: 'vldl', label: 'VLDL-colesterol', unit: 'mg/dL', aliases: ['vldl colesterol', 'colesterol vldl', 'vldl c', 'vldl'], conv: { 'mmol/l': 38.67 } },
  { key: 'nao_hdl', label: 'Não-HDL-colesterol', unit: 'mg/dL', aliases: ['colesterol nao hdl', 'nao hdl', 'nao hdl colesterol'], conv: { 'mmol/l': 38.67 } },
  { key: 'triglicerideos', label: 'Triglicerídeos', unit: 'mg/dL', aliases: ['triglicerideos', 'triglicerides', 'trigliceridos', 'trigliceridios', 'tg'], conv: { 'mmol/l': 88.57 } },
  { key: 'apoa1', label: 'Apolipoproteína A1 (ApoA1)', unit: 'mg/dL', aliases: ['apolipoproteina a1', 'apolipoproteina a 1', 'apo a1', 'apo a 1', 'apoa1'], conv: { 'g/l': 100 } },
  { key: 'apob', label: 'Apolipoproteína B (ApoB)', unit: 'mg/dL', aliases: ['apolipoproteina b', 'apolipoproteina b100', 'apo b', 'apob', 'apo b100'], conv: { 'g/l': 100 } },
  { key: 'lpa', label: 'Lipoproteína(a) [Lp(a)]', unit: 'mg/dL', aliases: ['lipoproteina a', 'lipoproteina pequeno a', 'lp a', 'lpa'] },
  // Perfil glicêmico
  { key: 'glicemia', label: 'Glicemia de jejum', unit: 'mg/dL', aliases: ['glicemia de jejum', 'glicose de jejum', 'glicemia jejum', 'glicose jejum', 'glicemia', 'glicose', 'glicose plasmatica', 'glicemia em jejum'], conv: { 'mmol/l': 18.016 } },
  { key: 'hba1c', label: 'Hemoglobina glicada (HbA1c)', unit: '%', aliases: ['hemoglobina glicada', 'hba1c', 'a1c', 'glicohemoglobina', 'hemoglobina glicada hba1c', 'hemoglobina glicosilada'] },
  { key: 'gme', label: 'Glicose média estimada (GME)', unit: 'mg/dL', aliases: ['glicose media estimada', 'glicemia media estimada', 'gme', 'glicose media', 'glicemia media', 'eag'], conv: { 'mmol/l': 18.016 } },
  { key: 'insulina', label: 'Insulina basal (de jejum)', unit: 'µUI/mL', aliases: ['insulina de jejum', 'insulina', 'insulina basal', 'insulina jejum', 'insulina basal de jejum'] },
  { key: 'homa_ir', label: 'HOMA-IR', unit: '', aliases: ['homa ir', 'homa', 'indice homa ir', 'homa resistencia'] },
  { key: 'homa_beta', label: 'HOMA-Beta', unit: '%', aliases: ['homa beta', 'homa b', 'indice homa beta', 'homa %b'] },
  { key: 'peptideo_c', label: 'Peptídeo C', unit: 'ng/mL', aliases: ['peptideo c', 'peptideo c jejum', 'peptideo c basal'] },
  { key: 'totg', label: 'Glicemia 2 h no TOTG (75 g)', unit: 'mg/dL', aliases: ['totg', 'teste oral de tolerancia a glicose', 'curva glicemica', 'glicemia 120 minutos', 'glicemia 120 min', 'glicose 120 min', 'glicemia 2h', 'glicemia 2 h', 'glicemia apos 2 horas', 'totg 120 min', 'glicemia 2 h no totg', 'glicemia 2 h no totg 75 g'], conv: { 'mmol/l': 18.016 } },
  { key: 'frutosamina', label: 'Frutosamina', unit: 'µmol/L', aliases: ['frutosamina'] },
  // Perfil do ferro (cinética do ferro)
  { key: 'ferro', label: 'Ferro sérico', unit: 'µg/dL', aliases: ['ferro serico', 'ferro'] },
  { key: 'ferritina', label: 'Ferritina', unit: 'ng/mL', aliases: ['ferritina'] },
  { key: 'transferrina', label: 'Transferrina', unit: 'mg/dL', aliases: ['transferrina'] },
  { key: 'tibc', label: 'Capacidade total de ligação do ferro (TIBC/CTLF)', unit: 'µg/dL', aliases: ['capacidade total de ligacao do ferro', 'capacidade total de fixacao do ferro', 'tibc', 'ctlf', 'ctff', 'tibc ctlf'] },
  { key: 'ist', label: 'Índice de saturação de transferrina (IST)', unit: '%', aliases: ['indice de saturacao de transferrina', 'indice de saturacao da transferrina', 'saturacao de transferrina', 'saturacao da transferrina', 'ist', 'sat transferrina'] },
  // Vitaminas e minerais
  { key: 'vitamina_d', label: 'Vitamina D (25-OH)', unit: 'ng/mL', aliases: ['25 hidroxivitamina d', '25 oh vitamina d', 'vitamina d', 'vitamina d 25 oh', '25 oh d', 'vit d', 'vitamina d 25 hidroxi', 'vitamina d 25 hidroxivitamina d'], conv: { 'nmol/l': 1 / 2.496 } },
  { key: 'vitamina_b12', label: 'Vitamina B12 (cobalamina)', unit: 'pg/mL', aliases: ['vitamina b12', 'b12', 'cobalamina', 'vitamina b12 cobalamina'] },
  { key: 'acido_folico', label: 'Ácido fólico (B9/folato)', unit: 'ng/mL', aliases: ['acido folico', 'folato', 'vitamina b9', 'acido folico vitamina b9 folato'] },
  { key: 'vitamina_b1', label: 'Vitamina B1 (tiamina)', unit: 'µg/L', aliases: ['vitamina b1', 'tiamina', 'vitamina b1 tiamina'] },
  { key: 'vitamina_b6', label: 'Vitamina B6 (piridoxina)', unit: 'µg/L', aliases: ['vitamina b6', 'piridoxina', 'piridoxal fosfato', 'vitamina b6 piridoxina'] },
  { key: 'vitamina_a', label: 'Vitamina A (retinol)', unit: 'mg/L', aliases: ['vitamina a', 'retinol', 'vitamina a retinol'], conv: { 'µg/dl': 0.01, 'ug/dl': 0.01 } },
  { key: 'vitamina_e', label: 'Vitamina E (tocoferol)', unit: 'mg/L', aliases: ['vitamina e', 'tocoferol', 'alfa tocoferol', 'vitamina e tocoferol'] },
  { key: 'vitamina_c', label: 'Vitamina C', unit: 'mg/dL', aliases: ['vitamina c', 'acido ascorbico'] },
  { key: 'zinco', label: 'Zinco', unit: 'µg/dL', aliases: ['zinco'] },
  { key: 'magnesio', label: 'Magnésio', unit: 'mg/dL', aliases: ['magnesio'] },
  { key: 'selenio', label: 'Selênio', unit: 'µg/L', aliases: ['selenio'] },
  { key: 'calcio', label: 'Cálcio total', unit: 'mg/dL', aliases: ['calcio total', 'calcio'] },
  { key: 'calcio_ionico', label: 'Cálcio iônico', unit: 'mmol/L', aliases: ['calcio ionico', 'calcio ionizado', 'calcio lonizado', 'calcio livre'] },
  { key: 'pth', label: 'Paratormônio (PTH)', unit: 'pg/mL', aliases: ['paratormonio', 'pth', 'pth intacto', 'paratormonio pth', 'paratormonio pth molecula intacta', 'pth molecula intacta', 'paratormonio molecula intacta'] },
  // Fígado e vias biliares (hepatograma)
  { key: 'tgo', label: 'TGO (AST)', unit: 'U/L', aliases: ['tgo', 'ast', 'tgo ast', 'ast tgo', 'aspartato aminotransferase'] },
  { key: 'tgp', label: 'TGP (ALT)', unit: 'U/L', aliases: ['tgp', 'alt', 'tgp alt', 'alt tgp', 'alanina aminotransferase'] },
  { key: 'ggt', label: 'Gama-GT (GGT)', unit: 'U/L', aliases: ['gama gt', 'gamaglutamiltransferase', 'gama glutamil transferase', 'ggt', 'gama gt ggt'] },
  { key: 'fosfatase_alcalina', label: 'Fosfatase alcalina (FA)', unit: 'U/L', aliases: ['fosfatase alcalina', 'fa', 'fal', 'fosfatase alcalina fa'] },
  { key: 'bilirrubina_total', label: 'Bilirrubina total', unit: 'mg/dL', aliases: ['bilirrubina total', 'bilirrubinas totais', 'bt'] },
  { key: 'bilirrubina_direta', label: 'Bilirrubina direta', unit: 'mg/dL', aliases: ['bilirrubina direta', 'bd'] },
  { key: 'bilirrubina_indireta', label: 'Bilirrubina indireta', unit: 'mg/dL', aliases: ['bilirrubina indireta', 'bi'] },
  { key: 'albumina', label: 'Albumina', unit: 'g/dL', aliases: ['albumina', 'albumina serica'], conv: { 'g/l': 0.1 } },
  { key: 'tap', label: 'Tempo de protrombina (atividade)', unit: '%', aliases: ['tempo de protrombina', 'tap', 'atividade de protrombina', 'tempo de protrombina atividade', 'tp atividade', 'tap atividade'] },
  { key: 'rni', label: 'RNI (INR)', unit: '', aliases: ['rni', 'inr', 'rni inr', 'inr rni'] },
  // Pâncreas (função exócrina)
  { key: 'amilase', label: 'Amilase', unit: 'U/L', aliases: ['amilase', 'amilase total'] },
  { key: 'lipase', label: 'Lipase', unit: 'U/L', aliases: ['lipase'] },
  // Função renal
  { key: 'ureia', label: 'Ureia', unit: 'mg/dL', aliases: ['ureia', 'ureia serica'] },
  { key: 'creatinina', label: 'Creatinina', unit: 'mg/dL', aliases: ['creatinina', 'creatinina serica'] },
  { key: 'tfg', label: 'TFG estimada', unit: 'mL/min/1,73m²', aliases: ['taxa de filtracao glomerular', 'taxa de filtracao glomerular estimada', 'tfg', 'tfge', 'tfg estimada', 'egfr', 'ritmo de filtracao glomerular', 'clearance estimado'] },
  { key: 'acido_urico', label: 'Ácido úrico', unit: 'mg/dL', aliases: ['acido urico'] },
  { key: 'sodio', label: 'Sódio', unit: 'mEq/L', aliases: ['sodio'] },
  { key: 'potassio', label: 'Potássio', unit: 'mEq/L', aliases: ['potassio'] },
  // Perfil tireoidiano
  { key: 'tsh', label: 'TSH', unit: 'µUI/mL', aliases: ['tsh', 'tsh ultrassensivel', 'hormonio tireoestimulante'] },
  { key: 't4_livre', label: 'T4 livre', unit: 'ng/dL', aliases: ['t4 livre', 't4l', 'tiroxina livre'] },
  { key: 't3_livre', label: 'T3 livre', unit: 'pg/mL', aliases: ['t3 livre', 't3l', 'triiodotironina livre'] },
  { key: 'anti_tpo', label: 'Anti-TPO', unit: 'UI/mL', aliases: ['anti tpo', 'antitpo', 'anticorpo anti tpo', 'anticorpos anti tpo', 'anti tireoperoxidase', 'anticorpo anti tireoperoxidase', 'anticorpos anti tireoperoxidase'] },
  { key: 'anti_tg', label: 'Anti-tireoglobulina', unit: 'UI/mL', aliases: ['anti tireoglobulina', 'antitireoglobulina', 'anti tg', 'anticorpo anti tireoglobulina', 'anticorpos anti tireoglobulina'] },
  // Marcadores inflamatórios e musculares
  { key: 'pcr', label: 'PCR ultrassensível (PCR-us)', unit: 'mg/L', aliases: ['proteina c reativa ultrassensivel', 'proteina c reativa', 'pcr us', 'pcr', 'pcr ultrassensivel'], conv: { 'mg/dl': 10 } },
  { key: 'vhs', label: 'VHS', unit: 'mm/h', aliases: ['vhs', 'velocidade de hemossedimentacao', 'hemossedimentacao', 'velocidade de sedimentacao'] },
  { key: 'cpk', label: 'CPK (creatinofosfoquinase)', unit: 'U/L', aliases: ['cpk', 'ck', 'ck total', 'cpk total', 'creatinofosfoquinase', 'creatinoquinase', 'creatina quinase', 'creatinofosfoquinase cpk'] },
  { key: 'homocisteina', label: 'Homocisteína', unit: 'µmol/L', aliases: ['homocisteina'] },
  // Urina
  { key: 'urocultura', label: 'Urocultura (contagem de colônias)', unit: 'UFC/mL', count: true, aliases: ['urocultura', 'contagem de colonias', 'urocultura contagem de colonias'] },
  { key: 'urina_densidade', label: 'Densidade urinária', unit: '', aliases: ['densidade', 'densidade urinaria', 'densidade urina'] },
  { key: 'urina_ph', label: 'pH urinário', unit: '', aliases: ['ph', 'ph urinario', 'ph urina'] },
  { key: 'urina_leucocitos', label: 'Leucócitos na urina', unit: '/mL', count: true, aliases: ['leucocitos urina', 'leucocitos urina tipo i', 'leucocitos na urina', 'leucocitos eas', 'leucocitos urina tipo 1'] },
  { key: 'urina_hemacias', label: 'Hemácias na urina', unit: '/mL', count: true, aliases: ['hemacias urina', 'hemacias urina tipo i', 'hemacias na urina', 'hemacias eas', 'hemacias urina tipo 1', 'eritrocitos urina'] },
];
export const MARKER = Object.fromEntries(MARKERS.map((m) => [m.key, m]));

/**
 * Grupos de exames, na ordem em que aparecem na ficha: [chave, nome, exames, seção (opcional)].
 * Os três do hemograma ficam sob a mesma seção "Hemograma".
 */
const HEMO = 'Hemograma (série vermelha, branca e plaquetas)';
export const LAB_GROUPS = [
  ['eritrograma', 'Eritrograma (série vermelha)', ['eritrocitos', 'hemoglobina', 'hematocrito', 'vcm', 'hcm', 'chcm', 'rdw'], HEMO],
  ['leucograma', 'Leucograma (série branca)', ['leucocitos', 'neutrofilos', 'segmentados', 'bastoes', 'linfocitos', 'monocitos', 'eosinofilos', 'basofilos'], HEMO],
  ['plaquetograma', 'Plaquetograma', ['plaquetas', 'vpm'], HEMO],
  ['lipidico', 'Perfil lipídico', ['colesterol_total', 'hdl', 'ldl', 'vldl', 'nao_hdl', 'triglicerideos', 'apoa1', 'apob', 'lpa']],
  ['glicemico', 'Perfil glicêmico', ['glicemia', 'hba1c', 'gme', 'insulina', 'homa_ir', 'homa_beta', 'peptideo_c', 'totg', 'frutosamina']],
  ['ferro', 'Perfil do ferro (cinética do ferro)', ['ferro', 'ferritina', 'transferrina', 'tibc', 'ist']],
  ['vitaminas', 'Vitaminas e minerais', ['vitamina_d', 'vitamina_b12', 'acido_folico', 'vitamina_b1', 'vitamina_b6', 'vitamina_a', 'vitamina_e', 'vitamina_c', 'zinco', 'magnesio', 'selenio', 'calcio', 'calcio_ionico', 'pth']],
  ['figado', 'Fígado e vias biliares (hepatograma)', ['tgo', 'tgp', 'ggt', 'fosfatase_alcalina', 'bilirrubina_total', 'bilirrubina_direta', 'bilirrubina_indireta', 'albumina', 'tap', 'rni']],
  ['pancreas', 'Pâncreas (função exócrina)', ['amilase', 'lipase']],
  ['rins', 'Função renal', ['ureia', 'creatinina', 'tfg', 'acido_urico', 'sodio', 'potassio']],
  ['tireoide', 'Perfil tireoidiano', ['tsh', 't4_livre', 't3_livre', 'anti_tpo', 'anti_tg']],
  ['inflamacao', 'Marcadores inflamatórios e musculares', ['pcr', 'vhs', 'cpk', 'homocisteina']],
  ['urina', 'Urina', ['urocultura', 'urina_densidade', 'urina_ph', 'urina_leucocitos', 'urina_hemacias']],
];
const GROUP_OF = Object.fromEntries(LAB_GROUPS.flatMap(([g, , keys], gi) => keys.map((k, i) => [k, { g, gi, i }])));
/** Grupo de um exame ({ key, label }); exames fora da lista ficam em "Outros exames". */
export function labGroup(marker) {
  const x = GROUP_OF[marker];
  return x ? { key: LAB_GROUPS[x.gi][0], label: LAB_GROUPS[x.gi][1], section: LAB_GROUPS[x.gi][3] || null } : { key: 'outros', label: 'Outros exames', section: null };
}
/** Ordem para ordenar exames: grupo, depois a posição dentro do grupo. */
export function labOrder(marker) {
  const x = GROUP_OF[marker];
  return x ? x.gi * 100 + x.i : 9999;
}

/**
 * Valores de referência gerais, compilados de faixas usuais de laboratórios brasileiros e de diretrizes
 * (lipídios: SBC 2017 — alvos desejáveis, e faixas para menores de 20 anos; glicose/HbA1c: SBD/ADA;
 * vitamina D: SBPC/SBEM 2017; anemia: OMS). Cada laboratório tem as suas faixas: em caso de dúvida, vale a do laudo.
 * Formato: { min, max } ou { F: {...}, M: {...} }, aviso opcional (note) e, quando a faixa muda com a idade,
 * ages: [{ min?, max?, ref, label }] — a primeira faixa de idade que bater substitui a geral.
 */
export const REFERENCES = {
  glicemia: { min: 70, max: 99, note: '100 a 125: glicemia de jejum alterada (pré-diabetes); 126 ou mais: diabetes (SBD).' },
  hba1c: { max: 5.6, note: '5,7 a 6,4%: pré-diabetes; 6,5% ou mais: diabetes (SBD/ADA).' },
  gme: { max: 114, note: 'Calculada a partir da HbA1c (GME = 28,7 × HbA1c − 46,7). Não é a glicemia de jejum.' },
  insulina: { min: 2.6, max: 24.9, note: 'Faixa varia bastante com o método do laboratório.' },
  homa_ir: { max: 2.7, note: 'Pontos de corte variam (2,7 é o mais usado no Brasil).' },
  apoa1: { F: { min: 108, max: 225 }, M: { min: 104, max: 202 } },
  apob: { max: 100, note: 'Alvo menor em risco cardiovascular alto (ex.: abaixo de 80–90 mg/dL).' },
  lpa: { max: 30, note: 'Acima de 50 mg/dL (≈125 nmol/L) indica risco cardiovascular aumentado (EAS/SBC). Resultado em nmol/L não se converte direto para mg/dL.' },
  homa_beta: { note: 'Estimativa da função da célula beta; cerca de 100% é o esperado. Interpretar junto com o HOMA-IR.' },
  peptideo_c: { min: 1.1, max: 4.4, note: 'Em jejum. Varia com o método.' },
  totg: { max: 139, note: 'Glicemia 2 h após 75 g: 140 a 199 = intolerância à glicose; 200 ou mais = diabetes (SBD/ADA).' },
  frutosamina: { min: 205, max: 285, note: 'Reflete a glicemia das últimas 2 a 3 semanas.' },
  tibc: { min: 250, max: 450 },
  ist: { F: { min: 15, max: 50 }, M: { min: 20, max: 50 }, note: 'Abaixo de 20% sugere ferro insuficiente para a produção de hemácias; acima de 45–50%, investigar sobrecarga.' },
  vitamina_b1: { min: 28, max: 85, note: 'Varia muito com o método (sangue total ou plasma). Confira a faixa do laudo.' },
  vitamina_b6: { min: 5, max: 50, note: 'Varia muito com o método. Confira a faixa do laudo.' },
  vitamina_a: { min: 0.3, max: 0.8 },
  vitamina_e: { min: 5, max: 20 },
  vitamina_c: { min: 0.4, max: 2.0 },
  selenio: { min: 46, max: 143 },
  fosfatase_alcalina: { F: { min: 35, max: 104 }, M: { min: 40, max: 129 }, ages: [{ max: 17, ref: { max: 500 }, label: 'até 17 anos (crescimento)' }], note: 'Em crianças e adolescentes é bem mais alta por causa do crescimento ósseo.' },
  bilirrubina_total: { min: 0.2, max: 1.2 },
  bilirrubina_direta: { max: 0.3 },
  bilirrubina_indireta: { max: 0.9 },
  albumina: { min: 3.5, max: 5.2 },
  tap: { min: 70 },
  rni: { min: 0.8, max: 1.2, note: 'Em quem usa anticoagulante, o alvo é outro (definido pelo médico).' },
  tfg: { min: 90, note: '60 a 89: redução leve; 45 a 59: leve a moderada; abaixo de 60 por 3 meses = doença renal crônica (KDIGO).' },
  t3_livre: { min: 2.0, max: 4.4 },
  anti_tpo: { max: 34, note: 'Faixa varia muito com o método. Positivo sugere tireoidite autoimune (Hashimoto).' },
  anti_tg: { max: 115, note: 'Faixa varia muito com o método (alguns usam até 4 UI/mL). Confira a faixa do laudo.' },
  vhs: { F: { max: 20 }, M: { max: 15 }, ages: [{ min: 50, ref: { F: { max: 30 }, M: { max: 20 } }, label: '50 anos ou mais' }] },
  cpk: { F: { min: 26, max: 192 }, M: { min: 39, max: 308 }, note: 'Sobe depois de exercício intenso (até alguns dias).' },
  homocisteina: { min: 5, max: 15, note: 'Acima de 15 µmol/L: avaliar B12, folato e B6.' },
  segmentados: { min: 1600, max: 7000 },
  bastoes: { max: 500 },
  colesterol_total: { max: 189, ages: [{ max: 19, ref: { max: 169 }, label: 'até 19 anos' }] },
  hdl: { min: 40, ages: [{ max: 19, ref: { min: 45 }, label: 'até 19 anos' }] },
  ldl: { max: 129, note: 'A meta de LDL depende do risco cardiovascular.', ages: [{ max: 19, ref: { max: 109 }, label: 'até 19 anos' }] },
  vldl: { max: 30 },
  nao_hdl: { max: 159, ages: [{ max: 19, ref: { max: 119 }, label: 'até 19 anos' }] },
  triglicerideos: { max: 149, note: 'Sem jejum, o desejável é abaixo de 175 mg/dL (SBC 2017).', ages: [{ max: 9, ref: { max: 74 }, label: 'até 9 anos' }, { min: 10, max: 19, ref: { max: 89 }, label: '10 a 19 anos' }] },
  tgo: { F: { max: 32 }, M: { max: 40 } },
  tgp: { F: { max: 33 }, M: { max: 41 } },
  ggt: { F: { max: 36 }, M: { max: 61 } },
  amilase: { min: 28, max: 100 },
  lipase: { min: 13, max: 60, note: 'Varia muito com o método: alguns laboratórios usam até 160 U/L. Confira a faixa do laudo.' },
  creatinina: { F: { min: 0.6, max: 1.1 }, M: { min: 0.7, max: 1.3 } },
  ureia: { min: 15, max: 45, ages: [{ min: 60, ref: { min: 15, max: 55 }, label: '60 anos ou mais' }] },
  acido_urico: { F: { min: 2.4, max: 5.7 }, M: { min: 3.4, max: 7.0 } },
  tsh: { min: 0.4, max: 4.0, ages: [{ min: 65, ref: { min: 0.4, max: 5.0 }, label: '65 anos ou mais' }], note: 'Em idosos, valores um pouco acima de 4 podem ser normais.' },
  t4_livre: { min: 0.9, max: 1.7 },
  pth: { min: 15, max: 65, note: 'PTH alto com vitamina D baixa costuma ser secundário à deficiência de vitamina D.' },
  eritrocitos: { F: { min: 4.0, max: 5.2 }, M: { min: 4.5, max: 5.9 } },
  hemoglobina: { F: { min: 12.0, max: 15.5 }, M: { min: 13.0, max: 17.5 }, note: 'Anemia (OMS): abaixo de 12 g/dL em mulheres e 13 g/dL em homens.',
    ages: [{ max: 11, ref: { min: 11.5, max: 15.5 }, label: 'até 11 anos' }, { min: 12, max: 17, ref: { F: { min: 12.0, max: 16.0 }, M: { min: 13.0, max: 16.5 } }, label: '12 a 17 anos' }] },
  hematocrito: { F: { min: 35, max: 45 }, M: { min: 39, max: 50 } },
  vcm: { min: 80, max: 100 },
  hcm: { min: 27, max: 33 },
  chcm: { min: 32, max: 36 },
  rdw: { min: 11.5, max: 14.5 },
  leucocitos: { min: 4000, max: 11000 },
  neutrofilos: { min: 1800, max: 7700 },
  eosinofilos: { min: 50, max: 500 },
  basofilos: { max: 200 },
  linfocitos: { min: 1000, max: 4500 },
  monocitos: { min: 200, max: 1000 },
  plaquetas: { min: 150000, max: 450000 },
  vpm: { min: 9.2, max: 12.6 },
  ferritina: { F: { min: 15, max: 150 }, M: { min: 30, max: 400 }, ages: [{ min: 50, ref: { F: { min: 15, max: 300 }, M: { min: 30, max: 400 } }, label: '50 anos ou mais' }] },
  ferro: { F: { min: 50, max: 170 }, M: { min: 65, max: 175 } },
  transferrina: { min: 200, max: 360 },
  vitamina_d: { min: 20, max: 100, note: 'SBPC/SBEM: acima de 20 ng/mL para a população geral saudável; 30 a 60 ng/mL para grupos de risco (idosos, gestantes, osteoporose, obesidade, má absorção).',
    ages: [{ min: 60, ref: { min: 30, max: 100 }, label: '60 anos ou mais, grupo de risco' }] },
  vitamina_b12: { min: 200, max: 900 },
  acido_folico: { min: 3.9 },
  pcr: { max: 5.0, note: 'PCR ultrassensível (risco cardiovascular): abaixo de 1 baixo, 1 a 3 intermediário, acima de 3 alto.' },
  sodio: { min: 135, max: 145 },
  potassio: { min: 3.5, max: 5.0 },
  calcio: { min: 8.5, max: 10.5 },
  calcio_ionico: { min: 1.12, max: 1.32 },
  magnesio: { min: 1.6, max: 2.6 },
  zinco: { min: 70, max: 120 },
  urocultura: { max: 100000, note: 'Abaixo de 10.000 UFC/mL: negativo; 10.000 a 100.000: interpretar com os sintomas; 100.000 ou mais: positivo.' },
  urina_densidade: { min: 1.005, max: 1.030 },
  urina_ph: { min: 5.0, max: 8.0 },
  urina_leucocitos: { max: 10000 },
  urina_hemacias: { max: 10000 },
};

const fmtNum = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('pt-BR') : String(v).replace('.', ','));
const rangeText = (r) => (r.min != null && r.max != null ? `${fmtNum(r.min)} a ${fmtNum(r.max)}` : r.min != null ? `≥ ${fmtNum(r.min)}` : `≤ ${fmtNum(r.max)}`);

/** Idade em anos completos numa data (AAAA-MM-DD). */
export function ageAt(birthISO, dateISO) {
  if (!birthISO || !dateISO) return null;
  const [by, bm, bd] = birthISO.split('-').map(Number);
  const [y, m, d] = dateISO.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Faixa para o sexo e a idade do paciente. Sem sexo e com faixas diferentes: só o texto (sem cor). */
export function referenceFor(marker, sex, age = null) {
  const base = REFERENCES[marker];
  if (!base) return null;
  const band = age != null ? (base.ages || []).find((b) => (b.min == null || age >= b.min) && (b.max == null || age <= b.max)) : null;
  const ref = band ? band.ref : base;
  const ageLabel = band ? band.label : '';
  if (ref.F || ref.M) {
    if (sex === 'F' || sex === 'M') return { ...ref[sex], note: base.note, ageLabel, text: rangeText(ref[sex]) };
    return { text: `M ${rangeText(ref.F)} · H ${rangeText(ref.M)}`, note: base.note, ageLabel, bySex: true };
  }
  if (ref.min == null && ref.max == null) return { note: base.note, ageLabel, text: '—', noRange: true };
  return { min: ref.min, max: ref.max, note: base.note, ageLabel, text: rangeText(ref) };
}

/** 'ok' | 'low' | 'high' | null (sem referência, sem sexo definido ou unidade diferente da padrão). */
export function referenceStatus(marker, value, unit, sex, age = null) {
  const ref = referenceFor(marker, sex, age);
  if (!ref || ref.bySex || ref.noRange) return null;
  const def = MARKER[marker];
  if (def && unit && def.unit && normUnit(unit) !== normUnit(def.unit)) return null;
  const v = Number(value);
  if (ref.min != null && v < ref.min) return 'low';
  if (ref.max != null && v > ref.max) return 'high';
  return 'ok';
}

const normName = (s) => norm(s).replace(/[()\-–—_/.,:]/g, ' ').replace(/\s+/g, ' ').trim();
const BY_ALIAS = new Map(MARKERS.flatMap((m) => [m.label, ...m.aliases].map((a) => [normName(a), m])));
const normUnit = (u) => norm(u).replace(/\s+/g, '').replace('μ', 'µ');

/**
 * Encontra o biomarcador pelo nome (ou null). Só aceita nome igual a um conhecido: o nome inteiro, ou o nome sem o
 * trecho entre parênteses (ex.: "TGO (AST)" → "tgo"). Nunca "começa com" — por isso a glicose média não vira jejum.
 */
export function findMarker(name) {
  const full = normName(name);
  const noParens = normName(String(name).replace(/\([^)]*\)/g, ' '));
  return BY_ALIAS.get(full) || BY_ALIAS.get(noParens) || null;
}

export function keyForLabel(label) {
  return findMarker(label)?.key || 'outro_' + norm(label).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Número do laudo: "5,1" → 5.1; contagens com ponto de milhar ("6.500", "250.000") → 6500, 250000. */
function parseNumber(raw, isCount) {
  const t = raw.replace(/[<>\s]/g, '');
  if (isCount && /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(',', '.'));
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
    const m = line.match(/^(.+?)\s*[:=]\s*([<>]?\s*-?\d+(?:[.,]\d+)*)\s*([^\s(;]*)/);
    if (!m) continue;
    const label = m[1].trim();
    let unit = m[3].trim();
    const def = findMarker(label);
    const isCount = def ? !!def.count : /^\/|ufc/i.test(unit); // contagem: unidade "/µL", "/mL", "UFC/mL"
    let value = parseNumber(m[2], isCount);
    if (!Number.isFinite(value)) continue;
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
Atenção: "Glicose média estimada" (calculada da HbA1c) NÃO é "Glicemia de jejum"; "VLDL-colesterol" NÃO é "Colesterol total";
leucócitos e hemácias do exame de urina ficam em "Leucócitos na urina" e "Hemácias na urina", nunca no hemograma.
Contagens sem ponto de milhar (ex.: Leucócitos: 6500 /µL; Plaquetas: 250000 /µL).
Para exames que não estão na lista, use o nome que aparece no laudo e a unidade do laudo.
Não invente valores e não inclua os valores de referência.
Comece com a data da coleta, se houver: "Data: DD/MM/AAAA".

Data: DD/MM/AAAA
${list}`;
}
