// SITE1 Worker: serves the Hugo build from ./public and proxies a small set of
// API-Football endpoints under /api/* for the Manchester United hub.
//
// Efficiency rules (API-Football Pro: 7,500 calls/day, per-minute cap):
//  - Every upstream answer is stored in KV (global, not per data centre) for TTL seconds,
//    and kept for 7 days beyond that. A stale copy is served immediately while one
//    background refresh runs, so a visitor never waits on the API and never sees its errors.
//  - A cron (see wrangler.jsonc) warms the core endpoints every hour, so ordinary traffic
//    costs ~0 upstream calls. Expect roughly 150–250 calls a day in total.
//  - Error answers (rate limit, plan, key) are never cached; the stale copy stays instead.
// The API key lives in the API_FOOTBALL_KEY secret (wrangler secret put API_FOOTBALL_KEY).

const TEAM = 33;          // Manchester United
const LEAGUES = { pl: 39, ucl: 2 };
const API = "https://v3.football.api-sports.io";
const KEEP = 7 * 24 * 3600;     // seconds a copy stays in KV after it goes stale

function season(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;   // API-Football labels 2026/27 as 2026
}

// name -> { path(url), ttl seconds }
const ROUTES = {
  "/api/status":        { ttl: 300,   path: () => `/status` },
  "/api/standings":     { ttl: 1800,  path: () => `/standings?league=${LEAGUES.pl}&season=${season()}` },
  "/api/ucl":           { ttl: 1800,  path: () => `/standings?league=${LEAGUES.ucl}&season=${season()}` },
  "/api/fixtures":      { ttl: 1800,  path: () => `/fixtures?team=${TEAM}&season=${season()}` },
  "/api/squad":         { ttl: 21600, path: () => `/players/squads?team=${TEAM}` },
  "/api/injuries":      { ttl: 3600,  path: () => `/injuries?team=${TEAM}&season=${season()}` },
  "/api/players":       { ttl: 10800, path: (u) => `/players?team=${TEAM}&season=${season()}&page=${u.searchParams.get("page") || 1}` },
  "/api/player":        { ttl: 86400, path: (u) => `/players?id=${num(u, "id")}&season=${u.searchParams.get("season") || season()}` },
  "/api/season-fixtures": { ttl: 2592000, path: (u) => `/fixtures?team=${TEAM}&season=${num(u, "season")}` },   // historical seasons never change
  "/api/sidelined":     { ttl: 86400, path: (u) => `/sidelined?player=${num(u, "id")}` },
  "/api/lineups":       { ttl: 86400, path: (u) => `/fixtures/lineups?fixture=${num(u, "fixture")}` },
  "/api/fixture-stats": { ttl: 86400, path: (u) => `/fixtures/statistics?fixture=${num(u, "fixture")}` },
  "/api/events":        { ttl: 86400, path: (u) => `/fixtures/events?fixture=${num(u, "fixture")}` },
};
function num(u, k) { return String(parseInt(u.searchParams.get(k) || "0", 10) || 0); }

// Warmed every hour by the cron so pages never wait on the API.
const WARM = ["/api/standings", "/api/ucl", "/api/fixtures", "/api/squad", "/api/injuries", "/api/players?page=1", "/api/players?page=2", "/api/players?page=3"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const WIKI = /(^|\.)manutd\.wiki$/.test(url.hostname);
    if (url.hostname === "www.manutd.wiki") return Response.redirect("https://manutd.wiki" + url.pathname + url.search, 301);
    if (url.pathname.startsWith("/should-i-go")) return Response.redirect(url.origin + (WIKI ? "/trips/" : "/manutd/trips/"), 301);
    if (WIKI) {
      // Clean URLs on the club domain: the site lives under /manutd/ in the repo; serve it at the root here.
      const SERVICE = /^\/(api|img|feed|wiki)(\/|$)/;
      if (url.pathname.startsWith("/manutd/")) return Response.redirect(url.origin + url.pathname.slice(7) + url.search, 301);
      if (!SERVICE.test(url.pathname)) {
        const inner = new URL(url.toString()); inner.pathname = "/manutd" + (url.pathname === "/" ? "/" : url.pathname);
        const res = await env.ASSETS.fetch(new Request(inner.toString(), request));
        const ct = res.headers.get("content-type") || "";
        if (/text\/html|javascript|application\/json/.test(ct)) {
          const body = (await res.text()).replace(/(["'(])\/manutd\//g, "$1/");
          const h = new Headers(res.headers); h.delete("content-length");
          return new Response(body, { status: res.status, headers: h });
        }
        return res;
      }
    }
    if (url.pathname.startsWith("/img/player/")) return portrait(url, ctx);
    if (url.pathname === "/feed") return feed(url, env, ctx);
    if (url.pathname === "/wiki") return wiki(url, env, ctx);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "unknown route" }, 404);
    if (!env.API_FOOTBALL_KEY) return json({ error: "API_FOOTBALL_KEY secret not set on the Worker" }, 500);

    const key = "api:v3:" + url.pathname + url.search;
    const { body, fresh, age } = await load(env, key);
    if (body && fresh) return answer(body, "kv-hit", age);
    if (body) { ctx.waitUntil(refresh(env, key, route, url)); return answer(body, "kv-stale", age); }

    // Nothing cached yet: fetch now (the first visitor pays once; the cron keeps it warm after that).
    const r = await refresh(env, key, route, url);
    return r.ok ? answer(r.body, "upstream", 0) : new Response(r.body, { status: 200, headers: headers("upstream-error") });
  },

  // Hourly warm-up (wrangler.jsonc → triggers.crons). Sequential, spaced, so it never trips the per-minute cap.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      for (const p of WARM) {
        const url = new URL("https://site1.local" + p);
        const route = ROUTES[url.pathname];
        const key = "api:v3:" + url.pathname + url.search;
        const { body, age } = await load(env, key);
        if (body && age < route.ttl * 0.8) continue;        // still fresh enough, skip
        await refresh(env, key, route, url);
        await sleep(1200);
      }
    })());
  },
};

async function load(env, key) {
  const raw = await env.MU_CACHE.get(key);
  if (!raw) return { body: null };
  const nl = raw.indexOf("\n");
  const stamp = parseInt(raw.slice(0, nl), 10);   // first line: unix seconds when fetched + ttl
  const ttl = parseInt(raw.slice(nl + 1, raw.indexOf("\n", nl + 1)), 10);
  const body = raw.slice(raw.indexOf("\n", nl + 1) + 1);
  const age = Math.floor(Date.now() / 1000) - stamp;
  return { body, fresh: age < ttl, age };
}

// Fetch from API-Football with a few retries on the per-minute cap; store only clean answers.
async function refresh(env, key, route, url) {
  let upstream, body = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      upstream = await fetch(API + route.path(url), { headers: { "x-apisports-key": env.API_FOOTBALL_KEY }, cf: { cacheTtl: 0 } });
      body = await upstream.text();
    } catch (e) { body = JSON.stringify({ errors: { network: String(e) } }); }
    if (!/"rateLimit"/.test(body)) break;
    await sleep(1500 + attempt * 1500);
  }
  let clean = false;
  try { const j = JSON.parse(body); clean = !!upstream && upstream.ok && j && (Array.isArray(j.errors) ? j.errors.length === 0 : Object.keys(j.errors || {}).length === 0) && !j.message; } catch (e) {}
  if (clean) await env.MU_CACHE.put(key, Math.floor(Date.now() / 1000) + "\n" + route.ttl + "\n" + body, { expirationTtl: route.ttl + KEEP });
  return { ok: clean, body };
}

function headers(src, age) {
  return { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*", "x-source": src, "x-age": String(age || 0) };
}
function answer(body, src, age) { return new Response(body, { status: 200, headers: headers(src, age) }); }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: headers("worker") }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Player portraits from API-Football's media host, cached at the edge for a day and sent with CORS
// so the team-picker's PNG export can draw them. No API quota is used for these.
async function portrait(url, ctx) {
  const m = url.pathname.match(/^\/img\/player\/(\d+)\.png$/);
  if (!m) return new Response("not found", { status: 404 });
  const cache = caches.default, key = new Request(url.origin + "/__img/v1/" + m[1]);
  const hit = await cache.match(key);
  if (hit) return hit;
  const up = await fetch("https://media.api-sports.io/football/players/" + m[1] + ".png", { cf: { cacheTtl: 86400 } });
  if (!up.ok) return new Response("not found", { status: 404 });
  const res = new Response(up.body, { status: 200, headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// RSS/Atom → JSON for the Links page. Only the feeds listed here can be requested (no open proxy).
// Cached in KV for 30 minutes.
const FEEDS = {
  "bbc":        "https://feeds.bbci.co.uk/sport/football/teams/manchester-united/rss.xml",
  "guardian":   "https://www.theguardian.com/football/manchester-united/rss",
  "sky":        "https://www.skysports.com/rss/12040",
  "yt-manutd":  "https://www.youtube.com/feeds/videos.xml?channel_id=UC6yW44UGJJBvYTlfC7CRg2Q",
  "yt-paddock": "https://www.youtube.com/feeds/videos.xml?channel_id=UC7w8GnTF2Sp3wldDMtCCtVw",
  "yt-athletic":"https://www.youtube.com/feeds/videos.xml?channel_id=UCGYYNGmyhZ_kwBF_lqqXdAQ",
  "yt-pl":      "https://www.youtube.com/feeds/videos.xml?channel_id=UCpryVRk_VDudG8SHXgWcG0w",
  "yt-tus":     "https://www.youtube.com/feeds/videos.xml?channel_id=UCMmVPVb0BwSIOWVeDwlPocQ",
  "pod-totd":   "https://feeds.acast.com/public/shows/6819aed5eb146d8e3506a450",
  "pod-paddock":"https://feeds.megaphone.fm/COMG2101809856",
  "pod-tus":    "https://feeds.acast.com/public/shows/the-united-stand",
  "pod-weekly": "https://feeds.megaphone.fm/COMG3531106743",
  "pod-tribf":  "https://feeds.megaphone.fm/GLT8847082992",
  "pod-second": "https://feeds.acast.com/public/shows/627a2e8f84f3d50012cf11fb",
  "pod-overlap":"https://feeds.acast.com/public/shows/d2a98018-244b-4999-9a83-9c2b9d43a1e3",
};
async function feed(url, env, ctx) {
  const id = url.searchParams.get("id"), src = FEEDS[id];
  if (!src) return json({ error: "unknown feed" }, 404);
  const key = "feed:v2:" + id;
  const cached = await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  let xml = "";
  try { const r = await fetch(src, { headers: { "user-agent": "Mozilla/5.0 (site1 manutd hub)" }, cf: { cacheTtl: 0 } }); xml = r.ok ? await r.text() : ""; } catch (e) {}
  const items = parseFeed(xml).slice(0, 12);
  const head = xml.split(/<(?:item|entry)\b/)[0] || "";
  const sm = head.match(/<itunes:image[^>]*href="([^"]+)"/) || head.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/);
  const show = { image: sm ? clean(sm[1]) : "" };
  const body = JSON.stringify({ id, show, items });
  if (items.length) ctx.waitUntil(env.MU_CACHE.put(key, body, { expirationTtl: 1800 }));
  return new Response(body, { headers: headers(items.length ? "upstream" : "upstream-empty") });
}
function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  for (const b of blocks) {
    const tag = (n) => { const m = b.match(new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + n + ">")); return m ? clean(m[1]) : ""; };
    let link = tag("link");
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/); link = m ? m[1] : ""; }
    const enc = b.match(/<enclosure[^>]*url="([^"]+)"/);
    const yt = b.match(/<yt:videoId>([^<]+)</);
    const dur = b.match(/<itunes:duration>([^<]+)</);
    const img = b.match(/<itunes:image[^>]*href="([^"]+)"/) || b.match(/<media:thumbnail[^>]*url="([^"]+)"/);
    out.push({ title: tag("title"), link, date: tag("pubDate") || tag("published") || tag("updated"), summary: (tag("description") || tag("itunes:summary") || tag("media:description")).replace(/<[^>]+>/g, "").slice(0, 280), audio: enc ? enc[1] : "", video: yt ? yt[1] : "", duration: dur ? dur[1] : "", image: img ? img[1] : "" });
  }
  return out;
}
function clean(s) { return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim(); }

// ---- Wikipedia player profile → JSON (summary + parsed football-biography infobox), cached 7 days.
async function wiki(url, env, ctx) {
  let title = (url.searchParams.get("title") || "").trim(), q = (url.searchParams.get("q") || "").trim();
  if (!title && !q) return json({ error: "title or q required" }, 400);
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  if (!title) {
    // Resolve an abbreviated name ("K. Mainoo") to an article title via search.
    const qkey = "wiki:q:v2:" + q.toLowerCase();
    let hit = await env.MU_CACHE.get(qkey);
    if (!hit) {
      const surname = q.replace(/^[A-Z]\. ?/, "").split(" ").pop();
      const r = await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent('hastemplate:"Infobox football biography" ' + q.replace(/^[A-Z]\. ?/, "") + " Manchester United"), { headers: UA });
      const j = r.ok ? await r.json() : null;
      const list = j && j.query ? j.query.search : [];
      const pick = list.filter((x) => x.title.toLowerCase().indexOf(surname.toLowerCase()) >= 0)[0] || list[0];
      hit = pick ? pick.title : "";
      if (hit) ctx.waitUntil(env.MU_CACHE.put(qkey, hit, { expirationTtl: 30 * 86400 }));
    }
    if (!hit) return json({ error: "not found", q }, 404);
    title = hit;
  }
  const key = "wiki:p:v6:" + title;
  const cached = url.searchParams.get("debug") ? null : await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const [sr, wr, ir] = await Promise.all([
    fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + enc, { headers: UA }),
    fetch("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=" + enc, { headers: UA }),
    fetch("https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&generator=images&gimlimit=30&prop=imageinfo&iiprop=url|mime&iiurlwidth=640&titles=" + enc, { headers: UA }),
  ]);
  const sum = sr.ok ? await sr.json() : {};
  const wj = wr.ok ? await wr.json() : {};
  const ij = ir.ok ? await ir.json() : {};
  const wt = wj.parse && wj.parse.wikitext ? wj.parse.wikitext["*"] : "";
  const box = parseInfobox(wt);
  if (url.searchParams.get("debug")) { const i0 = wt.search(/\{\{\s*Infobox football biography/i); return json({ keys: box && box._keys, raw: wt.slice(i0, i0 + 6000) }); }
  // Photos from the article: real photographs only (no SVG icons, flags, crests, maps).
  const images = Object.values((ij.query && ij.query.pages) || {}).filter((pg) => pg.imageinfo && pg.imageinfo[0] && /image\/(jpeg|png)/.test(pg.imageinfo[0].mime) && !/flag|logo|crest|badge|icon|map|kit|shirt|signature|wikimedia|commons-logo|stadium/i.test(pg.title))
    .map((pg) => ({ title: pg.title.replace(/^File:/, ""), thumb: pg.imageinfo[0].thumburl || pg.imageinfo[0].url, url: pg.imageinfo[0].descriptionurl || pg.imageinfo[0].url })).slice(0, 12);
  const out = { title: sum.title || title, description: sum.description || "", extract: sum.extract || "", thumbnail: sum.thumbnail ? sum.thumbnail.source : "", original: sum.originalimage ? sum.originalimage.source : "", url: sum.content_urls ? sum.content_urls.desktop.page : "https://en.wikipedia.org/wiki/" + enc, infobox: box, images };
  const body = JSON.stringify(out);
  if (sum.title) ctx.waitUntil(env.MU_CACHE.put(key, body, { expirationTtl: 7 * 86400 }));
  return new Response(body, { headers: headers(sum.title ? "upstream" : "upstream-empty") });
}
function boxFields(wt, re) {
  const i = wt.search(re);
  if (i < 0) return null;
  let depth = 0, j = i;
  for (; j < wt.length; j++) { if (wt.startsWith("{{", j)) { depth++; j++; } else if (wt.startsWith("}}", j)) { depth--; j++; if (depth === 0) break; } }
  const body = wt.slice(i + 2, j - 1);
  const parts = []; let cur = "", d = 0, b = 0;
  for (let k = 0; k < body.length; k++) {
    const c2 = body.substr(k, 2);
    if (c2 === "{{") { d++; cur += c2; k++; continue; } if (c2 === "}}") { d--; cur += c2; k++; continue; }
    if (c2 === "[[") { b++; cur += c2; k++; continue; } if (c2 === "]]") { b--; cur += c2; k++; continue; }
    if (body[k] === "|" && d === 0 && b === 0) { parts.push(cur); cur = ""; continue; }
    cur += body[k];
  }
  parts.push(cur);
  const f = {};
  parts.slice(1).forEach((p) => { const m = p.match(/^\s*([\w\-]+)\s*=\s*([\s\S]*)$/); if (m) f[m[1].toLowerCase().replace(/_/g, "")] = wtClean(m[2]); });
  return f;
}
function parseInfobox(wt) {
  const f = boxFields(wt, /\{\{\s*Infobox football biography/i);
  if (!f) return null;
  if (f.embed) {
    // Football box embedded in a general biography box (actors, pundits…): personal details live in the outer box.
    const outer = boxFields(wt, /\{\{\s*Infobox (?:person|sportsperson|football official)/i) || {};
    ["name", "fullname", "birthname", "birthdate", "birthplace", "deathdate", "height"].forEach((k) => { if (!f[k] && outer[k]) f[k] = outer[k]; });
    if (!f.fullname && outer.birthname) f.fullname = outer.birthname;
  }
  const rows = (pre, keys) => { const out = []; for (let n = 1; n < 40; n++) { const r = {}; let any = false; keys.forEach((k) => { const v = f[pre + k + n]; if (v !== undefined && v !== "") any = true; r[k] = v || ""; }); if (!any) { if (n > 3) break; else continue; } if (r.clubs || r.team) out.push(r); } return out; };
  return {
    _keys: Object.keys(f),
    name: f.name || "", fullname: f.fullname || "", birth_date: f.birthdate || "", birth_place: f.birthplace || "", death_date: f.deathdate || "", height: f.height || "", position: f.position || "", currentclub: f.currentclub || "", clubnumber: f.clubnumber || "",
    youth: rows("youth", ["years", "clubs"]), clubs: rows("", ["years", "clubs", "caps", "goals"]), national: rows("national", ["years", "team", "caps", "goals"]), manager: rows("manager", ["years", "clubs"]),
    totalcaps: f.totalcaps || "", totalgoals: f.totalgoals || "",
  };
}
// Reduce wikitext to plain text: refs out, links to their label, common templates to their value.
function wtClean(v) {
  let s = String(v);
  s = s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<br\s*\/?>/gi, " ");
  for (let n = 0; n < 4; n++) {
    s = s.replace(/\{\{\s*(?:birth date and age|birth date|death date and age|death date|bda|dda|birth-date and age|birth-date)\s*\|([^}]*)\}\}/gi, (m, args) => { const n = args.split("|").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)); return n.length >= 3 ? n[0] + "-" + n[1].padStart(2, "0") + "-" + n[2].padStart(2, "0") : (n[0] || ""); });
    s = s.replace(/\{\{\s*(?:birth year and age|death year and age)\s*\|\s*(\d{4})[^}]*\}\}/gi, "$1");
    s = s.replace(/\{\{\s*(?:convert|cvt)\s*\|\s*(\d+)\s*\|\s*ft\s*\|\s*([\d.]+)\s*\|\s*in[^}]*\}\}/gi, (m, ft, inch) => ((parseInt(ft, 10) * 12 + parseFloat(inch)) * 0.0254).toFixed(2) + " m");
    s = s.replace(/\{\{\s*height\s*\|[^}]*ft\s*=\s*(\d+)[^}]*in\s*=\s*([\d.]+)[^}]*\}\}/gi, (m, ft, inch) => ((parseInt(ft, 10) * 12 + parseFloat(inch)) * 0.0254).toFixed(2) + " m");
    s = s.replace(/\{\{\s*(?:height|convert|cvt)\s*\|\s*(?:m\s*=\s*)?([\d.]+)\s*(?:\|\s*m)?[^}]*\}\}/gi, (m, x) => (parseFloat(x) < 3 ? x + " m" : x));
    s = s.replace(/\{\{\s*(?:nowrap|nobr|nbsp|small|lang|flagicon|flagu|flag|fb|fbu|fbw|plainlist|hlist|ubl|unbulleted list|dts|date|start date|end date)\s*\|([^{}]*)\}\}/gi, (m, x) => x.split("|").filter((p) => !/=/.test(p)).join(" · "));
    s = s.replace(/\{\{\s*[^{}|]*\s*\}\}/g, "");
  }
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\[https?:[^\s\]]*\s?([^\]]*)\]/g, "$1");
  s = s.replace(/'{2,}/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
