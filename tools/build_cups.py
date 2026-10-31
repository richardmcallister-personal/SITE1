"""Charity Shield, League Cup, European and other cup matches 1908–2024/25 (and the FA Cup from 2019/20) from the Wikipedia season articles (the match archive only has
league and FA Cup). Writes tools/data/cups.json rows {d, c, h, o, gf, ga, s, div, r} consumed by build_clubs.py and build_onthisday.py."""
import json, os, re, sys, time, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
OUT = os.path.join(ROOT, "tools", "data", "cups.json")
SECT = [("FA Cup", "FAC"), ("League Cup", "LC"), ("EFL Cup", "LC"), ("Football League Cup", "LC"), ("Carabao Cup", "LC"),
        ("UEFA Champions League", "UCL"), ("Champions League", "UCL"), ("European Cup", "UCL"),
        ("UEFA Europa League", "UEL"), ("Europa League", "UEL"), ("UEFA Cup", "UEL"), ("Inter-Cities Fairs Cup", "UEL"),
        ("Cup Winners' Cup", "CWC"), ("European Cup Winners' Cup", "CWC"), ("UEFA Cup Winners' Cup", "CWC"),
        ("UEFA Super Cup", "SC"), ("European Super Cup", "SC"), ("Super Cup", "SC"),
        ("Intercontinental Cup", "ICC"), ("FIFA Club World Cup", "CWCup"), ("Club World Cup", "CWCup"), ("Club World Championship", "CWCup"),
        ("Community Shield", "CS"), ("Charity Shield", "CS"), ("FA Community Shield", "CS"), ("FA Charity Shield", "CS")]
MON = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1)}
def clean(t):
    t = re.sub(r'<ref[^>]*/>|<ref[\s\S]*?</ref>', '', t); t = re.sub(r'<br\s*/?>', ' ', t); t = re.sub(r'<[^>]+>', '', t)
    t = re.sub(r'\{\{[^{}]*\}\}', '', t); t = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', t); t = re.sub(r'\[https?:[^\s\]]*\s?([^\]]*)\]', r'\1', t)
    return re.sub(r'\s+', ' ', t).strip()
def date(t):
    m = re.search(r'(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})', clean(t))
    if not m or m.group(2) not in MON: return None
    return f"{m.group(3)}-{MON[m.group(2)]:02d}-{int(m.group(1)):02d}"
def sections(wt):
    out = []
    for m in re.finditer(r'\n==+\s*([^=\n]+?)\s*==+\n', wt):
        name = clean(m.group(1))
        for label, code in SECT:
            if name.lower().startswith(label.lower()) or name.lower() == label.lower():
                out.append((code, name, m.end())); break
    return out
def parse_tables(seg, code, name, sid):
    rows = []
    for tbl in re.findall(r'\{\|[\s\S]*?\n\|\}', seg):
        hdr = [clean(h).lower() for h in re.findall(r'\n!\s*(?:scope="col"\s*\|)?([^\n]*)', tbl.split('\n|-')[0] + '\n' + (tbl.split('\n|-')[1] if '\n|-' in tbl else ''))]
        prev_opp = None
        for row in tbl.split('\n|-')[1:]:
            cells = [c.strip() for c in re.split(r'\n\|(?!\})', '\n' + row.strip())[1:]]
            cells = [c for c in cells if not c.startswith('-')]
            if len(cells) < 5: continue
            d = date(cells[0]); 
            if not d: continue
            # find opponent, H/A, score by shape
            opp = None; ha = None; sc = None; rnd = ''
            for c in cells[1:6]:
                cc = re.sub(r'^rowspan="?\d+"?\s*\|\s*', '', clean(c))
                if re.search(r"\d+'", cc): continue   # scorers cell
                if re.fullmatch(r'[HAN]', cc): ha = cc
                elif re.fullmatch(r'\d+\s*[–-]\s*\d+(?:\s*\(.*\))?', cc) and sc is None: sc = cc
                elif re.search(r'round|final|group|leg|quarter|semi|play|matchday|phase|stage', cc, re.I) and not rnd: rnd = cc
                elif '[[' in c and opp is None and not re.search(r'^\d', cc): opp = cc
            if opp is None and sc and prev_opp and re.search(r'second leg|replay', rnd, re.I): opp = prev_opp   # rowspan'd opponent cell
            if not (opp and sc): continue
            prev_opp = opp
            m = re.match(r'(\d+)\s*[–-]\s*(\d+)', sc); gf, ga = int(m.group(1)), int(m.group(2))
            rows.append(dict(d=d, c=code, h=(ha == 'H'), n=(ha == 'N'), o=opp, gf=gf, ga=ga, s=sid, div=name, r=rnd))
    return rows
def parse_boxes(seg, code, name, sid):
    rows = []
    for box in re.findall(r'\{\{[Ff]ootball ?box[\s\S]*?\n\}\}', seg):
        f = dict(re.findall(r'\|\s*([a-z0-9_]+)\s*=\s*([^\n|]*)', box))
        d = date(f.get('date', '')); 
        if not d or 'score' not in f: continue
        t1, t2 = clean(f.get('team1', '')), clean(f.get('team2', ''))
        m = re.match(r'(\d+)\s*[–-]\s*(\d+)', clean(f['score']))
        if not m: continue
        home = 'Manchester United' in t1
        if not home and 'Manchester United' not in t2: continue
        gf, ga = (int(m.group(1)), int(m.group(2))) if home else (int(m.group(2)), int(m.group(1)))
        rows.append(dict(d=d, c=code, h=home, o=(t2 if home else t1), gf=gf, ga=ga, s=sid, div=name, r=clean(f.get('round', ''))))
    return rows
Y = season_now()
STATE = os.path.join(ROOT, "tools", "data", "wiki_revs_cups.json")
def stitle(y): return f"{y}–{str(y + 1) if y % 100 == 99 else str(y + 1)[2:]} Manchester United F.C. season"
YEARS = list(range(1902, 2021))   # Charity Shields from 1908, Europe from 1956, League Cup from 1960; the live feed covers cups from 2021/22 and build_clubs.py the seasons after
todo, revs = wiki_changed([stitle(y) for y in YEARS], STATE)
old = json.load(open(OUT)) if os.path.exists(OUT) else []
all_rows = [r for r in old if r['s'] not in {sid(y) for y in YEARS if stitle(y) in todo} and r['s'] < sid(2021)]   # unchanged seasons keep their rows
print(len(todo), "of", len(YEARS), "season articles changed")
done = []
for y in YEARS:
    title = stitle(y)
    if title not in todo: continue
    sid_ = sid(y)
    try: wt = wiki_raw(title, revs.get(title))
    except Exception as e: print("no article", y, e); continue
    if not isinstance(wt, str): continue
    secs = sections(wt); n0 = len(all_rows)
    for i, (code, name, start) in enumerate(secs):
        end = secs[i + 1][2] if i + 1 < len(secs) else len(wt)
        nxt = re.search(r'\n==[^=]', wt[start:]); end = min(end, start + nxt.start()) if nxt else end
        seg = wt[start:end]
        rows = parse_tables(seg, code, name, sid_) or parse_boxes(seg, code, name, sid_)
        all_rows += rows
    done.append(title); print(y, len(all_rows) - n0, [c for c, _, _ in secs]); time.sleep(0.4)
save_revs(STATE, revs, done)
# From 2021/22 the live feed has every cup match (with extra time and penalties), so it replaces the article parse.
COMP = {'FA Cup': 'FAC', 'League Cup': 'LC', 'UEFA Champions League': 'UCL', 'UEFA Europa League': 'UEL', 'Community Shield': 'CS', 'UEFA Super Cup': 'SC', 'FIFA Club World Cup': 'CWCup'}
for y in range(2021, 2025):
    try: jj = get(f"/api/season-fixtures?season={y}&v=3")
    except Exception as e: print("api", y, e); continue
    api = []
    for m in jj.get('response', []):
        if m['fixture']['status']['short'] not in ('FT', 'AET', 'PEN') or m['league']['name'] not in COMP: continue
        home = m['teams']['home']['id'] == TEAM; opp = (m['teams']['away'] if home else m['teams']['home'])['name']
        gf = m['goals']['home'] if home else m['goals']['away']; ga = m['goals']['away'] if home else m['goals']['home']
        rec = dict(d=m['fixture']['date'][:10], c=COMP[m['league']['name']], h=home, n=False, o=opp, gf=gf, ga=ga, s=sid(y), div=m['league']['name'], r=m['league']['round'] if 'Regular Season' not in m['league']['round'] else '', id=m['fixture']['id'])
        if m['fixture']['status']['short'] == 'AET': rec['aet'] = True
        if m['fixture']['status']['short'] == 'PEN' and m['score']['penalty']['home'] is not None: rec['pens'] = f"{m['score']['penalty']['home' if home else 'away']}–{m['score']['penalty']['away' if home else 'home']}"
        api.append(rec)
    if api:
        all_rows = [r for r in all_rows if r['s'] != sid(y)] + api; print("api", y, len(api))
seen = set(); out = []
for r in all_rows:
    if r['c'] == 'FAC' and r['s'] < '2019-20': continue   # the archive has the FA Cup to 2018/19
    k = (r['d'], r['o'], r['c'])
    if k in seen: continue
    seen.add(k); out.append(r)
out.sort(key=lambda r: r['d'])
json.dump(out, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
stamp("cups", f"{len(out)} cup and European matches 1956–2025")
print(len(out), "rows")
