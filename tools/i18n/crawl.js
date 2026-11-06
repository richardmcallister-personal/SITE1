// Crawl manutd.wiki, render each page template (a few query variants), click tabs, collect visible strings.
const { chromium } = require("playwright");
const fs = require("fs");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://manutd.wiki";
const PER = +(process.argv[2] || 3);
const out = process.argv[3] || "rendered.json";

const COLLECT = () => {
  const res = [];
  const skip = (el) => el.closest("script,style,noscript,svg,code,[translate=no],.notranslate");
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!t || !/[A-Za-z]/.test(t)) continue;
    const p = n.parentElement; if (!p || skip(p)) continue;
    res.push(["t", t, p.tagName.toLowerCase() + (p.className && typeof p.className === "string" ? "." + p.className.split(" ")[0] : "")]);
  }
  document.querySelectorAll("[placeholder],[aria-label],[title],[alt],input[type=button],input[type=submit],option").forEach((el) => {
    if (skip(el)) return;
    ["placeholder", "aria-label", "title", "alt"].forEach((a) => { const v = el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) res.push(["a", v.trim(), a]); });
    if (el.tagName === "INPUT" && el.value) res.push(["a", el.value, "value"]);
  });
  res.push(["a", document.title, "title"]);
  return { strings: res, links: [...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => h.startsWith(location.origin)) };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-GB", timezoneId: "Europe/Stockholm" });
  await ctx.addInitScript(() => { try { localStorage.setItem("mu:consent", "denied"); } catch (e) {} });
  const page = await ctx.newPage();
  const seen = new Map(); // template -> count
  const visited = new Set();
  const queue = [BASE + "/"];
  const strings = {}; // text -> {kind, where:Set}
  const tmpl = (u) => { const x = new URL(u); return x.pathname.replace(/\/+$/, "/") || "/"; };
  while (queue.length) {
    const u0 = queue.shift(); const x = new URL(u0); x.hash = ""; const u = x.toString();
    if (visited.has(u)) continue;
    if (/\.(json|ics|png|jpg|webp|js|css|xml|txt)$/.test(x.pathname) || /^\/(api|wiki|feed|img|ask$|calendar)/.test(x.pathname)) continue;
    const t = tmpl(u); const c = seen.get(t) || 0; if (c >= PER) continue;
    seen.set(t, c + 1); visited.add(u);
    try {
      await page.goto(u, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) { console.error("timeout", u); }
    await page.waitForTimeout(1500);
    // open everything that is openable: tabs, details, "Earlier" style buttons
    const tabs = await page.$$('[role=tab], .tabs button, .pills a[href^="#"]');
    const batches = [await page.evaluate(COLLECT)];
    for (const tb of tabs.slice(0, 8)) { try { await tb.click({ timeout: 2000 }); await page.waitForTimeout(700); batches.push(await page.evaluate(COLLECT)); } catch (e) {} }
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    batches.push(await page.evaluate(COLLECT));
    for (const bt of batches) {
      for (const [k, s, where] of bt.strings) { const e = strings[s] || (strings[s] = { k, w: {}, pages: {} }); e.w[where] = 1; e.pages[t] = 1; }
      for (const l of bt.links) { const lx = new URL(l); lx.hash = ""; if (!visited.has(lx.toString())) queue.push(lx.toString()); }
    }
    console.error(t, c + 1, Object.keys(strings).length);
  }
  fs.writeFileSync(out, JSON.stringify(strings));
  await b.close();
})();
