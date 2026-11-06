const $app = document.getElementById('app');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

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
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const stat = (label, value, c = '') => h('div', { class: 'stat' }, h('span', {}, label), h('b', { class: c }, value));
const fmtDate = (ms) => new Date(ms).toLocaleString();

function chart(curve) {
  if (!curve.length) return h('div', { class: 'empty' }, 'No closed trades yet, so there is no curve to draw.');
  const w = 600, ht = 140, pad = 8;
  const ys = [0, ...curve.map((c) => c.cumPnlPct)];
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const pts = ys.map((y, i) => `${pad + (i / Math.max(ys.length - 1, 1)) * (w - 2 * pad)},${ht - pad - ((y - min) / span) * (ht - 2 * pad)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  svg.setAttribute('style', 'width:100%;height:140px');
  svg.innerHTML = `<polyline fill="none" stroke="#00ec97" stroke-width="2" points="${pts}"/>`;
  return svg;
}

function metricsRow(m) {
  return h('div', { class: 'row' },
    stat('Total PnL', pct(m.totalPnlPct), cls(m.totalPnlPct)),
    stat('Trades', m.trades),
    stat('Win rate', m.winRatePct == null ? 'n/a' : `${m.winRatePct}%`),
    stat('Max drawdown', m.maxDrawdownPct == null ? 'n/a' : `-${m.maxDrawdownPct}%`));
}

// ---------- Leaderboard ----------
async function leaderboard() {
  const list = await api('GET', '/api/traders');
  $app.replaceChildren(h('div', { class: 'panel' },
    h('h2', {}, 'Leaderboard'),
    h('p', { class: 'mute' }, 'Public PnL and risk only. Pair, side, size, entries, exits and thesis stay behind a viewing key.'),
    list.length
      ? h('table', {},
          h('thead', {}, h('tr', {}, ['Trader', 'Strategy', 'PnL', 'Trades', 'Win rate', 'Max DD', 'Live keys'].map((x) => h('th', {}, x)))),
          h('tbody', {}, list.map((t) => h('tr', { class: 'click', onclick: () => { location.hash = `#/trader/${t.account}`; } },
            h('td', {}, t.account), h('td', {}, t.strategy ? t.strategy.name : 'No strategy yet'),
            h('td', { class: cls(t.metrics.totalPnlPct) }, pct(t.metrics.totalPnlPct)),
            h('td', {}, t.metrics.trades), h('td', {}, t.metrics.winRatePct == null ? 'n/a' : `${t.metrics.winRatePct}%`),
            h('td', {}, t.metrics.maxDrawdownPct == null ? 'n/a' : `-${t.metrics.maxDrawdownPct}%`),
            h('td', {}, t.activeKeys)))))
      : h('div', { class: 'empty' }, 'No traders yet. Open the Trader dashboard to create the first profile.')));
}

// ---------- Trader page ----------
async function traderPage(account) {
  const [t, cfg] = await Promise.all([api('GET', `/api/traders/${account}`), api('GET', '/api/config')]);
  const keys = store.get('kv.keys', {});
  const token = keys[account];
  const root = h('div', {});
  root.append(h('div', { class: 'panel' },
    h('h2', {}, `${t.account}${t.strategy ? ' / ' + t.strategy.name : ''}`),
    t.strategy && t.strategy.tagline ? h('p', { class: 'mute' }, t.strategy.tagline) : null,
    metricsRow(t.metrics), h('h3', {}, 'Public equity curve'), chart(t.metrics.curve)));

  const priv = h('div', { class: 'panel' }, h('h2', {}, 'Private strategy'));
  root.append(priv);

  async function showPrivate() {
    try {
      const p = await api('GET', `/api/traders/${account}/private`, null, token);
      priv.replaceChildren(h('h2', {}, 'Private strategy'),
        h('p', { class: 'ok' }, `Viewing key active until ${fmtDate(p.expiresAt)}`),
        h('h3', {}, 'Thesis'), h('p', {}, p.thesis || 'The trader has not written a thesis.'),
        h('h3', {}, 'Trades'),
        p.trades.length ? h('table', {},
          h('thead', {}, h('tr', {}, ['Pair', 'Side', 'Size', 'Entry', 'Exit', 'Note', 'Closed'].map((x) => h('th', {}, x)))),
          h('tbody', {}, p.trades.map((x) => h('tr', {}, h('td', {}, x.pair), h('td', {}, x.side), h('td', {}, `${x.sizePct}%`),
            h('td', {}, x.entry), h('td', {}, x.exit), h('td', {}, x.note || ''), h('td', {}, fmtDate(x.closedAt))))))
          : h('div', { class: 'empty' }, 'No trades recorded yet.'),
        copyBox());
    } catch (e) {
      priv.replaceChildren(h('h2', {}, 'Private strategy'), h('p', { class: 'err' }, `Your stored key was rejected: ${e.message}`), buyBox());
    }
  }

  function copyBox() {
    const out = h('div', {});
    const follower = h('input', { placeholder: 'you.testnet' });
    const budget = h('input', { type: 'number', min: '1', value: '100' });
    const n = h('input', { type: 'number', min: '1', max: '10', value: '1' });
    return h('div', {}, h('h3', {}, 'Copy this strategy'),
      h('p', { class: 'mute' }, 'Builds NEAR Intents quote requests that mirror the trader\'s most recent trades, scaled to your budget. Nothing is submitted for you.'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Your NEAR account'), follower), h('div', {}, h('label', {}, 'Budget (USD)'), budget), h('div', {}, h('label', {}, 'Last N trades'), n)),
      h('button', { onclick: async () => {
        try {
          const r = await api('POST', `/api/traders/${account}/copy`, { follower: follower.value, budgetUsd: Number(budget.value), lastN: Number(n.value) }, token);
          out.replaceChildren(h('p', { class: 'mute' }, r.note), ...r.orders.map((o) => h('div', {},
            h('b', {}, `${o.source.side} ${o.source.pair}`), o.legs.map((l) => h('pre', {}, JSON.stringify(l, null, 2))))));
        } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
      } }, 'Build Intents orders'), out);
  }

  function buyBox() {
    if (!t.offers.length) return h('div', { class: 'locked' }, 'This trader has not put any viewing keys on sale yet.');
    const buyer = h('input', { placeholder: 'you.testnet' });
    const dur = h('select', {}, t.offers.map((o) => h('option', { value: o.durationDays }, `${o.durationDays} days for ${o.priceNear} NEAR`)));
    const msg = h('div', {});
    return h('div', { class: 'locked' },
      h('p', {}, 'Trade details are locked. A viewing key grants read access to this one strategy for a fixed time. It does not control any wallet.'),
      h('label', {}, 'Your NEAR account'), buyer, h('label', {}, 'Duration'), dur,
      h('button', { onclick: async () => {
        try {
          const r = await api('POST', `/api/traders/${account}/keys/buy`, { buyer: buyer.value, durationDays: Number(dur.value) });
          const ks = store.get('kv.keys', {}); ks[account] = r.token; store.set('kv.keys', ks);
          location.reload();
        } catch (e) { msg.replaceChildren(h('p', { class: 'err' }, e.message)); }
      } }, cfg.mode === 'dry-run' ? 'Buy viewing key (simulated payment)' : 'Buy viewing key'), msg);
  }

  if (token) await showPrivate(); else priv.append(buyBox());
  $app.replaceChildren(root);
}

// ---------- Trader dashboard ----------
async function dashboard() {
  const me = store.get('kv.me', null);
  const root = h('div', {});
  if (!me) {
    const acct = h('input', { placeholder: 'yourname.testnet' });
    const msg = h('div', {});
    root.append(h('div', { class: 'panel' }, h('h2', {}, 'Create trader profile'),
      h('p', { class: 'mute' }, 'In dry-run mode, a profile is controlled by a manage token that is stored in this browser. Wallet sign-in belongs to testnet mode.'),
      h('label', {}, 'NEAR account'), acct,
      h('button', { onclick: async () => {
        try {
          const r = await api('POST', '/api/traders', { account: acct.value });
          store.set('kv.me', { account: r.account, token: r.manageToken });
          dashboard();
        } catch (e) { msg.replaceChildren(h('p', { class: 'err' }, e.message)); }
      } }, 'Create profile'), msg));
    $app.replaceChildren(root);
    return;
  }
  const t = await api('GET', `/api/traders/${me.account}`);
  const keys = await api('GET', `/api/traders/${me.account}/keys`, null, me.token);
  const flash = (el, text, bad) => el.replaceChildren(h('p', { class: bad ? 'err' : 'ok' }, text));

  // Strategy
  const name = h('input', { value: t.strategy ? t.strategy.name : '' });
  const tag = h('input', { value: t.strategy ? t.strategy.tagline : '', placeholder: 'Public one-liner' });
  const thesis = h('textarea', { rows: '4', placeholder: 'Private. Only key holders see this.' });
  const sMsg = h('div', {});
  // Trade
  const pair = h('select', {}, h('option', {}, 'NEAR/USDC'));
  const side = h('select', {}, h('option', {}, 'long'), h('option', {}, 'short'));
  const entry = h('input', { type: 'number', step: 'any' }), exit = h('input', { type: 'number', step: 'any' });
  const size = h('input', { type: 'number', min: '1', max: '100', value: '25' });
  const note = h('input', { placeholder: 'Private note' });
  const tMsg = h('div', {});
  // Offers
  const find = (d) => (t.offers.find((o) => o.durationDays === d) || {}).priceNear || '';
  const p7 = h('input', { type: 'number', step: 'any', value: find(7), placeholder: 'NEAR' });
  const p30 = h('input', { type: 'number', step: 'any', value: find(30), placeholder: 'NEAR' });
  const oMsg = h('div', {});

  root.append(
    h('div', { class: 'panel' }, h('h2', {}, `Signed in as ${me.account}`), metricsRow(t.metrics),
      h('button', { class: 'ghost', onclick: () => { store.set('kv.me', null); dashboard(); } }, 'Sign out of this browser')),
    h('div', { class: 'panel' }, h('h2', {}, '1. Strategy'),
      h('p', { class: 'mute' }, 'Name and tagline are public. The thesis is private. Execution is dry-run: trades below are entered by you and are not routed through Confidential Intents.'),
      h('label', {}, 'Name'), name, h('label', {}, 'Tagline (public)'), tag, h('label', {}, 'Thesis (private)'), thesis,
      h('button', { onclick: async () => {
        try { await api('PUT', `/api/traders/${me.account}/strategy`, { name: name.value, tagline: tag.value, thesis: thesis.value }, me.token); flash(sMsg, 'Strategy saved'); }
        catch (e) { flash(sMsg, e.message, true); }
      } }, 'Save strategy'), sMsg),
    h('div', { class: 'panel' }, h('h2', {}, '2. Record a closed trade'),
      h('p', { class: 'mute' }, 'Public metrics update immediately. The trade itself is encrypted and only readable with a viewing key.'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Pair'), pair), h('div', {}, h('label', {}, 'Side'), side), h('div', {}, h('label', {}, 'Size (% of portfolio)'), size),
        h('div', {}, h('label', {}, 'Entry price'), entry), h('div', {}, h('label', {}, 'Exit price'), exit)),
      h('label', {}, 'Note'), note,
      h('button', { onclick: async () => {
        try {
          await api('POST', `/api/traders/${me.account}/trades`, { pair: pair.value, side: side.value, entry: Number(entry.value), exit: Number(exit.value), sizePct: Number(size.value), note: note.value }, me.token);
          dashboard();
        } catch (e) { flash(tMsg, e.message, true); }
      } }, 'Record trade'), tMsg),
    h('div', { class: 'panel' }, h('h2', {}, '3. Sell viewing keys'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, '7 day price (NEAR)'), p7), h('div', {}, h('label', {}, '30 day price (NEAR)'), p30)),
      h('button', { onclick: async () => {
        const offers = [];
        if (p7.value) offers.push({ durationDays: 7, priceNear: Number(p7.value) });
        if (p30.value) offers.push({ durationDays: 30, priceNear: Number(p30.value) });
        try { await api('PUT', `/api/traders/${me.account}/offers`, { offers }, me.token); flash(oMsg, 'Offers saved'); }
        catch (e) { flash(oMsg, e.message, true); }
      } }, 'Save offers'), oMsg),
    h('div', { class: 'panel' }, h('h2', {}, 'Issued keys'),
      keys.length ? h('table', {},
        h('thead', {}, h('tr', {}, ['Key', 'Holder', 'Price', 'Expires', 'State', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, keys.map((k) => h('tr', {}, h('td', {}, k.keyId), h('td', {}, k.buyer), h('td', {}, `${k.priceNear} NEAR`), h('td', {}, fmtDate(k.expiresAt)), h('td', {}, k.state),
          h('td', {}, k.state === 'active' ? h('button', { class: 'small ghost', onclick: async () => { await api('POST', `/api/traders/${me.account}/keys/${k.keyId}/revoke`, {}, me.token); dashboard(); } }, 'Revoke') : '')))))
        : h('div', { class: 'empty' }, 'No keys sold yet.')),
    h('p', {}, h('a', { href: `#/trader/${me.account}`, style: 'color:var(--accent)' }, 'View your public page')));
  $app.replaceChildren(root);
}

async function render() {
  try {
    const cfg = await api('GET', '/api/config');
    document.getElementById('mode').textContent = cfg.mode === 'dry-run' ? 'dry-run mode (simulated payments)' : cfg.mode;
    const [, view, arg] = location.hash.split('/');
    if (view === 'trader' && arg) await traderPage(decodeURIComponent(arg));
    else if (view === 'dashboard') await dashboard();
    else await leaderboard();
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'err' }, e.message)));
  }
}
window.addEventListener('hashchange', render);
render();
