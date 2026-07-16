/* DOM helpers, table rendering, modal population, toast */

const QUALITY_LABELS = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good'];
const QUALITY_ICONS  = ['😞', '😕', '😐', '🙂', '😊'];

/* ── Formatting helpers ──────────────────────────────────────────── */

function fmtMin(min) {
  if (min == null || min === 0) return '0h 0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* Parse a loosely-typed time string to minutes since midnight.
   Accepts: "22:00", "22", "2200", "4:45", "04:45". Returns null if unparseable. */
function parseTimeMinutes(t) {
  if (!t) return null;
  t = t.trim();
  if (!t) return null;
  let h, m;
  if (t.includes(':')) {
    const parts = t.split(':');
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else if (/^\d{1,2}$/.test(t)) {
    h = parseInt(t, 10); m = 0;          // "22" → 22:00
  } else if (/^\d{3}$/.test(t)) {
    h = parseInt(t[0], 10); m = parseInt(t.slice(1), 10);   // "945" → 9:45
  } else if (/^\d{4}$/.test(t)) {
    h = parseInt(t.slice(0, 2), 10); m = parseInt(t.slice(2), 10); // "2245" → 22:45
  } else {
    return null;
  }
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/* Normalise a time input to "HH:MM" before saving, so the DB is always clean. */
function normalizeTime(t) {
  const mins = parseTimeMinutes(t);
  if (mins === null) return t || '';      // return as-is if unparseable
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function seClass(se) {
  if (se >= 85) return 'se-good';
  if (se >= 75) return 'se-ok';
  return 'se-poor';
}

function seBadgeClass(se) {
  if (se >= 85) return 'badge-se-good';
  if (se >= 75) return 'badge-se-ok';
  return 'badge-se-poor';
}

function clampRating(value) {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 0 && rating < QUALITY_ICONS.length ? rating : 0;
}

function displayText(value) {
  return value == null || value === '' ? '—' : escHtml(value);
}

/* ── Toast ───────────────────────────────────────────────────────── */

function showToast(message, type = 'success') {
  const el = document.getElementById('app-toast');
  const body = document.getElementById('toast-body');
  el.classList.remove('text-bg-success', 'text-bg-danger', 'text-bg-info', 'text-bg-warning');
  const map = { success: 'text-bg-success', error: 'text-bg-danger', info: 'text-bg-info' };
  el.classList.add(map[type] || 'text-bg-info');
  body.textContent = message;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show();
}

/* ── Stat cards ──────────────────────────────────────────────────── */

function _trendHTML(current, prior, higherIsBetter) {
  if (prior == null || current == null) return '';
  const delta = current - prior;
  if (Math.abs(delta) < 0.05) return '<span class="trend-neutral">→ flat</span>';
  const isGood  = higherIsBetter ? delta > 0 : delta < 0;
  const arrow   = delta > 0 ? '↑' : '↓';
  const cls     = isGood ? 'trend-good' : 'trend-bad';
  const absVal  = Math.abs(delta);
  const display = absVal >= 1 ? absVal.toFixed(1) : absVal.toFixed(2);
  return `<span class="${cls}">${arrow} ${display}</span>`;
}

function renderStatCards(agg, priorAgg) {
  const p = priorAgg && priorAgg.count ? priorAgg : null;

  const seEl = document.getElementById('stat-avg-se');
  seEl.textContent = agg.count ? `${agg.avg_se}%` : '—';
  seEl.className   = `stat-value ${agg.count ? seClass(agg.avg_se) : ''}`;
  document.getElementById('trend-avg-se').innerHTML = agg.count && p
    ? _trendHTML(agg.avg_se, p.avg_se, true) : '';

  const periodEl = document.getElementById('stat-period-se');
  periodEl.textContent = agg.count ? `${agg.period_se}%` : '—';
  periodEl.className   = `stat-value ${agg.count ? seClass(agg.period_se) : ''}`;
  document.getElementById('trend-period-se').innerHTML = agg.count && p
    ? _trendHTML(agg.period_se, p.period_se, true) : '';

  document.getElementById('stat-avg-tst').textContent  = agg.count ? fmtMin(agg.avg_tst_min)  : '—';
  document.getElementById('trend-avg-tst').innerHTML   = agg.count && p
    ? _trendHTML(agg.avg_tst_min, p.avg_tst_min, true) : '';

  document.getElementById('stat-avg-sol').textContent  = agg.count ? `${agg.avg_sol_min} min`  : '—';
  document.getElementById('trend-avg-sol').innerHTML   = agg.count && p
    ? _trendHTML(agg.avg_sol_min, p.avg_sol_min, false) : '';

  document.getElementById('stat-avg-waso').textContent = agg.count ? `${agg.avg_waso_min} min` : '—';
  document.getElementById('trend-avg-waso').innerHTML  = agg.count && p
    ? _trendHTML(agg.avg_waso_min, p.avg_waso_min, false) : '';

  document.getElementById('stat-count').textContent = agg.count ?? '—';
}

/* ── Sleep Log table ─────────────────────────────────────────────── */

function renderTable(entries) {
  const tbody = document.getElementById('log-tbody');
  const empty = document.getElementById('log-empty');

  if (!entries || entries.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');

  // Show newest first in the table
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  tbody.innerHTML = sorted.map(e => {
    const q = clampRating(e.sleep_quality);
    const energy = e.morning_energy == null ? null : clampRating(e.morning_energy);
    const mood = e.daytime_mood == null ? null : clampRating(e.daytime_mood);
    const se = Number(e.sleep_efficiency) || 0;
    const id = Number(e.id);
    const date = escHtml(e.date || '');
    const napStr = e.nap_minutes > 0 ? fmtMin(e.nap_minutes) : '—';
    const comment = e.comments
      ? `<span title="${escHtml(e.comments)}" style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis">${escHtml(e.comments)}</span>`
      : '<span class="text-muted">—</span>';
    const substances = e.substances
      ? `<span title="${escHtml(e.substances)}" style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis">${escHtml(e.substances)}</span>`
      : '<span class="text-muted">—</span>';

    return `<tr>
      <td><strong>${date}</strong></td>
      <td>${displayText(e.bedtime)}</td>
      <td>${displayText(e.sleep_attempt_time)}</td>
      <td>${displayText(e.rise_time)}</td>
      <td>${fmtMin(e.tib_minutes)}</td>
      <td>${Number(e.sol_minutes) || 0}m</td>
      <td>${Number(e.waso_minutes) || 0}m</td>
      <td>${Number(e.tw_minutes) || 0}m</td>
      <td>${fmtMin(e.tst_minutes)}</td>
      <td><span class="badge rounded-pill px-2 ${seBadgeClass(se)}">${se.toFixed(1)}%</span></td>
      <td><span class="quality-badge">${QUALITY_ICONS[q]} <span class="text-muted">${q}</span></span></td>
      <td>${energy != null ? `<span class="quality-badge">${QUALITY_ICONS[energy]} <span class="text-muted">${energy}</span></span>` : '<span class="text-muted">—</span>'}</td>
      <td>${mood != null ? `<span class="quality-badge">${QUALITY_ICONS[mood]} <span class="text-muted">${mood}</span></span>` : '<span class="text-muted">—</span>'}</td>
      <td>${napStr}</td>
      <td>${comment}</td>
      <td>${substances}</td>
      <td class="text-end">
        <button class="btn btn-outline-secondary btn-row me-1" data-action="edit" data-entry-id="${id}" title="Edit">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-outline-danger btn-row" data-action="delete" data-entry-id="${id}" data-entry-date="${date}" title="Delete">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.entryId);
      if (button.dataset.action === 'edit') App.openEditModal(id);
      if (button.dataset.action === 'delete') App.openDeleteModal(id, button.dataset.entryDate);
    });
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Entry form ──────────────────────────────────────────────────── */

function clearEntryForm() {
  document.getElementById('entry-id').value = '';
  document.getElementById('f-date').value = '';
  document.getElementById('f-bedtime').value = '';
  document.getElementById('f-sleep-attempt').value = '';
  document.getElementById('f-sol').value = '';
  document.getElementById('f-wakeups').value = '';
  document.getElementById('f-waso').value = '';
  document.getElementById('f-final-wake').value = '';
  document.getElementById('f-rise').value = '';
  document.getElementById('f-quality').value  = '2';
  document.getElementById('f-energy').value   = '';
  document.getElementById('f-mood').value     = '';
  document.getElementById('f-nap-h').value    = '';
  document.getElementById('f-nap-m').value    = '';
  document.getElementById('f-comments').value = '';
  document.getElementById('f-substances').value = '';
  updateCalcPreview();
}

function populateEntryForm(entry) {
  document.getElementById('entry-id').value = entry.id;
  document.getElementById('f-date').value = entry.date || '';
  document.getElementById('f-bedtime').value = entry.bedtime || '';
  document.getElementById('f-sleep-attempt').value = entry.sleep_attempt_time || '';
  document.getElementById('f-sol').value = entry.sol_minutes ?? '';
  document.getElementById('f-wakeups').value = entry.wakeup_count ?? '';
  document.getElementById('f-waso').value = entry.waso_minutes ?? '';
  document.getElementById('f-final-wake').value = entry.final_awakening || '';
  document.getElementById('f-rise').value = entry.rise_time || '';
  document.getElementById('f-quality').value = entry.sleep_quality ?? 2;
  document.getElementById('f-energy').value  = entry.morning_energy != null ? entry.morning_energy : '';
  document.getElementById('f-mood').value    = entry.daytime_mood   != null ? entry.daytime_mood   : '';
  const nm = entry.nap_minutes || 0;
  document.getElementById('f-nap-h').value = Math.floor(nm / 60) || '';
  document.getElementById('f-nap-m').value = nm % 60 || '';
  document.getElementById('f-comments').value = entry.comments || '';
  document.getElementById('f-substances').value = entry.substances || '';

  // Sync Flatpickr on date only (time fields are plain text)
  const dateEl = document.getElementById('f-date');
  if (dateEl._flatpickr) dateEl._flatpickr.setDate(dateEl.value, false);

  updateCalcPreview();
}

function getFormData() {
  const napH = parseInt(document.getElementById('f-nap-h').value) || 0;
  const napM = parseInt(document.getElementById('f-nap-m').value) || 0;
  return {
    date:               document.getElementById('f-date').value,
    bedtime:            normalizeTime(document.getElementById('f-bedtime').value),
    sleep_attempt_time: normalizeTime(document.getElementById('f-sleep-attempt').value),
    sol_minutes:        parseInt(document.getElementById('f-sol').value) || 0,
    wakeup_count:       parseInt(document.getElementById('f-wakeups').value) || 0,
    waso_minutes:       parseInt(document.getElementById('f-waso').value) || 0,
    final_awakening:    normalizeTime(document.getElementById('f-final-wake').value),
    rise_time:          normalizeTime(document.getElementById('f-rise').value),
    sleep_quality:   parseInt(document.getElementById('f-quality').value),
    morning_energy:  document.getElementById('f-energy').value !== '' ? parseInt(document.getElementById('f-energy').value) : null,
    daytime_mood:    document.getElementById('f-mood').value   !== '' ? parseInt(document.getElementById('f-mood').value)   : null,
    nap_minutes:     napH * 60 + napM,
    comments:        document.getElementById('f-comments').value.trim(),
    substances:      document.getElementById('f-substances').value.trim(),
  };
}

/* ── Live calc preview ───────────────────────────────────────────── */

function minsBetween(start, end) {
  const s = parseTimeMinutes(start);
  const e = parseTimeMinutes(end);
  if (s === null || e === null) return 0;
  let diff = e - s;
  if (diff < 0) diff += 1440;
  return diff;
}

function updateCalcPreview() {
  const bedtime      = document.getElementById('f-bedtime').value;
  const sleepAttempt = document.getElementById('f-sleep-attempt').value;
  const riseTime     = document.getElementById('f-rise').value;
  const finalWake    = document.getElementById('f-final-wake').value;
  const sol  = parseInt(document.getElementById('f-sol').value) || 0;
  const waso = parseInt(document.getElementById('f-waso').value) || 0;

  const tib  = minsBetween(bedtime, riseTime);
  const psib = minsBetween(bedtime, sleepAttempt);   // pre-sleep in-bed gap
  const tw   = minsBetween(finalWake, riseTime);
  const tst  = Math.max(0, tib - psib - sol - waso - tw);
  const se   = tib > 0 ? (tst / tib * 100).toFixed(1) : '—';

  document.getElementById('prev-tib').textContent = tib ? fmtMin(tib) : '—';
  document.getElementById('prev-tw').textContent  = tw ? fmtMin(tw) : '—';
  document.getElementById('prev-tst').textContent = tst ? fmtMin(tst) : '—';
  const seEl = document.getElementById('prev-se');
  seEl.textContent = tib ? `${se}%` : '—';
  seEl.className = `fw-semibold ${tib ? seClass(parseFloat(se)) : ''}`;
}
