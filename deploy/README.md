# Deployment: staging and production on one server

## How it fits together

```
 your laptop (dev)         GitHub                          one Hostinger VPS (Europe)
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
/srv/forgea/edge/        Caddy: compose.yaml, Caddyfile, certs/ (only changed by deploy/sync-config.sh)
/srv/forgea/production/  compose.yaml, backup.sh, .env, api.env, web.env, migrate.env, db.env, backup.env, backups/
/srv/forgea/staging/     the same files, staging's values
```

## Cost (about, per month)

| | | |
|---|---|---|
| Server | Hostinger **KVM 2** (2 vCPU, 8 GB, 100 GB NVMe) | ~$9 for the first 24 months (paid upfront), then ~$15 |
| Cloudflare | Free plan | $0 |
| GitHub | private repository, Actions (2,000 free minutes; a deploy uses ~15), container images (currently free) | $0 |
| Backups | On the server, copied to your PC (on top of Hostinger's own weekly backups) | $0 |

Prices checked 2026-10-28 on review sites; check Hostinger's order page. If the shop grows, or
uploads of big 3D models make the server slow, upgrade to **KVM 4** (4 vCPU, 16 GB) in the panel:
nothing in this setup changes. Trade-off accepted with one server: heavy testing on staging can
slow the real shop for a moment, and if the server fails both are down until it is restored
from backup (about 30 minutes).

## First setup (once, about 2 hours)

You need: a Hostinger account, a Cloudflare account (free), this GitHub repository, Git on your
laptop.

### 1. An SSH key for you

On your laptop (PowerShell or Git Bash):

```sh
ssh-keygen -t ed25519 -C "you@forgea-lab.com"     # Enter for the default file; set a passphrase
cat ~/.ssh/id_ed25519.pub                          # your PUBLIC key: safe to paste anywhere
```

### 2. The server and its firewall

1. Hostinger → **VPS** → buy **KVM 2**. When asked:
   - **Operating system:** plain **Ubuntu 24.04** (the "OS" choice, *not* an "OS with panel" or
     an application template: Docker comes from our setup script).
   - **Location:** a European data centre (e.g. France, Netherlands or Lithuania — the closest
     to Lebanon on Hostinger's current list).
   - **Root password:** a long random one; you will only use it if SSH keys ever fail (from
     Hostinger's browser terminal).
2. hPanel → VPS → **Settings → SSH keys → Add SSH key**: paste your public key from step 1.
3. Check the key works (no password asked): `ssh root@<server IP>`, then type `exit`.
4. From the repository folder on your laptop, run the setup once (5–10 minutes):

   ```sh
   ssh root@<server IP> 'sh -s' < infra/setup-server.sh
   ```

   It creates the `deploy` user, turns off password and root logins, installs Docker, automatic
   security updates, fail2ban and the nightly backups. Afterwards **`ssh deploy@<server IP>`**
   is the only way in.

**Firewall** — hPanel → VPS → **Security → Firewall** → create a configuration, add these
**accept** rules, then **activate** it for the VPS (Hostinger drops everything not accepted):

- TCP **22** from any address (SSH; keys only, passwords are off)
- TCP **443** from Cloudflare's addresses only: one rule per range on
  <https://www.cloudflare.com/ips/> (IPv4 and IPv6)
- Nothing else: the databases and apps have no open ports at all.

Check it from your laptop: `curl -m 10 -k https://<server IP>` must **time out**. If it answers,
the firewall is not active, and anyone could reach the server without going through Cloudflare.

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

### 4. The certificates between Cloudflare and the server

Two certificates make the link private both ways: Cloudflare's **origin certificate** proves the
server to Cloudflare, and **your own client certificate** proves to the server that a request
comes through *your* Cloudflare zone. (Cloudflare's shared one only proves "some Cloudflare
account", which anyone can open.)

1. Cloudflare → SSL/TLS → Origin Server → **Create certificate** → hostnames `forgea-lab.com` and
   `*.forgea-lab.com`, 15 years. Save the two texts as `origin.pem` and `origin-key.pem`.
2. In an empty folder outside the repository (Git Bash): `sh <repo>/deploy/origin-pull-cert.sh`.
   It makes `origin-pull-ca.pem` (for the server), `cloudflare-upload.json` (for Cloudflare) and
   `origin-pull-ca.key` (keep it in your password manager, then delete it here).
3. Give Cloudflare your client certificate and switch the check on. You need the zone ID
   (Cloudflare → forgea-lab.com → Overview, right column) and an API token with
   "Zone → SSL and Certificates → Edit" for this zone (My Profile → API Tokens):

   ```sh
   ZONE=<zone ID>; TOKEN=<API token>
   curl -sX POST "https://api.cloudflare.com/client/v4/zones/$ZONE/origin_tls_client_auth" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     --data @cloudflare-upload.json
   ```

   Then Cloudflare → SSL/TLS → Origin Server → **Authenticated Origin Pulls: on**.
4. Copy the server's three files in. They belong to root, so nobody else on the server can read
   them:

   ```sh
   scp origin.pem origin-key.pem origin-pull-ca.pem deploy@<server IP>:/tmp/
   ssh deploy@<server IP> 'cd /tmp && sudo install -o root -g root -m 600 origin.pem origin-key.pem origin-pull-ca.pem /srv/forgea/edge/certs/ && rm origin.pem origin-key.pem origin-pull-ca.pem'
   ```

Delete everything from your laptop afterwards, except `origin-pull-ca.key` in your password
manager.

### 5. Each environment's settings and passwords

Do this twice, once for `production` and once for `staging`, in a folder **outside** the repository:

```sh
cp <repo>/deploy/env/compose.env.example .env      # staging: ENV_NAME=staging
cp <repo>/deploy/env/api.env.example api.env       # comments say what differs on staging
cp <repo>/deploy/env/web.env.example web.env       # staging: API_URL=http://staging-api:3000
cp <repo>/deploy/env/migrate.env.example migrate.env
cp <repo>/deploy/env/db.env.example db.env
cp <repo>/deploy/env/backup.env.example backup.env
# fill them in — NEW random secrets for each environment — then:
scp .env api.env web.env migrate.env db.env backup.env deploy@<server IP>:/srv/forgea/production/
ssh deploy@<server IP> 'chmod 600 /srv/forgea/production/.env /srv/forgea/production/*.env'
```

The deploy and backup scripts refuse to run if a folder's settings name the other environment,
so a copy-paste slip can't put staging on production's data.

**Google sign-in — one OAuth client per environment** (Google Cloud console → APIs & Services →
Credentials → Create credentials → OAuth client ID → Web application):

- `Forgea production`: redirect URI `https://forgea-lab.com/auth/google/callback`
- `Forgea staging`: redirect URI `https://staging.forgea-lab.com/auth/google/callback`

Each environment's `api.env` gets its own client ID and secret, so staging never holds
production's.

**Backups:** nothing to set up outside the server: each environment keeps its own encrypted
backups (see "Backups" below) and your PC keeps copies. Put a long random `BACKUP_PASSWORD` in
each `backup.env` and keep it in a password manager too: without it the backups can't be read.

Optional but recommended: a free check on <https://healthchecks.io> per environment (daily,
1 hour grace); put its ping URL in `backup.env` as `HEALTHCHECK_URL`. It emails you if a night's
backup didn't happen.

### 6. Put the stack on the server

From the repository folder on your laptop (Git Bash), with your own key:

```sh
sh deploy/sync-config.sh <server IP>
```

It copies the front door, the stack definitions and the deploy scripts to the server. Run it
again whenever something in `deploy/` changes: GitHub never changes these files itself.

### 7. Let GitHub deploy — with keys that can only deploy

GitHub logs in as the `ci` user, which can't open a shell or use Docker: each key can only ask
for "deploy version X" to **one** environment. Create one key per environment:

```sh
ssh-keygen -t ed25519 -N "" -f forgea-deploy-staging -C github-staging
ssh-keygen -t ed25519 -N "" -f forgea-deploy-production -C github-production
ssh-keyscan -t ed25519 <server IP>        # the server's fingerprint line; compare it with what
                                          # Hostinger's browser terminal prints for:
                                          # ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

On the server, add both public keys to the `ci` user, each pinned to its environment:

```sh
ssh deploy@<server IP>
sudo nano /home/ci/.ssh/authorized_keys
```

with exactly these two lines (paste each `.pub` file's content after the options):

```
restrict,command="/usr/local/sbin/forgea-deploy-gate staging" ssh-ed25519 AAAA…  github-staging
restrict,command="/usr/local/sbin/forgea-deploy-gate production" ssh-ed25519 AAAA…  github-production
```

GitHub → the repository → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `SSH_HOST` | the server's IP |
| `SSH_KNOWN_HOSTS` | the `ssh-keyscan` line |
| `STAGING_DEPLOY_KEY` | the whole content of `forgea-deploy-staging` (the private file) |
| `PRODUCTION_DEPLOY_KEY` | the whole content of `forgea-deploy-production` |

Then delete the private key files from your laptop. Also, in GitHub:

- your account → Settings → Password and authentication → **two-factor authentication on**:
  whoever controls your GitHub account controls what the shop runs;
- the repository → Settings → Actions → General → Workflow permissions → **Read repository
  contents** (the default for new repositories; the deploy asks for what it needs).

> Limit, honestly: on GitHub's free plan, every workflow of the repository can read every
> repository secret, so someone able to push a workflow could use the production key — though
> only to deploy an image to production, never to log in. Only you can push today. If you ever
> add collaborators, GitHub **Pro** (about $4/month) lets you lock `PRODUCTION_DEPLOY_KEY` to the
> `production` branch (Settings → Environments).

### 8. First deploy

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

When staging looks right: merge `staging` into `production` and push → the real shop. Import the
catalog there the same way (in `/srv/forgea/production`).

## Every day

| I want to… | Do |
|---|---|
| Daily work | Commit and push to `development` (tests run on every push) |
| Try a change | Merge `development` into `staging`, push; check staging.forgea-lab.com |
| Release it | Merge `staging` into `production`, push |
| Undo a release | GitHub → Actions → Deploy → Run workflow → environment + the previous tag (`sha-…`, in the earlier run) |
| Undo from the server itself | Once: `docker login ghcr.io -u <GitHub name>` with a GitHub token allowed to read packages; then `forgea-deploy production sha-…` |
| Change something in `deploy/` | Merge it as usual, then `sh deploy/sync-config.sh <server IP>` |
| Update Docker images (Dependabot's weekly pull requests) | Review, let CI pass, merge into `development` |
| See logs | `ssh deploy@<IP>`, `cd /srv/forgea/production`, `docker compose logs -f api` (or `web`) |
| Front door logs | `cd /srv/forgea/edge && docker compose logs -f caddy` |
| Back up now | `/srv/forgea/production/backup.sh` (runs by itself every night, both environments) |

## Backups

Every night (03:30, server time) each environment saves its database and every uploaded file
into one file in `/srv/forgea/<env>/backups`, encrypted on the server with `BACKUP_PASSWORD`
(`backup.env`; keep it in your password manager: without it no backup can be read). The newest
5 are kept (change it on the dashboard; never fewer than `MIN_KEEP` in `backup.env`), plus the
newest of each of the last 8 weeks and 6 months. Production is also backed up before every
deploy. Nothing is sent to a cloud service, nothing costs money.

**Dashboard → Settings → Backups** (admins only) shows the server's disk, every backup, and:
**Back up now**, **Download** (to your PC), **Restore** (type the environment's name; a backup
of the current state is made first, so a wrong restore can be undone; the shop pauses about a
minute and sessions may end) and **Delete**. The website only *reads* the backups folder: it
asks the server for these by leaving a request (`backup-requests/queue`) that `backup.sh`
checks and carries out, so the website can never alter or remove a backup by itself.

By hand on the server (as `deploy`): `./backup.sh list`, `./backup.sh now`,
`./backup.sh restore <file>`, `./backup.sh delete <file>`.

### Backups on your PC

A scheduled task copies new backups to `C:\Files\Backups\Forgea\<env>` and keeps the newest 5
there (`deploy/pc/forgea-pull-backups.ps1`, log in `pull.log`). It uses its own key
(`~/.ssh/forgea_backups`) that the server lets do nothing but list and send backups
(`forgea-backup-serve`, account `backups`); the files are encrypted, so the key reveals no data.
The server's address is in `C:\Files\Backups\Forgea\server.txt` (one line, on the PC only).

### Restore on a new server

Copy a backup to `/srv/forgea/<env>/backups/` (as `deploy`, after setting the server up and
putting the same `backup.env` back), then `./backup.sh restore <file>`.

### Open a backup on your PC (Git Bash)

```sh
tar -xf forgea-production-2026-11-05-033012.tar     # manifest.json + two encrypted parts
gpg -d forgea.dump.gpg > forgea.dump                 # asks for BACKUP_PASSWORD; a pg_restore file
gpg -d uploads.tar.gz.gpg | tar -xz                  # the uploaded files
```

Try a restore on staging once, so the day it matters it is routine.
