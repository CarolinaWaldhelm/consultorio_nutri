// Configurações: endereço secreto iCal do Google Agenda.
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate } from '../lib/util.js';
import { loadAgenda, clearAgendaCache, consultationEvents, windowDays } from '../lib/agenda.js';
import { ErrorBox, Loading } from './common.js';
import { downloadBackup } from '../lib/backup.js';

export function SettingsPage() {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [test, setTest] = useState(null);

  useEffect(() => {
    run(supabase.from('app_settings').select('*').eq('key', 'calendar_ics_url'))
      .then((rows) => setUrl(rows[0]?.value || ''))
      .catch((err) => { setError(err); setUrl(''); });
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      const clean = url.trim();
      if (clean && !/^https:\/\/calendar\.google\.com\/calendar\/ical\//.test(clean)) {
        throw new Error('Esse não parece ser o "Endereço secreto no formato iCal". Ele começa com https://calendar.google.com/calendar/ical/ e termina com .ics');
      }
      await run(supabase.from('app_settings').upsert({ key: 'calendar_ics_url', value: clean }));
      clearAgendaCache();
      if (clean) {
        const events = await loadAgenda({ force: true });
        const { from, to } = windowDays(30);
        const next = consultationEvents(events || [], from, to);
        setTest({ total: events?.length || 0, next });
      }
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  if (url == null) return html`<${Loading} />`;

  return html`
    <div class="page-head"><h1>Configurações</h1></div>
    <${ReportIdentity} />
    <section class="card">
      <h2 class="card-title">📅 Google Agenda</h2>
      <p>Para as consultas aparecerem na tela inicial, cole aqui o <strong>endereço secreto</strong> da agenda onde a Nutrium marca as consultas.</p>
      <ol class="steps">
        <li>Abra o <strong>Google Agenda</strong> no computador (calendar.google.com).</li>
        <li>Clique na <strong>engrenagem ⚙️</strong> (canto superior direito) → <strong>Configurações</strong>.</li>
        <li>Na coluna da esquerda, em <strong>“Configurações das minhas agendas”</strong>, clique na sua agenda.</li>
        <li>Desça até <strong>“Integrar agenda”</strong> e copie o <strong>“Endereço secreto no formato iCal”</strong> (clique no ícone de copiar).</li>
        <li>Cole abaixo e clique em <strong>Salvar e testar</strong>.</li>
      </ol>
      <p class="muted small">Esse endereço permite ler a agenda: não compartilhe com ninguém. O sistema só lê, nunca altera nada na agenda.</p>
      <form onSubmit=${save}>
        <label class="field">
          <span class="field-label">Endereço secreto no formato iCal</span>
          <input value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" />
        </label>
        <${ErrorBox} error=${error} />
        <div class="actions" style="justify-content:flex-start">
          <button class="btn btn-primary" disabled=${busy}>${busy ? 'Testando…' : 'Salvar e testar'}</button>
        </div>
      </form>
      ${test && html`
        <div class="alert">
          ✅ Agenda conectada: ${test.total} evento(s) lidos.
          ${test.next.length
            ? html` Próximas consultas encontradas (30 dias): <strong>${test.next.length}</strong>.
                <ul>${test.next.slice(0, 5).map((e) => html`<li>${fmtDate(e.start)} ${e.time || ''} — ${e.patientName}</li>`)}</ul>`
            : html` Nenhum evento “Consulta de nutrição – …” nos próximos 30 dias. Confira se é a agenda certa.`}
        </div>`}
    </section>
    <${StorageSection} />
    <${BackupSection} />`;
}

function BackupSection() {
  const [last, setLast] = useState(undefined);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    run(supabase.from('app_settings').select('*').eq('key', 'last_backup_at')).then((r) => setLast(r[0]?.value || null)).catch(() => setLast(null));
  }, []);

  async function go() {
    setError(null);
    setResult(null);
    try {
      const counts = await downloadBackup((t) => setBusy(t));
      setResult(counts);
      setLast(new Date().toISOString());
    } catch (err) {
      setError(err);
    }
    setBusy('');
  }

  return html`
    <section class="card">
      <h2 class="card-title">💾 Backup</h2>
      <p>O plano gratuito do Supabase não guarda cópias de segurança. Baixe um backup <strong>uma vez por semana</strong>
        e guarde o arquivo numa pasta do seu Google Drive (ou outro lugar seguro).</p>
      <p class="muted small">Último backup: ${last === undefined ? '…' : last ? fmtDate(last.slice(0, 10)) : 'nunca'}.
        O arquivo tem todos os dados (pacientes, consultas, medidas, cálculos, questionários e exames); os laudos anexados
        continuam no Supabase. O endereço secreto da agenda não vai para o arquivo.</p>
      <${ErrorBox} error=${error} />
      <div class="actions" style="justify-content:flex-start">
        <button class="btn btn-primary" disabled=${!!busy} onClick=${go}>${busy ? 'Preparando…' : '⬇️ Baixar backup agora'}</button>
        ${result && html`<span class="muted small">✓ Backup baixado: ${result.patients} paciente(s), ${result.consultations} consulta(s).</span>`}
      </div>
    </section>`;
}

const LIMIT_MB = 500; // banco de dados do plano gratuito do Supabase
const mb = (b) => (b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function StorageSection() {
  const [u, setU] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    supabase.rpc('db_usage').then(({ data, error: err }) => (err ? setError(err) : setU(data)));
  }, []);
  const pct = u ? Math.min(100, (u.db_bytes / (LIMIT_MB * 1024 * 1024)) * 100) : 0;
  return html`
    <section class="card">
      <h2 class="card-title">📦 Espaço usado</h2>
      <${ErrorBox} error=${error} />
      ${!u && !error && html`<p class="muted">Calculando…</p>`}
      ${u && html`
        <p><strong>${mb(u.db_bytes)} MB</strong> de ${LIMIT_MB} MB do plano gratuito (${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%).</p>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(pct)}><div style=${`width:${Math.max(pct, 1)}%`} class=${pct > 80 ? 'warn' : ''}></div></div>
        <p class="muted small">Os seus dados (${u.patients} paciente(s)) ocupam ${mb(u.data_bytes)} MB; o restante é a estrutura fixa do próprio banco.
          Texto ocupa pouquíssimo espaço: cada paciente acompanhado por um ano usa cerca de 0,2 a 0,5 MB.</p>`}
    </section>`;
}

// ---------------------------------------------------------------- Identidade do relatório em PDF
// Logo e dados do rodapé ficam no banco (app_settings), não no código (o repositório é público).
export const REPORT_KEYS = ['report_logo', 'report_name', 'report_title', 'report_crn', 'report_instagram', 'report_contact'];

/** Reduz a imagem para no máximo 480 px (PNG, mantém o fundo transparente). */
function shrinkImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem. Use um arquivo PNG ou JPG.'));
    img.src = URL.createObjectURL(file);
  });
}

function ReportIdentity() {
  const [v, setV] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    run(supabase.from('app_settings').select('*').in('key', REPORT_KEYS))
      .then((rows) => { const m = Object.fromEntries(rows.map((r) => [r.key, r.value])); setV({ report_title: 'Nutricionista', ...m }); })
      .catch((err) => { setError(err); setV({}); });
  }, []);
  if (!v) return null;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function pickLogo(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try { setV({ ...v, report_logo: await shrinkImage(f) }); } catch (err) { setError(err); }
    e.target.value = '';
  }
  async function save() {
    setError(null);
    try {
      await run(supabase.from('app_settings').upsert(REPORT_KEYS.map((k) => ({ key: k, value: (v[k] || '').trim ? (v[k] || '').trim() : v[k] || '' }))));
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err); }
  }
  const footer = [v.report_name, v.report_title, v.report_crn && `CRN ${v.report_crn}`, v.report_instagram, v.report_contact].filter(Boolean).join(' · ');
  return html`
    <section class="card">
      <h2 class="card-title">🖨️ Relatório em PDF: sua identidade</h2>
      <p class="muted small" style="margin-top:0">A logo e estes dados aparecem no relatório que você gera na ficha do paciente (logo no topo, dados no rodapé de cada página).</p>
      <div class="identity-grid">
        <div class="identity-logo">
          ${v.report_logo ? html`<img src=${v.report_logo} alt="Sua logo" />` : html`<div class="muted small">Sem logo</div>`}
          <label class="btn btn-sm">📁 ${v.report_logo ? 'Trocar logo' : 'Enviar logo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange=${pickLogo} hidden /></label>
          ${v.report_logo && html`<button class="btn btn-sm btn-ghost" onClick=${() => setV({ ...v, report_logo: '' })}>Tirar logo</button>`}
        </div>
        <div>
          <label class="field"><span class="field-label">Nome</span><input value=${v.report_name || ''} onInput=${set('report_name')} placeholder="Seu nome como quer que apareça" /></label>
          <div class="grid-2">
            <label class="field"><span class="field-label">Profissão</span><input value=${v.report_title || ''} onInput=${set('report_title')} /></label>
            <label class="field"><span class="field-label">CRN (só o número)</span><input value=${v.report_crn || ''} onInput=${set('report_crn')} /></label>
            <label class="field"><span class="field-label">Instagram</span><input value=${v.report_instagram || ''} onInput=${set('report_instagram')} placeholder="@seuperfil" /></label>
            <label class="field"><span class="field-label">Outro contato (opcional)</span><input value=${v.report_contact || ''} onInput=${set('report_contact')} placeholder="WhatsApp, site…" /></label>
          </div>
          ${footer && html`<p class="muted small">Rodapé: <strong>${footer}</strong></p>`}
        </div>
      </div>
      <${ErrorBox} error=${error} />
      <div class="actions" style="justify-content:flex-start">
        <button class="btn btn-primary" onClick=${save}>💾 Salvar</button>
        ${saved && html`<span class="muted small">✓ Salvo</span>`}
      </div>
    </section>`;
}
