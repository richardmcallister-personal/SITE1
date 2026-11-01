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
  "/api/match":         { ttl: 21600, live: true, path: (u) => `/fixtures?id=${num(u, "fixture")}` },
  // Every Premier League fixture this season, trimmed to what the league pages need (~380 rows). 20 minutes between refreshes
  // is the cadence for other clubs' games: scores arrive around half-time and full-time, never minute by minute.
  "/api/pl":            { ttl: 1200,  path: () => `/fixtures?league=${LEAGUES.pl}&season=${season()}`, slim: (j) => ({ get: "pl", season: season(), results: (j.response || []).length, response: (j.response || []).map((m) => ({ id: m.fixture.id, date: m.fixture.date, ts: m.fixture.timestamp, st: m.fixture.status.short, min: m.fixture.status.elapsed, venue: m.fixture.venue && m.fixture.venue.name || "", round: m.league.round, home: { id: m.teams.home.id, name: m.teams.home.name, logo: m.teams.home.logo }, away: { id: m.teams.away.id, name: m.teams.away.name, logo: m.teams.away.logo }, goals: m.goals, ht: m.score && m.score.halftime || null })) }) },   // one call: fixture + events + line-ups + stats
  "/api/sidelined":     { ttl: 86400, path: (u) => `/sidelined?player=${num(u, "id")}` },
  "/api/lineups":       { ttl: 86400, path: (u) => `/fixtures/lineups?fixture=${num(u, "fixture")}` },
  "/api/fixture-stats": { ttl: 86400, path: (u) => `/fixtures/statistics?fixture=${num(u, "fixture")}` },
  "/api/events":        { ttl: 86400, path: (u) => `/fixtures/events?fixture=${num(u, "fixture")}` },
  "/api/transfers":     { ttl: 86400, path: () => `/transfers?team=${TEAM}` },
  "/api/team-fixtures": { ttl: 3600,  path: (u) => `/fixtures?team=${num(u, "team")}&season=${season()}&from=${(u.searchParams.get("from") || "").slice(0, 10)}&to=${(u.searchParams.get("to") || "").slice(0, 10)}` },
  "/api/fixture-players": { ttl: 30 * 86400, path: (u) => `/fixtures/players?fixture=${num(u, "fixture")}` },   // only fetched for finished matches
  "/api/season-standings": { ttl: 30 * 86400, path: (u) => `/standings?league=${LEAGUES.pl}&season=${num(u, "season")}` },
  "/api/players-season": { ttl: 30 * 86400, path: (u) => `/players?team=${TEAM}&season=${num(u, "season")}&page=${u.searchParams.get("page") || 1}` },
  "/api/player-season": { ttl: 30 * 86400, path: (u) => `/players?id=${num(u, "id")}&season=${num(u, "season")}` },   // past seasons, for debut lookups
};
function num(u, k) { return String(parseInt(u.searchParams.get(k) || "0", 10) || 0); }

// Warmed every hour by the cron so pages never wait on the API.
const WARM = ["/api/standings", "/api/ucl", "/api/fixtures", "/api/pl", "/api/squad", "/api/injuries", "/api/players?page=1", "/api/players?page=2", "/api/players?page=3"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const WIKI = /(^|\.)manutd\.wiki$/.test(url.hostname);
    if (url.hostname === "www.manutd.wiki") return Response.redirect("https://manutd.wiki" + url.pathname + url.search, 301);
    if (url.pathname.startsWith("/should-i-go")) return Response.redirect(url.origin + (WIKI ? "/trips/" : "/manutd/trips/"), 301);
    const SERVICE = /^\/(api|img|feed|wiki|wiki-season|wiki-club|wiki-raw|wiki-rev|wiki-page|collection|cover|push)(\/|$)|^\/ask$/;   // /ask is the question route; /ask/ is the page
    // Preview deployments (dev.manutd.wiki) carry no key, KV or crons: every data call goes to the live Worker.
    if (env.UPSTREAM && SERVICE.test(url.pathname)) return fetch(new Request(env.UPSTREAM + url.pathname + url.search, request));
    if (WIKI) {
      // Clean URLs on the club domain: the site lives under /manutd/ in the repo; serve it at the root here.
      if (url.pathname.startsWith("/manutd/")) return Response.redirect(url.origin + url.pathname.slice(7) + url.search, 301);
      if (!SERVICE.test(url.pathname)) {
        const inner = new URL(url.toString()); inner.pathname = "/manutd" + (url.pathname === "/" ? "/" : url.pathname);
        const res = await env.ASSETS.fetch(new Request(inner.toString(), request));
        const ct = res.headers.get("content-type") || "";
        if (/text\/html|javascript|application\/json/.test(ct)) {
          let body = (await res.text()).replace(/(["'(])\/manutd\//g, "$1/");
          if (/text\/html/.test(ct)) body = body.replace("<head>", '<head><meta name="mu-country" content="' + ((request.cf && request.cf.country) || "").replace(/[^A-Z]/g, "") + '">');
          const h = new Headers(res.headers); h.delete("content-length");
          if (/text\/html/.test(ct)) h.set("cache-control", "private, max-age=0, must-revalidate");   // carries the visitor's country, so never shared from the edge cache
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
    if (url.pathname === "/wiki-raw") return wikiRaw(url, env, ctx);
    if (url.pathname === "/wiki-rev") return wikiRev(url, env, ctx);
    if (url.pathname === "/wiki-page") return wikiPage(url, env, ctx);
    if (url.pathname === "/cover") return cover(url, env, ctx);
    if (url.pathname === "/ask") { try { return await ask(request, url, env, ctx); } catch (e) { return json({ error: "ask: " + (e && e.message || e) }, 500); } }
    if (url.pathname.startsWith("/push/")) { try { return await push(request, url, env, ctx); } catch (e) { return json({ error: "push: " + (e && e.message || e) }, 500); } }
    if (url.pathname === "/collection") { try { return await collection(request, url, env); } catch (e) { return json({ error: "collection: " + (e && e.message || e) }, 500); } }
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
        const ours = f.teams.home.id === TEAM || f.teams.away.id === TEAM, staleAfter = ours ? 60 : 900;   // other clubs' games: half-time / full-time cadence
        if (inWindow && age > staleAfter) { ctx.waitUntil(refresh(env, key, route, url)); return answer(body, "kv-live-stale", age); } if (inWindow) return answer(body, "kv-live", age); } } catch (e) {}
    }
    if (body && fresh) return answer(body, "kv-hit", age);
    if (body) { ctx.waitUntil(refresh(env, key, route, url)); return answer(body, "kv-stale", age); }

    // Nothing cached yet: fetch now (the first visitor pays once; the cron keeps it warm after that).
    const r = await refresh(env, key, route, url);
    return r.ok ? answer(r.body, "upstream", 0) : new Response(r.body, { status: 200, headers: headers("upstream-error") });
  },

  // Hourly warm-up (wrangler.jsonc → triggers.crons). Sequential, spaced, so it never trips the per-minute cap.
  async scheduled(event, env, ctx) {
    if (event.cron === "* * * * *") { ctx.waitUntil(pushTick(env).catch((e) => console.log("pushTick", e && e.message))); return; }
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
  if (clean && route.slim) { try { body = JSON.stringify(route.slim(JSON.parse(body))); } catch (e) {} }
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
  const out = { title: sum.title || title, description: sum.description || "", extract: sum.extract || "", thumbnail: sum.thumbnail ? sum.thumbnail.source : "", thumb: sum.thumbnail ? { w: sum.thumbnail.width, h: sum.thumbnail.height, ow: sum.originalimage && sum.originalimage.width || 0 } : null, original: sum.originalimage ? sum.originalimage.source : "", url: sum.content_urls ? sum.content_urls.desktop.page : "https://en.wikipedia.org/wiki/" + enc, infobox: box, images };
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


// ---- raw wikitext of one article (cached a day) — used by the build scripts that compile squad numbers.
async function wikiRaw(url, env, ctx) {
  const title = (url.searchParams.get("title") || "").trim(); if (!title) return json({ error: "title required" }, 400);
  const rev = (url.searchParams.get("rev") || "").replace(/\D/g, "");   // build scripts pass the revision they expect, so a changed article is never served from cache
  const key = "wiki:raw:v1:" + title + (rev ? "@" + rev : ""), cached = await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: { "content-type": "text/plain; charset=utf-8", "x-source": "kv-hit" } });
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  const r = await fetch("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=" + encodeURIComponent(title.replace(/ /g, "_")), { headers: UA });
  const j = r.ok ? await r.json() : {};
  const wt = j.parse && j.parse.wikitext ? j.parse.wikitext["*"] : "";
  if (!wt) return json({ error: "no article", title }, 404);
  ctx.waitUntil(env.MU_CACHE.put(key, wt, { expirationTtl: 86400 }));
  return new Response(wt, { headers: { "content-type": "text/plain; charset=utf-8", "x-source": "upstream" } });
}


// Plain article summary (lead paragraph, thumbnail, link) for any title — rivalry articles and the like; a week in KV.
async function wikiPage(url, env, ctx) {
  const title = (url.searchParams.get("title") || "").trim(); if (!title) return json({ error: "title required" }, 400);
  const key = "wiki:pg:v1:" + title, cached = await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")), { headers: UA });
  if (!r.ok) return json({ error: "no article", title }, 404);
  const j = await r.json(), out = { title: j.title, description: j.description || "", extract: j.extract || "", thumbnail: j.thumbnail ? j.thumbnail.source : "", original: j.originalimage ? j.originalimage.source : "", url: j.content_urls ? j.content_urls.desktop.page : "" };
  const body = JSON.stringify(out); ctx.waitUntil(env.MU_CACHE.put(key, body, { expirationTtl: 7 * 86400 }));
  return new Response(body, { headers: headers("upstream") });
}

// Latest revision id for up to 50 titles ("|"-separated), so the build scripts only re-parse articles that have changed.
async function wikiRev(url, env, ctx) {
  const titles = (url.searchParams.get("titles") || "").split("|").map((t) => t.trim()).filter(Boolean).slice(0, 50);
  if (!titles.length) return json({ error: "titles required" }, 400);
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  const r = await fetch("https://en.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&rvprop=ids&redirects=1&titles=" + encodeURIComponent(titles.join("|")), { headers: UA });
  const j = r.ok ? await r.json() : {}, out = {}, back = {};
  for (const x of (j.query && j.query.redirects) || []) back[x.to] = x.from;
  for (const x of (j.query && j.query.normalized) || []) back[x.to] = back[x.to] || x.from;
  for (const p of Object.values((j.query && j.query.pages) || {})) { const rev = p.revisions && p.revisions[0] ? p.revisions[0].revid : null; out[p.title] = rev; if (back[p.title]) out[back[p.title]] = rev; }
  return json(out);
}

// ---- Match alerts: Web Push (RFC 8291 / RFC 8188, VAPID) done with WebCrypto, no library.
// Subscriptions live in KV under push:sub:<sha256 of endpoint>; the VAPID key pair is generated once and kept in KV too.
// A minute cron (pushTick) watches the next fixture from an hour before kick-off to the final whistle and sends
// kick-off reminders, team news, goals, half-time and full-time according to each subscriber's preferences.
const b64u = { enc: (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), dec: (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } };
const cat = (...as) => { const n = as.reduce((t, a) => t + a.length, 0), out = new Uint8Array(n); let o = 0; for (const a of as) { out.set(a, o); o += a.length; } return out; };
const te = (s) => new TextEncoder().encode(s);
async function vapidKeys(env) {
  let j = await env.MU_CACHE.get("push:vapid", "json"); if (j) return j;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  j = { pub: b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey)), priv: await crypto.subtle.exportKey("jwk", kp.privateKey) };
  await env.MU_CACHE.put("push:vapid", JSON.stringify(j)); return j;
}
async function vapidHeader(env, endpoint) {
  const k = await vapidKeys(env), aud = new URL(endpoint).origin;
  const hdr = b64u.enc(te(JSON.stringify({ typ: "JWT", alg: "ES256" }))), body = b64u.enc(te(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:richardmcallister@gmail.com" })));
  const key = await crypto.subtle.importKey("jwk", k.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te(hdr + "." + body));
  return `vapid t=${hdr}.${body}.${b64u.enc(sig)}, k=${k.pub}`;
}
async function hkdf(salt, ikm, info, len) { const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8)); }
async function encryptPayload(sub, payload) {
  const ua = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, shared, cat(te("WebPush: info\0"), ua, localPub), 32);
  const cek = await hkdf(salt, ikm, te("Content-Encoding: aes128gcm\0"), 16), nonce = await hkdf(salt, ikm, te("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(te(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), localPub, ct);   // header: salt | rs=4096 | idlen=65 | local public key
}
async function sendPush(env, rec, msg) {
  const sub = rec.sub, body = await encryptPayload(sub, JSON.stringify(msg));
  const r = await fetch(sub.endpoint, { method: "POST", headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", "ttl": String(msg.ttl || 3600), "urgency": "high", "authorization": await vapidHeader(env, sub.endpoint) }, body });
  if (r.status === 404 || r.status === 410) { await env.MU_CACHE.delete(rec.key); return "gone"; }
  return r.status;
}
async function subKey(endpoint) { const h = await crypto.subtle.digest("SHA-256", te(endpoint)); return "push:sub:" + [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function allSubs(env) {
  const out = []; let cursor;
  do { const l = await env.MU_CACHE.list({ prefix: "push:sub:", cursor }); for (const k of l.keys) { const v = await env.MU_CACHE.get(k.name, "json"); if (v && v.sub) out.push({ key: k.name, ...v }); } cursor = l.list_complete ? null : l.cursor; } while (cursor);
  return out;
}
async function push(request, url, env, ctx) {
  const p = url.pathname;
  if (p === "/push/key") return json({ key: (await vapidKeys(env)).pub });
  if (request.method !== "POST") return json({ error: "POST" }, 405);
  const b = await request.json().catch(() => ({}));
  if (p === "/push/subscribe") {
    if (!b.sub || !b.sub.endpoint || !b.sub.keys) return json({ error: "subscription required" }, 400);
    const prefs = Object.assign({ goals: true, lineups: true, kickoff: true, result: true }, b.prefs || {});
    const key = await subKey(b.sub.endpoint), old = await env.MU_CACHE.get(key, "json");
    await env.MU_CACHE.put(key, JSON.stringify({ sub: b.sub, prefs, created: old ? old.created : Date.now(), seen: Date.now(), ua: (request.headers.get("user-agent") || "").slice(0, 120) }));
    return json({ ok: true, prefs });
  }
  if (p === "/push/unsubscribe") { if (b.endpoint) await env.MU_CACHE.delete(await subKey(b.endpoint)); return json({ ok: true }); }
  if (p === "/push/test") {
    if (!b.endpoint) return json({ error: "endpoint required" }, 400);
    const rec = await env.MU_CACHE.get(await subKey(b.endpoint), "json"); if (!rec) return json({ error: "not subscribed" }, 404);
    const st = await sendPush(env, { key: await subKey(b.endpoint), ...rec }, { title: "Match alerts are on", body: "You'll hear about team news, goals and the final score. This is a test.", url: "/", tag: "test" });
    return json({ ok: st === 201 || st === 200, status: st });
  }
  return json({ error: "unknown" }, 404);
}
// The fixture to watch: the next one not yet finished, from the cached fixture list (no API call outside the match window).
async function pushTick(env) {
  const now = Date.now(); let fx = await load(env, "api:v3:/api/fixtures?v=3");
  if (!fx.body) fx = await load(env, "api:v3:/api/fixtures");
  if (!fx.body) { const r = await refresh(env, "api:v3:/api/fixtures?v=3", ROUTES["/api/fixtures"], new URL("https://site1.local/api/fixtures?v=3")); if (!r.ok) return; fx = { body: r.body }; }
  const list = JSON.parse(fx.body).response || [], next = list.filter((m) => !/FT|AET|PEN|CANC|PST|ABD|AWD|WO/.test(m.fixture.status.short)).sort((a, b) => a.fixture.timestamp - b.fixture.timestamp)[0];
  if (!next) return;
  const ko = next.fixture.timestamp * 1000, id = next.fixture.id;
  if (now < ko - 65 * 60000 || now > ko + 3.5 * 3600000) return;
  const subs = await allSubs(env); if (!subs.length) return;
  const sk = "push:state:" + id, state = (await env.MU_CACHE.get(sk, "json")) || { sent: {} };
  const home = next.teams.home.id === TEAM, opp = (home ? next.teams.away : next.teams.home).name, name = (h, a) => home ? "United " + h + "–" + a + " " + opp : opp + " " + h + "–" + a + " United";
  const out = []; const fan = (pref, msg) => out.push({ pref, msg: Object.assign({ url: "/match/?id=" + id, tag: "m" + id, ko: next.fixture.date, opp, home, comp: next.league.name }, msg) });
  // kick-off reminder, an hour before
  if (!state.sent.kickoff && now >= ko - 62 * 60000 && now < ko - 45 * 60000) { state.sent.kickoff = 1; fan("kickoff", { title: (home ? "United v " + opp : opp + " v United") + " in an hour", body: next.league.name + " · " + (next.fixture.venue && next.fixture.venue.name || ""), kind: "kickoff" }); }
  // live detail: one feed call a minute, shared with the match page's cache
  const key = "api:v3:/api/match?fixture=" + id + "&v=3", route = ROUTES["/api/match"]; let m = await load(env, key);
  if (!m.body || m.age > 50) { const r = await refresh(env, key, route, new URL("https://site1.local/api/match?fixture=" + id + "&v=3")); if (r.ok) m = { body: r.body }; }
  const f = m.body ? (JSON.parse(m.body).response || [])[0] : null;
  if (f) {
    const st = f.fixture.status.short, g = f.goals;
    if (!state.sent.lineups && (f.lineups || []).length === 2) {
      state.sent.lineups = 1; const us = f.lineups.find((l) => l.team.id === TEAM);
      if (us) fan("lineups", { title: "Team news: United XI", body: (us.formation ? us.formation + " · " : "") + us.startXI.map((x) => x.player.name.split(" ").pop()).join(", "), kind: "lineups" });
    }
    // Goal events reconciled against the official score: the feed logs a goal as soon as the ball goes in; if VAR rules it
    // out the event can stay (usually with no scorer) while f.goals never moves. Only goals the score counts are sent,
    // so a goal is announced on the first tick the score corroborates it, and a disallowed one never is.
    const GE = (f.events || []).filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty" && e.time && e.time.elapsed != null);
    for (const [t, allowed] of [[f.teams.home, g.home], [f.teams.away, g.away]]) {
      const mine = GE.filter((e) => e.team.id === t.id); mine.forEach((e) => { e.ok = true; });
      const extra = mine.length - (allowed == null ? mine.length : allowed);
      if (extra > 0) mine.filter((e) => !(e.player && e.player.name)).concat(mine.filter((e) => e.player && e.player.name).reverse()).slice(0, extra).forEach((e) => { e.ok = false; });
    }
    for (const e of GE) {
      if (!e.ok) continue;
      const eid = "g" + e.team.id + "-" + (e.player && e.player.id) + "-" + e.time.elapsed + "+" + (e.time.extra || 0);
      if (state.sent[eid]) continue; state.sent[eid] = 1;
      const us = e.team.id === TEAM, minute = e.time.elapsed + (e.time.extra ? "+" + e.time.extra : "") + "'";
      // running score after this goal, counted from the events so far
      const sofar = GE.filter((x) => x.ok && (x.time.elapsed < e.time.elapsed || (x.time.elapsed === e.time.elapsed && (x.time.extra || 0) <= (e.time.extra || 0)))), hg = sofar.filter((x) => x.team.id === f.teams.home.id).length, ag = sofar.length - hg;
      fan("goals", { title: (us ? "GOAL! " : "") + name(hg, ag), body: (e.player && e.player.name || "") + " " + minute + (e.detail === "Penalty" ? " (pen)" : e.detail === "Own Goal" ? " (og)" : "") + (e.assist && e.assist.name ? " · assist " + e.assist.name : ""), kind: us ? "goal" : "goal-against" });
    }
    if (!state.sent.ht && st === "HT") { state.sent.ht = 1; fan("result", { title: "Half-time: " + name(g.home, g.away), body: next.league.name, kind: "ht" }); }
    if (!state.sent.ft && /FT|AET|PEN/.test(st)) { state.sent.ft = 1; const pen = st === "PEN" && f.score && f.score.penalty ? " · " + f.score.penalty.home + "–" + f.score.penalty.away + " on penalties" : ""; const w = g.home === g.away ? (st === "PEN" ? "" : "Draw") : ((g.home > g.away) === home ? "United win" : "United lose"); fan("result", { title: "Full-time: " + name(g.home, g.away) + (st === "AET" ? " (aet)" : ""), body: (w ? w + pen + " · " : "") + next.league.name, kind: "ft", ttl: 86400 }); }
  }
  await env.MU_CACHE.put(sk, JSON.stringify(state), { expirationTtl: 2 * 86400 });
  for (const o of out) for (const s of subs) { if (s.prefs && s.prefs[o.pref] === false) continue; try { await sendPush(env, s, o.msg); } catch (e) { console.log("push fail", e && e.message); } }
}

// ---- Shirt collection: owned / wishlist / notes, stored in KV under a hash of the owner's passphrase.
// GET  /collection?key=…         → the saved collection (or an empty one)
// PUT  /collection?key=…  body   → replace it (JSON, 64 KB max)
async function collection(request, url, env) {
  const key = (url.searchParams.get("key") || "").trim();
  if (key.length < 6) return json({ error: "a collection key of at least 6 characters is required" }, 400);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mu-collection:" + key));
  const id = "col:v1:" + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,OPTIONS", "access-control-allow-headers": "content-type", "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > 65536) return new Response(JSON.stringify({ error: "too large" }), { status: 413, headers: cors });
    try { const j = JSON.parse(body); if (!j || typeof j !== "object" || !Array.isArray(j.owned) || !Array.isArray(j.wish)) throw 0; } catch (e) { return new Response(JSON.stringify({ error: "expected {owned:[],wish:[],notes:{}}" }), { status: 400, headers: cors }); }
    await env.MU_CACHE.put(id, body);
    return new Response(JSON.stringify({ ok: true, saved: new Date().toISOString() }), { headers: cors });
  }
  const cur = await env.MU_CACHE.get(id);
  return new Response(cur || JSON.stringify({ owned: [], wish: [], notes: {}, updated: null }), { headers: cors });
}


// ---- Cover art lookup for the bookshelf: Open Library (books), Wikipedia page image (films, documentaries), Apple podcast directory (shows).
async function cover(url, env, ctx) {
  const type = url.searchParams.get("type") || "book", q = (url.searchParams.get("q") || "").trim(), by = (url.searchParams.get("by") || "").trim();
  if (!q) return json({ error: "q required" }, 400);
  const key = "cover:v2:" + type + ":" + (q + "|" + by).toLowerCase(), cached = await env.MU_CACHE.get(key);
  if (cached) return new Response(cached, { headers: headers("kv-hit") });
  const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" };
  let out = { url: "", src: "" };
  try {
    if (type === "book") {
      const main = q.split(/[:—]/)[0].trim(), surname = by ? by.split(/ with | and /)[0].trim().split(" ").pop() : "";
      const tries = [[main, surname], [q, surname], [main, ""]];
      for (const t of tries) {
        const r = await fetch("https://openlibrary.org/search.json?limit=5&fields=key,title,cover_i,author_name,first_publish_year&title=" + encodeURIComponent(t[0]) + (t[1] ? "&author=" + encodeURIComponent(t[1]) : ""), { headers: UA });
        const j = r.ok ? await r.json() : {}; const hit = (j.docs || []).filter((d) => d.cover_i)[0];
        if (hit) { out = { url: "https://covers.openlibrary.org/b/id/" + hit.cover_i + "-M.jpg", src: "Open Library", title: hit.title }; break; }
      }
    } else if (type === "pod") {
      const r = await fetch("https://itunes.apple.com/search?media=podcast&limit=3&term=" + encodeURIComponent(q), { headers: UA });
      const j = r.ok ? await r.json() : {}; const hit = (j.results || [])[0];
      if (hit) out = { url: (hit.artworkUrl600 || hit.artworkUrl100 || "").replace("100x100", "600x600"), src: "Apple Podcasts", title: hit.collectionName };
    } else {
      // Wikipedia: search for the film/documentary article, then take its lead image.
      const sr = await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=" + encodeURIComponent(q + " " + (url.searchParams.get("hint") || "film")), { headers: UA });
      const sj = sr.ok ? await sr.json() : {};
      for (const hit of (sj.query && sj.query.search || []).slice(0, 3)) {
        const pr = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(hit.title.replace(/ /g, "_")), { headers: UA }); const pj = pr.ok ? await pr.json() : {};
        if (pj.type !== "disambiguation" && pj.thumbnail) { out = { url: pj.originalimage && pj.originalimage.width < 1200 ? pj.originalimage.source : pj.thumbnail.source, src: "Wikipedia", title: pj.title, page: pj.content_urls ? pj.content_urls.desktop.page : "" }; break; }
      }
    }
  } catch (e) { out.error = String(e); }
  const body = JSON.stringify(out);
  ctx.waitUntil(env.MU_CACHE.put(key, body, { expirationTtl: (out.url ? 30 : 1) * 86400 }));
  return new Response(body, { headers: headers("upstream") });
}

// ---- Ask the archive: a question answered from this site's own data by Claude, with the pages it used.
// POST /ask {q} (or GET /ask?q=). Grounding: the search index picks the entities the question is about, their JSON is
// compacted into a context, the live table/fixtures are added when the question is about now, and the model is told to
// answer only from that. Caps: ASK_DAILY_CAP questions a day site-wide (default 300), 20 an hour per visitor; answers are
// cached for a week keyed on the normalised question. Needs the ANTHROPIC_API_KEY secret; without it the route says so.
const ASK = { model: "claude-haiku-5-5", maxTokens: 700, perHour: 20, cacheDays: 7 };
let ASSET_CACHE = {};   // per-isolate memo of the small JSON files
async function assetJSON(env, path) {
  if (ASSET_CACHE[path] !== undefined) return ASSET_CACHE[path];
  try { const r = await env.ASSETS.fetch(new Request("https://site1.local/manutd" + path)); if (!r.ok) return (ASSET_CACHE[path] = null); const j = await r.json(); if (Object.keys(ASSET_CACHE).length > 400) ASSET_CACHE = {}; return (ASSET_CACHE[path] = j); } catch (e) { return null; }
}
async function wikiBrief(env, ctx, title) {   // the article lead and infobox the profile pages show, from the same 7-day KV cache
  try { const r = await wiki(new URL("https://site1.local/wiki?title=" + encodeURIComponent(title)), env, ctx); const j = await r.json(); if (!j || !j.extract) return "";
    const ib = j.infobox && typeof j.infobox === "object" ? j.infobox : {}, tbl = (a) => Array.isArray(a) ? a.map((r) => `${r.years || ""} ${r.clubs || r.team || ""}${r.caps ? " " + r.caps + " apps" : ""}${r.goals ? " " + r.goals + " goals" : ""}`.trim()).join(", ") : "";
    const box = Object.entries(ib).filter(([k, v]) => k !== "_keys" && v && typeof v === "string" && v.length < 160).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v.replace(/\s+/g, " ")}`).concat(ib.youth ? ["youth: " + tbl(ib.youth)] : [], ib.clubs ? ["clubs (league apps/goals): " + tbl(ib.clubs)] : [], ib.national ? ["national team: " + tbl(ib.national)] : [], ib.manager ? ["managed: " + tbl(ib.manager)] : []).join("; ");
    return `WIKIPEDIA (${j.title}): ${String(j.extract).replace(/\s+/g, " ").slice(0, 1100)}${box ? "\nInfobox: " + box : ""}`; } catch (e) { return ""; }
}
async function wikiTopic(env, ctx, q) {   // when the question names nothing the site has a page for: the best-matching Wikipedia article
  try {
    const STOPW = /\b(what|why|when|where|who|how|which|did|does|do|is|are|was|were|the|a|an|of|in|on|at|to|for|and|or|happened|called|about|tell|me|explain|get|got|their|its|our|we|us|united|utd|man|manchester|club|team)\b/gi;
    const terms = q.replace(/[?!.,'"]/g, " ").replace(STOPW, " ").replace(/\s+/g, " ").trim(); if (terms.length < 4) return "";
    const k = "ask:ws:v5:" + (await sha(foldQ(terms))).slice(0, 24); let title = await env.MU_CACHE.get(k);
    if (title == null) {
      const UA = { "user-agent": "site1-manutd-hub/1.0 (richardmcallister@gmail.com)", "accept": "application/json" }, words = foldQ(terms).split(" ").filter((w) => w.length >= 4);
      const search = async (qq) => { const r = await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent(qq), { headers: UA }); const j = await r.json().catch(() => null); return j && j.query && j.query.search || []; };
      const good = (list) => list.find((h) => { const t = foldQ(h.title); return words.some((w) => t.includes(w)); });   // the title must share a word with the question
      if (/red devil|nickname|crest|badge|anthem|founded|history of (the )?club|club history|who owns|owner|glazer|ineos|ratcliffe/i.test(q)) title = "Manchester United F.C.";   // questions about the club itself
      else if (/old trafford|theatre of dreams|stadium|ground/i.test(q) && !/away|ground guide/i.test(q)) title = "Old Trafford";
      else { const hit = good(await search(terms + " Manchester United")) || good(await search(terms)); title = hit ? hit.title : ""; }
      ctx.waitUntil(env.MU_CACHE.put(k, title, { expirationTtl: 7 * 86400 }));
    }
    if (!title) return "";
    const r = await wikiPage(new URL("https://site1.local/wiki-page?title=" + encodeURIComponent(title)), env, ctx), j = await r.json();   // plain article summary, any subject
    return j && j.extract ? `WIKIPEDIA (${j.title}): ${String(j.extract).replace(/\s+/g, " ").slice(0, 1400)}` : "";
  } catch (e) { return ""; }
}
function foldQ(t) { return String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/ß/g, "ss").toLowerCase(); }
async function sha(s) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const STOP = new Set("the a an of in on at to for and or is was were did do does how many much who what when where which with against vs v united man manchester utd club season seasons ever all time first last best worst most ever".split(" "));
function pickEntities(idx, q) {
  const terms = foldQ(q).replace(/[^a-z0-9\s\/–-]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
  const years = (q.match(/\b(18|19|20)\d{2}\b/g) || []);
  const out = [];
  for (const e of idx) {
    const f = foldQ(e[0]), fa = (e[4] || []).map(foldQ), k = e[1]; let sc = 0;
    for (const t of terms) { if (f === t) sc += 100; else if (f.split(/[\s,]+/).includes(t)) sc += (t.length >= 4 || k === "player" || k === "manager") ? 70 : 20; else if (fa.some((a) => a === t)) sc += 80; else if (f.startsWith(t) && t.length > 3) sc += 40; }   // a three-letter word ("red") should not pull in a club on its own
    if (k === "season") { if (years.some((y) => f.startsWith(y) || fa.includes(y))) sc += 90; else if (sc < 100) sc = 0; }   // a season only when a year is named
    if (sc) { if (k === "player" || k === "manager") sc += 30; else if (k === "club") sc += 15; else if (k === "kit") sc -= 70; else if (/^(book|doc|film|pod|page)$/.test(k)) sc -= 40; out.push({ e, sc }); }
  }
  out.sort((a, b) => b.sc - a.sc);
  const seen = {}, top = [];
  const best = out.length ? out[0].sc : 0, floor = Math.max(70, Math.round(best * 0.6));
  for (const x of out) { if (x.sc < floor) break; const key = x.e[1] + ":" + x.e[2]; if (seen[key]) continue; seen[key] = 1; top.push(x.e); if (top.length >= 6) break; }
  top.best = best;   // < 100 means nothing matched a whole name, only a word of one ("Munich" → Bayern Munich)
  return top;
}
function res(r) { return `${r.d} ${r.c}${r.r ? " " + r.r : ""} ${r.h ? "v" : r.n === true ? "v" : "at"} ${r.o}${r.n === true ? " (neutral venue" + (typeof r.v === "string" ? ", " + r.v : "") + ")" : typeof r.n === "string" ? " at " + r.n : ""} ${r.gf}-${r.ga}${r.aet ? " aet" : ""}${r.pens ? " (pens " + r.pens + ")" : ""}${r.sc ? " [" + r.sc.map((s) => s[0] + (s[2] > 1 ? " " + s[2] : "") + (s[3] && s[3].includes("p") ? " pen" : "") + (s[3] && s[3].includes("o") ? " og" : "")).join(", ") + "]" : ""}`; }
async function contextFor(env, ctx, ents, q) {
  const parts = [], sources = [];
  const pidx = await assetJSON(env, "/history/players_index.json") || [];
  for (const e of ents) {
    const [title, kind, url] = e;
    if (kind === "player") {
      const t = decodeURIComponent((url.match(/p=([^&]+)/) || [])[1] || ""), row = pidx.find((r) => r.t === t);
      const p = row ? await assetJSON(env, "/history/players/" + row.slug + ".json") : null;
      if (p) {
        const seasons = Object.keys(p.seasons || {}).sort().map((s) => { const r = p.seasons[s]; return `${s}: ${r.apps != null ? r.apps + " apps, " : ""}${r.goals || 0} goals${r.no && r.no.length ? ", no. " + r.no.join("/") : ""}${r.bycomp ? " (" + Object.entries(r.bycomp).map(([c, n]) => c + " " + n).join(", ") + ")" : ""}`; });
        const big = (p.goals || []).filter((g) => g.g >= 2).slice(-12).map((g) => `${g.d} ${g.g} v ${g.o} (${g.c}, ${g.gf}-${g.ga})`);
        parts.push(`PLAYER ${p.name} — United ${p.first} to ${p.last}; ${p.apps != null ? p.apps + " appearances (squad lists from 1993-94), " : "appearances not in the archive (pre-1993-94), "}${p.total_goals} goals in the archive${p.gaps && p.gaps.length ? " (archive incomplete: " + p.gaps.length + " scoring match(es) in his seasons have no scorers recorded, so the total may be low)" : ""}; hat-tricks ${p.hat_tricks.length}; shirt numbers ${(p.nos || []).join(", ") || "n/a"}; managers ${(p.managers || []).map((m) => m.name).join(", ")}.\nSeason by season: ${seasons.join("; ")}\n${big.length ? "Multi-goal games (latest): " + big.join("; ") : ""}\n${(p.finals || []).length ? "Finals: " + p.finals.map((f) => `${f.d.slice(0, 4)} ${f.comp} v ${f.o} ${f.gf}-${f.ga} (${f.start ? "started" : "bench"})`).join("; ") : ""}`);
        sources.push({ t: p.name, u: url.replace("/manutd/", "/") });
        const wb = await wikiBrief(env, ctx, p.title || p.name); if (wb) parts.push(wb);
      }
    } else if (kind === "manager") {
      const slug = (url.match(/m=([^&]+)/) || [])[1], ms = await assetJSON(env, "/history/managers.json") || [], m = ms.find((x) => x.slug === slug);
      if (m) { parts.push(`MANAGER ${m.name}${m.role ? " (" + m.role + ")" : ""} — ${m.from} to ${m.to || "present"}; record P${m.rec.p} W${m.rec.w} D${m.rec.d} L${m.rec.l}; honours: ${(m.honours || []).join(", ") || "none"}; seasons: ${(m.seasons || []).map((s) => `${s.id}${s.pos ? " " + s.pos + (s.div ? " in " + s.div : "") : ""}`).join(", ")}${m.notes ? "; " + m.notes : ""}`); sources.push({ t: m.name, u: url.replace("/manutd/", "/") }); const wb = await wikiBrief(env, ctx, m.wiki && typeof m.wiki === "string" ? m.wiki : m.name); if (wb) parts.push(wb); }
    } else if (kind === "club") {
      const name = decodeURIComponent((url.match(/c=([^&]+)/) || [])[1] || ""), clubs = await assetJSON(env, "/history/clubs.json") || [], c = clubs.find((x) => x.name === name);
      const cj = c ? await assetJSON(env, "/history/clubs/" + c.slug + ".json") : null;
      if (c) {
        const ms = (cj && cj.matches || []), big = ms.filter((r) => r.gf - r.ga >= 4).slice(-6), bad = ms.filter((r) => r.ga - r.gf >= 3).slice(-4);
        const tally = (list) => { const t = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }; for (const r of list) { t.p++; t.gf += r.gf; t.ga += r.ga; if (r.gf > r.ga) t.w++; else if (r.gf < r.ga) t.l++; else t.d++; } return `P${t.p} W${t.w} D${t.d} L${t.l} (${t.gf}-${t.ga})`; };
        const home = ms.filter((r) => r.h), away = ms.filter((r) => !r.h && r.n !== true), neutral = ms.filter((r) => !r.h && r.n === true), league = ms.filter((r) => r.c === "L"), lastAway = away.slice(-8), lastHome = home.slice(-8), awayWins = away.filter((r) => r.gf > r.ga).slice(-5);
        parts.push(`OPPONENT ${c.name} — ${c.p} meetings ${c.first}–${c.last}: United W${c.w} D${c.d} L${c.l} (all competitions, United-first scores).\nAt Old Trafford / United home: ${tally(home)}. Away at ${c.name}: ${tally(away)}${neutral.length ? ". Neutral venues: " + tally(neutral) : ""}. League only: ${tally(league)}.\nLast 8 away: ${lastAway.map(res).join("; ")}\nLast 8 home: ${lastHome.map(res).join("; ")}\nMost recent United away wins: ${awayWins.map(res).join("; ") || "none in the archive"}\nLast 10 meetings: ${ms.slice(-10).map(res).join("; ")}\n${big.length ? "Big United wins: " + big.map(res).join("; ") : ""}\n${bad.length ? "Heavy defeats: " + bad.map(res).join("; ") : ""}`);
        sources.push({ t: c.name, u: url.replace("/manutd/", "/") });
        try { const pl = await load(env, "api:v3:/api/pl?v=3"); if (pl.body) { const fold = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), me = fold(c.name), rows = JSON.parse(pl.body).response.filter((m) => [m.home, m.away].some((t) => { const n = fold(t.name); return n === me || me.includes(n) || n.includes(me); })).sort((a, b) => a.ts - b.ts);
          if (rows.length) parts.push(`${c.name} THIS SEASON (Premier League, all their games; home team first): ` + rows.map((m) => `${m.date.slice(0, 10)} ${m.home.name} ${m.goals.home != null ? m.goals.home + "-" + m.goals.away : "v"} ${m.away.name}${/1H|HT|2H/.test(m.st) ? " (in play)" : m.st === "NS" ? "" : " (" + m.st + ")"}`).join("; ")); } } catch (e) {}
      }
    } else if (kind === "season") {
      const id = (url.match(/s=([^&]+)/) || [])[1], d = await assetJSON(env, "/history/data/" + id + ".json"), all = await assetJSON(env, "/history/seasons.json") || [], w = all.find((x) => x.id === id), cups = (await assetJSON(env, "/history/cups.json") || []).filter((r) => r.s === id && r.c !== "FAC");
      if (d) {
        parts.push(`SEASON ${d.title}${d.club ? " (" + d.club + ")" : ""} — ${d.div || "no league"}${d.pos ? ", finished " + d.pos + " of " + d.teams : ""}; P${d.p} W${d.w} D${d.d} L${d.l} GF${d.gf} GA${d.ga}${d.pts != null ? " pts " + d.pts : ""}; FA Cup: ${d.fac || "n/a"}${d.facWon ? " (won)" : ""}.${w ? ` Manager ${w.manager || "?"}; captain ${w.captain || "?"}; trophies: ${(w.trophies || []).join(", ") || "none"}; top scorer ${w.scorer || "?"}. ${w.summary || ""}` : ""}\nLeague and FA Cup results: ${(d.results || []).map(res).join("; ")}${cups.length ? "\nOther cups (League Cup, Europe, Shield; United-first scores): " + cups.map(res).join("; ") : ""}`);
        sources.push({ t: d.title + " season", u: url.replace("/manutd/", "/") });
      }
    }
  }
  if (/record|most|biggest|longest|fewest|highest|lowest|best|worst|streak|run|unbeaten|ever|history|all[- ]time|top scorer|goalscor/i.test(q)) {
    const r = await assetJSON(env, "/history/records.json");
    if (r) { const top = (a, n) => (a || []).slice(0, n), sc = r.scorers || {}, run = (k) => (r.runs && r.runs[k] || []).slice(0, 2).map((x) => `${x.n} games ${x.fr} to ${x.to} (W${x.w} D${x.d} L${x.l})`).join("; "), sea = (k) => (r.seasons && r.seasons[k] || []).slice(0, 3).map((x) => `${x.s} ${x.div}: ${x.gf} for, ${x.ga} against, ${x.pts != null ? x.pts + " pts, " : ""}finished ${x.pos}`).join("; ");
      parts.push(`RECORDS (archive, competitive matches; Shields and Super Cups excluded from win/defeat records):\nBiggest wins: ${top(r.wins, 6).map(res).join("; ")}\nHeaviest defeats: ${top(r.defeats, 5).map(res).join("; ")}\nLongest unbeaten: ${run("unbeaten")}. Longest winning: ${run("winning")}. Longest winless: ${run("winless")}. Longest losing: ${run("losing")}. Consecutive clean sheets: ${run("cleansheets")}.\nMost goals in a league season: ${sea("most_goals")}. Fewest conceded: ${sea("fewest_conceded")}. Most points: ${sea("most_points")}. Worst seasons: ${sea("worst_pct")}.\nAll-time scorers (archive): ${top(sc.alltime, 15).map((x) => `${x.n} ${x.g}${x.apps ? " in " + x.apps + " apps" : ""} (${x.first}–${x.last})`).join(", ")}\nMost hat-tricks: ${top(sc.hat_tricks, 8).map((x) => `${x.n} ${x.ht}`).join(", ")}\nMost goals in one season: ${top(sc.season, 6).map((x) => `${x.n} ${x.g} in ${x.s}`).join(", ")}\nBiggest hauls in a match: ${top(sc.biggest_hauls, 5).map((x) => `${x.t} ${x.g} v ${x.o} ${x.d}`).join(", ")}\nTitles: ${JSON.stringify((r.seasons && r.seasons.titles || []).map((x) => x.s))}`); sources.push({ t: "Records", u: "/history/records/" }); }
  }
  if (/this season|current|now|today|tonight|table|standing|next|fixture|upcoming|injur|squad|form|latest|last match|recent|who plays|kick/i.test(q)) {
    const st = await load(env, "api:v3:/api/standings?v=3"), fx = await load(env, "api:v3:/api/fixtures?v=3");
    try { if (st.body) { const rows = JSON.parse(st.body).response[0].league.standings[0]; parts.push("PREMIER LEAGUE TABLE NOW: " + rows.map((x) => `${x.rank}. ${x.team.name} P${x.all.played} ${x.points}pts GD${x.goalsDiff > 0 ? "+" : ""}${x.goalsDiff}`).join("; ")); sources.push({ t: "Season", u: "/season/" }); } } catch (e) {}
    try { const inj = await load(env, "api:v3:/api/injuries?v=3"); if (inj.body) { const rows = (JSON.parse(inj.body).response || []).filter((x) => x.fixture && x.fixture.date).sort((a, b) => b.fixture.date.localeCompare(a.fixture.date)); const seen = {}, L = []; for (const x of rows) { if (seen[x.player.id]) continue; seen[x.player.id] = 1; if (new Date(x.fixture.date) > Date.now() - 7 * 864e5) L.push(`${x.player.name} (${x.player.type}${x.player.reason ? ", " + x.player.reason : ""}, flagged for ${x.fixture.date.slice(0, 10)})`); } if (L.length) parts.push("INJURY LIST FROM THE FEED (newest flag per player; a player flagged then seen in a line-up has returned): " + L.join("; ")); } } catch (e) {}
    try { if (fx.body) { const all = JSON.parse(fx.body).response.filter((m) => !/riendl/.test(m.league.name)).sort((a, b) => a.fixture.timestamp - b.fixture.timestamp); const done = all.filter((m) => /FT|AET|PEN/.test(m.fixture.status.short)).slice(-6), next = all.filter((m) => m.fixture.status.short === "NS").slice(0, 6); const line = (m) => `${m.fixture.date.slice(0, 10)} ${m.teams.home.name} ${m.goals.home != null ? m.goals.home + "-" + m.goals.away : "v"} ${m.teams.away.name} (${m.league.name})`; parts.push("RECENT RESULTS: " + done.map(line).join("; ") + "\nNEXT FIXTURES (UTC dates): " + next.map(line).join("; ")); } } catch (e) {}
  }
  if (/red devil|nickname|crest|badge|anthem|founded|history|origin|old trafford|stadium|ground|owner|owns|ownership|owned|glazer|ineos|ratcliffe|munich|busby babes|treble|rival|derby|carrington|the cliff|stretford|why|called|named/i.test(q)) {
    const fx = await assetJSON(env, "/history/facts.json"); if (fx && fx.facts) { parts.push("CLUB FACTS (curated from the Wikipedia club article):\n- " + fx.facts.join("\n- ")); sources.push({ t: "History", u: "/history/" }); }
  }
  if (!ents.some((e) => (e[1] === "player" || e[1] === "manager" || e[1] === "club") && (ents.best || 0) >= 100) || /happened|history|story|disaster|tragedy|why|origin|nickname|founded|named/i.test(q)) { const wt = await wikiTopic(env, ctx, q); if (wt) { parts.push(wt); const m = wt.match(/^WIKIPEDIA \(([^)]+)\)/); if (m) sources.push({ t: m[1] + " (Wikipedia)", u: "https://en.wikipedia.org/wiki/" + encodeURIComponent(m[1].replace(/ /g, "_")) }); } }
  return { context: parts.join("\n\n"), sources };
}
async function ask(request, url, env, ctx) {
  const q = String((request.method === "POST" ? ((await request.json().catch(() => ({}))).q) : url.searchParams.get("q")) || "").trim().replace(/\s+/g, " ");
  if (q.length < 3 || q.length > 300) return json({ error: "Ask a question of 3 to 300 characters." }, 400);
  if (!env.ANTHROPIC_API_KEY) {   // not configured: show what would be sent (the site's own data) so the retrieval can be checked
    if (url.searchParams.get("debug") === "context") { const idx = await assetJSON(env, "/search.json") || [], ents = pickEntities(idx, q), c = await contextFor(env, ctx, ents, q); return json({ entities: ents.map((e) => e[1] + ": " + e[0]), chars: c.context.length, sources: c.sources, context: c.context }); }
    return json({ error: "Ask isn't switched on yet — the site owner needs to add the API key." }, 503);
  }
  if (url.searchParams.get("debug") === "topic") { const idx0 = await assetJSON(env, "/search.json") || [], e0 = pickEntities(idx0, q), wt = await wikiTopic(env, ctx, q); return json({ entities: e0.map((e) => e[1] + ": " + e[0]), best: e0.best || 0, topic: wt.slice(0, 300) }); }
  const key = "ask:a:v7:" + (await sha(foldQ(q).replace(/[^a-z0-9]+/g, " ").trim()));
  const hit = await env.MU_CACHE.get(key, "json"); if (hit) return json(Object.assign({ cached: true }, hit));
  const now = new Date(), day = now.toISOString().slice(0, 10), hour = now.toISOString().slice(0, 13);
  const ip = request.headers.get("cf-connecting-ip") || "", ipk = "ask:ip:" + (await sha("ask:" + ip)).slice(0, 16) + ":" + hour, dayk = "ask:day:" + day;
  const used = parseInt((await env.MU_CACHE.get(ipk)) || "0", 10), today = parseInt((await env.MU_CACHE.get(dayk)) || "0", 10), cap = parseInt(env.ASK_DAILY_CAP || "300", 10);
  if (used >= ASK.perHour) return json({ error: "That's plenty for one hour — try again a bit later." }, 429);
  if (today >= cap) return json({ error: "The archive has answered its quota of questions for today. Back tomorrow." }, 429);
  const idx = await assetJSON(env, "/search.json") || [], ents = pickEntities(idx, q), { context, sources } = await contextFor(env, ctx, ents, q);
  const system = `You answer questions about Manchester United for manutd.wiki, a fan-built club hub. Today is ${day}. Use ONLY the DATA below, which comes from the site's archive (Wikipedia-derived season tables and squad lists) and its live feed. Rules: answer in plain English in at most 110 words, as plain text — no markdown, no asterisks, no headings or bullet lists; give the figures the data supports and say which season or match they come from; if the data does not cover the question, say what the site does not hold rather than guessing or using outside knowledge; never invent players, scores or dates; archive goal totals are "in the archive" figures, and appearances exist only from 1993-94. Scores in the data are United-first unless shown as "Home X-Y Away".`;
  const body = { model: env.ASK_MODEL || ASK.model, max_tokens: ASK.maxTokens, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: `DATA:\n${context || "(no matching data on the site)"}\n\nQUESTION: ${q}` }] };
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "The model didn't answer (" + r.status + ")." }, 502);
  const answer = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  const out = { answer, sources, q, usage: j.usage ? { in: j.usage.input_tokens, out: j.usage.output_tokens } : undefined, stop: j.stop_reason };
  if (!answer) return json({ error: "The model returned no text (" + (j.stop_reason || "no stop reason") + ").", stop: j.stop_reason, raw: JSON.stringify(j).slice(0, 400) }, 502);
  ctx.waitUntil(Promise.all([env.MU_CACHE.put(key, JSON.stringify(out), { expirationTtl: ASK.cacheDays * 86400 }), env.MU_CACHE.put(ipk, String(used + 1), { expirationTtl: 3600 }), env.MU_CACHE.put(dayk, String(today + 1), { expirationTtl: 2 * 86400 })]));
  return json(out);
}
