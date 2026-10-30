# Build scripts

Everything here talks to the live site's Worker (manutd.wiki), never to API-Football directly, so no key is needed and the KV cache does the heavy lifting.

| Script | Rebuilds | Source |
|---|---|---|
| `build_comebacks.py` | `comebacks/api.json` (+ `tools/data/events_seen.json`) | match events, 2010/11 → now; incremental |
| `build_clubs.py` | `history/clubs/*.json`, `history/clubs.json` | match archive to 2024/25 + live feed from 2025/26 |
| `build_numbers.py` | `numbers/numbers.json` | Wikipedia season articles via `/wiki-raw` |
| `update.sh` | all of the above | |

Each script stamps `static/manutd/status.json` with the date it last ran; pages show that as "last checked".
`fixtures.js` (kick-off dates, confirmed/provisional) and `trips/` prices are maintained by the weekly scheduled task, which also runs `update.sh` and commits.
