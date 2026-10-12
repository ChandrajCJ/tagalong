#!/usr/bin/env bash
# Starts everything for local development on the Node version in .nvmrc.
set -e
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use
exec pnpm start
