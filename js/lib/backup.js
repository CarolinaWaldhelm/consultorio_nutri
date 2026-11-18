// Backup: baixa todos os dados do banco num arquivo .json (os laudos anexados ficam no Supabase).
import { supabase } from './db.js';
import { todayISO } from './util.js';

export const BACKUP_TABLES = [
  'patients', 'consultations', 'nutrium_appointments', 'measurements', 'calculations', 'ai_notes',
  'questionnaires', 'questionnaire_sends', 'questionnaire_responses', 'lab_exams', 'lab_results', 'app_settings',
];
const SECRET_SETTINGS = ['calendar_ics_url']; // o endereço secreto da agenda não vai para o arquivo
export const BACKUP_EVERY_DAYS = 7;

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function downloadBackup(onProgress = () => {}) {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    onProgress(t);
    tables[t] = await fetchAll(t);
  }
  tables.app_settings = tables.app_settings.filter((r) => !SECRET_SETTINGS.includes(r.key));
  const payload = {
    sistema: 'Consultório Nutri',
    gerado_em: new Date().toISOString(),
    observacao: 'Cópia de todos os dados. Os arquivos dos laudos ficam guardados no Supabase (pasta "exames").',
    tabelas: tables,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `backup-consultorio-${todayISO()}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  await supabase.from('app_settings').upsert({ key: 'last_backup_at', value: new Date().toISOString() });
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
}
