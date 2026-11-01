"""Site-wide search index: every player, manager, club, season, kit, ground, book/film and classic match that has a page or a
deep link, built from the data files the other builders write. Writes static/manutd/search.json as a compact list of
[title, kind, url, subtitle, aliases]. The search box in the nav loads it once and matches client-side."""
import json, os, sys, glob, re, unicodedata, collections, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); E = []
def fold(t): return unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower()
def add(t, k, u, s='', al=None): E.append([t, k, u, s] + ([sorted(set(a for a in al if a and fold(a) != fold(t)))] if al else []))
# players: squad-number era, with the seasons and numbers worn
NUM = json.load(open(os.path.join(STATIC, "numbers", "numbers.json"))); P = collections.OrderedDict()
for s_ in sorted(NUM):
    for p in NUM[s_]:
        key = p.get('title') or p['name']; r = P.setdefault(key, dict(name=p['name'], title=p.get('title'), first=s_, last=s_, nos=set(), apps=0, goals=0, pos=None))
        r['last'] = s_; r['nos'].add(p['no']); r['apps'] += p.get('apps', 0); r['goals'] += p.get('goals', 0); r['pos'] = r['pos'] or p.get('pos')
# players from the finals (pre-1993)
for f in json.load(open(os.path.join(STATIC, "numbers", "finals.json"))):
    for p in f['xi'] + f['subs']:
        key = p.get('title') or p['name']; r = P.setdefault(key, dict(name=p['name'], title=p.get('title'), first=f['d'][:4], last=f['d'][:4], nos=set(), apps=None, goals=None, pos=p.get('pos'), finals=0))
        r.setdefault('finals', 0); r['finals'] += 1; r['last'] = max(r['last'], f['d'][:4]) if len(r['last']) == 4 else r['last']
# current squad
for p in json.load(open(os.path.join(STATIC, "squad.json"))):
    key = p.get('wiki') or p['name']
    if key not in P: P[key] = dict(name=p['name'], title=p.get('wiki'), first=sid(season_now()), last=sid(season_now()), nos={p['n']} if p.get('n') else set(), apps=None, goals=None, pos=p.get('pos', '')[:2].upper())
for key, r in P.items():
    span = r['first'].replace('-', '–') if r['first'] == r['last'] else f"{r['first'][:4]}–{r['last'][-2:] if len(r['last']) == 7 else r['last']}"
    bits = [r['pos'] or '', span]
    if r['nos']: bits.append('No. ' + ', '.join(str(n) for n in sorted(r['nos'])))
    if r.get('apps'): bits.append(f"{r['apps']} apps, {r['goals']} goals")
    elif r.get('finals'): bits.append(f"{r['finals']} final line-up{'s' if r['finals'] > 1 else ''}")
    u = "/manutd/player/?" + ("p=" + urllib.parse.quote(r['title']) if r['title'] else "q=" + urllib.parse.quote(r['name']))
    add(r['name'], 'player', u, ' · '.join(b for b in bits if b), [re.sub(r'\s*\(.*\)$', '', r['title'] or '')])
for r in json.load(open(H + '/players_index.json')):
    if any(e[1] == 'player' and e[2].endswith('p=' + urllib.parse.quote(r['t'])) for e in E): continue
    if r['g'] >= 1: add(r['n'], 'player', '/manutd/player/?p=' + urllib.parse.quote(r['t']), f"{r['first'][:4]}–{int(r['last'][:4]) + 1} · {r['g']} goal{'s' if r['g'] != 1 else ''} in the archive" + (f", {r['ht']} hat-trick{'s' if r['ht'] > 1 else ''}" if r['ht'] else ''))
# managers
for m in json.load(open(H + '/managers.json')):
    add(m['name'] + (f" ({m['role']})" if m['role'] else ''), 'manager', '/manutd/manager/?m=' + m['slug'], f"{m['from'][:4]}–{m['to'][:4] if m['to'] else 'now'} · {m['rec']['p']} matches" + (' · ' + ', '.join(m['honours'][:2]) if m['honours'] else ''))
# clubs
mu = open(os.path.join(STATIC, "mu.js"), encoding='utf-8').read(); i = mu.index('var CRESTS={'); j = mu.index('};', i); CR = json.loads(mu[i + 11:j + 1])
bySlug = collections.defaultdict(list)
for n, sl in CR.items(): bySlug[sl].append(n)
for c in json.load(open(H + '/clubs.json')):
    add(c['name'], 'club', '/manutd/club/?c=' + urllib.parse.quote(c['name']), f"{c['p']} meetings, {c['first']}–{c['last']} · W{c['w']} D{c['d']} L{c['l']}", bySlug.get(CR.get(c['name']), []))
# seasons
S = {s['id']: s for s in json.load(open(H + '/seasons.json'))}
for a in json.load(open(H + '/all.json')):
    t = S.get(a['id'], {}); sub = f"{a['div']} · {a['pos']}{'st' if a['pos'] == 1 else 'nd' if a['pos'] == 2 else 'rd' if a['pos'] == 3 else 'th'} of {a['teams']}" if a.get('pos') else (a.get('div') or 'FA Cup only')
    if t.get('trophies'): sub += ' · ' + ', '.join(t['trophies'])
    add(a['title'] + ' season', 'season', '/manutd/history/season/?s=' + a['id'], sub + (' · ' + t['manager'] if t.get('manager') else ''), [a['id'], a['title'], a['title'].replace('–', '/'), a['title'][:4] + '/' + a['title'][-2:], a['title'][:4], str(int(a['title'][:4]) + 1)])
for y in range(2025, season_now() + 1):
    if sid(y) not in {a['id'] for a in json.load(open(H + '/all.json'))}: add(f"{y}–{str(y + 1)[2:]} season", 'season', '/manutd/history/season/?s=' + sid(y), 'Premier League · live from the feed', [sid(y), f"{y}/{str(y + 1)[2:]}"])
# kits
for k in json.load(open(os.path.join(STATIC, "kits", "kits.json"))):
    add(f"{k['label']} {k['title']} kit", 'kit', '/manutd/kits/?k=' + k['id'], (k.get('special') or k['kind']).replace('-', ' '), [k['season'], k['label'].replace('–', '/')])
# grounds
for g in json.load(open(os.path.join(STATIC, "grounds", "grounds.json"))):
    add(g['ground'], 'ground', '/manutd/grounds/?g=' + urllib.parse.quote(g['club']), f"{g['club']} · {g['city']} · ground guide", [g['club']])
# shelf
for s in json.load(open(os.path.join(STATIC, "shelf", "shelf.json"))):
    add(s['t'], s['k'], '/manutd/shelf/', f"{s.get('by', '')} · {s.get('y', '')}".strip(' ·'), [s.get('by', '')])
# classic matches
for c in json.load(open(os.path.join(STATIC, "comebacks", "classics.json"))):
    add(f"{'United' if c['home'] else c['opp']} {c['score']} {c['opp'] if c['home'] else 'United'}, {c['date'][:4]}", 'match', '/manutd/comebacks/', f"{c['comp']} {c['round']} · {c['venue']}".strip(' ·'), [c['date']])
# sections
for u, t, s in [('/manutd/', 'Hub', 'next match, on this day, latest report'), ('/manutd/trips/', 'Trips & planner', 'flights, hotels and prices for every fixture'), ('/manutd/season/', 'Season', 'table, results, fixtures'),
                ('/manutd/squad/', 'Squad & team picker', ''), ('/manutd/youth/', 'Academy & loans', ''), ('/manutd/kits/', 'Shirt museum', 'every kit since 1878'), ('/manutd/numbers/', 'Who wore this number?', ''),
                ('/manutd/comebacks/', 'Comeback collection', ''), ('/manutd/shelf/', 'Bookshelf & watchlist', ''), ('/manutd/grounds/', 'Ground guides', ''), ('/manutd/history/', 'History', ''), ('/manutd/ask/', 'Ask the archive', 'a question answered from the site data'),
                ('/manutd/history/seasons/', 'All seasons', ''), ('/manutd/history/opponents/', 'Every opponent', ''), ('/manutd/history/managers/', 'Every manager', ''), ('/manutd/history/records/', 'Records', ''), ('/manutd/links/', 'Links', ''),
                ('/manutd/rivalry/?r=liverpool', 'United v Liverpool', 'rivalry: record, runs, scorers, next meeting'), ('/manutd/rivalry/?r=city', 'Manchester derby', 'rivalry: record, runs, scorers, next meeting'),
                ('/manutd/rivalry/?r=leeds', 'United v Leeds', 'Roses rivalry: record, runs, scorers'), ('/manutd/rivalry/?r=arsenal', 'United v Arsenal', 'rivalry: record, runs, scorers, next meeting'), ('/manutd/rivalry/?r=chelsea', 'United v Chelsea', 'record, runs, scorers, next meeting')]:
    add(t, 'page', u, s)
dump(E, os.path.join(STATIC, "search.json")); stamp("search", f"{len(E)} entries")
print(len(E), "entries", collections.Counter(e[1] for e in E))
