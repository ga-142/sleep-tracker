/* Main application — init, tab routing, period state, event wiring */

const App = (() => {

  /* ── State ─────────────────────────────────────────────────────── */
  let currentPeriod    = { start: '', end: '' };
  let pendingDeleteId  = null;
  let pendingExportMode = 'download';
  let cachedEntries    = [];

  /* ── Date helpers ───────────────────────────────────────────────── */
  function toDateStr(d) {
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day   = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getPeriodFromPreset(days) {
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (parseInt(days, 10) - 1));
    return { start: toDateStr(start), end: toDateStr(end) };
  }

  function today() { return toDateStr(new Date()); }

  function getRollingExportRange(days) {
    return getPeriodFromPreset(days);
  }

  /* ── Tab switching ──────────────────────────────────────────────── */
  const tabs = ['dashboard', 'log', 'ai', 'settings'];

  function showTab(name) {
    tabs.forEach(t => {
      document.getElementById(`tab-${t}`).classList.toggle('d-none', t !== name);
      document.getElementById(`nav-${t}`).classList.toggle('active', t === name);
    });
    const periodBar = document.getElementById('period-bar');
    periodBar.style.display = (name === 'settings' || name === 'ai') ? 'none' : '';

    if (name === 'dashboard') loadDashboard();
    if (name === 'log')       loadLog();
    if (name === 'settings')  loadSettings();
  }

  /* ── Period selector ────────────────────────────────────────────── */
  function initPeriodSelector() {
    const preset    = document.getElementById('preset-select');
    const customDiv = document.getElementById('custom-range');
    const applyBtn  = document.getElementById('apply-range');

    flatpickr('#custom-start', { dateFormat: 'Y-m-d', defaultDate: null });
    flatpickr('#custom-end',   { dateFormat: 'Y-m-d', defaultDate: null });

    currentPeriod = getPeriodFromPreset(30);
    updatePeriodLabel();

    preset.addEventListener('change', () => {
      if (preset.value === 'custom') {
        customDiv.classList.remove('d-none');
      } else {
        customDiv.classList.add('d-none');
        currentPeriod = getPeriodFromPreset(preset.value);
        updatePeriodLabel();
        refreshActive();
      }
    });

    applyBtn.addEventListener('click', () => {
      const s = document.getElementById('custom-start').value;
      const e = document.getElementById('custom-end').value;
      if (!s || !e) { showToast('Please select both start and end dates.', 'error'); return; }
      if (s > e)    { showToast('Start date must be before end date.', 'error'); return; }
      currentPeriod = { start: s, end: e };
      updatePeriodLabel();
      refreshActive();
    });
  }

  function updatePeriodLabel() {
    const lbl = document.getElementById('period-label');
    if (currentPeriod.start && currentPeriod.end) {
      lbl.textContent = `${currentPeriod.start} → ${currentPeriod.end}`;
    }
  }

  function refreshActive() {
    const isLog = !document.getElementById('tab-log').classList.contains('d-none');
    if (isLog) loadLog(); else loadDashboard();
  }

  /* ── Dashboard ──────────────────────────────────────────────────── */
  function getPriorPeriod(start, end) {
    const parse = value => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    };
    const startDate = parse(start);
    const endDate = parse(end);
    const days = Math.round((Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
      - Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())) / 86400000) + 1;
    const priorEnd = new Date(startDate);
    priorEnd.setDate(priorEnd.getDate() - 1);
    const priorStart = new Date(priorEnd);
    priorStart.setDate(priorStart.getDate() - (days - 1));
    return { start: toDateStr(priorStart), end: toDateStr(priorEnd) };
  }

  async function loadDashboard() {
    try {
      const prior = getPriorPeriod(currentPeriod.start, currentPeriod.end);
      const [entries, agg, priorAgg, restriction] = await Promise.all([
        API.getEntries(currentPeriod.start, currentPeriod.end),
        API.getAggregates(currentPeriod.start, currentPeriod.end),
        API.getAggregates(prior.start, prior.end),
        API.getSleepRestriction(currentPeriod.start, currentPeriod.end),
      ]);
      cachedEntries = entries;
      renderStatCards(agg, priorAgg);
      renderAllCharts(entries);
      renderSleepRestriction(restriction);
    } catch (err) {
      showToast(`Failed to load dashboard: ${err.message}`, 'error');
    }
  }

  function renderSleepRestriction(data) {
    const card    = document.getElementById('sleep-restriction-card');
    const content = document.getElementById('sleep-restriction-content');

    if (!data.available) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';

    const tibH   = Math.floor(data.prescribed_tib_min / 60);
    const tibM   = data.prescribed_tib_min % 60;
    const tibStr = tibM ? `${tibH}h ${tibM}m` : `${tibH}h`;

    let html = `
      <div class="d-flex align-items-center gap-3 flex-wrap">
        <div>
          <span class="small text-secondary fw-semibold text-uppercase" style="letter-spacing:.05em">
            <i class="bi bi-window-stack me-1"></i>CBT-I Sleep Window
          </span>
          <div class="mt-1">`;

    if (data.prescribed_bedtime && data.target_rise_time) {
      html += `<span class="fs-5 fw-bold text-info">${data.prescribed_bedtime}</span>
               <span class="text-muted mx-2">→</span>
               <span class="fs-5 fw-bold text-info">${data.target_rise_time}</span>
               <span class="text-muted ms-2 small">(${tibStr} in bed)</span>`;
    } else {
      html += `<span class="text-muted small">Prescribed TIB: <strong>${tibStr}</strong> — set a target rise time in Settings to see your sleep window.</span>`;
    }

    html += `</div>
          <div class="text-muted small mt-1">Based on avg TST of ${fmtMin(data.avg_tst_min)} + 30 min buffer</div>
        </div>`;

    if (data.compliance_rise != null || data.compliance_bed != null) {
      html += `<div class="d-flex gap-4 ms-auto flex-wrap">`;
      if (data.compliance_rise != null) {
        const cls = data.compliance_rise >= 80 ? 'se-good' : data.compliance_rise >= 60 ? 'se-ok' : 'se-poor';
        html += `<div class="text-center">
          <div class="small text-secondary">Rise compliance</div>
          <div class="fw-bold ${cls}">${data.compliance_rise}%</div>
          <div class="small text-muted">within ±30 min</div>
        </div>`;
      }
      if (data.compliance_bed != null) {
        const cls = data.compliance_bed >= 80 ? 'se-good' : data.compliance_bed >= 60 ? 'se-ok' : 'se-poor';
        html += `<div class="text-center">
          <div class="small text-secondary">Bedtime compliance</div>
          <div class="fw-bold ${cls}">${data.compliance_bed}%</div>
          <div class="small text-muted">not too early</div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    content.innerHTML = html;
  }

  /* ── Sleep Log ──────────────────────────────────────────────────── */
  async function loadLog() {
    try {
      const entries = await API.getEntries(currentPeriod.start, currentPeriod.end);
      cachedEntries = entries;
      renderTable(entries);
    } catch (err) {
      showToast(`Failed to load log: ${err.message}`, 'error');
    }
  }

  /* ── Entry modal ────────────────────────────────────────────────── */
  function initEntryModal() {
    flatpickr('#f-date', { dateFormat: 'Y-m-d', defaultDate: null });

    ['f-bedtime', 'f-sleep-attempt', 'f-rise', 'f-final-wake', 'f-sol', 'f-waso'].forEach(id => {
      document.getElementById(id).addEventListener('input',  updateCalcPreview);
      document.getElementById(id).addEventListener('change', updateCalcPreview);
    });

    document.getElementById('btn-save-entry').addEventListener('click', saveEntry);
  }

  function openAddModal() {
    document.getElementById('entry-modal-title').textContent = 'Add Sleep Entry';
    clearEntryForm();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = toDateStr(yesterday);
    document.getElementById('f-date').value = yStr;
    const fp = document.getElementById('f-date')._flatpickr;
    if (fp) fp.setDate(yStr, false);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('entry-modal')).show();
  }

  async function openEditModal(id) {
    document.getElementById('entry-modal-title').textContent = 'Edit Sleep Entry';
    const e = cachedEntries.find(e => e.id === id);
    if (!e) { showToast('Entry not found — try refreshing the log.', 'error'); return; }
    populateEntryForm(e);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('entry-modal')).show();
  }

  async function saveEntry() {
    const data = getFormData();
    if (!data.date) { showToast('Date is required.', 'error'); return; }

    const id = document.getElementById('entry-id').value;
    try {
      if (id) {
        await API.updateEntry(parseInt(id), data);
        showToast('Entry updated.');
      } else {
        await API.createEntry(data);
        showToast('Entry saved.');
      }
      bootstrap.Modal.getInstance(document.getElementById('entry-modal')).hide();
      refreshActive();
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  /* ── Delete modal ───────────────────────────────────────────────── */
  function openDeleteModal(id, date) {
    pendingDeleteId = id;
    document.getElementById('delete-date').textContent = date;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('delete-modal')).show();
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    try {
      await API.deleteEntry(pendingDeleteId);
      showToast('Entry deleted.');
      bootstrap.Modal.getInstance(document.getElementById('delete-modal')).hide();
      pendingDeleteId = null;
      refreshActive();
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  /* ── Export modal ───────────────────────────────────────────────── */
  function getExportRange(showErrors = false) {
    const preset = document.getElementById('export-range-preset').value;
    if (preset === 'all') return { start: null, end: null, label: 'All time' };
    if (preset === 'current') {
      return { ...currentPeriod, label: `${currentPeriod.start} to ${currentPeriod.end}` };
    }
    if (preset !== 'custom') {
      const range = getRollingExportRange(preset);
      return { ...range, label: `${range.start} to ${range.end}` };
    }

    const start = document.getElementById('export-start').value;
    const end = document.getElementById('export-end').value;
    if (!start || !end) {
      if (showErrors) showExportError('Please select both start and end dates.');
      return null;
    }
    if (start > end) {
      if (showErrors) showExportError('Start date must be on or before end date.');
      return null;
    }
    return { start, end, label: `${start} to ${end}` };
  }

  function updateExportRange() {
    document.getElementById('export-status').classList.add('d-none');
    const isCustom = document.getElementById('export-range-preset').value === 'custom';
    document.getElementById('export-custom-range').classList.toggle('d-none', !isCustom);
    const range = getExportRange(false);
    document.getElementById('export-period-label').textContent = range
      ? `Export period: ${range.label}`
      : 'Choose both dates to continue.';
  }

  async function openExportModal(mode, format) {
    pendingExportMode = mode;
    const isEmail = mode === 'email';
    document.getElementById('export-modal-title').textContent = isEmail ? 'Email Sleep Log' : 'Download Sleep Log';
    document.getElementById('export-recipient-group').classList.toggle('d-none', !isEmail);
    document.getElementById(format === 'csv' ? 'fmt-csv' : 'fmt-txt').checked = true;
    document.getElementById('export-range-preset').value = 'current';
    document.getElementById('export-status').classList.add('d-none');
    document.getElementById('btn-run-export').innerHTML = isEmail
      ? '<i class="bi bi-send me-1"></i>Send'
      : '<i class="bi bi-download me-1"></i>Download';
    updateExportRange();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('export-modal')).show();

    if (isEmail) {
      try {
        const settings = await API.getSettings();
        document.getElementById('email-recipient').value = settings.saved_email || '';
      } catch (_) {}
    }
  }

  async function runExport() {
    const range = getExportRange(true);
    if (!range) return;
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'csv';
    const btn = document.getElementById('btn-run-export');
    const recipient = document.getElementById('email-recipient').value.trim();
    if (pendingExportMode === 'email' && !recipient) {
      showExportError('Please enter a recipient email address.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${pendingExportMode === 'email' ? 'Sending…' : 'Preparing…'}`;
    try {
      if (pendingExportMode === 'email') {
        await API.sendEmail({ recipient, format, start: range.start, end: range.end });
        showToast(`Sleep log emailed to ${recipient}`, 'success');
      } else {
        const params = new URLSearchParams({ format });
        if (range.start) params.set('start', range.start);
        if (range.end) params.set('end', range.end);
        window.location.href = `/api/download?${params.toString()}`;
      }
      bootstrap.Modal.getInstance(document.getElementById('export-modal')).hide();
    } catch (err) {
      showExportError(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = pendingExportMode === 'email'
        ? '<i class="bi bi-send me-1"></i>Send'
        : '<i class="bi bi-download me-1"></i>Download';
    }
  }

  function showExportError(msg) {
    const el = document.getElementById('export-status');
    el.textContent = msg;
    el.classList.remove('d-none');
  }

  /* ── Settings tab ───────────────────────────────────────────────── */
  async function loadSettings() {
    try {
      const s = await API.getSettings();

      // Email / SMTP
      document.getElementById('settings-saved-email').value  = s.saved_email   || '';
      document.getElementById('settings-smtp-sender').value  = s.smtp_sender   || '';
      const pwStatus = document.getElementById('smtp-pw-status');
      if (s.smtp_password_set) {
        pwStatus.textContent  = 'App password is saved. Leave blank to keep it.';
        pwStatus.className    = 'form-text text-success';
      } else {
        pwStatus.textContent  = 'No app password saved yet.';
        pwStatus.className    = 'form-text text-muted';
      }

      // AI provider
      const provider = s.ai_provider || 'anthropic';
      document.querySelector(`input[name="ai-provider"][value="${provider}"]`).checked = true;
      toggleAiProviderUI(provider);

      // Claude settings
      const keyStatus = document.getElementById('anthropic-key-status');
      if (s.anthropic_api_key_set) {
        keyStatus.textContent = 'API key is saved. Leave blank to keep it.';
        keyStatus.className   = 'form-text text-success';
      } else {
        keyStatus.textContent = 'No API key saved. Add one below or set ANTHROPIC_API_KEY in .env.';
        keyStatus.className   = 'form-text text-muted';
      }
      if (s.anthropic_model) {
        document.getElementById('settings-anthropic-model').value = s.anthropic_model;
      }

      // Ollama settings
      document.getElementById('settings-ollama-url').value = s.ollama_base_url || 'http://ollama:11434';
      if (s.ollama_model) {
        const sel = document.getElementById('settings-ollama-model');
        let opt = sel.querySelector(`option[value="${s.ollama_model}"]`);
        if (!opt) {
          opt = new Option(s.ollama_model, s.ollama_model);
          sel.appendChild(opt);
        }
        sel.value = s.ollama_model;
      }

      // Sleep targets
      document.getElementById('settings-target-rise').value = s.target_rise_time || '';
      document.getElementById('settings-target-bed').value  = s.target_bedtime    || '';
      document.getElementById('settings-target-tst').value  = s.target_tst_hours  || '';

      // About You
      document.getElementById('settings-user-age').value              = s.user_age               || '';
      document.getElementById('settings-caffeine-cutoff').value       = s.caffeine_cutoff         || '';
      document.getElementById('settings-sleep-issue-duration').value  = s.sleep_issue_duration    || '';
      document.getElementById('settings-user-context').value          = s.user_context            || '';
    } catch (err) {
      showToast(`Could not load settings: ${err.message}`, 'error');
    }
  }

  function toggleAiProviderUI(provider) {
    document.getElementById('claude-settings').classList.toggle('d-none',  provider !== 'anthropic');
    document.getElementById('ollama-settings').classList.toggle('d-none',  provider !== 'ollama');
  }

  async function saveSettings() {
    const data = {
      saved_email:  document.getElementById('settings-saved-email').value.trim(),
      smtp_sender:  document.getElementById('settings-smtp-sender').value.trim(),
    };
    const pw = document.getElementById('settings-smtp-password').value;
    if (pw) data.smtp_password = pw;

    try {
      await API.saveSettings(data);
      document.getElementById('settings-smtp-password').value = '';
      showToast('Settings saved.');
      loadSettings();
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function saveAiSettings() {
    const provider = document.querySelector('input[name="ai-provider"]:checked').value;
    const data = { ai_provider: provider };

    if (provider === 'anthropic') {
      const key   = document.getElementById('settings-anthropic-key').value.trim();
      const model = document.getElementById('settings-anthropic-model').value;
      if (key) data.anthropic_api_key = key;
      data.anthropic_model = model;
    } else {
      data.ollama_base_url = document.getElementById('settings-ollama-url').value.trim() || 'http://ollama:11434';
      data.ollama_model    = document.getElementById('settings-ollama-model').value;
    }

    try {
      await API.saveSettings(data);
      document.getElementById('settings-anthropic-key').value = '';
      showToast('AI settings saved.');
      loadSettings();
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function saveSleepTargets() {
    const data = {
      target_rise_time: document.getElementById('settings-target-rise').value.trim(),
      target_bedtime:   document.getElementById('settings-target-bed').value.trim(),
      target_tst_hours: document.getElementById('settings-target-tst').value.trim(),
    };
    try {
      await API.saveSettings(data);
      showToast('Sleep targets saved.');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function saveAboutYou() {
    const data = {
      user_age:               document.getElementById('settings-user-age').value.trim(),
      caffeine_cutoff:        document.getElementById('settings-caffeine-cutoff').value.trim(),
      sleep_issue_duration:   document.getElementById('settings-sleep-issue-duration').value,
      user_context:           document.getElementById('settings-user-context').value.trim(),
    };
    try {
      await API.saveSettings(data);
      showToast('Profile saved.');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function refreshOllamaModels() {
    const btn = document.getElementById('btn-refresh-ollama-models');
    btn.disabled = true;
    try {
      const { models } = await API.getOllamaModels();
      const sel = document.getElementById('settings-ollama-model');
      const cur = sel.value;
      sel.innerHTML = '<option value="">— select a model —</option>';
      models.forEach(m => {
        const opt = new Option(m, m);
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
      if (!models.length) showToast('No Ollama models found. Is Ollama running?', 'info');
    } catch (err) {
      showToast(`Could not reach Ollama: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function testSMTP() {
    const btn = document.getElementById('btn-test-smtp');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    try {
      await API.testSMTP();
      showToast('SMTP connection successful!', 'success');
    } catch (err) {
      showToast(`SMTP test failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-plug me-1"></i>Test Connection';
    }
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    // Tab nav
    document.querySelectorAll('[data-tab]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        showTab(link.dataset.tab);
      });
    });

    // Period selector
    initPeriodSelector();
    flatpickr('#export-start', { dateFormat: 'Y-m-d', defaultDate: null });
    flatpickr('#export-end', { dateFormat: 'Y-m-d', defaultDate: null });
    document.getElementById('export-range-preset').addEventListener('change', updateExportRange);
    document.getElementById('export-start').addEventListener('change', updateExportRange);
    document.getElementById('export-end').addEventListener('change', updateExportRange);

    // Entry modal
    initEntryModal();
    document.getElementById('btn-add-entry').addEventListener('click', openAddModal);
    document.getElementById('btn-confirm-delete').addEventListener('click', confirmDelete);

    // Download / email
    document.getElementById('btn-download-csv').addEventListener('click', () => openExportModal('download', 'csv'));
    document.getElementById('btn-download-txt').addEventListener('click', () => openExportModal('download', 'txt'));
    document.getElementById('btn-export-csv').addEventListener('click',  () => openExportModal('email', 'csv'));
    document.getElementById('btn-export-txt').addEventListener('click',  () => openExportModal('email', 'txt'));
    document.getElementById('btn-run-export').addEventListener('click', runExport);

    // Email / SMTP settings
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-test-smtp').addEventListener('click', testSMTP);
    document.getElementById('toggle-pw-vis').addEventListener('click', () => {
      const inp  = document.getElementById('settings-smtp-password');
      const icon = document.querySelector('#toggle-pw-vis i');
      inp.type   = inp.type === 'password' ? 'text' : 'password';
      icon.className = inp.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
    });

    // AI settings
    document.getElementById('btn-save-ai-settings').addEventListener('click', saveAiSettings);
    document.getElementById('btn-save-targets').addEventListener('click', saveSleepTargets);
    document.getElementById('btn-save-about').addEventListener('click', saveAboutYou);
    document.getElementById('btn-refresh-ollama-models').addEventListener('click', refreshOllamaModels);
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
      radio.addEventListener('change', () => toggleAiProviderUI(radio.value));
    });
    document.getElementById('toggle-key-vis').addEventListener('click', () => {
      const inp  = document.getElementById('settings-anthropic-key');
      const icon = document.querySelector('#toggle-key-vis i');
      inp.type   = inp.type === 'password' ? 'text' : 'password';
      icon.className = inp.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
    });

    // Chat tab
    Chat.init();

    // Load dashboard on init
    loadDashboard();
  }

  /* ── Public surface ─────────────────────────────────────────────── */
  return {
    init,
    openEditModal,
    openDeleteModal,
    getCurrentPeriod: () => ({ ...currentPeriod }),
  };

})();

document.addEventListener('DOMContentLoaded', App.init);
