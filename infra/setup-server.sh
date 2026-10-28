#!/bin/sh
# One-time setup of a fresh Ubuntu 24.04 server (Hostinger VPS, or any other), run as root:
#   ssh root@<server IP> 'sh -s' < infra/setup-server.sh
# Before running it, add your SSH public key in Hostinger's panel (VPS → Settings → SSH keys)
# and check `ssh root@<server IP>` logs you in WITHOUT a password: this script copies that key
# to the `deploy` user, then turns off password and root logins.
#
# It creates the `deploy` user (SSH key only) that you and GitHub Actions log in as; adds
# fail2ban and automatic security updates; installs Docker from Docker's own repository; and
# prepares /srv/forgea/{edge,production,staging} with a nightly backup of each environment.
# Safe to run again.
set -eu

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
[ -s /root/.ssh/authorized_keys ] || {
  echo "No SSH key for root yet: add yours in the Hostinger panel first (see the top of this file)."
  exit 1
}
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl fail2ban unattended-upgrades

# The deploy user: same SSH key as root, sudo without a password (it has no password at all).
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups sudo deploy
passwd --lock deploy >/dev/null
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
if [ ! -s /home/deploy/.ssh/authorized_keys ]; then
  install -o deploy -g deploy -m 600 /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi
echo 'deploy ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/deploy
chmod 440 /etc/sudoers.d/deploy

# SSH: keys only, no root login, only the deploy user.
cat >/etc/ssh/sshd_config.d/10-forgea.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers deploy
EOF

# Security updates installed automatically every day.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# Docker Engine and the Compose plugin, from Docker's apt repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy

# A 2 GB swap file: headroom when a big 3D model is compressed on upload.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

install -d -o deploy -g deploy -m 0750 /srv/forgea /srv/forgea/edge /srv/forgea/edge/certs \
  /srv/forgea/production /srv/forgea/staging

# One nightly backup per environment: forgea-backup@production, forgea-backup@staging.
cat >/etc/systemd/system/forgea-backup@.service <<'EOF'
[Unit]
Description=Forgea nightly backup (%i)
After=docker.service
[Service]
Type=oneshot
User=deploy
ExecStart=/srv/forgea/%i/backup.sh
EOF
cat >/etc/systemd/system/forgea-backup@.timer <<'EOF'
[Unit]
Description=Forgea nightly backup (%i)
[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15m
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now fail2ban
systemctl enable forgea-backup@production.timer forgea-backup@staging.timer
systemctl restart ssh

echo "Done. From now on log in as: ssh deploy@<server IP>  (root login is off)"
