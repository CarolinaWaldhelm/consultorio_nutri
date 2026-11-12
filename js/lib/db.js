import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** Executa uma consulta do Supabase e devolve os dados, ou lança o erro. */
export async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Divide uma lista em pedaços (para inserir muitas linhas de uma vez). */
export function chunks(list, size = 500) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
