/** Client-side E2E helpers (Web Crypto, ECDH P-256 + AES-GCM). */

const PREFIX = 'e2e:v1:';
const CURVE = 'P-256';
const INFO = new TextEncoder().encode('relay-e2e-v1');

function storageKey(userId) {
  return `relay_e2e_identity_${userId}`;
}

function b64(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = '';
  for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function isE2EPayload(value) {
  return String(value || '').startsWith(PREFIX);
}

async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: CURVE }, true, []);
}

async function importPrivateKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']);
}

async function deriveWrapKey(sharedBits) {
  const baseKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function ensureIdentity(userId) {
  if (!userId) throw new Error('Benutzer fehlt für E2E-Schlüssel.');
  const existing = localStorage.getItem(storageKey(userId));
  if (existing) {
    const parsed = JSON.parse(existing);
    return {
      publicKeyJwk: parsed.publicKeyJwk,
      privateKey: await importPrivateKey(parsed.privateKeyJwk),
      publicKey: await importPublicKey(parsed.publicKeyJwk),
    };
  }

  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, true, [
    'deriveBits',
  ]);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  localStorage.setItem(
    storageKey(userId),
    JSON.stringify({ publicKeyJwk, privateKeyJwk, createdAt: new Date().toISOString() })
  );
  return { publicKeyJwk, privateKey: pair.privateKey, publicKey: pair.publicKey };
}

export function clearIdentity(userId) {
  if (userId) localStorage.removeItem(storageKey(userId));
}

async function wrapContentKey(rawContentKey, recipientPublicJwk) {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, true, [
    'deriveBits',
  ]);
  const theirPub = await importPublicKey(recipientPublicJwk);
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPub },
    ephemeral.privateKey,
    256
  );
  const wrapKey = await deriveWrapKey(shared);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, rawContentKey);
  const epk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);
  return { epk, iv: b64(iv), key: b64(wrapped) };
}

async function unwrapContentKey(wrap, privateKey) {
  const epk = await importPublicKey(wrap.epk);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256);
  const wrapKey = await deriveWrapKey(shared);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrap.iv) },
    wrapKey,
    fromB64(wrap.key)
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * @param {string} plaintext
 * @param {{ id: string, publicKeyJwk: object }[]} recipients
 */
export async function encryptTextForRecipients(plaintext, recipients) {
  if (!recipients?.length) throw new Error('Keine Empfänger-Schlüssel für E2E.');
  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    contentKey,
    new TextEncoder().encode(String(plaintext ?? ''))
  );
  const rawKey = await crypto.subtle.exportKey('raw', contentKey);
  const keys = {};
  for (const recipient of recipients) {
    if (!recipient?.id || !recipient?.publicKeyJwk) {
      throw new Error('Ein Chat-Teilnehmer hat noch keinen E2E-Schlüssel.');
    }
    keys[recipient.id] = await wrapContentKey(rawKey, recipient.publicKeyJwk);
  }
  return (
    PREFIX +
    JSON.stringify({
      v: 1,
      iv: b64(iv),
      ct: b64(ct),
      keys,
    })
  );
}

export async function decryptTextPayload(payload, userId, privateKey) {
  if (!isE2EPayload(payload)) return payload;
  const data = JSON.parse(String(payload).slice(PREFIX.length));
  const wrap = data.keys?.[userId];
  if (!wrap) throw new Error('Diese Nachricht ist nicht für dich entschlüsselbar.');
  const contentKey = await unwrapContentKey(wrap, privateKey);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(data.iv) },
    contentKey,
    fromB64(data.ct)
  );
  return new TextDecoder().decode(plain);
}

/**
 * Encrypt binary media; returns { envelope, blob } where envelope embeds keys + media ciphertext ref marker.
 * Actually for media we encrypt bytes and put key wraps in a small JSON envelope stored as message body.
 */
export async function encryptBytesForRecipients(bytes, recipients, meta = {}) {
  if (!recipients?.length) throw new Error('Keine Empfänger-Schlüssel für E2E.');
  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, bytes);
  const rawKey = await crypto.subtle.exportKey('raw', contentKey);
  const keys = {};
  for (const recipient of recipients) {
    if (!recipient?.id || !recipient?.publicKeyJwk) {
      throw new Error('Ein Chat-Teilnehmer hat noch keinen E2E-Schlüssel.');
    }
    keys[recipient.id] = await wrapContentKey(rawKey, recipient.publicKeyJwk);
  }
  const caption = meta.caption != null ? String(meta.caption) : '';
  const captionIv = crypto.getRandomValues(new Uint8Array(12));
  const captionCt = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: captionIv },
    contentKey,
    new TextEncoder().encode(caption)
  );
  const envelope =
    PREFIX +
    JSON.stringify({
      v: 1,
      kind: 'media',
      mime: meta.mime || 'application/octet-stream',
      iv: b64(captionIv),
      ct: b64(captionCt),
      media_iv: b64(iv),
      keys,
    });
  return {
    envelope,
    blob: new Blob([ct], { type: 'application/octet-stream' }),
  };
}

export async function decryptMediaBytes(envelope, encryptedBytes, userId, privateKey) {
  if (!isE2EPayload(envelope)) {
    return { caption: '', bytes: encryptedBytes, mime: 'application/octet-stream' };
  }
  const data = JSON.parse(String(envelope).slice(PREFIX.length));
  const wrap = data.keys?.[userId];
  if (!wrap) throw new Error('Medien nicht entschlüsselbar.');
  const contentKey = await unwrapContentKey(wrap, privateKey);
  const captionBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(data.iv) },
    contentKey,
    fromB64(data.ct)
  );
  const mediaBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(data.media_iv) },
    contentKey,
    encryptedBytes
  );
  return {
    caption: new TextDecoder().decode(captionBuf),
    bytes: mediaBuf,
    mime: data.mime || 'application/octet-stream',
  };
}
