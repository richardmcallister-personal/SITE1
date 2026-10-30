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
  "/api/match":         { ttl: 21600, live: true, path: (u) => `/fixtures?id=${num(u, "fixture")}` },   // one call: fixture + events + line-ups + stats
  "/api/sidelined":     { ttl: 86400, path: (u) => `/sidelined?player=${num(u, "id")}` },
  "/api/lineups":       { ttl: 86400, path: (u) => `/fixtures/lineups?fixture=${num(u, "fixture")}` },
  "/api/fixture-stats": { ttl: 86400, path: (u) => `/fixtures/statistics?fixture=${num(u, "fixture")}` },
  "/api/events":        { ttl: 86400, path: (u) => `/fixtures/events?fixture=${num(u, "fixture")}` },
  "/api/transfers":     { ttl: 86400, path: () => `/transfers?team=${TEAM}` },
  "/api/team-fixtures": { ttl: 3600,  path: (u) => `/fixtures?team=${num(u, "team")}&season=${season()}&from=${(u.searchParams.get("from") || "").slice(0, 10)}&to=${(u.searchParams.get("to") || "").slice(0, 10)}` },
  "/api/fixture-players": { ttl: 30 * 86400, path: (u) => `/fixtures/players?fixture=${num(u, "fixture")}` },   // only fetched for finished matches
  "/api/season-standings": { ttl: 30 * 86400, path: (u) => `/standings?league=${LEAGUES.pl}&season=${num(u, "season")}` },
  "/api/player-season": { ttl: 30 * 86400, path: (u) => `/players?id=${num(u, "id")}&season=${num(u, "season")}` },   // past seasons, for debut lookups
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
      const SERVICE = /^\/(api|img|feed|wiki|wiki-season|wiki-club)(\/|$)/;
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
    if (url.pathname === "/wiki-season") return wikiSeason(url, env, ctx);
    if (url.pathname === "/wiki-club") return wikiClub(url, env, ctx);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (url.pathname === "/api/youth") return youth(url, env, ctx);
    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "unknown route" }, 404);
    if (!env.API_FOOTBALL_KEY) return json({ error: "API_FOOTBALL_KEY secret not set on the Worker" }, 500);

    const key = "api:v3:" + url.pathname + url.search;
    const { body, fresh, age } = await load(env, key);
    if (route.live && body) {
      // Live window: from 90 minutes before kick-off until the match is finished, treat anything older than 60s as stale.
      try { const j = JSON.parse(body), f = j.response && j.response[0]; if (f) { const ko = f.fixture.timestamp * 1000, st = f.fixture.status.short, now = Date.now();
        const inWindow = (now > ko - 90 * 60000 && !/FT|AET|PEN|CANC|PST|ABD|AWD|WO/.test(st)) || /1H|HT|2H|ET|BT|P|LIVE|INT|SUSP/.test(st);
        if (inWindow && age > 60) { ctx.waitUntil(refresh(env, key, route, url)); return answer(body, "kv-live-stale", age); } if (inWindow) return answer(body, "kv-live", age); } } catch (e) {}
    }
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
      const yk = "youth:v3:report", y = await load(env, yk);
      if (!y.body || y.age > YOUTH_TTL * 0.8) await buildYouth(env, 25).catch(() => {});
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
    const qkey = "wiki:q:v4:" + q.toLowerCase();
    let hit = await env.MU_CACHE.get(qkey);
    if (!hit) {
      const surname = q.replace(/^[A-Z]\. ?/, "").split(" ").pop();
      const r = await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent('hastemplate:"Infobox football biography" ' + q.replace(/^[A-Z]\. ?/, "") + " Manchester United"), { headers: UA });
      const j = r.ok ? await r.json() : null;
      const list = j && j.query ? j.query.search : [];
      // Surname must be a whole word of the title (so "O. Martin" cannot land on "Martin Dúbravka"), and when the query
      // carries an initial the title's first name must start with it; fall back to the plain surname match, then nothing.
      const ini = (q.match(/^([A-Z])\. ?/) || [])[1], sn = surname.toLowerCase(), base = (t) => t.replace(/\s*\(.*\)$/, "");
      const word = (t) => base(t).toLowerCase().split(/[\s-]+/).indexOf(sn) >= 0 && base(t).toLowerCase().split(/[\s-]+/).indexOf(sn) > 0;
      const pick = list.filter((x) => word(x.title) && (!ini || base(x.title)[0].toUpperCase() === ini))[0] || (!ini ? (list.filter((x) => word(x.title))[0] || list.filter((x) => x.title.toLowerCase().indexOf(sn) >= 0)[0]) : null);
      hit = pick ? pick.title : "";
      if (hit) ctx.waitUntil(env.MU_CACHE.put(qkey, hit, { expirationTtl: 30 * 86400 }));
    }
    if (!hit) return json({ error: "not found", q }, 404);
    title = hit;
  }
  const key = "wiki:p:v10:" + title;
  const cached = url.searchParams.get("debug") ? null : await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const [sr, wr, ir] = await Promise.all([
    fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + enc, { headers: UA }),
    fetch("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=" + enc, { headers: UA }),
    fetch("https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&generator=images&gimlimit=30&prop=imageinfo&iiprop=url|mime&iiurlwidth=640&titles=" + enc, { headers: UA }),
  ]);
  let sum = sr.ok ? await sr.json() : {};
  let wj = wr.ok ? await wr.json() : {};
  let ij = ir.ok ? await ir.json() : {};
  let wt = wj.parse && wj.parse.wikitext ? wj.parse.wikitext["*"] : "";
  let box = parseInfobox(wt);
  if ((sum.type === "disambiguation" || !box) && !url.searchParams.get("noretry")) {
    // Wrong article (a disambiguation page, or no football infobox): try the "(footballer)" title, then a biography search.
    const tries = [title + " (footballer)", title + " (Irish footballer)", title + " (Scottish footballer)", title + " (English footballer)"];
    let found = null;
    for (const t of tries) {
      const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t.replace(/ /g, "_")), { headers: UA });
      if (r.ok) { const j = await r.json(); if (j.type !== "disambiguation" && /footballer|football manager|football player|soccer/i.test(j.description || "")) { found = j.title; break; } }
    }
    if (!found) {
      const r = await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent('hastemplate:"Infobox football biography" "' + title.replace(/ \(.*\)$/, "") + '" Manchester United'), { headers: UA });
      const j = r.ok ? await r.json() : null; const hit = j && j.query && j.query.search[0];
      if (hit) found = hit.title;
    }
    if (found && found !== title) { const u2 = new URL(url.toString()); u2.searchParams.set("title", found); u2.searchParams.set("noretry", "1"); return wiki(u2, env, ctx); }
  }
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
  parts.slice(1).forEach((p) => { const m = p.match(/^\s*([\w\- ]+?)\s*=\s*([\s\S]*)$/); if (m) f[m[1].toLowerCase().replace(/[_\s]/g, "")] = wtClean(m[2]); });
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
    s = s.replace(/\{\{\s*(?:nowrap|nobr|nobold|nbsp|small|lang|flagicon|flagu|flag|fb|fbu|fbw|plainlist|hlist|ubl|unbulleted list|dts|date|start date|end date)\s*\|([^{}]*)\}\}/gi, (m, x) => x.split("|").filter((p) => !/=/.test(p)).join(" · "));
    s = s.replace(/\{\{\s*0\s*\|[^{}]*\}\}/g, "");          // {{0|0000}} spacing pad
    s = s.replace(/\{\{\s*[^{}|]*\s*\}\}/g, "");
  }
  for (let n = 0; n < 5 && /\{\{/.test(s); n++) s = s.replace(/\{\{[^{}]*\}\}/g, "");   // anything else left over, innermost first
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\[https?:[^\s\]]*\s?([^\]]*)\]/g, "$1");
  s = s.replace(/'{2,}/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return s;
}


// ---- Academy & loan watch: one composite report, cached in KV, rebuilt by the cron and on demand when stale.
const YOUTH_TTL = 6 * 3600;
async function youth(url, env, ctx) {
  const key = "youth:v3:report";
  const { body, fresh, age } = await load(env, key);
  if (body && fresh) return answer(body, "kv-hit", age);
  if (body) { ctx.waitUntil(buildYouth(env, 12).catch(() => {})); return answer(body, "kv-stale", age); }
  try { const out = await buildYouth(env, 12); return answer(out, "upstream", 0); }
  catch (e) { if (e.budget) return json({ building: true, note: "First build in progress — the report assembles over a few minutes; the hourly job finishes it.", at: e.at }, 200); return json({ error: String(e) }, 200); }
}
// Fetch one API route through the same KV cache the pages use.
// Each call to the API costs one unit of a per-invocation budget (Workers cap subrequests; the API caps calls per minute),
// so a full build spreads over several cron runs — every piece lands in KV, and the next run picks up where this one stopped.
async function viaCache(env, pathWithQuery, budget) {
  const u = new URL("https://site1.local" + pathWithQuery), route = ROUTES[u.pathname], key = "api:v3:" + u.pathname + u.search;
  const { body, fresh } = await load(env, key);
  if (body && fresh) return JSON.parse(body);
  if (body && budget && budget.left <= 0) return JSON.parse(body);
  if (budget && budget.left <= 0) throw Object.assign(new Error("budget"), { budget: true, at: pathWithQuery });
  if (budget) budget.left--;
  const r = await refresh(env, key, route, u);
  await sleep(1300);
  if (r.ok) return JSON.parse(r.body);
  if (body) return JSON.parse(body);
  throw new Error("API failed for " + pathWithQuery + ": " + r.body.slice(0, 120));
}
async function buildYouth(env, limit) {
  const B = { left: limit || 12 };
  const S = season(), today = new Date(), d7 = new Date(today.getTime() - 7 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const seasonStart = S + "-06-01";
  // 1. Who to watch. Loanees: this season's loans out of United not since cancelled; academy: the youngest first-team squad members.
  const [tr, sq] = await Promise.all([viaCache(env, "/api/transfers", B), viaCache(env, "/api/squad", B)]);
  const loans = {};
  for (const p of tr.response || []) {
    const ts = (p.transfers || []).filter((t) => t.date >= seasonStart).sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = ts[ts.length - 1];
    if (last && /loan/i.test(last.type || "") && last.teams.out && last.teams.out.id === TEAM && last.teams.in && last.teams.in.id !== TEAM)
      loans[p.player.id] = { id: p.player.id, name: p.player.name, status: "loan", club: { id: last.teams.in.id, name: last.teams.in.name, logo: last.teams.in.logo }, since: last.date };
  }
  const squad = (sq.response && sq.response[0] ? sq.response[0].players : []);
  // Young signings in the squad are watched too, but are not "academy" and get no debut ladder (ids from the API squad list).
  const SIGNED = new Set([ /* Yoro */ 342970, /* Andrey Santos */ 305834, /* Baleba */ 356041, /* Dorgu */ 382452 ]);
  const academy = squad.filter((p) => (p.age && p.age <= 21) || (p.number && p.number >= 40)).map((p) => ({ id: p.id, name: p.name, status: SIGNED.has(p.id) ? "young" : "academy", club: { id: TEAM, name: "Manchester United", logo: "" }, age: p.age, number: p.number, position: p.position, photo: p.photo }));
  const watch = Object.values(loans).concat(academy.filter((a) => !loans[a.id]));
  // 2. Season stats per player (all teams, so a loanee's loan-club rows come through), plus earlier seasons for the debut ladder.
  for (const w of watch) {
    const j = await viaCache(env, `/api/player?id=${w.id}`, B);
    const r = j.response && j.response[0];
    if (r) {
      w.name = r.player.name; w.fullname = [r.player.firstname, r.player.lastname].filter(Boolean).join(" "); w.age = r.player.age; w.photo = r.player.photo; w.nationality = r.player.nationality; w.birth = r.player.birth && r.player.birth.date;
      w.season = (r.statistics || []).filter((x) => x.games && (x.games.appearences || x.games.minutes || x.games.lineups)).map((x) => ({ team: { id: x.team.id, name: x.team.name, logo: x.team.logo }, league: x.league.name, apps: x.games.appearences || 0, starts: x.games.lineups || 0, minutes: x.games.minutes || 0, position: x.games.position, rating: x.games.rating ? +x.games.rating : null, goals: x.goals.total || 0, assists: x.goals.assists || 0, conceded: x.goals.conceded, saves: x.goals.saves, yellow: (x.cards && x.cards.yellow) || 0, red: (x.cards && x.cards.red) || 0, benched: x.substitutes && x.substitutes.bench || 0 }));
      w.position = w.position || (w.season[0] && w.season[0].position) || "";
    } else w.season = [];
    // United debut: earliest season (last four) with a United appearance.
    w.utd = { apps: 0, starts: 0, minutes: 0, debutSeason: null };
    for (let y = S; y >= S - ((w.age || 99) <= 23 ? 2 : 0); y--) {
      const jj = y === S ? j : await viaCache(env, `/api/player-season?id=${w.id}&season=${y}`, B);
      const rr = jj.response && jj.response[0];
      const rows = rr ? (rr.statistics || []).filter((x) => x.team.id === TEAM && x.games && x.games.appearences) : [];
      const apps = rows.reduce((a, x) => a + (x.games.appearences || 0), 0);
      if (y === S) { w.utd.apps = apps; w.utd.starts = rows.reduce((a, x) => a + (x.games.lineups || 0), 0); w.utd.minutes = rows.reduce((a, x) => a + (x.games.minutes || 0), 0); }
      if (apps) w.utd.debutSeason = y;
      if (rr && rr.player && rr.player.age && y !== S && !apps && (w.age || 99) - (S - y) < 16) break;
    }
  }
  // 3. Last seven days, match by match, from the per-fixture player stats of each club involved.
  const clubs = {}; watch.forEach((w) => { clubs[w.club.id] = w.club; });
  const byClub = {};
  for (const cid of Object.keys(clubs)) {
    const fx = await viaCache(env, `/api/team-fixtures?team=${cid}&from=${iso(d7)}&to=${iso(today)}`, B);
    byClub[cid] = (fx.response || []).filter((m) => /FT|AET|PEN/.test(m.fixture.status.short));
  }
  for (const w of watch) w.week = [];
  for (const cid of Object.keys(byClub)) {
    for (const m of byClub[cid]) {
      const fp = await viaCache(env, `/api/fixture-players?fixture=${m.fixture.id}`, B);
      const side = (fp.response || []).filter((t) => t.team.id === +cid)[0];
      if (!side) continue;
      const squadIds = new Set(side.players.map((p) => p.player.id));
      for (const w of watch) {
        if (w.club.id !== +cid || !squadIds.has(w.id)) continue;
        const row = side.players.filter((p) => p.player.id === w.id)[0], g = row.statistics[0] || {}, gm = g.games || {};
        const home = m.teams.home.id === +cid, opp = home ? m.teams.away : m.teams.home;
        w.week.push({ fixture: { id: m.fixture.id, date: m.fixture.date, league: m.league.name, home, opp: { id: opp.id, name: opp.name, logo: opp.logo }, score: (home ? m.goals.home : m.goals.away) + "–" + (home ? m.goals.away : m.goals.home) },
          minutes: gm.minutes || 0, started: !gm.substitute && !!gm.minutes, sub: !!gm.substitute && !!gm.minutes, unused: !gm.minutes, position: gm.position || "", number: gm.number, rating: gm.rating ? +gm.rating : null, captain: !!gm.captain,
          goals: (g.goals && g.goals.total) || 0, assists: (g.goals && g.goals.assists) || 0, conceded: g.goals ? g.goals.conceded : null, saves: g.goals ? g.goals.saves : null, yellow: (g.cards && g.cards.yellow) || 0, red: (g.cards && g.cards.red) || 0, shots: g.shots && g.shots.total || 0, keyPasses: g.passes && g.passes.key || 0, tacklesTotal: g.tackles && g.tackles.total || 0, duelsWon: g.duels && g.duels.won || 0, dribbles: g.dribbles && g.dribbles.success || 0 });
      }
    }
  }
  // 4. United matchday squads this season, for the academy ladder (bench appearances count).
  const ufx = await viaCache(env, "/api/fixtures", B);
  const played = (ufx.response || []).filter((m) => /FT|AET|PEN/.test(m.fixture.status.short)).sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
  const bench = {}, first = {}, firstStart = {};
  for (const m of played) {
    const fp = await viaCache(env, `/api/fixture-players?fixture=${m.fixture.id}`, B);
    const side = (fp.response || []).filter((t) => t.team.id === TEAM)[0]; if (!side) continue;
    const home = m.teams.home.id === TEAM, opp = home ? m.teams.away.name : m.teams.home.name;
    for (const p of side.players) {
      const gm = (p.statistics[0] || {}).games || {};
      bench[p.player.id] = (bench[p.player.id] || 0) + 1;
      if (gm.minutes && !first[p.player.id]) first[p.player.id] = { date: m.fixture.date, opp, league: m.league.name, minutes: gm.minutes, sub: !!gm.substitute };
      if (gm.minutes && !gm.substitute && !firstStart[p.player.id]) firstStart[p.player.id] = { date: m.fixture.date, opp, league: m.league.name };
    }
  }
  for (const w of watch) { w.utd.squads = bench[w.id] || 0; w.utd.firstThisSeason = first[w.id] || null; w.utd.firstStartThisSeason = firstStart[w.id] || null; }
  watch.sort((a, b) => (a.status === b.status ? (b.week.reduce((x, y) => x + y.minutes, 0) - a.week.reduce((x, y) => x + y.minutes, 0)) : a.status === "loan" ? -1 : 1));
  const out = JSON.stringify({ generated: new Date().toISOString(), season: S, window: { from: iso(d7), to: iso(today) }, players: watch });
  await env.MU_CACHE.put("youth:v3:report", Math.floor(Date.now() / 1000) + "\n" + YOUTH_TTL + "\n" + out, { expirationTtl: YOUTH_TTL + KEEP });
  // weekly archive, one per ISO week, kept 90 days
  const wk = isoWeek(today); await env.MU_CACHE.put("youth:v3:week:" + wk, out, { expirationTtl: 90 * 86400 });
  return out;
}
function isoWeek(d) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + "-W" + String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0"); }


// ---- Wikipedia season article → JSON (lead + "Infobox football club season"), for the seasons without a hand-written page.
async function wikiSeason(url, env, ctx) {
  const s = (url.searchParams.get("s") || "").trim();              // "1992-93"
  const m = s.match(/^(\d{4})-(\d{2})$/); if (!m) return json({ error: "s=YYYY-YY required" }, 400);
  const key = "wiki:s:v2:" + s, cached = url.searchParams.get("debug") ? null : await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  const y = +m[1], yy = m[1] + "–" + (m[2] === "00" ? String(y + 1) : m[2]);
  const cands = y < 1902 ? [yy + " Newton Heath F.C. season", yy + " Newton Heath LYR F.C. season", yy + " Manchester United F.C. season"] : [yy + " Manchester United F.C. season"];
  let sum = null, title = "";
  for (const c of cands) {
    const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(c.replace(/ /g, "_")), { headers: UA });
    if (r.ok) { sum = await r.json(); title = sum.title || c; break; }
  }
  if (!sum) return json({ error: "no article", tried: cands }, 404);
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const wr = await fetch("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=" + enc, { headers: UA });
  const wj = wr.ok ? await wr.json() : {};
  const wt = wj.parse && wj.parse.wikitext ? wj.parse.wikitext["*"] : "";
  const f = boxFields(wt, /\{\{\s*Infobox football club season/i) || {};
  const cups = [];
  for (let n = 1; n <= 6; n++) if (f["cup" + n]) cups.push({ name: f["cup" + n], result: f["cup" + n + "result"] || "" });
  const box = { manager: f.manager || f.mgrtitle || "", chairman: f.chairman || "", stadium: f.stadium || "", league: f.league || "", leagueResult: f.leagueresult || "", cups,
    leagueTopScorer: f.leaguetopscorer || "", seasonTopScorer: f.seasontopscorer || "", highestAttendance: f.highestattendance || "", lowestAttendance: f.lowestattendance || "", averageAttendance: f.averageattendance || "", _keys: Object.keys(f) };
  const out = { title, extract: sum.extract || "", thumbnail: sum.thumbnail ? sum.thumbnail.source : "", url: sum.content_urls ? sum.content_urls.desktop.page : "https://en.wikipedia.org/wiki/" + enc, infobox: box };
  const body = JSON.stringify(out);
  ctx.waitUntil(env.MU_CACHE.put(key, body, { expirationTtl: 30 * 86400 }));
  return new Response(body, { headers: headers("upstream") });
}


// ---- Wikipedia club article → JSON (lead + "Infobox football club"), for the club biography pages.
const CLUB_TITLES = { "Yeovil": "Yeovil Town F.C.", "Kettering": "Kettering Town F.C.", "Wimbledon": "Wimbledon F.C.", "Accrington F.C.": "Accrington F.C.", "Loughborough": "Loughborough F.C.", "Nelson": "Nelson F.C.", "Weymouth": "Weymouth F.C.", "Darwen": "Darwen F.C.", "Workington": "Workington A.F.C.", "Rochdale": "Rochdale A.F.C.", "Wrexham": "Wrexham A.F.C.", "Bournemouth": "AFC Bournemouth", "AFC Bournemouth": "AFC Bournemouth", "Sheffield Wednesday": "Sheffield Wednesday F.C.", "Wolverhampton Wanderers": "Wolverhampton Wanderers F.C.", "Manchester United": "Manchester United F.C." };
async function wikiClub(url, env, ctx) {
  const name = (url.searchParams.get("name") || "").trim(); if (!name) return json({ error: "name required" }, 400);
  const key = "wiki:c:v1:" + name.toLowerCase(), cached = url.searchParams.get("debug") ? null : await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  const cands = CLUB_TITLES[name] ? [CLUB_TITLES[name]] : (/F\.C\.$/.test(name) ? [name] : [name + " F.C.", name + " A.F.C.", name]);
  let sum = null, title = "";
  for (const c of cands) {
    const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(c.replace(/ /g, "_")), { headers: UA });
    if (r.ok) { const j = await r.json(); if (j.type !== "disambiguation") { sum = j; title = j.title || c; break; } }
  }
  if (!sum) return json({ error: "no article", tried: cands }, 404);
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const wr = await fetch("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=" + enc, { headers: UA });
  const wj = wr.ok ? await wr.json() : {};
  const wt = wj.parse && wj.parse.wikitext ? wj.parse.wikitext["*"] : "";
  const f = boxFields(wt, /\{\{\s*Infobox football club\b/i) || {};
  const box = { clubname: f.clubname || "", fullname: f.fullname || "", nickname: f.nickname || "", founded: f.founded || "", dissolved: f.dissolved || "", ground: f.ground || f.stadium || "", capacity: f.capacity || "", owner: f.owner || "", chairman: f.chairman || "", manager: f.manager || f.mgr || "", mgrtitle: f.mgrtitle || "", league: f.league || "", season: f.season || "", position: f.position || "", website: f.website || "", _keys: Object.keys(f) };
  const out = { title, description: sum.description || "", extract: sum.extract || "", thumbnail: sum.thumbnail ? sum.thumbnail.source : "", url: sum.content_urls ? sum.content_urls.desktop.page : "https://en.wikipedia.org/wiki/" + enc, infobox: box };
  const body = JSON.stringify(out);
  ctx.waitUntil(env.MU_CACHE.put(key, body, { expirationTtl: 30 * 86400 }));
  return new Response(body, { headers: headers("upstream") });
}
