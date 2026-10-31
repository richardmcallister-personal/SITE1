"""One archive file per player, merging what the other builders know: season-by-season apps/goals and squad numbers (numbers.json,
1993/94 on), every goal with its match (scorers.json, all eras), finals started or benched (finals.json), and the managers he
played under (managers.json tenures against the seasons he appears in). Keyed by English Wikipedia article title, which is what
every source carries. Writes static/manutd/history/players/<slug>.json and history/players_index.json (totals, for top-scorer lists)."""
import json, os, re, sys, glob, collections, unicodedata
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); OUT = os.path.join(H, "players"); os.makedirs(OUT, exist_ok=True)
def slug(t):
    t = t.lower().replace('ø', 'o').replace('æ', 'ae').replace('ß', 'ss').replace('ł', 'l').replace('đ', 'd').replace('ð', 'd').replace('þ', 'th')
    return re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode()).strip('-')
# matches: date -> match (archive + cups + live seasons)
M = {}
for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f))
    for m in d['results']: M[m['d']] = dict(m, s=d['id'], div=d['div'] if m['c'] == 'L' else 'FA Cup')
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))): M.setdefault(r['d'], r)
for f in glob.glob(H + '/clubs/*.json'):
    for r in json.load(open(f))['matches']:
        if r['s'] >= '2025-26': M.setdefault(r['d'], r)
P = {}
def get_p(title, name):
    """Players are merged by slug, so redirect spellings of one article ("Joe Spence (footballer born 1898)" / "(footballer, born 1898)") are one person."""
    k = slug(title); p = P.setdefault(k, dict(title=title, name=name, slug=k, seasons={}, goals=[], finals=[], nos=[], managers=[]))
    full = re.sub(r'\s*\(.*\)$', '', title)
    if ' ' not in p['name'] and ' ' in name: p['name'] = name
    if ' ' not in p['name'] and ' ' in full: p['name'] = full   # scorer columns carry only the surname
    if ',' in p['title'] and ',' not in title: p['title'] = title
    return p
# squad lists
NUM = json.load(open(os.path.join(STATIC, "numbers", "numbers.json")))
for s in sorted(NUM):
    for x in NUM[s]:
        p = get_p(x.get('title') or x['name'], x['name']); row = p['seasons'].setdefault(s, {})
        row['apps'] = row.get('apps', 0) + x['apps']; row['goals_list'] = row.get('goals_list', 0) + x['goals']; row.setdefault('no', []).append(x['no']); row['pos'] = row.get('pos') or x.get('pos')
        if x['no'] not in p['nos']: p['nos'].append(x['no'])
# goals
SC = json.load(open(H + '/scorers.json'))
for d, rows in SC.items():
    m = M.get(d)
    if not m: continue
    for name, title, g, fl in rows:
        if 'o' in fl or not title: continue
        p = get_p(title, name); row = p['seasons'].setdefault(m['s'], {})
        row['goals'] = row.get('goals', 0) + g; row.setdefault('bycomp', {}); row['bycomp'][m['c']] = row['bycomp'].get(m['c'], 0) + g
        p['goals'].append(dict(d=d, o=m['o'], h=m['h'], c=m['c'], gf=m['gf'], ga=m['ga'], s=m['s'], g=g, p='p' in fl, **({'id': m['id']} if m.get('id') else {})))
# finals
for f in json.load(open(os.path.join(STATIC, "numbers", "finals.json"))):
    for i, x in enumerate(f['xi'] + f['subs']):
        p = get_p(x.get('title') or x['name'], x['name'])
        p['finals'].append(dict(t=f['title'], d=f['d'], o=f['o'], gf=f['gf'], ga=f['ga'], comp=f['comp'], no=x.get('no'), pos=x.get('pos'), start=i < len(f['xi']), cap=x.get('cap', False), sub=x.get('sub')))
# managers played under: tenure overlapping any season he appears in (first/last dates from goals, finals and squad seasons)
MG = json.load(open(H + '/managers.json'))
def season_span(s): y = int(s[:4]); return f"{y}-07-01", f"{y + 1}-06-30"
for p in P.values():
    dates = [g['d'] for g in p['goals']] + [f['d'] for f in p['finals']]
    spans = [season_span(s) for s in p['seasons']] + [(d, d) for d in dates]
    if not spans: continue
    lo, hi = min(a for a, b in spans), max(b for a, b in spans)
    p['first'], p['last'] = lo[:4] if not p['seasons'] else min(min(p['seasons']), lo[:7])[:7], hi[:7]
    p['managers'] = [dict(name=m['name'], slug=m['slug'], role=m['role']) for m in MG if m['from'] and m['from'] <= hi and (m['to'] is None or m['to'] >= lo)]
    p['goals'].sort(key=lambda g: g['d']); p['finals'].sort(key=lambda f: f['d'])
    p['total_goals'] = sum(g['g'] for g in p['goals']); p['hat_tricks'] = [g for g in p['goals'] if g['g'] >= 3]
    p['apps'] = sum(r.get('apps', 0) for r in p['seasons'].values()) or None
    dump(p, os.path.join(OUT, p['slug'] + '.json'))
index = [dict(t=p['title'], n=p['name'], slug=p['slug'], g=p['total_goals'], apps=p['apps'], first=p.get('first'), last=p.get('last'), ht=len(p['hat_tricks']), seasons=len(p['seasons']) or len({g['s'] for g in p['goals']})) for p in P.values() if p.get('first')]
index.sort(key=lambda r: (-r['g'], r['t'])); dump(index, os.path.join(H, "players_index.json"))
# tidy: remove files for players no longer present
have = {p['slug'] for p in P.values()}
for f in glob.glob(OUT + '/*.json'):
    if os.path.basename(f)[:-5] not in have: os.remove(f)
stamp("players", f"{len(index)} players")
print(len(index), "players;", "most goals:", [(r['n'], r['g']) for r in index[:6]], "; most hat-tricks:", sorted(((r['ht'], r['n']) for r in index), reverse=True)[:4])
