/* Chart.js chart rendering — 4 charts on the Dashboard */

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#adb5bd', font: { size: 11 } } },
    tooltip: { bodyColor: '#e0e0e0', titleColor: '#e0e0e0', backgroundColor: '#1a1d27', borderColor: '#2a2d3a', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6c757d', font: { size: 10 }, maxTicksLimit: 14 }, grid: { color: '#1f2230' } },
    y: { ticks: { color: '#6c757d', font: { size: 10 } }, grid: { color: '#1f2230' } },
  },
};

let charts = {};

function destroyAll() {
  Object.values(charts).forEach(c => c && c.destroy());
  charts = {};
}

function makeLabels(entries) {
  return entries.map(e => e.date);
}

/* ── SE Line Chart ───────────────────────────────────────────────── */
function renderSeChart(entries) {
  const ctx = document.getElementById('chart-se').getContext('2d');
  if (charts.se) charts.se.destroy();

  const labels = makeLabels(entries);
  const seData = entries.map(e => e.sleep_efficiency);

  charts.se = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'SE %',
        data: seData,
        borderColor: '#0dcaf0',
        backgroundColor: 'rgba(13,202,240,0.08)',
        pointBackgroundColor: seData.map(v => v >= 85 ? '#4fc38a' : v >= 75 ? '#f0ad4e' : '#e05c5c'),
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ...CHART_DEFAULTS.scales.y,
          min: 0,
          max: 100,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v}%` },
        },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: undefined,
      },
    },
  });
}

/* ── TST Bar Chart ───────────────────────────────────────────────── */
function renderTstChart(entries) {
  const ctx = document.getElementById('chart-tst').getContext('2d');
  if (charts.tst) charts.tst.destroy();

  const labels = makeLabels(entries);
  const tstData = entries.map(e => +(e.tst_minutes / 60).toFixed(2));

  charts.tst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'TST (hrs)',
        data: tstData,
        backgroundColor: 'rgba(13,202,240,0.5)',
        borderColor: '#0dcaf0',
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ...CHART_DEFAULTS.scales.y,
          min: 0,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v}h` },
        },
      },
    },
  });
}

/* ── SOL + WASO Stacked Bar Chart ────────────────────────────────── */
function renderSolWasoChart(entries) {
  const ctx = document.getElementById('chart-sol-waso').getContext('2d');
  if (charts.solwaso) charts.solwaso.destroy();

  const labels = makeLabels(entries);

  charts.solwaso = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'SOL (min)',
          data: entries.map(e => e.sol_minutes || 0),
          backgroundColor: 'rgba(240,173,78,0.65)',
          borderColor: '#f0ad4e',
          borderWidth: 1,
          borderRadius: 2,
          stack: 'stack0',
        },
        {
          label: 'WASO (min)',
          data: entries.map(e => e.waso_minutes || 0),
          backgroundColor: 'rgba(224,92,92,0.55)',
          borderColor: '#e05c5c',
          borderWidth: 1,
          borderRadius: 2,
          stack: 'stack0',
        },
        {
          label: 'TW (min)',
          data: entries.map(e => e.tw_minutes || 0),
          backgroundColor: 'rgba(160,90,200,0.5)',
          borderColor: '#a05ac8',
          borderWidth: 1,
          borderRadius: 2,
          stack: 'stack0',
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, stacked: true },
        y: { ...CHART_DEFAULTS.scales.y, stacked: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v}m` } },
      },
    },
  });
}

/* ── Sleep Quality Line Chart ────────────────────────────────────── */
function renderQualityChart(entries) {
  const ctx = document.getElementById('chart-quality').getContext('2d');
  if (charts.quality) charts.quality.destroy();

  const labels = makeLabels(entries);
  const qData = entries.map(e => e.sleep_quality ?? 0);

  charts.quality = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Quality (0–4)',
        data: qData,
        borderColor: '#4fc38a',
        backgroundColor: 'rgba(79,195,138,0.08)',
        pointBackgroundColor: '#4fc38a',
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ...CHART_DEFAULTS.scales.y,
          min: 0,
          max: 4,
          ticks: {
            ...CHART_DEFAULTS.scales.y.ticks,
            stepSize: 1,
            callback: v => ['VP', 'P', 'F', 'G', 'VG'][v] ?? v,
          },
        },
      },
    },
  });
}

/* ── TIB Composition Stacked Bar Chart ───────────────────────────── */
function renderTibCompositionChart(entries) {
  const ctx = document.getElementById('chart-tib-composition').getContext('2d');
  if (charts.tibComp) charts.tibComp.destroy();

  const labels = makeLabels(entries);
  const toHrs = m => +(( m || 0) / 60).toFixed(3);
  const fmtHm = m => { const h = Math.floor(m / 60); const mn = Math.round(m % 60); return `${h}h ${mn}m`; };

  charts.tibComp = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'TST (asleep)',
          data: entries.map(e => toHrs(e.tst_minutes)),
          backgroundColor: 'rgba(13,202,240,0.65)',
          borderColor: '#0dcaf0',
          borderWidth: 1,
          stack: 'tib',
        },
        {
          label: 'SOL (falling asleep)',
          data: entries.map(e => toHrs(e.sol_minutes)),
          backgroundColor: 'rgba(240,173,78,0.70)',
          borderColor: '#f0ad4e',
          borderWidth: 1,
          stack: 'tib',
        },
        {
          label: 'Remaining (WASO + TW)',
          data: entries.map(e => toHrs((e.waso_minutes || 0) + (e.tw_minutes || 0))),
          backgroundColor: 'rgba(224,92,92,0.55)',
          borderColor: '#e05c5c',
          borderWidth: 1,
          stack: 'tib',
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, stacked: true },
        y: {
          ...CHART_DEFAULTS.scales.y,
          stacked: true,
          min: 0,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v}h` },
        },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            footer: (items) => {
              const idx = items[0].dataIndex;
              const e = entries[idx];
              return `TIB: ${fmtHm(e.tib_minutes || 0)}`;
            },
            label: (item) => {
              const idx = item.dataIndex;
              const e = entries[idx];
              const rawMin = item.datasetIndex === 0 ? e.tst_minutes
                           : item.datasetIndex === 1 ? e.sol_minutes
                           : (e.waso_minutes || 0) + (e.tw_minutes || 0);
              return ` ${item.dataset.label}: ${fmtHm(rawMin)}`;
            },
          },
        },
      },
    },
  });
}

/* ── Render all ──────────────────────────────────────────────────── */
function renderAllCharts(entries) {
  if (!entries || entries.length === 0) {
    destroyAll();
    return;
  }
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  renderSeChart(sorted);
  renderTstChart(sorted);
  renderSolWasoChart(sorted);
  renderQualityChart(sorted);
  renderTibCompositionChart(sorted);
}
