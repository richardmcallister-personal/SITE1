"""News briefing (preview builder). Reads United feeds from outlets that publish RSS and answer an honest request,
keeps the last 36 hours, groups items about the same story, labels and ranks each story, and writes
static/manutd/news.json for /news/. Headlines, links and short standfirsts only - never article text or images.
The live version is meant to run in the Worker twice a day with a model writing our own neutral summary; this script
is the same logic for previewing on dev."""
import json, os, re, sys, html, time, email.utils, urllib.request
from datetime import datetime, timezone, timedelta

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "static", "manutd", "news.json")
UA = "manutd.wiki news briefing (+https://manutd.wiki/news/)"

# name, url, group, needs a United mention (general feeds)
FEEDS = [
    ("BBC Sport", "https://feeds.bbci.co.uk/sport/football/teams/manchester-united/rss.xml", "major", False),
    ("Sky Sports", "https://www.skysports.com/rss/11667", "major", False),
    ("The Athletic", "https://www.nytimes.com/athletic/rss/football/manchester-united/", "major", False),
    ("ESPN", "https://www.espn.com/espn/rss/soccer/news", "major", True),
    ("Manchester Evening News", "https://www.manchestereveningnews.co.uk/all-about/manchester-united-fc?service=rss", "local", False),
    ("Evening Standard", "https://www.standard.co.uk/sport/football/rss", "national", True),
    ("Football365", "https://www.football365.com/manchester-united/feed", "national", False),
    ("90min", "https://www.90min.com/posts.rss", "national", True),
    ("Daily Mail", "https://www.dailymail.co.uk/sport/manchester-united/index.rss", "tabloid", False),
    ("Daily Mirror", "https://www.mirror.co.uk/all-about/manchester-united-fc?service=rss", "tabloid", False),
    ("Stretty News", "https://strettynews.com/feed/", "fan", False),
    ("The Peoples Person", "https://thepeoplesperson.com/feed/", "fan", False),
    ("United In Focus", "https://unitedinfocus.com/feed/", "fan", False),
]
WEIGHT = {"major": 3, "local": 2.5, "national": 1.5, "tabloid": 1, "fan": 0.7}
SOLID = {"major", "local", "national"}
UTD = re.compile(r"\b(Man(chester)? (United|Utd)|Man U\b|Old Trafford|Red Devils|Pochettino)", re.I)
RUMOUR = re.compile(r"\b(transfer (news|rumou?rs?|gossip|latest)|swoop|linked|eye(s|ing)?|keen on|interest in|monitor(s|ing)?|plot(s|ting)?|bid for|in talks|shortlist|"
                     r"race for|battle for|move for|want(s)? to sign|could (sign|join|return|leave)|rumou?rs?|targets?(?= (as|for|in|from)\b)|named .* targets?)\b", re.I)
STOP = set("""a an the and or of to in on at for from by with as is are was were be been it its this that these those his her their
he she they them we you i not no but if than then so up out over into after before about new man manchester united utd mufc
says said say will would can could has have had do does did how why what who when where which vs v amid ahead set""".split())

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=25) as r: return r.read().decode("utf-8", "ignore")

def strip(s):
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s or "", flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s); s = html.unescape(html.unescape(s))
    return re.sub(r"\s+", " ", s).strip()

def items(xml):
    for m in re.finditer(r"<item\b.*?</item>", xml, flags=re.S):
        b = m.group(0)
        g = lambda t: (re.search(rf"<{t}\b[^>]*>(.*?)</{t}>", b, flags=re.S) or [None, ""])[1]
        link = strip(g("link")) or strip(g("guid"))
        when = None
        for t in ("pubDate", "dc:date", "updated"):
            v = strip(g(t))
            if v:
                try: when = email.utils.parsedate_to_datetime(v)
                except Exception:
                    try: when = datetime.fromisoformat(v.replace("Z", "+00:00"))
                    except Exception: pass
                if when: break
        yield dict(title=strip(g("title")), url=link, desc=strip(g("description"))[:400], when=when)

def words(t):
    w = [re.sub(r"'s$", "", x.lower()) for x in re.findall(r"[A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ'-]+", t)]
    return {x[:7] for x in w if x not in STOP and len(x) > 2}

def names(t):
    caps = re.findall(r"\b([A-ZÀ-Þ][a-zà-ÿ]+(?:[- ][A-ZÀ-Þ][a-zà-ÿ]+)*)", t)
    return {c.lower() for c in caps if c.lower() not in STOP and c.lower() not in ("premier league", "champions league", "old trafford", "red devils", "fa cup")}

def main():
    now = datetime.now(timezone.utc); cutoff = now - timedelta(hours=36)
    rows, report = [], []
    for name, url, group, need in FEEDS:
        try: xml = fetch(url)
        except Exception as e: report.append(f"{name}: failed ({e.__class__.__name__})"); continue
        n = 0
        for it in items(xml):
            if not it["title"] or not it["url"] or not it["when"] or it["when"] < cutoff: continue
            if need and not UTD.search(it["title"] + " " + it["desc"]): continue
            if re.search(r"\blive\b.*\b(updates|blog|reaction)\b|^live:|\bLIVE\b|quiz|\bodds\b|\bbetting\b|\btips\b|predicted (line-?up|xi)|player ratings|last time .* released", it["title"], re.I): continue
            it.update(source=name, group=group, w=words(it["title"] + " " + it["desc"][:160]), n=names(it["title"]))
            rows.append(it); n += 1
        report.append(f"{name}: {n}")
    rows.sort(key=lambda r: r["when"], reverse=True)
    # names/words in more than 7% of items (this week's manager, the next opponent) say nothing about which story it is
    from collections import Counter
    dfn = Counter(x for r in rows for x in r["n"]); dfw = Counter(x for r in rows for x in r["w"])
    common_n = {k for k, v in dfn.items() if v > max(3, 0.07 * len(rows))}; common_w = {k for k, v in dfw.items() if v > max(3, 0.07 * len(rows))}
    for r in rows: r["n2"] = r["n"] - common_n; r["w2"] = r["w"] - common_w
    # group items about the same story: each item must match the story's first item (no chaining through a growing pile)
    clusters = []
    for r in rows:
        best, bs = None, 0
        for c in clusters:
            seed = c["items"][0]
            nn = len(r["n2"] & seed["n2"]); ww = len(r["w2"] & seed["w2"]) / max(1, min(len(r["w2"]), len(seed["w2"])))
            sc = ww + 0.25 * nn
            if (nn >= 2 and ww >= 0.2) or (nn >= 1 and ww >= 0.3) or ww >= 0.5:
                if sc > bs: best, bs = c, sc
        if best: best["items"].append(r)
        else: clusters.append(dict(items=[r]))
    stories = []
    for c in clusters:
        its = c["items"]; srcs = {}
        for i in its: srcs.setdefault(i["source"], i)
        groups = {i["group"] for i in srcs.values()}
        lead = sorted(srcs.values(), key=lambda i: (-WEIGHT[i["group"]], -i["when"].timestamp()))[0]
        latest = max(i["when"] for i in its)
        major = sum(1 for i in srcs.values() if i["group"] in ("major", "local"))
        rumourish = bool(RUMOUR.search(lead["title"])) and sum(1 for i in srcs.values() if RUMOUR.search(i["title"])) * 2 >= len(srcs)
        if groups <= {"fan"} and len(srcs) == 1 and not rumourish: continue   # a lone fan-site piece is opinion, not news
        if not groups & SOLID: label = "Rumour" if rumourish else "Reported"
        elif major >= 2 and not rumourish: label = "Confirmed"
        elif rumourish and major < 2: label = "Rumour"
        else: label = "Reported"
        age_h = (now - latest).total_seconds() / 3600
        score = sum(WEIGHT[i["group"]] for i in srcs.values()) * (1 + 0.3 * (len(srcs) - 1)) / (1 + age_h / 18)
        stories.append(dict(title=lead["title"], summary=lead["desc"][:260], via=lead["source"], label=label, score=round(score, 2),
                            time=latest.isoformat(), sources=[dict(name=i["source"], title=i["title"], url=i["url"], time=i["when"].isoformat())
                                                               for i in sorted(srcs.values(), key=lambda i: -WEIGHT[i["group"]])]))
    stories.sort(key=lambda s: -s["score"])
    main_ = [s for s in stories if s["label"] != "Rumour"][:15]
    rum = [s for s in stories if s["label"] == "Rumour"][:10]
    uk = now.astimezone(timezone(timedelta(hours=0)))
    out = dict(built=now.isoformat(), edition="Morning" if 3 <= uk.hour < 13 else "Evening", window_hours=36, items=len(rows),
               outlets=[f[0] for f in FEEDS], stories=main_, rumours=rum)
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=0)
    print("\n".join(report)); print(f"{len(rows)} items -> {len(stories)} stories ({len(main_)} shown, {len(rum)} rumours)")

main()
