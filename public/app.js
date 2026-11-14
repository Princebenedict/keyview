const $app = document.getElementById('app');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
let cfg = null;
let walletMod = null;
const testnet = () => cfg.mode === 'testnet';
const loadWallet = async () => (walletMod ||= await import('/wallet.js'));

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

async function api(method, path, body, token) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const pct = (n) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const usd = (n) => (n == null ? 'n/a' : `${n < 0 ? '-' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`);
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const stat = (label, value, c = '') => h('div', { class: 'stat' }, h('span', {}, label), h('b', { class: c }, value));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString() : 'no expiry');
const flash = (el, text, bad) => el.replaceChildren(h('p', { class: bad ? 'err' : 'ok' }, text));
const link = (href, text) => h('a', { href }, text);
const pill = (state) => h('span', { class: `pill ${state}` }, state);
const panel = (...kids) => h('div', { class: 'panel' }, ...kids);
function remaining(ms) {
  if (!ms) return 'no expiry';
  const left = ms - Date.now();
  if (left <= 0) return 'ended';
  const d = Math.floor(left / 86400000), hrs = Math.floor((left % 86400000) / 3600000);
  return d ? `${d}d ${hrs}h left` : `${hrs}h ${Math.floor((left % 3600000) / 60000)}m left`;
}

// ---------- preferences ----------
const getPrefs = () => ({ theme: 'light', budget: 100, lastN: 1, ...store.get('kv.prefs', {}) });
const applyTheme = () => { document.documentElement.dataset.theme = getPrefs().theme; };
applyTheme();

// ---------- identity ----------
const session = () => { const s = store.get('kv.session', null); return s && s.expiresAt > Date.now() ? s : null; };

function identity() {
  if (testnet()) { const s = session(); return s ? { account: s.account, token: s.token, walletId: s.walletId } : null; }
  return store.get('kv.me', null);
}

async function connect(walletId) {
  const w = await loadWallet();
  const challenge = await api('POST', '/api/auth/challenge');
  const signed = await w.connectAndSign(cfg, walletId, challenge);
  const r = await api('POST', '/api/auth/verify', { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: signed.nonce });
  store.set('kv.session', { account: r.account, token: r.token, expiresAt: r.expiresAt, walletId });
}

function connectPanel(onDone) {
  const msg = h('div', {});
  return panel(h('h2', {}, 'Connect a NEAR wallet'),
    h('p', { class: 'mute' }, `Signs a one-time message (NEP-413) to prove you own the account. Network: ${cfg.network}. Access contract: ${cfg.contract}.`),
    h('div', {}, [['meteor-wallet', 'Meteor Wallet'], ['here-wallet', 'HERE Wallet']].map(([id, label]) => h('button', { onclick: async () => {
      try { flash(msg, 'Waiting for the wallet...'); await connect(id); onDone(); } catch (e) { flash(msg, e.message, true); }
    } }, label))), msg);
}

function renderAuth() {
  const el = document.getElementById('auth');
  el.replaceChildren();
  if (!testnet()) return;
  const s = session();
  if (s) el.append(h('span', { class: 'mute' }, s.account + ' '), h('button', { class: 'small ghost', onclick: () => { store.set('kv.session', null); render(); } }, 'Disconnect'));
  else el.append(h('a', { href: '#/dashboard' }, 'Connect wallet'));
}

async function needProfile(title) {
  const me = identity();
  if (!me) {
    if (testnet()) { $app.replaceChildren(connectPanel(render)); return null; }
    $app.replaceChildren(panel(h('h2', {}, title), h('p', { class: 'mute' }, 'This tab needs a trader profile on this browser.'), link('#/dashboard', 'Create or restore a profile')));
    return null;
  }
  try { return { me, t: await api('GET', `/api/traders/${me.account}`) }; }
  catch {
    $app.replaceChildren(panel(h('h2', {}, title), h('p', { class: 'mute' }, `This server has no profile for ${me.account}. It may have been reset.`), link('#/dashboard', 'Create or restore a profile')));
    return null;
  }
}

// ---------- shared UI ----------
function chart(curve) {
  if (!curve.length) return h('div', { class: 'empty' }, 'No closed trades yet, so there is no curve to draw.');
  const w = 600, ht = 170, padX = 10, padY = 18;
  const ys = [0, ...curve.map((c) => c.cumPnlPct)];
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const X = (i) => padX + (i / Math.max(ys.length - 1, 1)) * (w - 2 * padX);
  const Y = (y) => ht - padY - ((y - min) / span) * (ht - 2 * padY);
  const pts = ys.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`);
  const line = 'M' + pts.join(' L');
  const last = ys.length - 1;
  const area = `${line} L${X(last).toFixed(1)},${ht} L${X(0).toFixed(1)},${ht} Z`;
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  svg.setAttribute('class', 'chart');
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--acid);stop-opacity:.6"/><stop offset="1" style="stop-color:var(--acid);stop-opacity:0"/></linearGradient></defs>`
    + `<line class="zero" x1="${padX}" x2="${w - padX}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`
    + `<path class="area" d="${area}" fill="url(#${id})"/><path class="line" pathLength="1" d="${line}"/>`
    + `<circle class="end" cx="${X(last).toFixed(1)}" cy="${Y(ys[last]).toFixed(1)}" r="4.5"/>`;
  return svg;
}

function metricsRow(m) {
  return h('div', { class: 'row' },
    stat('Total PnL', pct(m.totalPnlPct), cls(m.totalPnlPct)),
    stat('Trades', m.trades),
    stat('Win rate', m.winRatePct == null ? 'n/a' : `${m.winRatePct}%`),
    stat('Max drawdown', m.maxDrawdownPct == null ? 'n/a' : `-${m.maxDrawdownPct}%`));
}

async function heldKeys() {
  if (testnet()) {
    const s = session();
    if (!s) return { needsConnect: true, rows: [], stale: 0 };
    const rows = await api('GET', '/api/me/access', null, s.token);
    return { rows: rows.map((r) => ({ ...r, token: s.token })), stale: 0 };
  }
  const ks = store.get('kv.keys', {});
  const tokens = Object.values(ks);
  if (!tokens.length) return { rows: [], stale: 0 };
  const st = await api('POST', '/api/me/keys/status', { tokens });
  return { rows: st.map((r) => ({ ...r, token: ks[r.trader] })), stale: tokens.length - st.length };
}

// ---------- Leaderboard ----------
async function leaderboard() {
  const list = await api('GET', '/api/traders');
  const search = h('input', { placeholder: 'Search trader or strategy' });
  const sort = h('select', {}, [['pnl', 'Sort by PnL'], ['win', 'Sort by win rate'], ['dd', 'Sort by lowest drawdown'], ['trades', 'Sort by trades']].map(([v, l]) => h('option', { value: v }, l)));
  const body = h('tbody', {});
  const empty = h('div', { class: 'empty' }, '');
  const key = { pnl: (t) => -t.metrics.totalPnlPct, win: (t) => -(t.metrics.winRatePct ?? -1), dd: (t) => t.metrics.maxDrawdownPct ?? 1e9, trades: (t) => -t.metrics.trades };
  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = list.filter((t) => !q || t.account.includes(q) || (t.strategy && t.strategy.name.toLowerCase().includes(q))).sort((a, b) => key[sort.value](a) - key[sort.value](b));
    body.replaceChildren(...rows.map((t, i) => h('tr', { class: 'click', onclick: () => { location.hash = `#/trader/${t.account}`; } },
      h('td', { class: 'rank' }, String(i + 1).padStart(2, '0')), h('td', {}, t.account), h('td', {}, t.strategy ? t.strategy.name : 'No strategy yet'),
      h('td', { class: cls(t.metrics.totalPnlPct) }, pct(t.metrics.totalPnlPct)),
      h('td', {}, t.metrics.trades), h('td', {}, t.metrics.winRatePct == null ? 'n/a' : `${t.metrics.winRatePct}%`),
      h('td', {}, t.metrics.maxDrawdownPct == null ? 'n/a' : `-${t.metrics.maxDrawdownPct}%`),
      h('td', {}, testnet() ? '' : t.activeKeys))));
    empty.textContent = list.length ? (rows.length ? '' : 'No traders match that search.') : (testnet() ? 'No traders yet. Connect a wallet on the Trader dashboard to create the first profile.' : 'No traders yet. Open the Trader dashboard to create the first profile.');
  }
  search.addEventListener('input', draw); sort.addEventListener('change', draw);
  $app.replaceChildren(panel(h('h2', {}, 'Leaderboard'),
    h('p', { class: 'mute' }, 'Public PnL and risk only. Pair, side, size, entries, exits and thesis stay behind a viewing key.'),
    list.length ? h('div', { class: 'toolbar' }, search, sort) : null,
    list.length ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Trader', 'Strategy', 'PnL', 'Trades', 'Win rate', 'Max DD', testnet() ? '' : 'Live keys'].map((x) => h('th', {}, x)))), body) : null,
    empty));
  draw();
}

// ---------- Trader page ----------
async function traderPage(account) {
  const t = await api('GET', `/api/traders/${account}`);
  const s = session();
  const token = testnet() ? (s && s.token) : store.get('kv.keys', {})[account];
  const prefs = getPrefs();
  const root = h('div', {});
  root.append(panel(
    h('h2', {}, `${t.account}${t.strategy ? ' / ' + t.strategy.name : ''}`),
    t.strategy && t.strategy.tagline ? h('p', { class: 'mute' }, t.strategy.tagline) : null,
    metricsRow(t.metrics), h('h3', {}, 'Public equity curve'), chart(t.metrics.curve)));
  const priv = panel(h('h2', {}, 'Private strategy'));
  root.append(priv);

  function copyBox() {
    const out = h('div', {});
    const follower = h('input', { placeholder: 'you.testnet', value: testnet() && s ? s.account : '', disabled: testnet() ? 'disabled' : null });
    const budget = h('input', { type: 'number', min: '1', value: String(prefs.budget) });
    const n = h('input', { type: 'number', min: '1', max: '10', value: String(prefs.lastN) });
    return h('div', {}, h('h3', {}, 'Copy this strategy'),
      h('p', { class: 'mute' }, 'Build NEAR Intents quote requests that mirror the trader\'s most recent trades, scaled to your budget. Nothing is submitted for you. Track the copies to follow their results.'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Your NEAR account'), follower), h('div', {}, h('label', {}, 'Budget (USD)'), budget), h('div', {}, h('label', {}, 'Last N trades'), n)),
      h('button', { onclick: async () => {
        try {
          const r = await api('POST', `/api/traders/${account}/copy`, { follower: follower.value, budgetUsd: Number(budget.value), lastN: Number(n.value) }, token);
          out.replaceChildren(h('p', { class: 'mute' }, r.note), ...r.orders.map((o) => h('div', {}, h('b', {}, `${o.source.side} ${o.source.pair}`), o.legs.map((l) => h('pre', {}, JSON.stringify(l, null, 2))))));
        } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
      } }, 'Build Intents orders'),
      h('button', { class: 'ghost', onclick: async () => {
        try {
          const r = await api('POST', `/api/traders/${account}/copies`, { budgetUsd: Number(budget.value), lastN: Number(n.value) }, token);
          out.replaceChildren(h('p', { class: 'ok' }, `Tracked ${r.created} new ${r.created === 1 ? 'copy' : 'copies'}${r.skipped ? `, ${r.skipped} already tracked` : ''}. `, link('#/tracker', 'Open Copy tracker')));
        } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
      } }, 'Track these copies'), out);
  }

  function buyBox(reason) {
    if (t.offersError) return h('div', { class: 'locked' }, h('p', { class: 'err' }, 'Could not read this trader\'s key offers from the chain. Refresh in a moment.'));
    if (!t.offers.length) return h('div', { class: 'locked' }, reason ? h('p', { class: 'err' }, reason) : null, 'This trader has not put any viewing keys on sale yet.');
    const msg = h('div', {});
    const dur = h('select', {}, t.offers.map((o) => h('option', { value: o.durationDays }, `${o.durationDays} days for ${o.priceNear} NEAR`)));
    if (testnet()) {
      return h('div', { class: 'locked' }, reason ? h('p', { class: 'err' }, reason) : null,
        h('p', {}, 'Trade details are locked. A viewing key is an on-chain grant on the KeyView contract. It gives read access to this strategy for a fixed time and does not control your wallet.'),
        s ? null : h('p', {}, 'Connect your wallet on the Trader dashboard first.'),
        h('label', {}, 'Duration'), dur,
        h('button', { onclick: async () => {
          if (!s) { location.hash = '#/dashboard'; return; }
          try {
            const w = await loadWallet();
            const offer = t.offers.find((o) => o.durationDays === Number(dur.value));
            flash(msg, 'Confirm the payment in your wallet...');
            await w.callContract(cfg, s.walletId, 'buy_key', { trader: account, duration_days: offer.durationDays }, offer.priceYocto);
            location.reload();
          } catch (e) { flash(msg, e.message, true); }
        } }, 'Buy viewing key on-chain'), msg);
    }
    const buyer = h('input', { placeholder: 'you.testnet' });
    return h('div', { class: 'locked' }, reason ? h('p', { class: 'err' }, reason) : null,
      h('p', {}, 'Trade details are locked. A viewing key grants read access to this one strategy for a fixed time. It does not control any wallet.'),
      h('label', {}, 'Your NEAR account'), buyer, h('label', {}, 'Duration'), dur,
      h('button', { onclick: async () => {
        try {
          const r = await api('POST', `/api/traders/${account}/keys/buy`, { buyer: buyer.value, durationDays: Number(dur.value) });
          const ks = store.get('kv.keys', {}); ks[account] = r.token; store.set('kv.keys', ks);
          location.reload();
        } catch (e) { flash(msg, e.message, true); }
      } }, 'Buy viewing key (simulated payment)'), msg);
  }

  async function showPrivate() {
    try {
      const p = await api('GET', `/api/traders/${account}/private`, null, token);
      priv.replaceChildren(h('h2', {}, 'Private strategy'),
        h('p', { class: 'ok' }, p.expiresAt ? `Viewing key active, ${remaining(p.expiresAt)} (until ${fmtDate(p.expiresAt)})` : 'You own this strategy'),
        h('h3', {}, 'Thesis'), h('p', {}, p.thesis || 'The trader has not written a thesis.'),
        h('h3', {}, 'Trades'),
        p.trades.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Pair', 'Side', 'Size', 'Entry', 'Exit', 'Note', 'Closed'].map((x) => h('th', {}, x)))),
          h('tbody', {}, p.trades.map((x) => h('tr', {}, h('td', {}, x.pair), h('td', {}, x.side), h('td', {}, `${x.sizePct}%`), h('td', {}, x.entry), h('td', {}, x.exit), h('td', {}, x.note || ''), h('td', {}, fmtDate(x.closedAt))))))
          : h('div', { class: 'empty' }, 'No trades recorded yet.'),
        p.expiresAt || !testnet() ? copyBox() : null);
    } catch (e) {
      priv.replaceChildren(h('h2', {}, 'Private strategy'), buyBox(testnet() ? e.message : `Your stored key was rejected: ${e.message}`));
    }
  }

  if (token) await showPrivate(); else priv.append(buyBox());
  $app.replaceChildren(root);
}

// ---------- Trader dashboard ----------
async function restoreProfile(account, token) {
  await api('GET', `/api/traders/${account}/keys`, null, token); // 401 if the token is wrong
  store.set('kv.me', { account, token });
}

async function dashboard() {
  const root = h('div', {});
  let me;
  if (testnet()) {
    const s = session();
    if (!s) { $app.replaceChildren(connectPanel(render)); return; }
    me = { account: s.account, token: s.token, walletId: s.walletId };
  } else me = store.get('kv.me', null);
  let t = null;
  if (me) { try { t = await api('GET', `/api/traders/${me.account}`); } catch { t = null; } }

  if (!t) {
    const acct = h('input', { placeholder: 'yourname.testnet' });
    const msg = h('div', {});
    root.append(panel(h('h2', {}, 'Create trader profile'),
      me && !testnet() ? h('p', { class: 'err' }, `This server has no profile for ${me.account}. It may have been reset. Create a new one below.`) : null,
      testnet()
        ? h('p', { class: 'mute' }, `Profile for ${me.account}. You prove ownership by wallet signature, so there is no token to store.`)
        : h('p', { class: 'mute' }, 'In dry-run mode a profile is controlled by a manage token stored in this browser. Wallet sign-in belongs to testnet mode.'),
      testnet() ? null : [h('label', {}, 'NEAR account'), acct],
      h('button', { onclick: async () => {
        try {
          const r = await api('POST', '/api/traders', testnet() ? {} : { account: acct.value }, testnet() ? me.token : null);
          if (!testnet()) store.set('kv.me', { account: r.account, token: r.manageToken });
          dashboard();
        } catch (e) { flash(msg, e.message, true); }
      } }, 'Create profile'), msg));
    if (!testnet()) {
      const ra = h('input', { placeholder: 'yourname.testnet' }), rt = h('input', { placeholder: 'kv_...' }), rm = h('div', {});
      root.append(panel(h('h2', {}, 'Restore an existing profile'),
        h('p', { class: 'mute' }, 'Already created a profile on this server? Enter the account and the manage token shown when you created it.'),
        h('label', {}, 'NEAR account'), ra, h('label', {}, 'Manage token'), rt,
        h('button', { class: 'ghost', onclick: async () => { try { await restoreProfile(ra.value.trim().toLowerCase(), rt.value.trim()); dashboard(); } catch (e) { flash(rm, e.message, true); } } }, 'Restore'), rm));
    }
    $app.replaceChildren(root);
    return;
  }

  const name = h('input', { value: t.strategy ? t.strategy.name : '' });
  const tag = h('input', { value: t.strategy ? t.strategy.tagline : '', placeholder: 'Public one-liner' });
  const thesis = h('textarea', { rows: '4', placeholder: 'Private. Only key holders see this. Leave empty to keep the saved thesis.' });
  const sMsg = h('div', {});
  const pair = h('select', {}, h('option', {}, 'NEAR/USDC'));
  const side = h('select', {}, h('option', {}, 'long'), h('option', {}, 'short'));
  const entry = h('input', { type: 'number', step: 'any' }), exit = h('input', { type: 'number', step: 'any' });
  const size = h('input', { type: 'number', min: '1', max: '100', value: '25' });
  const note = h('input', { placeholder: 'Private note' });
  const tMsg = h('div', {});
  const find = (d) => (t.offers.find((o) => o.durationDays === d) || {}).priceNear || '';
  const p7 = h('input', { type: 'number', step: 'any', value: find(7), placeholder: 'NEAR' });
  const p30 = h('input', { type: 'number', step: 'any', value: find(30), placeholder: 'NEAR' });
  const oMsg = h('div', {});

  async function saveOffers() {
    if (!testnet()) {
      const offers = [];
      if (p7.value) offers.push({ durationDays: 7, priceNear: Number(p7.value) });
      if (p30.value) offers.push({ durationDays: 30, priceNear: Number(p30.value) });
      await api('PUT', `/api/traders/${me.account}/offers`, { offers }, me.token);
      return 'Offers saved';
    }
    const w = await loadWallet();
    for (const [d, el] of [[7, p7], [30, p30]]) {
      if (!el.value) continue;
      flash(oMsg, `Confirm the ${d} day offer in your wallet...`);
      await w.callContract(cfg, me.walletId, 'set_offer', { duration_days: d, price_yocto: w.nearToYocto(el.value) });
    }
    return 'Offers submitted on-chain. Refresh in a few seconds to see them.';
  }

  const revokeHolder = h('input', { placeholder: 'holder.testnet' });
  const keysPanel = panel(h('h2', {}, 'Issued keys'));
  if (testnet()) {
    keysPanel.append(h('p', { class: 'mute' }, 'Grants live on the contract and are not listed here. To end a holder\'s access early, revoke them by account.'),
      h('label', {}, 'Holder account'), revokeHolder,
      h('button', { class: 'ghost', onclick: async () => {
        try { const w = await loadWallet(); await w.callContract(cfg, me.walletId, 'revoke', { holder: revokeHolder.value.trim() }); flash(oMsg, 'Revoke submitted on-chain.'); }
        catch (e) { flash(oMsg, e.message, true); }
      } }, 'Revoke holder'));
  } else {
    const keys = await api('GET', `/api/traders/${me.account}/keys`, null, me.token);
    keysPanel.append(keys.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Key', 'Holder', 'Price', 'Expires', 'State', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, keys.map((k) => h('tr', {}, h('td', {}, k.keyId), h('td', {}, k.buyer), h('td', {}, `${k.priceNear} NEAR`), h('td', {}, fmtDate(k.expiresAt)), h('td', {}, pill(k.state)),
        h('td', {}, k.state === 'active' ? h('button', { class: 'small ghost', onclick: async () => { await api('POST', `/api/traders/${me.account}/keys/${k.keyId}/revoke`, {}, me.token); dashboard(); } }, 'Revoke') : '')))))
      : h('div', { class: 'empty' }, 'No keys sold yet.'));
  }

  root.append(
    panel(h('h2', {}, `Signed in as ${me.account}`), metricsRow(t.metrics),
      h('p', {}, link(`#/trader/${me.account}`, 'View your public page'), ' | ', link('#/analytics', 'Analytics'), ' | ', link('#/settings', 'Settings'))),
    panel(h('h2', {}, '1. Strategy'),
      h('p', { class: 'mute' }, 'Name and tagline are public. The thesis is private. Trades below are entered by you and recorded, not routed through Confidential Intents.'),
      h('label', {}, 'Name'), name, h('label', {}, 'Tagline (public)'), tag, h('label', {}, 'Thesis (private)'), thesis,
      h('button', { onclick: async () => {
        try {
          let th = thesis.value;
          if (!th && t.strategy) { const own = await api('GET', `/api/traders/${me.account}/export`, null, me.token); th = own.strategy ? own.strategy.thesis : ''; }
          await api('PUT', `/api/traders/${me.account}/strategy`, { name: name.value, tagline: tag.value, thesis: th }, me.token);
          flash(sMsg, 'Strategy saved');
        } catch (e) { flash(sMsg, e.message, true); }
      } }, 'Save strategy'), sMsg),
    panel(h('h2', {}, '2. Record a closed trade'),
      h('p', { class: 'mute' }, 'Public metrics update immediately. The trade itself is encrypted and only readable with a viewing key. Manage past trades in Analytics.'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Pair'), pair), h('div', {}, h('label', {}, 'Side'), side), h('div', {}, h('label', {}, 'Size (% of portfolio)'), size),
        h('div', {}, h('label', {}, 'Entry price'), entry), h('div', {}, h('label', {}, 'Exit price'), exit)),
      h('label', {}, 'Note'), note,
      h('button', { onclick: async () => {
        try {
          await api('POST', `/api/traders/${me.account}/trades`, { pair: pair.value, side: side.value, entry: Number(entry.value), exit: Number(exit.value), sizePct: Number(size.value), note: note.value }, me.token);
          dashboard();
        } catch (e) { flash(tMsg, e.message, true); }
      } }, 'Record trade'), tMsg),
    panel(h('h2', {}, '3. Sell viewing keys'),
      testnet() ? h('p', { class: 'mute' }, 'Each price is set on the contract with set_offer from your wallet. Leave a field empty to skip that duration.') : null,
      h('div', { class: 'row' }, h('div', {}, h('label', {}, '7 day price (NEAR)'), p7), h('div', {}, h('label', {}, '30 day price (NEAR)'), p30)),
      h('button', { onclick: async () => { try { flash(oMsg, await saveOffers()); } catch (e) { flash(oMsg, e.message, true); } } }, testnet() ? 'Set offers on-chain' : 'Save offers'), oMsg),
    keysPanel);
  $app.replaceChildren(root);
}

// ---------- Analytics ----------
async function analytics() {
  const ctx = await needProfile('Analytics');
  if (!ctx) return;
  const { me, t } = ctx;
  const [a, trades] = await Promise.all([
    api('GET', `/api/traders/${me.account}/analytics`, null, me.token),
    api('GET', `/api/traders/${me.account}/trades`, null, me.token),
  ]);
  const root = h('div', {});
  root.append(panel(h('h2', {}, 'Performance'), metricsRow(t.metrics), h('h3', {}, 'Equity curve'), chart(t.metrics.curve)));
  root.append(panel(h('h2', {}, 'Trade quality'),
    h('div', { class: 'row' },
      stat('Best trade', pct(a.trade.bestPct), cls(a.trade.bestPct)), stat('Worst trade', pct(a.trade.worstPct), cls(a.trade.worstPct)),
      stat('Average win', pct(a.trade.avgWinPct), cls(a.trade.avgWinPct)), stat('Average loss', pct(a.trade.avgLossPct), cls(a.trade.avgLossPct)),
      stat('Profit factor', a.trade.profitFactor == null ? 'n/a' : a.trade.profitFactor)),
    h('p', { class: 'mute' }, 'Percentages are of strategy portfolio. Profit factor is total gains divided by total losses, and is n/a until you have a losing trade.')));
  if (a.onChain) {
    root.append(panel(h('h2', {}, 'Key sales'), h('p', { class: 'mute' }, 'Sales are on-chain. Payments go straight to your account when a buyer calls buy_key, so view them in your wallet or a NEAR explorer. The contract does not list buyers.')));
  } else {
    const s = a.sales;
    root.append(panel(h('h2', {}, 'Key sales'),
      h('div', { class: 'row' }, stat('Keys sold', s.keysSold), stat('Active now', s.active), stat('Unique holders', s.uniqueHolders), stat('Revenue (simulated)', `${s.revenueNear} NEAR`)),
      h('h3', {}, 'Recent sales'),
      s.recent.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Key', 'Buyer', 'Price', 'Sold', 'State'].map((x) => h('th', {}, x)))),
        h('tbody', {}, s.recent.map((k) => h('tr', {}, h('td', {}, k.keyId), h('td', {}, k.buyer), h('td', {}, `${k.priceNear} NEAR`), h('td', {}, fmtDate(k.issuedAt)), h('td', {}, pill(k.state))))))
        : h('div', { class: 'empty' }, 'No keys sold yet. Set a price on the Trader dashboard.')));
  }
  const msg = h('div', {});
  root.append(panel(h('h2', {}, 'Trade log'),
    h('p', { class: 'mute' }, 'Only you see this page. Deleting a trade changes your public metrics immediately.'), msg,
    trades.length ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Pair', 'Side', 'Size', 'Entry', 'Exit', 'PnL', 'Closed', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, trades.map((x) => h('tr', {}, h('td', {}, x.index + 1), h('td', {}, x.pair), h('td', {}, x.side), h('td', {}, `${x.sizePct}%`), h('td', {}, x.entry), h('td', {}, x.exit),
        h('td', { class: cls(x.pnlPct) }, pct(x.pnlPct)), h('td', {}, fmtDate(x.closedAt)),
        h('td', {}, h('button', { class: 'small danger', onclick: async () => {
          if (!confirm('Delete this trade? This cannot be undone.')) return;
          try { await api('DELETE', `/api/traders/${me.account}/trades/${x.index}`, null, me.token); analytics(); } catch (e) { flash(msg, e.message, true); }
        } }, 'Delete'))))))
      : h('div', { class: 'empty' }, 'No trades yet. Record one on the Trader dashboard.')));
  $app.replaceChildren(root);
}

// ---------- My keys ----------
async function keysPage() {
  const held = await heldKeys();
  if (held.needsConnect) { $app.replaceChildren(connectPanel(render)); return; }
  const rows = held.rows.slice().sort((a, b) => (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1));
  const active = rows.filter((r) => r.state === 'active').length;
  $app.replaceChildren(
    panel(h('h2', {}, 'My keys'),
      h('p', { class: 'mute' }, testnet() ? 'Viewing keys held by your connected account, read from the access contract.' : 'Viewing keys saved in this browser. Losing browser data loses the key, so the trader would have to sell you a new one.'),
      rows.length ? h('div', { class: 'row' }, stat('Keys', rows.length), stat('Active', active), stat('Ended', rows.length - active)) : null,
      rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Trader', 'State', 'Time left', 'Expires', testnet() ? '' : 'Paid', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, link(`#/trader/${r.trader}`, r.trader)), h('td', {}, pill(r.state)), h('td', {}, r.state === 'active' ? remaining(r.expiresAt) : 'ended'), h('td', {}, fmtDate(r.expiresAt)),
          h('td', {}, testnet() ? '' : `${r.priceNear} NEAR`),
          h('td', {}, link(`#/trader/${r.trader}`, r.state === 'active' ? 'Open' : 'Renew'), testnet() ? null : [' ', h('button', { class: 'small ghost', onclick: () => { const ks = store.get('kv.keys', {}); delete ks[r.trader]; store.set('kv.keys', ks); keysPage(); } }, 'Remove')])))))
        : h('div', { class: 'empty' }, 'You do not hold any viewing keys yet. Pick a trader on the Leaderboard to buy one.'),
      held.stale ? h('div', {}, h('p', { class: 'mute' }, `${held.stale} saved ${held.stale === 1 ? 'key is' : 'keys are'} unknown to this server (it may have been reset).`),
        h('button', { class: 'small ghost', onclick: async () => {
          const ks = store.get('kv.keys', {}); const known = new Set(held.rows.map((r) => r.trader));
          for (const k of Object.keys(ks)) if (!known.has(k)) delete ks[k];
          store.set('kv.keys', ks); keysPage();
        } }, 'Clean up')) : null));
}

// ---------- Copy tracker ----------
async function tracker() {
  const held = await heldKeys();
  if (held.needsConnect) { $app.replaceChildren(connectPanel(render)); return; }
  const active = held.rows.filter((r) => r.state === 'active');
  const groups = (await Promise.all(active.map(async (r) => {
    try { return { trader: r.trader, token: r.token, ...(await api('GET', `/api/traders/${r.trader}/copies`, null, r.token)) }; } catch { return null; }
  }))).filter(Boolean);
  const all = groups.flatMap((g) => g.copies.map((c) => ({ ...c, token: g.token })));
  const sum = (f) => Math.round(groups.reduce((a, g) => a + g.totals[f], 0) * 100) / 100;
  const msg = h('div', {});
  async function act(c, status) {
    try {
      if (status === 'remove') await api('DELETE', `/api/traders/${c.trader}/copies/${c.id}`, null, c.token);
      else await api('POST', `/api/traders/${c.trader}/copies/${c.id}/status`, { status }, c.token);
      tracker();
    } catch (e) { flash(msg, e.message, true); }
  }
  const btn = (c, label, status, extra = 'ghost') => h('button', { class: `small ${extra}`, onclick: () => act(c, status) }, label);
  $app.replaceChildren(panel(h('h2', {}, 'Copy tracker'),
    h('p', { class: 'mute' }, 'Copies you tracked from traders whose keys are active. Results use the trader\'s recorded entry and exit scaled to your budget, so real fills will differ. Copies from an ended key are hidden until you renew it.'),
    all.length ? h('div', { class: 'row' },
      stat('Tracked', sum('tracked')), stat('Marked executed', sum('executed')),
      stat('Executed result', usd(sum('executedPnlUsd')), cls(sum('executedPnlUsd'))),
      stat('If all executed', usd(sum('ifAllExecutedPnlUsd')), cls(sum('ifAllExecutedPnlUsd')))) : null,
    msg,
    all.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Trader', 'Trade', 'Budget', 'Result', 'Status', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, all.map((c) => h('tr', {},
        h('td', {}, link(`#/trader/${c.trader}`, c.trader)),
        h('td', {}, `${c.trade.side} ${c.trade.pair} ${c.trade.entry} to ${c.trade.exit} (${c.trade.sizePct}%)`),
        h('td', {}, `$${c.budgetUsd}`), h('td', { class: cls(c.pnlUsd) }, usd(c.pnlUsd)), h('td', {}, pill(c.status)),
        h('td', {}, c.status === 'drafted' ? [btn(c, 'Mark executed', 'executed', ''), btn(c, 'Skip', 'skipped')] : btn(c, 'Back to drafted', 'drafted'), btn(c, 'Remove', 'remove', 'danger'))))))
      : h('div', { class: 'empty' }, active.length ? 'Nothing tracked yet. Open a trader you hold a key for and press Track these copies.' : 'You need an active viewing key first. Pick a trader on the Leaderboard.')));
}

// ---------- Security ----------
async function security() {
  const att = await api('GET', '/api/attestation');
  const traders = await api('GET', '/api/traders');
  const pick = h('select', {}, traders.map((t) => h('option', { value: t.account }, t.account)));
  const out = h('pre', {}, 'Choose a trader and press Fetch.');
  const who = [
    ['Anyone, no key', 'Account, strategy name and tagline, total PnL, trade count, win rate, max drawdown, equity curve, key prices'],
    ['Viewing key holder', 'Thesis, pair, side, size, entry, exit, notes, copy orders, copy tracking'],
    ['Trader only', 'Trade log editing, sales, export, delete profile' + (testnet() ? '' : ', key list')],
  ];
  $app.replaceChildren(
    panel(h('h2', {}, 'Who sees what'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Viewer'), h('th', {}, 'Can see'))), h('tbody', {}, who.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b)))))),
    panel(h('h2', {}, 'How it is enforced'),
      h('table', {}, h('tbody', {},
        h('tr', {}, h('td', {}, 'Storage'), h('td', {}, 'Trades and tracked copies are encrypted with AES-256-GCM before they touch disk.')),
        h('tr', {}, h('td', {}, 'Viewing key'), h('td', {}, testnet() ? `On-chain grant on ${cfg.contract}. The server asks the contract on every private request, so a revoke is immediate.` : 'Random token whose hash is stored with trader, holder, expiry and revoked flag. Unlocks one trader only.')),
        h('tr', {}, h('td', {}, 'Wallet safety'), h('td', {}, 'A viewing key cannot sign or move funds. It is a read credential.')),
        h('tr', {}, h('td', {}, 'Sign-in'), h('td', {}, testnet() ? 'NEP-413 signed message with a single-use nonce, plus a check that the key belongs to the account.' : 'Dry-run: manage token held in the browser. No wallet needed.'))))),
    panel(h('h2', {}, 'Environment'),
      h('div', { class: 'row' }, stat('Mode', cfg.mode), stat('Network', cfg.network || 'none (simulated)'), stat('Contract', cfg.contract || 'none'), stat('TEE', att.available ? 'attested' : 'not attested')),
      att.available
        ? [h('p', { class: 'ok' }, 'This server produced a TEE quote bound to its key fingerprint and contract.'), h('pre', {}, JSON.stringify(att, null, 2))]
        : h('p', { class: 'mute' }, att.reason + ' Without a TEE, the server operator can read stored trades.')),
    panel(h('h2', {}, 'Inspect a public payload'),
      h('p', { class: 'mute' }, 'This is exactly what the server returns to anyone with no key. Check that no pair, side, price, thesis or note appears.'),
      traders.length ? [pick, h('button', { onclick: async () => { try { out.textContent = JSON.stringify(await api('GET', `/api/traders/${pick.value}`), null, 2); } catch (e) { out.textContent = e.message; } } }, 'Fetch public payload'), out]
        : h('div', { class: 'empty' }, 'No traders to inspect yet.')));
}

// ---------- Settings ----------
async function settings() {
  const prefs = getPrefs();
  const theme = h('select', {}, h('option', { value: 'dark' }, 'Dark'), h('option', { value: 'light' }, 'Light'));
  theme.value = prefs.theme;
  const budget = h('input', { type: 'number', min: '1', value: String(prefs.budget) });
  const lastN = h('input', { type: 'number', min: '1', max: '10', value: String(prefs.lastN) });
  const pMsg = h('div', {});
  const me = identity();
  let hasProfile = false;
  if (me) { try { await api('GET', `/api/traders/${me.account}`); hasProfile = true; } catch { hasProfile = false; } }
  const reveal = h('div', {});
  const aMsg = h('div', {}), dMsg = h('div', {});
  const confirmBox = h('input', { placeholder: me ? `Type ${me.account} to confirm` : '' });

  const account = [h('h2', {}, 'Account')];
  if (testnet()) {
    const s = session();
    account.push(s ? h('div', {}, h('p', {}, `Connected as ${s.account} via ${s.walletId}.`), h('p', { class: 'mute' }, `Session ends ${fmtDate(s.expiresAt)}.`),
      h('button', { class: 'ghost', onclick: () => { store.set('kv.session', null); render(); } }, 'Disconnect'))
      : connectPanel(render));
  } else if (me) {
    account.push(h('p', {}, `Profile on this browser: ${me.account}`), hasProfile ? null : h('p', { class: 'err' }, 'This server has no matching profile. Restore or create one on the Trader dashboard.'),
      h('button', { class: 'ghost', onclick: () => { reveal.replaceChildren(h('p', { class: 'mute' }, 'Keep this secret. Anyone with it can manage your profile.'), h('pre', {}, me.token)); } }, 'Show manage token'),
      h('button', { class: 'ghost', onclick: () => { store.set('kv.me', null); settings(); } }, 'Sign out of this browser'), reveal);
  } else account.push(h('p', { class: 'mute' }, 'No trader profile on this browser.'), link('#/dashboard', 'Create or restore a profile'));

  $app.replaceChildren(
    panel(h('h2', {}, 'Preferences'),
      h('p', { class: 'mute' }, 'Saved in this browser only.'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Theme'), theme), h('div', {}, h('label', {}, 'Default copy budget (USD)'), budget), h('div', {}, h('label', {}, 'Default last N trades to copy'), lastN)),
      h('button', { onclick: () => {
        store.set('kv.prefs', { theme: theme.value, budget: Math.max(1, Number(budget.value) || 100), lastN: Math.min(10, Math.max(1, Number(lastN.value) || 1)) });
        applyTheme(); flash(pMsg, 'Preferences saved');
      } }, 'Save preferences'), pMsg),
    panel(...account, aMsg),
    panel(h('h2', {}, 'Your data'),
      h('h3', {}, 'Export'),
      h('p', { class: 'mute' }, 'Download your strategy, thesis and trades as JSON.'),
      h('button', { class: 'ghost', disabled: hasProfile ? null : 'disabled', onclick: async () => {
        try {
          const data = await api('GET', `/api/traders/${me.account}/export`, null, me.token);
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `keyview-${me.account}.json` });
          document.body.append(a); a.click(); a.remove(); flash(dMsg, 'Export downloaded');
        } catch (e) { flash(dMsg, e.message, true); }
      } }, 'Export my data'),
      h('h3', {}, 'This browser'),
      h('p', { class: 'mute' }, 'Removes saved viewing keys, profile token, session and preferences from this browser. Nothing on the server changes.'),
      h('button', { class: 'ghost', onclick: () => { if (confirm('Clear all KeyView data from this browser?')) { for (const k of ['kv.keys', 'kv.me', 'kv.session', 'kv.prefs']) localStorage.removeItem(k); applyTheme(); render(); } } }, 'Clear browser data'),
      hasProfile ? [h('h3', {}, 'Danger zone'),
        h('p', { class: 'mute' }, testnet() ? 'Deletes your profile, trades and tracked copies from this server. Offers and grants on the contract stay until you change them from your wallet.' : 'Deletes your profile, trades, issued keys and tracked copies from this server. Holders lose access.'),
        confirmBox,
        h('button', { class: 'danger', onclick: async () => {
          if (confirmBox.value.trim() !== me.account) { flash(dMsg, `Type ${me.account} exactly to confirm`, true); return; }
          try { const r = await api('DELETE', `/api/traders/${me.account}`, null, me.token); if (!testnet()) store.set('kv.me', null); flash(dMsg, r.note); settings(); } catch (e) { flash(dMsg, e.message, true); }
        } }, 'Delete my profile')] : null,
      dMsg),
    panel(h('h2', {}, 'About'), h('p', { class: 'mute' }, `KeyView, ${cfg.mode} mode${cfg.contract ? ', contract ' + cfg.contract : ''}. ${cfg.note}`)));
}

// ---------- router ----------
const skeleton = () => [h('div', { class: 'skel tall' }), h('div', { class: 'skel' })];
let lastRoute = null;
function playEnter() {
  [...$app.querySelectorAll('.panel')].forEach((el, i) => { el.style.animationDelay = `${Math.min(i, 6) * 60}ms`; });
  $app.classList.remove('enter');
  void $app.offsetWidth;
  $app.classList.add('enter');
}

async function render() {
  try {
    cfg = await api('GET', '/api/config');
    document.getElementById('mode').textContent = testnet() ? `${cfg.network} mode` : 'dry-run mode';
    renderAuth();
    api('GET', '/api/attestation').then((a) => { document.getElementById('tee').textContent = a.available ? 'TEE attested' : 'no TEE attestation'; }).catch(() => {});
    const [, view, arg] = location.hash.split('/');
    const pages = { dashboard, analytics, keys: keysPage, tracker, security, settings };
    const route = view === 'trader' ? 'home' : (pages[view] ? view : 'home');
    for (const a of document.querySelectorAll('#nav a[data-r]')) a.classList.toggle('active', a.dataset.r === route);
    const key = `${view || ''}/${arg || ''}`;
    if (key !== lastRoute) { $app.replaceChildren(...skeleton()); lastRoute = key; }
    if (view === 'trader' && arg) await traderPage(decodeURIComponent(arg));
    else if (pages[view]) await pages[view]();
    else await leaderboard();
    playEnter();
  } catch (e) {
    $app.replaceChildren(panel(h('p', { class: 'err' }, e.message)));
  }
}
window.addEventListener('hashchange', render);
render();
