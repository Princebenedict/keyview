// Real-browser check of the landing page and the app. Run: npm install, then npm test.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createApp } from '../src/server.js';

const srv = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'beh-')) });
await new Promise((r) => srv.listen(3400, r));
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox', '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'], executablePath: await chromium.executablePath(), headless: 'shell' });
let fails = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const instant = (p) => p.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });

for (const [label, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED/.test(m.text())) errors.push(m.text()); });
  await p.setViewport({ width: w, height: h });
  await p.goto('http://localhost:3400/', { waitUntil: 'networkidle2' });
  await instant(p);
  await sleep(1200);
  check(`${label}: landing has no console or page errors`, errors.length === 0);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(`${label}: no horizontal overflow (${overflow}px)`, overflow <= 1);
  check(`${label}: hero headline present`, await p.evaluate(() => document.querySelector('.hero h1').textContent === 'Trade in private.'));
  check(`${label}: headline font is Dela Gothic One, all caps`, await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.hero h1')); return /Dela Gothic One/.test(s.fontFamily) && s.textTransform === 'uppercase'; }));
  check(`${label}: nav has the specified links`, await p.evaluate(() => [...document.querySelectorAll('.nav .links a')].map((a) => a.textContent).join('|') === 'Home|How it works|Security|Status|FAQ'));
  check(`${label}: mascot images load`, await p.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img[src*="keykeeper"]')];
    imgs.forEach((i) => { i.loading = 'eager'; });
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    return imgs.length >= 3 && imgs.every((i) => i.naturalWidth > 0);
  }));

  // The design rules from the brief, checked on every element
  const rules = await p.evaluate(() => {
    const out = { blurred: [], radius: [], borders: [], noise: null };
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.boxShadow && s.boxShadow !== 'none') {
        for (const part of s.boxShadow.split(/,(?![^(]*\))/)) {
          const m = part.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
          if (m && parseFloat(m[3]) > 0) out.blurred.push(el.className || el.tagName);
        }
      }
      const r = el.getBoundingClientRect();
      const raw = s.borderTopLeftRadius, rad = parseFloat(raw) || 0;
      if (!raw.includes('%') && r.height >= 64 && r.width >= 64 && rad > 32 && rad < 400) out.radius.push(`${el.className || el.tagName}:${rad}`);
    }
    for (const el of document.querySelectorAll('button, .btn, summary, .nav .links a')) {
      if (el.offsetParent === null) continue;
      const target = el.tagName === 'SUMMARY' ? el.parentElement : el; // a summary is bordered by its details card
      const s = getComputedStyle(target);
      if (s.borderTopWidth !== '2px') out.borders.push(el.className || el.tagName);
    }
    out.noise = getComputedStyle(document.querySelector('.noise')).opacity;
    return out;
  });
  check(`${label}: no blurred box-shadows (${rules.blurred.length})`, rules.blurred.length === 0);
  check(`${label}: no large box has a radius above 32px (${rules.radius.join(', ') || 'none'})`, rules.radius.length === 0);
  check(`${label}: every button, link and summary has a 2px border (${rules.borders.length} missing)`, rules.borders.length === 0);
  check(`${label}: noise overlay at 3%`, rules.noise === '0.03');

  if (label === 'desktop') {
    // glitch on hover
    const hb = await (await p.$('.hero h1')).boundingBox();
    await p.mouse.move(hb.x + 40, hb.y + 40, { steps: 6 }); await sleep(300);
    check('desktop: headline glitches on hover', await p.evaluate(() => getComputedStyle(document.querySelector('.hero h1')).animationName === 'glitch'));
    // custom cursor grows over a button
    const nb = await (await p.$('.nav-btn')).boundingBox();
    await p.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 8 }); await sleep(900);
    const scale = await p.evaluate(() => { const m = document.getElementById('cursor').style.transform.match(/scale\(([\d.]+)\)/); return m ? parseFloat(m[1]) : 0; });
    check(`desktop: cursor scales up over a button (${scale.toFixed(2)})`, scale > 2.3);
    check('desktop: cursor is 32px, white, blend difference', await p.evaluate(() => { const s = getComputedStyle(document.getElementById('cursor')); return s.width === '32px' && s.height === '32px' && s.mixBlendMode === 'difference'; }));
    await p.mouse.move(5, 5);
    // hard-shadow button: hover flattens the shadow
    check('desktop: nav button loses its shadow on hover', await (async () => { await p.hover('.nav-btn'); await sleep(250); return p.evaluate(() => getComputedStyle(document.querySelector('.nav-btn')).boxShadow.includes('0px 0px 0px 0px') || /^rgb\([^)]*\) 0px 0px 0px 0px$/.test(getComputedStyle(document.querySelector('.nav-btn')).boxShadow)); })());
    await p.mouse.move(5, 5);
  }

  // hover opens the keyhole
  await p.evaluate(() => document.querySelector('#stage').scrollIntoView({ block: 'center' }));
  await sleep(1200);
  const pbox = await (await p.$('#private')).boundingBox();
  if (label === 'desktop') {
    await p.mouse.move(pbox.x + 200, pbox.y + 200, { steps: 8 }); await sleep(900);
    check('desktop: hovering the card opens the keyhole', await p.evaluate(() => getComputedStyle(document.querySelector('.keyhole .l')).transform !== 'none'));
    await p.mouse.move(5, 5); await sleep(300);
  }
  await p.click('#turn'); await sleep(300);
  check(`${label}: turning the key opens the stage`, await p.evaluate(() => document.querySelector('#stage').dataset.open === 'true' && document.querySelector('#turn').getAttribute('aria-pressed') === 'true'));
  await p.click('#turn'); await sleep(200);
  check(`${label}: turning again locks it`, await p.evaluate(() => document.querySelector('#stage').dataset.open === 'false'));

  // horizontal rail
  check(`${label}: step cards are 320px wide`, await p.evaluate(() => [...document.querySelectorAll('.step')].every((s) => Math.round(s.getBoundingClientRect().width) === (innerWidth <= 560 ? 280 : 320))));
  check(`${label}: rail scrolls sideways with a hidden scrollbar`, await p.evaluate(() => { const r = document.querySelector('#rail'); return r.scrollWidth > r.clientWidth && getComputedStyle(r).scrollbarWidth === 'none'; }));
  await p.evaluate(() => document.querySelector('#rail').scrollIntoView({ block: 'center' })); await sleep(500);
  const before = await p.evaluate(() => document.querySelector('#rail').scrollLeft);
  await p.click('#next'); await sleep(900);
  check(`${label}: next arrow scrolls the rail`, (await p.evaluate(() => document.querySelector('#rail').scrollLeft)) > before);
  const seen = new Set();
  for (const n of [1, 2, 3, 4]) {
    await p.evaluate((n) => document.querySelector(`.step[data-step="${n}"]`).scrollIntoView({ block: 'center', inline: 'center' }), n);
    await sleep(1100); // let scroll-snap settle, as it does before a real person hovers
    const box = await (await p.$(`.step[data-step="${n}"]`)).boundingBox();
    if (box.x >= 0 && box.x + box.width <= w) { await p.mouse.move(box.x + box.width / 2, box.y + 100, { steps: 4 }); await sleep(250); }
    seen.add(await p.evaluate(() => document.querySelector('#dia').dataset.step));
  }
  await p.mouse.move(5, 5);
  check(`${label}: hovering or scrolling the rail drives diagram states 1 to 4 (${[...seen].join(',')})`, seen.size === 4);
  await p.evaluate(() => document.querySelector('.step[data-step="2"]').scrollIntoView({ block: 'center', inline: 'center' })); await sleep(1100);
  await p.click('.step[data-step="2"]'); await sleep(300);
  check(`${label}: clicking a step lights its path`, await p.evaluate(() => document.querySelector('#dia').dataset.step === '2' && document.querySelector('.step.active').dataset.step === '2'));

  // bento
  check(`${label}: bento has a 2x2 dark card with a 40% overlay image`, await p.evaluate(() => { const b = getComputedStyle(document.querySelector('.b1')); const i = getComputedStyle(document.querySelector('.b1 .bgimg')); return b.backgroundColor === 'rgb(9, 9, 11)' && i.opacity === '0.4' && i.mixBlendMode === 'overlay'; }));
  check(`${label}: not-built card is greyed (sold out state)`, await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.col.sold > h3')); return c.opacity === '0.6' && c.filter.includes('grayscale'); }));

  // ring
  await p.evaluate(() => document.querySelector('.ringbox').scrollIntoView({ block: 'center' })); await sleep(1800);
  const r1 = await p.evaluate(() => document.querySelector('#ringBig').textContent);
  await sleep(2600);
  const r2 = await p.evaluate(() => document.querySelector('#ringBig').textContent);
  check(`${label}: key ring counts down (${r1} to ${r2})`, r1 !== r2);

  await p.evaluate(() => document.querySelector('#faq').scrollIntoView());
  await p.click('.faq summary'); await sleep(200);
  check(`${label}: FAQ opens`, await p.evaluate(() => document.querySelector('.faq details').open));
  check(`${label}: Launch app (nav) links to /app`, await p.evaluate(() => document.querySelector('.nav .btn').getAttribute('href') === '/app'));
  check(`${label}: final call to action links to /app`, await p.evaluate(() => document.querySelector('.final .btn').getAttribute('href') === '/app'));
  check(`${label}: footer is full-width ink with three columns`, await p.evaluate(() => { const f = document.querySelector('.foot'); const s = getComputedStyle(f); return s.backgroundColor === 'rgb(9, 9, 11)' && Math.round(f.getBoundingClientRect().width) === innerWidth && (innerWidth < 960 || getComputedStyle(document.querySelector('.foot-grid')).gridTemplateColumns.split(' ').length === 3); }));
  await p.close();
}

// The app at phone width, and its design rules
const a = await browser.newPage();
await a.setViewport({ width: 390, height: 844 });
const aerr = []; a.on('pageerror', (e) => aerr.push(e.message));
await a.goto('http://localhost:3400/app', { waitUntil: 'networkidle2' }); await sleep(1200);
const ao = await a.evaluate(() => document.documentElement.scrollWidth - innerWidth);
check(`phone: app has no horizontal overflow (${ao}px)`, ao <= 1);
check('phone: app has no page errors', aerr.length === 0);
const appRules = await a.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('body *')) { const s = getComputedStyle(el); for (const part of (s.boxShadow || '').split(/,(?![^(]*\))/)) { const m = part.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/); if (m && parseFloat(m[3]) > 0) bad.push(el.className || el.tagName); } } return bad; });
check(`app: no blurred box-shadows (${appRules.length})`, appRules.length === 0);
await a.close();

const rm = await browser.newPage();
await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await rm.setViewport({ width: 1440, height: 900 });
await rm.goto('http://localhost:3400/', { waitUntil: 'networkidle2' }); await sleep(800);
check('reduced motion: hero text is visible', await rm.evaluate(() => getComputedStyle(document.querySelector('.hero h1')).opacity === '1'));
await rm.close();

await browser.close(); srv.close();
console.log(fails ? `\n${fails} failed` : '\nAll behavior checks passed');
process.exit(fails ? 1 : 0);
