// Quadro de consultas: visões Dia, Semana e Mês, com navegação, linha da hora atual e consultas clicáveis.
import { html, useState, useMemo, useEffect, useRef } from '../lib/preact.js';
import { fmtDate, todayISO, nowHM } from '../lib/util.js';
import { go } from './common.js';

const WEEKDAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const MONTHS_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const HOUR_PX = 84; // 30 minutos = 42 px: cabem horário e nome

const parse = (iso) => new Date(iso + 'T12:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
function addDays(isoDate, n) { const d = parse(isoDate); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
const weekday = (isoDate) => parse(isoDate).getUTCDay();
const startOfWeek = (isoDate) => addDays(isoDate, -weekday(isoDate)); // semana começa no domingo
const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Fim da consulta em minutos (sem fim: 1 hora depois do início). */
function endMin(ev) {
  if (ev.endTime && (!ev.endDate || ev.endDate === ev.start)) return Math.max(toMin(ev.endTime), toMin(ev.time) + 15);
  return toMin(ev.time) + 60;
}

/** Período exibido para cada visão. */
export function periodFor(view, anchor) {
  if (view === 'dia') return { from: anchor, to: anchor };
  if (view === 'semana') { const s = startOfWeek(anchor); return { from: s, to: addDays(s, 6) }; }
  const d = parse(anchor);
  const first = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)));
  const gridStart = startOfWeek(first);
  return { from: gridStart, to: addDays(gridStart, 41), month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

function title(view, anchor) {
  const p = periodFor(view, anchor);
  if (view === 'dia') { const d = parse(anchor); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS_FULL[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; }
  if (view === 'semana') {
    const a = parse(p.from); const b = parse(p.to);
    return a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()} – ${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]} de ${b.getUTCFullYear()}`
      : `${a.getUTCDate()} de ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
  }
  return `${MONTHS_FULL[p.month][0].toUpperCase() + MONTHS_FULL[p.month].slice(1)} de ${p.year}`;
}

/** Distribui consultas que se sobrepõem lado a lado. */
function layoutDay(evs) {
  const items = evs.filter((e) => e.time).map((e) => ({ ev: e, s: toMin(e.time), e: endMin(e) })).sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex((end) => end <= it.s);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.e;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = lanes.length;
    cluster = [];
  };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return items;
}

function EventBlock({ it, top, height, past, onOpen }) {
  const { ev } = it;
  const first = ev.patient && !ev.patient.last_consult;
  const cls = ['cal-ev', past ? 'past' : '', ev.patient ? '' : 'unlinked', height < 34 ? 'compact' : ''].join(' ');
  const w = 100 / it.lanes;
  return html`
    <button class=${cls} style=${`top:${top}px;height:${height}px;left:calc(${it.lane * w}% + 2px);width:calc(${w}% - 4px)`}
      title=${`${ev.time}–${fromMin(endMin(ev))} · ${ev.patient?.name || ev.patientName}${ev.patient ? '' : ' (não vinculado)'}`}
      onClick=${() => onOpen(ev)}>
      <span class="cal-ev-time">${ev.time}–${fromMin(endMin(ev))}${first ? html` <span class="cal-badge">1ª</span>` : ''}${ev.patient ? '' : ' ⚠️'}</span>
      <span class="cal-ev-name">${ev.patient?.name || ev.patientName}</span>
    </button>`;
}

function TimeGrid({ days, byDate, today, now, onOpen }) {
  const all = days.flatMap((d) => (byDate[d] || []).filter((e) => e.time));
  const startH = Math.min(7, ...all.map((e) => Math.floor(toMin(e.time) / 60)));
  const endH = Math.max(20, ...all.map((e) => Math.ceil(endMin(e) / 60)));
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const px = (m) => ((m - startH * 60) / 60) * HOUR_PX;
  const nowM = toMin(now);
  const scroller = useRef(null);
  useEffect(() => {
    // Abre rolado perto da hora atual (ou do início do expediente).
    if (scroller.current) scroller.current.scrollTop = Math.max(0, px(Math.max(nowM - 60, startH * 60)));
  }, [days[0]]);
  const allDay = days.some((d) => (byDate[d] || []).some((e) => !e.time));

  return html`
    <div class="cal-grid" style=${`--cols:${days.length}`}>
      <div class="cal-head">
        <div class="cal-gutter"></div>
        ${days.map((d) => html`
          <div class=${'cal-dayhead' + (d === today ? ' today' : '')}>
            <span>${WEEKDAYS[weekday(d)]}</span> <strong>${parse(d).getUTCDate()}/${String(parse(d).getUTCMonth() + 1).padStart(2, '0')}</strong>
          </div>`)}
      </div>
      ${allDay && html`
        <div class="cal-allday">
          <div class="cal-gutter small muted">dia todo</div>
          ${days.map((d) => html`<div>${(byDate[d] || []).filter((e) => !e.time).map((ev) => html`
            <button class=${'cal-chip' + (ev.patient ? '' : ' unlinked')} onClick=${() => onOpen(ev)}>${ev.patient?.name || ev.patientName}</button>`)}</div>`)}
        </div>`}
      <div class="cal-body" ref=${scroller}>
        <div class="cal-inner" style=${`height:${hours.length * HOUR_PX}px`}>
          <div class="cal-gutter">${hours.map((h) => html`<div class="cal-hour" style=${`top:${px(h * 60)}px`}>${String(h).padStart(2, '0')}:00</div>`)}</div>
          ${days.map((d) => html`
            <div class=${'cal-col' + (d === today ? ' today' : '')}>
              ${hours.map((h) => html`<div class="cal-line" style=${`top:${px(h * 60)}px`}></div>`)}
              ${layoutDay(byDate[d] || []).map((it) => {
                const past = d < today || (d === today && it.e <= nowM);
                return html`<${EventBlock} it=${it} top=${px(it.s)} height=${Math.max(22, px(it.e) - px(it.s) - 2)} past=${past} onOpen=${onOpen} />`;
              })}
              ${d === today && nowM >= startH * 60 && nowM <= endH * 60 && html`<div class="cal-now" style=${`top:${px(nowM)}px`}><span></span></div>`}
            </div>`)}
        </div>
      </div>
    </div>`;
}

function MonthGrid({ period, byDate, today, onOpen, onDay }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(period.from, i));
  return html`
    <div class="cal-month">
      ${WEEKDAYS.map((w) => html`<div class="cal-mhead">${w}</div>`)}
      ${days.map((d) => {
        const evs = (byDate[d] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const other = parse(d).getUTCMonth() !== period.month;
        return html`
          <div class=${'cal-mday' + (other ? ' other' : '') + (d === today ? ' today' : '')}>
            <button class="cal-mnum" onClick=${() => onDay(d)} title="Ver o dia">${parse(d).getUTCDate()}</button>
            ${evs.slice(0, 3).map((ev) => html`
              <button class=${'cal-chip' + (ev.patient ? '' : ' unlinked') + (d < today ? ' past' : '')} onClick=${() => onOpen(ev)}>
                ${ev.time ? ev.time + ' ' : ''}${ev.patient?.name || ev.patientName}
              </button>`)}
            ${evs.length > 3 && html`<button class="cal-more" onClick=${() => onDay(d)}>+${evs.length - 3} consulta(s)</button>`}
          </div>`;
      })}
    </div>`;
}

/**
 * events: consultas já vinculadas ({ start, time, endDate, endTime, patientName, patient, attendees }).
 * onUnlinked: chamado ao clicar numa consulta sem paciente vinculado.
 */
export function CalendarCard({ events, source, state, error, onRefresh, onUnlinked, onPeriod }) {
  const today = todayISO();
  const isPhone = typeof window !== 'undefined' && window.innerWidth < 700;
  const [view, setView] = useState(isPhone ? 'dia' : 'semana');
  const [anchor, setAnchor] = useState(today);
  const [now, setNow] = useState(nowHM());
  useEffect(() => { const t = setInterval(() => setNow(nowHM()), 60 * 1000); return () => clearInterval(t); }, []);

  const period = periodFor(view, anchor);
  useEffect(() => { onPeriod?.(period); }, [period.from, period.to]);
  const byDate = useMemo(() => {
    const m = {};
    for (const ev of events) if (ev.start >= period.from && ev.start <= period.to) (m[ev.start] ||= []).push(ev);
    return m;
  }, [events, period.from, period.to]);
  const count = Object.values(byDate).reduce((n, l) => n + l.length, 0);

  const step = (dir) => {
    if (view === 'dia') setAnchor(addDays(anchor, dir));
    else if (view === 'semana') setAnchor(addDays(anchor, 7 * dir));
    else { const d = parse(anchor); setAnchor(iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1, 12)))); }
  };
  const open = (ev) => (ev.patient ? go('/paciente/' + ev.patient.id) : onUnlinked(ev));
  const days = view === 'dia' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(period.from, i));

  return html`
    <section class="card cal-card">
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="btn btn-sm btn-ghost" aria-label="Anterior" onClick=${() => step(-1)}>‹</button>
          <button class="btn btn-sm" onClick=${() => setAnchor(today)}>Hoje</button>
          <button class="btn btn-sm btn-ghost" aria-label="Próximo" onClick=${() => step(1)}>›</button>
          <h2 class="cal-title">${title(view, anchor)}</h2>
        </div>
        <div class="cal-nav">
          ${state === 'loading' && html`<span class="muted small">Lendo a agenda…</span>`}
          ${source === 'google' && html`<button class="btn btn-sm btn-ghost" title="Ler a agenda de novo" onClick=${onRefresh}>↻</button>`}
          <div class="seg">${[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, l]) => html`
            <button class=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${l}</button>`)}</div>
        </div>
      </div>
      ${state === 'off' && html`<div class="alert">A agenda do Google ainda não está conectada: mostrando as consultas da planilha do Nutrium. <a href="#/config">Conectar agora</a></div>`}
      ${state === 'error' && html`<div class="alert alert-error">Não consegui ler a agenda do Google: ${error?.message || error}. Mostrando as consultas da planilha do Nutrium. <a href="#/config">Ver configurações</a></div>`}
      ${view === 'mes'
        ? html`<${MonthGrid} period=${period} byDate=${byDate} today=${today} onOpen=${open} onDay=${(d) => { setAnchor(d); setView('dia'); }} />`
        : html`<${TimeGrid} days=${days} byDate=${byDate} today=${today} now=${now} onOpen=${open} />`}
      <p class="muted small cal-foot">
        ${count} consulta(s) neste período · clique numa consulta para abrir a ficha
        ${events.some((e) => !e.patient && e.start >= period.from && e.start <= period.to) ? ' · ⚠️ = não vinculada (clique para vincular)' : ''}${' '}
        · <span class="cal-badge">1ª</span> primeira consulta
      </p>
    </section>`;
}
