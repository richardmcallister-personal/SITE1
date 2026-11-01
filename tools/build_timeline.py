"""History timeline: merges football events generated from the archive (manager tenures, trophies and lost finals, league
titles, promotions and relegations, records, defining matches) with the hand-curated club history in
history/timeline-club.json, and writes history/timeline.json for the page at /manutd/history/timeline/.
Reads only local files, so it needs no network; run it after the other builders and before build_search.py.
Checks the trophy count per competition against the honours list and warns if they differ."""
import json, os, sys, glob, re, collections, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history")
def load(p): return json.load(open(os.path.join(STATIC, p)))
ALL = load("history/all.json"); SEAS = {a['id']: a for a in ALL}
DATA = {}
for f in glob.glob(os.path.join(H, "data", "*.json")):
    DATA[os.path.basename(f)[:-5]] = json.load(open(f))
SEASON_IDS = set(SEAS) | set(DATA)
MGR = load("history/managers.json"); CLASS = load("history/seasons.json"); REC = load("history/records.json")
FINALS = load("numbers/finals.json"); CUPS = load("history/cups.json"); COMEBACKS = load("comebacks/classics.json")
CLUB = load("history/timeline-club.json")["events"]

def season_of(d):
    y, m = int(d[:4]), int(d[5:7]) if len(d) >= 7 else 8
    return sid(y if m >= 7 else y - 1)
def season_url(s): return "/manutd/history/season/?s=" + s if s in SEASON_IDS else ""
def club_url(o): return "/manutd/club/?c=" + urllib.parse.quote(o)
def ordn(n): return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
def league_end(s):
    r = [x['d'] for x in DATA.get(s, {}).get('results', []) if x.get('c') == 'L']
    return max(r) if r else s[:4] if False else f"{int(s[:4]) + 1}-05"
def league_start(s):
    r = [x['d'] for x in DATA.get(s, {}).get('results', []) if x.get('c') == 'L']
    return min(r) if r else f"{s[:4]}-09"
def manager_on(d):
    """The manager in charge on date d (a caretaker if one was), as (name, slug)."""
    best = None
    for m in MGR:
        if m['from'] <= d and (m['to'] is None or d <= m['to']):
            if best is None or m['role'] in ('caretaker', 'interim'): best = m
    return best
E = []
def ev(d, t, ti, tx="", u="", links=None, src="", **kw):
    e = {"d": d, "t": t, "ti": ti}
    if tx: e["tx"] = tx
    if u: e["u"] = u
    if links: e["l"] = [l for l in links if l and l[1]]
    if src: e["src"] = src
    e.update({k: v for k, v in kw.items() if v is not None}); E.append(e); return e

# ---- managers: tenure bands + an appointment event each
BANDS = []
for m in MGR:
    r = m['rec']; pct = round(100 * r['w'] / r['p']) if r['p'] else 0
    role = m['role']; name = m['name'] + (f" ({role})" if role else "")
    BANDS.append({"n": m['name'], "slug": m['slug'], "r": role or "", "fr": m['from'], "to": m['to'] or ""})
    yrs = f"{m['from'][:4]}–{m['to'][:4] if m['to'] else 'now'}"
    tx = f"{yrs}. {r['p']} matches, {r['w']} won, {r['d']} drawn, {r['l']} lost ({pct}% wins)." if r['p'] else f"{yrs}."
    if m['honours']: tx += " " + ", ".join(m['honours']) + "."
    ev(m['from'], "manager", ("Interim: " if role == 'interim' else "Caretaker: " if role == 'caretaker' else "Manager: ") + m['name'], tx,
       "/manutd/manager/?m=" + m['slug'], [["Season", season_url(season_of(m['from']))]])

# ---- finals: every final United played, won (trophy) or lost (final)
COMP = {"FAC": "FA Cup", "LC": "League Cup", "CWC": "Cup Winners' Cup", "SC": "Super Cup", "ICC": "Intercontinental Cup", "CWCup": "Club World Cup", "UEL": "Europa League"}
def comp_name(c, d, div=""):
    if c == "CS": return "Community Shield" if d >= "2002" else "Charity Shield"
    if c == "UCL": return "Champions League" if d >= "1992-08" else "European Cup"
    return COMP.get(c, div)
FROMF = {"Charity Shield": "CS", "FA Cup": "FAC", "League Cup": "LC", "European Cup": "UCL", "European Cup Winners' Cup": "CWC", "European Super Cup": "SC"}
F = {}
def addf(d, c, o, gf, ga, venue="", aet=False, pens=None, wiki="", rep="", fid=None, sc=None):
    x = F.setdefault(d, dict(d=d, c=c, o=o, gf=gf, ga=ga))
    for k, v in dict(venue=venue, aet=aet, pens=pens, wiki=wiki, rep=rep, id=fid, sc=sc).items():
        if v and not x.get(k): x[k] = v
for f in FINALS: addf(f['d'], FROMF.get(f['comp'], f['comp']), f['o'], f['gf'], f['ga'], f.get('venue'), f.get('aet'), f.get('pens'), f.get('url'))
for x in CUPS:
    if x['c'] in ('CS', 'SC', 'ICC') or (x.get('r') or '').strip().lower() == 'final':
        addf(x['d'], x['c'], x['o'], x['gf'], x['ga'], pens=x.get('pens'), rep=x.get('rep'), fid=x.get('id'), sc=x.get('sc'))
for s, dd in DATA.items():
    for x in dd.get('results', []):
        if x.get('c') == 'FAC' and (x.get('r') or '') == 'Final':
            addf(x['d'], 'FAC', x['o'], x['gf'], x['ga'], (x.get('n') or '').split(',')[0], x.get('aet'), x.get('pens'), rep=x.get('rep'), fid=x.get('id'), sc=x.get('sc'))
# shoot-outs the archive rows don't carry (United first; checked against each final's Wikipedia infobox)
PENS = {"1993-08-07": "5–4", "1997-08-03": "4–2", "2003-08-10": "4–3", "2007-08-05": "3–0", "2008-08-10": "3–1", "2009-08-09": "1–4",
        "2008-05-21": "6–5", "2009-03-01": "4–1", "2021-05-26": "10–11", "2024-08-10": "6–7", "2005-05-21": "4–5"}
fl = sorted(F.values(), key=lambda x: x['d'])
won = collections.Counter()
for i, x in enumerate(fl):
    nxt = fl[i + 1] if i + 1 < len(fl) else None
    p = PENS.get(x['d'])
    replayed = nxt and nxt['c'] == x['c'] and nxt['o'] == x['o'] and x['gf'] == x['ga'] and not p
    two_leg = x['c'] == 'ICC' and nxt and nxt['c'] == 'ICC' and nxt['o'] == x['o']
    if replayed or two_leg:
        x['skip'] = True; continue
    prev = fl[i - 1] if i else None
    first = prev if prev and prev.get('skip') and prev['c'] == x['c'] and prev['o'] == x['o'] else None
    gf, ga = x['gf'], x['ga']
    if x['c'] == 'ICC' and first: gf += first['gf']; ga += first['ga']
    if p: a, b = (int(v) for v in p.split('–')); res = 'W' if a > b else 'L'
    elif gf != ga: res = 'W' if gf > ga else 'L'
    elif x['c'] == 'CS': res = 'S'
    else: res = '?'; print("undecided final", x['d'], x['o'])
    cn = comp_name(x['c'], x['d']); s = season_of(x['d'])
    score = f"{x['gf']}–{x['ga']}" + (" aet" if x.get('aet') else "") + (f", {p} on penalties" if p else "")
    if x['c'] == 'ICC' and first: score = f"{gf}–{ga} on aggregate"
    if first and x['c'] != 'ICC': score += f" in the replay after {first['gf']}–{first['ga']}"
    mg = manager_on(x['d'])
    kind = "shield" if x['c'] in ('CS',) else "cup"
    if res in 'WS':
        won[cn] += 1
        ti = f"{cn} won" if res == 'W' else f"{cn} shared"
        tx = f"{score} against {x['o']}" + (f" at {x['venue']}" if x.get('venue') else "") + "." + (" Shared after a draw." if res == 'S' else "")
        typ = "trophy"
    else:
        ti = f"{cn} final lost"; tx = f"{score} against {x['o']}" + (f" at {x['venue']}" if x.get('venue') else "") + "."; typ = "final"
    if mg: tx += f" Manager: {mg['name']}."
    sc = MU_sc = ", ".join(f"{a[0]}{' ' + str(a[2]) if a[2] > 1 else ''}{' (og)' if 'o' in (a[3] or '') else ''}" for a in (x.get('sc') or []))
    if sc and res in 'WS': tx += f" Scorers: {sc}."
    links = [["Match centre", f"/manutd/match/?id={x['id']}" if x.get('id') else ""], [x['o'], club_url(x['o'])],
             ["Report ↗", x.get('rep', '')], ["Wikipedia ↗", x.get('wiki', '')]]
    ev(x['d'], typ, ti, tx, season_url(s), links, comp=cn, k=kind, res=res)

# ---- league titles, second-division titles, promotions, relegations, league milestones
titles = 0
for a in ALL:
    if a.get('pos') == 1 and a.get('tier') in (1, 2) and a.get('div') not in ('Football Alliance',):
        s = a['id']; d = league_end(s); mg = manager_on(d)
        top = a['tier'] == 1; titles += top
        cn = a['div'] if top else "Second Division"
        tx = f"{a['div']} champions: {a['pts']} points from {a['p']} games (W{a['w']} D{a['d']} L{a['l']}, {a['gf']} goals)." + (f" Manager: {mg['name']}." if mg else "")
        ev(d, "trophy", f"{'League champions' if top else 'Second Division champions'} · {a['title']}" if top else f"Second Division champions · {a['title']}", tx, season_url(s), comp="League title" if top else "Second Division", k="league", res="W")
        won["League title" if top else "Second Division"] += 1
for s in REC['seasons'].get('relegations', []):
    a = SEAS[s]; ev(league_end(s), "league", f"Relegated · {a['title']}", f"{ordn(a['pos'])} of {a['teams']} in the {a['div']}.", season_url(s), dir="down")
for s in REC['seasons'].get('promotions', []):
    a = SEAS[s]
    if a['pos'] == 1 and a['tier'] == 2 and a['div'] != 'Football Alliance':
        for e in E:
            if e['t'] == 'trophy' and e.get('comp') == 'Second Division' and e['d'] == league_end(s): e['tx'] = e['tx'].replace(" Manager:", " Promoted. Manager:", 1)
        continue
    tx = f"Promoted: {ordn(a['pos'])} of {a['teams']} in the {a['div']}."
    if s == "1891-92": tx = "Runners-up in the Football Alliance; elected to the enlarged Football League First Division."
    ev(league_end(s), "league", f"Promoted · {a['title']}", tx, season_url(s), dir="up")
lowest = max((a for a in ALL if a.get('pos') and a.get('tier')), key=lambda a: (a['tier'], a['pos']))
ev(league_end(lowest['id']), "record", f"Lowest finish · {lowest['title']}", f"{ordn(lowest['pos'])} of {lowest['teams']} in the {lowest['div']}, the club's lowest league position.", season_url(lowest['id']))
first = DATA["1886-87"]['results'][0]
ev(first['d'], "record", "First FA Cup tie", f"Newton Heath LYR draw {first['gf']}–{first['ga']} at {first['o']} in the first round, the earliest match in the archive.", season_url("1886-87"))
ev(league_start("1889-90"), "league", "Into the Football Alliance", "First season of league football: 8th of 12 in the new Football Alliance.", season_url("1889-90"))
ev(league_start("1892-93"), "league", "First Football League match", "A 4–3 defeat at Blackburn Rovers to open the First Division season.", season_url("1892-93"))
ev(league_start("1992-93"), "league", "First Premier League season", "The breakaway league starts with a 2–1 defeat at Sheffield United; United win the first title.", season_url("1992-93"))

# ---- records from records.json
def mrow(x, title, extra=""):
    h = x['h']; sc = f"{x['gf']}–{x['ga']}"
    tx = f"United {sc} {x['o']} ({'home' if h else 'away'}), {x['div']}{(' ' + x['r']) if x.get('r') else ''}." + extra
    ev(x['d'], "record", title, tx, season_url(x['s']), [["Match centre", f"/manutd/match/?id={x['id']}" if x.get('id') else ""], [x['o'], club_url(x['o'])]])
mrow(REC['wins'][0], "Record win")
mrow(REC['wins_league'][0], "Record league win")
pl = [x for x in REC['wins_league'] if x['div'] == 'Premier League']
for x in pl:
    if x['gf'] - x['ga'] == pl[0]['gf'] - pl[0]['ga']: mrow(x, "Record Premier League win")
dm = REC['defeats'][0]['ga'] - REC['defeats'][0]['gf']
for x in REC['defeats']:
    if x['ga'] - x['gf'] == dm and x['div'] != 'Football Alliance': mrow(x, "Record defeat", " The joint heaviest in the club's history.")
RUNS = [("unbeaten", "Longest unbeaten run", "matches unbeaten in all competitions"), ("winning", "Longest winning run", "wins in a row"),
        ("losing", "Longest losing run", "defeats in a row"), ("unbeaten_home", "Longest unbeaten home run", "home matches unbeaten")]
for k, ti, what in RUNS:
    r = REC['runs'][k][0]
    ev(r['to'], "record", ti, f"{r['n']} {what}, {r['fr']} to {r['to']} (W{r['w']} D{r['d']} L{r['l']}).", season_url(r['s'][-1]))
mp = REC['seasons']['most_points'][0]; ev(league_end(mp['s']), "record", f"Most league points · {SEAS[mp['s']]['title']}", f"{mp['pts']} points from {mp['p']} games in the {mp['div']}.", season_url(mp['s']))
mg_ = REC['seasons']['most_goals'][0]; ev(league_end(mg_['s']), "record", f"Most league goals · {SEAS[mg_['s']]['title']}", f"{mg_['gf']} goals in {mg_['p']} {mg_['div']} games.", season_url(mg_['s']))

# ---- defining matches: the trophy seasons' key games and the comeback classics
have = {e['d']: e for e in E if e['t'] in ('trophy', 'final')}
for s in CLASS:
    for m in s.get('matches', []):
        d = m['date']; note = m.get('note', '')
        if d in have:
            if note and note not in have[d].get('tx', ''): have[d]['tx'] += " " + note
            continue
        us_home = m['home'] == 'Manchester United'; opp = m['away'] if us_home else m['home']
        ti = f"{m['home'].replace('Manchester United', 'United')} {m['score']} {m['away'].replace('Manchester United', 'United')}"
        tx = f"{m['comp']}" + (f", {m['venue']}" if m.get('venue') else "") + "." + (f" {m['scorers']}." if m.get('scorers') else "") + (f" {note}" if note else "")
        have[d] = ev(d, "match", ti, tx, season_url(s['id']), [[opp, club_url(opp)]])
for c in COMEBACKS:
    d = c['date']; ti = f"{'United' if c['home'] else c['opp']} {c['score']} {c['opp'] if c['home'] else 'United'}"
    if d in have:
        if c.get('story') and c['story'] not in have[d].get('tx', ''): have[d]['tx'] += " " + c['story']
        have[d].setdefault('l', []).append(["Comebacks", "/manutd/comebacks/"]); continue
    tx = f"{c['comp']} {c.get('round') or ''}".strip() + (f", {c['venue']}" if c.get('venue') else "") + "." + (f" {c['story']}" if c.get('story') else "")
    have[d] = ev(d, "match", ti, tx, season_url(c['season']), [[c['opp'], club_url(c['opp'])], ["Comebacks", "/manutd/comebacks/"]])

# ---- curated club history
for c in CLUB:
    s = season_of(c['d']) if len(c['d']) >= 7 else sid(int(c['d'][:4]))
    ev(c['d'], c['t'], c['ti'], c.get('tx', ''), c.get('u') or season_url(s), src=c.get('src'), cur=1)

# ---- honours check (as on history/index.html)
EXPECT = {"League title": 20, "FA Cup": 13, "League Cup": 6, "European Cup": 1, "Champions League": 2, "Europa League": 1, "Cup Winners' Cup": 1,
          "Super Cup": 1, "Intercontinental Cup": 1, "Club World Cup": 1}
cs = won["Charity Shield"] + won["Community Shield"]
for k, n in EXPECT.items():
    if won[k] != n: print(f"WARNING {k}: {won[k]} in the timeline, {n} in the honours list")
if cs != 21: print(f"WARNING shields: {cs}, expected 21")

for e in E:
    if e.get('l') == []: del e['l']
E.sort(key=lambda e: (e['d'].ljust(10, '0'), ["club", "ground", "manager", "league", "record", "final", "match", "trophy"].index(e['t'])))
VIEW = {"trophy": "f", "final": "f", "match": "f", "record": "f", "league": "f", "manager": "f", "club": "c", "ground": "c"}
for e in E: e['v'] = VIEW[e['t']]
out = {"built": __import__('datetime').date.today().isoformat(), "managers": BANDS, "events": E}
dump(out, os.path.join(H, "timeline.json"))
cnt = collections.Counter(e['t'] for e in E)
stamp("timeline", f"{len(E)} events")
print(len(E), "events", dict(cnt), "trophies", sum(won.values()))
