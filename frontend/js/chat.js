/* AI Chat tab — session management, streaming, markdown rendering */

const Chat = (() => {

  let currentSessionId = null;
  let isStreaming      = false;

  /* ── Markdown renderer (marked.js loaded via CDN) ─────────────── */
  function renderMarkdown(text) {
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      return escHtml(text).replace(/\n/g, '<br>');
    }
    return DOMPurify.sanitize(marked.parse(text));
  }

  /* ── Session list ─────────────────────────────────────────────── */
  async function loadSessionList() {
    try {
      const sessions = await API.listChatSessions();
      renderSessionList(sessions);
    } catch (err) {
      showToast(`Could not load sessions: ${err.message}`, 'error');
    }
  }

  function renderSessionList(sessions) {
    const el = document.getElementById('session-list');
    if (!sessions.length) {
      el.innerHTML = '<div class="text-muted small text-center py-3">No sessions yet.</div>';
      return;
    }
    el.innerHTML = sessions.map(s => {
      const date  = s.created_at ? s.created_at.slice(0, 10) : '';
      const model = s.model || s.provider;
      const msgs  = s.message_count || 0;
      const active = s.id === currentSessionId ? ' active' : '';
      return `
        <div class="session-item${active}" data-id="${s.id}">
          <div class="d-flex justify-content-between align-items-start">
            <div class="session-title flex-grow-1 me-1">${escHtml(s.title)}</div>
            <button class="btn btn-sm p-0 text-secondary session-delete-btn"
                    data-id="${s.id}" title="Delete session"
                    style="line-height:1;font-size:0.75rem">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <div class="session-meta">
            <span class="badge bg-dark border border-secondary me-1" style="font-size:0.65rem">${escHtml(model)}</span>
            <span>${date}</span>
            ${msgs ? `<span class="ms-1">· ${msgs} msg${msgs !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('.session-delete-btn')) return;
        selectSession(parseInt(item.dataset.id));
      });
    });

    el.querySelectorAll('.session-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        confirmDeleteSession(parseInt(btn.dataset.id));
      });
    });
  }

  /* ── Create / select session ──────────────────────────────────── */
  async function newSession(periodStart, periodEnd) {
    if (isStreaming) return;
    try {
      const session = await API.createChatSession({ period_start: periodStart, period_end: periodEnd });
      currentSessionId = session.id;
      showChatWindow(session, []);
      await loadSessionList();
      await triggerInitialAnalysis(session.id);
    } catch (err) {
      showToast(`Could not start session: ${err.message}`, 'error');
    }
  }

  async function selectSession(id) {
    if (isStreaming) return;
    try {
      const { session, messages } = await API.getChatSession(id);
      currentSessionId = session.id;
      showChatWindow(session, messages);
      await loadSessionList();
    } catch (err) {
      showToast(`Could not load session: ${err.message}`, 'error');
    }
  }

  async function confirmDeleteSession(id) {
    if (!confirm('Delete this session and all its messages?')) return;
    try {
      await API.deleteChatSession(id);
      if (currentSessionId === id) {
        currentSessionId = null;
        showEmptyState();
      }
      await loadSessionList();
      showToast('Session deleted.');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  /* ── Chat window ──────────────────────────────────────────────── */
  function showEmptyState() {
    document.getElementById('chat-empty').classList.remove('d-none');
    document.getElementById('chat-window').classList.add('d-none');
  }

  function showChatWindow(session, messages) {
    document.getElementById('chat-empty').classList.add('d-none');
    document.getElementById('chat-window').classList.remove('d-none');

    const badge = document.getElementById('chat-period-badge');
    badge.textContent = session.title;

    const modelBadge = document.getElementById('chat-model-badge');
    modelBadge.textContent = session.model;

    renderMessages(messages);
  }

  function renderMessages(messages) {
    const el = document.getElementById('chat-messages');
    if (!messages.length) {
      el.innerHTML = '<div class="text-center text-muted small py-4">Starting analysis…</div>';
      return;
    }
    el.innerHTML = messages.map(m => buildBubbleHTML(m.role, m.content)).join('');
    scrollToBottom();
  }

  function buildBubbleHTML(role, content) {
    const isUser   = role === 'user';
    const avatar   = isUser ? '<i class="bi bi-person-fill"></i>' : '<i class="bi bi-robot"></i>';
    const rendered = isUser
      ? `<span>${escHtml(content).replace(/\n/g, '<br>')}</span>`
      : renderMarkdown(content);
    return `
      <div class="chat-msg ${role}">
        <div class="chat-avatar">${avatar}</div>
        <div class="chat-bubble">${rendered}</div>
      </div>`;
  }

  function appendBubble(role, content) {
    const el  = document.getElementById('chat-messages');
    const tmp = document.createElement('div');
    tmp.innerHTML = buildBubbleHTML(role, content);
    el.appendChild(tmp.firstElementChild);
    scrollToBottom();
  }

  /* Creates an assistant bubble that can be filled incrementally while streaming */
  function createStreamingBubble() {
    const el     = document.getElementById('chat-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg assistant';
    wrapper.innerHTML = `
      <div class="chat-avatar"><i class="bi bi-robot"></i></div>
      <div class="chat-bubble stream-cursor"></div>`;
    el.appendChild(wrapper);
    scrollToBottom();

    const bubble = wrapper.querySelector('.chat-bubble');
    let   raw    = '';

    return {
      append(text) {
        raw += text;
        bubble.textContent = raw;   // plain text while streaming
        scrollToBottom();
      },
      finalize() {
        bubble.classList.remove('stream-cursor');
        bubble.innerHTML = renderMarkdown(raw);
        scrollToBottom();
      },
    };
  }

  function scrollToBottom() {
    const el = document.getElementById('chat-messages');
    el.scrollTop = el.scrollHeight;
  }

  /* ── Streaming ────────────────────────────────────────────────── */
  async function triggerInitialAnalysis(sessionId) {
    await streamMessage(sessionId, '', true);
  }

  async function streamMessage(sessionId, content, isInitial = false) {
    if (isStreaming) return;
    isStreaming = true;
    setSendDisabled(true);

    const emptyNotice = document.getElementById('chat-messages').querySelector('.text-center');
    if (emptyNotice) emptyNotice.remove();

    if (!isInitial) {
      appendBubble('user', content);
    }

    const bubble = createStreamingBubble();

    try {
      const res     = await API.chatStream(sessionId, content, isInitial);
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();   // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (data.error) throw new Error(data.error);
          if (data.text)  bubble.append(data.text);
          if (data.done)  break;
        }
      }
    } catch (err) {
      bubble.finalize();
      showToast(`Stream error: ${err.message}`, 'error');
    } finally {
      bubble.finalize();
      isStreaming = false;
      setSendDisabled(false);
      document.getElementById('chat-input').focus();
    }
  }

  /* ── Send message ─────────────────────────────────────────────── */
  async function sendMessage() {
    if (isStreaming || !currentSessionId) return;
    const input   = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    autoResizeInput(input);
    await streamMessage(currentSessionId, content, false);
  }

  /* ── UI helpers ───────────────────────────────────────────────── */
  function setSendDisabled(val) {
    const btn = document.getElementById('btn-chat-send');
    if (btn) btn.disabled = val;
    const input = document.getElementById('chat-input');
    if (input) input.disabled = val;
  }

  function autoResizeInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  function init() {
    document.getElementById('btn-new-session').addEventListener('click', () => {
      // Read the current period from the shared App state
      const period = App.getCurrentPeriod();
      newSession(period.start, period.end);
    });

    const sendBtn   = document.getElementById('btn-chat-send');
    const chatInput = document.getElementById('chat-input');

    sendBtn.addEventListener('click', sendMessage);

    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    chatInput.addEventListener('input', () => autoResizeInput(chatInput));

    loadSessionList();
  }

  return { init, loadSessionList };

})();
