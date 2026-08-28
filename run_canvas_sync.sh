#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$PROJECT_DIR/cron.log"
PYTHON="$PROJECT_DIR/.venv/bin/python3"
LOCK_FILE="/tmp/canvasExport-sync.lock"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %Z'
}

{
  echo "[$(timestamp)] START canvasExport sync"
  cd "$PROJECT_DIR" || {
    echo "[$(timestamp)] ERROR unable to cd into $PROJECT_DIR"
    exit 1
  }

  flock -n "$LOCK_FILE" "$PYTHON" "$PROJECT_DIR/main.py"
  status=$?

  if [ "$status" -eq 0 ]; then
    echo "[$(timestamp)] END canvasExport sync status=0"
  else
    echo "[$(timestamp)] END canvasExport sync status=$status"
  fi

  exit "$status"
} >> "$LOG_FILE" 2>&1
