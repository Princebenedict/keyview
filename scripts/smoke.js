// End-to-end check against a running server: npm start, then npm run smoke.
// Prints each step and exits non-zero on the first failed expectation.
const base = process.env.BASE || 'http://localhost:3000';
const suffix = Math.random().toString(36).slice(2, 7);
const trader = `smoke${suffix}.testnet`;
const buyer = `buyer${suffix}.testnet`;

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
function expect(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) process.exit(1);
}

const t = (await call('POST', '/api/traders', { account: trader })).json;
expect('create trader profile', !!t.manageToken);
await call('PUT', `/api/traders/${trader}/strategy`, { name: 'Smoke strategy', tagline: 'public tagline', thesis: 'private thesis' }, t.manageToken);
await call('POST', `/api/traders/${trader}/trades`, { pair: 'NEAR/USDC', side: 'long', entry: 4, exit: 4.4, sizePct: 50, note: 'private note' }, t.manageToken);
await call('PUT', `/api/traders/${trader}/offers`, { offers: [{ durationDays: 7, priceNear: 1 }] }, t.manageToken);

const pub = await call('GET', `/api/traders/${trader}`);
expect('public stats readable with no key', pub.status === 200 && pub.json.metrics.trades === 1, `pnl=${pub.json.metrics.totalPnlPct}%`);
expect('public payload hides private trade fields', !JSON.stringify(pub.json).includes('private note') && !JSON.stringify(pub.json).includes('NEAR/USDC'));
expect('private view blocked with no key', (await call('GET', `/api/traders/${trader}/private`)).status === 401);

const buy = (await call('POST', `/api/traders/${trader}/keys/buy`, { buyer, durationDays: 7 })).json;
expect('buy 7 day viewing key', !!buy.token, `payment=${buy.payment}`);
const priv = await call('GET', `/api/traders/${trader}/private`, null, buy.token);
expect('private view unlocked with key', priv.status === 200 && priv.json.trades.length === 1 && priv.json.thesis === 'private thesis');

const copy = await call('POST', `/api/traders/${trader}/copy`, { follower: buyer, budgetUsd: 100, lastN: 1 }, buy.token);
expect('copy flow returns Intents quote requests', copy.status === 200 && copy.json.orders[0].legs.length === 2);

await call('POST', `/api/traders/${trader}/keys/${buy.keyId}/revoke`, {}, t.manageToken);
expect('revoked key is rejected', (await call('GET', `/api/traders/${trader}/private`, null, buy.token)).status === 403);
console.log('\nAll checks passed.');
