#!/bin/sh
# Runs on the server in /srv/forgea/<production|staging>, called by .github/workflows/deploy.yml
# over SSH (or by hand to roll back):
#   ./deploy.sh sha-1a2b3c4   deploy that image tag to this environment
# Makes sure the shared front door runs, pulls the images, applies database migrations, then
# replaces this environment's containers. If migrations fail, nothing is replaced and the
# running version keeps serving. The other environment is never touched.
set -eu
cd "$(dirname "$0")"

TAG="${1:?usage: deploy.sh <image tag>}"
export TAG # overrides TAG= in .env for these commands

(cd ../edge && docker compose up --detach --remove-orphans)

docker compose --profile tools pull --quiet
docker compose run --rm migrate
docker compose up --detach --remove-orphans --wait

# Recorded only once the new version is up, so a restart never picks a half-deployed one.
sed -i "s/^TAG=.*/TAG=$TAG/" .env

# Images unused for a week go; the previous release usually stays for a quick rollback.
docker image prune --all --force --filter "until=168h" >/dev/null
echo "Deployed $TAG to $(basename "$PWD")"
