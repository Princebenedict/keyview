import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyview-'));
  const server = createApp({ dataDir: dir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json(), dir };
  };
  return { call, dir, close: () => server.close() };
}

async function seed(call) {
  const { json: t } = await call('POST', '/api/traders', { account: 'alice.testnet' });
  await call('PUT', '/api/traders/alice.testnet/strategy', { name: 'Mean revert', tagline: 'NEAR range trader', thesis: 'SECRET-THESIS' }, t.manageToken);
  await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'long', entry: 4, exit: 4.4, sizePct: 50, note: 'SECRET-NOTE' }, t.manageToken);
  await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'short', entry: 4.4, exit: 4.6, sizePct: 50 }, t.manageToken);
  await call('PUT', '/api/traders/alice.testnet/offers', { offers: [{ durationDays: 7, priceNear: 2 }] }, t.manageToken);
  return t.manageToken;
}

test('empty state: no traders until someone creates one', async () => {
  const { call, close } = await boot();
  const r = await call('GET', '/api/traders');
  assert.deepEqual(r.json, []);
  close();
});

test('public metrics are computed and readable without a key', async () => {
  const { call, close } = await boot();
  await seed(call);
  const r = await call('GET', '/api/traders/alice.testnet');
  assert.equal(r.status, 200);
  assert.equal(r.json.metrics.trades, 2);
  assert.equal(r.json.metrics.totalPnlPct, 2.73);
  assert.equal(r.json.metrics.winRatePct, 50);
  assert.equal(r.json.metrics.maxDrawdownPct, 2.27);
  close();
});

test('public payload never leaks private fields', async () => {
  const { call, close } = await boot();
  await seed(call);
  for (const p of ['/api/traders', '/api/traders/alice.testnet']) {
    const raw = JSON.stringify((await call('GET', p)).json);
    for (const secret of ['SECRET-THESIS', 'SECRET-NOTE', 'NEAR/USDC', '"entry"', '"exit"', 'long']) {
      assert.ok(!raw.includes(secret), `${p} leaked ${secret}`);
    }
  }
  close();
});

test('trade details are encrypted at rest', async () => {
  const { call, dir, close } = await boot();
  await seed(call);
  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!raw.includes('NEAR/USDC'));
  assert.ok(!raw.includes('SECRET-NOTE'));
  close();
});

test('private view: no key, wrong key, valid key, expired, revoked', async () => {
  const { call, dir, close } = await boot();
  const manage = await seed(call);
  assert.equal((await call('GET', '/api/traders/alice.testnet/private')).status, 401);
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, 'kv_nope')).status, 403);

  const buy = await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 });
  assert.equal(buy.status, 200);
  const ok = await call('GET', '/api/traders/alice.testnet/private', null, buy.json.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.thesis, 'SECRET-THESIS');
  assert.equal(ok.json.trades.length, 2);

  // a key is bound to one trader
  const { json: c } = await call('POST', '/api/traders', { account: 'carol.testnet' });
  assert.equal((await call('GET', '/api/traders/carol.testnet/private', null, buy.json.token)).status, 403);
  assert.ok(c.manageToken);

  // manage token cannot be used as a viewing key
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, manage)).status, 403);

  // revoke
  const rev = await call('POST', `/api/traders/alice.testnet/keys/${buy.json.keyId}/revoke`, {}, manage);
  assert.equal(rev.status, 200);
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, buy.json.token)).status, 403);

  // expiry: buy again then age the record on disk and restart
  const buy2 = await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 });
  close();
  const dbp = path.join(dir, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbp, 'utf8'));
  for (const k of Object.values(db.keys)) k.expiresAt = Date.now() - 1000;
  fs.writeFileSync(dbp, JSON.stringify(db));
  const server2 = createApp({ dataDir: dir });
  await new Promise((r) => server2.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${server2.address().port}/api/traders/alice.testnet/private`, { headers: { Authorization: `Bearer ${buy2.json.token}` } });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /expired/);
  server2.close();
});

test('manage endpoints reject missing or wrong token', async () => {
  const { call, close } = await boot();
  await seed(call);
  assert.equal((await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'long', entry: 1, exit: 2, sizePct: 10 })).status, 401);
  assert.equal((await call('GET', '/api/traders/alice.testnet/keys', null, 'kv_wrong')).status, 401);
  close();
});

test('copy builds Intents quote requests only for key holders', async () => {
  const { call, close } = await boot();
  await seed(call);
  const body = { follower: 'bob.testnet', budgetUsd: 100, lastN: 2 };
  assert.equal((await call('POST', '/api/traders/alice.testnet/copy', body)).status, 401);
  const buy = await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 });
  const r = await call('POST', '/api/traders/alice.testnet/copy', body, buy.json.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.orders.length, 2);
  const first = r.json.orders[0].legs[0];
  assert.equal(first.dry, true);
  assert.equal(first.swapType, 'EXACT_INPUT');
  assert.equal(first.recipient, 'bob.testnet');
  assert.equal(first.amount, '50000000'); // 50 USDC at 6 decimals
  close();
});

test('input validation', async () => {
  const { call, close } = await boot();
  assert.equal((await call('POST', '/api/traders', { account: 'BAD NAME' })).status, 400);
  const { json: t } = await call('POST', '/api/traders', { account: 'dan.testnet' });
  assert.equal((await call('POST', '/api/traders', { account: 'dan.testnet' })).status, 409);
  await call('PUT', '/api/traders/dan.testnet/strategy', { name: 'x' }, t.manageToken);
  assert.equal((await call('POST', '/api/traders/dan.testnet/trades', { pair: 'FOO/BAR', side: 'long', entry: 1, exit: 1, sizePct: 10 }, t.manageToken)).status, 400);
  assert.equal((await call('POST', '/api/traders/dan.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 })).status, 400);
  close();
});
