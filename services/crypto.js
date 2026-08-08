import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function getKey() {
  const secret =
    process.env.RELAY_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    'relay-dev-only-change-me-in-production-32b';
  return createHash('sha256').update(String(secret)).digest();
}

export function encryptText(plain) {
  if (plain == null || plain === '') return plain;
  const text = String(plain);
  if (text.startsWith(PREFIX)) return text;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptText(payload) {
  if (payload == null || payload === '') return payload;
  const text = String(payload);
  if (!text.startsWith(PREFIX)) return text;

  const raw = text.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = raw.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return '';

  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function isEncrypted(value) {
  return String(value || '').startsWith(PREFIX);
}
