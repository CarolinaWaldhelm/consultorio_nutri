import { html, useState } from '../lib/preact.js';
import { supabase, run, chunks } from '../lib/db.js';
import { fmtDate } from '../lib/util.js';
import { parseWorkbook, buildPlan, mergeIntoExisting, newPatientRow, childRows } from '../lib/nutrium.js';
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
      const ex = await run(supabase.from('patients').select('*'));
      setExisting(ex);
      setPlan(buildPlan(parsed, ex));
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

      for (const m of plan.matches) {
        idOf[m.index] = m.existing.id;
        updates.set(m.existing.id, mergeIntoExisting(updates.get(m.existing.id) || m.existing, plan.persons[m.index]));
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

      const rows = childRows(plan, idOf);
      setProgress('Atualizando consultas do Nutrium…');
      await run(supabase.from('nutrium_appointments').delete().gte('date', '1900-01-01'));
      for (const part of chunks(rows.appointments)) await run(supabase.from('nutrium_appointments').insert(part));

      setProgress('Atualizando peso e altura…');
      await run(supabase.from('measurements').delete().in('source', ['nutrium_app', 'nutrium_prof']));
      for (const part of chunks(rows.measurements)) await run(supabase.from('measurements').insert(part));

      setResult({ created: inserts.length, updated: upd.length, appts: rows.appointments.length, meas: rows.measurements.length });
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
  const linkable = existing.filter((x) => !matchedIds.has(x.id)).sort((a, b) => a.name.localeCompare(b.name));

  return html`
    <section class="card">
      <h2 class="card-title">Resumo da planilha</h2>
      <div class="stats">
        <div class="stat"><div class="stat-label">Pacientes na planilha</div><div class="stat-value">${plan.persons.length}</div></div>
        <div class="stat"><div class="stat-label">Já cadastrados</div><div class="stat-value">${plan.matches.length}</div></div>
        <div class="stat"><div class="stat-label">${firstImport ? 'Serão criados' : 'Não encontrados'}</div><div class="stat-value">${plan.unmatched.length}</div></div>
        <div class="stat"><div class="stat-label">Consultas</div><div class="stat-value">${plan.appointments.length}</div></div>
        <div class="stat"><div class="stat-label">Pesos e alturas</div><div class="stat-value">${plan.measurements.length}</div></div>
      </div>
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
