#!/bin/bash
# Backups of one environment (/srv/forgea/<production|staging>), managed from the dashboard's
# Backups page. Each backup is one file in ./backups: the database and every uploaded file,
# encrypted on this server (gpg, AES-256, BACKUP_PASSWORD in backup.env) before it is written,
# so no plain copy ever touches the disk. Kept after each new backup: the newest N (N from the
# dashboard, 1-30, default 5, never below MIN_KEEP in backup.env, default 3), plus the newest of
# each of the last 8 weeks and of the last 6 months; older ones are deleted.
#
#   ./backup.sh                  the nightly backup (systemd timer forgea-backup@<env>)
#   ./backup.sh now [label]      a backup now
#   ./backup.sh list             what can be restored
#   ./backup.sh delete <file>
#   ./backup.sh restore <file>   makes a "before-restore" backup first, then restores
#   ./backup.sh process          the dashboard's requests (systemd path unit forgea-backup-requests@<env>)
#
# The website can read ./backups (to list and download) but never write it: it asks for a
# backup, a restore or a delete by leaving a request in ./backup-requests/queue, and only this
# script, checking every field, acts on it. A compromised website can't delete or alter backups.
set -euo pipefail
cd "$(dirname "$0")"
here="$PWD"
env_name="$(basename "$here")"
# The folder and its settings must agree, or one environment could be backed up as the other.
grep -qx "ENV_NAME=$env_name" .env || { echo ".env does not say ENV_NAME=$env_name" >&2; exit 3; }

dir="$here/backups"
requests="$here/backup-requests"
queue="$requests/queue"
install -d -m 750 "$dir" "$requests"
install -d -m 770 "$queue"

name_ok() { [[ "$1" =~ ^forgea-${env_name}-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}(-[a-z]{1,20}(-[a-z]{1,20})?)?\.tar$ ]]; }
setting() { sed -n "s/^$1=//p" backup.env | head -n 1; }

BACKUP_PASSWORD="$(setting BACKUP_PASSWORD)"
[ "${#BACKUP_PASSWORD}" -ge 20 ] || { echo "backup.env needs BACKUP_PASSWORD (20+ characters)" >&2; exit 3; }
# gpg in a throwaway home: nothing (no passphrase) is cached between runs.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
# Also what a run cut short leaves behind (its work folder, a half-written file, "running").
cleanup() {
  gpgconf --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$GNUPGHOME"
  if [ -n "${owns_lock:-}" ]; then
    rm -rf "$dir"/.work.* "$dir"/.*.part "$dir/.restoring.tar"
    [ -f "$dir/.running" ] && { rm -f "$dir/.running"; status; }
  fi
  return 0
}
trap cleanup EXIT
encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --no-symkey-cache --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 \
    --s2k-count 65011712 --compress-algo none --output "$1" 3<<<"$BACKUP_PASSWORD"
}
decrypt() {
  gpg --batch --quiet --pinentry-mode loopback --no-symkey-cache --passphrase-fd 3 \
    --decrypt "$1" 3<<<"$BACKUP_PASSWORD"
}

# How many of the newest to keep: the dashboard's choice, never below the server's minimum (a
# compromised dashboard can't shrink the history to one).
keep() {
  local n min
  n="$(grep -o '"keep" *: *[0-9]\{1,2\}' "$requests/settings.json" 2>/dev/null | grep -o '[0-9]*$' || true)"
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le 30 ] || n=5
  min="$(setting MIN_KEEP)"
  [[ "$min" =~ ^[0-9]+$ ]] && [ "$min" -ge 1 ] && [ "$min" -le 30 ] || min=3
  [ "$n" -ge "$min" ] && echo "$n" || echo "$min"
}

# Deletes what is no longer kept: beyond the newest N, only the newest backup of each of the
# last 8 weeks and of the last 6 months stays (so a problem noticed late still has a copy).
rotate() {
  local n i=0 f day week month weeks=0 months=0 keepit
  local seen_weeks=" " seen_months=" "
  n="$(keep)"
  for f in $(ls -1t "$dir"/forgea-"$env_name"-*.tar 2>/dev/null); do
    i=$(( i + 1 ))
    day="$(basename "$f" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | head -n 1)"
    week="$(date -u -d "$day" +%G-%V)"
    month="${day:0:7}"
    keepit=false
    [ "$i" -le "$n" ] && keepit=true
    if [[ "$seen_weeks" != *" $week "* ]]; then
      seen_weeks="$seen_weeks$week "
      if [ "$weeks" -lt 8 ]; then weeks=$(( weeks + 1 )); keepit=true; fi
    fi
    if [[ "$seen_months" != *" $month "* ]]; then
      seen_months="$seen_months$month "
      if [ "$months" -lt 6 ]; then months=$(( months + 1 )); keepit=true; fi
    fi
    $keepit || rm -f -- "$f"
  done
}

# What the dashboard shows: what is running now, and the last results (status.json).
status() {
  local last=''
  [ -f "$dir/.events" ] && last="$(tail -n 10 "$dir/.events" | paste -sd, -)"
  printf '{"running":%s,"last":[%s]}\n' "$(cat "$dir/.running" 2>/dev/null || echo null)" "$last" >"$dir/.status.tmp"
  chmod 640 "$dir/.status.tmp"
  mv "$dir/.status.tmp" "$dir/status.json"
}
# Every field is our own text, a checked file name or a checked address: nothing to escape.
event() {
  printf '{"action":"%s","file":"%s","ok":%s,"message":"%s","by":"%s","at":"%s"}\n' \
    "$1" "$2" "$3" "$4" "${by:-nightly}" "$(date -u +%FT%TZ)" >>"$dir/.events"
  tail -n 50 "$dir/.events" >"$dir/.events.tmp" && mv "$dir/.events.tmp" "$dir/.events"
  status
}
running() {
  printf '{"action":"%s","file":"%s","since":"%s"}' "$1" "$2" "$(date -u +%FT%TZ)" >"$dir/.running"
  status
}
idle() { rm -f "$dir/.running"; status; }

exec 9>"$dir/.lock"
# One at a time; the dashboard's requests wait (up to an hour) for a running backup to end.
lock() {
  flock -w "${1:-0}" 9 || { echo "Another backup or restore (or a deploy) is running" >&2; exit 4; }
  owns_lock=1
}

# One backup: the database straight from pg_dump into gpg, the files straight from tar into gpg.
backup() {
  local label="${1:-}" stamp name work newest size=0 need free
  # Room for one more like the last one, twice over, and 500 MB to spare.
  newest="$(ls -1t "$dir"/forgea-"$env_name"-*.tar 2>/dev/null | head -n 1 || true)"
  [ -z "$newest" ] || size="$(stat -c %s "$newest")"
  need=$(( size * 2 + 500 * 1024 * 1024 ))
  free=$(( $(df --output=avail -B1 "$dir" | tail -n 1) ))
  if [ "$free" -lt "$need" ]; then
    event backup "" false "Not enough free space on the server: delete old backups first"
    return 1
  fi
  stamp="$(date -u +%Y-%m-%d-%H%M%S)"
  name="forgea-$env_name-$stamp${label:+-$label}.tar"
  running backup "$name"
  work="$(mktemp -d "$dir/.work.XXXXXX")"
  if docker compose exec -T postgres pg_dump --username postgres --format custom forgea |
       encrypt "$work/forgea.dump.gpg" &&
     docker run --rm -v "forgea-${env_name}_uploads:/data/uploads:ro" alpine:3.22 \
       tar -C /data -czf - uploads | encrypt "$work/uploads.tar.gz.gpg" &&
     printf '{"environment":"%s","created":"%s","app":"%s"}\n' "$env_name" \
       "$(date -u +%FT%TZ)" "$(sed -n 's/^TAG=//p' .env)" >"$work/manifest.json" &&
     tar -C "$work" -cf "$dir/.$name.part" manifest.json forgea.dump.gpg uploads.tar.gz.gpg; then
    chmod 640 "$dir/.$name.part"
    mv "$dir/.$name.part" "$dir/$name"
    rm -rf "$work"
    # Only what the keep rule says stays.
    rotate
    idle
    event backup "$name" true "Saved"
  else
    rm -rf "$work" "$dir/.$name.part"
    idle
    event backup "$name" false "The backup could not be made"
    return 1
  fi
}

restore() {
  local file="$1" work source="$dir/.restoring.tar"
  name_ok "$file" && [ -f "$dir/$file" ] || { event restore "" false "No such backup"; return 1; }
  # A second name for it while it is restored: the safety backup's clean-up may delete the
  # oldest backup, which may be this one.
  ln -f "$dir/$file" "$source"
  # The state before, kept as a backup of its own: a wrong restore can be undone.
  backup before-restore || { rm -f "$source"; event restore "$file" false "Not restored: the safety backup failed"; return 1; }
  running restore "$file"
  work="$(mktemp -d "$dir/.work.XXXXXX")"
  if ! tar -C "$work" -xf "$source" forgea.dump.gpg uploads.tar.gz.gpg ||
     ! decrypt "$work/forgea.dump.gpg" >/dev/null || ! decrypt "$work/uploads.tar.gz.gpg" >/dev/null; then
    rm -rf "$work"; idle
    event restore "$file" false "Not restored: this backup can't be read (wrong password or damaged)"
    return 1
  fi
  rm -f "$source"
  docker compose stop web api
  local ok=true
  # The whole database replaced in one transaction: emptied first (tables a newer release
  # added included, which pg_restore --clean would leave and the migrations would then trip
  # on), then the backup's contents. Any error and nothing changed.
  decrypt "$work/forgea.dump.gpg" |
    docker compose exec -T postgres sh -c '
      { echo "BEGIN;"
        echo "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner;"
        # A backup that ends early (damaged) fails the transaction: nothing is committed.
        pg_restore --file - || echo "SELECT 1/0;"
        echo "COMMIT;"
      } | psql --username postgres --dbname forgea --set ON_ERROR_STOP=1 \
          --quiet --output /dev/null' || ok=false
  if $ok; then
    decrypt "$work/uploads.tar.gz.gpg" |
      docker run --rm -i -v "forgea-${env_name}_uploads:/data/uploads" alpine:3.22 \
        sh -c 'find /data/uploads -mindepth 1 -delete && tar -C /data -xzf -' || ok=false
  fi
  rm -rf "$work"
  # An older backup is brought up to the running version's database (its newer migrations
  # apply on top, as on the day they were released).
  $ok && { docker compose run --rm migrate || ok=false; }
  docker compose up --detach --wait api web || ok=false
  idle
  if $ok; then event restore "$file" true "Restored"; else
    event restore "$file" false "The restore stopped part-way: restore the before-restore backup"
    return 1
  fi
}

remove() {
  local file="$1"
  name_ok "$file" && [ -f "$dir/$file" ] || { event delete "" false "No such backup"; return 1; }
  # From the dashboard the newest can't go: one backup always stays on the server.
  if [ "${by:-}" != server ] &&
     [ "$(ls -1t "$dir"/forgea-"$env_name"-*.tar | head -n 1)" = "$dir/$file" ]; then
    event delete "$file" false "The newest backup can't be deleted from the dashboard"
    return 1
  fi
  rm -f -- "$dir/$file"
  event delete "$file" true "Deleted"
}

# The dashboard's requests, oldest first. Each file is removed before it is acted on, so a bad
# one can never run twice; anything that isn't exactly a known action is ignored.
process() {
  local f action file
  for f in $(ls -1 "$queue"/*.json 2>/dev/null | sort); do
    action="$(grep -o '"action" *: *"[a-z]*"' "$f" | grep -o '[a-z]*"$' | tr -d '"' || true)"
    file="$(grep -o '"file" *: *"[A-Za-z0-9._-]*"' "$f" | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    by="$(grep -o '"by" *: *"[A-Za-z0-9._%+@-]\{1,120\}"' "$f" | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    by="${by:-dashboard}"
    rm -f -- "$f"
    case "$action" in
      backup) backup manual || true ;;
      restore) restore "$file" || true ;;
      delete) remove "$file" || true ;;
    esac
  done
  # Requests for the other kind of change (settings) are read where they are used.
  status
}

case "${1:-nightly}" in
  nightly)
    lock
    backup ""
    # Optional: a healthchecks.io-style URL in backup.env (HEALTHCHECK_URL=...) is called after a
    # successful night, so a missed or failed backup sends you an email.
    ping_url="$(setting HEALTHCHECK_URL)"
    [ -z "$ping_url" ] || curl -fsS -m 10 --retry 3 "$ping_url" >/dev/null
    ;;
  now) by=server; lock; backup "${2:-manual}" ;;
  list) ls -lh "$dir"/forgea-"$env_name"-*.tar 2>/dev/null || echo "No backups yet" ;;
  delete) by=server; lock; remove "${2:?file}" ;;
  restore) by=server; lock; restore "${2:?file}" ;;
  process) lock 3600; process ;;
  *) echo "usage: backup.sh [now [label]|list|delete <file>|restore <file>|process]" >&2; exit 2 ;;
esac
