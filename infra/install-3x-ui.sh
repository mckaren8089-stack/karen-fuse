#!/usr/bin/env bash
set -Eeuo pipefail

XUI_VERSION="${XUI_VERSION:-v3.8.5}"
LEGACY_BACKUP_DIR="/root/karen-pre-3xui-$(date -u +%Y%m%dT%H%M%SZ)"

echo "[1/7] Preserve the current raw Shadowsocks test state"
mkdir -p "$LEGACY_BACKUP_DIR"
if [ -d /etc/karen-lab ]; then
  cp -a /etc/karen-lab "$LEGACY_BACKUP_DIR/" || true
fi
if [ -f /etc/systemd/system/karen-shadowsocks.service ]; then
  cp -a /etc/systemd/system/karen-shadowsocks.service "$LEGACY_BACKUP_DIR/" || true
fi

echo "[2/7] Stop only the raw Shadowsocks test services"
systemctl disable --now karen-shadowsocks.service 2>/dev/null || true
if [ -f /tmp/ss31457.pid ]; then
  kill "$(cat /tmp/ss31457.pid)" 2>/dev/null || true
  rm -f /tmp/ss31457.pid
fi
pkill -f 'ss-server.*31457' 2>/dev/null || true

echo "[3/7] Verify port 443 is free before Xray/3x-ui"
if ss -lntup | grep -qE '[:.]443\b'; then
  echo "ERROR: port 443 is still in use:"
  ss -lntup | grep -E '[:.]443\b' || true
  exit 1
fi

echo "[4/7] Install 3x-ui non-interactively from the official project"
export XUI_NONINTERACTIVE=1
export XUI_SSL_MODE=none
curl -fsSL "https://raw.githubusercontent.com/MHSanaei/3x-ui/${XUI_VERSION}/install.sh" -o /root/3x-ui-install.sh
bash /root/3x-ui-install.sh "$XUI_VERSION"

echo "[5/7] Open the generated panel port in UFW"
if [ ! -r /etc/x-ui/install-result.env ]; then
  echo "ERROR: /etc/x-ui/install-result.env was not created."
  exit 1
fi
# shellcheck disable=SC1091
source /etc/x-ui/install-result.env
if [ -n "${XUI_PANEL_PORT:-}" ]; then
  ufw allow "${XUI_PANEL_PORT}/tcp"
fi

echo "[6/7] Verify 3x-ui"
systemctl is-active --quiet x-ui
systemctl --no-pager --full status x-ui | sed -n '1,14p'

echo "[7/7] Installation summary"
echo "3XUI_INSTALL_OK"
echo "Access URL: ${XUI_ACCESS_URL:-unknown}"
echo "Username: ${XUI_USERNAME:-unknown}"
echo "Password and API token are stored only in: /etc/x-ui/install-result.env"
echo "Legacy Shadowsocks test state preserved at: $LEGACY_BACKUP_DIR"
echo
echo "Do NOT paste /etc/x-ui/install-result.env into chat."
