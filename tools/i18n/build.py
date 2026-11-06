"""Site languages: compile tools/data/i18n/<lang>.json ({English: translation}) into the files pages load.

  static/manutd/i18n/<lang>.js        interface text (entries up to LONG characters), loaded in <head>
  static/manutd/i18n/<lang>-long.js   longer prose (ground guides, timeline, write-ups), loaded async after it

  python3 tools/i18n/build.py            build every language
  python3 tools/i18n/build.py --missing  list English strings in tools/data/i18n/en.json that a language lacks

Adding text to the site: run the extractors (see tools/i18n/README.md) to refresh en.json, translate what --missing
lists into each <lang>.json, then build. Keys are the English text of one text node; {0} {1}… are numbers,
{N} {M} {P} are names or other text (see static/manutd/i18n/i18n.js)."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "tools/data/i18n")
OUT = os.path.join(ROOT, "static/manutd/i18n")
LANGS = ["ga", "es", "fr", "de", "sv", "da"]
LONG = 220
PH = re.compile(r"\{[\dNMP]\}")


def load(lang):
    return json.load(open(os.path.join(DATA, lang + ".json"), encoding="utf-8"))


def main():
    en = json.load(open(os.path.join(DATA, "en.json"), encoding="utf-8"))
    if "--missing" in sys.argv:
        for l in LANGS:
            d = load(l); miss = [k for k in en if k not in d]
            print(l, len(miss), "missing"); [print("   ", k[:100]) for k in miss[:40]]
        return
    for l in LANGS:
        # the engine reads every ordinal as {0}th ("2nd" → "{0}th"), so keys must too
        d = {re.sub(r"(\{\d\})(?:st|nd|rd)\b", r"\1th", k): v for k, v in load(l).items()}
        bad = [k for k, v in d.items() if sorted(PH.findall(k)) != sorted(PH.findall(v))]
        for k in bad: print(l, "placeholder mismatch, dropped:", k[:80]); d.pop(k)
        # identical entries add nothing except for keys with slots (they still need to match)
        d = {k: v for k, v in d.items() if v != k or PH.search(k)}
        short = {k: v for k, v in d.items() if len(k) <= LONG}
        longd = {k: v for k, v in d.items() if len(k) > LONG}
        for name, part in ((l, short), (l + "-long", longd)):
            body = "MU_I18N(" + json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + ");\n"
            open(os.path.join(OUT, name + ".js"), "w", encoding="utf-8").write(body)
        print(l, len(short), "+", len(longd), "entries,", round(len(json.dumps(short, ensure_ascii=False)) / 1024), "KB +", round(len(json.dumps(longd, ensure_ascii=False)) / 1024), "KB")


if __name__ == "__main__":
    main()
