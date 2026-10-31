"""The years before the Football League: Newton Heath's FA Cup ties from 1886/87 and the three Football Alliance seasons 1889–92,
from the Wikipedia season articles and the Alliance league tables (CC BY-SA 4.0). Writes history/data/<season>.json in the same
shape as the engsoccerdata seasons (results with scorers, table) and adds the seasons to history/all.json. County cups are left out,
as everywhere else on the site."""
import json, os, re, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(STATIC, "history")
src = open(os.path.join(os.path.dirname(__file__), "build_scorers.py")).read(); exec(src[src.index('MON = {'):src.index('def parse(')])   # date(), strip(), scorers()
def canon_name(n): return {'Walsall Town Swifts': 'Walsall', 'Small Heath': 'Birmingham City', 'The Wednesday': 'Sheffield Wednesday', 'Newton Heath LYR': 'Manchester United', 'Newton Heath': 'Manchester United', 'Ardwick': 'Manchester City'}.get(n, n)
def results(wt, sect, code):
    i = wt.find('==' + sect)
    if i < 0: return []
    seg = wt[i:]; nxt = re.search(r'\n==[^=]', seg[3:]); seg = seg[:nxt.start() + 3] if nxt else seg
    out = []
    for tbl in re.findall(r'\{\|[\s\S]*?\n\|\}', seg):
        hdr = [re.sub(r'<[^>]+>', ' ', h).strip().lower() for h in re.findall(r'\n!\s*([^\n]*)', tbl)]
        if not any('opponent' in h for h in hdr): continue
        oi = [i for i, h in enumerate(hdr) if 'opponent' in h][0]; ri = [i for i, h in enumerate(hdr) if 'result' in h][0]; hi = [i for i, h in enumerate(hdr) if 'h / a' in h or h in ('h/a', 'venue')][0]
        si = [i for i, h in enumerate(hdr) if 'scorer' in h]; rdi = [i for i, h in enumerate(hdr) if 'round' in h]
        for row in tbl.split('\n|-')[1:]:
            cells = [c.strip() for c in re.split(r'\n\|(?!\})', '\n' + row.strip())[1:]]
            cells = [c for c in cells if not c.startswith('-')]
            if len(cells) <= max(oi, ri, hi): continue
            d = date(cells[0]); m = re.search(r'(\d+)\s*[–-]\s*(\d+)', strip(cells[ri]))
            if not d or not m: continue
            opp = re.search(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', cells[oi]); opp = canon_name((opp.group(1) if opp else strip(cells[oi])).strip())
            ha = strip(cells[hi]).strip()[:1].upper()
            r = dict(d=d, c=code, h=(ha == 'H'), o=opp, gf=int(m.group(1)), ga=int(m.group(2)))
            if ha == 'N': r['n'] = 'Neutral'
            if rdi: r['r'] = strip(cells[rdi[0]]).strip()
            if si:
                sc = scorers(cells[si[0]])
                if sc: r['sc'] = sc
            out.append(r)
    return out
def alliance_table(y):
    wt = get("/wiki-raw?title=" + urllib.parse.quote(f"{y}–{str(y + 1)[2:]} Football Alliance")); seg = wt[wt.index('league table'):]
    codes = list(dict.fromkeys(re.findall(r'\|team\d+=([A-Z]{2,4})', seg)))   # the table is given in final order; the article repeats the list for the results grid
    names = {m.group(1): m.group(2) for m in re.finditer(r'\|\s*name_([A-Z]{2,4})\s*=\s*\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', seg)}
    rows = []
    for c in codes:
        g = lambda k: int(re.search(rf'\|\s*{k}_{c}\s*=\s*(\d+)', seg).group(1)); w, d, l, gf, ga = g('win'), g('draw'), g('loss'), g('gf'), g('ga')
        adj = re.search(rf'\|\s*adjust_points_{c}\s*=\s*(-?\d+)', seg)
        rows.append(dict(team=canon_name(names.get(c, c)), p=w + d + l, w=w, d=d, l=l, gf=gf, ga=ga, gd=gf - ga, gavg=round(gf / ga, 3) if ga else None, pts=2 * w + d + (int(adj.group(1)) if adj else 0)))
    for i, r in enumerate(rows, 1): r['pos'] = i
    return dict(rule='2 pts a win, goal average' + (' (points deducted where the record shows)' if 'adjust_points' in seg else ''), rows=rows)
# Results the Alliance struck from the record and ordered replayed (the Walsall 3–0 and Grimsby 4–1 of 1889/90); the final table counts 22 games
VOID = {('1889-90', '1889-12-21'), ('1889-90', '1890-01-04')}
allp = os.path.join(H, "all.json"); A = {a['id']: a for a in json.load(open(allp))}
for y in range(1886, 1892):
    S = sid(y); T = f"{y}–{str(y + 1)[2:]} Newton Heath LYR F.C. season"
    try: wt = get("/wiki-raw?title=" + urllib.parse.quote(T))
    except Exception as e: print("no article", T, e); continue
    res = results(wt, 'Football Alliance', 'L') + results(wt, 'FA Cup', 'FAC'); res.sort(key=lambda r: r['d'])
    res = [r for r in res if (S, r['d']) not in VOID]
    if not res: print(S, "no League or FA Cup matches (county cups only)"); continue
    L = [r for r in res if r['c'] == 'L']; FA = [r for r in res if r['c'] == 'FAC']
    T_ = alliance_table(y) if L else None
    me = [r for r in (T_ or {}).get('rows', []) if r['team'] == 'Manchester United']
    fac = FA[-1].get('r') if FA else None
    row = dict(id=S, title=S.replace('-', '–'), tier=2 if L else None, div='Football Alliance' if L else None, pos=me[0]['pos'] if me else None, p=len(L), w=sum(r['gf'] > r['ga'] for r in L), d=sum(r['gf'] == r['ga'] for r in L), l=sum(r['gf'] < r['ga'] for r in L),
               gf=sum(r['gf'] for r in L), ga=sum(r['ga'] for r in L), pts=me[0]['pts'] if me else None, teams=len(T_['rows']) if T_ else 0, fac=fac, facWon=False, club='Newton Heath LYR')
    dump(dict(row, table=T_, results=res), os.path.join(H, "data", S + ".json")); A[S] = row
    print(S, len(L), "Alliance", len(FA), "FA Cup", "pos", row['pos'], "fac", fac)
dump([A[k] for k in sorted(A)], allp); stamp("early", "Newton Heath 1886–92")
