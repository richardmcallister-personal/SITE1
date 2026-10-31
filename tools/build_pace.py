"""League pace by games played, every season in the archive: cumulative points (three for a win throughout, so eras compare),
goal difference and position-in-table-at-the-end, after each league game. Lets the Season page say where this season's points
after N games sit against the other 120-odd seasons at the same stage. Writes static/manutd/history/pace.json."""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); out = {}
for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f)); L = sorted([m for m in d['results'] if m['c'] == 'L'], key=lambda m: m['d'])
    pts, gd, run = 0, 0, []
    for m in L:
        pts += 3 if m['gf'] > m['ga'] else 1 if m['gf'] == m['ga'] else 0; gd += m['gf'] - m['ga']; run.append([pts, gd])
    out[d['id']] = dict(div=d['div'], tier=int(d['tier']), pos=d['pos'], teams=d['teams'], n=len(L), run=run, pts3=pts)
dump(out, os.path.join(H, "pace.json")); stamp("pace", f"{len(out)} seasons")
print(len(out), "seasons;", "best 10-game starts:", sorted(((v['run'][9][0], s) for s, v in out.items() if len(v['run']) >= 10), reverse=True)[:5])
