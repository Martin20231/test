import Database from 'better-sqlite3';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { decryptText, encryptText } from '../services/crypto.js';

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
      id                    TEXT PRIMARY KEY,
      username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name          TEXT NOT NULL,
      password_hash         TEXT NOT NULL,
      password_salt         TEXT NOT NULL,
      avatar_color          TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT '',
      last_seen_at          TEXT,
      show_last_seen        INTEGER NOT NULL DEFAULT 0,
      privacy_consent_at    TEXT,
      privacy_consent_version TEXT,
      message_consent_at    TEXT,
      media_consent_at      TEXT,
      impulse_consent_at    TEXT,
      message_retention_days INTEGER NOT NULL DEFAULT 30,
      processing_restricted INTEGER NOT NULL DEFAULT 0,
      public_key            TEXT,
      created_at            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS privacy_consents (
      id          TEXT PRIMARY KEY,
      user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      version     TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'policy',
      legal_basis TEXT,
      accepted_at TEXT NOT NULL,
      revoked_at  TEXT,
      ip_hash     TEXT,
      user_agent  TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
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
      id                 TEXT PRIMARY KEY,
      conversation_id    TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body               TEXT NOT NULL DEFAULT '',
      type               TEXT NOT NULL DEFAULT 'text',
      media_url          TEXT,
      media_duration_ms  INTEGER,
      reply_to_id        TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at         TEXT NOT NULL,
      edited_at          TEXT,
      deleted_at         TEXT,
      delivered_at       TEXT,
      read_at            TEXT
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL DEFAULT 'text',
      body        TEXT NOT NULL DEFAULT '',
      media_url   TEXT,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_views (
      status_id  TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
      viewer_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at  TEXT NOT NULL,
      PRIMARY KEY (status_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS pinned_messages (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      pinned_by       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pinned_at       TEXT NOT NULL,
      PRIMARY KEY (conversation_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id          TEXT PRIMARY KEY,
      message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      option_id   TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (option_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_members_user
      ON conversation_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_message
      ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_statuses_expires
      ON statuses(expires_at);
    CREATE INDEX IF NOT EXISTS idx_pins_conversation
      ON pinned_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_poll_options_message
      ON poll_options(message_id);
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
  if (!userCols.includes('show_last_seen')) {
    database.exec('ALTER TABLE users ADD COLUMN show_last_seen INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('privacy_consent_at')) {
    database.exec('ALTER TABLE users ADD COLUMN privacy_consent_at TEXT');
  }
  if (!userCols.includes('privacy_consent_version')) {
    database.exec('ALTER TABLE users ADD COLUMN privacy_consent_version TEXT');
  }
  if (!userCols.includes('message_consent_at')) {
    database.exec('ALTER TABLE users ADD COLUMN message_consent_at TEXT');
  }
  if (!userCols.includes('media_consent_at')) {
    database.exec('ALTER TABLE users ADD COLUMN media_consent_at TEXT');
  }
  if (!userCols.includes('impulse_consent_at')) {
    database.exec('ALTER TABLE users ADD COLUMN impulse_consent_at TEXT');
  }
  if (!userCols.includes('message_retention_days')) {
    database.exec('ALTER TABLE users ADD COLUMN message_retention_days INTEGER NOT NULL DEFAULT 30');
  }
  if (!userCols.includes('processing_restricted')) {
    database.exec('ALTER TABLE users ADD COLUMN processing_restricted INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('public_key')) {
    database.exec('ALTER TABLE users ADD COLUMN public_key TEXT');
  }

  const consentCols = tableColumns(database, 'privacy_consents');
  if (!consentCols.includes('scope')) {
    database.exec(`ALTER TABLE privacy_consents ADD COLUMN scope TEXT NOT NULL DEFAULT 'policy'`);
  }
  if (!consentCols.includes('legal_basis')) {
    database.exec('ALTER TABLE privacy_consents ADD COLUMN legal_basis TEXT');
  }
  if (!consentCols.includes('revoked_at')) {
    database.exec('ALTER TABLE privacy_consents ADD COLUMN revoked_at TEXT');
  }

  const sessionCols = tableColumns(database, 'sessions');
  if (!sessionCols.includes('expires_at')) {
    database.exec('ALTER TABLE sessions ADD COLUMN expires_at TEXT');
    database
      .prepare(
        `UPDATE sessions
         SET expires_at = datetime(created_at, '+30 days')
         WHERE expires_at IS NULL OR expires_at = ''`
      )
      .run();
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
  if (!msgCols.includes('type')) {
    database.exec(`ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text'`);
  }
  if (!msgCols.includes('media_url')) {
    database.exec('ALTER TABLE messages ADD COLUMN media_url TEXT');
  }
  if (!msgCols.includes('media_duration_ms')) {
    database.exec('ALTER TABLE messages ADD COLUMN media_duration_ms INTEGER');
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

const PRIVACY_POLICY_VERSION = '2026-08-08.4';
const DEFAULT_MESSAGE_RETENTION_DAYS = 30;
const SESSION_DAYS = 30;
const ALLOWED_RETENTION_DAYS = new Set([7, 30, 90, 180]);
const E2E_PREFIX = 'e2e:v1:';
const CONSENT_SCOPES = new Set(['policy', 'messages', 'media', 'impulses']);
const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥', '👏']);
const REVOCABLE_SCOPES = new Set(['messages', 'media', 'impulses', 'all']);

function isE2EBody(value) {
  return String(value || '').startsWith(E2E_PREFIX);
}

function storeMessageBody(plainOrCipher) {
  const text = String(plainOrCipher || '');
  if (isE2EBody(text)) return text;
  return encryptText(text);
}

function revealStoredBody(stored) {
  const text = String(stored || '');
  if (isE2EBody(text)) return text;
  return decryptText(text);
}

export function getPrivacyPolicyVersion() {
  return PRIVACY_POLICY_VERSION;
}

export function getMessagePrivacyInfo() {
  return {
    legal_basis_contract: 'Art. 6 Abs. 1 lit. b DSGVO',
    legal_basis_consent: 'Art. 6 Abs. 1 lit. a DSGVO',
    purpose:
      'Zustellung von Chat-Nachrichten; Inhalte möglichst nur als Ciphertext auf dem Server',
    storage_limitation: 'Art. 5 Abs. 1 lit. e DSGVO',
    integrity_confidentiality: 'Art. 32 DSGVO (E2E clientseitig, Passwort-Hashing, Session-Timeout)',
    default_retention_days: DEFAULT_MESSAGE_RETENTION_DAYS,
    allowed_retention_days: [...ALLOWED_RETENTION_DAYS],
    e2e_encryption: true,
    encryption_at_rest: true,
    privacy_by_default: true,
    note:
      'Textnachrichten und Medien werden clientseitig Ende-zu-Ende verschlüsselt. Der Server speichert Ciphertext und kann Inhalte nicht lesen. Private Schlüssel liegen nur im Browser.',
  };
}

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

export function createUser({
  username,
  displayName,
  password,
  privacyConsent,
  messageConsent,
  mediaConsent,
  impulseConsent,
  ageConfirmed,
  requestMeta = {},
}) {
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
  if (String(password || '').length < 8) {
    throw Object.assign(new Error('Passwort muss mindestens 8 Zeichen haben.'), { status: 400 });
  }
  if (!ageConfirmed) {
    throw Object.assign(new Error('Du musst bestätigen, mindestens 16 Jahre alt zu sein.'), {
      status: 400,
    });
  }
  if (!privacyConsent) {
    throw Object.assign(new Error('Bitte der Datenschutzerklärung zustimmen.'), { status: 400 });
  }
  if (!messageConsent) {
    throw Object.assign(
      new Error(
        'Bitte der Verarbeitung von Nachrichten zustimmen (Art. 6 Abs. 1 lit. a und lit. b DSGVO).'
      ),
      { status: 400 }
    );
  }
  if (!mediaConsent) {
    throw Object.assign(
      new Error('Bitte der Verarbeitung von Medien (Bilder/Sprachnotizen) zustimmen.'),
      { status: 400 }
    );
  }
  if (!impulseConsent) {
    throw Object.assign(new Error('Bitte der Verarbeitung von Impulsen zustimmen.'), {
      status: 400,
    });
  }

  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
  if (existing) {
    throw Object.assign(new Error('Benutzername ist bereits vergeben.'), { status: 409 });
  }

  const { hash, salt } = hashPassword(password);
  const consentAt = nowIso();
  const user = {
    id: newId('u_'),
    username: cleanUser,
    display_name: cleanName,
    avatar_color: pickAvatarColor(cleanUser),
    status: '',
    last_seen_at: null,
    show_last_seen: 0,
    privacy_consent_at: consentAt,
    privacy_consent_version: PRIVACY_POLICY_VERSION,
    message_consent_at: consentAt,
    media_consent_at: consentAt,
    impulse_consent_at: consentAt,
    message_retention_days: DEFAULT_MESSAGE_RETENTION_DAYS,
    processing_restricted: 0,
    created_at: consentAt,
  };

  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO users (
           id, username, display_name, password_hash, password_salt, avatar_color, status,
           last_seen_at, show_last_seen, privacy_consent_at, privacy_consent_version,
           message_consent_at, media_consent_at, impulse_consent_at, message_retention_days,
           processing_restricted, created_at
         ) VALUES (
           @id, @username, @display_name, @password_hash, @password_salt, @avatar_color, @status,
           @last_seen_at, @show_last_seen, @privacy_consent_at, @privacy_consent_version,
           @message_consent_at, @media_consent_at, @impulse_consent_at, @message_retention_days,
           @processing_restricted, @created_at
         )`
      )
      .run({
        ...user,
        password_hash: hash,
        password_salt: salt,
      });

    insertConsent(user.id, 'policy', 'Art. 6 Abs. 1 lit. a DSGVO', consentAt, requestMeta);
    insertConsent(
      user.id,
      'messages',
      'Art. 6 Abs. 1 lit. a DSGVO i. V. m. Art. 6 Abs. 1 lit. b DSGVO',
      consentAt,
      requestMeta
    );
    insertConsent(user.id, 'media', 'Art. 6 Abs. 1 lit. a DSGVO', consentAt, requestMeta);
    insertConsent(user.id, 'impulses', 'Art. 6 Abs. 1 lit. a DSGVO', consentAt, requestMeta);
  });
  tx();

  return publicUser(user, { includePrivate: true });
}

function insertConsent(userId, scope, legalBasis, acceptedAt, requestMeta = {}) {
  getDb()
    .prepare(
      `INSERT INTO privacy_consents (id, user_id, version, scope, legal_basis, accepted_at, revoked_at, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      newId('pc_'),
      userId,
      PRIVACY_POLICY_VERSION,
      scope,
      legalBasis,
      acceptedAt,
      requestMeta.ipHash || null,
      String(requestMeta.userAgent || '').slice(0, 300) || null
    );
}

export function authenticateUser(username, password) {
  const user = getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username || '').trim().toLowerCase());

  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    throw Object.assign(new Error('Benutzername oder Passwort ist falsch.'), { status: 401 });
  }

  return publicUser(user, { includePrivate: true });
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, createdAt, expiresAt);
  return token;
}

export function getUserByToken(token) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.*, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (row.session_expires_at && row.session_expires_at < nowIso()) {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return publicUser(row, { includePrivate: true });
}

export function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function listUsers(excludeUserId) {
  return getDb()
    .prepare(
      `SELECT id, username, display_name, avatar_color, status, last_seen_at, show_last_seen, public_key, created_at
       FROM users
       WHERE id != ?
       ORDER BY display_name COLLATE NOCASE`
    )
    .all(excludeUserId)
    .map((row) => publicUser(row, { forPeer: true }));
}

export function getUserById(id, { includePrivate = false, forPeer = false } = {}) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? publicUser(row, { includePrivate, forPeer }) : null;
}

export function updateStatus(userId, status) {
  const clean = String(status || '').trim().slice(0, 80);
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(clean, userId);
  return getUserById(userId, { includePrivate: true });
}

export function updatePrivacySettings(
  userId,
  { showLastSeen, messageRetentionDays, processingRestricted } = {}
) {
  if (typeof showLastSeen === 'boolean') {
    getDb()
      .prepare('UPDATE users SET show_last_seen = ? WHERE id = ?')
      .run(showLastSeen ? 1 : 0, userId);
  }

  if (messageRetentionDays != null) {
    const days = Number(messageRetentionDays);
    if (!ALLOWED_RETENTION_DAYS.has(days)) {
      throw Object.assign(
        new Error('Ungültige Aufbewahrungsfrist für Nachrichten (erlaubt: 7/30/90/180 Tage).'),
        { status: 400 }
      );
    }
    getDb().prepare('UPDATE users SET message_retention_days = ? WHERE id = ?').run(days, userId);
  }

  if (typeof processingRestricted === 'boolean') {
    getDb()
      .prepare('UPDATE users SET processing_restricted = ? WHERE id = ?')
      .run(processingRestricted ? 1 : 0, userId);
  }

  return getUserById(userId, { includePrivate: true });
}

export function touchLastSeen(userId) {
  const stamp = nowIso();
  getDb().prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(stamp, userId);
  return stamp;
}

export function updatePublicKey(userId, publicKey) {
  let serialized = '';
  if (publicKey == null || publicKey === '') {
    serialized = '';
  } else if (typeof publicKey === 'string') {
    serialized = publicKey.trim();
  } else {
    serialized = JSON.stringify(publicKey);
  }
  if (serialized && serialized.length > 4000) {
    throw Object.assign(new Error('Public Key ist ungültig oder zu groß.'), { status: 400 });
  }
  if (serialized) {
    try {
      const parsed = JSON.parse(serialized);
      if (!parsed.kty || !parsed.x || !parsed.y || parsed.crv !== 'P-256') {
        throw new Error('bad key');
      }
    } catch {
      throw Object.assign(new Error('Public Key muss ein gültiger P-256 JWK sein.'), {
        status: 400,
      });
    }
  }
  getDb()
    .prepare('UPDATE users SET public_key = ? WHERE id = ?')
    .run(serialized || null, userId);
  return getUserById(userId, { includePrivate: true });
}

export function getConversationMemberKeys(conversationId) {
  return getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.public_key
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?`
    )
    .all(conversationId)
    .map((row) => ({
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      public_key: row.public_key ? JSON.parse(row.public_key) : null,
    }));
}

export function findOrCreateDirectConversation(userA, userB) {
  if (userA === userB) {
    throw Object.assign(new Error('Du kannst keinen Chat mit dir selbst starten.'), { status: 400 });
  }
  if (!getUserById(userB)) {
    throw Object.assign(new Error('Kontakt nicht gefunden.'), { status: 404 });
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
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.last_seen_at, u.show_last_seen, u.public_key, u.created_at
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?
       ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(conversationId)
    .map((row) => publicUser(row, { forPeer: true }));

  const peer =
    conversation.type === 'direct'
      ? members.find((member) => member.id !== userId) || null
      : null;

  const lastMessageRow = getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, type, media_url, media_duration_ms, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at
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
    pinned_messages: listPinnedMessages(conversationId, userId),
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
  if (isE2EBody(row.body)) {
    if (row.type === 'image') return { ...row, body: 'Verschlüsseltes Bild', e2e: true };
    if (row.type === 'audio') return { ...row, body: 'Verschlüsselte Sprachnotiz', e2e: true };
    if (row.type === 'poll') return { ...row, body: 'Verschlüsselte Umfrage', e2e: true };
    return { ...row, body: 'Verschlüsselte Nachricht', e2e: true };
  }
  const plain = revealStoredBody(row.body || '');
  if (row.type === 'image') {
    return { ...row, body: plain ? `Bild: ${plain}` : 'Bild' };
  }
  if (row.type === 'audio') {
    return { ...row, body: 'Sprachnotiz' };
  }
  if (row.type === 'poll') {
    return { ...row, body: `Umfrage: ${plain}` };
  }
  return { ...row, body: plain };
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
          `SELECT id, sender_id, body, type, deleted_at
           FROM messages WHERE id = ?`
        )
        .get(row.reply_to_id)
    : null;

  const deleted = Boolean(row.deleted_at);
  let replyBody = '';
  let replyE2e = false;
  if (reply) {
    if (reply.deleted_at) replyBody = 'Nachricht gelöscht';
    else if (isE2EBody(reply.body)) {
      replyE2e = true;
      replyBody = reply.body || '';
    } else {
      const replyPlain = revealStoredBody(reply.body || '');
      if (reply.type === 'image') replyBody = replyPlain || 'Bild';
      else if (reply.type === 'audio') replyBody = 'Sprachnotiz';
      else if (reply.type === 'poll') replyBody = `Umfrage: ${replyPlain}`;
      else replyBody = replyPlain;
    }
  }

  const poll = !deleted && row.type === 'poll' ? getPollForMessage(row.id, null) : null;
  const e2e = !deleted && isE2EBody(row.body);
  const plainBody = deleted ? '' : e2e ? row.body || '' : revealStoredBody(row.body || '');

  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sender_name: usersById.get(row.sender_id)?.display_name || null,
    body: plainBody,
    e2e,
    type: row.type || 'text',
    media_url: deleted ? null : row.media_url || null,
    media_duration_ms: row.media_duration_ms || null,
    reply_to: reply
      ? {
          id: reply.id,
          sender_id: reply.sender_id,
          sender_name: usersById.get(reply.sender_id)?.display_name || null,
          body: replyBody,
          e2e: replyE2e,
          type: reply.type || 'text',
        }
      : null,
    created_at: row.created_at,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
    reactions: reactionsMap.get(row.id) || [],
    poll,
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
      `SELECT id, conversation_id, sender_id, body, type, media_url, media_duration_ms, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at
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
  const pinnedIds = new Set(
    getDb()
      .prepare('SELECT message_id FROM pinned_messages WHERE conversation_id = ?')
      .all(conversationId)
      .map((row) => row.message_id)
  );

  return messages.map((row) => {
    const message = hydrateMessage(row, reactionsMap, usersById);
    if (message.poll) message.poll = getPollForMessage(row.id, userId);
    message.pinned = pinnedIds.has(row.id);
    return message;
  });
}

export function getMessageById(messageId) {
  const row = getDb()
    .prepare(
      `SELECT id, conversation_id, sender_id, body, type, media_url, media_duration_ms, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at
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

export function createMessage(
  conversationId,
  senderId,
  { body = '', replyToId = null, type = 'text', mediaUrl = null, mediaDurationMs = null } = {}
) {
  const sender = getDb().prepare('SELECT * FROM users WHERE id = ?').get(senderId);
  if (!sender) {
    throw Object.assign(new Error('Benutzer nicht gefunden.'), { status: 404 });
  }
  if (sender.processing_restricted) {
    throw Object.assign(
      new Error('Verarbeitung eingeschränkt (Art. 18 DSGVO). Neue Nachrichten sind pausiert.'),
      { status: 403, code: 'PROCESSING_RESTRICTED' }
    );
  }
  if (!sender.message_consent_at) {
    throw Object.assign(
      new Error(
        'Ohne Einwilligung zur Nachrichtenverarbeitung können keine Chats gesendet werden (Art. 6 Abs. 1 lit. a/b DSGVO).'
      ),
      { status: 403, code: 'MESSAGE_CONSENT_REQUIRED' }
    );
  }

  const msgType = ['text', 'image', 'audio', 'poll'].includes(type) ? type : 'text';
  if ((msgType === 'image' || msgType === 'audio') && !sender.media_consent_at) {
    throw Object.assign(
      new Error('Ohne Medien-Einwilligung können keine Bilder/Sprachnotizen gesendet werden.'),
      { status: 403, code: 'MEDIA_CONSENT_REQUIRED' }
    );
  }
  const clean = String(body || '').trim();
  const e2e = isE2EBody(clean);

  if ((msgType === 'text' || msgType === 'poll') && !clean) {
    throw Object.assign(new Error('Nachricht darf nicht leer sein.'), { status: 400 });
  }
  if ((msgType === 'image' || msgType === 'audio') && !mediaUrl) {
    throw Object.assign(new Error('Medien-Datei fehlt.'), { status: 400 });
  }
  if (!e2e && clean.length > 2000) {
    throw Object.assign(new Error('Nachricht ist zu lang (max. 2000 Zeichen).'), { status: 400 });
  }
  if (e2e && clean.length > 20000) {
    throw Object.assign(new Error('Verschlüsselte Nachricht ist zu groß.'), { status: 400 });
  }
  if ((msgType === 'image' || msgType === 'audio') && !e2e) {
    throw Object.assign(
      new Error('Medien müssen Ende-zu-Ende verschlüsselt gesendet werden.'),
      { status: 400, code: 'E2E_REQUIRED' }
    );
  }
  if ((msgType === 'text' || msgType === 'poll') && !e2e) {
    throw Object.assign(
      new Error('Nachrichten müssen Ende-zu-Ende verschlüsselt gesendet werden.'),
      { status: 400, code: 'E2E_REQUIRED' }
    );
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
    body: storeMessageBody(clean),
    type: msgType,
    media_url: mediaUrl,
    media_duration_ms: mediaDurationMs,
    reply_to_id: replyId,
    created_at: nowIso(),
    edited_at: null,
    deleted_at: null,
    delivered_at: null,
    read_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, type, media_url, media_duration_ms, reply_to_id, created_at, edited_at, deleted_at, delivered_at, read_at)
       VALUES (@id, @conversation_id, @sender_id, @body, @type, @media_url, @media_duration_ms, @reply_to_id, @created_at, @edited_at, @deleted_at, @delivered_at, @read_at)`
    )
    .run(raw);

  return getMessageById(raw.id);
}

export function editMessage(messageId, userId, body) {
  const clean = String(body || '').trim();
  if (!clean) {
    throw Object.assign(new Error('Nachricht darf nicht leer sein.'), { status: 400 });
  }
  const e2e = isE2EBody(clean);
  if (!e2e && clean.length > 2000) {
    throw Object.assign(new Error('Nachricht ist zu lang (max. 2000 Zeichen).'), { status: 400 });
  }
  if (e2e && clean.length > 20000) {
    throw Object.assign(new Error('Verschlüsselte Nachricht ist zu groß.'), { status: 400 });
  }
  if (!e2e) {
    throw Object.assign(new Error('Bearbeitungen müssen Ende-zu-Ende verschlüsselt sein.'), {
      status: 400,
      code: 'E2E_REQUIRED',
    });
  }

  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!row || row.deleted_at) {
    throw Object.assign(new Error('Nachricht nicht gefunden.'), { status: 404 });
  }
  if (row.sender_id !== userId) {
    throw Object.assign(new Error('Nur eigene Nachrichten bearbeiten.'), { status: 403 });
  }
  if ((row.type || 'text') !== 'text') {
    throw Object.assign(new Error('Nur Textnachrichten können bearbeitet werden.'), { status: 400 });
  }

  getDb()
    .prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')
    .run(storeMessageBody(clean), nowIso(), messageId);

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
    .prepare('UPDATE messages SET deleted_at = ?, body = ?, media_url = NULL WHERE id = ?')
    .run(nowIso(), '', messageId);

  const message = getMessageById(messageId);
  return { ...message, media_url_deleted: row.media_url || null };
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

export function createStatus(userId, { type = 'text', body = '', mediaUrl = null } = {}) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw Object.assign(new Error('Benutzer nicht gefunden.'), { status: 404 });
  }
  if (user.processing_restricted) {
    throw Object.assign(new Error('Verarbeitung eingeschränkt (Art. 18 DSGVO).'), { status: 403 });
  }
  if (!user.impulse_consent_at) {
    throw Object.assign(new Error('Ohne Impuls-Einwilligung keine Status-Posts.'), {
      status: 403,
      code: 'IMPULSE_CONSENT_REQUIRED',
    });
  }

  const statusType = ['text', 'image'].includes(type) ? type : 'text';
  if (statusType === 'image' && !user.media_consent_at) {
    throw Object.assign(new Error('Ohne Medien-Einwilligung keine Impuls-Bilder.'), {
      status: 403,
      code: 'MEDIA_CONSENT_REQUIRED',
    });
  }
  const clean = String(body || '').trim();

  if (statusType === 'text' && !clean) {
    throw Object.assign(new Error('Status-Text fehlt.'), { status: 400 });
  }
  if (statusType === 'image' && !mediaUrl) {
    throw Object.assign(new Error('Status-Bild fehlt.'), { status: 400 });
  }
  if (clean.length > 300) {
    throw Object.assign(new Error('Status ist zu lang (max. 300 Zeichen).'), { status: 400 });
  }

  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const id = newId('s_');

  getDb()
    .prepare(
      `INSERT INTO statuses (id, user_id, type, body, media_url, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      statusType,
      isE2EBody(clean) ? clean : encryptText(clean),
      mediaUrl,
      createdAt,
      expiresAt
    );

  return getStatusById(id, userId);
}

export function getStatusById(statusId, viewerId) {
  const row = getDb()
    .prepare(
      `SELECT s.*, u.username, u.display_name, u.avatar_color
       FROM statuses s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(statusId);
  if (!row) return null;
  return hydrateStatus(row, viewerId);
}

function hydrateStatus(row, viewerId) {
  const views = getDb()
    .prepare('SELECT COUNT(*) AS count FROM status_views WHERE status_id = ?')
    .get(row.id).count;
  const viewed = viewerId
    ? Boolean(
        getDb()
          .prepare('SELECT 1 AS ok FROM status_views WHERE status_id = ? AND viewer_id = ?')
          .get(row.id, viewerId)
      )
    : false;

  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    body: isE2EBody(row.body) ? row.body || '' : decryptText(row.body || ''),
    e2e: isE2EBody(row.body),
    media_url: row.media_url,
    created_at: row.created_at,
    expires_at: row.expires_at,
    view_count: views,
    viewed,
    user: {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
    },
  };
}

export function listActiveStatuses(viewerId) {
  getDb().prepare(`DELETE FROM statuses WHERE expires_at < ?`).run(nowIso());

  const rows = getDb()
    .prepare(
      `SELECT s.*, u.username, u.display_name, u.avatar_color
       FROM statuses s
       JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > ?
       ORDER BY s.created_at DESC`
    )
    .all(nowIso());

  return rows.map((row) => hydrateStatus(row, viewerId));
}

export function createPoll(conversationId, senderId, { question, options = [], replyToId = null }) {
  const labels = (options || [])
    .map((label) => String(label || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  if (labels.length < 2) {
    throw Object.assign(new Error('Eine Umfrage braucht mindestens 2 Antworten.'), { status: 400 });
  }

  const message = createMessage(conversationId, senderId, {
    body: String(question || '').trim(),
    type: 'poll',
    replyToId,
  });

  const insert = getDb().prepare(
    `INSERT INTO poll_options (id, message_id, label, position) VALUES (?, ?, ?, ?)`
  );
  labels.forEach((label, index) => {
    insert.run(newId('po_'), message.id, label, index);
  });

  return getMessageByIdForUser(message.id, senderId);
}

export function getPollForMessage(messageId, viewerId = null) {
  const options = getDb()
    .prepare(
      `SELECT id, label, position
       FROM poll_options
       WHERE message_id = ?
       ORDER BY position ASC`
    )
    .all(messageId);

  if (!options.length) return null;

  const votes = getDb()
    .prepare(
      `SELECT v.option_id, v.user_id
       FROM poll_votes v
       JOIN poll_options o ON o.id = v.option_id
       WHERE o.message_id = ?`
    )
    .all(messageId);

  const counts = new Map();
  let myVote = null;
  for (const vote of votes) {
    counts.set(vote.option_id, (counts.get(vote.option_id) || 0) + 1);
    if (viewerId && vote.user_id === viewerId) myVote = vote.option_id;
  }

  const total = votes.length;
  return {
    options: options.map((option) => ({
      id: option.id,
      label: option.label,
      votes: counts.get(option.id) || 0,
      percent: total ? Math.round(((counts.get(option.id) || 0) / total) * 100) : 0,
    })),
    total_votes: total,
    my_vote: myVote,
  };
}

export function getMessageByIdForUser(messageId, userId) {
  const message = getMessageById(messageId);
  if (!message) return null;
  if (message.poll) message.poll = getPollForMessage(messageId, userId);
  const pinned = getDb()
    .prepare(
      'SELECT 1 AS ok FROM pinned_messages WHERE conversation_id = ? AND message_id = ?'
    )
    .get(message.conversation_id, messageId);
  message.pinned = Boolean(pinned);
  return message;
}

export function votePoll(messageId, userId, optionId) {
  const message = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message || message.deleted_at || message.type !== 'poll') {
    throw Object.assign(new Error('Umfrage nicht gefunden.'), { status: 404 });
  }

  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(message.conversation_id, userId);
  if (!membership) {
    throw Object.assign(new Error('Chat nicht gefunden.'), { status: 404 });
  }

  const option = getDb()
    .prepare('SELECT * FROM poll_options WHERE id = ? AND message_id = ?')
    .get(optionId, messageId);
  if (!option) {
    throw Object.assign(new Error('Antwortoption nicht gefunden.'), { status: 400 });
  }

  const tx = getDb().transaction(() => {
    const existingOptions = getDb()
      .prepare('SELECT id FROM poll_options WHERE message_id = ?')
      .all(messageId)
      .map((row) => row.id);
    if (existingOptions.length) {
      const placeholders = existingOptions.map(() => '?').join(',');
      getDb()
        .prepare(
          `DELETE FROM poll_votes WHERE user_id = ? AND option_id IN (${placeholders})`
        )
        .run(userId, ...existingOptions);
    }
    getDb()
      .prepare('INSERT INTO poll_votes (option_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(optionId, userId, nowIso());
  });
  tx();

  return getMessageByIdForUser(messageId, userId);
}

export function pinMessage(conversationId, messageId, userId) {
  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(conversationId, userId);
  if (!membership) {
    throw Object.assign(new Error('Chat nicht gefunden.'), { status: 404 });
  }

  const message = getDb()
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId);
  if (!message || message.deleted_at) {
    throw Object.assign(new Error('Nachricht nicht gefunden.'), { status: 404 });
  }

  const count = getDb()
    .prepare('SELECT COUNT(*) AS count FROM pinned_messages WHERE conversation_id = ?')
    .get(conversationId).count;
  if (count >= 3) {
    throw Object.assign(new Error('Maximal 3 angeheftete Nachrichten pro Chat.'), { status: 400 });
  }

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO pinned_messages (conversation_id, message_id, pinned_by, pinned_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(conversationId, messageId, userId, nowIso());

  return getMessageByIdForUser(messageId, userId);
}

export function unpinMessage(conversationId, messageId, userId) {
  const membership = getDb()
    .prepare(
      'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    )
    .get(conversationId, userId);
  if (!membership) {
    throw Object.assign(new Error('Chat nicht gefunden.'), { status: 404 });
  }

  getDb()
    .prepare('DELETE FROM pinned_messages WHERE conversation_id = ? AND message_id = ?')
    .run(conversationId, messageId);

  return getMessageByIdForUser(messageId, userId);
}

export function listPinnedMessages(conversationId, userId) {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.type, m.media_url, m.media_duration_ms,
              m.reply_to_id, m.created_at, m.edited_at, m.deleted_at, m.delivered_at, m.read_at,
              p.pinned_at
       FROM pinned_messages p
       JOIN messages m ON m.id = p.message_id
       WHERE p.conversation_id = ?
       ORDER BY p.pinned_at DESC`
    )
    .all(conversationId);

  return rows.map((row) => {
    const message = getMessageByIdForUser(row.id, userId);
    return message ? { ...message, pinned_at: row.pinned_at, pinned: true } : null;
  }).filter(Boolean);
}

export function markStatusViewed(statusId, viewerId) {
  const status = getDb().prepare('SELECT * FROM statuses WHERE id = ?').get(statusId);
  if (!status || status.expires_at < nowIso()) {
    throw Object.assign(new Error('Status nicht gefunden.'), { status: 404 });
  }

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO status_views (status_id, viewer_id, viewed_at)
       VALUES (?, ?, ?)`
    )
    .run(statusId, viewerId, nowIso());

  return getStatusById(statusId, viewerId);
}

export function exportUserData(userId) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw Object.assign(new Error('Benutzer nicht gefunden.'), { status: 404 });
  }

  const consents = getDb()
    .prepare(
      `SELECT id, version, scope, legal_basis, accepted_at, revoked_at, ip_hash, user_agent
       FROM privacy_consents WHERE user_id = ? ORDER BY accepted_at DESC`
    )
    .all(userId);

  const conversations = listConversations(userId).map((c) => ({
    id: c.id,
    type: c.type,
    title: c.title,
    created_at: c.created_at,
    members: (c.members || []).map((m) => ({
      id: m.id,
      username: m.username,
      display_name: m.display_name,
    })),
  }));

  const messages = getDb()
    .prepare(
      `SELECT id, conversation_id, body, type, media_url, media_duration_ms, reply_to_id,
              created_at, edited_at, deleted_at, delivered_at, read_at
       FROM messages
       WHERE sender_id = ?
       ORDER BY created_at ASC`
    )
    .all(userId)
    .map((row) => ({
      ...row,
      body: row.deleted_at
        ? ''
        : isE2EBody(row.body)
          ? row.body
          : revealStoredBody(row.body || ''),
      e2e: isE2EBody(row.body),
    }));

  const reactions = getDb()
    .prepare(
      `SELECT message_id, emoji, created_at
       FROM message_reactions WHERE user_id = ?
       ORDER BY created_at ASC`
    )
    .all(userId);

  const statuses = getDb()
    .prepare(
      `SELECT id, type, body, media_url, created_at, expires_at
       FROM statuses WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .all(userId)
    .map((row) => ({
      ...row,
      body: isE2EBody(row.body) ? row.body : decryptText(row.body || ''),
      e2e: isE2EBody(row.body),
    }));

  return {
    exported_at: nowIso(),
    privacy_policy_version: PRIVACY_POLICY_VERSION,
    legal_basis: 'Art. 15 und Art. 20 DSGVO',
    message_privacy: getMessagePrivacyInfo(),
    user: publicUser(user, { includePrivate: true }),
    consents,
    conversations,
    messages,
    reactions,
    statuses,
    note:
      'Datenkopie nach Art. 15/20 DSGVO. Passwort-Hashes fehlen. E2E-Nachrichten erscheinen als Ciphertext — Klartext nur im Browser mit privatem Schlüssel.',
  };
}

export function deleteUserAccount(userId) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw Object.assign(new Error('Benutzer nicht gefunden.'), { status: 404 });
  }

  const mediaUrls = getDb()
    .prepare(
      `SELECT media_url AS url FROM messages WHERE sender_id = ? AND media_url IS NOT NULL
       UNION
       SELECT media_url AS url FROM statuses WHERE user_id = ? AND media_url IS NOT NULL`
    )
    .all(userId, userId)
    .map((row) => row.url)
    .filter(Boolean);

  const memberConversations = getDb()
    .prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?')
    .all(userId)
    .map((row) => row.conversation_id);

  const tx = getDb().transaction(() => {
    getDb().prepare('DELETE FROM message_reactions WHERE user_id = ?').run(userId);
    getDb().prepare('DELETE FROM status_views WHERE viewer_id = ?').run(userId);
    getDb()
      .prepare(
        `DELETE FROM status_views
         WHERE status_id IN (SELECT id FROM statuses WHERE user_id = ?)`
      )
      .run(userId);
    getDb().prepare('DELETE FROM statuses WHERE user_id = ?').run(userId);
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    // Soft-delete own messages and strip media/content
    getDb()
      .prepare(
        `UPDATE messages
         SET body = '',
             media_url = NULL,
             deleted_at = COALESCE(deleted_at, ?)
         WHERE sender_id = ?`
      )
      .run(nowIso(), userId);

    getDb().prepare('DELETE FROM conversation_members WHERE user_id = ?').run(userId);

    for (const conversationId of memberConversations) {
      const remaining = getDb()
        .prepare(
          'SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ?'
        )
        .get(conversationId).count;
      const conv = getDb()
        .prepare('SELECT type FROM conversations WHERE id = ?')
        .get(conversationId);
      if (!conv) continue;
      if (remaining === 0 || (conv.type === 'direct' && remaining < 2)) {
        getDb().prepare('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)').run(conversationId);
        getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
        getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
      }
    }

    getDb().prepare('UPDATE privacy_consents SET user_id = NULL WHERE user_id = ?').run(userId);
    getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();

  return { deleted: true, media_urls: mediaUrls };
}

export function recordPrivacyConsent(userId, requestMeta = {}) {
  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET privacy_consent_at = ?, privacy_consent_version = ?
       WHERE id = ?`
    )
    .run(stamp, PRIVACY_POLICY_VERSION, userId);

  insertConsent(userId, 'policy', 'Art. 6 Abs. 1 lit. a DSGVO', stamp, requestMeta);
  return getUserById(userId, { includePrivate: true });
}

export function recordMessageConsent(userId, requestMeta = {}) {
  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET message_consent_at = ?,
           privacy_consent_version = ?,
           message_retention_days = COALESCE(message_retention_days, ?)
       WHERE id = ?`
    )
    .run(stamp, PRIVACY_POLICY_VERSION, DEFAULT_MESSAGE_RETENTION_DAYS, userId);

  insertConsent(
    userId,
    'messages',
    'Art. 6 Abs. 1 lit. a DSGVO i. V. m. Art. 6 Abs. 1 lit. b DSGVO',
    stamp,
    requestMeta
  );
  return getUserById(userId, { includePrivate: true });
}

export function recordMediaConsent(userId, requestMeta = {}) {
  const stamp = nowIso();
  getDb()
    .prepare('UPDATE users SET media_consent_at = ?, privacy_consent_version = ? WHERE id = ?')
    .run(stamp, PRIVACY_POLICY_VERSION, userId);
  insertConsent(userId, 'media', 'Art. 6 Abs. 1 lit. a DSGVO', stamp, requestMeta);
  return getUserById(userId, { includePrivate: true });
}

export function recordImpulseConsent(userId, requestMeta = {}) {
  const stamp = nowIso();
  getDb()
    .prepare('UPDATE users SET impulse_consent_at = ?, privacy_consent_version = ? WHERE id = ?')
    .run(stamp, PRIVACY_POLICY_VERSION, userId);
  insertConsent(userId, 'impulses', 'Art. 6 Abs. 1 lit. a DSGVO', stamp, requestMeta);
  return getUserById(userId, { includePrivate: true });
}

export function revokeConsent(userId, scope, requestMeta = {}) {
  const cleanScope = String(scope || '').trim().toLowerCase();
  if (!REVOCABLE_SCOPES.has(cleanScope)) {
    throw Object.assign(
      new Error('Ungültiger Widerrufs-Scope (messages, media, impulses oder all).'),
      { status: 400 }
    );
  }

  const stamp = nowIso();
  const tx = getDb().transaction(() => {
    if (cleanScope === 'messages' || cleanScope === 'all') {
      getDb().prepare('UPDATE users SET message_consent_at = NULL WHERE id = ?').run(userId);
      getDb()
        .prepare(
          `UPDATE privacy_consents SET revoked_at = ?
           WHERE user_id = ? AND scope = 'messages' AND revoked_at IS NULL`
        )
        .run(stamp, userId);
    }
    if (cleanScope === 'media' || cleanScope === 'all') {
      getDb().prepare('UPDATE users SET media_consent_at = NULL WHERE id = ?').run(userId);
      getDb()
        .prepare(
          `UPDATE privacy_consents SET revoked_at = ?
           WHERE user_id = ? AND scope = 'media' AND revoked_at IS NULL`
        )
        .run(stamp, userId);
    }
    if (cleanScope === 'impulses' || cleanScope === 'all') {
      getDb().prepare('UPDATE users SET impulse_consent_at = NULL WHERE id = ?').run(userId);
      getDb()
        .prepare(
          `UPDATE privacy_consents SET revoked_at = ?
           WHERE user_id = ? AND scope = 'impulses' AND revoked_at IS NULL`
        )
        .run(stamp, userId);
    }

    insertConsent(
      userId,
      `revoke_${cleanScope}`,
      'Art. 7 Abs. 3 DSGVO',
      stamp,
      requestMeta
    );
  });
  tx();

  return getUserById(userId, { includePrivate: true });
}

export function cleanupExpiredSessions() {
  return getDb()
    .prepare(
      `DELETE FROM sessions
       WHERE expires_at IS NOT NULL AND expires_at != '' AND expires_at < ?`
    )
    .run(nowIso()).changes;
}

export function listReferencedUploadUrls() {
  const fromMessages = getDb()
    .prepare('SELECT media_url AS url FROM messages WHERE media_url IS NOT NULL')
    .all()
    .map((row) => row.url);
  const fromStatuses = getDb()
    .prepare('SELECT media_url AS url FROM statuses WHERE media_url IS NOT NULL')
    .all()
    .map((row) => row.url);
  return new Set([...fromMessages, ...fromStatuses].filter(Boolean));
}

export function purgeExpiredMessagesByRetention() {
  const users = getDb()
    .prepare('SELECT id, message_retention_days FROM users')
    .all();

  const deletedMedia = [];
  let deletedCount = 0;

  const selectExpired = getDb().prepare(
    `SELECT id, media_url
     FROM messages
     WHERE sender_id = ?
       AND deleted_at IS NULL
       AND created_at < ?`
  );
  const softDelete = getDb().prepare(
    `UPDATE messages
     SET deleted_at = ?, body = '', media_url = NULL
     WHERE id = ?`
  );

  const tx = getDb().transaction(() => {
    for (const user of users) {
      const days = Number(user.message_retention_days) || DEFAULT_MESSAGE_RETENTION_DAYS;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const rows = selectExpired.all(user.id, cutoff);
      for (const row of rows) {
        if (row.media_url) deletedMedia.push(row.media_url);
        softDelete.run(nowIso(), row.id);
        deletedCount += 1;
      }
    }
  });
  tx();

  return { deleted_count: deletedCount, media_urls: deletedMedia };
}

function publicUser(row, { includePrivate = false, forPeer = false } = {}) {
  const showLastSeen = Boolean(row.show_last_seen);
  let publicKey = null;
  if (row.public_key) {
    try {
      publicKey = typeof row.public_key === 'string' ? JSON.parse(row.public_key) : row.public_key;
    } catch {
      publicKey = null;
    }
  }
  const base = {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    status: row.status || '',
    created_at: row.created_at,
    public_key: publicKey,
    has_e2e_key: Boolean(publicKey),
  };

  if (forPeer) {
    return {
      ...base,
      last_seen_at: showLastSeen ? row.last_seen_at || null : null,
      show_last_seen: showLastSeen,
    };
  }

  if (includePrivate) {
    return {
      ...base,
      last_seen_at: row.last_seen_at || null,
      show_last_seen: showLastSeen,
      privacy_consent_at: row.privacy_consent_at || null,
      privacy_consent_version: row.privacy_consent_version || null,
      message_consent_at: row.message_consent_at || null,
      media_consent_at: row.media_consent_at || null,
      impulse_consent_at: row.impulse_consent_at || null,
      message_retention_days:
        row.message_retention_days == null
          ? DEFAULT_MESSAGE_RETENTION_DAYS
          : Number(row.message_retention_days),
      processing_restricted: Boolean(row.processing_restricted),
      has_message_consent: Boolean(row.message_consent_at),
      has_media_consent: Boolean(row.media_consent_at),
      has_impulse_consent: Boolean(row.impulse_consent_at),
      session_ttl_days: SESSION_DAYS,
      e2e_enabled: true,
    };
  }

  return {
    ...base,
    last_seen_at: showLastSeen ? row.last_seen_at || null : null,
    show_last_seen: showLastSeen,
  };
}
