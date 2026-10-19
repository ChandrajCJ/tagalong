#!/usr/bin/env bash
# Opens Drizzle Studio (a table browser) on the live Neon database.
# Paste Neon's connection string when asked: it's read without echoing, kept
# only in this process's memory, and never written to .env or the history.
# Prefer a read-only Neon role for browsing. Ctrl+C to stop.
set -e
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use >/dev/null
read -r -s -p "Neon connection string (input hidden): " DATABASE_URL
echo
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "That doesn't look like a postgres:// address." >&2; exit 1 ;;
esac
export DATABASE_URL
echo "Opening https://local.drizzle.studio …"
exec pnpm --filter @tagalong/db db:studio
