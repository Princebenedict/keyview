import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { createApp } from '../src/server.js';
import os from 'node:os'; import path from 'node:path';

const srv = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ui-')) });
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
const html = fs.readFileSync(new URL('../public/app.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/, '');
const code = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function newBrowser(storage = {}) {
  const dom = new JSDOM(html, { url: base + '/app', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (u, o) => fetch(new URL(u, base), o);
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.eval(code);
  return w;
}
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const text = (w) => w.document.getElementById('app').textContent;
const byText = (w, tag, t) => [...w.document.querySelectorAll(tag)].find((e) => e.textContent.trim() === t);
const setv = (w, el, v) => { el.value = v; };
const click = async (w, tag, t) => { const e = byText(w, tag, t); if (!e) throw new Error(`no ${tag} "${t}"`); e.click(); await wait(250); };
let fails = 0;
const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

// Trader browser
const tr = newBrowser(); await wait();
check('leaderboard shows empty state', /No traders yet/.test(text(tr)));
check('header shows dry-run badge', /dry-run/.test(tr.document.getElementById('mode').textContent));
tr.location.hash = '#/dashboard'; await wait();
check('dashboard asks to create a profile', /Create trader profile/.test(text(tr)));
setv(tr, tr.document.querySelector('input'), 'alice.testnet'); await click(tr, 'button', 'Create profile');
check('profile created, dashboard shown', /Signed in as alice\.testnet/.test(text(tr)));
const inputs = () => [...tr.document.querySelectorAll('input,textarea,select')];
// strategy fields: first input = name, second = tagline, textarea = thesis
let ins = inputs();
setv(tr, ins[0], 'Mean revert'); setv(tr, ins[1], 'NEAR range trader');
setv(tr, tr.document.querySelector('textarea'), 'UI-SECRET-THESIS');
await click(tr, 'button', 'Save strategy');
check('strategy saved', /Strategy saved/.test(text(tr)));
ins = inputs();
const num = ins.filter((e) => e.type === 'number');
// number inputs order: size, entry, exit (entry/exit come before size? find by position in DOM)
const entryEl = num.find((e) => e.step === 'any' && !e.placeholder), exitEl = num.filter((e) => e.step === 'any' && !e.placeholder)[1];
setv(tr, entryEl, '4'); setv(tr, exitEl, '4.4'); setv(tr, num.find((e) => e.max === '100'), '50');
await click(tr, 'button', 'Record trade');
check('public PnL updated after trade (+5.00%)', /\+5\.00%/.test(text(tr)));
ins = inputs();
const price = ins.filter((e) => e.placeholder === 'NEAR');
setv(tr, price[0], '2'); await click(tr, 'button', 'Save offers');
check('offers saved', /Offers saved/.test(text(tr)));

// Follower browser (separate storage)
const fb = newBrowser(); await wait();
check('leaderboard lists alice with PnL', /alice\.testnet/.test(text(fb)) && /\+5\.00%/.test(text(fb)));
fb.location.hash = '#/trader/alice.testnet'; await wait();
check('private panel locked, no secrets shown', /locked/i.test(text(fb)) && !/UI-SECRET-THESIS/.test(fb.document.body.textContent) && !/NEAR\/USDC/.test(text(fb)));
setv(fb, fb.document.querySelector('input'), 'bob.testnet');
await click(fb, 'button', 'Buy viewing key (simulated payment)');
await wait(300);
fb.location.reload?.call;
// reload is not implemented in jsdom, so re-open with the stored key
const stored = fb.localStorage.getItem('kv.keys');
check('viewing key stored in browser', !!stored);
const fb2 = newBrowser({ 'kv.keys': stored }); fb2.location.hash = '#/trader/alice.testnet'; await wait(400);
check('private view unlocked with thesis and trade', /UI-SECRET-THESIS/.test(text(fb2)) && /NEAR\/USDC/.test(text(fb2)));
setv(fb2, [...fb2.document.querySelectorAll('input')].find((e) => e.placeholder === 'you.testnet'), 'bob.testnet');
await click(fb2, 'button', 'Build Intents orders');
check('copy flow renders Intents orders', /EXACT_INPUT/.test(text(fb2)));


// ---- New tabs ----
const fire = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const go = async (w, hash) => { w.location.hash = hash; await wait(400); };

// Leaderboard search and sort
await go(fb, '#/');
const search = fb.document.querySelector('input[placeholder^="Search"]');
search.value = 'zzz'; fire(fb, search, 'input'); await wait(100);
check('leaderboard search filters and shows no-match message', /No traders match/.test(text(fb)));
search.value = 'alice'; fire(fb, search, 'input'); await wait(100);
check('leaderboard search finds alice', /alice\.testnet/.test(text(fb)));

// Track copies from the trader page, then use My keys and Copy tracker
await click(fb2, 'button', 'Track these copies');
check('tracking reports one new copy', /Tracked 1 new copy/.test(text(fb2)));
await click(fb2, 'button', 'Track these copies');
check('tracking again dedupes', /Tracked 0 new copies, 1 already tracked/.test(text(fb2)));
await go(fb2, '#/keys');
check('My keys lists the key as active', /alice\.testnet/.test(text(fb2)) && /active/.test(text(fb2)) && /left/.test(text(fb2)));
await go(fb2, '#/tracker');
check('Copy tracker shows the copied trade and result', /long NEAR\/USDC 4 to 4\.4/.test(text(fb2)) && /\+\$5\.00/.test(text(fb2)));
check('nothing counted as executed yet', /Markedexecuted0/.test(text(fb2).replace(/\s+/g, '')));
await click(fb2, 'button', 'Mark executed');
check('marking executed updates the tracker', /executed/.test(text(fb2)) && /Back to drafted/.test(text(fb2)));
await click(fb2, 'button', 'Back to drafted');
check('status can be reset', /Mark executed/.test(text(fb2)));

// Stale key cleanup
const stale = newBrowser({ 'kv.keys': JSON.stringify({ 'alice.testnet': 'kv_bad', 'ghost.testnet': 'kv_worse' }) });
await go(stale, '#/keys');
check('stale keys are flagged', /unknown to this server/.test(text(stale)));
await click(stale, 'button', 'Clean up');
check('clean up clears stale keys', JSON.parse(stale.localStorage.getItem('kv.keys') || '{}')['alice.testnet'] === undefined);

// Trader analytics
await go(tr, '#/analytics');
check('Analytics shows sales and revenue', /Key sales/.test(text(tr)) && /Revenue \(simulated\)/.test(text(tr)) && /2 NEAR/.test(text(tr)));
check('Analytics shows trade log with the trade', /Trade log/.test(text(tr)) && /NEAR\/USDC/.test(text(tr)));
check('Analytics shows profit factor stat', /Profit factor/.test(text(tr)));

// Security tab
await go(fb, '#/security');
check('Security explains the boundary', /Who sees what/.test(text(fb)) && /AES-256-GCM/.test(text(fb)));
check('Security says no TEE honestly', /Not running inside a TEE/.test(text(fb)));
await click(fb, 'button', 'Fetch public payload');
const payload = fb.document.querySelector('pre').textContent;
check('public payload inspector shows account but no private fields', /"account": "alice\.testnet"/.test(payload) && !/UI-SECRET-THESIS|NEAR\/USDC|"entry"/.test(payload));

// Settings
await go(tr, '#/settings');
check('Settings shows preferences, account and data', /Preferences/.test(text(tr)) && /Account/.test(text(tr)) && /Your data/.test(text(tr)));
const themeSel = tr.document.querySelector('select');
themeSel.value = 'light'; await click(tr, 'button', 'Save preferences');
check('theme preference applies', tr.document.documentElement.dataset.theme === 'light');
await click(tr, 'button', 'Show manage token');
check('manage token can be revealed', /kv_/.test(text(tr)));
const meTok = JSON.parse(tr.localStorage.getItem('kv.me')).token;

// Restore profile in a clean browser
const rb = newBrowser(); await go(rb, '#/dashboard');
check('clean browser sees create and restore', /Create trader profile/.test(text(rb)) && /Restore an existing profile/.test(text(rb)));
const rin = [...rb.document.querySelectorAll('input')];
rin.find((e) => e.placeholder === 'kv_...').value = 'kv_wrong';
rin.filter((e) => e.placeholder === 'yourname.testnet')[1].value = 'alice.testnet';
await click(rb, 'button', 'Restore');
check('restore rejects a wrong token', /Missing or wrong manage token/.test(text(rb)));
rb.document.querySelector('input[placeholder="kv_..."]').value = meTok;
await click(rb, 'button', 'Restore');
check('restore accepts the right token', /Signed in as alice\.testnet/.test(text(rb)));

// A stale profile no longer crashes the dashboard
const lost = newBrowser({ 'kv.me': JSON.stringify({ account: 'ghost.testnet', token: 'kv_x' }) });
await go(lost, '#/dashboard');
check('stale profile shows create form, not an error page', /Create trader profile/.test(text(lost)) && /may have been reset/.test(text(lost)));
await go(lost, '#/analytics');
check('analytics with a stale profile explains instead of crashing', /no profile for ghost\.testnet/.test(text(lost)));

// Revoke from trader, then follower is rejected
await go(tr, '#/dashboard');
check('trader sees issued key', /bob\.testnet/.test(text(tr)));
await click(tr, 'button', 'Revoke');
const fb3 = newBrowser({ 'kv.keys': stored }); fb3.location.hash = '#/trader/alice.testnet'; await wait(400);
check('revoked key rejected in UI', /revoked/i.test(text(fb3)));
srv.close();
console.log(fails ? `\n${fails} failed` : '\nUI flow passed');
process.exit(fails ? 1 : 0);
