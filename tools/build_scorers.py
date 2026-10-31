"""Goalscorers for every United match, from the Scorers column of the match tables in Wikipedia's season articles (CC BY-SA 4.0).
Incremental like build_cups.py. Writes:
  static/manutd/history/scorers.json       {date: [[name, article title, goals, flags], ...]}  flags: p=penalty(s) included, o=own goal (scorer plays for the opponent)
  static/manutd/history/scorers_index.json {title: {name, seasons: {season: {comp: goals}}, total, first, last}}  for player pages and top-scorer lists
A row with no scorers for a match United scored in is left out rather than guessed; the coverage figure is printed at the end."""
import json, os, re, sys, time, collections, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); OUT = os.path.join(H, "scorers.json"); IDX = os.path.join(H, "scorers_index.json")
STATE = os.path.join(ROOT, "tools", "data", "wiki_revs_scorers.json")
MON = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 1)}
def date(t):
    t = re.sub(r'<[^>]+>|\{\{[^{}]*\}\}', '', t); m = re.search(r'(\d{1,2}) (\w+) (\d{4})', t)
    return f"{m.group(3)}-{MON[m.group(2)]:02d}-{int(m.group(1)):02d}" if m and m.group(2) in MON else None
def strip(t):
    t = re.sub(r'<ref[^>]*/>|<ref[\s\S]*?</ref>', '', t); t = re.sub(r'<br\s*/?>', ', ', t); return re.sub(r'<[^>]+>', '', t)
def scorers(cell):
    """'[[Mark Hughes|Hughes]] (2) 50', 75', [[Kyle Walker|Walker]] 22' ([[Own goal|o.g.]])' -> rows."""
    cell = strip(cell)
    # split on commas that sit before a link (minutes have their own commas)
    cell = re.sub(r'\[\[[^\]]*\]\]', lambda m: m.group(0).replace(',', '\x00'), cell)   # commas inside links ("John Aston, Sr.") are not separators
    cell = re.sub(r'\{\{[Gg]oal\|([^{}]*)\}\}', lambda m: ' '.join(a.strip() + "'" if a.strip().replace('+', '').isdigit() else ('pen.' if 'pen' in a else '') for a in m.group(1).split('|')[::1]), cell)
    parts = [x.replace('\x00', ',') for x in re.split(r",\s*(?=\[\[|[A-Z]|'')", cell)]; out = []
    for p in parts:
        m = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', p)
        if m and re.search(r'own goal|o\.g\.|penalty', m.group(1), re.I): m = None   # the only link is the o.g./pen. gloss; the name is plain text
        if m: title, name = m.group(1).strip(), (m.group(2) or m.group(1)).strip(); rest = p[m.end():]
        else:
            nm = re.match(r"\s*([A-Z][\w'’.\- ]*?)(?=\s*(?:\(|\d|\[\[|$))", re.sub(r'\{\{[^{}]*\}\}', '', p))
            if not nm or not nm.group(1).strip():
                if re.search(r'own goal|o\.g\.', p, re.I): out.append(['own goal', '', 1, 'o'])   # unnamed own goal
                continue
            name = title = nm.group(1).strip(); rest = p[nm.end():]
        n = re.search(r'^\s*\((\d+)\b', rest); mins = re.findall(r"\d+(?:\+\d+)?'", rest)
        goals = int(n.group(1)) if n else (len(mins) if mins else 1)
        flags = ('p' if re.search(r'pen', rest, re.I) else '') + ('o' if re.search(r'o\.g\.|own goal', rest, re.I) else '')
        out.append([name, title, goals, flags])
    return out
def parse(wt):
    rows = {}
    for tbl in re.findall(r'\{\|[\s\S]*?\n\|\}', wt):
        head = tbl.split('\n|-')[0] + ('\n|-' + tbl.split('\n|-')[1] if '\n|-' in tbl and '!' in tbl.split('\n|-')[1][:200] else '')
        hdr = [re.sub(r'<!--.*?-->|<[^>]+>|\{\{[^{}]*\}\}', ' ', h).strip().lower() for line in re.findall(r'\n!\s*([^\n]*)', head) for h in re.split(r'!!', line)]
        hdr = [re.sub(r'^.*?\|(?!\|)', '', h) if '|' in h and '[[' not in h else h for h in hdr]   # scope="col"| prefixes
        hdr = [h for h in hdr if h]
        if not any('scorer' in h for h in hdr): continue
        si = [i for i, h in enumerate(hdr) if 'scorer' in h][0]
        for row in tbl.split('\n|-')[1:]:
            cells = [c.strip() for c in re.split(r'\n\|(?!\})', '\n' + row.strip())[1:]]
            cells = [c for c in cells if not c.startswith('-')]
            if len(cells) <= si: continue
            d = date(cells[0])
            if not d: continue
            sc = scorers(cells[si])
            if sc: rows[d] = sc
    return rows
def stitle(y): return f"{y}–{str(y + 1) if y % 100 == 99 else str(y + 1)[2:]} {'Newton Heath' if y < 1902 else 'Manchester United'} F.C. season"
M = {}   # every competitive match in the archive, so friendlies in the articles are ignored
for f in sorted(os.listdir(H + '/data')):
    d = json.load(open(H + '/data/' + f))
    for m in d['results']: M[m['d']] = (d['id'], m['c'])
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))): M.setdefault(r['d'], (r['s'], r['c']))
YEARS = list(range(1892, 2025)); titles = [stitle(y) for y in YEARS]
todo, revs = wiki_changed(titles, STATE)
old = json.load(open(OUT)) if os.path.exists(OUT) else {}
# season boundaries: keep rows for seasons whose article is unchanged
def season_of(d): y = int(d[:4]); return y if int(d[5:7]) >= 7 else y - 1
keep = {d: v for d, v in old.items() if stitle(season_of(d)) not in todo}
print(len(todo), "of", len(YEARS), "season articles changed"); done = []
for y in YEARS:
    T = stitle(y)
    if T not in todo: continue
    try: wt = wiki_raw(T, revs.get(T))
    except Exception as e: print("no article", y, e); continue
    if not isinstance(wt, str): continue
    r = {d: v for d, v in parse(wt).items() if d in M}; keep.update(r); done.append(T); print(y, len(r), "matches with scorers"); time.sleep(0.3)
save_revs(STATE, revs, done)
# the live feed covers 2025/26 on through the events route — not duplicated here
dump(dict(sorted(keep.items())), OUT)
# write the scorers into the match rows the pages read (season files and cups.json), as sc=[[name, title, goals, flags], ...]
for f in sorted(os.listdir(H + '/data')):
    d = json.load(open(H + '/data/' + f)); ch = False
    for m in d['results']:
        sc = keep.get(m['d'])
        if sc and m.get('sc') != sc: m['sc'] = sc; ch = True
    if ch: dump(d, H + '/data/' + f)
cp = os.path.join(ROOT, "tools", "data", "cups.json"); cups = json.load(open(cp))
for r in cups:
    if keep.get(r['d']): r['sc'] = keep[r['d']]
json.dump(cups, open(cp, 'w'), ensure_ascii=False, separators=(',', ':'))
# ---- index by player
idx = {}
for d, sc in keep.items():
    s, c = M.get(d, (sid(season_of(d)), '?'))
    for name, title, g, fl in sc:
        if 'o' in fl: continue
        p = idx.setdefault(title, dict(name=name, seasons={}, total=0, pens=0, first=d, last=d))
        p['seasons'].setdefault(s, {}); p['seasons'][s][c] = p['seasons'][s].get(c, 0) + g; p['total'] += g; p['first'] = min(p['first'], d); p['last'] = max(p['last'], d)
        if 'p' in fl: p['pens'] += 1
dump(idx, IDX)
# coverage: matches United scored in that have no scorer row
scored = [d for d, (s, c) in M.items()]; have = sum(1 for d in scored if d in keep)
stamp("scorers", f"{sum(p['total'] for p in idx.values())} goals by {len(idx)} players")
print(len(keep), "matches with scorers;", len(idx), "players;", "top:", sorted(((p['total'], p['name']) for p in idx.values()), reverse=True)[:8])
