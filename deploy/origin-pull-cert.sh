#!/bin/sh
# Run once on your laptop (Git Bash: it has openssl), in an EMPTY folder outside the repository:
#   sh <repo>/deploy/origin-pull-cert.sh
# Makes your own small certificate authority and, signed by it, the certificate Cloudflare will
# present to the server on every request (Authenticated Origin Pulls with your own
# certificate). Cloudflare's shared certificate only proves "some Cloudflare account"; this one
# proves "your zone", so traffic routed through anyone else's Cloudflare account is refused.
#
# Writes:
#   origin-pull-ca.pem     → the server: /srv/forgea/edge/certs/ (Caddy trusts it)
#   cloudflare-upload.json → Cloudflare, with the curl command in deploy/README.md, step 4
#   origin-pull-ca.key     → keep it offline (a password manager): it can make new certificates
# Delete the other files afterwards.
set -eu
# Git Bash would rewrite "-subj /CN=..." into a Windows path ("C:/Program Files/Git/CN=...").
export MSYS_NO_PATHCONV=1

openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout origin-pull-ca.key -out origin-pull-ca.pem \
  -subj "/CN=Forgea origin-pull CA"

openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout origin-pull-client.key -out origin-pull-client.csr \
  -subj "/CN=Forgea via Cloudflare"
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=clientAuth\n' \
  >client.ext
openssl x509 -req -sha256 -days 3650 -in origin-pull-client.csr \
  -CA origin-pull-ca.pem -CAkey origin-pull-ca.key -CAcreateserial \
  -extfile client.ext -out origin-pull-client.pem

# Cloudflare wants the certificate and its key as JSON strings.
node -e '
const fs = require("fs");
fs.writeFileSync("cloudflare-upload.json", JSON.stringify({
  certificate: fs.readFileSync("origin-pull-client.pem", "utf8"),
  private_key: fs.readFileSync("origin-pull-client.key", "utf8"),
}));
'
rm -f origin-pull-client.csr client.ext origin-pull-ca.srl
echo "Done: see deploy/README.md, step 4."
