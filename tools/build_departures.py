"""Where did they go? For every player who left United from 1990/91 on (10+ apps or 2+ seasons) and every former
manager, read the Wikipedia article (incrementally, through the Worker's /wiki-raw) and keep: the club career from the
infobox (playing and managerial spells), the first club after United, and the honours won after leaving (winners only,
from the article's Honours section, club and international, dated on or after the year he left).
Writes static/manutd/history/departures.json. Article text is CC BY-SA 4.0."""
import json, os, re, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__)); from lib import *
H = os.path.join(STATIC, "history"); OUT = os.path.join(H, "departures.json")
STATE = os.path.join(ROOT, "tools", "data", "wiki_revs_departures.json")
NOW = sid(season_now())

def clean(t):
    t = re.sub(r'<ref[^>]*/>|<ref[^>]*>.*?</ref>', '', t, flags=re.S)
    for _ in range(3): t = re.sub(r'\{\{(?:nowrap|nobr|small|lang\|[a-z-]+)\|([^{}]*)\}\}', r'\1', t, flags=re.I)
    t = re.sub(r'\{\{(?:sortname)\|([^|{}]*)\|([^|{}]*)[^{}]*\}\}', r'\1 \2', t, flags=re.I)
    t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'(\{\{|<ref).*$', '', t, flags=re.S)   # a template or ref left open at the end of the line
    t = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', t)
    t = re.sub(r"'{2,}", '', t); t = re.sub(r'<[^>]+>', '', t); t = t.replace('&nbsp;', ' ')
    return re.sub(r'\s+', ' ', t).strip(' ,;')

def infobox(w):
    i = w.find('{{Infobox football biography')
    if i < 0: i = w.lower().find('{{infobox football biography')
    if i < 0: return {}
    d, j = 0, i
    while j < len(w):
        if w.startswith('{{', j): d += 1; j += 2; continue
        if w.startswith('}}', j):
            d -= 1; j += 2
            if d == 0: break
            continue
        j += 1
    box, P = w[i + 2:j - 2], {}
    # split on top-level pipes only (not inside [[ ]] or {{ }}), so several fields on one line still parse
    parts, d, cur, k = [], 0, '', 0
    while k < len(box):
        two = box[k:k + 2]
        if two in ('[[', '{{'): d += 1; cur += two; k += 2; continue
        if two in (']]', '}}'): d -= 1; cur += two; k += 2; continue
        if box[k] == '|' and d == 0: parts.append(cur); cur = ''; k += 1; continue
        cur += box[k]; k += 1
    parts.append(cur)
    for part in parts[1:]:
        if '=' in part:
            key, val = part.split('=', 1); key = key.strip()
            if re.fullmatch(r'[a-z_]+\d*', key): P[key] = val.strip()
    # the template accepts manager_years1 / manageryears1, current_club / currentclub …: normalise to the short form
    for k in list(P):
        s2 = re.sub(r'^(manager|national|current|club)_', r'\1', k)
        if s2 != k and s2 not in P: P[s2] = P[k]
    return P

def spells(P, yk, ck, extra=()):
    out = []
    for n in range(1, 60):
        c = P.get(f'{ck}{n}')
        if c is None: continue
        c0 = c; c = clean(c); y = clean(P.get(f'{yk}{n}', ''))
        if not c: continue
        loan = '→' in c0 or '(loan)' in c.lower() or '→' in y
        c = re.sub(r'^→\s*', '', c).replace('(loan)', '').strip()
        row = dict(y=y.replace('→', '').strip(), c=c)
        if loan: row['loan'] = 1
        for k, key in extra:
            v = clean(P.get(f'{k}{n}', '')).strip('()')
            if v: row[key] = v
        out.append(row)
    return out

def yr(s):
    m = re.search(r'(\d{4})', s or ''); return int(m.group(1)) if m else None
def endyr(s):
    m = re.findall(r'(\d{4})', s or ''); return int(m[-1]) if len(m) > 1 else (None if re.search(r'[–-]\s*$', s or '') else (int(m[0]) if m else None))

UTD = re.compile(r'Manchester United|Newton Heath', re.I)
SKIP = re.compile(r'^(individual|orders?|records?|player|manager|assistant|club|international|honours|decorations|see also)\b', re.I)

def honours(w, left):
    m = re.search(r'\n==\s*Honours\s*==\s*\n(.*?)(?=\n==[^=])', w, flags=re.S)
    if not m: return []
    out, grp, role = [], None, ''
    for line in m.group(1).split('\n'):
        s = line.strip()
        h = re.match(r'^===+\s*(.*?)\s*===+$', s)
        if h: role = clean(h.group(1)); grp = None; continue
        h = re.match(r"^(?:;\s*(.+)|'''(.+?)'''(?:<ref.*)?$)", s)
        if h:
            grp = clean(h.group(1) or h.group(2)); continue
        if not s.startswith('*') or not grp: continue
        if UTD.search(grp) or SKIP.match(grp) or re.search(r'individual', role, re.I): continue
        txt = clean(s.lstrip('*'))
        txt = re.split(r';?\s*runners?-up|;?\s*third place|;?\s*finalist', txt, flags=re.I)[0]
        if ':' not in txt: continue
        comp, yrs = txt.split(':', 1)
        ys = [y.strip(' ,;.') for y in re.split(r',', yrs) if re.search(r'\d{4}', y)]
        ys = [y for y in ys if yr(y) and yr(y) >= left]
        if ys: out.append(dict(g=grp, c=comp.strip(), y=ys, r=('manager' if re.search(r'manag|coach', role, re.I) else 'player')))
    return out

def main():
    P = json.load(open(H + '/players_index.json')); M = json.load(open(H + '/managers.json'))
    people = {}
    for p in P:
        if p['last'] >= '1990-91' and p['last'] < NOW and ((p.get('apps') or 0) >= 10 or (p.get('seasons') or 0) >= 2):
            people.setdefault(p['t'], dict(t=p['t'], n=p['n'], kind=['player'], u=dict(first=p['first'], last=p['last'], apps=p.get('apps'), g=p.get('g')), url='/manutd/player/?p=' + urllib.parse.quote(p['t'])))
    for m in M:
        if not m.get('to'): continue
        t = m['name']; e = people.setdefault(t, dict(t=t, n=m['name'], kind=[], url='/manutd/manager/?m=' + m['slug']))
        if 'manager' not in e['kind']: e['kind'].append('manager')
        e.setdefault('m', []).append(dict(fr=m['from'], to=m['to'], role=m.get('role'), slug=m['slug']))
        if e['kind'] == ['manager']: e['url'] = '/manutd/manager/?m=' + m['slug']
    titles = sorted(people)
    try: old = {r['t']: r for r in json.load(open(OUT))}
    except Exception: old = {}
    todo, revs = wiki_changed(titles, STATE); todo = set(todo); done = []
    out = []
    for t in titles:
        e = people[t]
        if t not in todo and t in old:
            r = old[t]; r.update({k: e[k] for k in ('n', 'kind', 'url')}); r['u'] = e.get('u'); r['m'] = e.get('m'); out.append(r); continue
        try: w = wiki_raw(t, revs.get(t))
        except Exception as x: print('skip', t, x); (out.append(old[t]) if t in old else None); continue
        if not isinstance(w, str): print('no text', t); continue
        B = infobox(w)
        clubs = spells(B, 'years', 'clubs', (('caps', 'a'), ('goals', 'gl')))
        mgr = spells(B, 'manageryears', 'managerclubs')
        nat = [r for r in spells(B, 'nationalyears', 'nationalteam', (('nationalcaps', 'a'), ('nationalgoals', 'gl'))) if not re.search(r'U-?\d|under|youth|B$|olympic', r['c'], re.I)]
        # when he left United: last United playing or managing spell
        ends = [endyr(r['y']) for r in clubs + mgr if UTD.search(r['c'])] + [int(x['to'][:4]) for x in e.get('m', [])] + ([int(e['u']['last'][:4]) + 1] if e.get('u') else [])
        left = max([x for x in ends if x] or [0])
        def later(rows, k):
            idx = [n for n, r in enumerate(rows) if UTD.search(r['c'])]
            if idx: return [dict(r, k=k) for r in rows[idx[-1] + 1:]]          # everything listed after the last United spell
            return [dict(r, k=k) for r in rows if (yr(r['y']) or 0) >= left]  # never at United in this role: go by date
        after = later(clubs, 'player') + later(mgr, 'manager')
        after.sort(key=lambda r: (yr(r['y']) or 0, 0 if r['k'] == 'player' else 1))
        cur = clean(B.get('currentclub', '')); retired = bool(re.search(r'retired', w[:4000], re.I)) and not cur
        r = dict(t=t, n=e['n'], kind=e['kind'], url=e['url'], u=e.get('u'), m=e.get('m'), left=left, clubs=clubs, mgr=mgr, nat=nat[-1:] if nat else [],
                 next=after[0] if after else None, after=after, hon=honours(w, left), cur=cur or None)
        out.append(r); done.append(t)
    out.sort(key=lambda r: (-(r.get('left') or 0), r['n']))
    dump(out, OUT); save_revs(STATE, revs, done)
    stamp('departures', f"{len(out)} people, {sum(1 for r in out if r.get('next'))} with a next club, {sum(1 for r in out if r.get('hon'))} with later honours")
    print(len(out), 'people;', len(done), 'parsed this run')

main()
