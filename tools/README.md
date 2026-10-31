# Build scripts

Everything here talks to the live site's Worker (manutd.wiki), never to API-Football directly, so no key is needed and the KV cache does the heavy lifting.

| Script | Rebuilds | Source |
|---|---|---|
| `build_comebacks.py` | `comebacks/api.json` (+ `tools/data/events_seen.json`) | match events, 2010/11 → now; incremental |
| `build_cups.py` | `tools/data/cups.json` | League Cup, European and other cup ties 1956/57–2024/25 (FA Cup from 2019/20) from the Wikipedia season articles, live feed from 2021/22 |
| `build_managers.py` | `history/managers.json` | Wikipedia's list of managers + record by season computed from the archive, trophies from seasons.json, arrivals from numbers.json |
| `build_season_api.py <year>` | `history/data/<season>.json`, `history/all.json` | one-off: fill a season the archive lacks from the live feed and Wikipedia's league table (used for 2022/23) |
| `build_records.py` | `history/records.json` | biggest wins/defeats, runs, season extremes, opponent records, by decade — from the same match set |
| `build_finals.py` | `numbers/finals.json` | United's XI with shirt numbers from every final to 1992/93 (Wikipedia match articles) — the 1–11 era on the numbers page |
| `build_clubs.py` | `history/clubs/*.json`, `history/clubs.json` | match archive + cups.json + live feed from 2025/26; every competitive meeting |
| `build_numbers.py` | `numbers/numbers.json` | Wikipedia season articles via `/wiki-raw` |
| `update.sh` | all of the above | |

Each script stamps `static/manutd/status.json` with the date it last ran; pages show that as "last checked".
`fixtures.js` (kick-off dates, confirmed/provisional) and `trips/` prices are maintained by the weekly scheduled task, which also runs `update.sh` and commits.

## Incremental Wikipedia parsing

`build_cups.py`, `build_numbers.py`, `build_finals.py` and `build_managers.py` ask the Worker's `/wiki-rev` route for the current
revision id of every article they depend on (50 titles per call) and compare it with `tools/data/wiki_revs_<script>.json`.
Only new or changed articles are fetched and re-parsed; rows from unchanged articles are kept from the previous output.
`/wiki-raw?title=…&rev=N` keys the KV cache on the revision, so a changed article is never served stale. A weekly run with
nothing changed on Wikipedia costs a handful of revision lookups and no article fetches. Delete the state file to force a full rebuild.
