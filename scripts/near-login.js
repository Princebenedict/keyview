// Signs in to a testnet-mode KeyView server with a local NEAR key, no browser wallet needed.
// Useful for scripted checks and for AI judges.
//
//   KEYVIEW_URL=http://localhost:3000 NEAR_ACCOUNT_ID=you.testnet \
//   NEAR_PRIVATE_KEY=ed25519:... node scripts/near-login.js
//
// Prints a session token. Use it as "Authorization: Bearer <token>".
import { signNep413 } from '../src/nep413.js';

const base = process.env.KEYVIEW_URL || 'http://localhost:3000';
const account = process.env.NEAR_ACCOUNT_ID;
const key = process.env.NEAR_PRIVATE_KEY;
if (!account || !key) {
  console.error('Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (ed25519:...).');
  process.exit(1);
}
const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const json = await res.json();
  if (!res.ok) { console.error(json.error || res.status); process.exit(1); }
  return json;
};
const ch = await post('/api/auth/challenge');
const sig = signNep413({ message: ch.message, recipient: ch.recipient, nonce: Buffer.from(ch.nonce, 'base64') }, key);
const out = await post('/api/auth/verify', { accountId: account, publicKey: sig.publicKey, signature: sig.signature, nonce: ch.nonce });
console.log(JSON.stringify(out, null, 2));
console.log('\nTo use this session in the browser, run in the dev console:');
console.log(`localStorage.setItem('kv.session', JSON.stringify(${JSON.stringify({ account: out.account, token: out.token, expiresAt: out.expiresAt, walletId: 'meteor-wallet' })}))`);
