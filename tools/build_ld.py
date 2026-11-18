"""Static structured data for every page: a JSON-LD block (WebSite + SearchAction, the SportsTeam the site is about,
the WebPage and its breadcrumb) plus a meta description, written into <head> between <!--ld--> markers so it can be
re-run safely. Template pages (player, manager, match) add their own Person/SportsEvent at runtime via MU.ld()."""
import json, os, re
ROOT = os.path.join(os.path.dirname(__file__), "..", "static", "manutd")
SITE = "https://manutd.wiki"
LANGS = ["en", "ga", "es", "fr", "de", "sv", "da"]

# path: (page name, description, section)  — section "history" puts History in the breadcrumb
PAGES = {
    "": ("Manchester United hub", "An independent Manchester United supporters' hub: next match with kick-off in your time zone, live scores, team news, the table, results and 140 seasons of club history.", None),
    "season/": ("This season", "Manchester United's current season: every fixture and result, Premier League and Champions League tables, scorers and calendar subscriptions.", None),
    "squad/": ("Squad", "The current Manchester United squad: fitness and availability, nationalities, season stats and a pick-your-XI tool.", None),
    "youth/": ("Academy & loans", "Manchester United's academy and loan players: weekly minutes, roles and form on the route to a first-team debut.", None),
    "trips/": ("Trips", "Planning a trip to see Manchester United home or away: travel, stadium guides and match-day timings.", None),
    "grounds/": ("Ground guides", "Away ground guides for Manchester United fans: arrival, meeting spots, the away end, bag rules and getting home.", None),
    "kits/": ("Shirt museum", "Every Manchester United kit since 1878, with your own collection and wishlist.", None),
    "highlights/": ("Highlights", "Video of the key match from every Manchester United trophy season, from the 1948 FA Cup final to today.", None),
    "links/": ("Links", "Manchester United links: official channels first, then the fan sites, podcasts and news worth your time.", None),
    "history/": ("History", "Manchester United history from Newton Heath in 1878: every season, manager, record and opponent.", "self"),
    "history/seasons/": ("Every season", "Every Manchester United season since 1886–87: league position, cup runs, manager and top scorer.", "history"),
    "history/season/": ("Season", "A Manchester United season in full: final table, every result, scorers, manager, captain and the key match on video.", "history"),
    "history/managers/": ("Managers", "Every Manchester United manager and caretaker since 1892, with records in charge and trophies won.", "history"),
    "history/opponents/": ("Opponents", "Manchester United's head-to-head record against every club they have played.", "history"),
    "history/records/": ("Records", "Manchester United club records: biggest wins, appearances, goals, streaks and attendances.", "history"),
    "history/timeline/": ("History timeline", "Manchester United from Newton Heath in 1878 to now, year by year.", "history"),
    "where/": ("Where did they go?", "Former Manchester United players and managers after they left: next club, honours won afterwards and the whole career.", "history"),
    "comebacks/": ("The comeback collection", "Manchester United's great comebacks: games won or saved from behind, late winners and seven-goal thrillers.", "history"),
    "numbers/": ("Who wore this number?", "Every Manchester United squad number since 1993–94 and who wore it.", "history"),
    "find/": ("Find that match", "Find any Manchester United competitive game since 1886 from what you remember: opponent, score, scorer or year.", "history"),
    "rivalry/": ("Rivalries", "Manchester United's rivalries in numbers: Liverpool, City, Leeds, Arsenal, Chelsea and more.", "history"),
    "club/": ("Club", "Manchester United against one club: every meeting, results and scorers.", "history"),
    "player/": ("Player", "A Manchester United player: appearances, goals, every season and his career before and after United.", None),
    "manager/": ("Manager", "A Manchester United manager: record in charge, trophies and every spell.", "history"),
    "match/": ("Match centre", "Manchester United match centre: line-ups, live events, stats and report.", None),
    "compare/": ("Compare players", "Compare Manchester United players side by side: appearances, goals and seasons.", None),
    "shelf/": ("Bookshelf & watchlist", "Books, documentaries, films and podcasts about Manchester United, by era.", None),
    "ask/": ("Ask the archive", "Ask a question about Manchester United and get an answer drawn from 140 seasons of data on this site.", None),
    "search/": ("Search", "Search Manchester United players, matches, seasons and shirts.", None),
    "accessibility/": ("Accessibility", "Accessibility statement for manutd.wiki.", None),
}

def block(path, name, desc, section):
    url = SITE + "/" + path
    team = {"@type": "SportsTeam", "@id": SITE + "/#team", "name": "Manchester United", "alternateName": ["Manchester United F.C.", "Man Utd"],
            "sport": "Association football", "foundingDate": "1878", "url": "https://www.manutd.com/",
            "location": {"@type": "StadiumOrArena", "name": "Old Trafford", "address": "Sir Matt Busby Way, Old Trafford, Manchester M16 0RA, United Kingdom"},
            "sameAs": ["https://en.wikipedia.org/wiki/Manchester_United_F.C.", "https://www.wikidata.org/wiki/Q18656"]}
    site = {"@type": "WebSite", "@id": SITE + "/#website", "url": SITE + "/", "name": "manutd.wiki",
            "description": "An independent Manchester United supporters' hub (not affiliated with the club).", "inLanguage": LANGS, "about": {"@id": SITE + "/#team"},
            "potentialAction": {"@type": "SearchAction", "target": {"@type": "EntryPoint", "urlTemplate": SITE + "/search/?q={search_term_string}"}, "query-input": "required name=search_term_string"}}
    crumbs = [("Hub", SITE + "/")]
    if section == "history" or section == "self": crumbs.append(("History", SITE + "/history/"))
    if path and section != "self": crumbs.append((name, url))
    page = {"@type": "CollectionPage" if path in ("history/seasons/", "history/managers/", "history/opponents/", "where/", "highlights/", "links/", "shelf/", "kits/", "comebacks/") else "WebPage",
            "@id": url + "#page", "url": url, "name": name + (" · manutd.wiki" if path else ""), "description": desc, "isPartOf": {"@id": SITE + "/#website"}, "about": {"@id": SITE + "/#team"}, "inLanguage": "en"}
    graph = [site, team, page]
    if len(crumbs) > 1:
        page["breadcrumb"] = {"@id": url + "#crumbs"}
        graph.append({"@type": "BreadcrumbList", "@id": url + "#crumbs", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(crumbs)]})
    js = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    d = desc.replace("&", "&amp;").replace('"', "&quot;")
    return f'<!--ld--><meta name="description" content="{d}">\n<script type="application/ld+json" id="ld-site">{js}</script><!--/ld-->\n'

n = 0
for path, (name, desc, section) in PAGES.items():
    f = os.path.join(ROOT, path, "index.html")
    if not os.path.exists(f): print("missing", path); continue
    s = open(f, encoding="utf-8").read()
    s = re.sub(r'<!--ld-->.*?<!--/ld-->\n?', '', s, flags=re.S)
    s = s.replace("</head>", block(path, name, desc, section) + "</head>", 1)
    open(f, "w", encoding="utf-8").write(s); n += 1
print(n, "pages")
