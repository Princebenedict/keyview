// NEP-413 "sign message" verification and signing, using only node:crypto.
// Spec: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
import crypto from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const TAG = 2147484061; // 2^31 + 413

export function b58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base58');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const zeros = str.length - str.replace(/^1+/, '').length;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

export function b58encode(buf) {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  const zeros = buf.findIndex((b) => b !== 0);
  return '1'.repeat(zeros === -1 ? buf.length : zeros) + out;
}

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s) => { const d = Buffer.from(s, 'utf8'); return Buffer.concat([u32(d.length), d]); };

export function payloadHash({ message, nonce, recipient, callbackUrl }) {
  if (nonce.length !== 32) throw new Error('Nonce must be 32 bytes');
  const cb = callbackUrl ? Buffer.concat([Buffer.from([1]), str(callbackUrl)]) : Buffer.from([0]);
  const borsh = Buffer.concat([u32(TAG), str(message), nonce, str(recipient), cb]);
  return crypto.createHash('sha256').update(borsh).digest();
}

function rawKey(publicKey) {
  if (!publicKey.startsWith('ed25519:')) throw new Error('Only ed25519 keys are supported');
  const raw = b58decode(publicKey.slice(8));
  if (raw.length !== 32) throw new Error('Bad public key length');
  return raw;
}

export function verifyNep413(payload, publicKey, signatureB64) {
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey(publicKey)]),
      format: 'der', type: 'spki',
    });
    return crypto.verify(null, payloadHash(payload), pub, Buffer.from(signatureB64, 'base64'));
  } catch { return false; }
}

// Used by tests and scripts/near-login.js. privateKey is NEAR style: "ed25519:<base58 of 64 bytes>".
export function signNep413(payload, privateKey) {
  const seed = b58decode(privateKey.replace(/^ed25519:/, '')).subarray(0, 32);
  const key = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der', type: 'pkcs8',
  });
  const pubDer = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' });
  return {
    publicKey: 'ed25519:' + b58encode(pubDer.subarray(-32)),
    signature: crypto.sign(null, payloadHash(payload), key).toString('base64'),
  };
}

export function generateNearKeypair() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    privateKey: 'ed25519:' + b58encode(Buffer.concat([seed, pub])),
    publicKey: 'ed25519:' + b58encode(pub),
  };
}
