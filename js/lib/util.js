const TZ = 'America/Sao_Paulo';

/** Nome sem acentos, minúsculo e sem espaços extras (usado para busca e cruzamento). */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Data de hoje (horário de Brasília) no formato AAAA-MM-DD. */
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** AAAA-MM-DD → DD/MM/AAAA */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Dias entre duas datas AAAA-MM-DD (b − a). */
export function daysBetween(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function daysAgoLabel(iso) {
  if (!iso) return '–';
  const n = daysBetween(iso, todayISO());
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Há 1 dia';
  return `Há ${n} dias`;
}

export function ageFrom(birth) {
  if (!birth) return null;
  const t = todayISO();
  let age = +t.slice(0, 4) - +birth.slice(0, 4);
  if (t.slice(5) < birth.slice(5, 10)) age -= 1;
  return age;
}

export function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

export function patientCode(code) {
  return code ? `P-${String(code).padStart(4, '0')}` : '';
}

export function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

export const SEX_LABEL = { F: 'Feminino', M: 'Masculino' };

export const OBJECTIVES = [
  ['perda_peso', 'Perda de peso'],
  ['recomposicao', 'Recomposição corporal'],
  ['manutencao', 'Manutenção'],
  ['ganho_massa', 'Ganho de massa'],
];
export const OBJECTIVE_LABEL = Object.fromEntries(OBJECTIVES);

/** Classificação do IMC: OMS para adultos, Lipschitz (SISVAN) para 60 anos ou mais. */
export function classifyBMI(bmi, age) {
  if (bmi == null) return '';
  if (age != null && age >= 60) {
    if (bmi < 22) return 'Baixo peso';
    if (bmi <= 27) return 'Eutrofia';
    return 'Sobrepeso';
  }
  if (bmi < 18.5) return 'Baixo peso';
  if (bmi < 25) return 'Eutrofia';
  if (bmi < 30) return 'Sobrepeso';
  if (bmi < 35) return 'Obesidade grau I';
  if (bmi < 40) return 'Obesidade grau II';
  return 'Obesidade grau III';
}

/** Prioridade de origem para medições no mesmo dia. */
export const SOURCE_RANK = { consulta: 3, nutrium_prof: 2, nutrium_app: 1 };
export const SOURCE_LABEL = { consulta: 'consulta', nutrium_prof: 'Nutrium', nutrium_app: 'Nutrium (app)' };

/** Medição mais recente de uma métrica: data mais nova; no mesmo dia, a de maior prioridade. */
export function latestOf(measurements, metric) {
  return measurements
    .filter((m) => m.metric === metric)
    .sort((a, b) => b.date.localeCompare(a.date) || SOURCE_RANK[b.source] - SOURCE_RANK[a.source])[0] ?? null;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); return fn(...args); };
  return wrapped;
}
