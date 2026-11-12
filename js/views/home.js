import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { norm, fmtDate, daysAgoLabel, daysBetween, todayISO, onlyDigits } from '../lib/util.js';
import { Modal, Field, ErrorBox, Loading, go } from './common.js';

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function dayLabel(iso) {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  const d = new Date(iso + 'T12:00:00');
  return `${WEEKDAY[d.getDay()]} ${fmtDate(iso).slice(0, 5)}`;
}

export function Home() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('ativos');

  useEffect(() => {
    run(supabase.from('patient_overview').select('*').order('name'))
      .then(setPatients)
      .catch(setError);
  }, []);

  const today = todayISO();
  const upcoming = useMemo(() => (patients || [])
    .filter((p) => p.next_consult && daysBetween(today, p.next_consult) <= 7)
    .sort((a, b) => (a.next_consult + (a.next_time || '')).localeCompare(b.next_consult + (b.next_time || ''))), [patients]);

  const list = useMemo(() => {
    const nq = norm(q);
    return (patients || [])
      .filter((p) => (filter === 'todos' ? true : filter === 'inativos' ? p.status === 'inativo' : p.status === 'ativo'))
      .filter((p) => !nq || norm(p.name).includes(nq))
      .sort((a, b) => (b.last_consult || '').localeCompare(a.last_consult || '') || a.name.localeCompare(b.name));
  }, [patients, q, filter]);

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!patients) return html`<${Loading} />`;

  return html`
    <div class="page-head">
      <h1>Pacientes</h1>
      <button class="btn btn-primary" onClick=${() => setShowNew(true)}>+ Cadastro rápido</button>
    </div>

    <div class="search">
      <span>🔍</span>
      <input type="search" placeholder="Buscar paciente por nome…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
    </div>

    ${patients.length === 0 && html`
      <div class="card empty">
        <h2>Nenhum paciente ainda</h2>
        <p>Comece importando a planilha do Nutrium. Ela traz todos os pacientes, as consultas e os pesos.</p>
        <a class="btn btn-primary" href="#/importar">Importar planilha do Nutrium</a>
      </div>`}

    ${!q && upcoming.length > 0 && html`
      <section class="card">
        <h2 class="card-title">📅 Próximas consultas <span class="muted small">(pela planilha do Nutrium — a agenda do Google entra na Fase 3)</span></h2>
        <table class="table">
          <thead><tr><th>Quando</th><th>Paciente</th><th>Última consulta</th><th>Dias passados</th></tr></thead>
          <tbody>
            ${upcoming.map((p) => html`
              <tr class="row-link" onClick=${() => go('/paciente/' + p.id)}>
                <td><strong>${dayLabel(p.next_consult)}</strong> ${p.next_time || ''}</td>
                <td>${p.name}</td>
                <td>${p.last_consult ? fmtDate(p.last_consult) : html`<span class="badge badge-blue">Primeira consulta</span>`}</td>
                <td>${daysAgoLabel(p.last_consult)}</td>
              </tr>`)}
          </tbody>
        </table>
      </section>`}

    ${patients.length > 0 && html`
      <section class="card">
        <div class="card-title-row">
          <h2 class="card-title">${q ? `Resultados para “${q}”` : 'Todos os pacientes'} <span class="muted small">(${list.length})</span></h2>
          <div class="seg">
            ${['ativos', 'inativos', 'todos'].map((f) => html`
              <button class=${filter === f ? 'on' : ''} onClick=${() => setFilter(f)}>${f[0].toUpperCase() + f.slice(1)}</button>`)}
          </div>
        </div>
        ${list.length === 0 && html`
          <p class="muted">Nenhum paciente encontrado.
            ${q && html` <button class="btn btn-sm" onClick=${() => setShowNew(true)}>Cadastrar “${q}”</button>`}
          </p>`}
        ${list.length > 0 && html`
          <table class="table">
            <thead><tr><th>Paciente</th><th>Última consulta</th><th>Dias passados</th><th class="hide-sm">Próxima</th></tr></thead>
            <tbody>
              ${list.map((p) => html`
                <tr class="row-link" onClick=${() => go('/paciente/' + p.id)}>
                  <td>
                    ${p.name}
                    ${!p.phone && html` <span class="badge badge-warn" title="Sem telefone: necessário para os questionários">sem telefone</span>`}
                    ${p.status === 'inativo' && html` <span class="badge">inativo</span>`}
                  </td>
                  <td>${p.last_consult ? fmtDate(p.last_consult) : '–'}</td>
                  <td class=${p.last_consult && daysBetween(p.last_consult, today) > 50 ? 'text-warn' : ''}>${daysAgoLabel(p.last_consult)}</td>
                  <td class="hide-sm">${p.next_consult ? fmtDate(p.next_consult) : ''}</td>
                </tr>`)}
            </tbody>
          </table>`}
      </section>`}

    ${showNew && html`<${NewPatientModal} initialName=${q} onClose=${() => setShowNew(false)} />`}`;
}

function NewPatientModal({ initialName, onClose }) {
  const [form, setForm] = useState({ name: initialName || '', birth_date: '', phone: '', sex: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const name = form.name.trim().replace(/\s+/g, ' ');
      const [row] = await run(supabase.from('patients').insert({
        name,
        name_norm: norm(name),
        birth_date: form.birth_date || null,
        phone: onlyDigits(form.phone) ? form.phone.trim() : null,
        sex: form.sex || null,
      }).select('id'));
      go('/paciente/' + row.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return html`
    <${Modal} title="Cadastro rápido" onClose=${onClose}>
      <form onSubmit=${save}>
        <${Field} label="Nome completo"><input required value=${form.name} onInput=${set('name')} autofocus /><//>
        <div class="grid-2">
          <${Field} label="Data de nascimento"><input type="date" required value=${form.birth_date} onInput=${set('birth_date')} /><//>
          <${Field} label="Sexo">
            <select value=${form.sex} onChange=${set('sex')}>
              <option value="">Não informado</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </select>
          <//>
        </div>
        <${Field} label="Telefone (WhatsApp)" hint="Com DDD. Ex.: 11 98765-4321">
          <input type="tel" value=${form.phone} onInput=${set('phone')} placeholder="11 98765-4321" />
        <//>
        <p class="muted small">O e-mail e os demais dados chegam na próxima importação da planilha do Nutrium.</p>
        <${ErrorBox} error=${error} />
        <div class="actions">
          <button type="button" class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" disabled=${busy}>${busy ? 'Salvando…' : 'Cadastrar'}</button>
        </div>
      </form>
    <//>`;
}
