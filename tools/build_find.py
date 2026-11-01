"""Index for the Find-that-match page: one compact row per competitive match ever, so the page can rank games from a
half-remembered description without loading 140 season files. Same match set as build_records.py: history/data (league +
FA Cup), tools/data/cups.json (other cups) and history/clubs (live feed from 2025/26), keyed by date.
Adds the manager on the day, the neutral venue where known, comeback tags (comebacks/api.json + classics.json) and the
match-centre id. Writes static/manutd/find/index.json and find/rep.json (match-report links, loaded only for results).

Row keys: d date · c comp (index into C: [code, label]) · h 1 home / 0 away / 2 neutral · o opponent (index into O) ·
f/a goals for/against · r round (index into R) · s scorers "P[*n][p|o] …" (P index, goal count, pen / own goal) ·
m manager (index into M) · p pens United-first · e 1 = after extra time · w neutral venue (index into W) · t comeback tags ·
i match-centre id · y season when it is not the one the date implies."""
import json, os, sys, glob, re
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history")
OUT = os.path.join(STATIC, "find"); os.makedirs(OUT, exist_ok=True)

matches = {}
for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f))
    for r in d['results']: matches.setdefault(r['d'], dict(r, s=d['id'], div=d['div'] if r['c'] == 'L' else 'FA Cup'))
for r in json.load(open(os.path.join(ROOT, "tools", "data", "cups.json"))):
    m = matches.setdefault(r['d'], dict(r))
    for k in ('sc', 'id', 'pens', 'aet', 'r', 'n', 'rep'):
        if r.get(k) and not m.get(k): m[k] = r[k]
for f in glob.glob(H + '/clubs/*.json'):
    for r in json.load(open(f))['matches']:
        m = matches.get(r['d'])
        if m is None:
            if r['s'] >= '2025-26': matches[r['d']] = dict(r)
            continue
        for k in ('sc', 'id', 'pens', 'aet'):          # the club files carry feed scorers and ids the season files can lack
            if r.get(k) and not m.get(k): m[k] = r[k]
ms = sorted(matches.values(), key=lambda r: r['d'])

# ---- lookups
MGR = sorted(json.load(open(H + '/managers.json')), key=lambda x: x['from'] or '')
def manager(d):
    best = None
    for x in MGR:                       # the latest appointment covering the date wins (caretakers inside a long reign)
        if x['from'] and x['from'] <= d and (x['to'] is None or d <= x['to']): best = x['name']
    if best is None:                    # gaps between reigns: the man who was in charge next
        nxt = [x for x in MGR if x['from'] and x['from'] > d]
        best = nxt[0]['name'] if nxt else MGR[-1]['name']
    return best

TAGC = {'from-behind': 'fb', 'two-down': '2d', 'injury-time-winner': 'iw', 'late-winner': 'lw', 'late-equaliser': 'le', 'ten-men': '10',
        'thriller': 'th', 'penalties': 'pn', 'extra-time': 'et'}
tags = {}
for src in ('api.json', 'classics.json'):
    try: rows = json.load(open(os.path.join(STATIC, 'comebacks', src)))
    except Exception: rows = []
    for c in rows:
        tags.setdefault(c['date'], set()).update(TAGC.get(t, t) for t in c['tags'])
venues = {}
for fx in json.load(open(os.path.join(STATIC, 'numbers', 'finals.json'))):
    if fx.get('venue'): venues[fx['d']] = fx['venue']
for src in ('api.json', 'classics.json'):
    try: rows = json.load(open(os.path.join(STATIC, 'comebacks', src)))
    except Exception: rows = []
    for c in rows:
        if c.get('venue'): venues.setdefault(c['date'], c['venue'])

def neutral_venue(m):
    v = _neutral_venue(m)
    return 'Wembley' if v.startswith('Wembley') else v

def _neutral_venue(m):
    n = m.get('n')
    if isinstance(n, str) and n: return re.sub(r'\s*\(original\)', '', n.split(',')[0]).strip()
    if m['d'] in venues: return re.sub(r'\s*\(original\)', '', venues[m['d']]).strip()
    y = int(m['d'][:4]); r = (m.get('r') or '').lower()
    cardiff = 2001 <= y <= 2006
    if m['c'] in ('FAC', 'LC') and r.startswith('final') and 'replay' not in r: return 'Millennium Stadium' if cardiff else 'Wembley'
    if m['c'] == 'FAC' and r.startswith('semi') and y >= 2008: return 'Wembley'
    if m['c'] == 'CS' and y >= 1974: return 'Millennium Stadium' if cardiff else 'Wembley'
    return ''

def season_of(d):
    y, mo = int(d[:4]), int(d[5:7])
    return sid(y if mo >= 7 else y - 1)

def comp_code(m):
    div = m.get('div') or ''
    if 'Winners' in div: return 'CWC'
    return m['c']

def clean_name(sc):
    name, title = sc[0], sc[1] if len(sc) > 1 else ''
    if (len(sc) > 3 and sc[3] == 'o') or name.lower().startswith('own goal'): return 'own goal'
    t = re.sub(r'\s*\(.*?\)\s*$', '', title or '').strip()
    return t or name

def round_text(m):
    r = (m.get('r') or '').strip()
    if m.get('tie') and m['tie'] not in r.lower(): r = (r + ' ' + m['tie']).strip()
    return r

C, O, R, P, M, W = [], [], [''], [], [], []
def ix(lst, v):
    try: return lst.index(v)
    except ValueError: lst.append(v); return len(lst) - 1
Cix, Oix, Rix, Pix, Mix, Wix = {}, {}, {'': 0}, {}, {}, {}
def ixd(lst, d, v):
    if v not in d: d[v] = len(lst); lst.append(v)
    return d[v]

import unicodedata
def pkey(n): return ''.join(ch for ch in unicodedata.normalize('NFKD', n) if not unicodedata.combining(ch)).lower()
PK = {}                                  # one entry per person however the sources spell the case or accents (Park Ji-Sung / Park Ji-sung)
def pidx(n):
    k = pkey(n)
    if k not in PK: PK[k] = ixd(P, Pix, n)
    return PK[k]
# shoot-outs the season articles' rows do not record (United-first); the cup builder only takes pens from the feed from 2021/22
PENS_FIX = {'1985-03-20': '4-5', '1992-09-29': '3-4', '1993-08-07': '5-4', '1997-08-03': '4-2', '2003-08-10': '4-3', '2007-08-05': '3-0',
            '2008-05-21': '6-5', '2008-08-10': '3-1', '2009-03-01': '4-1', '2009-08-09': '1-4', '2021-05-26': '10-11'}
rows, rep, skipped = [], {}, 0
for m in ms:
    if m['c'] in ('FR',) or 'riendl' in (m.get('div') or ''): skipped += 1; continue
    code = comp_code(m)
    label = m.get('div') or {'L': 'League', 'FAC': 'FA Cup'}.get(m['c'], m['c'])
    neutral = bool(m.get('n'))
    y = int(m['d'][:4]); rr = (m.get('r') or '').strip().lower()
    if not neutral and ((code == 'CS' and y >= 1974) or (code == 'SC' and y >= 1998) or code == 'CWCup'
                        or (rr in ('final', 'finals') and code in ('FAC', 'LC', 'UCL', 'UEL', 'CWC', 'SC'))):
        neutral = True                  # one-off finals and the Wembley/Cardiff Shields are on neutral ground; the feed rows call them home or away
    row = dict(d=m['d'], c=ixd(C, Cix, (code, label)), h=2 if neutral else (1 if m['h'] else 0), o=ixd(O, Oix, m['o']), f=m['gf'], a=m['ga'])
    rt = round_text(m)
    if rt: row['r'] = ixd(R, Rix, rt)
    sc = []
    for s in m.get('sc') or []:
        nm = clean_name(s); n = s[2] if len(s) > 2 and s[2] else 1
        fl = 'o' if nm == 'own goal' else ('p' if len(s) > 3 and s[3] == 'p' else '')
        sc.append(f"{pidx(nm)}{'*' + str(n) if n > 1 else ''}{fl}")
    if sc: row['s'] = ' '.join(sc)
    row['m'] = ixd(M, Mix, manager(m['d']))
    pens = (m.get('pens') or PENS_FIX.get(m['d']) or '').replace('–', '-')
    pm = re.match(r'^(\d+)-(\d+)\s+(\S.*)$', pens)
    if pm: pens = f"{pm[1]}-{pm[2]}" if pm[3].strip() in ('Manchester United', 'United') else f"{pm[2]}-{pm[1]}"   # "5-4 Arsenal" = the shoot-out winner's score first
    if pens: row['p'] = pens
    if m.get('aet'): row['e'] = 1
    if neutral:
        v = neutral_venue(m)
        if v: row['w'] = ixd(W, Wix, v)
    t = tags.get(m['d'])
    if t: row['t'] = ','.join(sorted(t))
    if m.get('id'): row['i'] = m['id']
    s = m.get('s') or season_of(m['d'])
    if s != season_of(m['d']): row['y'] = s
    if m.get('rep'): rep[m['d']] = m['rep']
    rows.append(row)

out = dict(v=1, built=ms[-1]['d'] if ms else '', C=[list(c) for c in C], O=O, R=R, P=P, M=M, W=W, rows=rows)
dump(out, os.path.join(OUT, 'index.json')); dump(rep, os.path.join(OUT, 'rep.json'))
sz = os.path.getsize(os.path.join(OUT, 'index.json'))
stamp("find", f"{len(rows)} matches")
print(len(rows), "matches", len(P), "scorers", len(O), "opponents", f"{sz // 1024} KB", "skipped", skipped)
