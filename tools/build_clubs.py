"""Club head-to-heads: the match archive (static/manutd/history/data: league to 2024/25, FA Cup to 2018/19), the cup file built by
build_cups.py (League Cup and Europe 1956/57–2024/25, FA Cup 2019/20–2024/25) and every season since from the live feed.
Writes static/manutd/history/clubs/<slug>.json and history/clubs.json. Totals cover every competitive meeting."""
import json, os, re, sys, glob, collections, time
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
D = os.path.join(STATIC, "history", "data"); OUT = os.path.join(STATIC, "history", "clubs"); os.makedirs(OUT, exist_ok=True)
def slug(t): return re.sub(r'[^a-z0-9]+', '-', t.lower().replace('f.c.', 'fc')).strip('-')
clubs = collections.defaultdict(list)
for f in sorted(glob.glob(D + '/*.json')):
    d = json.load(open(f))
    for r in d['results']: clubs[r['o']].append(dict(r, s=d['id'], div=d['div'] if r['c'] == 'L' else 'FA Cup'))
# Names the Wikipedia articles and the live feed use for the same club
ALIAS = {'PSV': 'PSV Eindhoven', 'Wolfsburg': 'VfL Wolfsburg', 'Aldershot': 'Aldershot Town', 'Internazionale': 'Inter Milan', 'Inter': 'Inter Milan',
         'FC Porto': 'Porto', 'Atletico Madrid': 'Atlético Madrid', 'BSC Young Boys': 'Young Boys', 'Athletic Club': 'Athletic Bilbao', 'FC Copenhagen': 'Copenhagen',
         'Bodo/Glimt': 'Bodø/Glimt', 'Plzen': 'Viktoria Plzeň', 'Omonia Nicosia': 'Omonia', 'Istanbul Basaksehir': 'İstanbul Başakşehir', 'AC Milan': 'Milan',
         'Olympiakos Piraeus': 'Olympiacos', 'Dynamo Kyiv': 'Dynamo Kyiv', 'Paris Saint Germain': 'Paris Saint-Germain', 'Bayer Leverkusen': 'Bayer Leverkusen',
         'Sporting CP': 'Sporting CP', 'Sporting Lisbon': 'Sporting CP', 'Real Betis': 'Real Betis', 'Zenit': 'Zenit Saint Petersburg', 'Shakhtar': 'Shakhtar Donetsk',
         'Legia': 'Legia Warsaw', 'Brondby': 'Brøndby', 'Bruges': 'Club Brugge', 'Club Brugge KV': 'Club Brugge', 'Crvena Zvezda': 'Red Star Belgrade', 'Steaua București': 'FCSB'}
mu = open(os.path.join(STATIC, "mu.js"), encoding='utf-8').read(); i = mu.index('var CRESTS={'); j = mu.index('};', i); CR = json.loads(mu[i + 11:j + 1])
bySlug = {}
for n in list(clubs.keys()):
    if n in CR: bySlug.setdefault(CR[n], n)
def canon(n):
    if n in clubs: return n
    sl = CR.get(n); return bySlug.get(sl, n) if sl else n
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))):
    r['o'] = canon(ALIAS.get(r['o'], r['o'])); clubs[r['o']].append(r)
COMP = {'Premier League': 'L', 'FA Cup': 'FAC', 'League Cup': 'LC', 'UEFA Champions League': 'UCL', 'UEFA Europa League': 'UEL', 'Community Shield': 'CS', 'UEFA Super Cup': 'SC', 'FIFA Club World Cup': 'CWCup'}
# Scorers for feed-era matches (2025/26 on): the feed's goal events, reconciled against the official score the way the site does
# (VAR-cancelled goals dropped; if the count still disagrees the match is left without scorers rather than guessed), each scorer
# matched to his Wikipedia title through that season's squad list. Cached per fixture in tools/data/feed_scorers.json.
import unicodedata
FSC = os.path.join(ROOT, "tools", "data", "feed_scorers.json"); fsc = json.load(open(FSC)) if os.path.exists(FSC) else {}
NUMS = json.load(open(os.path.join(STATIC, "numbers", "numbers.json")))
def fold(t): return unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower().replace('-', ' ').strip()
def who(name, season):
    n = fold(name); squad = NUMS.get(season, []) + NUMS.get(sid(int(season[:4]) - 1), [])
    for x in squad:
        if fold(x['name']) == n or fold(x.get('title', '')) == n: return x['name'], x.get('title') or x['name']
    parts = n.replace('.', '. ').split(); last = parts[-1] if parts else ''; ini = parts[0][0] if len(parts) > 1 else ''
    hits = [x for x in squad if fold(x['name']).split()[-1:] == [last] and (not ini or fold(x['name'])[:1] == ini)]
    if len({h['name'] for h in hits}) == 1: return hits[0]['name'], hits[0].get('title') or hits[0]['name']
    hits = [x for x in squad if last and last in fold(x['name']).split()]
    if len({h['name'] for h in hits}) == 1: return hits[0]['name'], hits[0].get('title') or hits[0]['name']
    return name, ''
def scorers_for(fid, gf, season):
    k = str(fid)
    if k not in fsc:
        try: ev = get(f"/api/events?fixture={fid}&v=3")["response"]
        except Exception as e: print("events unavailable", fid, e); return None
        fsc[k] = [dict(t=e["time"]["elapsed"], x=e["time"].get("extra"), team=e["team"]["id"], name=e["player"]["name"], type=e["type"], detail=e["detail"]) for e in ev if e["type"] in ("Goal", "Var")]
        time.sleep(0.4)
    ev = fsc[k]
    cancelled = [(e["t"], e["team"]) for e in ev if e["type"] == "Var" and re.search(r"goal (cancel|disallow)", e["detail"] or "", re.I)]
    goals = [e for e in ev if e["type"] == "Goal" and e["detail"] != "Missed Penalty" and e["team"] == TEAM]
    goals = [g for g in goals if not any(g["t"] - 1 <= t <= g["t"] + 3 and tm == TEAM for t, tm in cancelled)]
    if len(goals) != gf: return None
    out = {}
    for g in goals:
        og = g["detail"] == "Own Goal"; nm, title = (g["name"], "") if og else who(g["name"], season)
        key = (nm, title, og); r = out.setdefault(key, [nm, title, 0, set()]); r[2] += 1
        if og: r[3].add('o')
        if g["detail"] == "Penalty": r[3].add('p')
    return [[a, b, c, ''.join(sorted(d))] for a, b, c, d in out.values()]
Y = season_now()
for y in range(2025, Y + 1):
    jj = get(f"/api/season-fixtures?season={y}&v=3" if y < Y else "/api/fixtures?v=3")
    for m in jj['response']:
        if m['fixture']['status']['short'] not in ('FT', 'AET', 'PEN') or 'riendl' in m['league']['name']: continue
        home = m['teams']['home']['id'] == TEAM; opp = (m['teams']['away'] if home else m['teams']['home'])['name']
        gf = m['goals']['home'] if home else m['goals']['away']; ga = m['goals']['away'] if home else m['goals']['home']
        rnd = m['league']['round'] if 'Regular Season' not in m['league']['round'] else ''
        rec = dict(d=m['fixture']['date'][:10], c=COMP.get(m['league']['name'], 'OTH'), h=home, o=canon(ALIAS.get(opp, opp)), gf=gf, ga=ga, s=sid(m['league']['season']), div=m['league']['name'], id=m['fixture']['id'])
        if rnd: rec['r'] = rnd
        if m['fixture']['status']['short'] == 'AET': rec['aet'] = True
        if m['fixture']['status']['short'] == 'PEN' and m['score']['penalty']['home'] is not None: rec['pens'] = f"{m['score']['penalty']['home' if home else 'away']}–{m['score']['penalty']['away' if home else 'home']}"
        if gf: sc = scorers_for(m['fixture']['id'], gf, rec['s']); rec.update({'sc': sc} if sc else {})
        clubs[rec['o']].append(rec)
json.dump(fsc, open(FSC, 'w'))
index = []
def agg(rows): return dict(p=len(rows), w=sum(1 for m in rows if m['gf'] > m['ga']), d=sum(1 for m in rows if m['gf'] == m['ga']), l=sum(1 for m in rows if m['gf'] < m['ga']), gf=sum(m['gf'] for m in rows), ga=sum(m['ga'] for m in rows))
for name, ms in clubs.items():
    ms.sort(key=lambda m: m['d'])
    seen = set(); ms[:] = [m for m in ms if not ((m['d'], m['c']) in seen or seen.add((m['d'], m['c'])))]   # same tie from two sources
    allr = agg(ms); lg = agg([m for m in ms if m['c'] == 'L']); fc = agg([m for m in ms if m['c'] == 'FAC']); other = agg([m for m in ms if m['c'] not in ('L', 'FAC')])
    best = max(ms, key=lambda m: (m['gf'] - m['ga'], m['gf'])); worst = min(ms, key=lambda m: (m['gf'] - m['ga'], -m['ga']))
    rec = dict(name=name, slug=slug(name), all=allr, league=lg, facup=fc, other=other, first=ms[0]['d'], last=ms[-1]['d'], seasons=len(set(m['s'] for m in ms)), best=best, worst=worst)
    index.append(dict(name=name, slug=rec['slug'], p=allr['p'], w=allr['w'], d=allr['d'], l=allr['l'], lp=lg['p'], first=ms[0]['d'][:4], last=ms[-1]['d'][:4]))
    dump(dict(rec, matches=ms), os.path.join(OUT, rec['slug'] + '.json'))
index.sort(key=lambda r: -r['p']); dump(index, os.path.join(STATIC, "history", "clubs.json"))
stamp("clubs", f"{len(index)} clubs"); print(len(index), "clubs")
