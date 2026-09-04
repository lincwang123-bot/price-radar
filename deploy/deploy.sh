#!/usr/bin/env bash
# price-radar deploy script (run on local machine).
# Syncs code to VPS /opt/linc/apps/price-radar and installs/starts systemd units.
# Prereq: ssh alias 'linc-vps' configured; deploy user has passwordless sudo.
set -euo pipefail

APP_DIR=/opt/linc/apps/price-radar
REMOTE=linc-vps
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> rsync code -> ${REMOTE}:${APP_DIR} (exclude data/, .env, .git)"
rsync -az --delete \
  --exclude 'data/' \
  --exclude '.env' \
  --exclude '.git' \
  --exclude 'config.json' \
  --exclude 'docs/_scrape/' \
  -e ssh "$LOCAL_DIR/" "${REMOTE}:${APP_DIR}/"

echo "==> ensure data dir + ownership deploy:deploy"
ssh "$REMOTE" "sudo mkdir -p ${APP_DIR}/data && sudo chown -R deploy:deploy ${APP_DIR} && echo chown-ok"

echo "==> install systemd units"
for u in price-radar-collect price-radar-web price-radar-tunnel; do
  scp -q "$LOCAL_DIR/deploy/${u}.service" "${REMOTE}:/tmp/${u}.service"
  ssh "$REMOTE" "sudo install -o root -g root -m 644 /tmp/${u}.service /etc/systemd/system/${u}.service && rm -f /tmp/${u}.service"
done

echo "==> runtime env file; create if missing"
ssh "$REMOTE" "test -f ${APP_DIR}/.env || { umask 077; sudo -u deploy touch ${APP_DIR}/.env; echo env-created; }"

echo "==> daemon-reload + enable + start"
ssh "$REMOTE" "sudo systemctl daemon-reload && sudo systemctl enable price-radar-collect price-radar-web price-radar-tunnel && sudo systemctl restart price-radar-collect price-radar-web price-radar-tunnel && echo started"

echo "==> service states"
ssh "$REMOTE" "systemctl is-active price-radar-collect price-radar-web price-radar-tunnel"
sleep 3
ssh "$REMOTE" "sudo journalctl -u price-radar-tunnel --no-pager -n 40 2>/dev/null | grep -oE 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -1 | sed 's/^/public-url: /' || echo 'public URL not yet in log; run: journalctl -u price-radar-tunnel -n 40'"

echo "==> first data fill (optional, daemon will also do it)"
ssh "$REMOTE" "cd ${APP_DIR} && sudo -u deploy node --disable-warning=ExperimentalWarning radar.mjs pull || true"
