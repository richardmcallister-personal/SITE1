"""Who wore this number: squad numbers, apps and goals per season from the Wikipedia season articles (1993/94 onwards),
fetched through the Worker's /wiki-raw route. Writes static/manutd/numbers/numbers.json."""
import json, os, re, sys, time, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
OUT = os.path.join(STATIC, "numbers", "numbers.json")
def section(wt):
    m = re.search(r'==+\s*(?:Squad statistics|Player statistics|Statistics|Squad|Appearances and goals|Players)\s*==+([\s\S]*?)(?=\n==[^=]|\Z)', wt)
    return m.group(1) if m else ''
def strip_templates(row):
    out = ''; d = 0; i = 0
    while i < len(row):
        if row.startswith('{{', i): d += 1; i += 2; continue
        if row.startswith('}}', i) and d > 0: d -= 1; i += 2; continue
        if d == 0: out += row[i]
        i += 1
    return out
def cells(row):
    row = strip_templates(re.sub(r'<ref[^>]*/>|<ref[\s\S]*?</ref>', '', row)); parts = []
    for line in row.split('\n'):
        line = line.strip()
        if not line.startswith('|') or line.startswith('|-') or line.startswith('|}'): continue
        for c in line[1:].split('||'):
            c = re.sub(r'^[^|]*\|(?=[^|\[]*$)', '', c) if '=' in c.split('|')[0] and '[[' not in c.split('|')[0] else c
            parts.append(c.strip())
    return parts
def header_cols(tbl):
    first = tbl.split('\n|-')[1] if '\n|-' in tbl else tbl; cols = []
    for line in first.split('\n'):
        line = line.strip()
        if not line.startswith('!'): continue
        for cell in line[1:].split('!!'):
            attrs, _, label = cell.rpartition('|') if '|' in cell else ('', '', cell)
            m = re.search(r'colspan="?(\d+)', attrs); cols += [label.strip()] * (int(m.group(1)) if m else 1)
    tot = [i for i, c in enumerate(cols) if c.lower().startswith('total')]
    return (len(cols) - tot[0]) if tot else None
def parse(wt):
    out = []
    for tbl in re.findall(r'\{\|[\s\S]*?\n\|\}', section(wt)):
        from_end = header_cols(tbl)
        if from_end is None: continue
        for row in tbl.split('\n|-')[2:]:
            cs = cells(row)
            if len(cs) < from_end + 1: continue
            m = re.match(r'^(\d{1,2})$', cs[0])
            if not m: continue
            nm = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', strip_templates(re.sub(r'<ref[^>]*/>|<ref[\s\S]*?</ref>', '', row)))
            if not nm: continue
            ta, tg = cs[len(cs) - from_end], cs[len(cs) - from_end + 1]
            def n(x): mm = re.match(r'^(\d+)(?:\((\d+)\))?', x); return (int(mm.group(1)) + int(mm.group(2) or 0)) if mm else 0
            def g(x): mm = re.match(r'^(\d+)', x); return int(mm.group(1)) if mm else 0
            pos = next((c[:2] for c in cs[1:4] if re.match(r'^(GK|DF|MF|FW)', c)), cs[1][:3])   # 1996–2000 tables carry a "CL no." column before Pos.
            out.append(dict(no=int(m.group(1)), pos=pos, name=(nm.group(2) or nm.group(1)).strip(), title=nm.group(1).strip(), apps=n(ta), goals=g(tg)))
    return out
res = json.load(open(OUT)) if os.path.exists(OUT) else {}
Y = season_now()
for y in range(1993, Y + 1):
    title = f"{y}–{str(y + 1) if y % 100 == 99 else str(y + 1)[2:]} Manchester United F.C. season"
    try:
        wt = get("/wiki-raw?title=" + urllib.parse.quote(title))
    except Exception as e:
        print("no article", title, e); continue
    rows = parse(wt) if isinstance(wt, str) else []
    if rows: res[sid(y)] = rows
    print(y, len(rows), "rows"); time.sleep(0.5)
dump(res, OUT); stamp("numbers", f"{len(res)} seasons")
