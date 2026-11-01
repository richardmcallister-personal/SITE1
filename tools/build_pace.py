"""League pace by games played, every season in the archive: cumulative points (three for a win throughout, so eras compare),
goal difference and position-in-table-at-the-end, after each league game. Lets the Season page say where this season's points
after N games sit against the other 120-odd seasons at the same stage, and draw any season against this one.
Per season: run [[pts,gd],...] (three a win), m [[home 1/0, gf, ga],...] for every league game in date order (so the page can
split home/away, two points a win, goals), w2 1 when two points a win applied at the time (before 1981-82).
Seasons the match archive lacks after its last file (e.g. last season) come from the live feed; the current season is left to
the page, which reads it live. Writes static/manutd/history/pace.json."""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); out = {}

def add(s, div, tier, pos, teams, L):
    pts, gd, run, m = 0, 0, [], []
    for g in L:
        pts += 3 if g['gf'] > g['ga'] else 1 if g['gf'] == g['ga'] else 0; gd += g['gf'] - g['ga']; run.append([pts, gd])
        m.append([1 if g['h'] else 0, g['gf'], g['ga']])
    if L: out[s] = dict(div=div, tier=int(tier or 0), pos=pos, teams=teams, n=len(L), run=run, pts3=pts, m=m, w2=1 if int(s[:4]) < 1981 else 0)

for f in sorted(glob.glob(H + '/data/*.json')):
    d = json.load(open(f))
    add(d['id'], d['div'], d['tier'], d['pos'], d['teams'], sorted([m for m in d['results'] if m['c'] == 'L'], key=lambda m: m['d']))

last = max(int(s[:4]) for s in out) if out else season_now() - 1
for y in range(last + 1, season_now()):   # finished seasons not yet in the match archive
    S = sid(y)
    try:
        fx = get(f"/api/season-fixtures?season={y}&v=3")['response']
        L = []
        for x in sorted(fx, key=lambda x: x['fixture']['date']):
            if x['league']['name'] != 'Premier League' or x['fixture']['status']['short'] not in ('FT', 'AET', 'PEN'): continue
            home = x['teams']['home']['id'] == TEAM
            L.append(dict(h=home, gf=x['goals']['home' if home else 'away'], ga=x['goals']['away' if home else 'home']))
        st = get(f"/api/season-standings?season={y}&v=3")['response'][0]['league']['standings'][0]
        me = [r for r in st if r['team']['id'] == TEAM]
        add(S, 'Premier League', 1, me[0]['rank'] if me else None, len(st), L)
    except Exception as e: print(S, "from the feed failed:", e)

dump(out, os.path.join(H, "pace.json")); stamp("pace", f"{len(out)} seasons")
print(len(out), "seasons;", "best 10-game starts:", sorted(((v['run'][9][0], s) for s, v in out.items() if len(v['run']) >= 10), reverse=True)[:5])
