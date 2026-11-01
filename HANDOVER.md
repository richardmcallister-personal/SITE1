# manutd.wiki — handover for a new chat (1 Nov 2026)

Paste this as the first message of a new conversation, with the GitHub repo
`richardmcallister-personal/SITE1` attached. Read `CLAUDE.md` in the repo first; it
holds the layout, environments, working rules, design tokens and data conventions.
This file only says where things stand.

## State of the site

Everything below is live on manutd.wiki (branch `main`, Worker `site1`) and identical on
dev.manutd.wiki (branch `redesign`, Worker `site1-dev`, which proxies all data calls to
the live Worker). See `git log` for the latest commit on each branch.

- Redesign shipped: shared shell, hub in three columns, dark mode, phone tab bar,
  sticky pills on player pages, tabs on the season page.
- Performance/accessibility pass done (CLS fixed by reserving card space, sized crest
  and portraits, contrast via tokens, skip link, one `main` per page, consent for GA).
- Google Analytics 4 (`G-QZZVNDNYN9`) with Consent Mode v2, EEA-scoped: denied by
  default for EEA/UK/CH (country stamped by the Worker as `<meta name="mu-country">`),
  Accept / No thanks bar only there, "Cookies" control in the footer.
- Ask the archive: floating crest button on every page + `/ask/` page. Worker route
  `/ask` (POST `{q}`) builds a context from the site's own JSON (players, seasons incl.
  cup ties, opponents with home/away splits, managers, records, `history/facts.json`),
  the Wikipedia lead/infobox for people, the best-matching Wikipedia article for topics,
  and the live table/fixtures/injuries, then calls Haiku 5.5 (thinking disabled, plain
  text ≤110 words). Caps: 300/day, 20/hour/visitor; answers cached a week under
  `ask:a:v7:<sha>` — bump the version string to invalidate. Secret `ANTHROPIC_API_KEY`
  is on the live Worker only. `?debug=topic` shows which entities/article a question
  picks without calling the model.
- Goal events reconciled against the official score everywhere (`MU.goalEvents`,
  `pushTick`): a feed goal the score never counted is "ruled out", never alerted.
- Team news: newest flag per player wins; a player who then started/came on shows as
  "back"; feed age and squad-list date shown.
- Shirts: newest first, counts in brackets, tick/star badges, Buy links (eBay.de default;
  eBay.co.uk, Tradera, Classic Football Shirts in the panel).
- Trips: in the shared shell; finished matches drop off the rail after kick-off + 3 h.
- Premier League for every club: Worker `/api/pl` (380 fixtures, slimmed, 20-min cache),
  Season page **League** tab (by matchweek, club filter), match centre works for any
  game (United extras gated on `OURS`; other games refresh every 10 min client-side and
  at 15-min cadence in the Worker's live window), club pages have a "This season" block.
- Season page by competition (tabs at every width, `MU.tabs(..., {always:true})`):
  **United** (position tiles, remaining fixtures, results, pace sheet) · **Premier League**
  (table + every game by matchweek) · **Champions League** (league-phase table with
  top-8 / play-off / out bars + every game by matchday; qualifying hidden unless a club
  is picked). Desktop ≥900px: table left, games right. Club picker is a dropdown for both. Game lists: an "Earlier" button (past weeks, collapsed) above the current week (open), then upcoming weeks in date order; picking one club opens every week in date order.
  Tab ids are `united`, `premier-league`, `champions-league` (not `#pl` — that is the table).
- Top scorers / Top assists (top 10, ties share a rank) under both tables, from Worker route
  `/api/leaders?c=pl|cl&k=goals|assists` (API-Football topscorers/topassists, slimmed, 3-h cache).
  CL figures include qualifying rounds (that is how the feed counts them).
- Ask: club questions include that club's CL games; Europe questions get the CL table and
  latest/next CL games. Answer cache bumped to `ask:a:v9:`.

- Player archive goals for 2025/26 on come from the feed's goal events (`build_clubs.py`, cache
  `tools/data/feed_scorers.json`); before 1 Nov 2026 those seasons had no scorers at all.

- 1 Nov 2026 evening (on `redesign` / dev, not yet on main):
  - Trips: visitor setup (airport, adults, currency with ECB rates via Frankfurter, budget, nights, hotel choice; defaults =
    Richard's) and cheapest / shortest / most flexible options. Only CPH fares are cached; other airports get a live search.
  - Calendar: Worker `/calendar.ics` (all, `?comp=pl|europe|cups`, `?venue=home|away`, `?m=<uid>` one match) built from
    fixtures.js; provisional = TENTATIVE + "(provisional)". UID = season-comp-opponent-h/a (`MU.fxUid` = worker `fxUid`).
  - fixtures.js entries may carry `sales:[{what,opens,closes,who}]` (UTC) — drives ticket events and alerts. Keep them current.
  - Alerts: hourly `fixtureWatch` in the Worker diffs fixtures.js against KV `push:fxsnap:v1` → "kick-off moved / confirmed /
    new fixture" (pref `changes`) and ticket windows (pref `tickets`, at opening and 24 h before closing, once each).
  - Where to watch: `watch.json` (official PL and UEFA lists, dated) + `watch.js`, on match pages; country from mu-country.
    Sofascore was considered and rejected (no public API, blocks non-browser clients, terms).
  - Season page: interactive comparison (pace.json now has per-game `m` and `w2`; shareable `?cmp=&v=&m=&t2=`).
  - New pages: /find/ (build_find.py → find/index.json), /history/timeline/ (build_timeline.py + timeline-club.json),
    /compare/ (player comparison, feed for starts/minutes from 2010/11), Milestone watch (build_milestones.py →
    history/milestones.json + milestones.js) on the hub and match page.

## Next task

None in progress. Season page (competition tabs, CL, Earlier button) merged to `main` 1 Nov 2026.
Pick from the open items below.

## Open items after that

- Server-render the hub's match card in the Worker (homepage mobile LCP 3.9 s is the
  last red Lighthouse number).
- Release-check skill (`/manutd-release`).
- Four archive matches still without scorers (1935 Bradford, 1954 Burnley, 1969
  Birmingham, 1986 West Ham) — labelled on player pages; need a non-Wikipedia source.
- iOS 26 draws a glass scrim under the status bar in the Home Screen app; status-bar
  style is `default`; Apple's bug, nothing more to do. Richard uses Reduce Transparency.
- First look at GA after a week; watch Tuesday's Roma alerts (first live run of goal
  reconciliation in the cron).

## Working notes that aren't in CLAUDE.md yet

- Production deploys: push to `main`; Cloudflare builds in ~60–90 s. Verify with
  `until curl … | grep -q <marker>; do sleep 10; done`, never chained sleeps.
- `node --check` passes some things esbuild rejects (a `//` comment mid-line once
  swallowed two `else if` branches and broke the build); run
  `npx -y esbuild@0.24.0 worker.js --format=esm --log-level=error --outfile=/tmp/x.js`
  before pushing `worker.js`.
- The Season page has an element `#pl` (the league table); the games list is
  `#plGames` — don't reuse `#pl`.
- Cloudflare Workers Builds builds non-production branches of `site1` as previews
  (not routed). The dev Worker's branch is set in its Settings → Builds.
- Richard pasted an API key into the previous chat; it was used once locally and never
  stored. He was told to rotate it; the Worker secret should be a fresh key.
