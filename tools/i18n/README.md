# Site languages

English plus Irish (ga), Spanish (es), French (fr), German (de), Swedish (sv) and Danish (da).

How it works (details at the top of `static/manutd/i18n/i18n.js`):

- The Worker picks the language: the `mu_lang` cookie (the footer switch sets it), else the first of the browser's
  `Accept-Language` languages the site has, else English. It puts `window.MU_LANG`, `/i18n/i18n.js` and
  `/i18n/<lang>.js` at the top of `<head>` and sets `<html lang>`.
- `i18n.js` translates every text node and `placeholder`/`aria-label`/`title`/`alt` as the page is parsed and as
  scripts add content (MutationObserver), from a dictionary keyed by the English text. Numbers become `{0}`…,
  ordinals (`50th`) are matched as `{0}th`, and `{N}`/`{M}`/`{P}` keys carry names or other text (milestones,
  match reports, fixture lines). No entry → the English stays. Named months/weekdays come from `Intl` in that
  language; all-numeric dates stay en-GB.
- Wikipedia text (players, managers, clubs, seasons, rivalries) comes from that language's Wikipedia when the English
  article has an interlanguage link (`localWiki` in worker.js, KV `wiki:ll:v1:`); otherwise English.
- Ask answers in the visitor's language (`lang` in the POST; cache key `ask:a:v9:<lang>:…`).
- Feed text (news headlines, player names, venues) and archive names are never translated.

## Files

| File | What |
|---|---|
| `tools/data/i18n/en.json` | every English string the site shows (keys only) |
| `tools/data/i18n/<lang>.json` | `{English: translation}` |
| `static/manutd/i18n/<lang>.js`, `<lang>-long.js` | built by `build.py`; don't edit |

## Adding or changing text

1. `node tools/i18n/crawl.js 3 /tmp/rendered.json` (renders the live site, ~10 min) and
   `python3 tools/i18n/static_extract.py . /tmp/static.json`, then `merge.py` (run from the folder holding both) to
   get the new list; or add the new English strings to `en.json` by hand.
2. `python3 tools/i18n/build.py --missing` lists what each language lacks; add the translations to `<lang>.json`.
   Keep slots (`{0}`, `{N}`) intact. Names stay as they are.
3. `python3 tools/i18n/build.py`, commit the JSON and the built files.

Text built by code around names should be added as a `{N}` template (see `ntpl.txt`). Mark anything that must stay
English with `translate="no"`.
