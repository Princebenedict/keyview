// End-to-end check of testnet mode against a running server.
// Signs in as a trader and a buyer with keys saved by near-cli, so no key is typed or pasted.
//
//   KEYVIEW_MODE=testnet KEYVIEW_CONTRACT=you.testnet npm start        (terminal 1)
//   npm run check:testnet                                              (terminal 2)
//
// Optional env: KEYVIEW_URL, TRADER, BUYER, NEAR_CREDENTIALS_DIR
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signNep413 } from '../src/nep413.js';

const base = process.env.KEYVIEW_URL || 'http://localhost:3000';
const trader = process.env.TRADER || 'benkeyview-trader.testnet';
const buyer = process.env.BUYER || 'benkeyview-buyer.testnet';
const credDir = process.env.NEAR_CREDENTIALS_DIR || path.join(os.homedir(), '.near-credentials', 'testnet');

function privateKeyFor(account) {
  const single = path.join(credDir, `${account}.json`);
  if (fs.existsSync(single)) return JSON.parse(fs.readFileSync(single, 'utf8')).private_key;
  const dir = path.join(credDir, account);
  if (fs.existsSync(dir)) {
    const f = fs.readdirSync(dir).find((x) => x.endsWith('.json'));
    if (f) return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).private_key;
  }
  throw new Error(`No saved key for ${account} in ${credDir}`);
}

async function call(method, p, body, token) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
async function login(account) {
  const ch = (await call('POST', '/api/auth/challenge')).json;
  const sig = signNep413({ message: ch.message, recipient: ch.recipient, nonce: Buffer.from(ch.nonce, 'base64') }, privateKeyFor(account));
  const r = await call('POST', '/api/auth/verify', { accountId: account, publicKey: sig.publicKey, signature: sig.signature, nonce: ch.nonce });
  if (r.status !== 200) throw new Error(`Sign-in failed for ${account}: ${r.json.error}`);
  return r.json.token;
}
function expect(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) process.exit(1);
}

const cfg = (await call('GET', '/api/config')).json;
expect('server is in testnet mode', cfg.mode === 'testnet', `contract=${cfg.contract}`);

const tTok = await login(trader);
expect('trader signed in with a NEAR signature', !!tTok, trader);
const bTok = await login(buyer);
expect('buyer signed in with a NEAR signature', !!bTok, buyer);

await call('POST', '/api/traders', {}, tTok); // 409 if it already exists, which is fine
await call('PUT', `/api/traders/${trader}/strategy`, { name: 'Testnet strategy', tagline: 'public tagline', thesis: 'private thesis from testnet' }, tTok);
const pub0 = (await call('GET', `/api/traders/${trader}`)).json;
if (!pub0.metrics.trades) {
  const t = await call('POST', `/api/traders/${trader}/trades`, { pair: 'NEAR/USDC', side: 'long', entry: 4, exit: 4.4, sizePct: 50, note: 'private note' }, tTok);
  expect('trader recorded a trade', t.status === 200);
}

const pub = (await call('GET', `/api/traders/${trader}`)).json;
expect('public stats readable with no key', pub.metrics.trades >= 1, `pnl=${pub.metrics.totalPnlPct}%`);
expect('public payload hides private fields', !/private note|private thesis|NEAR\/USDC/.test(JSON.stringify(pub)));
expect('key offer is read from the contract', pub.offers.some((o) => o.durationDays === 7), JSON.stringify(pub.offers.map((o) => `${o.durationDays}d=${o.priceNear} NEAR`)));

expect('private view blocked with no session', (await call('GET', `/api/traders/${trader}/private`)).status === 401);
const priv = await call('GET', `/api/traders/${trader}/private`, null, bTok);
expect('buyer with an on-chain grant unlocks the private view', priv.status === 200 && priv.json.thesis === 'private thesis from testnet', `key expires ${priv.json.expiresAt ? new Date(priv.json.expiresAt).toISOString() : 'n/a'}`);
expect('trader can read their own private view', (await call('GET', `/api/traders/${trader}/private`, null, tTok)).status === 200);

const copy = await call('POST', `/api/traders/${trader}/copy`, { budgetUsd: 100, lastN: 1 }, bTok);
expect('copy orders are built for the signed-in buyer', copy.status === 200 && copy.json.orders[0].legs[0].recipient === buyer);

console.log('\nAll checks passed. To test revoke, run on the trader account:');
console.log(`  near contract call-function as-transaction ${cfg.contract} revoke json-args '{"holder":"${buyer}"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as ${trader} network-config testnet sign-with-legacy-keychain send`);
console.log('then run this check again: the buyer step should now fail with 403.');
