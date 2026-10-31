#!/usr/bin/env bash
# Rebuild everything that depends on the live feed. Safe to run any time; each step is incremental or idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/build_comebacks.py
python3 tools/build_cups.py
python3 tools/build_clubs.py
python3 tools/build_numbers.py
python3 tools/build_onthisday.py
python3 tools/build_managers.py
python3 tools/build_records.py
python3 tools/build_finals.py
python3 tools/build_search.py
echo "builds done — review git status, then commit and push"
