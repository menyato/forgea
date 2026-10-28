#!/bin/sh
# Nightly backup of one environment (systemd timer forgea-backup@<env>, infra/setup-server.sh):
# a database dump and every uploaded file, encrypted by restic and sent to that environment's
# private bucket. Keeps 7 daily, 4 weekly and 6 monthly snapshots.
#   ./backup.sh            back up now
#   ./backup.sh snapshots  list what can be restored (deploy/README.md, "Restore")
set -eu
cd "$(dirname "$0")"
here="$PWD"
project="forgea-$(basename "$here")"

restic() {
  docker run --rm --env-file backup.env \
    -e GOOGLE_APPLICATION_CREDENTIALS=/key.json \
    -v "$here/backup-key.json:/key.json:ro" \
    -v "$here/backups:/backups" \
    -v "${project}_uploads:/data/uploads:ro" \
    restic/restic:0.18.0 "$@"
}

if [ "${1:-}" = snapshots ]; then
  restic snapshots
  exit 0
fi

# The repository is created the first time.
restic cat config >/dev/null 2>&1 || restic init

mkdir -p backups
# Custom format: compressed, and restores table by table if needed.
docker compose exec -T postgres pg_dump --username postgres --format custom forgea \
  >backups/forgea.dump.tmp
mv backups/forgea.dump.tmp backups/forgea.dump

restic backup --tag nightly /backups /data/uploads
restic forget --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
