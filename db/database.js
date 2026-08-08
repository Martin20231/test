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
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
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
      created_at      TEXT NOT NULL,
      delivered_at    TEXT,
      read_at         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_members_user
      ON conversation_members(user_id);
  `);

  seedDemoUsers(db);
  return db;
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

function pickAvatarColor(username) {
  const digest = createHash('sha256').update(username.toLowerCase()).digest();
  return AVATAR_COLORS[digest[0] % AVATAR_COLORS.length];
}

function seedDemoUsers(database) {
  const count = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const insert = database.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt, avatar_color, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    created_at: nowIso(),
  };

  getDb()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, avatar_color, status, created_at)
       VALUES (@id, @username, @display_name, @password_hash, @password_salt, @avatar_color, @status, @created_at)`
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
      `SELECT id, username, display_name, avatar_color, status, created_at
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
       WHERE (
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
    getDb().prepare('INSERT INTO conversations (id, created_at) VALUES (?, ?)').run(id, createdAt);
    const insertMember = getDb().prepare(
      'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
    );
    insertMember.run(id, userA);
    insertMember.run(id, userB);
  });
  tx();

  return getConversationForUser(id, userA);
}

export function listConversations(userId) {
  const rows = getDb()
    .prepare(
      `SELECT c.id AS conversation_id, c.created_at
       FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(userId);

  return rows
    .map((row) => getConversationForUser(row.conversation_id, userId))
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

  const peer = getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.created_at
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ? AND m.user_id != ?`
    )
    .get(conversationId, userId);

  const created = getDb()
    .prepare('SELECT created_at FROM conversations WHERE id = ?')
    .get(conversationId);

  const lastMessage = getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, created_at, delivered_at, read_at
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
         AND read_at IS NULL`
    )
    .get(conversationId, userId).count;

  return {
    id: conversationId,
    created_at: created.created_at,
    peer: peer ? publicUser(peer) : null,
    last_message: lastMessage || null,
    unread_count: unread,
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
      `SELECT id, conversation_id, sender_id, body, created_at, delivered_at, read_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(conversationId, Math.min(Number(limit) || 100, 300));

  return messages;
}

export function createMessage(conversationId, senderId, body) {
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

  const message = {
    id: newId('m_'),
    conversation_id: conversationId,
    sender_id: senderId,
    body: clean,
    created_at: nowIso(),
    delivered_at: null,
    read_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, created_at, delivered_at, read_at)
       VALUES (@id, @conversation_id, @sender_id, @body, @created_at, @delivered_at, @read_at)`
    )
    .run(message);

  return message;
}

export function markMessagesDelivered(conversationId, readerId) {
  const result = getDb()
    .prepare(
      `UPDATE messages
       SET delivered_at = COALESCE(delivered_at, ?)
       WHERE conversation_id = ?
         AND sender_id != ?
         AND delivered_at IS NULL`
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
         AND read_at IS NULL`
    )
    .run(stamp, stamp, conversationId, readerId);

  return getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, created_at, delivered_at, read_at
       FROM messages
       WHERE conversation_id = ?
         AND sender_id != ?
         AND read_at = ?`
    )
    .all(conversationId, readerId, stamp);
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
    created_at: row.created_at,
  };
}
