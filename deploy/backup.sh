#!/usr/bin/env bash
# Saves the database to deploy/backups/, keeping the last 14. Run it daily
# from cron:  0 3 * * * /home/ubuntu/tagalong/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/tagalong-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.yml --env-file .env exec -T postgres \
  pg_dump -U tagalong -d tagalong | gzip > "$file"
ls -1t backups/*.sql.gz | tail -n +15 | xargs -r rm --
echo "Saved $file"
