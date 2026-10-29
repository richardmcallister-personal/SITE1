#!/usr/bin/env node
// Refreshes seat availability in static/should-i-go/index.html from tickets.manutd.com
// using a dedicated Chrome profile (you log in once), then commits and pushes.
//
// Usage:  node refresh.mjs            (headless after first login)
//         node refresh.mjs --login    (opens a window so you can sign in; run once)
//         node refresh.mjs --no-push  (patch the file, don't commit)
//
// Flights and hotels are NOT refreshed here (SlickTrip has no public API); the Book
// links on the page always open live prices, and the daily Claude task refreshes
// the numbers when it runs.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const pageFile = path.join(repo, 'static', 'manutd', 'trips', 'index.html');
const profileDir = path.join(homedir(), '.should-i-go-chrome');
const args = new Set(process.argv.slice(2));
const LOGIN = args.has('--login');
const NO_PUSH = args.has('--no-push');

const AREA_SCRAPE = `(() => {
  var out=[]; document.querySelectorAll('button,[role=button],a,li,div').forEach(function(b){
    var h=b.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > div > h3'); if(!h) return;
    var t=h.textContent.trim(); if(!/^(N|S|E|W|NE|NW|SE|SW)\\d{3,4}$/.test(t)) return;
    var c=b.closest('li,[role=button],button')||b; var txt=(c.parentElement||c).textContent.replace(/\\s+/g,' ');
    var i=txt.indexOf(t); txt=txt.slice(i,i+260); var adult=(txt.match(/Adult\\s*£?([\\d.]+)/)||[])[1]||'?';
    out.push(t+':'+adult)});
  return out.filter((v,i,a)=>a.indexOf(v)===i).join(' ');
})()`;

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

function today() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function main() {
  if (!existsSync(pageFile)) throw new Error('Page not found: ' + pageFile);
  let html = readFileSync(pageFile, 'utf8');

  // Opponents the page knows about (keys of AVAIL).
  const availMatch = html.match(/var AVAIL=\{([\s\S]*?)\n\};/);
  if (!availMatch) throw new Error('AVAIL block not found in page');
  const known = [...availMatch[1].matchAll(/^\s*"([^"]+)":/gm)].map(m => m[1]);
  log('Fixtures on page:', known.join(', '));

  mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: !LOGIN,
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();

  log('Opening fixture list');
  await page.goto('https://tickets.manutd.com/en-GB/categories/home-tickets', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  if (LOGIN) {
    console.log('\nA Chrome window is open. Sign in to your Manchester United account (top-right), then press Enter here.');
    await new Promise(r => process.stdin.once('data', r));
  }

  const loggedIn = await page.evaluate(() => !!document.querySelector('a[href*="logout"], a[href*="account"], [class*="avatar"]'));
  if (!loggedIn) log('WARNING: does not look logged in; members-only fixtures may show nothing. Run with --login.');

  // Fixture cards: name, event href, sale text
  const events = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href*="/events/"]').forEach(a => {
      const href = a.getAttribute('href').split('?')[0];
      const m = href.match(/manchester%20united%20v%20([^/]+)\//i);
      if (!m) return;
      const opp = decodeURIComponent(m[1]).replace(/\s+/g, ' ').trim();
      if (!out.some(e => e.href === href)) out.push({ opp, href });
    });
    return out;
  });
  const pageText = await page.evaluate(() => document.body.innerText);
  log('Fixtures listed on club site:', events.length);

  const results = {};
  const saleText = {};
  for (const ev of events) {
    const name = known.find(k => k.toLowerCase() === ev.opp.toLowerCase())
      || known.find(k => ev.opp.toLowerCase().startsWith(k.toLowerCase().split(' ')[0]));
    if (!name) { log('Not on page (new fixture?):', ev.opp); continue; }

    // Sale status: the sentence after the fixture heading in the list text
    const re = new RegExp('MANCHESTER UNITED V ' + ev.opp.toUpperCase().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '[\\s\\S]{0,300}?BUY NOW\\s*([^\\n]+)', 'i');
    const sm = pageText.match(re);
    if (sm) saleText[name] = sm[1].trim().slice(0, 90);

    const url = 'https://tickets.manutd.com/' + ev.href.replace(/^\/+/, '') + '?hallmap';
    log('Reading', name);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    // close a promo popup if one appears
    await page.evaluate(() => { const x = document.querySelector('[aria-label*="close" i], .modal button.close, button[class*="close"]'); if (x) x.click(); });
    const avail = await page.evaluate(AREA_SCRAPE);
    results[name] = avail;
    log('  ', avail ? avail.split(' ').length + ' blocks' : 'nothing on sale');
  }
  await ctx.close();

  // ---- patch AVAIL ----
  let changed = 0;
  html = html.replace(/var AVAIL=\{([\s\S]*?)\n\};/, (whole, body) => {
    const lines = body.split('\n').map(line => {
      const m = line.match(/^(\s*)"([^"]+)":"([^"]*)"(,?)$/);
      if (!m) return line;
      const [, ind, opp, old, comma] = m;
      if (!(opp in results)) return line;
      if (results[opp] !== old) changed++;
      return `${ind}"${opp}":"${results[opp]}"${comma}`;
    });
    return 'var AVAIL={' + lines.join('\n') + '\n};';
  });

  // ---- patch sale text in FIX ----
  for (const [opp, text] of Object.entries(saleText)) {
    const safe = text.replace(/"/g, "'");
    const re = new RegExp('(\\{opp:"' + opp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '",[^\\n]*?sale:")([^"]*)(")');
    html = html.replace(re, (w, a, old, c) => (old === safe ? w : (changed++, a + safe + c)));
  }

  // ---- stamp the date ----
  html = html.replace(/read from tickets\.manutd\.com on [0-9]{1,2} [A-Z][a-z]{2} [0-9]{4}/, 'read from tickets.manutd.com on ' + today());
  writeFileSync(pageFile, html);
  log('Patched page;', changed, 'value(s) changed');

  if (NO_PUSH) return;
  if (!changed) { log('Nothing changed; not committing.'); return; }
  const run = cmd => execSync(cmd, { cwd: repo, stdio: 'inherit' });
  run('git add static/manutd/trips/index.html');
  run(`git commit -m "should-i-go: seat refresh ${today()}"`);
  run('git push origin main');
  log('Pushed. Cloudflare will republish in a minute or two.');
}

main().catch(e => { console.error(e); process.exit(1); });
