"""Milestone watch: the totals the hub and the match page need to spot landmarks before United's next game. Precomputed here,
as of the last finished match; the pages add anything the live feed has played since (milestones.js).
- current squad: United apps and goals in all competitions, before this season and this season so far (apps from the season
  squad lists in numbers.json, 1993/94 on; goals from the scorers on every match row). A player whose apps can't be trusted
  (career before 1993/94, a season with goals but no squad-list row, squad list and feed far apart) gets apps=null.
  Keepers whose whole United career is in the feed era (2025/26 on) also get clean sheets from the feed's line-ups.
- the all-time goals list (for "into Nth") and post-1993 appearance totals (for "passing X");
- the current manager's games in charge;
- the club's runs (all competitions, home, away, league): the run in progress and, for "longest since", the staircase of past
  runs, each longer than every run after it.
Writes static/manutd/history/milestones.json. Run after build_players.py and build_records.py."""
import ast, json, os, re, sys, glob, time, unicodedata
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); Y = season_now(); CUR = sid(Y)
# names and competition codes the clubs builder already maps (read from its source, so there is one list)
_src = ast.parse(open(os.path.join(ROOT, "tools", "build_clubs.py"), encoding="utf-8").read())
_lit = {t.id: ast.literal_eval(n.value) for n in _src.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name) and t.id in ("ALIAS", "COMP")}
ALIAS, COMP = _lit["ALIAS"], _lit["COMP"]
mu = open(os.path.join(STATIC, "mu.js"), encoding="utf-8").read(); i = mu.index("var CRESTS={"); j = mu.index("};", i); CR = json.loads(mu[i + 11:j + 1])
CLUBS = json.load(open(H + "/clubs.json")); byname = {c["name"]: c for c in CLUBS}; bycrest = {}
for c in CLUBS:
    if c["name"] in CR: bycrest.setdefault(CR[c["name"]], c)
def club_of(feed_name):
    n = ALIAS.get(feed_name, feed_name)
    return byname.get(n) or (bycrest.get(CR[n]) if n in CR else None) or (bycrest.get(CR[feed_name]) if feed_name in CR else None)

# ---- every competitive match: archive + cups + live seasons (as build_records.py), then the feed's newer results
matches = {}
for f in sorted(glob.glob(H + "/data/*.json")):
    d = json.load(open(f))
    for r in d["results"]: matches.setdefault(r["d"], dict(r, s=d["id"]))
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))): matches.setdefault(r["d"], r)
for f in glob.glob(H + "/clubs/*.json"):
    for r in json.load(open(f))["matches"]:
        if r["s"] >= "2025-26": matches.setdefault(r["d"], r)
FX = get("/api/fixtures?v=3")["response"]
for m in FX:
    if m["fixture"]["status"]["short"] not in ("FT", "AET", "PEN") or "riendl" in m["league"]["name"]: continue
    d = m["fixture"]["date"][:10]
    if d in matches: continue
    home = m["teams"]["home"]["id"] == TEAM; opp = (m["teams"]["away"] if home else m["teams"]["home"])["name"]; c = club_of(opp)
    matches[d] = dict(d=d, c=COMP.get(m["league"]["name"], "OTH"), h=home, o=c["name"] if c else opp, gf=m["goals"]["home" if home else "away"], ga=m["goals"]["away" if home else "home"], s=CUR, id=m["fixture"]["id"])
ms = sorted(matches.values(), key=lambda r: r["d"]); ASOF = ms[-1]["d"]
for m in ms: m["res"] = "W" if m["gf"] > m["ga"] else "L" if m["gf"] < m["ga"] else "D"
RUN = [m for m in ms if m["c"] not in ("CS", "SC")]   # runs leave out the one-off Shield and Super Cup, as records.json does

# ---- runs: the one in progress + the staircase of earlier runs (most recent first, each longer than all after it)
KINDS = {"winning": lambda m: m["res"] == "W", "unbeaten": lambda m: m["res"] != "L", "winless": lambda m: m["res"] != "W", "losing": lambda m: m["res"] == "L",
         "scoring": lambda m: m["gf"] > 0, "cleansheets": lambda m: m["ga"] == 0, "goalless": lambda m: m["gf"] == 0}
SCOPES = {"all": lambda m: True, "home": lambda m: m["h"] and not m.get("n"), "away": lambda m: not m["h"] and not m.get("n"), "league": lambda m: m["c"] == "L"}
runs = {}
for sc, inscope in SCOPES.items():
    rows = [m for m in RUN if inscope(m)]
    for k, ok in KINDS.items():
        done, cur = [], []
        for m in rows:
            if ok(m): cur.append(m); continue
            if cur: done.append([len(cur), cur[0]["d"], cur[-1]["d"]])
            cur = []
        stair, best = [], 0
        for r in reversed(done):
            if r[0] > best: stair.append(r); best = r[0]
        runs[sc + ":" + k] = dict(cur=len(cur), fr=cur[0]["d"] if cur else None, to=cur[-1]["d"] if cur else None, stair=stair)

# ---- the current manager: games in charge, every competitive match (Shields count for a manager), by spell
MG = json.load(open(H + "/managers.json")); now_m = [m for m in MG if m["to"] is None and m["from"]]
manager = None
if now_m:
    m0 = max(now_m, key=lambda m: m["from"]); spells = [m for m in MG if m["name"] == m0["name"] and m["from"]]
    def games(m): return sum(1 for r in ms if r["d"] >= m["from"] and (m["to"] is None or r["d"] <= m["to"]))
    manager = dict(name=m0["name"], slug=m0["slug"], from_=m0["from"], p=games(m0), earlier=[dict(slug=s["slug"], role=s["role"], fr=s["from"], to=s["to"], p=games(s)) for s in spells if s is not m0])

# ---- players: current squad (feed) matched to the archive through this season's squad list (shirt number + surname)
NUM = json.load(open(os.path.join(STATIC, "numbers", "numbers.json"))); squad_list = NUM.get(CUR, [])
def fold(t): return unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower().replace("-", " ").replace(".", ". ").split()
SQ = get("/api/squad")["response"][0]["players"]
FP = []
for pg in range(1, 6):
    jj = get(f"/api/players?page={pg}"); FP += jj["response"]
    if jj["paging"]["current"] >= jj["paging"]["total"]: break
feed_tot = {}
for x in FP:
    st = [s for s in x["statistics"] if s["team"]["id"] == TEAM and "riendl" not in s["league"]["name"]]
    feed_tot[x["player"]["id"]] = (sum(s["games"]["appearences"] or 0 for s in st), sum(s["goals"]["total"] or 0 for s in st))
def match_row(p):
    last = fold(p["name"])[-1:] ; rows = [r for r in squad_list if r["no"] == p["number"]]
    rows = [r for r in rows if last and last[0] in fold(r["name"]) + fold(r.get("title", ""))] or [r for r in squad_list if last and fold(r["name"])[-1:] == last]
    return rows[0] if len({r["name"] for r in rows}) == 1 else None
GK_CACHE = os.path.join(ROOT, "tools", "data", "gk_lineups.json"); gkc = json.load(open(GK_CACHE)) if os.path.exists(GK_CACHE) else {}
def keeper_of(fid):
    """United's starting keeper in a feed fixture and whether he was substituted (cached; finished matches don't change)."""
    k = str(fid)
    if k not in gkc:
        try: f = get(f"/api/match?fixture={fid}&v=3")["response"][0]
        except Exception as e: print("match unavailable", fid, e); return None
        lu = [t for t in f.get("lineups") or [] if t["team"]["id"] == TEAM]
        if not lu: return None
        gk = [p["player"]["id"] for p in lu[0]["startXI"] if p["player"].get("pos") == "G"]
        subs = [i for e in f.get("events") or [] if e["type"] == "subst" and e["team"]["id"] == TEAM for i in (e["player"]["id"], (e.get("assist") or {}).get("id"))]
        gkc[k] = dict(gk=gk[0] if gk else None, off=bool(gk and gk[0] in subs)); time.sleep(0.3)
    return gkc[k]
PI = json.load(open(H + "/players_index.json")); SLUG = {r["t"]: r["slug"] for r in PI}
players, skipped = [], []
for p in SQ:
    row = match_row(p)
    if not row: skipped.append(p["name"]); continue
    title = row.get("title") or row["name"]; fn = os.path.join(H, "players", SLUG.get(title, "-") + ".json")
    if not os.path.exists(fn): skipped.append(p["name"]); continue
    A = json.load(open(fn)); seasons = A["seasons"]; fa, fg = feed_tot.get(p["id"], (0, 0))
    prev = {s: r for s, r in seasons.items() if s < CUR}; cur = seasons.get(CUR, {})
    why = None
    if A.get("first", "0") < "1993-94": why = "career before the squad lists (1993/94)"
    elif any(r.get("goals") and "apps" not in r for r in prev.values()): why = "a season with goals but no squad-list row"
    elif cur.get("apps") is not None and abs(cur["apps"] - fa) > 2: why = f"squad list {cur['apps']} v feed {fa} this season"
    rec = dict(t=title, n=row["name"], fid=p["id"], pos=p["position"][0],
               apps0=None if why else sum(r.get("apps", 0) for r in prev.values()), apps1=max(cur.get("apps", 0), fa), appsWhy=why,
               g0=sum(r.get("goals", 0) for r in prev.values()), g1=max(cur.get("goals", 0), fg), gaps=len(A.get("gaps") or []))
    if p["position"] == "Goalkeeper" and A.get("first", "0") >= "2025-26" and rec["apps0"] is not None:
        cs = 0; ok = True
        for r in ms:
            if r["s"] < "2025-26" or r["ga"] != 0: continue
            if not r.get("id"): ok = False; break
            k = keeper_of(r["id"])
            if k is None: ok = False; break
            if k["gk"] == p["id"] and not k["off"]: cs += 1
        if ok: rec["cs"] = cs
    players.append(rec)
json.dump(gkc, open(GK_CACHE, "w"))

# ---- all-time lists
cut = PI[min(len(PI), 80) - 1]["g"]
goals_list = [[r["t"], r["n"], r["g"], r.get("gaps") or 0] for r in PI if r["g"] >= cut]
apps_list = [[r["t"], r["n"], r["apps"]] for r in PI if r.get("apps") and r["apps"] >= 150 and (r.get("first") or "0") >= "1993-94"]

# ---- upcoming opponents -> archive club file
opps = {}
for m in FX:
    if m["fixture"]["status"]["short"] in ("FT", "AET", "PEN") or "riendl" in m["league"]["name"]: continue
    t = m["teams"]["away"] if m["teams"]["home"]["id"] == TEAM else m["teams"]["home"]; c = club_of(t["name"])
    if c: opps[str(t["id"])] = dict(name=c["name"], slug=c["slug"])

out = dict(asof=ASOF, season=CUR, built=time.strftime("%Y-%m-%d"), manager=manager, players=players, goals=goals_list, apps=apps_list, runs=runs, opps=opps)
dump(out, os.path.join(H, "milestones.json")); stamp("milestones", f"{len(players)} players, as of {ASOF}")
print("as of", ASOF, "|", len(players), "players matched; skipped", skipped, "| manager", manager and (manager["name"], manager["p"]))
print("apps unsure:", [(r["n"], r["appsWhy"]) for r in players if r["appsWhy"]], "| keepers:", [(r["n"], r.get("cs")) for r in players if "cs" in r])
print("runs in progress (all):", {k.split(":")[1]: v["cur"] for k, v in runs.items() if k.startswith("all:") and v["cur"]})
