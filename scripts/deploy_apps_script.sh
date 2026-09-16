#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

npm ci --no-audit --no-fund
export PATH="$PROJECT_DIR/node_modules/.bin:$PATH"

if [[ ! -f .clasp.json ]]; then
  source_backup="$(mktemp -d)"
  cp apps-script/appsscript.json apps-script/Code.js "$source_backup/"
  trap 'cp "$source_backup/appsscript.json" "$source_backup/Code.js" "$PROJECT_DIR/apps-script/"; rm -rf "$source_backup"' EXIT
  clasp create-script --type standalone --title "Canvas Assignment Sync" --rootDir apps-script
  cp "$source_backup/appsscript.json" "$source_backup/Code.js" apps-script/
fi

clasp push --force
node -e "const { scriptId } = require('./.clasp.json'); console.log('Apps Script editor: https://script.google.com/home/projects/' + scriptId + '/edit')"
