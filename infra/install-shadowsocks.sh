#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${SS_PORT:-443}"
METHOD="${SS_METHOD:-chacha20-ietf-poly1305}"
CONF_DIR="/etc/karen-lab"
CONF_FILE="$CONF_DIR/shadowsocks.json"
UNIT_FILE="/etc/systemd/system/karen-shadowsocks.service"
CLIENT_FILE="/root/karen-ss-client.txt"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y shadowsocks-libev ca-certificates curl

mkdir -p "$CONF_DIR"

if [ -f "$CONF_FILE" ]; then
  PASSWORD="$(python3 - <<'PY'
import json
print(json.load(open("/etc/karen-lab/shadowsocks.json"))["password"])
PY
)"
else
  PASSWORD="$(openssl rand -hex 24)"
fi

cat > "$CONF_FILE" <<EOF
{
  "server": "0.0.0.0",
  "server_port": $PORT,
  "password": "$PASSWORD",
  "timeout": 300,
  "method": "$METHOD",
  "fast_open": false
}
EOF

# ss-server runs as nobody; grant read/traverse access only through the nogroup group.
chown root:nogroup "$CONF_DIR" "$CONF_FILE"
chmod 750 "$CONF_DIR"
chmod 640 "$CONF_FILE"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Karen Lab Shadowsocks acceptance-test service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ss-server -c $CONF_FILE -u
Restart=on-failure
RestartSec=2
User=nobody
Group=nogroup
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

ufw allow "$PORT/tcp"
ufw allow "$PORT/udp"

systemctl daemon-reload
systemctl reset-failed karen-shadowsocks.service 2>/dev/null || true
systemctl enable karen-shadowsocks.service
systemctl restart karen-shadowsocks.service

IP="$(curl -4fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
ENC="$(printf '%s' "$METHOD:$PASSWORD" | base64 -w0 | tr '+/' '-_' | tr -d '=')"
URI="ss://$ENC@$IP:$PORT#Karen-Lab-Falkenstein"

umask 077
cat > "$CLIENT_FILE" <<EOF
Karen Lab Shadowsocks acceptance test
Server: $IP
Port: $PORT
Method: $METHOD
Password: $PASSWORD

Import URI:
$URI
EOF

echo
echo "=== SHADOWSOCKS_READY ==="
systemctl --no-pager --full status karen-shadowsocks.service | sed -n '1,12p'
echo
echo "[listeners]"
ss -lntup | grep -E ":$PORT\\b" || true
echo
echo "Client profile saved locally at: $CLIENT_FILE"
echo "Run this to display it on your phone:"
echo "  cat $CLIENT_FILE"
echo
echo "Do NOT paste the client profile/password into chat."
