// Configurações: endereço secreto iCal do Google Agenda.
import { html, useState, useEffect } from '../lib/preact.js';
import { supabase, run } from '../lib/db.js';
import { fmtDate } from '../lib/util.js';
import { loadAgenda, clearAgendaCache, consultationEvents, windowDays } from '../lib/agenda.js';
import { ErrorBox, Loading } from './common.js';

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
    </section>`;
}
