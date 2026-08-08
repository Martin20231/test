const TOKEN_KEY = 'relay_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  socket: null,
  conversations: [],
  users: [],
  onlineIds: new Set(),
  activeConversationId: null,
  messages: [],
  typingTimeout: null,
  peerTyping: false,
  search: '',
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
  btnNewChat: document.getElementById('btn-new-chat'),
  btnEmptyNew: document.getElementById('btn-empty-new'),
  btnLogout: document.getElementById('btn-logout'),
  btnBack: document.getElementById('btn-back'),
  newChatDialog: document.getElementById('new-chat-dialog'),
  contactList: document.getElementById('contact-list'),
};

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function setAvatar(el, user, { online = false } = {}) {
  if (!user) return;
  el.textContent = initials(user.display_name || user.username);
  el.style.background = `linear-gradient(145deg, ${user.avatar_color}, color-mix(in srgb, ${user.avatar_color} 65%, #041f1d))`;
  el.classList.toggle('is-online', online);
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatListTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Heute';
  if (date.toDateString() === yesterday.toDateString()) return 'Gestern';
  return date.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function showAuthError(message) {
  els.authError.hidden = !message;
  els.authError.textContent = message || '';
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Anfrage fehlgeschlagen.');
  }
  return data;
}

function showApp() {
  els.authScreen.classList.add('is-hidden');
  els.appScreen.classList.remove('is-hidden');
  setAvatar(els.meAvatar, state.user, { online: true });
  els.meName.textContent = state.user.display_name;
}

function showAuth() {
  els.appScreen.classList.add('is-hidden');
  els.authScreen.classList.remove('is-hidden');
  els.appScreen.classList.remove('show-chat');
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({
    auth: { token: state.token },
  });

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

  state.socket.on('presence:offline', ({ user_id }) => {
    state.onlineIds.delete(user_id);
    renderConversationList();
    renderActiveHeader();
  });

  state.socket.on('presence:status', ({ user_id, status }) => {
    const user = state.users.find((u) => u.id === user_id);
    if (user) user.status = status;
    const conversation = state.conversations.find((c) => c.peer?.id === user_id);
    if (conversation?.peer) conversation.peer.status = status;
    renderConversationList();
    renderActiveHeader();
  });

  state.socket.on('message:new', async ({ message, conversation_id }) => {
    const existing = state.conversations.find((c) => c.id === conversation_id);
    if (!existing) {
      await refreshConversations();
    } else {
      existing.last_message = message;
      if (state.activeConversationId !== conversation_id && message.sender_id !== state.user.id) {
        existing.unread_count = (existing.unread_count || 0) + 1;
      }
      state.conversations = [
        existing,
        ...state.conversations.filter((c) => c.id !== conversation_id),
      ];
      renderConversationList();
    }

    if (state.activeConversationId === conversation_id) {
      if (!state.messages.some((m) => m.id === message.id)) {
        state.messages.push(message);
        appendMessage(message);
        scrollMessagesToBottom();
      }
      if (message.sender_id !== state.user.id) {
        await markRead(conversation_id);
      }
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

  state.socket.on('typing:start', ({ conversation_id, user_id }) => {
    if (conversation_id !== state.activeConversationId || user_id === state.user.id) return;
    state.peerTyping = true;
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
    await Promise.all([refreshConversations(), refreshUsers()]);
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
}

function renderConversationList() {
  const query = state.search.trim().toLowerCase();
  const items = state.conversations.filter((c) => {
    if (!query) return true;
    const hay = `${c.peer?.display_name || ''} ${c.peer?.username || ''} ${c.last_message?.body || ''}`.toLowerCase();
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
      const online = state.onlineIds.has(conversation.peer?.id);
      const preview = conversation.last_message?.body || 'Noch keine Nachrichten';
      const time = formatListTime(conversation.last_message?.created_at || conversation.created_at);
      const unread = conversation.unread_count > 0
        ? `<span class="unread-badge">${conversation.unread_count}</span>`
        : '';
      return `
        <button type="button" class="chat-item ${conversation.id === state.activeConversationId ? 'is-active' : ''}" data-id="${conversation.id}" role="listitem">
          <div class="avatar ${online ? 'is-online' : ''}" style="background:linear-gradient(145deg, ${conversation.peer.avatar_color}, color-mix(in srgb, ${conversation.peer.avatar_color} 65%, #041f1d))">${initials(conversation.peer.display_name)}</div>
          <div class="chat-item-main">
            <div class="chat-item-name">${escapeHtml(conversation.peer.display_name)}</div>
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

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function openConversation(conversationId) {
  state.activeConversationId = conversationId;
  state.peerTyping = false;
  els.typingIndicator.classList.add('is-hidden');
  els.appScreen.classList.add('show-chat');

  const data = await api(`/api/conversations/${conversationId}/messages`);
  const conversation = data.conversation;
  const idx = state.conversations.findIndex((c) => c.id === conversationId);
  if (idx >= 0) {
    state.conversations[idx] = { ...state.conversations[idx], ...conversation, unread_count: 0 };
  } else {
    state.conversations.unshift(conversation);
  }

  state.messages = data.messages || [];
  els.emptyState.classList.add('is-hidden');
  els.activeChat.classList.remove('is-hidden');
  renderActiveHeader();
  renderMessages();
  renderConversationList();
  await markRead(conversationId);
  els.messageInput.focus();
}

function renderActiveHeader() {
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  if (!conversation?.peer) return;

  const online = state.onlineIds.has(conversation.peer.id);
  setAvatar(els.peerAvatar, conversation.peer, { online });
  els.peerName.textContent = conversation.peer.display_name;

  if (state.peerTyping) {
    els.peerMeta.textContent = 'schreibt…';
  } else if (online) {
    els.peerMeta.textContent = conversation.peer.status
      ? `online · ${conversation.peer.status}`
      : 'online';
  } else {
    els.peerMeta.textContent = conversation.peer.status || `@${conversation.peer.username}`;
  }
}

function renderMessages() {
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
    appendMessage(message, false);
  }
  scrollMessagesToBottom(false);
}

function ticksFor(message) {
  if (message.sender_id !== state.user.id) return '';
  if (message.read_at) return '<span class="ticks is-read">✓✓</span>';
  if (message.delivered_at) return '<span class="ticks">✓✓</span>';
  return '<span class="ticks">✓</span>';
}

function appendMessage(message, animate = true) {
  const row = document.createElement('div');
  row.className = `message-row ${message.sender_id === state.user.id ? 'is-mine' : ''}`;
  if (!animate) row.style.animation = 'none';
  row.dataset.id = message.id;
  row.innerHTML = `
    <div class="bubble">
      <div class="bubble-body">${escapeHtml(message.body)}</div>
      <div class="bubble-meta">
        <span>${formatTime(message.created_at)}</span>
        ${ticksFor(message)}
      </div>
    </div>`;
  els.messageList.appendChild(row);
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

  const data = await api(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body },
  });

  if (!state.messages.some((m) => m.id === data.message.id)) {
    state.messages.push(data.message);
    appendMessage(data.message);
    scrollMessagesToBottom();
  }

  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (conversation) {
    conversation.last_message = data.message;
    state.conversations = [
      conversation,
      ...state.conversations.filter((c) => c.id !== conversationId),
    ];
    renderConversationList();
  }

  state.socket?.emit('typing:stop', { conversation_id: conversationId });
}

function openNewChatDialog() {
  const html = state.users
    .map((user) => {
      const online = state.onlineIds.has(user.id);
      return `
        <button type="button" class="contact-item" data-id="${user.id}">
          <div class="avatar ${online ? 'is-online' : ''}" style="background:linear-gradient(145deg, ${user.avatar_color}, color-mix(in srgb, ${user.avatar_color} 65%, #041f1d))">${initials(user.display_name)}</div>
          <div class="contact-main">
            <div class="contact-name">${escapeHtml(user.display_name)}</div>
            <div class="contact-status">${online ? 'online' : `@${escapeHtml(user.username)}`}${user.status ? ` · ${escapeHtml(user.status)}` : ''}</div>
          </div>
        </button>`;
    })
    .join('');

  els.contactList.innerHTML = html || '<p style="padding:16px;color:var(--muted);">Keine Kontakte.</p>';
  els.contactList.querySelectorAll('.contact-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      els.newChatDialog.close();
      const data = await api('/api/conversations', {
        method: 'POST',
        body: { user_id: btn.dataset.id },
      });
      const existingIdx = state.conversations.findIndex((c) => c.id === data.conversation.id);
      if (existingIdx >= 0) {
        state.conversations[existingIdx] = data.conversation;
      } else {
        state.conversations.unshift(data.conversation);
      }
      await openConversation(data.conversation.id);
    });
  });

  els.newChatDialog.showModal();
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

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthError('');
  const form = new FormData(els.loginForm);
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: {
        username: form.get('username'),
        password: form.get('password'),
      },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem(TOKEN_KEY, data.token);
    showApp();
    connectSocket();
    await Promise.all([refreshConversations(), refreshUsers()]);
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
      },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem(TOKEN_KEY, data.token);
    showApp();
    connectSocket();
    await Promise.all([refreshConversations(), refreshUsers()]);
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

els.btnBack.addEventListener('click', () => {
  els.appScreen.classList.remove('show-chat');
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
    alert(error.message);
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
