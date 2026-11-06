// Private trade storage. Trade details are encrypted at rest with a
// per-trader AES-256-GCM key derived from a server master secret.
import crypto from 'node:crypto';

export function deriveKey(master, account) {
  return Buffer.from(crypto.hkdfSync('sha256', master, account, 'keyview-trades-v1', 32));
}

export function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function open(key, blob) {
  const b = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  const pt = Buffer.concat([d.update(b.subarray(28)), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

export const newToken = () => 'kv_' + crypto.randomBytes(24).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
