#!/bin/sh
# Runs once, when the database volume is first created. The API and migrations connect as
# forgea_app, which owns only the forgea database; the postgres superuser is for the owner's
# maintenance only and is never given to an app.
set -eu

: "${APP_DB_PASSWORD:?set APP_DB_PASSWORD in /srv/forgea/db.env}"

psql -v ON_ERROR_STOP=1 --username postgres --set=pw="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE forgea_app LOGIN PASSWORD :'pw';
CREATE DATABASE forgea OWNER forgea_app;
REVOKE ALL ON DATABASE forgea FROM PUBLIC;
SQL
