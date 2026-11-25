import { html, render, useEffect, useLayoutEffect, useRef, useState } from '../lib/preact.js';

/**
 * Janela (modal). É desenhada direto no fim da página (fora do lugar onde foi aberta), para ficar sempre por cima
 * de tudo: nenhuma coluna, calendário ou cartão consegue aparecer na frente dela.
 */
export function Modal(props) {
  const host = useRef(null);
  if (!host.current && typeof document !== 'undefined') host.current = document.createElement('div');
  // useLayoutEffect: a janela aparece no mesmo instante do clique (antes de a tela ser redesenhada).
  useLayoutEffect(() => {
    document.body.appendChild(host.current);
    return () => { render(null, host.current); host.current.remove(); };
  }, []);
  useLayoutEffect(() => { render(html`<${ModalBox} ...${props} />`, host.current); });
  return null;
}

function ModalBox({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
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

const FIRST_PAGE = 15; // itens visíveis em cada lista
const PAGE_STEP = 10; // "Mostrar mais"
/** Lista com 15 itens, "Mostrar mais" de 10 em 10 e "Mostrar menos". Devolve [itens visíveis, botões]. */
export function usePaged(items, resetKey) {
  const [n, setN] = useState(FIRST_PAGE);
  useEffect(() => setN(FIRST_PAGE), [resetKey]);
  const more = items.length - n;
  const buttons = more > 0 || n > FIRST_PAGE
    ? html`
      <div class="show-more">
        ${more > 0 && html`<button class="btn btn-sm btn-ghost" onClick=${() => setN(n + PAGE_STEP)}>Mostrar mais ${Math.min(PAGE_STEP, more)} (faltam ${more})</button>`}
        ${n > FIRST_PAGE && html`<button class="btn btn-sm btn-ghost" onClick=${() => setN(FIRST_PAGE)}>Mostrar menos</button>`}
      </div>`
    : null;
  return [items.slice(0, n), buttons];
}

/** Botãozinho ao lado do nome: copia o nome do paciente (para colar na busca da Nutrium). */
export function CopyName({ name }) {
  const [ok, setOk] = useState(false);
  async function copy(e) {
    e.preventDefault(); e.stopPropagation();
    try { await navigator.clipboard.writeText(name); } catch { window.prompt('Copie o nome (Ctrl+C):', name); }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  }
  return html`<button type="button" class=${'copy-name' + (ok ? ' ok' : '')} title=${'Copiar o nome: ' + name} aria-label=${'Copiar o nome de ' + name} onClick=${copy}>${ok ? '✓ copiado' : '⧉'}</button>`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
function monthsBetween(fromYM, toYM) {
  const out = [];
  let [y, m] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

/**
 * Período das estatísticas: últimos 30 / 90 dias, um mês ou vários (de… até…) ou desde o início.
 * Devolve [{ from, to } (AAAA-MM-DD ou null), elemento]. firstISO: data mais antiga com dados (para a lista de meses).
 */
export function usePeriod(firstISO, today) {
  const curYM = today.slice(0, 7);
  const [mode, setMode] = useState('30');
  const [fromYM, setFromYM] = useState(curYM);
  const [toYM, setToYM] = useState(curYM);
  const startYM = (firstISO || today).slice(0, 7) < curYM ? (firstISO || today).slice(0, 7) : curYM;
  const months = monthsBetween(startYM, curYM).reverse();
  const minus = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const [a, b] = fromYM <= toYM ? [fromYM, toYM] : [toYM, fromYM];
  const range = mode === 'all' ? { from: null, to: null }
    : mode === 'mes' ? { from: `${a}-01`, to: lastDay(b) }
    : { from: minus(Number(mode)), to: null };
  const el = html`
    <div class="period-pick">
      <div class="seg">${[['30', '30 dias'], ['90', '90 dias'], ['mes', 'Por mês'], ['all', 'Desde o início']].map(([k, l]) => html`
        <button class=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${l}</button>`)}</div>
      ${mode === 'mes' && html`
        <span class="period-months">
          de <select value=${fromYM} onChange=${(e) => setFromYM(e.target.value)} aria-label="Mês inicial">${months.map((m) => html`<option value=${m}>${monthLabel(m)}</option>`)}</select>
          até <select value=${toYM} onChange=${(e) => setToYM(e.target.value)} aria-label="Mês final">${months.map((m) => html`<option value=${m}>${monthLabel(m)}</option>`)}</select>
        </span>`}
    </div>`;
  const key = `${mode}|${range.from}|${range.to}`;
  return [range, el, key];
}
