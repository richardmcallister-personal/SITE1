"""Collect UI text from the site source: page markup, string literals in page scripts and mu.js, Worker messages,
and the hand-written prose in data JSON. Writes static.json: {text: [sources]}."""
import json, re, sys, glob, os, html
from html.parser import HTMLParser

ROOT = sys.argv[1]  # repo root
SITE = os.path.join(ROOT, "static/manutd")
out = {}

def add(t, src):
    t = html.unescape(re.sub(r"\s+", " ", t)).strip()
    if not t or not re.search(r"[A-Za-z]{2}", t):
        return
    if len(t) > 1200:
        return
    out.setdefault(t, set()).add(src)

CODEY = re.compile(r"^[\w$.\-#\[\]=:]+$|[{};]\s*$|^\s*[.#][\w-]+\s*\{|function\s*\(|=>|\b(var|return|null|undefined|true|false)\b|^[a-z]+[A-Z]\w*$|^https?:|^/|\.(png|jpg|json|js|css|webp|svg)\b|^[a-z0-9_-]+$")

def good_piece(p):
    p = p.strip()
    if len(p) < 2 or not re.search(r"[A-Za-z]{2}", p):
        return False
    if CODEY.search(p) and not re.match(r"^[A-Z][a-z]{2,}[.!?…]?$", p):
        return False
    if re.search(r"[<>]", p):
        return False
    # css-ish
    if re.search(r"[a-z-]+:\s*[^ ]+;", p):
        return False
    # must look like words: a space, or a capitalised word
    if " " not in p and not re.match(r"^[A-Z][a-z]+[.!?…]?$|^[A-Z]{2,5}$", p):
        return False
    return True

class P(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True); self.src = src; self.stack = []; self.scripts = []; self.cur = None
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style"):
            self.cur = [tag, a, ""]
            return
        for k in ("placeholder", "aria-label", "title", "alt", "content" if a.get("name") == "description" else "_"):
            if a.get(k):
                add(a[k], self.src)
        if tag == "input" and a.get("type") in ("button", "submit") and a.get("value"):
            add(a["value"], self.src)
    def handle_endtag(self, tag):
        if self.cur and tag == self.cur[0]:
            if tag == "script" and not self.cur[1].get("src") and self.cur[1].get("type", "text/javascript") in ("text/javascript", "module", ""):
                self.scripts.append(self.cur[2])
            self.cur = None
    def handle_data(self, d):
        if self.cur is not None:
            self.cur[2] += d
            return
        add(d, self.src)

LIT = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`")

def from_js(code, src):
    for m in LIT.finditer(code):
        s = next(g for g in m.groups() if g is not None)
        s = s.replace("\\'", "'").replace('\\"', '"').replace("\\n", " ")
        if "<" in s or ">" in s:
            # html fragment: text between tags; also attributes
            for am in re.finditer(r'(?:placeholder|aria-label|title|alt)="([^"]+)"', s):
                if good_piece(am.group(1)): add(am.group(1), src)
            for piece in re.split(r"<[^>]*>|<[^>]*$|^[^<]*>", s):
                if good_piece(piece): add(piece, src)
        else:
            if good_piece(s): add(s, src)

pages = [f for f in glob.glob(SITE + "/**/index.html", recursive=True)]
for f in pages:
    src = os.path.relpath(f, SITE)
    p = P(src); p.feed(open(f, encoding="utf-8").read())
    for sc in p.scripts:
        from_js(sc, src)
for js in ["mu.js", "watch.js", "sw.js"]:
    from_js(open(os.path.join(SITE, js), encoding="utf-8").read(), js)

# Worker messages a visitor can see (Ask errors and the like)
w = open(os.path.join(ROOT, "worker.js"), encoding="utf-8").read()
for m in re.finditer(r'error:\s*"([^"]+)"', w):
    if " " in m.group(1) and good_piece(m.group(1)): add(m.group(1), "worker.js")
for m in re.finditer(r'(?:title|body):\s*"([^"]{6,})"', w):
    if good_piece(m.group(1)): add(m.group(1), "worker.js:push")

# data JSON: prose and labels shown on pages
def walk(x, src, keyname=""):
    if isinstance(x, dict):
        for k, v in x.items():
            if k.startswith("_") or k in ("src", "url", "u", "rep", "photo", "img", "credit", "licence", "license", "by", "author"): continue
            walk(v, src, k)
    elif isinstance(x, list):
        for v in x: walk(v, src, keyname)
    elif isinstance(x, str):
        if x.startswith("http") or re.match(r"^\d{4}-\d\d", x): return
        if " " in x and re.search(r"[a-z]{3}", x) and len(x) > 3:
            add(x, src + ":" + keyname)

for f in ["history/timeline.json", "history/timeline-club.json", "grounds/grounds.json", "kits/kits.json", "watch.json"]:
    path = os.path.join(SITE, f)
    if os.path.exists(path): walk(json.load(open(path, encoding="utf-8")), f)

# archive labels: rounds, divisions, points rules, ties
for f in glob.glob(SITE + "/history/data/*.json"):
    d = json.load(open(f, encoding="utf-8"))
    for k in ("div", "fac", "lc", "eu"):
        if isinstance(d.get(k), str): add(d[k], "archive:" + k)
    if isinstance(d.get("table"), dict) and d["table"].get("rule"): add(d["table"]["rule"], "archive:rule")
    for r in d.get("results", []):
        for k in ("r", "tie"):
            if r.get(k): add(r[k], "archive:" + k)

json.dump({k: sorted(v) for k, v in out.items()}, open(sys.argv[2], "w"), ensure_ascii=False, indent=0)
print(len(out), "strings,", sum(len(k) for k in out), "chars")
