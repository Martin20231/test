import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  createUser,
  authenticateUser,
  createSession,
  getUserByToken,
  deleteSession,
  listUsers,
  updateStatus,
  updatePrivacySettings,
  touchLastSeen,
  findOrCreateDirectConversation,
  createGroupConversation,
  listConversations,
  getConversationForUser,
  listMessages,
  createMessage,
  editMessage,
  deleteMessage,
  setReaction,
  markMessagesDelivered,
  markMessagesRead,
  getConversationMemberIds,
  createStatus,
  listActiveStatuses,
  markStatusViewed,
  exportUserData,
  deleteUserAccount,
  recordPrivacyConsent,
  getPrivacyPolicyVersion,
} from './db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT ?? 3000;
const UPLOAD_DIR = join(__dirname, 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });
initDatabase();

const onlineUsers = new Map();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname || '').toLowerCase() || guessExt(file.mimetype);
    cb(null, `${Date.now()}_${randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'video/webm';
    cb(ok ? null : new Error('Nur Bilder oder Audio erlaubt.'), ok);
  },
});

function guessExt(mime = '') {
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('wav')) return '.wav';
  return '';
}

function hashIp(ip = '') {
  if (!ip) return null;
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

function requestMeta(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = String(forwarded || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
  return {
    ipHash: hashIp(ip),
    userAgent: req.headers['user-agent'] || '',
  };
}

function unlinkUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const file = join(UPLOAD_DIR, basename(url));
  if (existsSync(file)) {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

const io = new Server(httpServer, {
  cors: { origin: true },
  maxHttpBufferSize: 1e7,
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' ws: wss:;"
  );

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));
app.use(express.static(join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  req.user = user;
  req.token = token;
  next();
}

function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Interner Fehler.' });
}

function emitToConversation(conversationId, event, payload) {
  const memberIds = getConversationMemberIds(conversationId);
  for (const memberId of memberIds) {
    io.to(`user:${memberId}`).emit(event, payload);
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'relay' });
});

app.get('/api/privacy/policy-version', (_req, res) => {
  res.json({
    version: getPrivacyPolicyVersion(),
    url: '/datenschutz.html',
  });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const user = createUser({
      username: req.body.username,
      displayName: req.body.display_name || req.body.displayName,
      password: req.body.password,
      privacyConsent: Boolean(req.body.privacy_consent),
      ageConfirmed: Boolean(req.body.age_confirmed),
      requestMeta: requestMeta(req),
    });
    const token = createSession(user.id);
    res.status(201).json({ token, user });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const user = authenticateUser(req.body.username, req.body.password);
    const token = createSession(user.id);
    res.json({ token, user });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  touchLastSeen(req.user.id);
  deleteSession(req.token);
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({
    user: req.user,
    online_user_ids: [...onlineUsers.keys()],
    privacy_policy_version: getPrivacyPolicyVersion(),
  });
});

app.patch('/api/me/status', authMiddleware, (req, res) => {
  try {
    const user = updateStatus(req.user.id, req.body.status);
    io.emit('presence:status', { user_id: user.id, status: user.status });
    res.json({ user });
  } catch (error) {
    sendError(res, error);
  }
});

app.patch('/api/me/privacy', authMiddleware, (req, res) => {
  try {
    const user = updatePrivacySettings(req.user.id, {
      showLastSeen: req.body.show_last_seen,
    });
    io.emit('presence:privacy', {
      user_id: user.id,
      show_last_seen: user.show_last_seen,
      last_seen_at: user.show_last_seen ? user.last_seen_at : null,
    });
    res.json({ user });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/me/privacy-consent', authMiddleware, (req, res) => {
  try {
    const user = recordPrivacyConsent(req.user.id, requestMeta(req));
    res.json({ user, version: getPrivacyPolicyVersion() });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/me/export', authMiddleware, (req, res) => {
  try {
    const data = exportUserData(req.user.id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="relay-datenexport-${req.user.username}.json"`
    );
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/me', authMiddleware, (req, res) => {
  try {
    const result = deleteUserAccount(req.user.id);
    for (const url of result.media_urls || []) unlinkUpload(url);
    const sockets = onlineUsers.get(req.user.id);
    if (sockets) {
      for (const socketId of sockets) {
        io.sockets.sockets.get(socketId)?.disconnect(true);
      }
      onlineUsers.delete(req.user.id);
    }
    io.emit('presence:offline', { user_id: req.user.id, last_seen_at: null });
    res.json({ ok: true, deleted: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/users', authMiddleware, (req, res) => {
  res.json({
    users: listUsers(req.user.id),
    online_user_ids: [...onlineUsers.keys()],
  });
});

app.get('/api/conversations', authMiddleware, (req, res) => {
  res.json({ conversations: listConversations(req.user.id) });
});

app.post('/api/conversations', authMiddleware, (req, res) => {
  try {
    if (req.body.type === 'group') {
      const conversation = createGroupConversation(
        req.user.id,
        req.body.title,
        req.body.member_ids || []
      );
      emitToConversation(conversation.id, 'conversation:upsert', {
        conversation_id: conversation.id,
      });
      return res.status(201).json({ conversation });
    }

    const peerId = req.body.user_id || req.body.peer_id;
    if (!peerId) {
      return res.status(400).json({ error: 'user_id fehlt.' });
    }
    const conversation = findOrCreateDirectConversation(req.user.id, peerId);
    res.status(201).json({ conversation });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  try {
    const conversation = getConversationForUser(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Chat nicht gefunden.' });
    }
    markMessagesDelivered(req.params.id, req.user.id);
    const messages = listMessages(req.params.id, req.user.id);
    res.json({ conversation, messages });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  try {
    const message = createMessage(req.params.id, req.user.id, {
      body: req.body.body,
      replyToId: req.body.reply_to_id || null,
      type: req.body.type || 'text',
      mediaUrl: req.body.media_url || null,
      mediaDurationMs: req.body.media_duration_ms || null,
    });
    emitToConversation(req.params.id, 'message:new', {
      message,
      conversation_id: req.params.id,
    });
    res.status(201).json({ message });
  } catch (error) {
    sendError(res, error);
  }
});

app.post(
  '/api/conversations/:id/media',
  authMiddleware,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload fehlgeschlagen.' });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Datei fehlt.' });
      }

      const mime = req.file.mimetype || '';
      const type = mime.startsWith('image/') ? 'image' : 'audio';
      const mediaUrl = `/uploads/${req.file.filename}`;
      const duration = req.body.media_duration_ms
        ? Number(req.body.media_duration_ms)
        : null;

      const message = createMessage(req.params.id, req.user.id, {
        body: req.body.body || '',
        replyToId: req.body.reply_to_id || null,
        type,
        mediaUrl,
        mediaDurationMs: Number.isFinite(duration) ? duration : null,
      });

      emitToConversation(req.params.id, 'message:new', {
        message,
        conversation_id: req.params.id,
      });
      res.status(201).json({ message });
    } catch (error) {
      sendError(res, error);
    }
  }
);

app.patch('/api/messages/:id', authMiddleware, (req, res) => {
  try {
    const message = editMessage(req.params.id, req.user.id, req.body.body);
    emitToConversation(message.conversation_id, 'message:updated', { message });
    res.json({ message });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  try {
    const message = deleteMessage(req.params.id, req.user.id);
    if (message.media_url_deleted) unlinkUpload(message.media_url_deleted);
    emitToConversation(message.conversation_id, 'message:updated', { message });
    res.json({ message });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/messages/:id/reactions', authMiddleware, (req, res) => {
  try {
    const message = setReaction(req.params.id, req.user.id, req.body.emoji);
    emitToConversation(message.conversation_id, 'message:updated', { message });
    res.json({ message });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/conversations/:id/read', authMiddleware, (req, res) => {
  try {
    const messageIds = markMessagesRead(req.params.id, req.user.id);
    const memberIds = getConversationMemberIds(req.params.id);
    for (const memberId of memberIds) {
      if (memberId === req.user.id) continue;
      io.to(`user:${memberId}`).emit('message:read', {
        conversation_id: req.params.id,
        message_ids: messageIds,
        reader_id: req.user.id,
        read_at: new Date().toISOString(),
      });
    }
    res.json({ updated: messageIds.length });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/statuses', authMiddleware, (req, res) => {
  try {
    res.json({ statuses: listActiveStatuses(req.user.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post(
  '/api/statuses',
  authMiddleware,
  (req, res, next) => {
    if (req.is('multipart/form-data')) {
      return upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload fehlgeschlagen.' });
        next();
      });
    }
    next();
  },
  (req, res) => {
    try {
      const mediaUrl = req.file ? `/uploads/${req.file.filename}` : req.body.media_url || null;
      const type = req.file?.mimetype?.startsWith('image/')
        ? 'image'
        : req.body.type || (mediaUrl ? 'image' : 'text');

      const status = createStatus(req.user.id, {
        type,
        body: req.body.body || '',
        mediaUrl,
      });

      io.emit('status:new', { status });
      res.status(201).json({ status });
    } catch (error) {
      sendError(res, error);
    }
  }
);

app.post('/api/statuses/:id/view', authMiddleware, (req, res) => {
  try {
    const status = markStatusViewed(req.params.id, req.user.id);
    res.json({ status });
  } catch (error) {
    sendError(res, error);
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = getUserByToken(token);
  if (!user) {
    return next(new Error('Unauthorized'));
  }
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user:${userId}`);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
    socket.broadcast.emit('presence:online', { user_id: userId });
  }
  onlineUsers.get(userId).add(socket.id);
  socket.emit('presence:snapshot', { online_user_ids: [...onlineUsers.keys()] });

  socket.on('typing:start', ({ conversation_id }) => {
    if (!conversation_id) return;
    const members = getConversationMemberIds(conversation_id);
    if (!members.includes(userId)) return;
    for (const memberId of members) {
      if (memberId === userId) continue;
      io.to(`user:${memberId}`).emit('typing:start', {
        conversation_id,
        user_id: userId,
        display_name: socket.user.display_name,
      });
    }
  });

  socket.on('typing:stop', ({ conversation_id }) => {
    if (!conversation_id) return;
    const members = getConversationMemberIds(conversation_id);
    if (!members.includes(userId)) return;
    for (const memberId of members) {
      if (memberId === userId) continue;
      io.to(`user:${memberId}`).emit('typing:stop', {
        conversation_id,
        user_id: userId,
      });
    }
  });

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      onlineUsers.delete(userId);
      const lastSeen = touchLastSeen(userId);
      const show = socket.user.show_last_seen !== false;
      socket.broadcast.emit('presence:offline', {
        user_id: userId,
        last_seen_at: show ? lastSeen : null,
      });
    }
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

httpServer.listen(PORT, () => {
  console.log(`Relay Messenger läuft auf http://localhost:${PORT}`);
});
