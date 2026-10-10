#!/usr/bin/env bash
# Fills in deploy/.env's secrets (once) and writes the storage config from them.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Copy .env.example to .env and fill in DOMAIN, ACME_EMAIL and SMTP_URL first."; exit 1; }

fill() {
  local key=$1 value=$2
  if grep -qE "^${key}=$" .env; then
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "Generated ${key}"
  fi
}
fill POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fill JWT_SECRET "$(openssl rand -hex 32)"
fill S3_ACCESS_KEY "$(openssl rand -hex 12)"
fill S3_SECRET_KEY "$(openssl rand -hex 32)"

# Read values without running the file: MAIL_FROM's <…> isn't shell syntax.
val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
for required in DOMAIN ACME_EMAIL SMTP_URL; do
  [ -n "$(val "$required")" ] || { echo "Set ${required} in deploy/.env"; exit 1; }
done
S3_ACCESS_KEY=$(val S3_ACCESS_KEY)
S3_SECRET_KEY=$(val S3_SECRET_KEY)
DOMAIN=$(val DOMAIN)

cat > seaweedfs.json <<JSON
{
  "identities": [
    {
      "name": "tagalong",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
chmod 600 .env seaweedfs.json
echo "Ready. App: https://app.${DOMAIN}  API: https://api.${DOMAIN}"
