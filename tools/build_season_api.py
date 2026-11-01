"""Fill a season the match archive lacks (engsoccerdata has no 2022/23) from the live feed: league and FA Cup results, the table
from history/tables.json when it has one, and a row in history/all.json.  Usage: python3 tools/build_season_api.py 2022"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); y = int(sys.argv[1]); S = sid(y)
mu = open(os.path.join(STATIC, "mu.js"), encoding='utf-8').read(); i = mu.index('var CRESTS={'); j = mu.index('};', i); CR = json.loads(mu[i + 11:j + 1])
# archive spelling for each crest slug (the longest name wins: "Wolverhampton Wanderers" over "Wolves")
bySlug = {}
for n, sl in CR.items():
    if len(n) > len(bySlug.get(sl, '')): bySlug[sl] = n
def canon(n): return bySlug.get(CR.get(n, ''), n)
jj = get(f"/api/season-fixtures?season={y}&v=3"); res = []
for m in sorted(jj['response'], key=lambda m: m['fixture']['date']):
    if m['fixture']['status']['short'] not in ('FT', 'AET', 'PEN') or m['league']['name'] not in ('Premier League', 'FA Cup'): continue
    home = m['teams']['home']['id'] == TEAM; opp = (m['teams']['away'] if home else m['teams']['home'])['name']
    r = dict(d=m['fixture']['date'][:10], c='L' if m['league']['name'] == 'Premier League' else 'FAC', h=home, o=canon(opp), gf=m['goals']['home' if home else 'away'], ga=m['goals']['away' if home else 'home'])
    if r['c'] == 'FAC': r['r'] = m['league']['round']
    res.append(r)
L = [r for r in res if r['c'] == 'L']; FA = [r for r in res if r['c'] == 'FAC']
T = json.load(open(os.path.join(H, "tables.json"))).get(S)
if not T or not T.get('rows'):
    try:   # the feed's final standings for that season
        st = get(f"/api/season-standings?season={y}&v=3")['response'][0]['league']['standings'][0]
        T = dict(rule='3 pts a win, goal difference', rows=[dict(team=canon(r['team']['name']), pos=r['rank'], p=r['all']['played'], w=r['all']['win'], d=r['all']['draw'], l=r['all']['lose'], gf=r['all']['goals']['for'], ga=r['all']['goals']['against'], gd=r['goalsDiff'], gavg=round(r['all']['goals']['for'] / r['all']['goals']['against'], 3) if r['all']['goals']['against'] else None, pts=r['points']) for r in st])
    except Exception as e: print("feed standings unavailable:", e)
if not T or not T.get('rows'):
    # Wikipedia's "<season> Premier League" league table (Sports table module), CC BY-SA 4.0
    import re, urllib.parse
    wt = get("/wiki-raw?title=" + urllib.parse.quote(f"{S.replace('-', '–')} Premier League")); seg = wt[re.search(r'==\s*League table', wt).start():]
    order = re.findall(r'[A-Z]{3}', re.search(r'\|team_order=\s*([A-Z,\s]+)', seg).group(1))
    names = {m.group(1): m.group(2).strip() for m in re.finditer(r'\|\s*name_([A-Z]{3})\s*=\s*\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', seg)}
    rows = []
    for i, code in enumerate(order, 1):
        g = lambda k: int(re.search(rf'\|\s*{k}_{code}\s*=\s*(\d+)', seg).group(1))
        w, d, l, gf, ga = g('win'), g('draw'), g('loss'), g('gf'), g('ga'); ded = re.search(rf'\|\s*adjust_points_{code}\s*=\s*(-?\d+)', seg)
        rows.append(dict(team=canon(names.get(code, code)), pos=i, p=w + d + l, w=w, d=d, l=l, gf=gf, ga=ga, gd=gf - ga, gavg=round(gf / ga, 3) if ga else None, pts=3 * w + d + (int(ded.group(1)) if ded else 0)))
    T = dict(rule='3 pts a win, goal difference', rows=rows)
me = [r for r in (T or {}).get('rows', []) if r['team'] == 'Manchester United']
pos = me[0]['pos'] if me else None
fac = FA[-1]['r'] if FA else None; facWon = bool(FA) and FA[-1]['r'] == 'Final' and FA[-1]['gf'] > FA[-1]['ga']
row = dict(id=S, title=S.replace('-', '–'), tier=1, div='Premier League', pos=pos, p=len(L), w=sum(r['gf'] > r['ga'] for r in L), d=sum(r['gf'] == r['ga'] for r in L), l=sum(r['gf'] < r['ga'] for r in L),
           gf=sum(r['gf'] for r in L), ga=sum(r['ga'] for r in L), pts=me[0]['pts'] if me else None, teams=len(T['rows']) if T else 20, fac=fac, facWon=facWon)
data = dict(row, table=dict(rule=T['rule'], rows=T['rows']) if T else None, results=res)
dump(data, os.path.join(H, "data", S + ".json"))
allp = os.path.join(H, "all.json"); A = [a for a in json.load(open(allp)) if a['id'] != S] + [row]; A.sort(key=lambda a: a['id']); dump(A, allp)
print(S, len(L), "league", len(FA), "FA Cup", "pos", pos, "fac", fac)
