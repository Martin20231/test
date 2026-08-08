import Database from 'better-sqlite3';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'relay.db');

let db;

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase() {
  mkdirSync(dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      avatar_color  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT '',
      last_seen_at  TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL DEFAULT 'direct',
      title      TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body            TEXT NOT NULL,
      reply_to_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL,
      edited_at       TEXT,
      deleted_at      TEXT,
      delivered_at    TEXT,
      read_at         TEXT
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_members_user
      ON conversation_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_message
      ON message_reactions(message_id);
  `);

  migrateSchema(db);
  seedDemoUsers(db);
  return db;
}

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrateSchema(database) {
  const userCols = tableColumns(database, 'users');
  if (!userCols.includes('last_seen_at')) {
    database.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT');
  }

  const convCols = tableColumns(database, 'conversations');
  if (!convCols.includes('type')) {
    database.exec(`ALTER TABLE conversations ADD COLUMN type TEXT NOT NULL DEFAULT 'direct'`);
  }
  if (!convCols.includes('title')) {
    database.exec('ALTER TABLE conversations ADD COLUMN title TEXT');
  }
  if (!convCols.includes('created_by')) {
    database.exec('ALTER TABLE conversations ADD COLUMN created_by TEXT');
  }

  const msgCols = tableColumns(database, 'messages');
  if (!msgCols.includes('reply_to_id')) {
    database.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT');
  }
  if (!msgCols.includes('edited_at')) {
    database.exec('ALTER TABLE messages ADD COLUMN edited_at TEXT');
  }
  if (!msgCols.includes('deleted_at')) {
    database.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
  }
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function newId(prefix = '') {
  return `${prefix}${randomBytes(12).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

const AVATAR_COLORS = [
  '#0D7377',
  '#14919B',
  '#C45C26',
  '#2D6A4F',
  '#B5651D',
  '#1B4965',
  '#9B2226',
  '#386641',
];

const ALLOWED_REACTIONS = new Set(['❤️', '👍', '😂', '😮', '😢', '🔥']);

function pickAvatarColor(username) {
  const digest = createHash('sha256').update(username.toLowerCase()).digest();
  return AVATAR_COLORS[digest[0] % AVATAR_COLORS.length];
}

function seedDemoUsers(database) {
  const count = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const insert = database.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt, avatar_color, status, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demos = [
    { username: 'anna', displayName: 'Anna Weber', status: 'Kaffee zuerst ☕' },
    { username: 'ben', displayName: 'Ben Hoffmann', status: 'Unterwegs' },
    { username: 'clara', displayName: 'Clara Meier', status: 'Musik an' },
    { username: 'david', displayName: 'David Klein', status: 'Feierabend?' },
  ];

  const createdAt = nowIso();
  for (const demo of demos) {
    const { hash, salt } = hashPassword('demo');
    insert.run(
      newId('u_'),
      demo.username,
      demo.displayName,
      hash,
      salt,
      pickAvatarColor(demo.username),
      demo.status,
      null,
      createdAt
    );
  }
}

export function createUser({ username, displayName, password }) {
  const cleanUser = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  const cleanName = String(displayName || '').trim();

  if (cleanUser.length < 3 || cleanUser.length > 24) {
    throw Object.assign(new Error('Benutzername muss 3–24 Zeichen haben.'), { status: 400 });
  }
  if (cleanName.length < 2 || cleanName.length > 40) {
    throw Object.assign(new Error('Anzeigename muss 2–40 Zeichen haben.'), { status: 400 });
  }
  if (String(password || '').length < 4) {
    throw Object.assign(new Error('Passwort muss mindestens 4 Zeichen haben.'), { status: 400 });
  }

  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
  if (existing) {
    throw Object.assign(new Error('Benutzername ist bereits vergeben.'), { status: 409 });
  }

  const { hash, salt } = hashPassword(password);
  const user = {
    id: newId('u_'),
    username: cleanUser,
    display_name: cleanName,
    avatar_color: pickAvatarColor(cleanUser),
    status: '',
    last_seen_at: null,
    created_at: nowIso(),
  };

  getDb()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, avatar_color, status, last_seen_at, created_at)
       VALUES (@id, @username, @display_name, @password_hash, @password_salt, @avatar_color, @status, @last_seen_at, @created_at)`
    )
    .run({
      ...user,
      password_hash: hash,
      password_salt: salt,
    });

  return publicUser(user);
}

export function authenticateUser(username, password) {
  const user = getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username || '').trim().toLowerCase());

  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    throw Object.assign(new Error('Benutzername oder Passwort ist falsch.'), { status: 401 });
  }

  return publicUser(user);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)')
    .run(token, userId, nowIso());
  return token;
}

export function getUserByToken(token) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  return row ? publicUser(row) : null;
}

export function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function listUsers(excludeUserId) {
  return getDb()
    .prepare(
      `SELECT id, username, display_name, avatar_color, status, last_seen_at, created_at
       FROM users
       WHERE id != ?
       ORDER BY display_name COLLATE NOCASE`
    )
    .all(excludeUserId)
    .map(publicUser);
}

export function getUserById(id) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? publicUser(row) : null;
}

export function updateStatus(userId, status) {
  const clean = String(status || '').trim().slice(0, 80);
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(clean, userId);
  return getUserById(userId);
}

export function touchLastSeen(userId) {
  const stamp = nowIso();
  getDb().prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(stamp, userId);
  return stamp;
}

export function findOrCreateDirectConversation(userA, userB) {
  if (userA === userB) {
    throw Object.assign(new Error('Du kannst keinen Chat mit dir selbst starten.'), { status: 400 });
  }

  const existing = getDb()
    .prepare(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
       WHERE COALESCE(c.type, 'direct') = 'direct'
         AND (
           SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id
         ) = 2`
    )
    .get(userA, userB);

  if (existing) {
    return getConversationForUser(existing.id, userA);
  }

  const id = newId('c_');
  const createdAt = nowIso();
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO conversations (id, type, title, created_by, created_at)
         VALUES (?, 'direct', NULL, ?, ?)`
      )
      .run(id, userA, createdAt);
    const insertMember = getDb().prepare(
      'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
    );
    insertMember.run(id, userA);
    insertMember.run(id, userB);
  });
  tx();

  return getConversationForUser(id, userA);
}

export function createGroupConversation(creatorId, title, memberIds = []) {
  const cleanTitle = String(title || '').trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 40) {
    throw Object.assign(new Error('Gruppenname muss 2–40 Zeichen haben.'), { status: 400 });
  }

  const uniqueMembers = [...new Set([creatorId, ...memberIds.filter(Boolean)])];
  if (uniqueMembers.length < 2) {
    throw Object.assign(new Error('Wähle mindestens eine weitere Person.'), { status: 400 });
  }

  for (const memberId of uniqueMembers) {
    if (!getUserById(memberId)) {
      throw Object.assign(new Error('Ein Mitglied existiert nicht.'), { status: 400 });
    }
  }

  const id = newId('c_');
  const createdAt = nowIso();
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO conversations (id, type, title, created_by, created_at)
         VALUES (?, 'group', ?, ?, ?)`
      )
      .run(id, cleanTitle, creatorId, createdAt);
    const insertMember = getDb().prepare(
      'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
    );
    for (const memberId of uniqueMembers) {
      insertMember.run(id, memberId);
    }
  });
  tx();

  return getConversationForUser(id, creatorId);
}

export function listConversations(userId) {
  const rows = getDb()
    .prepare(
      `SELECT c.id AS conversation_id
       FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?`
    )
    .all(userId);

  return rows
    .map((row) => getConversationForUser(row.conversation_id, userId))
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.last_message?.created_at || a.created_at;
      const bTime = b.last_message?.created_at || b.created_at;
      return bTime.localeCompare(aTime);
    });
}

export function getConversationForUser(conversationId, userId) {
  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(conversationId, userId);
  if (!membership) return null;

  const conversation = getDb()
    .prepare('SELECT id, type, title, created_by, created_at FROM conversations WHERE id = ?')
    .get(conversationId);

  const members = getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.last_seen_at, u.created_at
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?
       ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(conversationId)
    .map(publicUser);

  const peer =
    conversation.type === 'direct'
      ? members.find((member) => member.id !== userId) || null
      : null;

  const lastMessageRow = getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(conversationId);

  const unread = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM messages
       WHERE conversation_id = ?
         AND sender_id != ?
         AND read_at IS NULL
         AND deleted_at IS NULL`
    )
    .get(conversationId, userId).count;

  return {
    id: conversationId,
    type: conversation.type || 'direct',
    title: conversation.title,
    created_by: conversation.created_by,
    created_at: conversation.created_at,
    peer,
    members,
    last_message: lastMessageRow ? formatMessagePreview(lastMessageRow) : null,
    unread_count: unread,
  };
}

function formatMessagePreview(row) {
  if (!row) return null;
  if (row.deleted_at) {
    return {
      ...row,
      body: 'Nachricht gelöscht',
    };
  }
  return row;
}

function getReactionsMap(messageIds) {
  if (!messageIds.length) return new Map();
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT message_id, user_id, emoji
       FROM message_reactions
       WHERE message_id IN (${placeholders})`
    )
    .all(...messageIds);

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push({ user_id: row.user_id, emoji: row.emoji });
  }
  return map;
}

function hydrateMessage(row, reactionsMap, usersById) {
  const reply = row.reply_to_id
    ? getDb()
        .prepare(
          `SELECT id, sender_id, body, deleted_at
           FROM messages WHERE id = ?`
        )
        .get(row.reply_to_id)
    : null;

  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sender_name: usersById.get(row.sender_id)?.display_name || null,
    body: deleted ? '' : row.body,
    reply_to: reply
      ? {
          id: reply.id,
          sender_id: reply.sender_id,
          sender_name: usersById.get(reply.sender_id)?.display_name || null,
          body: reply.deleted_at ? 'Nachricht gelöscht' : reply.body,
        }
      : null,
    created_at: row.created_at,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
    reactions: reactionsMap.get(row.id) || [],
  };
}

export function listMessages(conversationId, userId, { limit = 100 } = {}) {
  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(conversationId, userId);
  if (!membership) {
    throw Object.assign(new Error('Chat nicht gefunden.'), { status: 404 });
  }

  const messages = getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(conversationId, Math.min(Number(limit) || 100, 300));

  const users = getDb()
    .prepare(
      `SELECT u.id, u.display_name
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?`
    )
    .all(conversationId);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const reactionsMap = getReactionsMap(messages.map((m) => m.id));

  return messages.map((row) => hydrateMessage(row, reactionsMap, usersById));
}

export function getMessageById(messageId) {
  const row = getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at
       FROM messages WHERE id = ?`
    )
    .get(messageId);
  if (!row) return null;

  const users = getDb()
    .prepare(
      `SELECT u.id, u.display_name
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?`
    )
    .all(row.conversation_id);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const reactionsMap = getReactionsMap([row.id]);
  return hydrateMessage(row, reactionsMap, usersById);
}

export function createMessage(conversationId, senderId, body, replyToId = null) {
  const clean = String(body || '').trim();
  if (!clean) {
    throw Object.assign(new Error('Nachricht darf nicht leer sein.'), { status: 400 });
  }
  if (clean.length > 2000) {
    throw Object.assign(new Error('Nachricht ist zu lang (max. 2000 Zeichen).'), { status: 400 });
  }

  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(conversationId, senderId);
  if (!membership) {
    throw Object.assign(new Error('Chat nicht gefunden.'), { status: 404 });
  }

  let replyId = null;
  if (replyToId) {
    const reply = getDb()
      .prepare('SELECT id, conversation_id, deleted_at FROM messages WHERE id = ?')
      .get(replyToId);
    if (!reply || reply.conversation_id !== conversationId || reply.deleted_at) {
      throw Object.assign(new Error('Antwort-Nachricht nicht gefunden.'), { status: 400 });
    }
    replyId = reply.id;
  }

  const raw = {
    id: newId('m_'),
    conversation_id: conversationId,
    sender_id: senderId,
    body: clean,
    reply_to_id: replyId,
    created_at: nowIso(),
    edited_at: null,
    deleted_at: null,
    delivered_at: null,
    read_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at)
       VALUES (@id, @conversation_id, @sender_id, @body, @reply_to_id, @created_at, @edited_at, @deleted_at, @delivered_at, @read_at)`
    )
    .run(raw);

  return getMessageById(raw.id);
}

export function editMessage(messageId, userId, body) {
  const clean = String(body || '').trim();
  if (!clean) {
    throw Object.assign(new Error('Nachricht darf nicht leer sein.'), { status: 400 });
  }
  if (clean.length > 2000) {
    throw Object.assign(new Error('Nachricht ist zu lang (max. 2000 Zeichen).'), { status: 400 });
  }

  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!row || row.deleted_at) {
    throw Object.assign(new Error('Nachricht nicht gefunden.'), { status: 404 });
  }
  if (row.sender_id !== userId) {
    throw Object.assign(new Error('Nur eigene Nachrichten bearbeiten.'), { status: 403 });
  }

  getDb()
    .prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')
    .run(clean, nowIso(), messageId);

  return getMessageById(messageId);
}

export function deleteMessage(messageId, userId) {
  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!row || row.deleted_at) {
    throw Object.assign(new Error('Nachricht nicht gefunden.'), { status: 404 });
  }
  if (row.sender_id !== userId) {
    throw Object.assign(new Error('Nur eigene Nachrichten löschen.'), { status: 403 });
  }

  getDb()
    .prepare('UPDATE messages SET deleted_at = ?, body = ? WHERE id = ?')
    .run(nowIso(), '', messageId);

  return getMessageById(messageId);
}

export function setReaction(messageId, userId, emoji) {
  if (!ALLOWED_REACTIONS.has(emoji)) {
    throw Object.assign(new Error('Reaktion nicht erlaubt.'), { status: 400 });
  }

  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!row || row.deleted_at) {
    throw Object.assign(new Error('Nachricht nicht gefunden.'), { status: 404 });
  }

  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(row.conversation_id, userId);
  if (!membership) {
    throw Object.assign(new Error('Chat nicht gefunden.'), { status: 404 });
  }

  const existing = getDb()
    .prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?')
    .get(messageId, userId);

  if (existing?.emoji === emoji) {
    getDb()
      .prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?')
      .run(messageId, userId);
  } else if (existing) {
    getDb()
      .prepare('UPDATE message_reactions SET emoji = ?, created_at = ? WHERE message_id = ? AND user_id = ?')
      .run(emoji, nowIso(), messageId, userId);
  } else {
    getDb()
      .prepare(
        'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(messageId, userId, emoji, nowIso());
  }

  return getMessageById(messageId);
}

export function markMessagesDelivered(conversationId, readerId) {
  const result = getDb()
    .prepare(
      `UPDATE messages
       SET delivered_at = COALESCE(delivered_at, ?)
       WHERE conversation_id = ?
         AND sender_id != ?
         AND delivered_at IS NULL
         AND deleted_at IS NULL`
    )
    .run(nowIso(), conversationId, readerId);
  return result.changes;
}

export function markMessagesRead(conversationId, readerId) {
  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE messages
       SET delivered_at = COALESCE(delivered_at, ?),
           read_at = ?
       WHERE conversation_id = ?
         AND sender_id != ?
         AND read_at IS NULL
         AND deleted_at IS NULL`
    )
    .run(stamp, stamp, conversationId, readerId);

  return getDb()
    .prepare(
      `SELECT id
       FROM messages
       WHERE conversation_id = ?
         AND sender_id != ?
         AND read_at = ?`
    )
    .all(conversationId, readerId, stamp)
    .map((row) => row.id);
}

export function getConversationMemberIds(conversationId) {
  return getDb()
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId)
    .map((row) => row.user_id);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    status: row.status || '',
    last_seen_at: row.last_seen_at || null,
    created_at: row.created_at,
  };
}
