import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createChainLedger } from '../src/chain.js';
import { generateNearKeypair, signNep413, verifyNep413, b58encode, b58decode } from '../src/nep413.js';

// A local stand-in for the NEAR JSON-RPC. It answers the same request shapes
// the real node does. Tests below say "stub" wherever chain state is involved.
function stubRpc(state) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c;
      const { params } = JSON.parse(raw);
      const reply = (result) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: 'keyview', result })); };
      if (params.request_type === 'view_access_key') {
        const ok = state.keys[params.account_id] === params.public_key;
        return reply(ok ? { nonce: 1, permission: 'FullAccess' } : { error: 'access key does not exist' });
      }
      const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
      let out = null;
      if (params.method_name === 'has_access') out = !!state.grants[`${args.trader}|${args.holder}`] && !state.grants[`${args.trader}|${args.holder}`].revoked;
      if (params.method_name === 'get_grant') out = state.grants[`${args.trader}|${args.holder}`] || null;
      if (params.method_name === 'get_offer') out = state.offers[`${args.trader}|${args.duration_days}`] || null;
      reply({ result: [...Buffer.from(JSON.stringify(out))] });
    });
    srv.listen(0, () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function boot() {
  const alice = generateNearKeypair(), bob = generateNearKeypair();
  const state = {
    keys: { 'alice.testnet': alice.publicKey, 'bob.testnet': bob.publicKey },
    grants: {}, offers: { 'alice.testnet|7': '2000000000000000000000000' }, // 2 NEAR
  };
  const rpc = await stubRpc(state);
  const ledger = createChainLedger({ contract: 'keyview.testnet', rpcUrl: rpc.url });
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kvt-')), ledger });
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, p, body, token) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  async function login(account, kp, over = {}) {
    const ch = (await call('POST', '/api/auth/challenge')).json;
    const sig = signNep413({ message: ch.message, recipient: ch.recipient, nonce: Buffer.from(ch.nonce, 'base64') }, kp.privateKey);
    return call('POST', '/api/auth/verify', { accountId: account, publicKey: sig.publicKey, signature: sig.signature, nonce: ch.nonce, ...over });
  }
  return { call, login, alice, bob, state, close: () => { app.close(); rpc.srv.close(); } };
}

test('base58 round trip and NEP-413 sign/verify', () => {
  const buf = Buffer.from([0, 0, 1, 2, 255]);
  assert.deepEqual(b58decode(b58encode(buf)), buf);
  const kp = generateNearKeypair();
  const payload = { message: 'hi', recipient: 'keyview', nonce: Buffer.alloc(32, 7) };
  const s = signNep413(payload, kp.privateKey);
  assert.equal(s.publicKey, kp.publicKey);
  assert.ok(verifyNep413(payload, kp.publicKey, s.signature));
  assert.ok(!verifyNep413({ ...payload, message: 'hij' }, kp.publicKey, s.signature));
  assert.ok(!verifyNep413({ ...payload, nonce: Buffer.alloc(32, 8) }, kp.publicKey, s.signature));
  assert.ok(!verifyNep413({ ...payload, recipient: 'evil' }, kp.publicKey, s.signature));
});

test('wallet sign-in: valid, replayed nonce, wrong key, foreign signer', async () => {
  const { call, login, alice, bob, close } = await boot();
  const ok = await login('alice.testnet', alice);
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);

  // replay: same nonce cannot be reused
  const ch = (await call('POST', '/api/auth/challenge')).json;
  const sig = signNep413({ message: ch.message, recipient: ch.recipient, nonce: Buffer.from(ch.nonce, 'base64') }, alice.privateKey);
  const body = { accountId: 'alice.testnet', publicKey: sig.publicKey, signature: sig.signature, nonce: ch.nonce };
  assert.equal((await call('POST', '/api/auth/verify', body)).status, 200);
  assert.equal((await call('POST', '/api/auth/verify', body)).status, 400);

  // bob signs validly but claims to be alice: key is not on alice's account
  const forged = await login('alice.testnet', bob);
  assert.equal(forged.status, 401);
  assert.match(forged.json.error, /not an access key/);

  // garbage signature
  assert.equal((await login('alice.testnet', alice, { signature: Buffer.alloc(64).toString('base64') })).status, 401);
  close();
});

test('testnet gate follows on-chain grants and the trader owns their profile', async () => {
  const { call, login, alice, bob, state, close } = await boot();
  const a = (await login('alice.testnet', alice)).json.token;
  const b = (await login('bob.testnet', bob)).json.token;

  assert.equal((await call('POST', '/api/traders', {})).status, 401);
  assert.equal((await call('POST', '/api/traders', {}, a)).status, 200);
  await call('PUT', '/api/traders/alice.testnet/strategy', { name: 'S', thesis: 'SECRET-THESIS' }, a);
  assert.equal((await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'long', entry: 4, exit: 4.4, sizePct: 50 }, b)).status, 403);
  assert.equal((await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'long', entry: 4, exit: 4.4, sizePct: 50 }, a)).status, 200);

  // public view is open, and offers come from the chain (stub)
  const pub = await call('GET', '/api/traders/alice.testnet');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.json.offers, [{ durationDays: 7, priceNear: 2, priceYocto: '2000000000000000000000000' }]);
  assert.ok(!JSON.stringify(pub.json).includes('SECRET-THESIS'));

  // private: no session, session without grant, with grant, revoked
  assert.equal((await call('GET', '/api/traders/alice.testnet/private')).status, 401);
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, b)).status, 403);
  state.grants['alice.testnet|bob.testnet'] = { expires_at_ms: Date.now() + 1e9, revoked: false };
  const priv = await call('GET', '/api/traders/alice.testnet/private', null, b);
  assert.equal(priv.status, 200);
  assert.equal(priv.json.thesis, 'SECRET-THESIS');
  assert.equal(priv.json.trades.length, 1);

  // copy uses the signed-in account, not a body field
  const copy = await call('POST', '/api/traders/alice.testnet/copy', { follower: 'mallory.testnet', budgetUsd: 100 }, b);
  assert.equal(copy.json.orders[0].legs[0].recipient, 'bob.testnet');

  // the trader can read their own private data
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, a)).status, 200);

  state.grants['alice.testnet|bob.testnet'].revoked = true;
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, b)).status, 403);

  // off-chain shortcuts are closed in testnet mode
  assert.equal((await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 })).status, 400);
  assert.equal((await call('PUT', '/api/traders/alice.testnet/offers', { offers: [] }, a)).status, 400);
  close();
});

test('attestation says plainly when there is no TEE', async () => {
  const { call, close } = await boot();
  const r = await call('GET', '/api/attestation');
  assert.equal(r.status, 200);
  assert.equal(r.json.available, false);
  assert.match(r.json.reason, /TEE|dstack/);
  close();
});
