import { html, render, useState, useEffect } from './lib/preact.js';
import { supabase } from './lib/db.js';
import { Loading } from './views/common.js';
import { Login } from './views/login.js';
import { Home } from './views/home.js';
import { PatientPage } from './views/patient.js';
import { ImportPage } from './views/import.js';
import { SettingsPage } from './views/settings.js';
import { QuestionnairesPage } from './views/questionnaires.js';
import { AppointmentsPage } from './views/appointments.js';
import { RecommendationsPage } from './views/recommendations.js';

function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'paciente' && parts[1]) return { name: 'patient', id: parts[1] };
  if (parts[0] === 'importar') return { name: 'import' };
  if (parts[0] === 'config') return { name: 'config' };
  if (parts[0] === 'questionarios') return { name: 'questionnaires' };
  if (parts[0] === 'recomendacoes') return { name: 'recommendations' };
  if (parts[0] === 'lembretes') return { name: 'appointments', tab: parts[1] || null };
  return { name: 'home' };
}

function App() {
  const [session, setSession] = useState(undefined);
  const [route, setRoute] = useState(parseRoute(location.hash));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    const onHash = () => { setRoute(parseRoute(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash); };
  }, []);

  if (session === undefined) return html`<${Loading} />`;
  if (!session) return html`<${Login} />`;

  let page;
  if (route.name === 'patient') page = html`<${PatientPage} key=${route.id} id=${route.id} />`;
  else if (route.name === 'import') page = html`<${ImportPage} />`;
  else if (route.name === 'config') page = html`<${SettingsPage} />`;
  else if (route.name === 'questionnaires') page = html`<${QuestionnairesPage} />`;
  else if (route.name === 'recommendations') page = html`<${RecommendationsPage} />`;
  else if (route.name === 'appointments') page = html`<${AppointmentsPage} key=${route.tab || ''} initialTab=${route.tab || 'enviar'} />`;
  else page = html`<${Home} />`;

  return html`
    <div class="topbar">
      <a class="brand" href="#/">🥗 Consultório Nutri</a>
      <nav>
        <a href="#/lembretes" class=${route.name === 'appointments' ? 'active' : ''}>Lembretes de consulta</a>
        <a href="#/questionarios" class=${route.name === 'questionnaires' ? 'active' : ''}>Questionários</a>
        <a href="#/recomendacoes" class=${route.name === 'recommendations' ? 'active' : ''}>Recomendações</a>
        <a href="#/importar" class=${route.name === 'import' ? 'active' : ''}>Importar Nutrium</a>
        <a href="#/config" class=${route.name === 'config' ? 'active' : ''}>⚙️ Configurações</a>
      </nav>
      <button class="btn btn-ghost btn-sm" onClick=${() => supabase.auth.signOut()}>Sair</button>
    </div>
    <main class=${'container' + (route.name !== 'patient' ? ' wide' : '')}>${page}</main>`;
}

render(html`<${App} />`, document.getElementById('app'));
