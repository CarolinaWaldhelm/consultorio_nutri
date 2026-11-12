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
const toTs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromTs = (ts) => new Date(ts).toISOString().slice(0, 10);
const fmt = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** points: [{date, value, source}] ordenados por data. */
export function MetricChart({ label, unit, points }) {
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
      chart.current = new Chart(canvas.current, {
        type: 'line',
        data: {
          datasets: [{
            data,
            borderColor: SERIES,
            backgroundColor: SERIES,
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
  }, [points]);

  const last = points[points.length - 1];
  const first = points[0];
  const delta = points.length > 1 ? last.value - first.value : null;
  return html`
    <figure class="chart-card">
      <figcaption>
        <span class="chart-title">${label}</span>
        <span class="chart-last">${fmt(last.value)} ${unit}</span>
        ${delta != null && html`<span class="chart-delta">${delta > 0 ? '+' : ''}${fmt(delta)} desde ${fmtDate(first.date)}</span>`}
      </figcaption>
      <div class="chart-box"><canvas ref=${canvas} role="img" aria-label=${`Evolução de ${label}`}></canvas></div>
    </figure>`;
}
