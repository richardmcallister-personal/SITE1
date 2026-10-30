"""On this day: every United match in the archive indexed by calendar day (MM-DD), with the ones worth telling first.
Writes static/manutd/history/onthisday.json. Sources: history/data (to 2024/25), history/clubs (2025/26 onwards), seasons.json, comebacks."""
import json, os, sys, glob, collections
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history")
by = collections.defaultdict(list); seen = set()
def add(m, s, div):
    k = (m['d'], m['o'])
    if k in seen: return
    seen.add(k); by[m['d'][5:]].append(dict(d=m['d'], s=s, h=m['h'], o=m['o'], gf=m['gf'], ga=m['ga'], c=m['c'], div=div, r=m.get('r', ''), id=m.get('id')))
for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f))
    for r in d['results']: add(r, d['id'], d['div'] if r['c'] == 'L' else 'FA Cup')
for f in glob.glob(H + '/clubs/*.json'):
    for m in json.load(open(f))['matches']:
        if m['c'] not in ('L',) or m['s'] >= '2025-26': add(m, m['s'], m.get('div', ''))   # cups from build_cups.py and recent seasons
S = {s['id']: s for s in json.load(open(H + '/seasons.json'))}
key = {}
for s in S.values():
    for m in s['matches']: key[(m['date'], )] = dict(s=s['id'], comp=m['comp'], home=m['home'], away=m['away'], score=m['score'], scorers=m.get('scorers', ''))
CB = {}
for f in ('classics.json', 'api.json'):
    p = os.path.join(STATIC, 'comebacks', f)
    if os.path.exists(p):
        for c in json.load(open(p)): CB[c['date']] = c['tags']
out = {}
for md, ms in by.items():
    for m in ms:
        k = key.get((m['d'],)); m['key'] = bool(k)
        if k: m['scorers'] = k['scorers']; m['comp'] = k['comp']
        m['tags'] = CB.get(m['d'], [])
        gd = m['gf'] - m['ga']
        m['w'] = (6 if k else 0) + (4 if m['tags'] else 0) + (3 if abs(gd) >= 4 else 2 if abs(gd) == 3 else 0) + (1 if m['c'] != 'L' else 0) + (1 if m['gf'] + m['ga'] >= 6 else 0)
    ms.sort(key=lambda m: (-m['w'], m['d']))
    out[md] = ms
dump(out, os.path.join(H, 'onthisday.json'))
stamp("onthisday", f"{sum(len(v) for v in out.values())} matches across {len(out)} days")
print(len(out), "days;", sum(len(v) for v in out.values()), "matches")
