import { html, useEffect } from '../lib/preact.js';

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-label=${title}>
        <header class="modal-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Fechar">✕</button>
        </header>
        <div class="modal-body">${children}</div>
      </div>
    </div>`;
}

export function Field({ label, hint, children }) {
  return html`
    <label class="field">
      <span class="field-label">${label}</span>
      ${children}
      ${hint && html`<span class="field-hint">${hint}</span>`}
    </label>`;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return html`<div class="alert alert-error">${friendlyError(error)}</div>`;
}

export function friendlyError(error) {
  const msg = String(error?.message || error);
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (/schema cache|does not exist/i.test(msg)) {
    return 'O banco de dados ainda não foi configurado. Rode o arquivo supabase/schema.sql no SQL Editor do Supabase.';
  }
  return msg;
}

export function Loading({ text = 'Carregando…' }) {
  return html`<div class="loading">${text}</div>`;
}

/** Textarea que cresce conforme o conteúdo. */
export function AutoText({ value, onInput, rows = 2, placeholder }) {
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } };
  return html`
    <textarea
      rows=${rows}
      value=${value || ''}
      placeholder=${placeholder}
      ref=${grow}
      onInput=${(e) => { grow(e.target); onInput(e.target.value); }}
    ></textarea>`;
}

export function go(path) {
  location.hash = path;
}
