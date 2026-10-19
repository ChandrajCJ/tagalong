#!/usr/bin/env bash
# Publishes an over-the-air update (EAS Update) to installed APKs:
#   ./scripts/ota-update.sh "Fix the money tab totals"
# Phones download it the next time the app opens and switch to it on the
# launch after that (or straight away from the "new version ready" banner).
# Only JavaScript, screens and images travel this way. New native modules,
# permissions, the icon or Firebase changes still need ./scripts/build-apk.sh;
# the runtime "fingerprint" keeps an update off any APK that couldn't run it.
set -e
message="${1:?Say what changed, e.g. ./scripts/ota-update.sh \"Fix the money tab totals\"}"
channel="${CHANNEL:-preview}"
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use >/dev/null
# EAS packages with git; /usr/local/bin/git here is Intel-only (see build-apk.sh).
[ -x /usr/bin/git ] && export PATH="/usr/bin:$PATH"
cd apps/mobile
# The update is bundled here, so it needs the same live addresses as the APK:
# take them from the build profile in eas.json, the single source of truth.
eval "$(node -e '
  const env = require("./eas.json").build[process.argv[1]].env || {};
  for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(v)}`);
' "$channel")"
exec npx --yes eas-cli@latest update --channel "$channel" --environment "$channel" --platform android --message "$message"
