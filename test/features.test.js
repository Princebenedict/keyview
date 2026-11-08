import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvf-'));
  const server = createApp({ dataDir: dir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  return { call, dir, close: () => server.close() };
}

async function seed(call) {
  const t = (await call('POST', '/api/traders', { account: 'alice.testnet' })).json;
  const m = t.manageToken;
  await call('PUT', '/api/traders/alice.testnet/strategy', { name: 'S', thesis: 'T' }, m);
  await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'long', entry: 4, exit: 4.4, sizePct: 50 }, m);
  await new Promise((r) => setTimeout(r, 5)); // distinct closedAt
  await call('POST', '/api/traders/alice.testnet/trades', { pair: 'NEAR/USDC', side: 'short', entry: 4.4, exit: 4.6, sizePct: 50 }, m);
  await call('PUT', '/api/traders/alice.testnet/offers', { offers: [{ durationDays: 7, priceNear: 2 }, { durationDays: 30, priceNear: 5 }] }, m);
  return m;
}

test('trader can list and delete their own trades; metrics follow', async () => {
  const { call, close } = await boot();
  const m = await seed(call);
  assert.equal((await call('GET', '/api/traders/alice.testnet/trades')).status, 401);
  const list = (await call('GET', '/api/traders/alice.testnet/trades', null, m)).json;
  assert.equal(list.length, 2);
  assert.equal(list[0].pnlPct, 5);
  const del = await call('DELETE', '/api/traders/alice.testnet/trades/0', null, m);
  assert.equal(del.status, 200);
  assert.equal(del.json.metrics.trades, 1);
  assert.equal((await call('DELETE', '/api/traders/alice.testnet/trades/9', null, m)).status, 404);
  close();
});

test('analytics: trade stats and simulated sales', async () => {
  const { call, close } = await boot();
  const m = await seed(call);
  await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 });
  await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'carol.testnet', durationDays: 30 });
  const a = (await call('GET', '/api/traders/alice.testnet/analytics', null, m)).json;
  assert.equal(a.trade.count, 2);
  assert.equal(a.trade.bestPct, 5);
  assert.equal(a.trade.worstPct, -2.27);
  assert.equal(a.trade.profitFactor, 2.2);
  assert.equal(a.sales.keysSold, 2);
  assert.equal(a.sales.revenueNear, 7);
  assert.equal(a.sales.uniqueHolders, 2);
  assert.equal(a.simulatedPayments, true);
  assert.equal((await call('GET', '/api/traders/alice.testnet/analytics', null, 'kv_x')).status, 401);
  close();
});

test('held keys status: only the tokens you present, no secrets back', async () => {
  const { call, close } = await boot();
  await seed(call);
  const b = (await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 })).json;
  const r = await call('POST', '/api/me/keys/status', { tokens: [b.token, 'kv_unknown'] });
  assert.equal(r.json.length, 1);
  assert.equal(r.json[0].trader, 'alice.testnet');
  assert.equal(r.json[0].state, 'active');
  assert.ok(!JSON.stringify(r.json).includes(b.token));
  close();
});

test('copy tracking: dedupes, computes results, lets the holder update status', async () => {
  const { call, close } = await boot();
  const m = await seed(call);
  const b = (await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 })).json;
  const c = (await call('POST', '/api/traders/carol.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 }));
  assert.equal(c.status, 404);

  assert.equal((await call('POST', '/api/traders/alice.testnet/copies', { budgetUsd: 100, lastN: 5 })).status, 401);
  const first = (await call('POST', '/api/traders/alice.testnet/copies', { budgetUsd: 100, lastN: 5 }, b.token)).json;
  assert.deepEqual(first, { created: 2, skipped: 0 });
  const again = (await call('POST', '/api/traders/alice.testnet/copies', { budgetUsd: 100, lastN: 5 }, b.token)).json;
  assert.deepEqual(again, { created: 0, skipped: 2 });

  const got = (await call('GET', '/api/traders/alice.testnet/copies', null, b.token)).json;
  assert.equal(got.copies.length, 2);
  const long = got.copies.find((x) => x.trade.side === 'long');
  assert.equal(long.pnlUsd, 5); // 100 USD budget, +5% of portfolio
  assert.equal(got.totals.executed, 0);
  assert.equal(got.totals.ifAllExecutedPnlUsd, 2.73);

  assert.equal((await call('POST', `/api/traders/alice.testnet/copies/${long.id}/status`, { status: 'executed' }, b.token)).status, 200);
  assert.equal((await call('POST', `/api/traders/alice.testnet/copies/${long.id}/status`, { status: 'bogus' }, b.token)).status, 400);
  const after = (await call('GET', '/api/traders/alice.testnet/copies', null, b.token)).json;
  assert.equal(after.totals.executedPnlUsd, 5);

  // another holder cannot touch bob's copies
  const d = (await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'dan.testnet', durationDays: 7 })).json;
  assert.equal((await call('POST', `/api/traders/alice.testnet/copies/${long.id}/status`, { status: 'skipped' }, d.token)).status, 404);
  assert.equal((await call('GET', '/api/traders/alice.testnet/copies', null, d.token)).json.copies.length, 0);

  // after revoke, tracked copies are no longer readable
  const keys = (await call('GET', '/api/traders/alice.testnet/keys', null, m)).json;
  await call('POST', `/api/traders/alice.testnet/keys/${keys.find((k) => k.buyer === 'bob.testnet').keyId}/revoke`, {}, m);
  assert.equal((await call('GET', '/api/traders/alice.testnet/copies', null, b.token)).status, 403);

  assert.equal((await call('DELETE', `/api/traders/alice.testnet/copies/${long.id}`, null, d.token)).status, 404);
  close();
});

test('tracked copies are encrypted at rest', async () => {
  const { call, dir, close } = await boot();
  await seed(call);
  const b = (await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 })).json;
  await call('POST', '/api/traders/alice.testnet/copies', { budgetUsd: 100, lastN: 2 }, b.token);
  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!raw.includes('NEAR/USDC'));
  close();
});

test('export returns decrypted data to the owner only; delete wipes everything', async () => {
  const { call, close } = await boot();
  const m = await seed(call);
  const b = (await call('POST', '/api/traders/alice.testnet/keys/buy', { buyer: 'bob.testnet', durationDays: 7 })).json;
  await call('POST', '/api/traders/alice.testnet/copies', { budgetUsd: 100, lastN: 2 }, b.token);
  assert.equal((await call('GET', '/api/traders/alice.testnet/export', null, b.token)).status, 401);
  const ex = (await call('GET', '/api/traders/alice.testnet/export', null, m)).json;
  assert.equal(ex.trades.length, 2);
  assert.equal(ex.strategy.thesis, 'T');
  assert.ok(!JSON.stringify(ex).includes(b.token));

  assert.equal((await call('DELETE', '/api/traders/alice.testnet', null, b.token)).status, 401);
  assert.equal((await call('DELETE', '/api/traders/alice.testnet', null, m)).status, 200);
  assert.equal((await call('GET', '/api/traders/alice.testnet')).status, 404);
  assert.equal((await call('GET', '/api/traders/alice.testnet/private', null, b.token)).status, 404);
  assert.deepEqual((await call('GET', '/api/traders')).json, []);
  close();
});
