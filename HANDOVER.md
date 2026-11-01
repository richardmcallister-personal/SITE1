# manutd.wiki — handover for a new chat (1 Nov 2026)

Paste this as the first message of a new conversation, with the GitHub repo
`richardmcallister-personal/SITE1` attached. Read `CLAUDE.md` in the repo first; it
holds the layout, environments, working rules, design tokens and data conventions.
This file only says where things stand.

## State of the site

Everything below is live on manutd.wiki (branch `main`, Worker `site1`) and identical on
dev.manutd.wiki (branch `redesign`, Worker `site1-dev`, which proxies all data calls to
the live Worker). Last commit on both: `b4b641d`.

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
- Champions League: Worker route `/api/cl` is deployed (same slim shape; rounds are
  "League Stage - N" then knockout names). **No page uses it yet.**

## Next task (where the last chat stopped)

Add the Champions League to the Season page and reshape that page so the extra
information reads well. The plan agreed in outline:

1. Tabs by competition instead of by type: **United** (results, remaining fixtures,
   pace sheet) · **Premier League** (table + every game) · **Champions League**
   (league-phase table from `/api/ucl` + every game from `/api/cl`, United's games
   highlighted). Make the tabs apply on desktop too (`MU.tabs` currently only tabs on
   ≤640px; add an option) and, inside PL/CL on desktop, two columns: table left, games
   right.
2. Reuse the League-tab renderer from `static/manutd/season/index.html` (`row`, `nm`,
   `render`, club filter) for CL: "League Stage - N" → "Matchday N", knockout rounds
   by name; club picker as a dropdown (36 clubs).
3. Cadence for non-United games stays half-time/full-time (nothing to change in the
   Worker).
4. Give Ask the CL games the same way `/api/pl` is used in `contextFor`.
5. Audit (`node /tmp/claude-0/audit2.js` pattern: 23 pages × light/dark × 1280/390,
   Chrome UA, no `pageerror`, no overflow), push to `redesign`, check dev, merge.

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
