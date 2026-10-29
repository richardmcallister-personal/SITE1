// SITE1 Worker: serves the Hugo build from ./public and proxies a small set of
// API-Football endpoints under /api/* for the Should I Go? page.
// The API key lives in the API_FOOTBALL_KEY secret (wrangler secret put API_FOOTBALL_KEY).
// Responses are cached at the edge for an hour (Cache API), so the free daily quota is safe.

const TEAM = 33;          // Manchester United
const LEAGUES = { pl: 39, ucl: 2, fa: 45, efl: 48 };
const API = "https://v3.football.api-sports.io";
const TTL = 3600;         // seconds

function season(now = new Date()) {
  // API-Football labels 2026/27 as 2026 (season starts in July/August)
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
}

const ROUTES = {
  "/api/fixtures":  () => `/fixtures?team=${TEAM}&season=${season()}`,
  "/api/standings": () => `/standings?league=${LEAGUES.pl}&season=${season()}`,
  "/api/ucl":       () => `/standings?league=${LEAGUES.ucl}&season=${season()}`,
  "/api/squad":     () => `/players/squads?team=${TEAM}`,
  "/api/injuries":  () => `/injuries?team=${TEAM}&season=${season()}`,
  "/api/players":   (u) => `/players?team=${TEAM}&season=${season()}&page=${u.searchParams.get("page") || 1}`,
  "/api/player":    (u) => `/players?id=${encodeURIComponent(u.searchParams.get("id") || "")}&season=${u.searchParams.get("season") || season()}`,
  "/api/sidelined": (u) => `/sidelined?player=${encodeURIComponent(u.searchParams.get("id") || "")}`,
  "/api/lineups":   (u) => `/fixtures/lineups?fixture=${encodeURIComponent(u.searchParams.get("fixture") || "")}`,
  "/api/fixture-stats": (u) => `/fixtures/statistics?fixture=${encodeURIComponent(u.searchParams.get("fixture") || "")}`,
  "/api/events":    (u) => `/fixtures/events?fixture=${encodeURIComponent(u.searchParams.get("fixture") || "")}`,
  "/api/status":    () => `/status`,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "unknown route" }, 404);
    if (!env.API_FOOTBALL_KEY) return json({ error: "API_FOOTBALL_KEY secret not set on the Worker" }, 500);

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    // Keys from dashboard.api-football.com use the api-sports host; keys from RapidAPI use theirs.
    // Try the direct host first and fall back to RapidAPI if the key is rejected.
    let upstream = await fetch(API + route(url), {
      headers: { "x-apisports-key": env.API_FOOTBALL_KEY },
      cf: { cacheTtl: 0 },
    });
    let body = await upstream.text();
    if (/Invalid API key/i.test(body)) {
      upstream = await fetch("https://api-football-v1.p.rapidapi.com/v3" + route(url), {
        headers: { "x-rapidapi-key": env.API_FOOTBALL_KEY, "x-rapidapi-host": "api-football-v1.p.rapidapi.com" },
        cf: { cacheTtl: 0 },
      });
      body = await upstream.text();
    }
    const res = new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${TTL}`,
        "access-control-allow-origin": "*",
        "x-source": "api-football",
      },
    });
    if (upstream.ok && !/Invalid API key|"message"\s*:\s*"You are not subscribed/i.test(body)) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
}
