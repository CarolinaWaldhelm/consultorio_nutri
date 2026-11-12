import { html, render, useState, useEffect } from './lib/preact.js';
import { supabase } from './lib/db.js';
import { Loading } from './views/common.js';
import { Login } from './views/login.js';
import { Home } from './views/home.js';
import { PatientPage } from './views/patient.js';
import { ImportPage } from './views/import.js';
import { SettingsPage } from './views/settings.js';

function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'paciente' && parts[1]) return { name: 'patient', id: parts[1] };
  if (parts[0] === 'importar') return { name: 'import' };
  if (parts[0] === 'config') return { name: 'config' };
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
  else page = html`<${Home} />`;

  return html`
    <div class="topbar">
      <a class="brand" href="#/">🥗 Consultório Nutri</a>
      <nav>
        <a href="#/" class=${route.name === 'home' || route.name === 'patient' ? 'active' : ''}>Pacientes</a>
        <span class="nav-soon" title="Disponível na Fase 4">Questionários</span>
        <a href="#/importar" class=${route.name === 'import' ? 'active' : ''}>Importar Nutrium</a>
        <a href="#/config" class=${route.name === 'config' ? 'active' : ''}>⚙️ Configurações</a>
      </nav>
      <button class="btn btn-ghost btn-sm" onClick=${() => supabase.auth.signOut()}>Sair</button>
    </div>
    <main class="container">${page}</main>`;
}

render(html`<${App} />`, document.getElementById('app'));
