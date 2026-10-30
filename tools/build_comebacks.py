"""Comeback collection: classify every finished United match from 2010/11 onwards from its minute-by-minute events.
Incremental — only fixtures not yet in tools/data/events_seen.json are fetched. Writes static/manutd/comebacks/api.json."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
SEEN = os.path.join(ROOT, "tools", "data", "events_seen.json"); OUT = os.path.join(STATIC, "comebacks", "api.json")
seen = set(json.load(open(SEEN))) if os.path.exists(SEEN) else set()
rows = {r["id"]: r for r in (json.load(open(OUT)) if os.path.exists(OUT) else [])}
Y = season_now()
fixtures = []
for y in (Y - 1, Y):   # last season and this one; everything earlier is already classified
    j = get(f"/api/season-fixtures?season={y}&v=3" if y < Y else "/api/fixtures?v=3")
    fixtures += [m for m in j["response"] if m["fixture"]["status"]["short"] in ("FT", "AET", "PEN")]
todo = [m for m in fixtures if m["fixture"]["id"] not in seen]
print(len(todo), "new finished matches to classify")

def classify(m, ev):
    home = m["teams"]["home"]["id"] == TEAM; opp = m["teams"]["away"] if home else m["teams"]["home"]
    gf = m["goals"]["home"] if home else m["goals"]["away"]; ga = m["goals"]["away"] if home else m["goals"]["home"]
    won, drew = gf > ga, gf == ga
    pen = m["fixture"]["status"]["short"] == "PEN"; penwin = pen and (m["teams"]["home"]["winner"] if home else m["teams"]["away"]["winner"])
    goals = sorted([e for e in ev if e["type"] == "Goal" and e["detail"] != "Missed Penalty" and e["time"]["elapsed"] is not None], key=lambda e: (e["time"]["elapsed"], e["time"].get("extra") or 0))
    us = them = maxdef = 0; tl = []; low = None
    for e in goals:
        t = e["time"]["elapsed"] + (e["time"].get("extra") or 0); mine = e["team"]["id"] == TEAM   # own goals are credited to the team that benefits
        if mine: us += 1
        else: them += 1
        tl.append(dict(t=e["time"]["elapsed"], x=e["time"].get("extra") or 0, us=us, them=them, player=e["player"]["name"], mine=mine, pen=e["detail"] == "Penalty", og=e["detail"] == "Own Goal"))
        if them - us > maxdef: maxdef = them - us; low = dict(t=t, score=f"{us}–{them}")
    reds = [e for e in ev if e["type"] == "Card" and e["detail"] in ("Red Card", "Second Yellow card") and e["team"]["id"] == TEAM and e["time"]["elapsed"] is not None]
    tags = []
    if maxdef >= 2 and (won or drew): tags.append("two-down")
    elif maxdef >= 1 and won: tags.append("from-behind")
    if tl:
        last = tl[-1]
        if last["mine"] and won and last["us"] - last["them"] == 1 and last["t"] >= 90: tags.append("injury-time-winner")
        elif last["mine"] and won and last["us"] - last["them"] == 1 and last["t"] >= 85: tags.append("late-winner")
        if last["mine"] and drew and last["t"] >= 89: tags.append("late-equaliser")
    if reds and (won or drew) and min(e["time"]["elapsed"] for e in reds) <= 75: tags.append("ten-men")
    if penwin: tags.append("penalties")
    if gf >= 4 and ga >= 3: tags.append("thriller")
    if not tags or "riendl" in m["league"]["name"]: return None
    rnd = m["league"]["round"]
    return dict(id=m["fixture"]["id"], date=m["fixture"]["date"][:10], season=m["league"]["season"], comp=m["league"]["name"], round="" if "Regular Season" in rnd else rnd, home=home, opp=opp["name"], score=f"{gf}–{ga}", aet=m["fixture"]["status"]["short"] == "AET", pen=pen, tags=tags, low=low, reds=[dict(t=e["time"]["elapsed"], player=e["player"]["name"]) for e in reds], goals=tl, venue=m["fixture"]["venue"]["name"])

for m in todo:
    fid = m["fixture"]["id"]
    try:
        ev = get(f"/api/events?fixture={fid}&v=3")["response"]
    except Exception as e:
        print("skip", fid, e); continue
    r = classify(m, ev)
    if r: rows[fid] = r; print("tagged", r["date"], r["opp"], r["score"], r["tags"])
    seen.add(fid); time.sleep(1.2)
out = sorted(rows.values(), key=lambda r: r["date"], reverse=True)
dump(out, OUT); json.dump(sorted(seen), open(SEEN, "w"))
stamp("comebacks", f"{len(out)} matches tagged; {len(seen)} classified")
print(len(out), "tagged matches written")
