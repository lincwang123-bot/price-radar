#!/usr/bin/env bash
# price-radar deploy script (run on local machine).
# Syncs code to VPS /opt/linc/apps/price-radar and installs/starts systemd units.
# Prereq: ssh alias 'linc-vps' configured; deploy user has passwordless sudo.
set -euo pipefail

APP_DIR=/opt/linc/apps/price-radar
REMOTE=linc-vps
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Fail before touching production when tests or the checkout state are not reviewable.
cd "$LOCAL_DIR"
npm run check
test -z "$(git status --porcelain)" || { echo 'Commit reviewed changes before deployment.' >&2; exit 1; }
REVISION="$(git rev-parse HEAD)"
BACKUP_DIR=/opt/linc/backups/price-radar
CODE_BACKUP="${BACKUP_DIR}/code-before-${REVISION}.tar.gz"
ssh "$REMOTE" "sudo mkdir -p ${BACKUP_DIR}/submissions && sudo chown deploy:deploy ${BACKUP_DIR} ${BACKUP_DIR}/submissions && sudo chmod 700 ${BACKUP_DIR} ${BACKUP_DIR}/submissions"
# This standalone module can back up the old deployment before its first upgrade.
REMOTE_TEMP="$(ssh "$REMOTE" 'mktemp -d /tmp/price-radar-deploy.XXXXXX')"
CHANGED=0
cleanup() {
  result=$?
  if [ "$result" -ne 0 ] && [ "$CHANGED" -eq 1 ]; then
    echo 'Deployment failed; restoring previous code and service units.' >&2
    ssh "$REMOTE" "sudo tar -xzf ${CODE_BACKUP} -C ${APP_DIR} && for u in price-radar-web price-radar-collect; do sudo install -m 644 ${APP_DIR}/deploy/\$u.service /etc/systemd/system/\$u.service; done && sudo systemctl daemon-reload && sudo systemctl restart price-radar-web price-radar-collect && curl -fsS --max-time 10 http://127.0.0.1:18090/ >/dev/null" || true
  fi
  ssh "$REMOTE" "rm -f ${REMOTE_TEMP}/backup.mjs && rmdir ${REMOTE_TEMP}" || true
  exit "$result"
}
trap cleanup EXIT
scp -q "$LOCAL_DIR/lib/backup.mjs" "${REMOTE}:${REMOTE_TEMP}/backup.mjs"
ssh "$REMOTE" "node --input-type=module -e 'import {backupSubmissions} from \"${REMOTE_TEMP}/backup.mjs\"; console.log(JSON.stringify(await backupSubmissions(\"${APP_DIR}/submissions/submissions.sqlite\",\"${BACKUP_DIR}/submissions\")))'"
ssh "$REMOTE" "tar --exclude='./data' --exclude='./submissions' --exclude='./backups' --exclude='./.env' --exclude='./config.json' --exclude='./.git' -czf ${CODE_BACKUP} -C ${APP_DIR} . && chmod 600 ${CODE_BACKUP}"

# A Named Tunnel is enabled only after its out-of-repo configuration *and*
# tunnel-scoped credential have been provisioned on the VPS. Keep the Quick
# Tunnel as the safe first-deploy fallback; never store tunnel credentials in
# this repository.
TUNNEL_UNIT=price-radar-tunnel
if ssh "$REMOTE" "sudo test -f /etc/price-radar/cloudflared/config.yml && sudo test -f /etc/price-radar/cloudflared/credentials.json"; then
  TUNNEL_UNIT=price-radar-named-tunnel
fi

echo "==> rsync code -> ${REMOTE}:${APP_DIR} (exclude data/, .env, .git)"
CHANGED=1
ssh "$REMOTE" "sudo systemctl stop price-radar-web price-radar-collect"
rsync -az --delete \
  --exclude 'data/' \
  --exclude 'submissions/' \
  --exclude 'backups/' \
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
for u in price-radar-backup.service price-radar-backup.timer; do
  scp -q "$LOCAL_DIR/deploy/$u" "${REMOTE}:/tmp/$u"
  ssh "$REMOTE" "sudo install -o root -g root -m 644 /tmp/$u /etc/systemd/system/$u && rm -f /tmp/$u"
done

echo "==> runtime env file; create if missing"
ssh "$REMOTE" "test -f ${APP_DIR}/.env || { umask 077; sudo -u deploy touch ${APP_DIR}/.env; echo env-created; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^PUBLIC_ORIGIN=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"PUBLIC_ORIGIN=https://airadar.vip\" >> ${APP_DIR}/.env'; echo public-origin-added; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^SUBMISSIONS_DB_PATH=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"SUBMISSIONS_DB_PATH=${APP_DIR}/submissions/submissions.sqlite\" >> ${APP_DIR}/.env'; echo submissions-path-added; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^SUBMISSIONS_BACKUP_DIR=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"SUBMISSIONS_BACKUP_DIR=${BACKUP_DIR}/submissions\" >> ${APP_DIR}/.env'; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^SUBMISSION_HASH_SECRET=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"SUBMISSION_HASH_SECRET=\" >> ${APP_DIR}/.env; /usr/bin/openssl rand -hex 32 >> ${APP_DIR}/.env'; echo submission-secret-added; }"

echo "==> daemon-reload + enable + start"
ssh "$REMOTE" "sudo systemctl daemon-reload && sudo systemctl enable price-radar-collect price-radar-web ${TUNNEL_UNIT} && sudo systemctl restart price-radar-collect price-radar-web ${TUNNEL_UNIT} && echo started"

echo "==> service states"
ssh "$REMOTE" "systemctl is-active price-radar-collect price-radar-web ${TUNNEL_UNIT}"
ssh "$REMOTE" "curl --retry 5 --retry-connrefused --retry-delay 1 -fsS --max-time 10 http://127.0.0.1:18090/ >/dev/null && curl -fsS --max-time 15 https://airadar.vip/ >/dev/null && sudo systemctl enable --now price-radar-backup.timer"

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

echo "==> deploy ${REVISION} healthy; collector owns scheduled data refresh"
CHANGED=0
