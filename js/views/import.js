import { html, useState } from '../lib/preact.js';
import { supabase, run, chunks } from '../lib/db.js';
import { fmtDate, todayISO, daysBetween } from '../lib/util.js';
import { parseWorkbook, buildPlan, mergeIntoExisting, newPatientRow, childRows, ACTIVE_DAYS } from '../lib/nutrium.js';
import { ErrorBox } from './common.js';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

export function ImportPage() {
  const [stage, setStage] = useState('pick'); // pick | reading | review | importing | done
  const [plan, setPlan] = useState(null);
  const [existing, setExisting] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setStage('reading');
    try {
      const XLSX = await import(XLSX_URL);
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const parsed = parseWorkbook(XLSX, wb);
      const [ex, own, notes] = await Promise.all([
        run(supabase.from('patients').select('*')),
        run(supabase.from('consultations').select('patient_id, date')),
        run(supabase.from('ai_notes').select('patient_id')),
      ]);
      const today = todayISO();
      const plan = buildPlan(parsed, ex, today);
      // Consulta registrada no software nos últimos 150 dias também conta como atividade.
      const recentOwn = new Set(own.filter((c) => c.date <= today && daysBetween(c.date, today) <= ACTIVE_DAYS).map((c) => c.patient_id));
      for (const m of plan.matches) if (recentOwn.has(m.existing.id)) m.old = false;
      // Antigos: removidos. Os que têm anotações da nutricionista não são apagados: ficam inativos
      // (fora da lista) e voltam sozinhos se marcarem consulta.
      const hasNotes = new Set([...own, ...notes].map((r) => r.patient_id));
      plan.removable = plan.matches.filter((m) => m.old && !hasNotes.has(m.existing.id));
      plan.toInactivate = plan.matches.filter((m) => m.old && hasNotes.has(m.existing.id));
      plan.toReactivate = plan.matches.filter((m) => !m.old && m.existing.inactive_reason === 'importacao');
      setExisting(ex);
      setPlan(plan);
      setDecisions({});
      setStage('review');
    } catch (err) {
      setError(err);
      setStage('pick');
    }
    e.target.value = '';
  }

  async function apply() {
    setStage('importing');
    setError(null);
    try {
      const exById = new Map(existing.map((x) => [x.id, x]));
      const idOf = [];
      const updates = new Map();
      const inserts = [];

      const toRemove = new Set(plan.removable.map((m) => m.existing.id));
      for (const m of plan.matches) {
        if (toRemove.has(m.existing.id)) continue;
        idOf[m.index] = m.existing.id;
        const row = mergeIntoExisting(updates.get(m.existing.id) || m.existing, plan.persons[m.index]);
        if (plan.toInactivate.includes(m)) { row.status = 'inativo'; row.inactive_reason = 'importacao'; }
        if (plan.toReactivate.includes(m)) { row.status = 'ativo'; row.inactive_reason = null; }
        updates.set(m.existing.id, row);
      }
      for (const i of plan.unmatched) {
        const choice = decisions[i] || 'new';
        if (choice === 'new') {
          const id = crypto.randomUUID();
          idOf[i] = id;
          inserts.push(newPatientRow(plan.persons[i], id));
        } else {
          idOf[i] = choice;
          updates.set(choice, mergeIntoExisting(updates.get(choice) || exById.get(choice), plan.persons[i]));
        }
      }

      let n = 0;
      for (const part of chunks(inserts)) {
        setProgress(`Criando pacientes… ${n}/${inserts.length}`);
        await run(supabase.from('patients').insert(part));
        n += part.length;
      }
      const upd = [...updates.values()];
      n = 0;
      for (const part of chunks(upd)) {
        setProgress(`Atualizando pacientes… ${n}/${upd.length}`);
        await run(supabase.from('patients').upsert(part));
        n += part.length;
      }

      for (const part of chunks([...toRemove], 200)) {
        setProgress('Removendo pacientes antigos…');
        await run(supabase.from('patients').delete().in('id', part));
      }

      const rows = childRows(plan, idOf);
      setProgress('Atualizando consultas do Nutrium…');
      await run(supabase.from('nutrium_appointments').delete().gte('date', '1900-01-01'));
      for (const part of chunks(rows.appointments)) await run(supabase.from('nutrium_appointments').insert(part));

      setProgress('Atualizando peso e altura…');
      await run(supabase.from('measurements').delete().in('source', ['nutrium_app', 'nutrium_prof']));
      for (const part of chunks(rows.measurements)) await run(supabase.from('measurements').insert(part));

      setResult({ created: inserts.length, updated: upd.length, removed: toRemove.size, inactivated: plan.toInactivate.length, reactivated: plan.toReactivate.length, skipped: plan.skippedOld.length, appts: rows.appointments.length, meas: rows.measurements.length });
      setStage('done');
    } catch (err) {
      setError(err);
      setStage('review');
    }
  }

  return html`
    <div class="page-head"><h1>Importar planilha do Nutrium</h1></div>
    <${ErrorBox} error=${error} />

    ${(stage === 'pick' || stage === 'reading') && html`
      <section class="card">
        <h2 class="card-title">Como exportar do Nutrium</h2>
        <ol class="steps">
          <li>No Nutrium, clique no seu nome (canto superior) → <strong>Privacidade e notificações</strong>.</li>
          <li>Clique em <strong>“Exportar informações de todos os clientes”</strong>.</li>
          <li>O arquivo chega no seu e-mail. Baixe o <strong>.xlsx</strong> e escolha abaixo, sem editar nada.</li>
        </ol>
        <label class="dropzone">
          <input type="file" accept=".xlsx,.xls" onChange=${onFile} disabled=${stage === 'reading'} />
          <span>${stage === 'reading' ? 'Lendo a planilha…' : '📄 Clique para escolher a planilha (.xlsx)'}</span>
        </label>
        <p class="muted small">
          O que é importado: cadastro, datas das consultas e <strong>apenas peso e altura</strong>.
          Quem está há mais de ${ACTIVE_DAYS} dias da última consulta <strong>e</strong> não tem consulta marcada fica de fora
          (e é removido, se já estava no sistema). Se marcar consulta de novo, volta na importação seguinte.
          Nada do que você anotou no software é apagado.
        </p>
      </section>`}

    ${stage === 'review' && plan && html`<${Review}
      plan=${plan} existing=${existing} decisions=${decisions} setDecisions=${setDecisions}
      onApply=${apply} onCancel=${() => setStage('pick')} />`}

    ${stage === 'importing' && html`<section class="card"><p>⏳ ${progress}</p><p class="muted small">Não feche esta página.</p></section>`}

    ${stage === 'done' && result && html`
      <section class="card">
        <h2 class="card-title">✅ Importação concluída</h2>
        <ul>
          <li>${result.created} paciente(s) novo(s)</li>
          <li>${result.updated} paciente(s) atualizado(s)</li>
          ${result.skipped > 0 && html`<li>${result.skipped} paciente(s) ignorado(s) por estarem há mais de ${ACTIVE_DAYS} dias sem consulta</li>`}
          ${result.removed > 0 && html`<li>${result.removed} paciente(s) antigo(s) removido(s) do sistema</li>`}
          ${result.inactivated > 0 && html`<li>${result.inactivated} paciente(s) antigo(s) com anotações suas marcado(s) como inativo(s)</li>`}
          ${result.reactivated > 0 && html`<li>${result.reactivated} paciente(s) que voltou(aram) a marcar consulta reativado(s)</li>`}
          <li>${result.appts} consulta(s) do Nutrium</li>
          <li>${result.meas} medição(ões) de peso e altura</li>
        </ul>
        <div class="actions" style="justify-content:flex-start">
          <a class="btn btn-primary" href="#/">Ver pacientes</a>
          <button class="btn" onClick=${() => { setResult(null); setStage('pick'); }}>Importar outra planilha</button>
        </div>
      </section>`}`;
}

function Review({ plan, existing, decisions, setDecisions, onApply, onCancel }) {
  const firstImport = existing.length === 0;
  const matchedIds = new Set(plan.matches.map((m) => m.existing.id));
  const skipped = new Set(plan.skippedOld);
  const nAppts = plan.appointments.filter((a) => !skipped.has(a.index)).length;
  const nMeas = plan.measurements.filter((m) => !skipped.has(m.index)).length;
  const linkable = existing.filter((x) => !matchedIds.has(x.id)).sort((a, b) => a.name.localeCompare(b.name));

  return html`
    <section class="card">
      <h2 class="card-title">Resumo da planilha</h2>
      <div class="stats">
        <div class="stat"><div class="stat-label">Pacientes na planilha</div><div class="stat-value">${plan.persons.length}</div></div>
        <div class="stat"><div class="stat-label">Ignorados (+${ACTIVE_DAYS} dias)</div><div class="stat-value">${plan.skippedOld.length}</div></div>
        <div class="stat"><div class="stat-label">Já cadastrados</div><div class="stat-value">${plan.matches.length}</div></div>
        <div class="stat"><div class="stat-label">${firstImport ? 'Serão criados' : 'Não encontrados'}</div><div class="stat-value">${plan.unmatched.length}</div></div>
        <div class="stat"><div class="stat-label">Consultas</div><div class="stat-value">${nAppts}</div></div>
        <div class="stat"><div class="stat-label">Pesos e alturas</div><div class="stat-value">${nMeas}</div></div>
      </div>
      ${(plan.removable.length > 0 || plan.toInactivate.length > 0 || plan.toReactivate.length > 0) && html`
        <div class="alert">
          ${plan.removable.length > 0 && html`<div>🗑️ <strong>${plan.removable.length} paciente(s)</strong> que já estavam no sistema passaram de ${ACTIVE_DAYS} dias sem consulta e sem consulta marcada: serão <strong>removidos</strong>.</div>`}
          ${plan.toInactivate.length > 0 && html`<div>💤 <strong>${plan.toInactivate.length} paciente(s)</strong> na mesma situação têm anotações suas: não serão apagados, ficam <strong>inativos</strong> (fora da lista) e voltam sozinhos se marcarem consulta.</div>`}
          ${plan.toReactivate.length > 0 && html`<div>✅ <strong>${plan.toReactivate.length} paciente(s)</strong> inativo(s) marcaram consulta de novo: serão <strong>reativados</strong>.</div>`}
        </div>`}
      ${plan.merges.length > 0 && html`
        <div class="alert">
          <strong>${plan.merges.length} paciente(s) com duas contas no Nutrium</strong> (mesmo nome e nascimento, e-mails diferentes)
          serão unidos em um só, usando a conta mais recente:
          <ul>${plan.merges.map((m) => html`<li>${m.name}</li>`)}</ul>
        </div>`}
    </section>

    ${!firstImport && plan.unmatched.length > 0 && html`
      <section class="card">
        <h2 class="card-title">Pacientes não encontrados no sistema</h2>
        <p class="muted">Para cada um, escolha se é um paciente novo ou se é alguém que você já cadastrou (por exemplo, pelo cadastro rápido com o nome um pouco diferente).</p>
        <table class="table">
          <thead><tr><th>Na planilha</th><th>O que fazer</th></tr></thead>
          <tbody>
            ${plan.unmatched.map((i) => {
              const p = plan.persons[i];
              return html`
                <tr>
                  <td>${p.name}<div class="muted small">${p.birth_date ? 'nasc. ' + fmtDate(p.birth_date) : 'sem nascimento'}</div></td>
                  <td>
                    <select value=${decisions[i] || 'new'} onChange=${(e) => setDecisions({ ...decisions, [i]: e.target.value })}>
                      <option value="new">➕ Criar paciente novo</option>
                      ${linkable.map((x) => html`<option value=${x.id}>🔗 É: ${x.name}${x.birth_date ? ' (' + fmtDate(x.birth_date) + ')' : ''}</option>`)}
                    </select>
                  </td>
                </tr>`;
            })}
          </tbody>
        </table>
      </section>`}

    <div class="actions">
      <button class="btn" onClick=${onCancel}>Cancelar</button>
      <button class="btn btn-primary" onClick=${onApply}>Importar</button>
    </div>`;
}
