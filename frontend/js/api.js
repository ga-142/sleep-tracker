/* Thin fetch() wrappers for the Flask API */

async function apiRequest(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function withQuery(path, params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  });
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

const API = {
  // Sleep entries
  getEntries:   (start, end) => apiRequest('GET', withQuery('/api/entries', { start, end })),
  createEntry:  (data)       => apiRequest('POST', '/api/entries', data),
  updateEntry:  (id, data)   => apiRequest('PUT', `/api/entries/${id}`, data),
  deleteEntry:  (id)         => apiRequest('DELETE', `/api/entries/${id}`),

  // Aggregates
  getAggregates: (start, end) => apiRequest('GET', withQuery('/api/aggregates', { start, end })),

  // Settings
  getSettings:  ()     => apiRequest('GET', '/api/settings'),
  saveSettings: (data) => apiRequest('PUT', '/api/settings', data),

  // Email export
  sendEmail: (data) => apiRequest('POST', '/api/email', data),
  testSMTP:  ()     => apiRequest('POST', '/api/email/test', {}),

  // Chat sessions
  listChatSessions:   ()   => apiRequest('GET', '/api/chat/sessions'),
  createChatSession:  (data) => apiRequest('POST', '/api/chat/sessions', data),
  getChatSession:     (id) => apiRequest('GET', `/api/chat/sessions/${id}`),
  deleteChatSession:  (id) => apiRequest('DELETE', `/api/chat/sessions/${id}`),

  // Sleep restriction window
  getSleepRestriction: (start, end) => apiRequest('GET', withQuery('/api/sleep-restriction', { start, end })),

  // Ollama model list
  getOllamaModels: () => apiRequest('GET', '/api/chat/ollama/models'),

  // SSE streaming — returns a Response (not parsed JSON)
  async chatStream(sessionId, content, isInitial = false) {
    const res = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, is_initial: isInitial }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res;
  },
};
