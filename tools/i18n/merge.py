"""Merge rendered + static strings into the list to translate (strings.json), dropping names, scores and code."""
import json, re, glob, os, sys, collections
ROOT = "/home/claude/site1"; SITE = ROOT + "/static/manutd"
r = json.load(open("rendered.json")); s = json.load(open("static.json"))

# code + hand-written prose corpus (not the generated player/club data)
corpus = ""
for f in glob.glob(SITE + "/**/index.html", recursive=True): corpus += open(f, encoding="utf-8").read()
for f in ["mu.js", "watch.js", "watch.json", "kits/kits.json", "grounds/grounds.json", "history/timeline.json", "history/timeline-club.json"]:
    corpus += open(os.path.join(SITE, f), encoding="utf-8").read()
import html as H
corpus = H.unescape(corpus)
corpus_json = json.dumps(corpus)  # escaped form for strings inside JSON/JS
NUM = re.compile(r"\d[\d.,:/–-]*\d|\d")

# names to leave alone
names = set()
for e in json.load(open(SITE + "/search.json")):
    if e[1] not in ("player", "manager", "club", "ground"): continue   # page titles and aliases are ordinary words
    names.add(e[0])
for f in [SITE + "/history/clubs.json", SITE + "/history/players_index.json", SITE + "/history/managers.json"]:
    try:
        d = json.load(open(f))
        def walk(x, k=""):
            if isinstance(x, dict):
                for kk, v in x.items():
                    if kk in ("n", "name", "t", "club", "o", "full"):
                        if isinstance(v, str): names.add(v)
                    walk(v, kk)
            elif isinstance(x, list):
                for v in x: walk(v, k)
        walk(d)
    except Exception as ex: print("names", f, ex)
names_l = {n.lower() for n in names}

def is_name_list(t):
    parts = [p.strip() for p in re.split(r"\s*(?:[,;·/&]|\band\b|–|—|\bv\b|\bvs\.?)\s*", t) if p.strip()]
    parts = [NUM.sub("", p).strip(" ()'’.-") for p in parts]
    parts = [p for p in parts if re.search(r"[A-Za-z]", p)]
    return parts and all(p.lower() in names_l or re.fullmatch(r"[A-Z]\.? ?[A-Z][a-zà-ÿ'’-]+", p) for p in parts)

def keepable(t):
    if len(t) < 2 or not re.search(r"[A-Za-z]{2}", t): return False
    if t.lower() in names_l or is_name_list(t): return False
    if re.fullmatch(r"[A-Z]{1,4}", t): return False  # W/D/L, GD, MP...
    if re.fullmatch(r"[\W\d_]*[A-Za-z]?[\W\d_]*", t): return False
    if re.match(r"https?:|www\.|[\w.-]+\.(com|org|wiki|net|uk|de)\b", t): return False
    return True

def in_code(t):
    tpl = NUM.sub("\x00", t)
    pieces = [p.strip(" ·:,()–—-→") for p in re.split(r"\x00| · ", tpl)]
    pieces = [p for p in pieces if re.search(r"[A-Za-z]{2}", p)]
    return pieces and all(p in corpus or json.dumps(p)[1:-1] in corpus_json for p in pieces)

out = {}
why = collections.Counter()
for t, v in r.items():
    if not keepable(t): why["rend-drop"] += 1; continue
    if t in s or in_code(t): out[t] = {"src": sorted(v["pages"])[:3], "kind": v["k"]}; why["rend-keep"] += 1
    else: why["rend-data"] += 1
for t, v in s.items():
    if t in out: continue
    if not keepable(t): why["stat-drop"] += 1; continue
    if any(x.startswith("find/") for x in v) and t == t.lower() and len(t) < 40: why["stat-alias"] += 1; continue
    out[t] = {"src": v[:3], "kind": "s"}; why["stat-keep"] += 1

# collapse numeric variants into templates when 2+ share one ("Matchweek 3", "Matchweek 4" → "Matchweek {0}")
tpls = collections.defaultdict(list)
for t in out:
    if NUM.search(t) and len(t) < 120:
        i = [0]
        def rep(m): i[0] += 1; return "{%d}" % (i[0] - 1)
        tpls[NUM.sub(rep, t)].append(t)
final = {}
for t, v in out.items(): final[t] = v
for tp, ts in tpls.items():
    if len(ts) >= 2 or not any(t in s for t in ts):
        for t in ts: final.pop(t, None)
        final[tp] = {"src": out[ts[0]]["src"], "kind": "tpl", "eg": ts[0]}
print(why, "→", len(final), "strings,", sum(len(k) for k in final), "chars")
json.dump(final, open(sys.argv[1] if len(sys.argv) > 1 else "strings.json", "w"), ensure_ascii=False, indent=0)
