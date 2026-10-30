"""Manager pages: tenure and honours from Wikipedia's "List of Manchester United F.C. managers" (CC BY-SA 4.0), with the record
by season computed from the match archive (league + FA Cup), tools/data/cups.json (other cups) and the live feed (2025/26 on),
trophies from history/seasons.json, and first-team arrivals from numbers/numbers.json (squad-number era, 1993/94 on).
Writes static/manutd/history/managers.json."""
import json, os, re, sys, glob, collections, urllib.parse, datetime
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history")
def clean(t):
    t = re.sub(r'<ref[^>]*/>|<ref[\s\S]*?</ref>|<span style="display:none">[^<]*</span>', '', t); t = re.sub(r'<br\s*/?>', '|', t); t = re.sub(r'<[^>]+>', '', t)
    t = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', t); t = re.sub(r'\{\{[^{}]*\}\}', '', t); return re.sub(r'\s+', ' ', t).strip()
MON = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 1)}
def when(t, end=False):
    """dts template or plain date → ISO; missing month/day → start (or end) of the period."""
    m = re.search(r'\{\{dts\|format=dmy\|(\d{4})\|(\d*)\|(\d*)', t)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2) or (12 if end else 1)), m.group(3)
        if d: return f"{y}-{mo:02d}-{int(d):02d}"
        last = (datetime.date(y + (mo == 12), mo % 12 + 1, 1) - datetime.timedelta(days=1)).day
        return f"{y}-{mo:02d}-{last if end else 1:02d}"
    m = re.search(r'(\d{1,2}) (\w+) (\d{4})', clean(t))
    if m and m.group(2) in MON: return f"{m.group(3)}-{MON[m.group(2)]:02d}-{int(m.group(1)):02d}"
    return None
NAT = {'ENG': 'England', 'SCO': 'Scotland', 'WAL': 'Wales', 'NIR': 'Northern Ireland', 'IRL': 'Ireland', 'POR': 'Portugal', 'NED': 'Netherlands', 'NOR': 'Norway', 'GER': 'Germany'}
wt = get("/wiki-raw?title=" + urllib.parse.quote("List of Manchester United F.C. managers"))
tbl = wt[wt.index('{|', wt.index('==Managers') if '==Managers' in wt else 0):]; tbl = tbl[:tbl.index('\n|}') + 3]
mgrs = []
for row in tbl.split('\n|-')[1:]:
    m = re.search(r'\{\{sortname\|([^|}]+)\|([^|}]+)', row)
    if not m: continue
    name = f"{m.group(1)} {m.group(2)}".strip(); role = re.search(r'<small>\((caretaker|interim|player-manager|[^)]+)\)</small>', row)
    cells = [c for c in re.split(r'\n\|(?!\})', row)[1:]]
    nat = re.search(r'\{\{([A-Z]{3})\}\}|\{\{flag\|([A-Za-z ]+)', row); dates = [c for c in cells if re.search(r'\{\{dts|^\s*\d{1,2} \w+ \d{4}|present', c)]
    fr = when(dates[0]) if dates else None; to = when(dates[1], end=True) if len(dates) > 1 and 'present' not in dates[1] else None
    w = re.search(r'\{\{WDL\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|for=(\d+)\|against=(\d+)', row)
    hon = ''
    for c in cells:
        if '<small>' in c and ('title' in c.lower() or 'cup' in c.lower() or 'shield' in c.lower() or 'league' in c.lower() or 'division' in c.lower()): hon = clean(c); break
    notes = clean(cells[-1]) if cells else ''
    mgrs.append(dict(name=name, slug=re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'), role=role.group(1) if role else None, nat=(NAT.get(nat.group(1), nat.group(1)) if nat.group(1) else nat.group(2)) if nat else None,
                     fr=fr, to=to, wiki=dict(p=int(w.group(1)), w=int(w.group(2)), d=int(w.group(3)), l=int(w.group(4)), gf=int(w.group(5)), ga=int(w.group(6))) if w else None,
                     honours=[h.strip() for h in hon.split('|') if h.strip()], notes=notes[:300]))
FIX = {'Jimmy Murphy': ('1958-02-07', '1958-06-30')}
for m in mgrs:
    if m['name'] in FIX: m['fr'], m['to'] = FIX[m['name']]
# Same person twice (Carrick caretaker 2021 then head coach 2026) keeps one slug per spell
seen = collections.Counter(m['slug'] for m in mgrs); cnt = collections.Counter()
for m in mgrs:
    if seen[m['slug']] > 1: cnt[m['slug']] += 1; m['slug'] += f"-{m['fr'][:4]}"
# ---- every competitive match, deduped
matches = {}
for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f))
    for r in d['results']: matches.setdefault(r['d'], dict(r, s=d['id'], div=d['div'] if r['c'] == 'L' else 'FA Cup'))
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))): matches.setdefault(r['d'], r)
for f in glob.glob(H + '/clubs/*.json'):
    for r in json.load(open(f))['matches']:
        if r['s'] >= '2025-26': matches.setdefault(r['d'], r)
ms = sorted(matches.values(), key=lambda r: r['d'])
def boss(d):
    hits = [m for m in mgrs if m['fr'] and m['fr'] <= d and (m['to'] is None or d <= m['to'])]
    if len(hits) > 1: hits = [h for h in hits if h['role']] or hits   # a caretaker's dates sit inside a permanent manager's row in some editions
    return hits[-1] if hits else None
ALL = {s['id']: s for s in json.load(open(H + '/all.json'))}
SEAS = {s['id']: s for s in json.load(open(H + '/seasons.json'))}
NUM = json.load(open(os.path.join(STATIC, "numbers", "numbers.json")))
first = {}
for sid_ in sorted(NUM):
    for p in NUM[sid_]:
        first.setdefault(p.get('title') or p['name'], (sid_, p['name'], p.get('pos')))
def agg(rows): return dict(p=len(rows), w=sum(1 for m in rows if m['gf'] > m['ga']), d=sum(1 for m in rows if m['gf'] == m['ga']), l=sum(1 for m in rows if m['gf'] < m['ga']), gf=sum(m['gf'] for m in rows), ga=sum(m['ga'] for m in rows))
bym = collections.defaultdict(list)
for r in ms:
    b = boss(r['d'])
    if b: bym[b['slug']].append(r)
lastday, firstday = {}, {}
for r in ms: lastday[r['s']] = max(lastday.get(r['s'], ''), r['d']); firstday[r['s']] = min(firstday.get(r['s'], '9'), r['d'])
for m in mgrs:
    rows = bym.get(m['slug'], []); m['rec'] = agg(rows)
    bys = collections.defaultdict(list)
    for r in rows: bys[r['s']].append(r)
    m['seasons'] = []
    for sid_ in sorted(bys):
        a = ALL.get(sid_, {}); srow = dict(s=sid_, **agg(bys[sid_]), comps=sorted(set(r['c'] for r in bys[sid_])))
        full = lastday.get(sid_) and boss(lastday[sid_]) is m and boss(firstday[sid_]) is m
        srow['part'] = not full
        if a: srow.update(div=a['div'], pos=a['pos'], teams=a['teams'])
        if sid_ in SEAS and lastday.get(sid_) and boss(lastday[sid_]) is m: srow['trophies'] = SEAS[sid_]['trophies']
        m['seasons'].append(srow)
    m['trophies'] = [t for s in m['seasons'] for t in s.get('trophies', [])]
    # first-team arrivals: players whose first squad-number season fell under him
    arr = []
    for title, (sid_, nm, pos) in first.items():
        if sid_ in bys and sid_ != '1993-94':   # 1993/94 is the first season with squad numbers, so its squad is a baseline, not arrivals
            arr.append(dict(name=nm, title=title, s=sid_, pos=pos))
    if any(s_ > '1993-94' for s_ in bys): m['arrivals'] = sorted(arr, key=lambda x: (x['s'], x['name']))
    biggest = max(rows, key=lambda r: (r['gf'] - r['ga'], r['gf']), default=None); worst = min(rows, key=lambda r: (r['gf'] - r['ga'], -r['ga']), default=None)
    m['best'] = biggest; m['worst'] = worst
for m in mgrs: m['from'] = m.pop('fr')
dump(mgrs, os.path.join(H, "managers.json"))
stamp("managers", f"{len(mgrs)} managers; {len(ms)} matches assigned")
print(len(mgrs), "managers", sum(len(bym[m['slug']]) for m in mgrs), "of", len(ms), "matches assigned")
for m in mgrs: print(m['name'], m['role'] or '', m['from'], m['to'], m['rec']['p'], m['wiki'] and m['wiki']['p'], len(m['trophies']), m['honours'][:2])
