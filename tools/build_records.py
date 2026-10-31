"""Club records computed from the archive: biggest wins and defeats, longest runs (unbeaten, winning, without a win, clean sheets,
scoring), most and fewest goals in a season, best and worst league seasons, highest-scoring games.  Every competitive match in
history/data (league + FA Cup), tools/data/cups.json (other cups) and history/clubs (live feed from 2025/26).
Writes static/manutd/history/records.json."""
import json, os, sys, glob, collections
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history")
matches = {}
for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f))
    for r in d['results']: matches.setdefault(r['d'], dict(r, s=d['id'], div=d['div'] if r['c'] == 'L' else 'FA Cup'))
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))): matches.setdefault(r['d'], r)
for f in glob.glob(H + '/clubs/*.json'):
    for r in json.load(open(f))['matches']:
        if r['s'] >= '2025-26': matches.setdefault(r['d'], r)
ms = sorted(matches.values(), key=lambda r: r['d'])
for m in ms: m['res'] = 'W' if m['gf'] > m['ga'] else 'L' if m['gf'] < m['ga'] else 'D'
def slim(m): return {k: m[k] for k in ('d', 'c', 'h', 'o', 'gf', 'ga', 's', 'div', 'sc') if k in m} | ({'r': m['r']} if m.get('r') else {}) | ({'id': m['id']} if m.get('id') else {})
L = [m for m in ms if m['c'] == 'L']
RUN = [m for m in ms if m['c'] not in ('CS', 'SC')]   # runs follow the usual convention of leaving out the one-off Shield and Super Cup matches
def top(rows, key, n=10, rev=True): return [slim(m) for m in sorted(rows, key=key, reverse=rev)[:n]]
out = dict(
    span=[ms[0]['d'], ms[-1]['d']], matches=len(ms),
    wins=top(ms, lambda m: (m['gf'] - m['ga'], m['gf'], m['d'])),
    wins_league=top(L, lambda m: (m['gf'] - m['ga'], m['gf'], m['d'])),
    wins_away=top([m for m in ms if not m['h']], lambda m: (m['gf'] - m['ga'], m['gf'], m['d'])),
    defeats=top(ms, lambda m: (m['ga'] - m['gf'], m['ga'], m['d'])),
    defeats_home=top([m for m in ms if m['h']], lambda m: (m['ga'] - m['gf'], m['ga'], m['d'])),
    goalfests=top(ms, lambda m: (m['gf'] + m['ga'], m['gf'], m['d'])),
    draws=top([m for m in ms if m['res'] == 'D'], lambda m: (m['gf'], m['d'])),
)
# ---- runs
def runs(rows, ok, n=8, label=None):
    best, cur = [], []
    for m in rows + [None]:
        if m is not None and ok(m): cur.append(m); continue
        if len(cur) >= 3: best.append(cur)
        cur = []
    best.sort(key=lambda r: (-len(r), r[0]['d']))
    return [dict(n=len(r), fr=r[0]['d'], to=r[-1]['d'], s=sorted(set(m['s'] for m in r)), w=sum(1 for m in r if m['res'] == 'W'), d=sum(1 for m in r if m['res'] == 'D'), l=sum(1 for m in r if m['res'] == 'L'),
                 gf=sum(m['gf'] for m in r), ga=sum(m['ga'] for m in r), first=slim(r[0]), last=slim(r[-1]), ended=slim(rows[rows.index(r[-1]) + 1]) if rows.index(r[-1]) + 1 < len(rows) else None) for r in best[:n]]
out['runs'] = dict(
    unbeaten=runs(RUN, lambda m: m['res'] != 'L'), unbeaten_league=runs(L, lambda m: m['res'] != 'L'),
    winning=runs(RUN, lambda m: m['res'] == 'W'), winning_league=runs(L, lambda m: m['res'] == 'W'),
    winless=runs(RUN, lambda m: m['res'] != 'W'), losing=runs(RUN, lambda m: m['res'] == 'L'),
    scoring=runs(RUN, lambda m: m['gf'] > 0), cleansheets=runs(RUN, lambda m: m['ga'] == 0), goalless=runs(RUN, lambda m: m['gf'] == 0),
    unbeaten_home=runs([m for m in RUN if m['h']], lambda m: m['res'] != 'L'), unbeaten_away=runs([m for m in RUN if not m['h']], lambda m: m['res'] != 'L'),
)
# ---- seasons
A = json.load(open(H + '/all.json')); bys = collections.defaultdict(list)
for m in ms: bys[m['s']].append(m)
def srow(a):
    rows = bys.get(a['id'], []); lg = [m for m in rows if m['c'] == 'L']
    return dict(s=a['id'], div=a['div'], pos=a['pos'], teams=a['teams'], p=a['p'], w=a['w'], d=a['d'], l=a['l'], gf=a['gf'], ga=a['ga'], pts=a['pts'], ppg=round(a['pts'] / a['p'], 2) if a['p'] else None,
                pct=round(100 * a['w'] / a['p'], 1) if a['p'] else None, allp=len(rows), allgf=sum(m['gf'] for m in rows), allga=sum(m['ga'] for m in rows), allw=sum(1 for m in rows if m['res'] == 'W'),
                cs=sum(1 for m in lg if m['ga'] == 0), hw=sum(1 for m in lg if m['h'] and m['res'] == 'W'), aw=sum(1 for m in lg if not m['h'] and m['res'] == 'W'), hl=sum(1 for m in lg if m['h'] and m['res'] == 'L'), al=sum(1 for m in lg if not m['h'] and m['res'] == 'L'))
S = [srow(a) for a in A if a.get('p')]
def tops(key, n=10, rev=True): return sorted(S, key=key, reverse=rev)[:n]
out['seasons'] = dict(
    most_goals=tops(lambda s: (s['gf'], s['gf'] / s['p'])), fewest_goals=tops(lambda s: (s['gf'] / s['p'], -s['gf']), rev=False),
    most_goals_all=tops(lambda s: (s['allgf'], s['allp'])), fewest_conceded=tops(lambda s: (s['ga'] / s['p'], s['ga']), rev=False), most_conceded=tops(lambda s: (s['ga'] / s['p'], s['ga'])),
    best_pct=tops(lambda s: (s['pct'], s['pts'])), worst_pct=tops(lambda s: (s['pct'], -s['l']), rev=False),
    most_points=tops(lambda s: (s['pts'] if s['div'] == 'Premier League' or int(s['s'][:4]) >= 1981 else 0, s['w'])),   # three points a win from 1981/82
    most_wins=tops(lambda s: (s['w'], s['pct'])), fewest_wins=tops(lambda s: (s['w'], -s['l']), rev=False), most_defeats=tops(lambda s: (s['l'], -s['w'])),
    clean_sheets=tops(lambda s: (s['cs'], s['cs'] / s['p'])), away_wins=tops(lambda s: (s['aw'], s['w'])), home_defeats=tops(lambda s: (s['hl'], s['l'])),
    titles=[s['s'] for s in S if s['pos'] == 1 and s['div'] in ('Premier League', 'First Division')], relegations=[A[i]['id'] for i in range(len(A) - 1) if A[i].get('tier') and A[i + 1].get('tier') and int(A[i + 1]['tier']) > int(A[i]['tier'])], promotions=[A[i]['id'] for i in range(len(A) - 1) if A[i].get('tier') and A[i + 1].get('tier') and int(A[i + 1]['tier']) < int(A[i]['tier'])],
)
# ---- opponents and venues
byo = collections.defaultdict(list)
for m in ms: byo[m['o']].append(m)
out['opponents'] = dict(
    most_played=sorted([dict(o=o, p=len(r), w=sum(1 for m in r if m['res'] == 'W'), d=sum(1 for m in r if m['res'] == 'D'), l=sum(1 for m in r if m['res'] == 'L')) for o, r in byo.items()], key=lambda x: -x['p'])[:15],
    best_record=sorted([dict(o=o, p=len(r), w=sum(1 for m in r if m['res'] == 'W'), d=sum(1 for m in r if m['res'] == 'D'), l=sum(1 for m in r if m['res'] == 'L'), pct=round(100 * sum(1 for m in r if m['res'] == 'W') / len(r))) for o, r in byo.items() if len(r) >= 20], key=lambda x: -x['pct'])[:10],
    worst_record=sorted([dict(o=o, p=len(r), w=sum(1 for m in r if m['res'] == 'W'), d=sum(1 for m in r if m['res'] == 'D'), l=sum(1 for m in r if m['res'] == 'L'), pct=round(100 * sum(1 for m in r if m['res'] == 'W') / len(r))) for o, r in byo.items() if len(r) >= 20], key=lambda x: x['pct'])[:10],
)
# ---- by decade
byd = collections.defaultdict(list)
for m in ms: byd[m['d'][:3] + '0s'].append(m)
out['decades'] = [dict(dec=k, p=len(r), w=sum(1 for m in r if m['res'] == 'W'), d=sum(1 for m in r if m['res'] == 'D'), l=sum(1 for m in r if m['res'] == 'L'), gf=sum(m['gf'] for m in r), ga=sum(m['ga'] for m in r)) for k, r in sorted(byd.items())]
out['all'] = dict(p=len(ms), w=sum(1 for m in ms if m['res'] == 'W'), d=sum(1 for m in ms if m['res'] == 'D'), l=sum(1 for m in ms if m['res'] == 'L'), gf=sum(m['gf'] for m in ms), ga=sum(m['ga'] for m in ms))
# ---- goalscorers (from build_players.py / build_scorers.py)
PI = json.load(open(H + '/players_index.json')) if os.path.exists(H + '/players_index.json') else []
by_season = collections.defaultdict(lambda: collections.defaultdict(int)); by_season_league = collections.defaultdict(lambda: collections.defaultdict(int)); hts = []
names = {}
for m in ms:
    for name, title, g, fl in m.get('sc', []):
        if 'o' in fl or not title: continue
        names[title] = name; by_season[m['s']][title] += g
        if m['c'] == 'L': by_season_league[m['s']][title] += g
        if g >= 3: hts.append(dict(d=m['d'], o=m['o'], h=m['h'], c=m['c'], gf=m['gf'], ga=m['ga'], s=m['s'], g=g, t=title, n=name))
PN = {r['t']: r for r in PI}
def pname(t): r = PN.get(t); return (r['n'] if r else names.get(t, t))
def pslug(t): r = PN.get(t); return r['slug'] if r else re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')
import re
season_tops = sorted([dict(s=s_, t=t, n=pname(t), slug=pslug(t), g=g) for s_, d in by_season.items() for t, g in d.items()], key=lambda r: (-r['g'], r['s']))
league_tops = sorted([dict(s=s_, t=t, n=pname(t), slug=pslug(t), g=g) for s_, d in by_season_league.items() for t, g in d.items()], key=lambda r: (-r['g'], r['s']))
top_each = {s_: max(d.items(), key=lambda kv: kv[1]) for s_, d in by_season.items()}
out['scorers'] = dict(
    alltime=[dict(t=r['t'], n=r['n'], slug=r['slug'], g=r['g'], apps=r['apps'], first=r['first'][:4], last=r['last'][:4], ht=r['ht']) for r in PI[:30]],
    season=season_tops[:25], season_league=league_tops[:25],
    hat_tricks=sorted([dict(t=r['t'], n=r['n'], slug=r['slug'], ht=r['ht']) for r in PI if r['ht']], key=lambda r: -r['ht'])[:20],
    biggest_hauls=sorted(hts, key=lambda h: (-h['g'], h['d']))[:15],
    top_by_season=[dict(s=s_, t=t, n=pname(t), slug=pslug(t), g=g) for s_, (t, g) in sorted(top_each.items())],
    goals=sum(sum(d.values()) for d in by_season.values()), matches_with=sum(1 for m in ms if m.get('sc')), matches_scored=sum(1 for m in ms if m['gf'] > 0),
)
dump(out, os.path.join(H, "records.json")); stamp("records", f"{len(ms)} matches, {len(S)} seasons")
print(len(ms), "matches"); print("unbeaten", out['runs']['unbeaten'][0]['n'], out['runs']['unbeaten'][0]['fr'], out['runs']['unbeaten'][0]['to']); print("win", out['wins'][0]); print("defeat", out['defeats'][0]); print("most goals", out['seasons']['most_goals'][0]['s'], out['seasons']['most_goals'][0]['gf'])
