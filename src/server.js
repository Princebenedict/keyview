import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { computeMetrics } from './metrics.js';
import { deriveKey, seal, open, newToken, hashToken } from './vault.js';
import { createDryRunLedger } from './ledger.js';
import { buildLegs, PAIRS } from './intents.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{1,62}\.(testnet|near)$/;
const DURATIONS = [7, 30];

export function createApp({ dataDir = path.join(ROOT, 'data'), ledger = createDryRunLedger() } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'db.json');
  const secretPath = path.join(dataDir, 'master.key');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32), { mode: 0o600 });
  const master = fs.readFileSync(secretPath);
  let db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : { traders: {}, keys: {} };
  const save = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  const err = (status, message) => Object.assign(new Error(message), { status });
  const now = () => Date.now();

  function trader(account) {
    const t = db.traders[account];
    if (!t) throw err(404, 'Trader not found');
    return t;
  }
  function requireManage(req, account) {
    const t = trader(account);
    const tok = bearer(req);
    if (!tok || hashToken(tok) !== t.manageHash) throw err(401, 'Missing or wrong manage token');
    return t;
  }
  function bearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  }
  function keyState(k) {
    if (k.revoked) return 'revoked';
    if (k.expiresAt <= now()) return 'expired';
    return 'active';
  }
  function requireViewingKey(req, account) {
    trader(account);
    const tok = bearer(req);
    if (!tok) throw err(401, 'A viewing key is required');
    const k = db.keys[hashToken(tok)];
    if (!k || k.trader !== account) throw err(403, 'This key does not unlock this trader');
    const s = keyState(k);
    if (s !== 'active') throw err(403, `Viewing key is ${s}`);
    return k;
  }
  function privateTrades(t) {
    const key = deriveKey(master, t.account);
    return t.trades.map((blob) => open(key, blob));
  }
  function publicView(t) {
    const m = computeMetrics(privateTrades(t));
    return {
      account: t.account,
      createdAt: t.createdAt,
      strategy: t.strategy ? { name: t.strategy.name, tagline: t.strategy.tagline, mode: t.strategy.mode } : null,
      metrics: m,
      offers: t.offers,
      activeKeys: Object.values(db.keys).filter((k) => k.trader === t.account && keyState(k) === 'active').length,
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
    pairs: PAIRS,
    durations: DURATIONS,
    note: ledger.mode === 'dry-run'
      ? 'Dry-run: payments and confidential execution are simulated. Nothing leaves this server.'
      : 'Testnet ledger active.',
  }));

  route('GET', '/api/traders', async () => {
    const list = Object.values(db.traders).map(publicView);
    list.sort((a, b) => b.metrics.totalPnlPct - a.metrics.totalPnlPct);
    return list.map((v) => ({ ...v, metrics: { ...v.metrics, curve: undefined } }));
  });

  route('POST', '/api/traders', async (req, _p, body) => {
    const account = String(body.account || '').toLowerCase();
    if (!ACCOUNT_RE.test(account)) throw err(400, 'Account must look like name.testnet or name.near');
    if (db.traders[account]) throw err(409, 'That account already has a trader profile');
    const manageToken = newToken();
    db.traders[account] = {
      account, createdAt: now(), manageHash: hashToken(manageToken),
      strategy: null, trades: [], offers: [],
    };
    save();
    return { account, manageToken, warning: 'Store this token. It is shown once and cannot be recovered.' };
  });

  route('GET', '/api/traders/:account', async (_req, p) => publicView(trader(p.account)));

  route('PUT', '/api/traders/:account/strategy', async (req, p, body) => {
    const t = requireManage(req, p.account);
    const name = String(body.name || '').trim();
    if (!name || name.length > 60) throw err(400, 'Strategy name is required (max 60 chars)');
    t.strategy = {
      name,
      tagline: String(body.tagline || '').trim().slice(0, 140),
      mode: 'dry-run',
      thesis: String(body.thesis || '').trim().slice(0, 4000), // private
    };
    save();
    return { ok: true };
  });

  route('POST', '/api/traders/:account/trades', async (req, p, body) => {
    const t = requireManage(req, p.account);
    if (!t.strategy) throw err(400, 'Create a strategy first');
    const trade = {
      pair: String(body.pair || ''),
      side: String(body.side || ''),
      entry: Number(body.entry),
      exit: Number(body.exit),
      sizePct: Number(body.sizePct),
      note: String(body.note || '').slice(0, 500),
      closedAt: now(),
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
    const t = requireManage(req, p.account);
    const offers = Array.isArray(body.offers) ? body.offers : [];
    const clean = offers.map((o) => ({ durationDays: Number(o.durationDays), priceNear: Number(o.priceNear) }));
    for (const o of clean) {
      if (!DURATIONS.includes(o.durationDays)) throw err(400, `durationDays must be one of ${DURATIONS.join(', ')}`);
      if (!(o.priceNear > 0)) throw err(400, 'priceNear must be positive');
    }
    t.offers = clean;
    save();
    return { ok: true, offers: clean };
  });

  route('POST', '/api/traders/:account/keys/buy', async (_req, p, body) => {
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
    db.keys[hashToken(token)] = {
      keyId, trader: t.account, buyer, issuedAt: now(), expiresAt,
      priceNear: offer.priceNear, revoked: false, ledgerRef: ref,
    };
    save();
    return { keyId, token, expiresAt, priceNear: offer.priceNear, ledgerRef: ref, payment: ledger.mode === 'dry-run' ? 'simulated' : 'on-chain' };
  });

  route('GET', '/api/traders/:account/keys', async (req, p) => {
    requireManage(req, p.account);
    return Object.values(db.keys)
      .filter((k) => k.trader === p.account)
      .map((k) => ({ keyId: k.keyId, buyer: k.buyer, issuedAt: k.issuedAt, expiresAt: k.expiresAt, priceNear: k.priceNear, state: keyState(k) }));
  });

  route('POST', '/api/traders/:account/keys/:keyId/revoke', async (req, p) => {
    requireManage(req, p.account);
    const k = Object.values(db.keys).find((x) => x.keyId === p.keyId && x.trader === p.account);
    if (!k) throw err(404, 'Key not found');
    k.revoked = true;
    const { ref } = await ledger.recordRevoke({ keyId: k.keyId, trader: p.account });
    k.revokeRef = ref;
    save();
    return { ok: true, state: keyState(k) };
  });

  // Private boundary: everything below needs a valid viewing key.
  route('GET', '/api/traders/:account/private', async (req, p) => {
    const k = requireViewingKey(req, p.account);
    const t = trader(p.account);
    return {
      keyId: k.keyId,
      expiresAt: k.expiresAt,
      thesis: t.strategy ? t.strategy.thesis : '',
      trades: privateTrades(t).slice().reverse(),
    };
  });

  route('POST', '/api/traders/:account/copy', async (req, p, body) => {
    requireViewingKey(req, p.account);
    const follower = String(body.follower || '').toLowerCase();
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

  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
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
  createApp().listen(port, () => console.log(`KeyView running at http://localhost:${port} (dry-run mode)`));
}
