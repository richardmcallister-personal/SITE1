"""Club head-to-heads: the match archive (static/manutd/history/data: league to 2024/25, FA Cup to 2018/19), the cup file built by
build_cups.py (League Cup and Europe 1956/57–2024/25, FA Cup 2019/20–2024/25) and every season since from the live feed.
Writes static/manutd/history/clubs/<slug>.json and history/clubs.json. Totals cover every competitive meeting."""
import json, os, re, sys, glob, collections
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
        clubs[rec['o']].append(rec)
index = []
def agg(rows): return dict(p=len(rows), w=sum(1 for m in rows if m['gf'] > m['ga']), d=sum(1 for m in rows if m['gf'] == m['ga']), l=sum(1 for m in rows if m['gf'] < m['ga']), gf=sum(m['gf'] for m in rows), ga=sum(m['ga'] for m in rows))
for name, ms in clubs.items():
    ms.sort(key=lambda m: m['d'])
    allr = agg(ms); lg = agg([m for m in ms if m['c'] == 'L']); fc = agg([m for m in ms if m['c'] == 'FAC']); other = agg([m for m in ms if m['c'] not in ('L', 'FAC')])
    best = max(ms, key=lambda m: (m['gf'] - m['ga'], m['gf'])); worst = min(ms, key=lambda m: (m['gf'] - m['ga'], -m['ga']))
    rec = dict(name=name, slug=slug(name), all=allr, league=lg, facup=fc, other=other, first=ms[0]['d'], last=ms[-1]['d'], seasons=len(set(m['s'] for m in ms)), best=best, worst=worst)
    index.append(dict(name=name, slug=rec['slug'], p=allr['p'], w=allr['w'], d=allr['d'], l=allr['l'], lp=lg['p'], first=ms[0]['d'][:4], last=ms[-1]['d'][:4]))
    dump(dict(rec, matches=ms), os.path.join(OUT, rec['slug'] + '.json'))
index.sort(key=lambda r: -r['p']); dump(index, os.path.join(STATIC, "history", "clubs.json"))
stamp("clubs", f"{len(index)} clubs"); print(len(index), "clubs")
