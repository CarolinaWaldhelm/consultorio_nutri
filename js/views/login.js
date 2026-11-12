import { html, useState } from '../lib/preact.js';
import { supabase } from '../lib/db.js';
import { ErrorBox, Field } from './common.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error);
    setBusy(false);
  }

  return html`
    <div class="login-wrap">
      <form class="card login-card" onSubmit=${submit}>
        <h1>🥗 Consultório Nutri</h1>
        <p class="muted">Entre com o e-mail e a senha cadastrados no Supabase.</p>
        <${Field} label="E-mail">
          <input type="email" required autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} />
        <//>
        <${Field} label="Senha">
          <input type="password" required autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} />
        <//>
        <${ErrorBox} error=${error} />
        <button class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>`;
}
