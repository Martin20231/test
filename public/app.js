const TOKEN_KEY = 'relay_token';
const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  socket: null,
  conversations: [],
  users: [],
  statuses: [],
  onlineIds: new Set(),
  lastSeen: new Map(),
  activeConversationId: null,
  messages: [],
  typingTimeout: null,
  peerTyping: false,
  typingName: '',
  search: '',
  replyTo: null,
  openReactionFor: null,
  selectedGroupMembers: new Set(),
  mediaRecorder: null,
  voiceChunks: [],
  voiceStartedAt: 0,
  voiceTimer: null,
};

const els = {
  authScreen: document.getElementById('auth-screen'),
  appScreen: document.getElementById('app-screen'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  authError: document.getElementById('auth-error'),
  authTabs: document.querySelectorAll('.auth-tab'),
  meAvatar: document.getElementById('me-avatar'),
  meName: document.getElementById('me-name'),
  conversationList: document.getElementById('conversation-list'),
  chatSearch: document.getElementById('chat-search'),
  emptyState: document.getElementById('empty-state'),
  activeChat: document.getElementById('active-chat'),
  peerAvatar: document.getElementById('peer-avatar'),
  peerName: document.getElementById('peer-name'),
  peerMeta: document.getElementById('peer-meta'),
  messageList: document.getElementById('message-list'),
  typingIndicator: document.getElementById('typing-indicator'),
  composer: document.getElementById('composer'),
  messageInput: document.getElementById('message-input'),
  btnAttach: document.getElementById('btn-attach'),
  btnPoll: document.getElementById('btn-poll'),
  imageInput: document.getElementById('image-input'),
  btnVoice: document.getElementById('btn-voice'),
  voiceBar: document.getElementById('voice-bar'),
  voiceTimer: document.getElementById('voice-timer'),
  btnVoiceCancel: document.getElementById('btn-voice-cancel'),
  btnVoiceSend: document.getElementById('btn-voice-send'),
  pinRail: document.getElementById('pin-rail'),
  pollDialog: document.getElementById('poll-dialog'),
  pollForm: document.getElementById('poll-form'),
  pollQuestion: document.getElementById('poll-question'),
  btnClosePoll: document.getElementById('btn-close-poll'),
  btnNewChat: document.getElementById('btn-new-chat'),
  btnNewGroup: document.getElementById('btn-new-group'),
  btnPrivacy: document.getElementById('btn-privacy'),
  btnEmptyNew: document.getElementById('btn-empty-new'),
  btnLogout: document.getElementById('btn-logout'),
  btnBack: document.getElementById('btn-back'),
  newChatDialog: document.getElementById('new-chat-dialog'),
  contactList: document.getElementById('contact-list'),
  newGroupDialog: document.getElementById('new-group-dialog'),
  newGroupForm: document.getElementById('new-group-form'),
  groupContactList: document.getElementById('group-contact-list'),
  groupTitle: document.getElementById('group-title'),
  btnCloseGroup: document.getElementById('btn-close-group'),
  privacyDialog: document.getElementById('privacy-dialog'),
  privacyLastSeen: document.getElementById('privacy-last-seen'),
  privacyRetention: document.getElementById('privacy-retention'),
  privacyRestrict: document.getElementById('privacy-restrict'),
  consentStatus: document.getElementById('consent-status'),
  btnRevokeMessages: document.getElementById('btn-revoke-messages'),
  btnRevokeMedia: document.getElementById('btn-revoke-media'),
  btnRevokeImpulses: document.getElementById('btn-revoke-impulses'),
  btnGrantMessages: document.getElementById('btn-grant-messages'),
  btnGrantMedia: document.getElementById('btn-grant-media'),
  btnGrantImpulses: document.getElementById('btn-grant-impulses'),
  btnExportData: document.getElementById('btn-export-data'),
  btnDeleteAccount: document.getElementById('btn-delete-account'),
  messageConsentDialog: document.getElementById('message-consent-dialog'),
  messageConsentForm: document.getElementById('message-consent-form'),
  messageConsentCheck: document.getElementById('message-consent-check'),
  storageBanner: document.getElementById('storage-banner'),
  btnAcceptStorage: document.getElementById('btn-accept-storage'),
  replyBar: document.getElementById('reply-bar'),
  replyBarName: document.getElementById('reply-bar-name'),
  replyBarBody: document.getElementById('reply-bar-body'),
  btnCancelReply: document.getElementById('btn-cancel-reply'),
  statusList: document.getElementById('status-list'),
  btnAddStatus: document.getElementById('btn-add-status'),
  statusDialog: document.getElementById('status-dialog'),
  statusForm: document.getElementById('status-form'),
  statusText: document.getElementById('status-text'),
  statusImage: document.getElementById('status-image'),
  btnCloseStatus: document.getElementById('btn-close-status'),
  statusViewer: document.getElementById('status-viewer'),
  statusViewerMedia: document.getElementById('status-viewer-media'),
  statusViewerName: document.getElementById('status-viewer-name'),
  statusViewerTime: document.getElementById('status-viewer-time'),
  statusViewerBody: document.getElementById('status-viewer-body'),
  btnCloseViewer: document.getElementById('btn-close-viewer'),
  toast: document.getElementById('toast'),
};

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function setAvatar(el, userOrColor, name, { online = false } = {}) {
  const color = typeof userOrColor === 'string' ? userOrColor : userOrColor?.avatar_color;
  const label = name || userOrColor?.display_name || userOrColor?.username || '?';
  if (!color) return;
  el.textContent = initials(label);
  el.style.background = `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 65%, #041f1d))`;
  el.classList.toggle('is-online', online);
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatListTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(iso);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function formatLastSeen(iso, { hidden = false } = {}) {
  if (hidden) return 'zuletzt gesehen ausgeblendet';
  if (!iso) return 'zuletzt gesehen vor Kurzem';
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now - date) / 60000);
  if (diffMin < 1) return 'zuletzt gesehen gerade eben';
  if (diffMin < 60) return `zuletzt gesehen vor ${diffMin} Min.`;
  if (date.toDateString() === now.toDateString()) {
    return `zuletzt gesehen heute um ${formatTime(iso)}`;
  }
  return `zuletzt gesehen ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${formatTime(iso)}`;
}

function maybeShowStorageBanner() {
  if (localStorage.getItem('relay_storage_notice') === '1') return;
  els.storageBanner.classList.remove('is-hidden');
}

function ensureMessageConsent() {
  if (state.user?.processing_restricted) {
    showToast('Verarbeitung eingeschränkt (Art. 18 DSGVO)');
    return false;
  }
  if (state.user?.has_message_consent || state.user?.message_consent_at) return true;
  els.messageConsentCheck.checked = false;
  if (!els.messageConsentDialog.open) els.messageConsentDialog.showModal();
  return false;
}

function ensureMediaConsent() {
  if (state.user?.processing_restricted) {
    showToast('Verarbeitung eingeschränkt (Art. 18 DSGVO)');
    return false;
  }
  if (state.user?.has_media_consent || state.user?.media_consent_at) return true;
  showToast('Medien-Einwilligung fehlt — unter Privatsphäre erteilen');
  return false;
}

function ensureImpulseConsent() {
  if (state.user?.processing_restricted) {
    showToast('Verarbeitung eingeschränkt (Art. 18 DSGVO)');
    return false;
  }
  if (state.user?.has_impulse_consent || state.user?.impulse_consent_at) return true;
  showToast('Impuls-Einwilligung fehlt — unter Privatsphäre erteilen');
  return false;
}

function renderConsentStatus() {
  if (!els.consentStatus) return;
  const u = state.user || {};
  const row = (label, ok) =>
    `<div class="consent-chip ${ok ? 'is-on' : 'is-off'}">${label}: ${ok ? 'aktiv' : 'widerrufen'}</div>`;
  els.consentStatus.innerHTML = [
    row('Nachrichten', Boolean(u.has_message_consent || u.message_consent_at)),
    row('Medien', Boolean(u.has_media_consent || u.media_consent_at)),
    row('Impulse', Boolean(u.has_impulse_consent || u.impulse_consent_at)),
    row('Art. 18', Boolean(u.processing_restricted)),
  ].join('');
}

function openPrivacyDialog() {
  els.privacyLastSeen.checked = Boolean(state.user?.show_last_seen);
  els.privacyRetention.value = String(state.user?.message_retention_days || 365);
  if (els.privacyRestrict) {
    els.privacyRestrict.checked = Boolean(state.user?.processing_restricted);
  }
  renderConsentStatus();
  els.privacyDialog.showModal();
}

async function revokeScope(scope) {
  try {
    const data = await api('/api/me/consent/revoke', {
      method: 'POST',
      body: { scope },
    });
    state.user = data.user;
    renderConsentStatus();
    showToast(`Einwilligung widerrufen: ${scope}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function grantScope(kind) {
  try {
    const endpoints = {
      messages: ['/api/me/message-consent', { message_consent: true }],
      media: ['/api/me/media-consent', { media_consent: true }],
      impulses: ['/api/me/impulse-consent', { impulse_consent: true }],
    };
    const [url, body] = endpoints[kind];
    const data = await api(url, { method: 'POST', body });
    state.user = data.user;
    renderConsentStatus();
    showToast(`Einwilligung erteilt: ${kind}`);
  } catch (error) {
    showToast(error.message);
  }
}

function formatDuration(ms = 0) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Heute';
  if (date.toDateString() === yesterday.toDateString()) return 'Gestern';
  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('is-hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.add('is-hidden'), 2200);
}

function showAuthError(message) {
  els.authError.hidden = !message;
  els.authError.textContent = message || '';
}

async function api(path, { method = 'GET', body, auth = true, formData } = {}) {
  const headers = {};
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (!formData) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Anfrage fehlgeschlagen.');
    error.code = data.code;
    throw error;
  }
  return data;
}

function conversationTitle(conversation) {
  if (conversation.type === 'group') return conversation.title || 'Kreis';
  return conversation.peer?.display_name || 'Dialog';
}

function conversationSubtitle(conversation) {
  if (conversation.type === 'group') return `${conversation.members?.length || 0} im Kreis`;
  return conversation.peer?.status || `@${conversation.peer?.username || ''}`;
}

function showApp() {
  els.authScreen.classList.add('is-hidden');
  els.appScreen.classList.remove('is-hidden');
  setAvatar(els.meAvatar, state.user, null, { online: true });
  els.meName.textContent = state.user.display_name;
}

function showAuth() {
  els.appScreen.classList.add('is-hidden');
  els.authScreen.classList.remove('is-hidden');
  els.appScreen.classList.remove('show-chat');
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('presence:snapshot', ({ online_user_ids }) => {
    state.onlineIds = new Set(online_user_ids || []);
    renderConversationList();
    renderActiveHeader();
  });

  state.socket.on('presence:online', ({ user_id }) => {
    state.onlineIds.add(user_id);
    renderConversationList();
    renderActiveHeader();
  });

  state.socket.on('presence:offline', ({ user_id, last_seen_at }) => {
    state.onlineIds.delete(user_id);
    if (last_seen_at) state.lastSeen.set(user_id, last_seen_at);
    const user = state.users.find((u) => u.id === user_id);
    if (user) {
      user.last_seen_at = last_seen_at;
      if (last_seen_at == null) user.show_last_seen = false;
    }
    const conversation = state.conversations.find((c) => c.peer?.id === user_id);
    if (conversation?.peer) {
      conversation.peer.last_seen_at = last_seen_at;
      if (last_seen_at == null) conversation.peer.show_last_seen = false;
    }
    renderConversationList();
    renderActiveHeader();
  });

  state.socket.on('presence:privacy', ({ user_id, show_last_seen, last_seen_at }) => {
    const user = state.users.find((u) => u.id === user_id);
    if (user) {
      user.show_last_seen = show_last_seen;
      user.last_seen_at = last_seen_at;
    }
    const conversation = state.conversations.find((c) => c.peer?.id === user_id);
    if (conversation?.peer) {
      conversation.peer.show_last_seen = show_last_seen;
      conversation.peer.last_seen_at = last_seen_at;
    }
    if (last_seen_at) state.lastSeen.set(user_id, last_seen_at);
    renderActiveHeader();
  });

  state.socket.on('presence:status', ({ user_id, status }) => {
    const user = state.users.find((u) => u.id === user_id);
    if (user) user.status = status;
    for (const conversation of state.conversations) {
      if (conversation.peer?.id === user_id) conversation.peer.status = status;
    }
    renderConversationList();
    renderActiveHeader();
  });

  state.socket.on('conversation:upsert', async () => {
    await refreshConversations();
  });

  state.socket.on('status:new', async () => {
    await refreshStatuses();
  });

  state.socket.on('conversation:pins', async ({ conversation_id }) => {
    if (conversation_id !== state.activeConversationId) return;
    const data = await api(`/api/conversations/${conversation_id}/messages`);
    const conversation = state.conversations.find((c) => c.id === conversation_id);
    if (conversation) conversation.pinned_messages = data.conversation.pinned_messages || [];
    renderPins();
  });

  state.socket.on('message:new', async ({ message, conversation_id }) => {
    let existing = state.conversations.find((c) => c.id === conversation_id);
    if (!existing) {
      await refreshConversations();
      existing = state.conversations.find((c) => c.id === conversation_id);
    } else {
      existing.last_message = previewFromMessage(message);
      if (state.activeConversationId !== conversation_id && message.sender_id !== state.user.id) {
        existing.unread_count = (existing.unread_count || 0) + 1;
      }
      state.conversations = [existing, ...state.conversations.filter((c) => c.id !== conversation_id)];
      renderConversationList();
    }

    if (state.activeConversationId === conversation_id) {
      upsertLocalMessage(message);
      if (message.sender_id !== state.user.id) await markRead(conversation_id);
    }
  });

  state.socket.on('message:updated', ({ message }) => {
    if (state.activeConversationId === message.conversation_id) upsertLocalMessage(message);
    const conversation = state.conversations.find((c) => c.id === message.conversation_id);
    if (conversation?.last_message?.id === message.id) {
      conversation.last_message = previewFromMessage(message);
      renderConversationList();
    }
  });

  state.socket.on('message:read', ({ conversation_id, message_ids, read_at }) => {
    if (state.activeConversationId !== conversation_id) return;
    const idSet = new Set(message_ids || []);
    for (const message of state.messages) {
      if (idSet.has(message.id)) {
        message.read_at = read_at;
        message.delivered_at = message.delivered_at || read_at;
      }
    }
    renderMessages();
  });

  state.socket.on('typing:start', ({ conversation_id, user_id, display_name }) => {
    if (conversation_id !== state.activeConversationId || user_id === state.user.id) return;
    state.peerTyping = true;
    state.typingName = display_name || 'Jemand';
    els.typingIndicator.classList.remove('is-hidden');
    renderActiveHeader();
  });

  state.socket.on('typing:stop', ({ conversation_id, user_id }) => {
    if (conversation_id !== state.activeConversationId || user_id === state.user.id) return;
    state.peerTyping = false;
    els.typingIndicator.classList.add('is-hidden');
    renderActiveHeader();
  });
}

function previewFromMessage(message) {
  if (message.deleted_at) return { ...message, body: 'Nachricht gelöscht' };
  if (message.type === 'image') return { ...message, body: message.body ? `Bild: ${message.body}` : 'Bild' };
  if (message.type === 'audio') return { ...message, body: 'Sprachnotiz' };
  if (message.type === 'poll') return { ...message, body: `Umfrage: ${message.body}` };
  return message;
}

function upsertLocalMessage(message) {
  const idx = state.messages.findIndex((m) => m.id === message.id);
  if (idx >= 0) state.messages[idx] = message;
  else state.messages.push(message);
  renderMessages();
  scrollMessagesToBottom();
}

async function bootstrapSession() {
  if (!state.token) {
    showAuth();
    return;
  }
  try {
    const me = await api('/api/me');
    state.user = me.user;
    state.onlineIds = new Set(me.online_user_ids || []);
    showApp();
    connectSocket();
    await Promise.all([refreshConversations(), refreshUsers(), refreshStatuses()]);
    ensureMessageConsent();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    state.token = null;
    showAuth();
  }
}

async function refreshConversations() {
  const data = await api('/api/conversations');
  state.conversations = data.conversations || [];
  renderConversationList();
}

async function refreshUsers() {
  const data = await api('/api/users');
  state.users = data.users || [];
  state.onlineIds = new Set(data.online_user_ids || []);
  for (const user of state.users) {
    if (user.last_seen_at) state.lastSeen.set(user.id, user.last_seen_at);
  }
}

async function refreshStatuses() {
  const data = await api('/api/statuses');
  state.statuses = data.statuses || [];
  renderStatusList();
}

function renderStatusList() {
  const byUser = new Map();
  for (const status of state.statuses) {
    if (!byUser.has(status.user_id)) byUser.set(status.user_id, []);
    byUser.get(status.user_id).push(status);
  }

  const chips = [];
  for (const [userId, list] of byUser) {
    const latest = list[0];
    const unseen = list.some((s) => !s.viewed && s.user_id !== state.user.id);
    chips.push(`
      <button type="button" class="status-chip" data-user="${userId}">
        <span class="status-avatar ${unseen ? 'has-new' : ''}" style="background:linear-gradient(145deg, ${latest.user.avatar_color}, color-mix(in srgb, ${latest.user.avatar_color} 65%, #152238))">${initials(latest.user.display_name)}</span>
        <span class="status-label">${escapeHtml(userId === state.user.id ? 'Du' : latest.user.display_name.split(' ')[0])}</span>
      </button>`);
  }

  els.statusList.innerHTML = chips.join('') || '<span style="color:var(--muted);font-size:0.85rem;padding:8px 0;">Noch keine Impulse</span>';
  els.statusList.querySelectorAll('.status-chip').forEach((btn) => {
    btn.addEventListener('click', () => openStatusViewer(btn.dataset.user));
  });
}

async function openStatusViewer(userId) {
  const list = state.statuses.filter((s) => s.user_id === userId);
  if (!list.length) return;
  const status = list[0];

  els.statusViewerName.textContent = status.user.display_name;
  els.statusViewerTime.textContent = formatListTime(status.created_at);
  els.statusViewerBody.textContent = status.body || '';

  if (status.type === 'image' && status.media_url) {
    els.statusViewerMedia.innerHTML = `<img src="${status.media_url}" alt="" />`;
  } else {
    els.statusViewerMedia.innerHTML = `<div>${escapeHtml(status.body || '')}</div>`;
  }

  els.statusViewer.showModal();
  if (status.user_id !== state.user.id) {
    try {
      await api(`/api/statuses/${status.id}/view`, { method: 'POST', body: {} });
      await refreshStatuses();
    } catch {
      /* ignore */
    }
  }
}

function renderConversationList() {
  const query = state.search.trim().toLowerCase();
  const items = state.conversations.filter((c) => {
    if (!query) return true;
    const hay = `${conversationTitle(c)} ${c.last_message?.body || ''}`.toLowerCase();
    return hay.includes(query);
  });

  if (!items.length) {
    els.conversationList.innerHTML = `
      <div style="padding:24px 14px;color:var(--muted);text-align:center;font-size:0.92rem;">
        ${query ? 'Keine Treffer.' : 'Noch keine Chats. Starte den ersten!'}
      </div>`;
    return;
  }

  els.conversationList.innerHTML = items
    .map((conversation) => {
      const isGroup = conversation.type === 'group';
      const online = !isGroup && state.onlineIds.has(conversation.peer?.id);
      const color = isGroup ? '#0f766e' : conversation.peer?.avatar_color || '#0D7377';
      const name = conversationTitle(conversation);
      const preview = conversation.last_message?.body || 'Noch keine Nachrichten';
      const time = formatListTime(conversation.last_message?.created_at || conversation.created_at);
      const unread =
        conversation.unread_count > 0
          ? `<span class="unread-badge">${conversation.unread_count}</span>`
          : '';
      const tag = isGroup ? '<span class="group-tag">Kreis</span>' : '';
      return `
        <button type="button" class="chat-item ${conversation.id === state.activeConversationId ? 'is-active' : ''}" data-id="${conversation.id}" role="listitem">
          <div class="avatar ${online ? 'is-online' : ''}" style="background:linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 65%, #152238))">${initials(name)}</div>
          <div class="chat-item-main">
            <div class="chat-item-name">${escapeHtml(name)}${tag}</div>
            <div class="chat-item-preview">${escapeHtml(preview)}</div>
          </div>
          <div class="chat-item-meta">
            <span class="chat-time">${time}</span>
            ${unread}
          </div>
        </button>`;
    })
    .join('');

  els.conversationList.querySelectorAll('.chat-item').forEach((btn) => {
    btn.addEventListener('click', () => openConversation(btn.dataset.id));
  });
}

async function openConversation(conversationId) {
  state.activeConversationId = conversationId;
  state.peerTyping = false;
  state.replyTo = null;
  state.openReactionFor = null;
  updateReplyBar();
  els.typingIndicator.classList.add('is-hidden');
  els.appScreen.classList.add('show-chat');

  const data = await api(`/api/conversations/${conversationId}/messages`);
  const conversation = data.conversation;
  const idx = state.conversations.findIndex((c) => c.id === conversationId);
  if (idx >= 0) state.conversations[idx] = { ...state.conversations[idx], ...conversation, unread_count: 0 };
  else state.conversations.unshift(conversation);

  state.messages = data.messages || [];
  els.emptyState.classList.add('is-hidden');
  els.activeChat.classList.remove('is-hidden');
  renderActiveHeader();
  renderPins();
  renderMessages();
  renderConversationList();
  await markRead(conversationId);
  els.messageInput.focus();
}

function renderPins() {
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  const pins = conversation?.pinned_messages || [];
  if (!pins.length) {
    els.pinRail.classList.add('is-hidden');
    els.pinRail.innerHTML = '';
    return;
  }
  els.pinRail.classList.remove('is-hidden');
  els.pinRail.innerHTML = pins
    .map(
      (pin) => `
      <button type="button" class="pin-chip" data-pin="${pin.id}">
        <strong>Angeheftet</strong>
        <span>${escapeHtml(pin.type === 'poll' ? `Umfrage: ${pin.body}` : pin.body || pin.type)}</span>
      </button>`
    )
    .join('');
  els.pinRail.querySelectorAll('.pin-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = els.messageList.querySelector(`[data-id="${btn.dataset.pin}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function renderActiveHeader() {
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  if (!conversation) return;

  const isGroup = conversation.type === 'group';
  const online = !isGroup && state.onlineIds.has(conversation.peer?.id);
  const title = conversationTitle(conversation);
  const color = isGroup ? '#0f766e' : conversation.peer?.avatar_color;

  setAvatar(els.peerAvatar, color, title, { online });
  els.peerName.textContent = title;

  if (state.peerTyping) {
    els.peerMeta.textContent = isGroup ? `${state.typingName} schreibt…` : 'schreibt…';
  } else if (isGroup) {
    els.peerMeta.textContent = conversationSubtitle(conversation);
  } else if (online) {
    els.peerMeta.textContent = conversation.peer?.status
      ? `online · ${conversation.peer.status}`
      : 'online';
  } else {
    const hidden = conversation.peer?.show_last_seen === false;
    const lastSeen = conversation.peer?.last_seen_at || state.lastSeen.get(conversation.peer?.id);
    els.peerMeta.textContent = formatLastSeen(lastSeen, { hidden });
  }
}

function ticksFor(message) {
  if (message.sender_id !== state.user.id || message.deleted_at) return '';
  if (message.read_at) return '<span class="delivery is-read">gelesen</span>';
  if (message.delivered_at) return '<span class="delivery">angekommen</span>';
  return '<span class="delivery">unterwegs</span>';
}

function pollHtml(message) {
  if (message.type !== 'poll' || !message.poll || message.deleted_at) return '';
  const options = message.poll.options
    .map(
      (option) => `
      <button type="button" class="poll-option-btn ${message.poll.my_vote === option.id ? 'is-mine' : ''}" data-vote="${message.id}" data-option="${option.id}">
        <span class="poll-option-fill" style="width:${option.percent}%"></span>
        <span class="poll-option-label"><span>${escapeHtml(option.label)}</span><span>${option.votes}</span></span>
      </button>`
    )
    .join('');
  return `<div class="poll-card"><strong>${escapeHtml(message.body)}</strong>${options}<div style="font-size:0.75rem;color:var(--muted)">${message.poll.total_votes} Stimmen</div></div>`;
}

function reactionSummary(message) {
  const counts = new Map();
  for (const reaction of message.reactions || []) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
  }
  if (!counts.size) return '';
  return `<div class="reactions">${[...counts.entries()]
    .map(([emoji, count]) => {
      const mine = (message.reactions || []).some(
        (r) => r.emoji === emoji && r.user_id === state.user.id
      );
      return `<button type="button" class="reaction-chip ${mine ? 'is-mine' : ''}" data-react="${message.id}" data-emoji="${emoji}">${emoji} ${count}</button>`;
    })
    .join('')}</div>`;
}

function mediaHtml(message) {
  if (message.deleted_at) return '';
  if (message.type === 'image' && message.media_url) {
    return `<img class="bubble-media" src="${message.media_url}" alt="Foto" data-lightbox="${message.media_url}" />`;
  }
  if (message.type === 'audio' && message.media_url) {
    return `<div class="audio-msg">
      <audio controls preload="metadata" src="${message.media_url}"></audio>
      <span class="audio-duration">${formatDuration(message.media_duration_ms || 0)}</span>
    </div>`;
  }
  return '';
}

function renderMessages() {
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  const isGroup = conversation?.type === 'group';
  els.messageList.innerHTML = '';
  let lastDay = '';

  for (const message of state.messages) {
    const day = dayLabel(message.created_at);
    if (day !== lastDay) {
      const sep = document.createElement('div');
      sep.className = 'day-separator';
      sep.textContent = day;
      els.messageList.appendChild(sep);
      lastDay = day;
    }

    const mine = message.sender_id === state.user.id;
    const deleted = Boolean(message.deleted_at);
    const row = document.createElement('div');
    row.className = `message-row ${mine ? 'is-mine' : ''}`;
    row.dataset.id = message.id;

    const replyHtml = message.reply_to
      ? `<div class="bubble-reply"><strong>${escapeHtml(message.reply_to.sender_name || 'Nachricht')}</strong><span>${escapeHtml(message.reply_to.body)}</span></div>`
      : '';

    const senderHtml =
      isGroup && !mine && !deleted
        ? `<div class="bubble-sender">${escapeHtml(message.sender_name || '')}</div>`
        : '';

    const body = deleted
      ? 'Diese Nachricht wurde gelöscht'
      : message.body
        ? escapeHtml(message.body)
        : '';
    const edited = message.edited_at && !deleted ? ' · bearbeitet' : '';

    const actions = deleted
      ? ''
      : `<div class="msg-actions">
          <button type="button" class="msg-action" data-reply="${message.id}">Antworten</button>
          <button type="button" class="msg-action" data-react-open="${message.id}">Reagieren</button>
          <button type="button" class="msg-action" data-pin="${message.id}">${message.pinned ? 'Lösen' : 'Anheften'}</button>
          ${mine && message.type === 'text' ? `<button type="button" class="msg-action" data-edit="${message.id}">Bearbeiten</button>` : ''}
          ${mine ? `<button type="button" class="msg-action" data-delete="${message.id}">Löschen</button>` : ''}
        </div>`;

    const picker =
      state.openReactionFor === message.id
        ? `<div class="reaction-picker">${REACTIONS.map(
            (emoji) => `<button type="button" data-react="${message.id}" data-emoji="${emoji}">${emoji}</button>`
          ).join('')}</div>`
        : '';

    row.innerHTML = `
      <div class="bubble ${deleted ? 'is-deleted' : ''}">
        ${senderHtml}
        ${replyHtml}
        ${mediaHtml(message)}
        ${pollHtml(message)}
        ${body && message.type !== 'poll' ? `<div class="bubble-body">${body}</div>` : ''}
        <div class="bubble-meta">
          <span>${formatTime(message.created_at)}${edited}</span>
          ${ticksFor(message)}
        </div>
        ${reactionSummary(message)}
        ${actions}
        ${picker}
      </div>`;

    els.messageList.appendChild(row);
  }

  bindMessageActions();
  scrollMessagesToBottom(false);
}

function bindMessageActions() {
  els.messageList.querySelectorAll('[data-lightbox]').forEach((img) => {
    img.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'lightbox';
      overlay.innerHTML = `<img src="${img.dataset.lightbox}" alt="" />`;
      overlay.addEventListener('click', () => overlay.remove());
      document.body.appendChild(overlay);
    });
  });

  els.messageList.querySelectorAll('[data-vote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/messages/${btn.dataset.vote}/vote`, {
          method: 'POST',
          body: { option_id: btn.dataset.option },
        });
        upsertLocalMessage(data.message);
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  els.messageList.querySelectorAll('[data-pin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const message = state.messages.find((m) => m.id === btn.dataset.pin);
      if (!message) return;
      try {
        const path = `/api/conversations/${state.activeConversationId}/pins/${message.id}`;
        const data = message.pinned
          ? await api(path, { method: 'DELETE' })
          : await api(path, { method: 'POST', body: {} });
        upsertLocalMessage(data.message);
        const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
        if (conversation) {
          const fresh = await api(`/api/conversations/${state.activeConversationId}/messages`);
          conversation.pinned_messages = fresh.conversation.pinned_messages || [];
          renderPins();
        }
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  els.messageList.querySelectorAll('[data-reply]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const message = state.messages.find((m) => m.id === btn.dataset.reply);
      if (!message || message.deleted_at) return;
      state.replyTo = message;
      updateReplyBar();
      els.messageInput.focus();
    });
  });

  els.messageList.querySelectorAll('[data-react-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.openReactionFor =
        state.openReactionFor === btn.dataset.reactOpen ? null : btn.dataset.reactOpen;
      renderMessages();
    });
  });

  els.messageList.querySelectorAll('[data-react]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/messages/${btn.dataset.react}/reactions`, {
          method: 'POST',
          body: { emoji: btn.dataset.emoji },
        });
        state.openReactionFor = null;
        upsertLocalMessage(data.message);
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  els.messageList.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const message = state.messages.find((m) => m.id === btn.dataset.edit);
      if (!message) return;
      const next = prompt('Nachricht bearbeiten', message.body);
      if (next == null || !next.trim() || next.trim() === message.body) return;
      try {
        const data = await api(`/api/messages/${message.id}`, {
          method: 'PATCH',
          body: { body: next.trim() },
        });
        upsertLocalMessage(data.message);
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  els.messageList.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Nachricht für alle löschen?')) return;
      try {
        const data = await api(`/api/messages/${btn.dataset.delete}`, { method: 'DELETE' });
        upsertLocalMessage(data.message);
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function updateReplyBar() {
  if (!state.replyTo) {
    els.replyBar.classList.add('is-hidden');
    return;
  }
  els.replyBar.classList.remove('is-hidden');
  els.replyBarName.textContent =
    state.replyTo.sender_name || (state.replyTo.sender_id === state.user.id ? 'Du' : 'Antwort');
  els.replyBarBody.textContent =
    state.replyTo.type === 'image'
      ? 'Foto'
      : state.replyTo.type === 'audio'
        ? 'Sprachnachricht'
        : state.replyTo.body;
}

function scrollMessagesToBottom(smooth = true) {
  els.messageList.scrollTo({
    top: els.messageList.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

async function markRead(conversationId) {
  await api(`/api/conversations/${conversationId}/read`, { method: 'POST', body: {} });
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (conversation) conversation.unread_count = 0;
  renderConversationList();
}

async function sendMessage(body) {
  const conversationId = state.activeConversationId;
  if (!conversationId || !body.trim()) return;
  if (!ensureMessageConsent()) return;

  const payload = { body };
  if (state.replyTo) payload.reply_to_id = state.replyTo.id;

  try {
    const data = await api(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: payload,
    });

    state.replyTo = null;
    updateReplyBar();
    upsertLocalMessage(data.message);

    const conversation = state.conversations.find((c) => c.id === conversationId);
    if (conversation) {
      conversation.last_message = previewFromMessage(data.message);
      state.conversations = [conversation, ...state.conversations.filter((c) => c.id !== conversationId)];
      renderConversationList();
    }

    state.socket?.emit('typing:stop', { conversation_id: conversationId });
  } catch (error) {
    if (error.message?.includes('Einwilligung')) ensureMessageConsent();
    throw error;
  }
}

async function sendMediaFile(file, { typeHint, durationMs = null, caption = '' } = {}) {
  const conversationId = state.activeConversationId;
  if (!conversationId || !file) return;
  if (!ensureMessageConsent()) return;
  if (!ensureMediaConsent()) return;

  const formData = new FormData();
  formData.append('file', file);
  if (caption) formData.append('body', caption);
  if (state.replyTo) formData.append('reply_to_id', state.replyTo.id);
  if (durationMs != null) formData.append('media_duration_ms', String(durationMs));
  if (typeHint) formData.append('type', typeHint);

  try {
    const data = await api(`/api/conversations/${conversationId}/media`, {
      method: 'POST',
      formData,
    });

    state.replyTo = null;
    updateReplyBar();
    upsertLocalMessage(data.message);

    const conversation = state.conversations.find((c) => c.id === conversationId);
    if (conversation) {
      conversation.last_message = previewFromMessage(data.message);
      state.conversations = [conversation, ...state.conversations.filter((c) => c.id !== conversationId)];
      renderConversationList();
    }
  } catch (error) {
    if (error.message?.includes('Medien')) ensureMediaConsent();
    else if (error.message?.includes('Einwilligung')) ensureMessageConsent();
    throw error;
  }
}

async function startVoiceRecording() {
  if (!state.activeConversationId) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Mikrofon nicht verfügbar');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
    state.mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    state.voiceChunks = [];
    state.voiceStartedAt = Date.now();

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) state.voiceChunks.push(event.data);
    };

    state.mediaRecorder.start();
    els.composer.classList.add('is-hidden');
    els.voiceBar.classList.remove('is-hidden');
    els.btnVoice.classList.add('is-recording');
    els.voiceTimer.textContent = '0:00';
    state.voiceTimer = setInterval(() => {
      els.voiceTimer.textContent = formatDuration(Date.now() - state.voiceStartedAt);
    }, 250);
  } catch {
    showToast('Mikrofon-Zugriff abgelehnt');
  }
}

function stopVoiceTracks() {
  state.mediaRecorder?.stream?.getTracks?.().forEach((track) => track.stop());
}

function cancelVoiceRecording() {
  clearInterval(state.voiceTimer);
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.onstop = null;
    state.mediaRecorder.stop();
  }
  stopVoiceTracks();
  state.mediaRecorder = null;
  state.voiceChunks = [];
  els.voiceBar.classList.add('is-hidden');
  els.composer.classList.remove('is-hidden');
  els.btnVoice.classList.remove('is-recording');
}

function finishVoiceRecording(send) {
  clearInterval(state.voiceTimer);
  const recorder = state.mediaRecorder;
  if (!recorder) return;

  recorder.onstop = async () => {
    stopVoiceTracks();
    const duration = Date.now() - state.voiceStartedAt;
    const blob = new Blob(state.voiceChunks, { type: recorder.mimeType || 'audio/webm' });
    state.mediaRecorder = null;
    state.voiceChunks = [];
    els.voiceBar.classList.add('is-hidden');
    els.composer.classList.remove('is-hidden');
    els.btnVoice.classList.remove('is-recording');

    if (!send || duration < 500 || blob.size < 100) {
      showToast('Aufnahme zu kurz');
      return;
    }

    const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `voice.${ext}`, { type: blob.type || 'audio/webm' });
    try {
      await sendMediaFile(file, { typeHint: 'audio', durationMs: duration });
    } catch (error) {
      showToast(error.message);
    }
  };

  if (recorder.state !== 'inactive') recorder.stop();
}

function openNewChatDialog() {
  els.contactList.innerHTML =
    state.users
      .map((user) => {
        const online = state.onlineIds.has(user.id);
        return `
        <button type="button" class="contact-item" data-id="${user.id}">
          <div class="avatar ${online ? 'is-online' : ''}" style="background:linear-gradient(145deg, ${user.avatar_color}, color-mix(in srgb, ${user.avatar_color} 65%, #041f1d))">${initials(user.display_name)}</div>
          <div class="contact-main">
            <div class="contact-name">${escapeHtml(user.display_name)}</div>
            <div class="contact-status">${online ? 'online' : formatLastSeen(user.last_seen_at, { hidden: user.show_last_seen === false })}</div>
          </div>
        </button>`;
      })
      .join('') || '<p style="padding:16px;color:var(--muted);">Keine Kontakte.</p>';

  els.contactList.querySelectorAll('.contact-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      els.newChatDialog.close();
      const data = await api('/api/conversations', {
        method: 'POST',
        body: { user_id: btn.dataset.id },
      });
      const existingIdx = state.conversations.findIndex((c) => c.id === data.conversation.id);
      if (existingIdx >= 0) state.conversations[existingIdx] = data.conversation;
      else state.conversations.unshift(data.conversation);
      await openConversation(data.conversation.id);
    });
  });

  els.newChatDialog.showModal();
}

function openNewGroupDialog() {
  state.selectedGroupMembers = new Set();
  els.groupTitle.value = '';
  renderGroupContacts();
  els.newGroupDialog.showModal();
}

function renderGroupContacts() {
  els.groupContactList.innerHTML = state.users
    .map((user) => {
      const selected = state.selectedGroupMembers.has(user.id);
      return `
        <button type="button" class="contact-item has-check ${selected ? 'is-selected' : ''}" data-id="${user.id}">
          <div class="avatar" style="background:linear-gradient(145deg, ${user.avatar_color}, color-mix(in srgb, ${user.avatar_color} 65%, #041f1d))">${initials(user.display_name)}</div>
          <div class="contact-main">
            <div class="contact-name">${escapeHtml(user.display_name)}</div>
            <div class="contact-status">@${escapeHtml(user.username)}</div>
          </div>
          <div class="contact-check">${selected ? '✓' : ''}</div>
        </button>`;
    })
    .join('');

  els.groupContactList.querySelectorAll('.contact-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.selectedGroupMembers.has(btn.dataset.id)) state.selectedGroupMembers.delete(btn.dataset.id);
      else state.selectedGroupMembers.add(btn.dataset.id);
      renderGroupContacts();
    });
  });
}

els.authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.authTabs.forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const isLogin = tab.dataset.tab === 'login';
    els.loginForm.classList.toggle('is-hidden', !isLogin);
    els.registerForm.classList.toggle('is-hidden', isLogin);
    showAuthError('');
  });
});

async function handleAuthSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem(TOKEN_KEY, data.token);
  showApp();
  connectSocket();
  await Promise.all([refreshConversations(), refreshUsers(), refreshStatuses()]);
  ensureMessageConsent();
}

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthError('');
  const form = new FormData(els.loginForm);
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { username: form.get('username'), password: form.get('password') },
    });
    await handleAuthSuccess(data);
  } catch (error) {
    showAuthError(error.message);
  }
});

els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthError('');
  const form = new FormData(els.registerForm);
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: {
        username: form.get('username'),
        display_name: form.get('display_name'),
        password: form.get('password'),
        privacy_consent: form.get('privacy_consent') === 'on',
        age_confirmed: form.get('age_confirmed') === 'on',
        message_consent: form.get('message_consent') === 'on',
        media_consent: form.get('media_consent') === 'on',
        impulse_consent: form.get('impulse_consent') === 'on',
      },
    });
    await handleAuthSuccess(data);
  } catch (error) {
    showAuthError(error.message);
  }
});

els.btnLogout.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    /* ignore */
  }
  state.socket?.disconnect();
  state.socket = null;
  state.token = null;
  state.user = null;
  state.conversations = [];
  state.activeConversationId = null;
  localStorage.removeItem(TOKEN_KEY);
  showAuth();
});

els.btnNewChat.addEventListener('click', async () => {
  await refreshUsers();
  openNewChatDialog();
});

els.btnEmptyNew.addEventListener('click', async () => {
  await refreshUsers();
  openNewChatDialog();
});

els.btnNewGroup.addEventListener('click', async () => {
  await refreshUsers();
  openNewGroupDialog();
});

els.btnPrivacy.addEventListener('click', () => {
  openPrivacyDialog();
});

els.privacyLastSeen.addEventListener('change', async () => {
  try {
    const data = await api('/api/me/privacy', {
      method: 'PATCH',
      body: { show_last_seen: els.privacyLastSeen.checked },
    });
    state.user = data.user;
    showToast(els.privacyLastSeen.checked ? 'Zuletzt online sichtbar' : 'Zuletzt online ausgeblendet');
  } catch (error) {
    els.privacyLastSeen.checked = !els.privacyLastSeen.checked;
    showToast(error.message);
  }
});

els.privacyRetention.addEventListener('change', async () => {
  try {
    const data = await api('/api/me/privacy', {
      method: 'PATCH',
      body: { message_retention_days: Number(els.privacyRetention.value) },
    });
    state.user = data.user;
    showToast(`Nachrichten-Frist: ${els.privacyRetention.value} Tage`);
  } catch (error) {
    els.privacyRetention.value = String(state.user?.message_retention_days || 365);
    showToast(error.message);
  }
});

els.privacyRestrict?.addEventListener('change', async () => {
  try {
    const data = await api('/api/me/privacy', {
      method: 'PATCH',
      body: { processing_restricted: els.privacyRestrict.checked },
    });
    state.user = data.user;
    renderConsentStatus();
    showToast(
      els.privacyRestrict.checked
        ? 'Verarbeitung eingeschränkt (Art. 18)'
        : 'Einschränkung aufgehoben'
    );
  } catch (error) {
    els.privacyRestrict.checked = !els.privacyRestrict.checked;
    showToast(error.message);
  }
});

els.btnRevokeMessages?.addEventListener('click', () => revokeScope('messages'));
els.btnRevokeMedia?.addEventListener('click', () => revokeScope('media'));
els.btnRevokeImpulses?.addEventListener('click', () => revokeScope('impulses'));
els.btnGrantMessages?.addEventListener('click', () => grantScope('messages'));
els.btnGrantMedia?.addEventListener('click', () => grantScope('media'));
els.btnGrantImpulses?.addEventListener('click', () => grantScope('impulses'));

els.messageConsentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!els.messageConsentCheck.checked) return;
  try {
    const data = await api('/api/me/message-consent', {
      method: 'POST',
      body: { message_consent: true },
    });
    state.user = data.user;
    els.messageConsentDialog.close();
    showToast('Nachrichten-Einwilligung gespeichert');
  } catch (error) {
    showToast(error.message);
  }
});

els.btnExportData.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/me/export', {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Export fehlgeschlagen');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-datenexport-${state.user.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Datenexport gestartet');
  } catch (error) {
    showToast(error.message);
  }
});

els.btnDeleteAccount.addEventListener('click', async () => {
  const ok = confirm(
    'Konto wirklich unwiderruflich löschen? Nachrichten, Medien und Status werden entfernt.'
  );
  if (!ok) return;
  const again = prompt('Zur Bestätigung „LÖSCHEN“ eingeben');
  if (again !== 'LÖSCHEN') {
    showToast('Löschung abgebrochen');
    return;
  }
  try {
    await api('/api/me', { method: 'DELETE' });
    state.socket?.disconnect();
    state.socket = null;
    state.token = null;
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    els.privacyDialog.close();
    showAuth();
    showToast('Konto gelöscht');
  } catch (error) {
    showToast(error.message);
  }
});

els.btnAcceptStorage.addEventListener('click', () => {
  localStorage.setItem('relay_storage_notice', '1');
  els.storageBanner.classList.add('is-hidden');
});

els.btnCloseGroup.addEventListener('click', () => els.newGroupDialog.close());

els.newGroupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/conversations', {
      method: 'POST',
      body: {
        type: 'group',
        title: els.groupTitle.value,
        member_ids: [...state.selectedGroupMembers],
      },
    });
    els.newGroupDialog.close();
    state.conversations.unshift(data.conversation);
    await openConversation(data.conversation.id);
    showToast('Kreis erstellt');
  } catch (error) {
    showToast(error.message);
  }
});

els.btnPoll.addEventListener('click', () => {
  if (!state.activeConversationId) return;
  if (!ensureMessageConsent()) return;
  els.pollQuestion.value = '';
  els.pollForm.querySelectorAll('.poll-option').forEach((input) => {
    input.value = '';
  });
  els.pollDialog.showModal();
});

els.btnClosePoll.addEventListener('click', () => els.pollDialog.close());

els.pollForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const options = [...els.pollForm.querySelectorAll('.poll-option')]
    .map((input) => input.value.trim())
    .filter(Boolean);
  try {
    const data = await api(`/api/conversations/${state.activeConversationId}/messages`, {
      method: 'POST',
      body: {
        type: 'poll',
        body: els.pollQuestion.value.trim(),
        options,
        reply_to_id: state.replyTo?.id || null,
      },
    });
    state.replyTo = null;
    updateReplyBar();
    upsertLocalMessage(data.message);
    els.pollDialog.close();
  } catch (error) {
    showToast(error.message);
  }
});

els.btnAttach.addEventListener('click', () => {
  if (!state.activeConversationId) return;
  els.imageInput.click();
});

els.imageInput.addEventListener('change', async () => {
  const file = els.imageInput.files?.[0];
  els.imageInput.value = '';
  if (!file) return;
  try {
    await sendMediaFile(file, { typeHint: 'image' });
  } catch (error) {
    showToast(error.message);
  }
});

els.btnVoice.addEventListener('click', () => startVoiceRecording());
els.btnVoiceCancel.addEventListener('click', () => cancelVoiceRecording());
els.btnVoiceSend.addEventListener('click', () => finishVoiceRecording(true));

els.btnAddStatus.addEventListener('click', () => {
  if (!ensureImpulseConsent()) return;
  els.statusText.value = '';
  els.statusImage.value = '';
  els.statusDialog.showModal();
});

els.btnCloseStatus.addEventListener('click', () => els.statusDialog.close());
els.btnCloseViewer.addEventListener('click', () => els.statusViewer.close());

els.statusForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!ensureImpulseConsent()) return;
  const formData = new FormData();
  const text = els.statusText.value.trim();
  const file = els.statusImage.files?.[0];
  if (!text && !file) {
    showToast('Text oder Bild nötig');
    return;
  }
  if (file && !ensureMediaConsent()) return;
  if (text) formData.append('body', text);
  if (file) formData.append('file', file);
  formData.append('type', file ? 'image' : 'text');

  try {
    await api('/api/statuses', { method: 'POST', formData });
    els.statusDialog.close();
    await refreshStatuses();
    showToast('Status veröffentlicht');
  } catch (error) {
    showToast(error.message);
  }
});

els.btnBack.addEventListener('click', () => {
  els.appScreen.classList.remove('show-chat');
});

els.btnCancelReply.addEventListener('click', () => {
  state.replyTo = null;
  updateReplyBar();
});

els.chatSearch.addEventListener('input', () => {
  state.search = els.chatSearch.value;
  renderConversationList();
});

els.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = els.messageInput.value;
  els.messageInput.value = '';
  try {
    await sendMessage(body);
  } catch (error) {
    els.messageInput.value = body;
    showToast(error.message);
  }
});

els.messageInput.addEventListener('input', () => {
  if (!state.activeConversationId || !state.socket) return;
  state.socket.emit('typing:start', { conversation_id: state.activeConversationId });
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    state.socket?.emit('typing:stop', { conversation_id: state.activeConversationId });
  }, 1200);
});

bootstrapSession();
maybeShowStorageBanner();
