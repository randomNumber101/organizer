#!/usr/bin/env bash
# Prüft den Code außerhalb von OneDrive: Kopie nach $HOME/build/organizer, npm install, Typecheck, Build, Dry-Run-Deploy.
# (node_modules und dist landen so nicht im OneDrive-Ordner.)
# Nutzung (Claude, device_bash):  bash "$HOME/mnt/Organizer/scripts/check.sh"
set -euo pipefail
SRC="$HOME/mnt/Organizer"
WORK="$HOME/build/organizer"
mkdir -p "$WORK"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude .wrangler --exclude tokens --exclude "Claude outputs" "$SRC/" "$WORK/"
cd "$WORK"
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund
npm run typecheck
npm run build
npx wrangler deploy --dry-run --outdir /tmp/organizer-dryrun
echo "OK"
