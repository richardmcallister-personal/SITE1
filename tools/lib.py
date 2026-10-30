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
