// Gráfico de linha de uma medida ao longo do tempo (uma série por gráfico).
import { html, useEffect, useRef } from '../lib/preact.js';
import { fmtDate } from '../lib/util.js';

const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm';
let chartLib = null;
async function loadChart() {
  if (!chartLib) {
    const m = await import(CHART_URL);
    m.Chart.register(...m.registerables);
    chartLib = m.Chart;
  }
  return chartLib;
}

const SERIES = '#1f9d63'; // validado (dataviz): faixa de luminosidade, croma e contraste
const INK = '#6b766f';
const GRID = '#eef1ee';
// Com muitos registros (ex.: paciente que se pesa todo dia), o gráfico mostra os pontos bem clarinhos e, por cima,
// uma linha suave com a média de 7 dias — fica fluido sem esconder nenhum registro.
const MANY = 15;
const DAY = 86400000;
/** Média móvel de 7 dias (3 dias antes e 3 depois de cada data). */
function movingAverage(data) {
  return data.map((d) => {
    const win = data.filter((o) => Math.abs(o.x - d.x) <= 3 * DAY);
    return { x: d.x, y: win.reduce((a, o) => a + o.y, 0) / win.length };
  });
}
/** Cor com transparência (#rrggbb → rgba). */
function fade(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const toTs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromTs = (ts) => new Date(ts).toISOString().slice(0, 10);
const fmt = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** points: [{date, value, source}] ordenados por data. */
export function MetricChart({ label, unit, points, color = SERIES }) {
  const canvas = useRef(null);
  const chart = useRef(null);

  useEffect(() => {
    let alive = true;
    loadChart().then((Chart) => {
      if (!alive || !canvas.current) return;
      chart.current?.destroy();
      const data = points.map((p) => ({ x: toTs(p.date), y: p.value, source: p.source }));
      const xs = data.map((d) => d.x);
      const pad = xs.length > 1 ? 0 : 15 * 86400000;
      const many = data.length > MANY;
      const avg = many ? movingAverage(data) : null;
      const raw = many
        ? [{ data, label: 'registro', borderColor: fade(color, 0.22), backgroundColor: fade(color, 0.35), borderWidth: 1, pointRadius: 1.6,
            pointHoverRadius: 5, pointBorderWidth: 0, pointHitRadius: 8, spanGaps: true, tension: 0, order: 2 }]
        : [];
      chart.current = new Chart(canvas.current, {
        type: 'line',
        data: {
          datasets: many ? [...raw, {
            data: avg,
            label: 'média de 7 dias',
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2.5,
            borderCapStyle: 'round',
            borderJoinStyle: 'round',
            pointRadius: avg.map((_, i) => (i === 0 || i === avg.length - 1 ? 4 : 0)),
            pointHoverRadius: 0,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointHitRadius: 0,
            tension: 0.4,
            order: 1,
          }] : [{
            data,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            borderCapStyle: 'round',
            borderJoinStyle: 'round',
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointHitRadius: 14,
            spanGaps: true,
            tension: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1f2a24',
              displayColors: false,
              filter: (item) => !many || item.datasetIndex === 0, // com muitos registros, mostra o registro do dia
              callbacks: {
                title: (items) => fmtDate(fromTs(items[0].parsed.x)),
                label: (item) => `${fmt(item.parsed.y)} ${unit}` + (item.raw.source === 'nutrium_app' ? ' (app do paciente)' : ''),
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              min: Math.min(...xs) - pad,
              max: Math.max(...xs) + pad,
              grid: { display: false },
              border: { color: GRID },
              ticks: { color: INK, maxTicksLimit: 5, callback: (v) => fmtDate(fromTs(v)).slice(0, 5) + '/' + fromTs(v).slice(2, 4) },
            },
            y: {
              grace: '10%',
              grid: { color: GRID },
              border: { display: false },
              ticks: { color: INK, maxTicksLimit: 4, callback: (v) => fmt(v) },
            },
          },
        },
      });
    });
    return () => { alive = false; chart.current?.destroy(); chart.current = null; };
  }, [points, color]);

  const last = points[points.length - 1];
  const first = points[0];
  const delta = points.length > 1 ? last.value - first.value : null;
  return html`
    <figure class="chart-card">
      <figcaption>
        <span class="chart-title">${label}</span>
        <span class="chart-last">${fmt(last.value)} ${unit}</span>
        ${delta != null && html`<span class="chart-delta">${delta > 0 ? '+' : ''}${fmt(delta)} desde ${fmtDate(first.date)}</span>`}
        ${points.length > MANY && html`<span class="chart-note">linha: média de 7 dias · pontinhos: cada registro</span>`}
      </figcaption>
      <div class="chart-box"><canvas ref=${canvas} role="img" aria-label=${`Evolução de ${label}`}></canvas></div>
    </figure>`;
}
