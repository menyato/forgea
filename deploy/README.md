# Deployment: staging and production on one server

## How it fits together

```
 your laptop (dev)         GitHub                          one Hetzner server (Germany)
 pnpm dev, tests  ──push──▶ tests → build images ──deploy──▶ staging.forgea-lab.com  (branch staging)
                            (GitHub Actions)               forgea-lab.com          (branch production)

 visitor ─▶ Cloudflare (free: HTTPS, caching, attack shield) ─▶ Caddy ─┬─▶ production: web ─▶ api ─▶ postgres
                                                                      └─▶ staging:    web ─▶ api ─▶ postgres
```

- **dev**: your laptop, as today (`docs/LOCAL_SETUP.md`). Nothing is deployed from it.
- **staging**: a private copy of the shop to try changes before customers see them.
  Push to the `staging` branch → tests run → it updates by itself.
- **production**: the real shop. Push (or merge) to `production` → tests run → it updates by itself.
- One server runs both. Each environment has **its own** database, uploaded files, passwords,
  backups and private networks (`app/compose.yaml`, run twice); they share only the front door
  (`edge/`: Caddy). A deploy to one never restarts the other.

Server layout:

```
/srv/forgea/edge/        Caddy: compose.yaml, Caddyfile, certs/
/srv/forgea/production/  compose.yaml, deploy.sh, backup.sh, .env, api.env, web.env, db.env, backup.env, backup-key.json
/srv/forgea/staging/     the same files, staging's values
```

## Cost (about, per month, excluding VAT)

| | | |
|---|---|---|
| Server | Hetzner **CX33** (4 vCPU, 8 GB, 80 GB) | €8.50 |
| Cloudflare | Free plan | €0 |
| GitHub | private repository, Actions (2,000 free minutes; a deploy uses ~15), container images (currently free) | €0 |
| Backups | Google Cloud Storage | a few cents |

Hetzner changed prices three times in 2026: check the order page. Trade-off accepted with one
server: heavy testing on staging can slow the real shop for a moment, and if the server fails
both are down until it is restored from backup (about 30 minutes).

## First setup (once, about 2 hours)

You need: a Hetzner account, a Cloudflare account (free), this GitHub repository, Git on your
laptop.

### 1. An SSH key for you

On your laptop (PowerShell or Git Bash):

```sh
ssh-keygen -t ed25519 -C "you@forgea-lab.com"     # Enter for the default file; set a passphrase
cat ~/.ssh/id_ed25519.pub                          # your PUBLIC key: safe to paste anywhere
```

### 2. The server and its firewall

Hetzner Cloud console → new project "Forgea" → **Add server**:

- Location: Falkenstein or Nuremberg (Germany) · Image: **Ubuntu 24.04** · Type: **CX33**
- Networking: public IPv4 + IPv6 · Name: `forgea`
- **Cloud config**: paste `infra/cloud-init.yaml`, with your public key in place of
  `ssh-ed25519 AAAA...REPLACE...`

**Firewall** (Hetzner console → Firewalls → Create, apply to the server):

- Inbound TCP **22** from any address (SSH; keys only, passwords are off)
- Inbound TCP **443** from Cloudflare's addresses only: every range on
  <https://www.cloudflare.com/ips/> (IPv4 and IPv6)
- Nothing else: the databases and apps have no open ports at all.

After 2–3 minutes: `ssh deploy@<server IP>` should log you in.

### 3. The domain on Cloudflare

The domain is registered at Squarespace (Google Domains moved there). Squarespace keeps the
registration; Cloudflare answers for it.

1. Cloudflare → **Add a site** → `forgea-lab.com` → Free plan. Cloudflare copies the existing DNS
   records. **Check the Google Workspace ones are there before going on, or email stops:** the
   MX records (`smtp.google.com`, or the `aspmx.l.google.com` set) and the TXT records for SPF
   (`v=spf1 include:_spf.google.com ~all`), DKIM (`google._domainkey`) and
   `google-site-verification`. Copy any missing one from Squarespace → Domains → DNS.
2. Squarespace → Domains → forgea-lab.com → **Nameservers** → custom → the two Cloudflare gives.
   Takes minutes to a few hours.
3. Cloudflare → DNS (all **Proxied**, orange cloud), all to the one server:
   - `A forgea-lab.com → server IPv4` and `AAAA forgea-lab.com → server IPv6`
   - `A www → server IPv4`
   - `A staging → server IPv4`
4. Cloudflare → SSL/TLS → **Full (strict)**; Edge Certificates → **Always Use HTTPS** on,
   minimum TLS **1.2**.
5. Recommended: Cloudflare → Zero Trust (free for up to 50 people) → Access → protect
   `staging.forgea-lab.com` with your Google Workspace login, so only the team sees staging.

### 4. The certificate between Cloudflare and the server

Cloudflare → SSL/TLS → Origin Server → **Create certificate** → hostnames `forgea-lab.com` and
`*.forgea-lab.com`, 15 years. Save the two texts as `origin.pem` and `origin-key.pem`, then:

```sh
scp origin.pem origin-key.pem deploy@<server IP>:/srv/forgea/edge/certs/
ssh deploy@<server IP> chmod 600 /srv/forgea/edge/certs/origin-key.pem
```

Delete the two files from your laptop afterwards.

### 5. Each environment's settings and passwords

Do this twice, once for `production` and once for `staging`, in a folder **outside** the repository:

```sh
cp <repo>/deploy/env/compose.env.example .env      # staging: ENV_NAME=staging
cp <repo>/deploy/env/api.env.example api.env       # comments say what differs on staging
cp <repo>/deploy/env/web.env.example web.env
cp <repo>/deploy/env/db.env.example db.env
cp <repo>/deploy/env/backup.env.example backup.env
# fill them in — NEW random secrets for each environment — then:
scp .env api.env web.env db.env backup.env deploy@<server IP>:/srv/forgea/production/
ssh deploy@<server IP> chmod 600 /srv/forgea/production/.env /srv/forgea/production/*.env
```

**Backups:** Google Cloud console → Cloud Storage → two buckets, `forgea-backups-production` and
`forgea-backups-staging` (region europe-west3, Standard, **public access prevention on**). IAM →
a service account per bucket with the role **Storage Object Admin on that bucket only** →
Keys → JSON → copy each to its environment as `/srv/forgea/<env>/backup-key.json`
(`chmod 600`), then delete them from your laptop. Keep each restic password in a password
manager too: without it the backups can't be read.

**Google sign-in:** Google Cloud console → APIs & Services → Credentials → the OAuth client →
add both redirect URIs: `https://forgea-lab.com/auth/google/callback` and
`https://staging.forgea-lab.com/auth/google/callback`.

### 6. Let GitHub deploy

A key used only by GitHub:

```sh
ssh-keygen -t ed25519 -N "" -f forgea-deploy -C github-deploy
ssh-copy-id -i forgea-deploy.pub deploy@<server IP>
ssh-keyscan -t ed25519 <server IP>        # the server's fingerprint line
```

GitHub → the repository → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `SSH_HOST` | the server's IP |
| `SSH_KEY` | the whole content of `forgea-deploy` (the private file, not `.pub`) |
| `SSH_KNOWN_HOSTS` | the `ssh-keyscan` line |

Then delete `forgea-deploy` from your laptop.

### 7. First deploy

```sh
git push origin staging        # Actions tab: CI, then images, then deploy (~15 minutes)
```

Open <https://staging.forgea-lab.com>, sign in with Google as `BOOTSTRAP_ADMIN_EMAIL` → you are the
admin. Load the catalog (export it from your laptop's dashboard → Import & export):

```sh
scp forgea-catalog.json deploy@<server IP>:/srv/forgea/staging/
ssh deploy@<server IP>
cd /srv/forgea/staging && docker compose run --rm -v ./forgea-catalog.json:/tmp/catalog.json:ro \
  api node scripts/import-catalog.ts /tmp/catalog.json
```

When staging looks right: merge `staging` into `production` and push → the real shop. Import the catalog
there the same way (in `/srv/forgea/production`).

## Every day

| I want to… | Do |
|---|---|
| Daily work | Commit and push to `development` (tests run on every push) |
| Try a change | Merge `development` into `staging`, push; check staging.forgea-lab.com |
| Release it | Merge `staging` into `production`, push |
| Undo a release | GitHub → Actions → Deploy → Run workflow → environment + the previous tag (`sha-…`, in the earlier run) |
| See logs | `ssh deploy@<IP>`, `cd /srv/forgea/production`, `docker compose logs -f api` (or `web`) |
| Front door logs | `cd /srv/forgea/edge && docker compose logs -f caddy` |
| Back up now | `/srv/forgea/production/backup.sh` (runs by itself every night, both environments) |

## Restore from a backup

```sh
ssh deploy@<IP> && cd /srv/forgea/production
./backup.sh snapshots                                   # pick one, or use "latest"
docker run --rm --env-file backup.env -e GOOGLE_APPLICATION_CREDENTIALS=/key.json \
  -v "$PWD/backup-key.json:/key.json:ro" -v "$PWD/restore:/restore" \
  restic/restic:0.18.0 restore latest --target /restore
docker compose stop web api
docker compose exec -T postgres pg_restore --username postgres --clean --if-exists \
  --dbname forgea < restore/backups/forgea.dump
docker run --rm -v forgea-production_uploads:/data/uploads -v "$PWD/restore/data/uploads:/from:ro" \
  alpine:3.22 cp -a /from/. /data/uploads/
docker compose start api web
```

Try a restore on staging once, so the day it matters it is routine.
