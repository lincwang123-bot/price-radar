#!/usr/bin/env bash
# Restore only application code. Runtime/private paths are protected from deletion.
set -euo pipefail
archive=$1
app=$2
test -d "$app" && test "$app" != / && test -f "$archive"
stage=$(mktemp -d /tmp/price-radar-code-restore.XXXXXX)
trap 'rm -rf "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
rsync -ac --delete --exclude '/data/' --exclude '/submissions/' --exclude '/analytics/' \
  --exclude '/backups/' --exclude '/.env' --exclude '/config.json' --exclude '/.git' "$stage/" "$app/"
