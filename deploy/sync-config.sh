#!/bin/sh
# Run from your laptop (Git Bash), with YOUR key, whenever a file in deploy/ changes:
#   sh deploy/sync-config.sh <server IP>
# Copies the stack definitions and the deploy scripts to the server and restarts the front
# door. GitHub never changes these: its keys can only deploy an image tag (forgea-deploy-gate),
# so a change here is always one you made on purpose, from a branch you checked.
set -eu
HOST="deploy@${1:?usage: sync-config.sh <server IP>}"
cd "$(dirname "$0")"

scp edge/compose.yaml edge/Caddyfile "$HOST:/srv/forgea/edge/"
for env in production staging; do
  scp app/compose.yaml app/postgres-init.sh app/backup.sh "$HOST:/srv/forgea/$env/"
done
scp server/forgea-deploy server/forgea-deploy-gate server/forgea-backup-serve "$HOST:/tmp/"
ssh "$HOST" '
  set -e
  sudo install -o root -g root -m 755 /tmp/forgea-deploy /tmp/forgea-deploy-gate /tmp/forgea-backup-serve /usr/local/sbin/
  rm /tmp/forgea-deploy /tmp/forgea-deploy-gate /tmp/forgea-backup-serve
  chmod 750 /srv/forgea/production/backup.sh /srv/forgea/staging/backup.sh
  for env in production staging; do
    install -d -m 750 /srv/forgea/$env/backups /srv/forgea/$env/backup-requests
    install -d -m 770 /srv/forgea/$env/backup-requests/queue
    # The download account (for the PC copies) passes through to the backups and reads them only.
    sudo setfacl -m u:backups:x /srv/forgea/$env
    sudo setfacl -m u:backups:rx,d:u:backups:r /srv/forgea/$env/backups
  done
  cd /srv/forgea/edge && docker compose up --detach --remove-orphans
'
echo "Server settings updated."
