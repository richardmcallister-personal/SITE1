"""Before squad numbers (1993/94), shirts 1–11 went with positions. The one place the numbers are recorded match by match is
Wikipedia's final articles, which list both line-ups with shirt numbers. This pulls United's XI (and bench) from every final
up to 1992/93 and writes static/manutd/numbers/finals.json, read by the numbers page. CC BY-SA 4.0."""
import json, os, re, sys, urllib.parse, time
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
FINALS = ["1908 FA Charity Shield", "1909 FA Cup final", "1911 FA Charity Shield", "1948 FA Cup final", "1948 FA Charity Shield", "1952 FA Charity Shield",
          "1956 FA Charity Shield", "1957 FA Cup final", "1957 FA Charity Shield", "1958 FA Cup final", "1963 FA Cup final", "1963 FA Charity Shield", "1965 FA Charity Shield",
          "1967 FA Charity Shield", "1968 European Cup final", "1976 FA Cup final", "1977 FA Cup final", "1977 FA Charity Shield", "1979 FA Cup final",
          "1983 Football League Cup final", "1983 FA Cup final", "1983 FA Charity Shield", "1985 FA Cup final", "1985 FA Charity Shield", "1990 FA Cup final", "1990 FA Charity Shield",
          "1991 Football League Cup final", "1991 European Cup Winners' Cup final", "1991 European Super Cup", "1992 Football League Cup final"]
MGRS = json.load(open(os.path.join(STATIC, "history", "managers.json"))); MNAMES = {m['name'] for m in MGRS} | {'Jimmy Murphy', 'Matt Busby', 'Alex Ferguson'}
def clean(t):
    t = re.sub(r'<ref[^>]*/>|<ref[\s\S]*?</ref>|<[^>]+>', '', t); t = re.sub(r'\{\{[^{}]*\}\}', '', t); t = re.sub(r"'''", '', t); t = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', t)
    return re.sub(r'\s+', ' ', t).strip()
MON = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 1)}
def date(t):
    sd = re.search(r'\{\{[Ss]tart date\|(\d{4})\|(\d{1,2})\|(\d{1,2})', t)
    if sd: return f"{sd.group(1)}-{int(sd.group(2)):02d}-{int(sd.group(3)):02d}"
    m = re.search(r'(\d{1,2}) (\w+) (\d{4})', t); return f"{m.group(3)}-{MON[m.group(2)]:02d}-{int(m.group(1)):02d}" if m and m.group(2) in MON else None
out = []
for T in FINALS:
    try: wt = get("/wiki-raw?title=" + urllib.parse.quote(T))
    except Exception as e: print("no article", T, e); continue
    if not isinstance(wt, str): print("skip", T); continue
    boxes = [m.group(0) for m in re.finditer(r'\{\{[Ff]ootball ?box[\s\S]*?\n\}\}', wt)]
    yr = T[:4]; inpost = {m['name'] for m in MGRS if m['from'] and m['from'] <= yr + '-12-31' and (m['to'] is None or m['to'] >= yr + '-01-01')} | ({'Jimmy Murphy'} if yr == '1958' else set())
    # line-up tables: rows "|POS ||'''N''' ||{{flagicon}} [[Name]]"; a block ends at its Manager row
    blocks = re.findall(r"((?:\|[A-Z]{2,3} \|\|'''[^']*'''[^\n]*\n\|-\n)+[\s\S]*?'''Managers?:'''[\s\S]*?\n\|\})", wt)
    if not blocks: blocks = re.findall(r"((?:\|[A-Z]{2,3} \|\|'''[^']*'''[^\n]*\n\|-\n)+)", wt)
    utd = []
    for b in blocks:
        mgr = re.search(r"'''Managers?:'''[\s\S]*?\[\[([^\]|]+)", b)
        names = re.findall(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", b)
        if mgr and any(n.split()[-1] in mgr.group(1) for n in inpost): utd.append(b)
        elif not mgr: print("  block without manager", T)
    if not utd: print("no United block", T, len(blocks)); continue
    for k, b in enumerate(utd):
        box = boxes[k] if k < len(boxes) else (boxes[0] if boxes else '')
        f = dict(re.findall(r'\|[ \t]*(\w+)[ \t]*=[ \t]*([^\n]*)', box))
        if not box:   # Shield articles without a match box: take the Infobox football match
            ib = re.search(r'\{\{Infobox football match[\s\S]*?\n\}\}', wt)
            if ib:
                g = dict(re.findall(r'\|[ \t]*(\w+)[ \t]*=[ \t]*([^\n]*)', ib.group(0)))
                f = dict(team1=g.get('team1', ''), team2=g.get('team2', ''), score=f"{g.get('team1score', '')}–{g.get('team2score', '')}", date=g.get('date', ''), stadium=g.get('stadium', ''), penaltyscore=g.get('team1penaltyscore', '') and f"{g.get('team1penaltyscore')}–{g.get('team2penaltyscore', '')}")
        t1, t2 = clean(f.get('team1', '')), clean(f.get('team2', '')); home = 'Manchester United' in t1
        opp = t2 if home else t1; sc = re.search(r'(\d+)\s*[–-]\s*(\d+)', f.get('score', ''))
        gf, ga = (int(sc.group(1)), int(sc.group(2))) if sc else (None, None)
        if sc and not home: gf, ga = ga, gf
        xi, subs, phase = [], [], 'xi'
        for row in b.split('\n|-'):
            if 'Substitute' in row: phase = 'sub'
            m = re.match(r"\s*\|([A-Z]{2,3}) \|\|'''([^']*)'''\s*\|\|(.*)", row.strip())
            if not m: continue
            nm = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", m.group(3))
            if not nm: continue
            p = dict(pos=m.group(1), no=int(m.group(2)) if m.group(2).strip().isdigit() else None, name=(nm.group(2) or nm.group(1)).strip(), title=nm.group(1).strip())
            if '(association football)|c]]' in m.group(3) or '|c]]' in m.group(3): p['cap'] = True
            so = re.search(r'\{\{subo(?:n|ff)\|(\d+)', m.group(3));
            if so: p['sub'] = int(so.group(1))
            (xi if phase == 'xi' else subs).append(p)
        if not xi: continue
        mgr = re.search(r"'''Managers?:'''[\s\S]*?\[\[([^\]|]+)(?:\|([^\]]+))?", b)
        comp = re.sub(r'^\d{4}(–\d{2})? ', '', T).replace(' final', '').replace('Football League Cup', 'League Cup').replace('FA Charity Shield', 'Charity Shield')
        rec = dict(title=T + (' (replay)' if k > 0 and len(utd) > 1 else ''), comp=comp, d=date(f.get('date', '')) or T[:4], o=opp, gf=gf, ga=ga, venue=clean(f.get('stadium', '')).split(',')[0], mgr=(mgr.group(2) or mgr.group(1)).strip() if mgr else None, xi=xi, subs=subs,
                   pens=clean(f.get('penaltyscore', '')) or None, aet=bool(f.get('aet', '').strip()), url="https://en.wikipedia.org/wiki/" + urllib.parse.quote(T.replace(' ', '_')))
        out.append(rec); print(T, k, rec['d'], opp, gf, ga, [(p['no'], p['name']) for p in xi][:3], len(subs))
    time.sleep(0.3)
out.sort(key=lambda r: r['d'])
dump(out, os.path.join(STATIC, "numbers", "finals.json")); stamp("finals", f"{len(out)} finals with line-ups")
print(len(out), "line-ups")
