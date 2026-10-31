"""Shared helpers for the site build scripts. Everything goes through the site's own Worker (manutd.wiki),
so the API key never leaves Cloudflare and the KV cache absorbs repeat calls."""
import json, time, urllib.request, urllib.parse, os, datetime
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36 site1-build"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static", "manutd")
TEAM = 33

def get(path, tries=5, timeout=90):
    """GET a Worker path (e.g. /api/fixtures?v=3) and return parsed JSON; retries on rate limits and network blips."""
    url = "https://manutd.wiki" + path
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)
            body = r.read()
            try:
                j = json.loads(body)
            except Exception:
                return body.decode("utf-8", "replace")
            if isinstance(j, dict) and j.get("errors") and isinstance(j["errors"], dict) and j["errors"]:
                raise RuntimeError(str(j["errors"])[:120])
            return j
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(6 * (i + 1))

def season_now():
    t = datetime.date.today()
    return t.year if t.month >= 7 else t.year - 1

def sid(y):
    return f"{y}-{str(y + 1)[2:]}"

def stamp(key, note=""):
    """Record when a dataset was last rebuilt (shown on the pages as 'last checked')."""
    p = os.path.join(STATIC, "status.json")
    try:
        s = json.load(open(p))
    except Exception:
        s = {}
    s[key] = {"date": datetime.date.today().isoformat(), "note": note}
    json.dump(s, open(p, "w"), indent=0, ensure_ascii=False)

def dump(obj, path):
    json.dump(obj, open(path, "w"), ensure_ascii=False, separators=(",", ":"))

def wiki_changed(titles, state_path):
    """Incremental Wikipedia parsing. Looks up the current revision of each title (50 per call through /wiki-rev) and
    compares it with the revisions saved at state_path. Returns (todo, revs): the titles that are new or changed, and the
    full {title: revid} map to save with save_revs() once the caller has parsed them. Titles whose revision could not be
    read are always re-parsed; a title that disappears from Wikipedia keeps its old rows."""
    try: old = json.load(open(state_path))
    except Exception: old = {}
    revs = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        try: revs.update(get("/wiki-rev?titles=" + urllib.parse.quote("|".join(batch))))
        except Exception as e: print("wiki-rev failed, re-parsing batch", e); revs.update({t: None for t in batch})
    todo = [t for t in titles if revs.get(t) is None or revs.get(t) != old.get(t)]
    return todo, revs

def save_revs(state_path, revs, done):
    """Record the revisions actually parsed (done) so the next run skips them if unchanged."""
    try: old = json.load(open(state_path))
    except Exception: old = {}
    for t in done:
        if revs.get(t): old[t] = revs[t]
    json.dump(old, open(state_path, "w"), indent=0, ensure_ascii=False, sort_keys=True)

def wiki_raw(title, rev=None):
    return get("/wiki-raw?title=" + urllib.parse.quote(title) + (f"&rev={rev}" if rev else ""))
