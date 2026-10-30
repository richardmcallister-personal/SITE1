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
    if (url.pathname.startsWith("/should-i-go")) return Response.redirect(url.origin + "/manutd/trips/", 301);
    if (url.pathname.startsWith("/img/player/")) return portrait(url, ctx);
    if (url.pathname === "/feed") return feed(url, env, ctx);
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
