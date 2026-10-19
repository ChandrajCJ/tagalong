#!/usr/bin/env bash
# Builds the Android APK in Expo's cloud (EAS, free plan) with the "preview"
# profile in apps/mobile/eas.json, which points the app at the live servers.
# Needs `npx eas-cli login` once. Prints a link to follow the build and,
# when it's done, to download the APK.
set -e
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use >/dev/null
# EAS packages the code with git. /usr/local/bin/git on this Mac is an old
# Intel-only build that Node can't launch ("bad CPU type"); Apple's works.
[ -x /usr/bin/git ] && export PATH="/usr/bin:$PATH"
cd apps/mobile
exec npx --yes eas-cli@latest build --platform android --profile preview "$@"
