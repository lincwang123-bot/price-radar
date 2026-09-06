#!/usr/bin/env bash
set -euo pipefail
mode=$1
snapshot=$2
unit_dir=${UNIT_DIR:-/etc/systemd/system}
units=(price-radar-web.service price-radar-collect.service price-radar-backup.service price-radar-backup.timer price-radar-named-tunnel.service)
if [ "$mode" = snapshot ]; then
  mkdir -p "$snapshot"
  for unit in "${units[@]}"; do
    if [ -e "$unit_dir/$unit" ] || [ -L "$unit_dir/$unit" ]; then cp -a "$unit_dir/$unit" "$snapshot/$unit"; fi
    # is-enabled/is-active return nonzero for valid inactive/disabled states.
    systemctl is-enabled "$unit" > "$snapshot/$unit.enabled" || test -s "$snapshot/$unit.enabled"
    systemctl is-active "$unit" > "$snapshot/$unit.active" || test -s "$snapshot/$unit.active"
  done
elif [ "$mode" = restore ]; then
  for unit in "${units[@]}"; do
    state=$(systemctl is-active "$unit") || test -n "$state"
    case "$state" in
      active|activating|reloading|deactivating) systemctl stop "$unit" ;;
      inactive|failed|unknown) : ;;
      *) echo "Cannot determine unit state: $unit" >&2; exit 1 ;;
    esac
    if [ -e "$snapshot/$unit" ] || [ -L "$snapshot/$unit" ]; then
      rm -f "$unit_dir/$unit"
      cp -a "$snapshot/$unit" "$unit_dir/$unit"
    else
      rm -f "$unit_dir/$unit"
    fi
  done
  systemctl daemon-reload
  for unit in "${units[@]}"; do
    case "$(cat "$snapshot/$unit.enabled")" in
      enabled) systemctl enable "$unit" ;;
      enabled-runtime) systemctl enable --runtime "$unit" ;;
      disabled) systemctl disable "$unit" ;;
      not-found) test ! -e "$unit_dir/$unit"; rm -f "$unit_dir/timers.target.wants/$unit" "$unit_dir/multi-user.target.wants/$unit" ;;
      static|indirect|masked|alias|generated|transient) : ;;
      *) echo "Unrecognized saved unit state: $unit" >&2; exit 1 ;;
    esac
    if [ "$(cat "$snapshot/$unit.active")" = active ]; then systemctl start "$unit"; fi
  done
else
  echo 'Expected snapshot or restore' >&2; exit 2
fi
