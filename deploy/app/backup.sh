#!/bin/bash
# Nightly backup of one environment (systemd timer forgea-backup@<env>, infra/setup-server.sh):
# the database and every uploaded file, encrypted by restic on this server and sent to that
# environment's private bucket. The database dump streams straight into restic: no plain copy
# is ever written to disk. Keeps 7 daily, 4 weekly and 6 monthly snapshots.
#   ./backup.sh            back up now
#   ./backup.sh snapshots  list what can be restored (deploy/README.md, "Restore")
set -euo pipefail
cd "$(dirname "$0")"
here="$PWD"
env_name="$(basename "$here")"

# The folder and its settings must agree, or one environment could be backed up as the other.
grep -qx "ENV_NAME=$env_name" .env || { echo ".env does not say ENV_NAME=$env_name" >&2; exit 3; }

restic() {
  docker run --rm -i --env-file backup.env \
    -e GOOGLE_APPLICATION_CREDENTIALS=/key.json \
    -v "$here/backup-key.json:/key.json:ro" \
    -v "forgea-${env_name}_uploads:/data/uploads:ro" \
    restic/restic:0.18.0@sha256:4cf4a61ef9786f4de53e9de8c8f5c040f33830eb0a10bf3d614410ee2fcb6120 "$@"
}

# Optional: a healthchecks.io-style URL in backup.env (HEALTHCHECK_URL=...) is called after a
# successful run, so a missed or failed backup sends you an email.
ping_url="$(sed -n 's/^HEALTHCHECK_URL=//p' backup.env)"

if [ "${1:-}" = snapshots ]; then
  restic snapshots
  exit 0
fi

# The repository is created the first time.
restic cat config >/dev/null 2>&1 || restic init

# Tonight's snapshots are "incoming" until both succeed; only then do they count as "nightly",
# so a failed night can never push a good backup out of the rotation. A failed night's
# leftovers are removed at the start of the next run.
leftovers="$(restic snapshots --tag incoming --compact | awk '/^[0-9a-f]{8} /{print $1}')"
[ -z "$leftovers" ] || restic forget $leftovers

# pipefail: a failed dump fails the backup (restic alone would store an empty file).
docker compose exec -T postgres pg_dump --username postgres --format custom forgea |
  restic backup --tag incoming --stdin --stdin-filename forgea.dump
restic backup --tag incoming /data/uploads
restic tag --tag incoming --add nightly --remove incoming
restic forget --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

[ -z "$ping_url" ] || curl -fsS -m 10 --retry 3 "$ping_url" >/dev/null
