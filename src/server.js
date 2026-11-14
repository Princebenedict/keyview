import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { computeMetrics, tradePnlPct } from './metrics.js';
import { deriveKey, seal, open, newToken, hashToken } from './vault.js';
import { createDryRunLedger } from './ledger.js';
import { createChainLedger } from './chain.js';
import { verifyNep413 } from './nep413.js';
import { getAttestation } from './attestation.js';
import { buildLegs, PAIRS } from './intents.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{1,62}\.(testnet|near)$/;
const DURATIONS = [7, 30];
const SESSION_MS = 12 * 3600 * 1000;
const NONCE_MS = 5 * 60 * 1000;
export const SIGN_IN_MESSAGE = 'Sign in to KeyView';
export const SIGN_IN_RECIPIENT = 'keyview';

export function ledgerFromEnv(env = process.env) {
  if (env.KEYVIEW_MODE === 'testnet') {
    if (!env.KEYVIEW_CONTRACT) throw new Error('KEYVIEW_MODE=testnet needs KEYVIEW_CONTRACT (the deployed access contract account)');
    const network = env.KEYVIEW_NETWORK || 'testnet';
    return createChainLedger({
      contract: env.KEYVIEW_CONTRACT, network,
      rpcUrl: env.KEYVIEW_RPC || (network === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org'),
    });
  }
  return createDryRunLedger();
}

export function createApp({ dataDir = path.join(ROOT, 'data'), ledger = createDryRunLedger() } = {}) {
  const chain = ledger.mode === 'testnet';
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'db.json');
  const secretPath = path.join(dataDir, 'master.key');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32), { mode: 0o600 });
  const master = fs.readFileSync(secretPath);
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : { traders: {}, keys: {} };
  db.sessions ||= {};
  db.copies ||= {};
  const save = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  const nonces = new Map(); // nonce(base64) -> expiresAt

  const err = (status, message) => Object.assign(new Error(message), { status });
  const now = () => Date.now();
  const bearer = (req) => {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };

  function trader(account) {
    const t = db.traders[account];
    if (!t) throw err(404, 'Trader not found');
    return t;
  }
  function sessionAccount(req) {
    const tok = bearer(req);
    const s = tok && db.sessions[hashToken(tok)];
    if (!s || s.expiresAt <= now()) throw err(401, 'Sign in with your NEAR wallet first');
    return s.account;
  }
  function requireManage(req, account) {
    const t = trader(account);
    if (chain) {
      if (sessionAccount(req) !== account) throw err(403, 'You can only manage your own profile');
      return t;
    }
    const tok = bearer(req);
    if (!tok || hashToken(tok) !== t.manageHash) throw err(401, 'Missing or wrong manage token');
    return t;
  }
  const keyState = (k) => (k.revoked ? 'revoked' : k.expiresAt <= now() ? 'expired' : 'active');

  // Returns { holder, keyId, expiresAt } or throws.
  async function requireViewer(req, account) {
    trader(account);
    if (chain) {
      const holder = sessionAccount(req);
      if (holder === account) return { holder, keyId: 'owner', expiresAt: null };
      let ok;
      try { ok = await ledger.hasAccess(account, holder); } catch { throw err(502, 'Could not read the access contract. Try again.'); }
      if (!ok) throw err(403, 'No active on-chain viewing key for this account');
      const g = await ledger.getGrant(account, holder);
      return { holder, keyId: `${account}:${holder}`, expiresAt: g ? g.expires_at_ms : null };
    }
    const tok = bearer(req);
    if (!tok) throw err(401, 'A viewing key is required');
    const k = db.keys[hashToken(tok)];
    if (!k || k.trader !== account) throw err(403, 'This key does not unlock this trader');
    const s = keyState(k);
    if (s !== 'active') throw err(403, `Viewing key is ${s}`);
    return { holder: k.buyer, keyId: k.keyId, expiresAt: k.expiresAt };
  }

  const privateTrades = (t) => {
    const key = deriveKey(master, t.account);
    return t.trades.map((blob) => open(key, blob));
  };
  async function publicView(t, { withOffers = true } = {}) {
    let offers = [];
    let offersError = false;
    if (withOffers) {
      try { offers = chain ? await ledger.getOffers(t.account) : t.offers; }
      catch (e) { offers = []; offersError = true; console.error(`Could not read offers for ${t.account}: ${e.message}`); }
    }
    return {
      account: t.account,
      createdAt: t.createdAt,
      strategy: t.strategy ? { name: t.strategy.name, tagline: t.strategy.tagline, mode: t.strategy.mode } : null,
      metrics: computeMetrics(privateTrades(t)),
      offers,
      offersError,
      activeKeys: chain ? null : Object.values(db.keys).filter((k) => k.trader === t.account && keyState(k) === 'active').length,
    };
  }

  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/api/config', async () => ({
    mode: ledger.mode,
    network: chain ? ledger.network : null,
    contract: chain ? ledger.contract : null,
    pairs: PAIRS,
    durations: DURATIONS,
    signIn: { message: SIGN_IN_MESSAGE, recipient: SIGN_IN_RECIPIENT },
    note: chain
      ? 'Testnet: viewing keys are on-chain grants. Sign in with a NEAR wallet.'
      : 'Dry-run: payments and confidential execution are simulated. Nothing leaves this server.',
  }));

  route('GET', '/api/health', async () => ({ ok: true, mode: ledger.mode }));

  route('GET', '/api/attestation', async () => getAttestation({ master, contract: chain ? ledger.contract : null }));

  // Wallet sign-in (testnet mode): NEP-413 challenge and response.
  route('POST', '/api/auth/challenge', async () => {
    if (!chain) throw err(400, 'Wallet sign-in is only used in testnet mode');
    for (const [n, exp] of nonces) if (exp <= now()) nonces.delete(n);
    const nonce = crypto.randomBytes(32).toString('base64');
    nonces.set(nonce, now() + NONCE_MS);
    return { message: SIGN_IN_MESSAGE, recipient: SIGN_IN_RECIPIENT, nonce, expiresAt: now() + NONCE_MS };
  });

  route('POST', '/api/auth/verify', async (_req, _p, body) => {
    if (!chain) throw err(400, 'Wallet sign-in is only used in testnet mode');
    const { accountId, publicKey, signature, nonce } = body;
    const exp = nonces.get(nonce);
    if (!exp || exp <= now()) throw err(400, 'Challenge expired or unknown. Request a new one.');
    nonces.delete(nonce); // single use
    if (!ACCOUNT_RE.test(String(accountId || ''))) throw err(400, 'Bad account id');
    const ok = verifyNep413(
      { message: SIGN_IN_MESSAGE, recipient: SIGN_IN_RECIPIENT, nonce: Buffer.from(nonce, 'base64') },
      String(publicKey || ''), String(signature || ''),
    );
    if (!ok) throw err(401, 'Signature does not verify');
    let owns;
    try { owns = await ledger.rpc.accessKeyExists(accountId, publicKey); } catch { throw err(502, 'Could not reach the NEAR RPC to check the key'); }
    if (!owns) throw err(401, 'That public key is not an access key of this account');
    const token = newToken();
    db.sessions[hashToken(token)] = { account: accountId, expiresAt: now() + SESSION_MS };
    for (const [h, s] of Object.entries(db.sessions)) if (s.expiresAt <= now()) delete db.sessions[h];
    save();
    return { account: accountId, token, expiresAt: now() + SESSION_MS };
  });

  route('GET', '/api/traders', async () => {
    const list = await Promise.all(Object.values(db.traders).map((t) => publicView(t, { withOffers: false })));
    list.sort((a, b) => b.metrics.totalPnlPct - a.metrics.totalPnlPct);
    return list.map((v) => ({ ...v, metrics: { ...v.metrics, curve: undefined } }));
  });

  route('POST', '/api/traders', async (req, _p, body) => {
    const account = chain ? sessionAccount(req) : String(body.account || '').toLowerCase();
    if (!ACCOUNT_RE.test(account)) throw err(400, 'Account must look like name.testnet or name.near');
    if (db.traders[account]) throw err(409, 'That account already has a trader profile');
    const manageToken = chain ? null : newToken();
    db.traders[account] = { account, createdAt: now(), manageHash: manageToken && hashToken(manageToken), strategy: null, trades: [], offers: [] };
    save();
    return chain ? { account } : { account, manageToken, warning: 'Store this token. It is shown once and cannot be recovered.' };
  });

  route('GET', '/api/traders/:account', async (_req, p) => publicView(trader(p.account)));

  route('PUT', '/api/traders/:account/strategy', async (req, p, body) => {
    const t = requireManage(req, p.account);
    const name = String(body.name || '').trim();
    if (!name || name.length > 60) throw err(400, 'Strategy name is required (max 60 chars)');
    t.strategy = {
      name,
      tagline: String(body.tagline || '').trim().slice(0, 140),
      mode: chain ? 'testnet' : 'dry-run',
      thesis: String(body.thesis || '').trim().slice(0, 4000), // private
    };
    save();
    return { ok: true };
  });

  route('POST', '/api/traders/:account/trades', async (req, p, body) => {
    const t = requireManage(req, p.account);
    if (!t.strategy) throw err(400, 'Create a strategy first');
    const trade = {
      pair: String(body.pair || ''), side: String(body.side || ''),
      entry: Number(body.entry), exit: Number(body.exit), sizePct: Number(body.sizePct),
      note: String(body.note || '').slice(0, 500), closedAt: now(),
    };
    if (!PAIRS.includes(trade.pair)) throw err(400, `Pair must be one of: ${PAIRS.join(', ')}`);
    if (!['long', 'short'].includes(trade.side)) throw err(400, 'Side must be long or short');
    if (![trade.entry, trade.exit].every((n) => Number.isFinite(n) && n > 0)) throw err(400, 'Entry and exit must be positive numbers');
    if (!(trade.sizePct > 0 && trade.sizePct <= 100)) throw err(400, 'sizePct must be between 0 and 100');
    t.trades.push(seal(deriveKey(master, t.account), trade));
    save();
    return { ok: true, metrics: computeMetrics(privateTrades(t)) };
  });

  route('PUT', '/api/traders/:account/offers', async (req, p, body) => {
    if (chain) throw err(400, 'In testnet mode offers live on-chain. Call set_offer on the contract from your wallet.');
    const t = requireManage(req, p.account);
    const clean = (Array.isArray(body.offers) ? body.offers : []).map((o) => ({ durationDays: Number(o.durationDays), priceNear: Number(o.priceNear) }));
    for (const o of clean) {
      if (!DURATIONS.includes(o.durationDays)) throw err(400, `durationDays must be one of ${DURATIONS.join(', ')}`);
      if (!(o.priceNear > 0)) throw err(400, 'priceNear must be positive');
    }
    t.offers = clean;
    save();
    return { ok: true, offers: clean };
  });

  route('POST', '/api/traders/:account/keys/buy', async (_req, p, body) => {
    if (chain) throw err(400, 'In testnet mode buy on-chain: call buy_key on the contract from your wallet.');
    const t = trader(p.account);
    const buyer = String(body.buyer || '').toLowerCase();
    if (!ACCOUNT_RE.test(buyer)) throw err(400, 'Buyer must be a NEAR account like you.testnet');
    if (buyer === t.account) throw err(400, 'Traders do not need to buy their own key');
    const offer = t.offers.find((o) => o.durationDays === Number(body.durationDays));
    if (!offer) throw err(400, 'That duration is not on sale');
    const token = newToken();
    const keyId = crypto.randomBytes(6).toString('hex');
    const expiresAt = now() + offer.durationDays * 86400000;
    const { ref } = await ledger.recordPurchase({ keyId, trader: t.account, buyer, expiresAt, priceNear: offer.priceNear });
    db.keys[hashToken(token)] = { keyId, trader: t.account, buyer, issuedAt: now(), expiresAt, priceNear: offer.priceNear, revoked: false, ledgerRef: ref };
    save();
    return { keyId, token, expiresAt, priceNear: offer.priceNear, ledgerRef: ref, payment: 'simulated' };
  });

  route('GET', '/api/traders/:account/keys', async (req, p) => {
    requireManage(req, p.account);
    if (chain) return []; // grants are on-chain and not enumerable from the contract
    return Object.values(db.keys).filter((k) => k.trader === p.account)
      .map((k) => ({ keyId: k.keyId, buyer: k.buyer, issuedAt: k.issuedAt, expiresAt: k.expiresAt, priceNear: k.priceNear, state: keyState(k) }));
  });

  route('POST', '/api/traders/:account/keys/:keyId/revoke', async (req, p) => {
    if (chain) throw err(400, 'In testnet mode revoke on-chain: call revoke(holder) on the contract from your wallet.');
    requireManage(req, p.account);
    const k = Object.values(db.keys).find((x) => x.keyId === p.keyId && x.trader === p.account);
    if (!k) throw err(404, 'Key not found');
    k.revoked = true;
    k.revokeRef = (await ledger.recordRevoke({ keyId: k.keyId, trader: p.account })).ref;
    save();
    return { ok: true, state: keyState(k) };
  });

  // Private boundary: everything below needs a valid viewing key.
  route('GET', '/api/traders/:account/private', async (req, p) => {
    const v = await requireViewer(req, p.account);
    const t = trader(p.account);
    return { keyId: v.keyId, expiresAt: v.expiresAt, thesis: t.strategy ? t.strategy.thesis : '', trades: privateTrades(t).slice().reverse() };
  });

  route('POST', '/api/traders/:account/copy', async (req, p, body) => {
    const v = await requireViewer(req, p.account);
    const follower = chain ? v.holder : String(body.follower || '').toLowerCase();
    const budget = Number(body.budgetUsd);
    const count = Math.min(Math.max(Number(body.lastN) || 1, 1), 10);
    if (!ACCOUNT_RE.test(follower)) throw err(400, 'Follower must be a NEAR account');
    if (!(budget > 0)) throw err(400, 'budgetUsd must be positive');
    const trades = privateTrades(trader(p.account)).slice(-count);
    if (!trades.length) throw err(409, 'This trader has no recorded trades to copy yet');
    return {
      mode: ledger.mode,
      note: 'These are NEAR Intents quote requests (dry: true). Submit them to the Intents 1Click API with your own credentials to get deposit addresses.',
      orders: trades.map((tr) => ({ source: { pair: tr.pair, side: tr.side, entry: tr.entry, exit: tr.exit }, legs: buildLegs(tr, follower, budget) })),
    };
  });

  // ---- Trader tools: trade log, analytics, export, delete ----
  const r2 = (x) => Math.round(x * 100) / 100;

  route('GET', '/api/traders/:account/trades', async (req, p) => {
    const t = requireManage(req, p.account);
    return privateTrades(t).map((x, i) => ({ index: i, ...x, pnlPct: r2(tradePnlPct(x)) }));
  });

  route('DELETE', '/api/traders/:account/trades/:index', async (req, p) => {
    const t = requireManage(req, p.account);
    const i = Number(p.index);
    if (!Number.isInteger(i) || i < 0 || i >= t.trades.length) throw err(404, 'No such trade');
    t.trades.splice(i, 1);
    save();
    return { ok: true, metrics: computeMetrics(privateTrades(t)) };
  });

  route('GET', '/api/traders/:account/analytics', async (req, p) => {
    const t = requireManage(req, p.account);
    const pnls = privateTrades(t).map(tradePnlPct);
    const wins = pnls.filter((x) => x > 0);
    const losses = pnls.filter((x) => x < 0);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const trade = {
      count: pnls.length,
      bestPct: pnls.length ? r2(Math.max(...pnls)) : null,
      worstPct: pnls.length ? r2(Math.min(...pnls)) : null,
      avgWinPct: wins.length ? r2(sum(wins) / wins.length) : null,
      avgLossPct: losses.length ? r2(sum(losses) / losses.length) : null,
      profitFactor: losses.length ? r2(sum(wins) / Math.abs(sum(losses))) : null,
    };
    if (chain) return { onChain: true, trade };
    const ks = Object.values(db.keys).filter((k) => k.trader === p.account).sort((a, b) => b.issuedAt - a.issuedAt);
    return {
      onChain: false,
      simulatedPayments: true,
      trade,
      sales: {
        keysSold: ks.length,
        active: ks.filter((k) => keyState(k) === 'active').length,
        uniqueHolders: new Set(ks.map((k) => k.buyer)).size,
        revenueNear: Math.round(ks.reduce((a, k) => a + k.priceNear, 0) * 10000) / 10000,
        recent: ks.slice(0, 20).map((k) => ({ keyId: k.keyId, buyer: k.buyer, issuedAt: k.issuedAt, priceNear: k.priceNear, state: keyState(k) })),
      },
    };
  });

  route('GET', '/api/traders/:account/export', async (req, p) => {
    const t = requireManage(req, p.account);
    return {
      exportedAt: new Date().toISOString(),
      mode: ledger.mode,
      account: t.account,
      createdAt: t.createdAt,
      strategy: t.strategy,
      offers: chain ? 'on-chain' : t.offers,
      trades: privateTrades(t),
      keysIssued: chain ? 'on-chain' : Object.values(db.keys).filter((k) => k.trader === t.account)
        .map((k) => ({ keyId: k.keyId, buyer: k.buyer, issuedAt: k.issuedAt, expiresAt: k.expiresAt, priceNear: k.priceNear, state: keyState(k) })),
    };
  });

  route('DELETE', '/api/traders/:account', async (req, p) => {
    const t = requireManage(req, p.account);
    delete db.traders[t.account];
    for (const [h, k] of Object.entries(db.keys)) if (k.trader === t.account) delete db.keys[h];
    for (const [id, c] of Object.entries(db.copies)) if (c.trader === t.account) delete db.copies[id];
    save();
    return { ok: true, note: chain ? 'Off-chain data deleted. Offers and grants on the contract remain until you change them from your wallet.' : 'Profile, trades, keys and tracked copies deleted.' };
  });

  // ---- Followers: held keys and copy tracking ----
  route('POST', '/api/me/keys/status', async (_req, _p, body) => {
    if (chain) throw err(400, 'In testnet mode use GET /api/me/access');
    const tokens = Array.isArray(body.tokens) ? body.tokens.slice(0, 100) : [];
    return tokens.map((tk) => db.keys[hashToken(String(tk))]).filter(Boolean)
      .map((k) => ({ trader: k.trader, keyId: k.keyId, buyer: k.buyer, issuedAt: k.issuedAt, expiresAt: k.expiresAt, priceNear: k.priceNear, state: keyState(k) }));
  });

  route('GET', '/api/me/access', async (req) => {
    if (!chain) throw err(400, 'Use POST /api/me/keys/status in dry-run mode');
    const holder = sessionAccount(req);
    const out = [];
    for (const t of Object.values(db.traders)) {
      if (t.account === holder) continue;
      let g = null;
      try { g = await ledger.getGrant(t.account, holder); } catch { continue; }
      if (!g) continue;
      out.push({ trader: t.account, expiresAt: g.expires_at_ms, state: g.revoked ? 'revoked' : g.expires_at_ms <= now() ? 'expired' : 'active' });
    }
    return out;
  });

  const copyOut = (c, t) => {
    const snap = open(deriveKey(master, t.account), c.snap);
    return { id: c.id, trader: c.trader, createdAt: c.createdAt, budgetUsd: c.budgetUsd, status: c.status, trade: snap, pnlUsd: Math.round(c.budgetUsd * tradePnlPct(snap)) / 100 };
  };

  route('POST', '/api/traders/:account/copies', async (req, p, body) => {
    const v = await requireViewer(req, p.account);
    if (v.keyId === 'owner') throw err(400, 'Traders cannot track copies of their own strategy');
    const t = trader(p.account);
    const budget = Number(body.budgetUsd);
    if (!(budget > 0)) throw err(400, 'budgetUsd must be positive');
    const count = Math.min(Math.max(Number(body.lastN) || 1, 1), 10);
    const trades = privateTrades(t).slice(-count);
    if (!trades.length) throw err(409, 'This trader has no recorded trades to copy yet');
    const have = new Set(Object.values(db.copies).filter((c) => c.trader === p.account && c.holder === v.holder).map((c) => c.closedAt));
    const key = deriveKey(master, t.account);
    let created = 0;
    let skipped = 0;
    for (const tr of trades) {
      if (have.has(tr.closedAt)) { skipped++; continue; }
      const id = crypto.randomBytes(6).toString('hex');
      db.copies[id] = { id, trader: p.account, holder: v.holder, createdAt: now(), budgetUsd: budget, status: 'drafted', closedAt: tr.closedAt, snap: seal(key, tr) };
      created++;
    }
    save();
    return { created, skipped };
  });

  route('GET', '/api/traders/:account/copies', async (req, p) => {
    const v = await requireViewer(req, p.account);
    const t = trader(p.account);
    const copies = Object.values(db.copies).filter((c) => c.trader === p.account && c.holder === v.holder)
      .sort((a, b) => b.createdAt - a.createdAt).map((c) => copyOut(c, t));
    const ex = copies.filter((c) => c.status === 'executed');
    return {
      copies,
      totals: {
        tracked: copies.length,
        executed: ex.length,
        executedPnlUsd: r2(ex.reduce((a, c) => a + c.pnlUsd, 0)),
        ifAllExecutedPnlUsd: r2(copies.filter((c) => c.status !== 'skipped').reduce((a, c) => a + c.pnlUsd, 0)),
      },
    };
  });

  route('POST', '/api/traders/:account/copies/:id/status', async (req, p, body) => {
    const v = await requireViewer(req, p.account);
    const c = db.copies[p.id];
    if (!c || c.trader !== p.account || c.holder !== v.holder) throw err(404, 'Copy not found');
    if (!['drafted', 'executed', 'skipped'].includes(body.status)) throw err(400, 'Status must be drafted, executed or skipped');
    c.status = body.status;
    save();
    return { ok: true };
  });

  route('DELETE', '/api/traders/:account/copies/:id', async (req, p) => {
    const v = await requireViewer(req, p.account);
    const c = db.copies[p.id];
    if (!c || c.trader !== p.account || c.holder !== v.holder) throw err(404, 'Copy not found');
    delete db.copies[p.id];
    save();
    return { ok: true };
  });

  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = url.pathname.match(r.re);
          if (!m) continue;
          const params = {};
          r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
          let body = {};
          if (['POST', 'PUT'].includes(req.method)) {
            let raw = '';
            for await (const c of req) { raw += c; if (raw.length > 100000) throw err(413, 'Body too large'); }
            try { body = raw ? JSON.parse(raw) : {}; } catch { throw err(400, 'Body must be JSON'); }
          }
          return send(200, await r.handler(req, params, body));
        }
        throw err(404, 'No such endpoint');
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname === '/app' ? 'app.html' : url.pathname.slice(1);
      const full = path.join(ROOT, 'public', path.normalize(file));
      if (!full.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(full)) return send(404, 'Not found', 'text/plain');
      send(200, fs.readFileSync(full), mime[path.extname(full)] || 'application/octet-stream');
    } catch (e) {
      send(e.status || 500, { error: e.status ? e.message : 'Internal error' });
      if (!e.status) console.error(e);
    }
  }
  return http.createServer(handler);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const ledger = ledgerFromEnv();
  createApp({ ledger }).listen(port, () =>
    console.log(`KeyView running at http://localhost:${port} (${ledger.mode}${ledger.contract ? ', contract ' + ledger.contract : ''})`));
}
