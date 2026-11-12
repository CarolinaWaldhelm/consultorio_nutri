// Leitura da planilha exportada pelo Nutrium e cruzamento com os pacientes do sistema.
// Funções puras (sem banco), para poderem ser testadas isoladamente.
import { norm, unique, daysBetween } from './util.js';

/** Pacientes sem consulta há mais que isso não entram na importação. */
export const ACTIVE_DAYS = 150;

const key = (h) => norm(h).replace(/[^a-z0-9]/g, '');

function findSheet(XLSX, wb, word) {
  const name = wb.SheetNames.find((n) => key(n).includes(word));
  if (!name) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: true }).map((row) => {
    const o = {};
    for (const k in row) o[key(k)] = row[k];
    return o;
  });
}

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

export function toTime(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'number') {
    const mins = Math.round((v % 1) * 1440);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

function mapSex(v) {
  const s = norm(v);
  if (s.startsWith('fem')) return 'F';
  if (s.startsWith('masc')) return 'M';
  return null;
}

const email = (v) => (v ? String(v).trim().toLowerCase() : null);

/** Lê as três abas da planilha do Nutrium. */
export function parseWorkbook(XLSX, wb) {
  const perfil = findSheet(XLSX, wb, 'perfil');
  if (!perfil.length) {
    throw new Error('Não encontrei a aba "Perfil do paciente". Confira se é a planilha exportada pelo Nutrium (.xlsx).');
  }
  const profiles = perfil
    .map((r) => ({
      email: email(r.email),
      name: r.nome ? String(r.nome).trim().replace(/\s+/g, ' ') : null,
      birth_date: toISODate(r.datadenascimento),
      sex: mapSex(r.genero),
      phone: r.telefone ? String(r.telefone).trim() : null,
      registered_at: toISODate(r.dataderegistro),
      tags: r.etiquetas
        ? String(r.etiquetas).split('\n').map((t) => t.replace(/^\s*-\s*/, '').trim()).filter(Boolean).join(', ')
        : null,
    }))
    .filter((p) => p.name);

  const appointments = findSheet(XLSX, wb, 'consulta')
    .map((r) => ({
      email: email(r.email),
      date: toISODate(r.data),
      start_time: toTime(r.horadeinicio),
      end_time: toTime(r.horadetermino),
    }))
    .filter((a) => a.email && a.date);

  // Do Nutrium entram só peso e altura (decisão da nutricionista).
  const measurements = findSheet(XLSX, wb, 'medic')
    .map((r) => {
      const metric = norm(r.medicao);
      return {
        email: email(r.email),
        metric: metric === 'peso' ? 'peso' : metric === 'altura' ? 'altura' : null,
        date: toISODate(r.data),
        value: Number(String(r.valor ?? '').replace(',', '.')),
        unit: r.unidade ? String(r.unidade) : null,
        source: norm(r.registradapor) === 'cliente' ? 'nutrium_app' : 'nutrium_prof',
      };
    })
    .filter((m) => m.email && m.metric && m.date && Number.isFinite(m.value) && m.value > 0);

  return { profiles, appointments, measurements };
}

const nameBirthKey = (name, birth) => (birth ? `${norm(name)}|${birth}` : null);

/**
 * Monta o plano de importação.
 * existing: pacientes do banco (linhas completas da tabela patients).
 * today: data de hoje (AAAA-MM-DD). Fica de fora quem está há mais de ACTIVE_DAYS dias da última consulta
 * e não tem consulta marcada (uma consulta futura conta como atividade). Sem consultas, vale a data de registro.
 */
export function buildPlan(parsed, existing, today) {
  // 1. Uma pessoa por e-mail.
  const byEmail = new Map();
  parsed.profiles.forEach((p, i) => {
    const k = p.email || `__sem_email_${i}`;
    const prev = byEmail.get(k);
    if (!prev || (p.registered_at || '') > (prev.registered_at || '')) byEmail.set(k, p);
  });

  // 2. Mesmo nome + nascimento com e-mails diferentes = mesma pessoa (troca de conta).
  //    Fica como principal a conta com data de registro mais recente.
  const groups = new Map();
  const persons = [];
  const merges = [];
  for (const p of byEmail.values()) {
    const k = nameBirthKey(p.name, p.birth_date);
    if (!k) { persons.push({ ...p, emails: p.email ? [p.email] : [] }); continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => (b.registered_at || '').localeCompare(a.registered_at || ''));
    const primary = g[0];
    persons.push({
      ...primary,
      emails: unique(g.map((x) => x.email)),
      phone: g.map((x) => x.phone).find(Boolean) || null,
    });
    if (g.length > 1) merges.push({ name: primary.name, emails: unique(g.map((x) => x.email)) });
  }
  persons.sort((a, b) => norm(a.name).localeCompare(norm(b.name)));

  // 3. Última atividade de cada pessoa: consulta mais recente (inclusive agendada) ou registro.
  const personOfEmail = new Map();
  persons.forEach((p, i) => p.emails.forEach((e) => personOfEmail.set(e, i)));
  const lastActivity = persons.map((p) => p.registered_at || '');
  for (const a of parsed.appointments) {
    const i = personOfEmail.get(a.email);
    if (i != null && a.date > lastActivity[i]) lastActivity[i] = a.date;
  }
  const isOld = (i) => !lastActivity[i] || daysBetween(lastActivity[i], today) > ACTIVE_DAYS;

  // 4. Cruzamento com o banco: e-mail → nome + nascimento → revisão manual.
  //    Pessoas antigas que não estão no banco são ignoradas.
  const skippedOld = [];
  const exByEmail = new Map();
  const exByNameBirth = new Map();
  for (const ex of existing) {
    for (const e of unique([ex.email_primary, ...(ex.emails || [])])) exByEmail.set(e.toLowerCase(), ex);
    const k = nameBirthKey(ex.name, ex.birth_date);
    if (k) exByNameBirth.set(k, ex);
  }
  const matches = [];
  const unmatched = [];
  persons.forEach((p, i) => {
    let ex = p.emails.map((e) => exByEmail.get(e)).find(Boolean);
    let how = 'e-mail';
    if (!ex) { ex = exByNameBirth.get(nameBirthKey(p.name, p.birth_date)); how = 'nome + nascimento'; }
    if (ex) matches.push({ index: i, existing: ex, how, old: isOld(i), lastActivity: lastActivity[i] });
    else if (isOld(i)) skippedOld.push(i);
    else unmatched.push(i);
  });

  // 5. Consultas e medições ligadas a cada pessoa pelo e-mail.
  const appointments = [];
  const measurements = [];
  let orphan = 0;
  for (const a of parsed.appointments) {
    const i = personOfEmail.get(a.email);
    if (i == null) orphan++; else appointments.push({ ...a, index: i });
  }
  for (const m of parsed.measurements) {
    const i = personOfEmail.get(m.email);
    if (i == null) orphan++; else measurements.push({ ...m, index: i });
  }

  return { persons, matches, unmatched, skippedOld, merges, appointments, measurements, orphan, lastActivity };
}

/** Junta os dados do Nutrium a um paciente já existente, sem apagar o que foi preenchido no sistema. */
export function mergeIntoExisting(ex, p) {
  const name = ex.name || p.name;
  return {
    ...ex,
    name,
    name_norm: norm(name),
    birth_date: ex.birth_date || p.birth_date,
    sex: ex.sex || p.sex,
    phone: ex.phone || p.phone,
    email_primary: p.emails[0] || ex.email_primary,
    emails: unique([...p.emails, ...(ex.emails || []), ex.email_primary]),
    nutrium_registered_at: p.registered_at || ex.nutrium_registered_at,
    tags: p.tags ?? ex.tags,
  };
}

export function newPatientRow(p, id) {
  return {
    id,
    name: p.name,
    name_norm: norm(p.name),
    birth_date: p.birth_date,
    sex: p.sex,
    phone: p.phone,
    email_primary: p.emails[0] || null,
    emails: p.emails,
    nutrium_registered_at: p.registered_at,
    tags: p.tags,
  };
}

/** Linhas finais de consultas e medições, sem duplicatas. idOf: índice da pessoa → id do paciente. */
export function childRows(plan, idOf) {
  const appts = new Map();
  for (const a of plan.appointments) {
    const pid = idOf[a.index];
    if (!pid) continue;
    // Consultas repetidas no mesmo dia contam como uma só.
    const k = `${pid}|${a.date}`;
    const prev = appts.get(k);
    if (!prev || (a.start_time || '') < (prev.start_time || '')) {
      appts.set(k, { patient_id: pid, date: a.date, start_time: a.start_time, end_time: a.end_time });
    }
  }
  const meas = new Map();
  for (const m of plan.measurements) {
    const pid = idOf[m.index];
    if (!pid) continue;
    meas.set(`${pid}|${m.date}|${m.metric}|${m.source}`, {
      patient_id: pid, date: m.date, metric: m.metric, value: m.value, unit: m.unit, source: m.source,
    });
  }
  return { appointments: [...appts.values()], measurements: [...meas.values()] };
}
