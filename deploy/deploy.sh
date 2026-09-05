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
ssh "$REMOTE" "sudo mkdir -p ${BACKUP_DIR}/submissions ${BACKUP_DIR}/analytics && sudo chown deploy:deploy ${BACKUP_DIR} ${BACKUP_DIR}/submissions ${BACKUP_DIR}/analytics && sudo chmod 700 ${BACKUP_DIR} ${BACKUP_DIR}/submissions ${BACKUP_DIR}/analytics"
# This standalone module can back up the old deployment before its first upgrade.
REMOTE_TEMP="$(ssh "$REMOTE" 'mktemp -d /tmp/price-radar-deploy.XXXXXX')"
CHANGED=0
cleanup() {
  result=$?
  if [ "$result" -ne 0 ] && [ "$CHANGED" -eq 1 ]; then
    echo 'Deployment failed; restoring previous code and service units.' >&2
    ssh "$REMOTE" "sudo systemctl stop price-radar-web price-radar-collect && sudo tar -xzf ${CODE_BACKUP} -C ${APP_DIR} && for u in price-radar-web price-radar-collect; do sudo install -m 644 ${APP_DIR}/deploy/\$u.service /etc/systemd/system/\$u.service; done && sudo systemctl daemon-reload && sudo systemctl restart price-radar-web price-radar-collect && curl -A PriceRadarQA --retry 5 --retry-connrefused --retry-delay 1 -fsS --max-time 10 http://127.0.0.1:18090/ >/dev/null" || true
  fi
  ssh "$REMOTE" "rm -f ${REMOTE_TEMP}/backup.mjs && rmdir ${REMOTE_TEMP}" || true
  exit "$result"
}
trap cleanup EXIT
scp -q "$LOCAL_DIR/lib/backup.mjs" "${REMOTE}:${REMOTE_TEMP}/backup.mjs"
ssh "$REMOTE" "node --input-type=module -e 'import {backupSubmissions} from \"${REMOTE_TEMP}/backup.mjs\"; console.log(JSON.stringify(await backupSubmissions(\"${APP_DIR}/submissions/submissions.sqlite\",\"${BACKUP_DIR}/submissions\")))'"
ssh "$REMOTE" "if test -f ${APP_DIR}/analytics/analytics.sqlite; then node --input-type=module -e 'import {backupSubmissions} from \"${REMOTE_TEMP}/backup.mjs\"; console.log(JSON.stringify(await backupSubmissions(\"${APP_DIR}/analytics/analytics.sqlite\",\"${BACKUP_DIR}/analytics\",{kind:\"analytics\"})))'; fi"
ssh "$REMOTE" "tar --exclude='./data' --exclude='./submissions' --exclude='./analytics' --exclude='./backups' --exclude='./.env' --exclude='./config.json' --exclude='./.git' -czf ${CODE_BACKUP} -C ${APP_DIR} . && chmod 600 ${CODE_BACKUP} && tar -tzf ${CODE_BACKUP} >/dev/null"

# This script upgrades the app only. Existing named tunnel and other projects are not changed.
ssh "$REMOTE" "systemctl is-active --quiet price-radar-named-tunnel"

echo "==> rsync code -> ${REMOTE}:${APP_DIR} (exclude data/, .env, .git)"
CHANGED=1
ssh "$REMOTE" "sudo systemctl stop price-radar-web price-radar-collect"
rsync -az --delete \
  --exclude 'data/' \
  --exclude 'submissions/' \
  --exclude 'analytics/' \
  --exclude 'backups/' \
  --exclude '.env' \
  --exclude '.git' \
  --exclude 'config.json' \
  --exclude 'docs/_scrape/' \
  -e ssh "$LOCAL_DIR/" "${REMOTE}:${APP_DIR}/"

echo "==> ensure data and submissions dirs + ownership deploy:deploy"
ssh "$REMOTE" "sudo mkdir -p ${APP_DIR}/data ${APP_DIR}/submissions ${APP_DIR}/analytics && sudo chown deploy:deploy ${APP_DIR}/data ${APP_DIR}/submissions ${APP_DIR}/analytics && sudo chmod 700 ${APP_DIR}/submissions ${APP_DIR}/analytics"

echo "==> install systemd units"
for u in price-radar-collect price-radar-web; do
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
ssh "$REMOTE" "sudo -u deploy grep -q '^ANALYTICS_DB_PATH=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"ANALYTICS_DB_PATH=${APP_DIR}/analytics/analytics.sqlite\" >> ${APP_DIR}/.env'; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^ANALYTICS_BACKUP_DIR=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"%s\\n\" \"ANALYTICS_BACKUP_DIR=${BACKUP_DIR}/analytics\" >> ${APP_DIR}/.env'; }"
ssh "$REMOTE" "sudo -u deploy grep -q '^SUBMISSION_HASH_SECRET=' ${APP_DIR}/.env || { sudo -u deploy sh -c 'printf \"SUBMISSION_HASH_SECRET=\" >> ${APP_DIR}/.env; /usr/bin/openssl rand -hex 32 >> ${APP_DIR}/.env'; echo submission-secret-added; }"

echo "==> daemon-reload + enable + start"
ssh "$REMOTE" "sudo systemctl daemon-reload && sudo systemctl enable price-radar-collect price-radar-web && sudo systemctl restart price-radar-collect price-radar-web && echo started"

echo "==> service states"
ssh "$REMOTE" "systemctl is-active price-radar-collect price-radar-web price-radar-named-tunnel"
ssh "$REMOTE" "curl -A PriceRadarQA --retry 5 --retry-connrefused --retry-delay 1 -fsS --max-time 10 http://127.0.0.1:18090/ >/dev/null && curl -A PriceRadarQA -fsS --max-time 15 https://airadar.vip/ >/dev/null && sudo systemctl start price-radar-backup.service && sudo systemctl enable --now price-radar-backup.timer"

echo "==> deploy ${REVISION} healthy; collector owns scheduled data refresh"
CHANGED=0
