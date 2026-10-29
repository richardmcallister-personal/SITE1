#!/bin/bash
# Double-click in Finder to refresh seat availability and push.
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then
  echo "First run: installing (one-off)…"; npm install --silent || exit 1
fi
if [ ! -d "$HOME/.should-i-go-chrome" ]; then
  echo "First run: a Chrome window will open; sign in to your Man Utd account, then press Enter in this window."
  node refresh.mjs --login || exit 1
fi
node refresh.mjs
echo; echo "Done. Close this window."
