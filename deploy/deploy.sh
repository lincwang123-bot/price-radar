#!/usr/bin/env bash
# price-radar deploy script (run on local machine).
# Syncs code to VPS /opt/linc/apps/price-radar and installs/starts systemd units.
# Prereq: ssh alias 'linc-vps' configured; deploy user has passwordless sudo.
set -euo pipefail

APP_DIR=/opt/linc/apps/price-radar
REMOTE=linc-vps
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# A Named Tunnel is enabled only after its out-of-repo configuration *and*
# tunnel-scoped credential have been provisioned on the VPS. Keep the Quick
# Tunnel as the safe first-deploy fallback; never store tunnel credentials in
# this repository.
TUNNEL_UNIT=price-radar-tunnel
if ssh "$REMOTE" "sudo test -f /etc/price-radar/cloudflared/config.yml && sudo test -f /etc/price-radar/cloudflared/credentials.json"; then
  TUNNEL_UNIT=price-radar-named-tunnel
fi

echo "==> rsync code -> ${REMOTE}:${APP_DIR} (exclude data/, .env, .git)"
rsync -az --delete \
  --exclude 'data/' \
  --exclude 'submissions/' \
  --exclude '.env' \
  --exclude '.git' \
  --exclude 'config.json' \
  --exclude 'docs/_scrape/' \
  -e ssh "$LOCAL_DIR/" "${REMOTE}:${APP_DIR}/"

echo "==> ensure data and submissions dirs + ownership deploy:deploy"
ssh "$REMOTE" "sudo mkdir -p ${APP_DIR}/data ${APP_DIR}/submissions && sudo chown -R deploy:deploy ${APP_DIR} && echo chown-ok"

echo "==> install systemd units"
for u in price-radar-collect price-radar-web "$TUNNEL_UNIT"; do
  scp -q "$LOCAL_DIR/deploy/${u}.service" "${REMOTE}:/tmp/${u}.service"
  ssh "$REMOTE" "sudo install -o root -g root -m 644 /tmp/${u}.service /etc/systemd/system/${u}.service && rm -f /tmp/${u}.service"
done

echo "==> runtime env file; create if missing"
ssh "$REMOTE" "test -f ${APP_DIR}/.env || { umask 077; sudo -u deploy touch ${APP_DIR}/.env; echo env-created; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^PUBLIC_ORIGIN=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"PUBLIC_ORIGIN=https://airadar.vip\" >> ${APP_DIR}/.env'; echo public-origin-added; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^SUBMISSIONS_DB_PATH=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"SUBMISSIONS_DB_PATH=${APP_DIR}/submissions/submissions.sqlite\" >> ${APP_DIR}/.env'; echo submissions-path-added; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^SUBMISSION_HASH_SECRET=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"SUBMISSION_HASH_SECRET=\" >> ${APP_DIR}/.env; /usr/bin/openssl rand -hex 32 >> ${APP_DIR}/.env'; echo submission-secret-added; }"

echo "==> daemon-reload + enable + start"
ssh "$REMOTE" "sudo systemctl daemon-reload && sudo systemctl enable price-radar-collect price-radar-web ${TUNNEL_UNIT} && sudo systemctl restart price-radar-collect price-radar-web ${TUNNEL_UNIT} && echo started"

echo "==> service states"
ssh "$REMOTE" "systemctl is-active price-radar-collect price-radar-web ${TUNNEL_UNIT}"

# Retire only this app's legacy Quick Tunnel after the Named Tunnel has proved
# healthy. Do not touch any other cloudflared-managed service on the host.
if [ "$TUNNEL_UNIT" = "price-radar-named-tunnel" ]; then
  echo "==> retire legacy Quick Tunnel"
  ssh "$REMOTE" "if sudo systemctl cat price-radar-tunnel.service >/dev/null 2>&1; then sudo systemctl disable --now price-radar-tunnel.service; fi; if systemctl is-active --quiet price-radar-tunnel.service; then echo 'legacy Quick Tunnel is still active' >&2; exit 1; fi; echo quick-tunnel-retired"
fi

sleep 3
if [ "$TUNNEL_UNIT" = "price-radar-tunnel" ]; then
  ssh "$REMOTE" "sudo journalctl -u price-radar-tunnel --no-pager -n 40 2>/dev/null | grep -oE 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -1 | sed 's/^/public-url: /' || echo 'public URL not yet in log; run: journalctl -u price-radar-tunnel -n 40'"
else
  ssh "$REMOTE" "sudo journalctl -u price-radar-named-tunnel --no-pager -n 20"
fi

echo "==> first data fill (optional, daemon will also do it)"
ssh "$REMOTE" "cd ${APP_DIR} && sudo -u deploy node --disable-warning=ExperimentalWarning radar.mjs pull || true"
