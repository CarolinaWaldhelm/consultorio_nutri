import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import {
  fmtDate, daysAgoLabel, ageFrom, todayISO, patientCode, latestOf, classifyBMI, norm, onlyDigits,
  SEX_LABEL, SOURCE_LABEL, OBJECTIVE_LABEL, unique,
} from '../lib/util.js';
import { Modal, Field, ErrorBox, Loading, go } from './common.js';
import { AnamnesisDrawer, FIELDS, TYPE_LABEL } from './anamnesis.js';
import { SummaryCard } from './summary.js';
import { BodyCard, MeasurementModal } from './body.js';
import { CalcCard } from './calc.js';

export function PatientPage({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [measuring, setMeasuring] = useState(false);

  async function load() {
    try {
      const [patient, consultations, appointments, measurements, calculations, settingsRows] = await Promise.all([
        run(supabase.from('patients').select('*').eq('id', id).single()),
        run(supabase.from('consultations').select('*').eq('patient_id', id).order('date', { ascending: false }).order('created_at', { ascending: false })),
        run(supabase.from('nutrium_appointments').select('*').eq('patient_id', id).order('date', { ascending: false })),
        run(supabase.from('measurements').select('*').eq('patient_id', id).order('date', { ascending: false })),
        run(supabase.from('calculations').select('*').eq('patient_id', id).order('created_at', { ascending: false })),
        run(supabase.from('app_settings').select('*')),
      ]);
      const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
      setData({ patient, consultations, appointments, measurements, calculations, settings });
    } catch (err) {
      setError(err);
    }
  }
  useEffect(() => { load(); }, [id]);

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;

  const { patient, consultations, appointments, measurements } = data;
  const today = todayISO();
  const pastAppts = appointments.filter((a) => a.date < today);
  const futureAppts = appointments.filter((a) => a.date >= today).reverse();
  const lastConsult = [consultations.find((c) => c.date <= today)?.date, pastAppts[0]?.date]
    .filter(Boolean).sort().pop() || null;
  const open = consultations.find((c) => c.id === openId);

  // Primeira consulta = nenhuma consulta anterior a essa data (no software ou no Nutrium).
  const typeFor = (date) =>
    consultations.some((c) => c.date < date) || appointments.some((a) => a.date < date) ? 'retorno' : 'inicial';

  async function createConsultation(date, type) {
    const same = consultations.find((c) => c.date === date);
    if (same) { setOpenId(same.id); setCreating(false); return; }
    const previous = consultations.filter((c) => c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    try {
      const [row] = await run(supabase.from('consultations').insert({
        patient_id: id,
        date,
        type,
        objective: previous?.objective ?? null,
        anamnesis: {},
      }).select('*'));
      setData((d) => ({
        ...d,
        consultations: [row, ...d.consultations].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
      }));
      setCreating(false);
      setOpenId(row.id);
    } catch (err) {
      alert('Não foi possível criar a consulta: ' + (err.message || err));
    }
  }

  const startConsultation = () => createConsultation(today, typeFor(today));

  const replaceConsultation = (next) => setData((d) => ({
    ...d,
    consultations: d.consultations.map((c) => (c.id === next.id ? next : c))
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
  }));

  return html`
    <div class=${openId ? 'with-drawer' : ''}>
      <a class="back" href="#/">← Pacientes</a>
      <${Header}
        patient=${patient}
        lastConsult=${lastConsult}
        nextAppt=${futureAppts[0]}
        hasConsultations=${consultations.length > 0}
        onStart=${startConsultation}
        onPast=${() => { setOpenId(null); setCreating(true); }}
        onOpenNotes=${() => setOpenId(consultations[0]?.id)}
        onEdit=${() => setEditing(true)}
      />
      <${SummaryCard} data=${data} />
      <${BodyCard}
        measurements=${measurements}
        age=${ageFrom(patient.birth_date)}
        onAdd=${() => setMeasuring(true)}
        onDeleted=${(ids) => setData((d) => ({ ...d, measurements: d.measurements.filter((m) => !ids.includes(m.id)) }))}
      />
      <${CalcCard}
        key=${calcKey(data)}
        patient=${patient}
        measurements=${measurements}
        consultations=${consultations}
        calculations=${data.calculations}
        settings=${data.settings}
        onSaved=${(row) => setData((d) => ({ ...d, calculations: [row, ...d.calculations] }))}
        onDeleted=${(cid) => setData((d) => ({ ...d, calculations: d.calculations.filter((c) => c.id !== cid) }))}
        onSettingsSaved=${(settings) => setData((d) => ({ ...d, settings }))}
      />
      <${History} consultations=${consultations} openId=${openId} onOpen=${setOpenId} />
      <${NutriumAppointments} past=${pastAppts} future=${futureAppts} />
    </div>

    ${open && html`
      <${AnamnesisDrawer}
        key=${open.id}
        consultation=${open}
        patientName=${patient.name}
        otherDates=${consultations.filter((c) => c.id !== open.id).map((c) => c.date)}
        onNew=${() => { setOpenId(null); setCreating(true); }}
        onSaved=${replaceConsultation}
        onDeleted=${(cid) => { setOpenId(null); setData((d) => ({ ...d, consultations: d.consultations.filter((c) => c.id !== cid) })); }}
        onClose=${() => setOpenId(null)}
      />`}

    ${measuring && html`
      <${MeasurementModal}
        patientId=${id}
        onClose=${() => setMeasuring(false)}
        onSaved=${(rows, metrics, date) => {
          setMeasuring(false);
          setData((d) => ({
            ...d,
            measurements: [...rows, ...d.measurements.filter((m) => !(m.source === 'consulta' && m.date === date && metrics.includes(m.metric)))]
              .sort((a, b) => b.date.localeCompare(a.date)),
          }));
        }}
      />`}

    ${creating && html`
      <${NewConsultationModal}
        typeFor=${typeFor}
        existingDates=${consultations.map((c) => c.date)}
        onCreate=${createConsultation}
        onClose=${() => setCreating(false)}
      />`}

    ${editing && html`
      <${EditPatientModal}
        patient=${patient}
        onClose=${() => setEditing(false)}
        onSaved=${(p) => { setData({ ...data, patient: p }); setEditing(false); }}
      />`}`;
}

function Header({ patient, lastConsult, nextAppt, hasConsultations, onStart, onPast, onOpenNotes, onEdit }) {
  const age = ageFrom(patient.birth_date);
  return html`
    <section class="card patient-head">
      <div class="patient-id">
        <h1>${patient.name}</h1>
        <div class="muted">
          ${patientCode(patient.code)}
          ${age != null && html` · ${age} anos`}
          ${patient.birth_date && html` · nasc. ${fmtDate(patient.birth_date)}`}
          ${patient.sex && html` · ${SEX_LABEL[patient.sex]}`}
        </div>
        <div class="patient-contact">
          ${patient.phone
            ? html`<span>📞 ${patient.phone}</span>`
            : html`<button class="badge badge-warn as-link" onClick=${onEdit}>📞 Adicionar telefone</button>`}
          ${patient.email_primary && !patient.email_primary.endsWith('@patients.nutrium.com') && html`<span>✉️ ${patient.email_primary}</span>`}
        </div>
        <div class="patient-status">
          <span><strong>Última consulta:</strong> ${lastConsult ? `${fmtDate(lastConsult)} (${daysAgoLabel(lastConsult).toLowerCase()})` : 'nenhuma'}</span>
          ${nextAppt && html`<span><strong>Próxima:</strong> ${fmtDate(nextAppt.date)} ${nextAppt.start_time || ''}</span>`}
          ${patient.status === 'inativo' && html`<span class="badge">Inativo</span>`}
          <span class=${'badge ' + (patient.questionnaires_active ? 'badge-green' : '')}>
            Questionários: ${patient.questionnaires_active ? 'ativos' : 'pausados'}
          </span>
        </div>
      </div>
      <div class="patient-actions">
        <button class="btn btn-primary" onClick=${onStart}>▶ Iniciar consulta de hoje</button>
        <button class="btn" onClick=${onPast}>➕ Registrar consulta em outra data</button>
        ${hasConsultations && html`<button class="btn" onClick=${onOpenNotes}>📋 Painel de anotações</button>`}
        <button class="btn btn-ghost" onClick=${onEdit}>✏️ Editar cadastro</button>
      </div>
    </section>`;
}

// O motor de cálculos é recriado quando mudam as medidas usadas como entrada ou o cadastro (sexo, nascimento).
function calcKey({ patient, measurements }) {
  const ids = measurements.filter((m) => ['peso', 'altura', 'massa_magra'].includes(m.metric)).map((m) => m.id).join(',');
  return `${patient.sex}|${patient.birth_date}|${ids}`;
}

function History({ consultations, openId, onOpen }) {
  const [expanded, setExpanded] = useState(null);
  return html`
    <section class="card">
      <h2 class="card-title">🗂️ Histórico de anamneses</h2>
      ${consultations.length === 0 && html`<p class="muted">Nenhuma consulta registrada no software ainda. Use “Iniciar consulta”.</p>`}
      <ul class="history">
        ${consultations.map((c) => {
          const isOpen = expanded === c.id;
          const filled = FIELDS[c.type].filter(([k]) => (k === '@objetivo' ? c.objective : c.anamnesis[k]?.trim()));
          return html`
            <li class=${'history-item' + (openId === c.id ? ' editing' : '')}>
              <div class="history-row" onClick=${() => setExpanded(isOpen ? null : c.id)}>
                <span>${isOpen ? '▾' : '▸'} <strong>${fmtDate(c.date)}</strong> · ${TYPE_LABEL[c.type]}</span>
                <span class="muted small">${filled.length} campo(s) preenchido(s)</span>
              </div>
              ${isOpen && html`
                <div class="history-body">
                  ${filled.length === 0 && html`<p class="muted">Sem anotações.</p>`}
                  ${filled.map(([k, label]) => k === '@objetivo'
                    ? html`<div class="qa"><div class="qa-q">Objetivo</div><div class="qa-a">${OBJECTIVE_LABEL[c.objective]}</div></div>`
                    : html`<div class="qa"><div class="qa-q">${label}</div><div class="qa-a">${c.anamnesis[k]}</div></div>`)}
                  <button class="btn btn-sm" onClick=${() => onOpen(c.id)}>✏️ Editar no painel</button>
                </div>`}
            </li>`;
        })}
      </ul>
    </section>`;
}

function NutriumAppointments({ past, future }) {
  if (!past.length && !future.length) return null;
  return html`
    <section class="card">
      <h2 class="card-title">📆 Consultas no Nutrium</h2>
      ${future.length > 0 && html`<p><strong>Agendadas:</strong> ${future.map((a) => `${fmtDate(a.date)} ${a.start_time || ''}`).join(' · ')}</p>`}
      ${past.length > 0 && html`<p class="muted"><strong>Anteriores (${past.length}):</strong> ${past.map((a) => fmtDate(a.date)).join(' · ')}</p>`}
    </section>`;
}

function EditPatientModal({ patient, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: patient.name || '',
    birth_date: patient.birth_date || '',
    sex: patient.sex || '',
    phone: patient.phone || '',
    email_primary: patient.email_primary || '',
    status: patient.status,
    questionnaires_active: patient.questionnaires_active,
    notes: patient.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const name = form.name.trim().replace(/\s+/g, ' ');
      const email = form.email_primary.trim().toLowerCase() || null;
      const [row] = await run(supabase.from('patients').update({
        ...form,
        name,
        name_norm: norm(name),
        birth_date: form.birth_date || null,
        sex: form.sex || null,
        phone: onlyDigits(form.phone) ? form.phone.trim() : null,
        email_primary: email,
        emails: unique([email, ...(patient.emails || [])]),
        notes: form.notes || null,
        inactive_reason: form.status === patient.status ? patient.inactive_reason ?? null : null,
      }).eq('id', patient.id).select('*'));
      onSaved(row);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Apagar ${patient.name} e TODO o histórico (consultas, anotações, medidas)? Isso não pode ser desfeito.`)) return;
    await run(supabase.from('patients').delete().eq('id', patient.id));
    go('/');
  }

  return html`
    <${Modal} title="Editar cadastro" onClose=${onClose}>
      <form onSubmit=${save}>
        <${Field} label="Nome completo"><input required value=${form.name} onInput=${set('name')} /><//>
        <div class="grid-2">
          <${Field} label="Data de nascimento"><input type="date" value=${form.birth_date} onInput=${set('birth_date')} /><//>
          <${Field} label="Sexo" hint="Usado nas fórmulas de gasto energético">
            <select value=${form.sex} onChange=${set('sex')}>
              <option value="">Não informado</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </select>
          <//>
        </div>
        <div class="grid-2">
          <${Field} label="Telefone (WhatsApp)"><input type="tel" value=${form.phone} onInput=${set('phone')} placeholder="11 98765-4321" /><//>
          <${Field} label="E-mail principal"><input type="email" value=${form.email_primary} onInput=${set('email_primary')} /><//>
        </div>
        <div class="grid-2">
          <${Field} label="Situação">
            <select value=${form.status} onChange=${set('status')}>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          <//>
          <label class="field checkbox">
            <input type="checkbox" checked=${form.questionnaires_active} onChange=${set('questionnaires_active')} />
            <span>Enviar questionários</span>
          </label>
        </div>
        <${Field} label="Observações gerais"><textarea rows="3" value=${form.notes} onInput=${set('notes')}></textarea><//>
        ${patient.emails?.length > 1 && html`<p class="muted small">Outros e-mails (contas antigas do Nutrium): ${patient.emails.filter((e) => e !== patient.email_primary).join(', ')}</p>`}
        <${ErrorBox} error=${error} />
        <div class="actions">
          <button type="button" class="btn btn-danger-ghost" onClick=${remove}>Apagar paciente</button>
          <span class="spacer"></span>
          <button type="button" class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" disabled=${busy}>${busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    <//>`;
}

function NewConsultationModal({ typeFor, existingDates, onCreate, onClose }) {
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState(typeFor(todayISO()));
  const [busy, setBusy] = useState(false);
  const exists = existingDates.includes(date);

  function pick(value) {
    setDate(value);
    if (value) setType(typeFor(value));
  }

  async function submit(e) {
    e.preventDefault();
    if (!date) return;
    setBusy(true);
    await onCreate(date, type);
    setBusy(false);
  }

  return html`
    <${Modal} title="Registrar consulta" onClose=${onClose}>
      <form onSubmit=${submit}>
        <p class="muted">Use para lançar consultas que já aconteceram, cada uma na sua data. Cada consulta fica
          separada no histórico de anamneses.</p>
        <div class="grid-2">
          <${Field} label="Data da consulta">
            <input type="date" required max=${todayISO()} value=${date} onInput=${(e) => pick(e.target.value)} />
          <//>
          <${Field} label="Tipo">
            <select value=${type} onChange=${(e) => setType(e.target.value)}>
              <option value="inicial">Primeira consulta</option>
              <option value="retorno">Retorno</option>
            </select>
          <//>
        </div>
        ${exists && html`<div class="alert">Já existe uma consulta nessa data. Ao continuar, ela será aberta para edição.</div>`}
        <div class="actions">
          <button type="button" class="btn" onClick=${onClose}>Cancelar</button>
          <button class="btn btn-primary" disabled=${busy || !date}>${exists ? 'Abrir consulta' : 'Criar e abrir anotações'}</button>
        </div>
      </form>
    <//>`;
}
