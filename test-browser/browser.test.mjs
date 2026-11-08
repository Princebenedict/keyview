import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createApp } from '../src/server.js';
const srv = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'beh-')) });
await new Promise((r) => srv.listen(3400, r));
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
let fails = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [label, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED/.test(m.text())) errors.push(m.text()); });
  await p.setViewport({ width: w, height: h });
  await p.goto('http://localhost:3400/', { waitUntil: 'networkidle2' });
  await p.addStyleTag({ content: 'html{scroll-behavior:auto!important}' }); // headless timing: jump instead of glide
  await sleep(1200);
  check(`${label}: landing has no console or page errors`, errors.length === 0);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(`${label}: landing has no horizontal overflow (${overflow}px)`, overflow <= 1);
  check(`${label}: wordmark present`, await p.evaluate(() => document.querySelector('.wordmark').getAttribute('aria-label') === 'KeyView'));

  // key toggle
  await p.evaluate(() => document.querySelector('#stage').scrollIntoView({ block: 'center' }));
  await sleep(1200);
  await p.click('#turn'); await sleep(300);
  check(`${label}: turning the key opens the stage`, await p.evaluate(() => document.querySelector('#stage').dataset.open === 'true' && document.querySelector('#turn').getAttribute('aria-pressed') === 'true'));
  await p.click('#turn'); await sleep(200);
  check(`${label}: turning again locks it`, await p.evaluate(() => document.querySelector('#stage').dataset.open === 'false'));

  // scroll drives the diagram
  const seen = new Set();
  for (const n of [1, 2, 3, 4]) {
    await p.evaluate((n) => document.querySelector(`.step[data-step="${n}"]`).scrollIntoView({ block: 'center' }), n);
    await sleep(900);
    seen.add(await p.evaluate(() => document.querySelector('#dia').dataset.step));
  }
  check(`${label}: scrolling steps through diagram states 1 to 4 (${[...seen].join(',')})`, seen.size === 4);

  // ring cycles (it pauses while off-screen, so bring it into view first)
  await p.evaluate(() => document.querySelector('.ringbox').scrollIntoView({ block: 'center' }));
  await sleep(1800);
  const r1 = await p.evaluate(() => document.querySelector('#ringBig').textContent);
  await sleep(2500);
  const r2 = await p.evaluate(() => document.querySelector('#ringBig').textContent);
  check(`${label}: key ring counts down (${r1} to ${r2})`, r1 !== r2);

  // FAQ
  await p.evaluate(() => document.querySelector('#faq').scrollIntoView());
  await p.click('.faq summary'); await sleep(200);
  check(`${label}: FAQ opens`, await p.evaluate(() => document.querySelector('.faq details').open));

  // CTA goes to the app
  const href = await p.evaluate(() => document.querySelector('.cta .btn').getAttribute('href'));
  check(`${label}: Launch app links to /app`, href === '/app');
  await p.close();
}

// App at phone width
const a = await browser.newPage();
await a.setViewport({ width: 390, height: 844 });
const aerr = []; a.on('pageerror', (e) => aerr.push(e.message));
await a.goto('http://localhost:3400/app', { waitUntil: 'networkidle2' }); await sleep(1200);
check('phone: app has no horizontal overflow (' + await a.evaluate(() => document.documentElement.scrollWidth - innerWidth) + 'px)', await a.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
check('phone: app has no page errors', aerr.length === 0);
await a.screenshot({ path: path.join(os.tmpdir(), 'keyview-app-phone.png') });
await a.close();

// Reduced motion renders content without animation dependence
const rm = await browser.newPage();
await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await rm.setViewport({ width: 1440, height: 900 });
await rm.goto('http://localhost:3400/', { waitUntil: 'networkidle2' }); await sleep(800);
check('reduced motion: hero text is visible', await rm.evaluate(() => getComputedStyle(document.querySelector('.tagline')).opacity === '1'));
await rm.close();

await browser.close(); srv.close();
console.log(fails ? `\n${fails} failed` : '\nAll behavior checks passed');
