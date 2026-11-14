import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createChainLedger } from '../src/chain.js';

// A stand-in NEAR RPC that can fail on demand.
function flakyRpc(state) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c;
      const { params } = JSON.parse(raw);
      if (state.failures > 0) { state.failures--; res.statusCode = 503; return res.end('busy'); }
      state.calls++;
      const a = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
      const out = params.method_name === 'get_offer' && a.duration_days === 7 ? '100000000000000000000000' : null;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 'k', result: { result: [...Buffer.from(JSON.stringify(out))] } }));
    });
    srv.listen(0, () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function boot(state) {
  const rpc = await flakyRpc(state);
  const ledger = createChainLedger({ contract: 'keyview.testnet', rpcUrl: rpc.url });
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kvr-')), ledger });
  await new Promise((r) => app.listen(0, r));
  return { ledger, base: `http://127.0.0.1:${app.address().port}`, close: () => { app.close(); rpc.srv.close(); } };
}

test('a transient RPC failure is retried and offers still load', async () => {
  const state = { failures: 2, calls: 0 };
  const { ledger, close } = await boot(state);
  const offers = await ledger.getOffers('alice.testnet');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].priceNear, 0.1);
  close();
});

test('offers are cached briefly and the last good answer survives an outage', async () => {
  const state = { failures: 0, calls: 0 };
  const { ledger, close } = await boot(state);
  await ledger.getOffers('alice.testnet');
  const callsAfterFirst = state.calls;
  await ledger.getOffers('alice.testnet');
  assert.equal(state.calls, callsAfterFirst, 'second read came from the cache');
  state.failures = 1000; // RPC goes down
  const stale = await ledger.getOffers('alice.testnet');
  assert.equal(stale.length, 1);
  close();
});

test('a real outage is reported as an error, not as "no offers"', async () => {
  const state = { failures: 1000, calls: 0 };
  const rpc = await flakyRpc(state);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvr-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ keys: {}, traders: { 'alice.testnet': { account: 'alice.testnet', createdAt: 1, manageHash: 'x', strategy: null, trades: [], offers: [] } } }));
  const app = createApp({ dataDir: dir, ledger: createChainLedger({ contract: 'keyview.testnet', rpcUrl: rpc.url }) });
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;

  const down = await (await fetch(`${base}/api/traders/alice.testnet`)).json();
  assert.equal(down.offersError, true);
  assert.deepEqual(down.offers, []);

  state.failures = 0; // the RPC recovers
  const up = await (await fetch(`${base}/api/traders/alice.testnet`)).json();
  assert.equal(up.offersError, false);
  assert.equal(up.offers.length, 1);
  app.close(); rpc.srv.close();
});
