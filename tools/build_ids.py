"""Match-centre ids for archived matches: the live feed knows every United fixture from 2010/11, so each archive row from then on
gets the fixture id that /manutd/match/?id= understands. One cached feed call per season; a season is skipped once every row has an id.
Writes the ids into history/data/<season>.json and tools/data/cups.json."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); cp = os.path.join(ROOT, "tools", "data", "cups.json"); cups = json.load(open(cp)); chc = False
for y in range(2010, 2025):
    S = sid(y); f = os.path.join(H, "data", S + ".json")
    if not os.path.exists(f): continue
    d = json.load(open(f)); rows = d['results'] + [r for r in cups if r['s'] == S]
    if all(r.get('id') for r in rows): continue
    try: jj = get(f"/api/season-fixtures?season={y}&v=3")
    except Exception as e: print("feed", y, e); continue
    byd = {}
    for m in jj.get('response', []):
        if m['fixture']['status']['short'] in ('FT', 'AET', 'PEN') and 'riendl' not in m['league']['name']: byd[m['fixture']['date'][:10]] = m['fixture']['id']
    n = 0
    for r in rows:
        if not r.get('id') and byd.get(r['d']): r['id'] = byd[r['d']]; n += 1; chc = chc or r in cups
    dump(d, f); print(S, n, "ids added of", len(rows))
json.dump(cups, open(cp, 'w'), ensure_ascii=False, separators=(',', ':'))
