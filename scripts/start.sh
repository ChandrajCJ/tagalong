#!/usr/bin/env bash
# Starts everything for local development on the Node version in .nvmrc.
set -e
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use
# Phones fetch photos from this laptop's Wi-Fi address, which changes between
# networks. The environment wins over .env, so this keeps links working.
ip=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$ip" ]; then export S3_PUBLIC_ENDPOINT="http://$ip:8333"; fi
exec pnpm start
