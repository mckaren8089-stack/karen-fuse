#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/x-ui/install-result.env"
CLIENT_EMAIL="karen-test"
REMARK="Karen-SS-443"
METHOD="aes-256-gcm"
PORT=443
PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)"

if [ ! -r "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not readable"
  exit 1
fi

# shellcheck disable=SC1091
source "$ENV_FILE"

BASE_PATH="${XUI_WEB_BASE_PATH#/}"
BASE_PATH="${BASE_PATH%/}"
API="http://127.0.0.1:${XUI_PANEL_PORT}/${BASE_PATH}/panel/api"
AUTH=(-H "Authorization: Bearer ${XUI_API_TOKEN}" -H "Content-Type: application/json")

echo "[1/6] Ensure raw Shadowsocks tests are stopped and port 443 is free"
systemctl disable --now karen-shadowsocks.service 2>/dev/null || true
if [ -f /tmp/ss31457.pid ]; then
  kill "$(cat /tmp/ss31457.pid)" 2>/dev/null || true
  rm -f /tmp/ss31457.pid
fi
pkill -f 'ss-server.*31457' 2>/dev/null || true
sleep 1

if ss -lntup | grep -qE '[:.]443\b'; then
  echo "ERROR: port 443 is already in use:"
  ss -lntup | grep ':443' || true
  exit 1
fi

echo "[2/6] Create a Shadowsocks inbound through 3x-ui/Xray"
SERVER_PASS="$(openssl rand -hex 24)"
INBOUND_PAYLOAD="$(python3 - "$SERVER_PASS" "$PUBLIC_IP" <<'PY'
import json, sys
server_pass=sys.argv[1]
public_ip=sys.argv[2]
print(json.dumps({
  "enable": True,
  "remark": "Karen-SS-443",
  "listen": "",
  "port": 443,
  "protocol": "shadowsocks",
  "shareAddrStrategy": "custom",
  "shareAddr": public_ip,
  "expiryTime": 0,
  "total": 0,
  "trafficReset": "never",
  "settings": {
    "method": "aes-256-gcm",
    "password": server_pass,
    "network": "tcp,udp",
    "clients": [],
    "ivCheck": False
  },
  "streamSettings": {
    "network": "tcp",
    "security": "none",
    "tcpSettings": {
      "acceptProxyProtocol": False,
      "header": {"type": "none"}
    }
  },
  "sniffing": {
    "enabled": False,
    "destOverride": ["http","tls","quic","fakedns"],
    "metadataOnly": False,
    "routeOnly": False
  }
}, separators=(",",":")))
PY
)"

ADD_RESP="$(curl -fsS "${AUTH[@]}" -X POST "$API/inbounds/add" -d "$INBOUND_PAYLOAD")"
python3 - "$ADD_RESP" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
if not r.get("success"):
    raise SystemExit("ERROR creating inbound: "+str(r))
print("Inbound API: OK")
PY

echo "[3/6] Resolve inbound ID"
OPTIONS="$(curl -fsS -H "Authorization: Bearer ${XUI_API_TOKEN}" "$API/inbounds/options")"
INBOUND_ID="$(python3 - "$OPTIONS" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
for x in r.get("obj") or []:
    if x.get("remark")=="Karen-SS-443" and x.get("port")==443 and x.get("protocol")=="shadowsocks":
        print(x["id"])
        break
else:
    raise SystemExit("ERROR: created inbound not found in options")
PY
)"
echo "Inbound ID: $INBOUND_ID"

echo "[4/6] Create one panel-managed client"
CLIENT_PAYLOAD="$(python3 - "$INBOUND_ID" <<'PY'
import json,sys
iid=int(sys.argv[1])
print(json.dumps({
  "client": {
    "email":"karen-test",
    "totalGB":0,
    "expiryTime":0,
    "tgId":0,
    "limitIp":0,
    "limitHwid":0,
    "enable":True,
    "comment":"Karen Lab acceptance test"
  },
  "inboundIds":[iid]
}, separators=(",",":")))
PY
)"

CLIENT_RESP="$(curl -fsS "${AUTH[@]}" -X POST "$API/clients/add" -d "$CLIENT_PAYLOAD")"
python3 - "$CLIENT_RESP" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
if not r.get("success"):
    raise SystemExit("ERROR creating client: "+str(r))
print("Client API: OK")
PY

echo "[5/6] Export the panel-generated share link locally"
LINKS="$(curl -fsS -H "Authorization: Bearer ${XUI_API_TOKEN}" "$API/clients/links/$CLIENT_EMAIL")"
mkdir -p /root/karen-secrets
chmod 700 /root/karen-secrets
python3 - "$LINKS" <<'PY'
import json,sys,os
r=json.loads(sys.argv[1])
links=r.get("obj") or []
ss=[x for x in links if isinstance(x,str) and x.startswith("ss://")]
if not ss:
    raise SystemExit("ERROR: panel did not return an ss:// link")
path="/root/karen-secrets/3xui-shadowsocks-link.txt"
with open(path,"w") as f:
    f.write(ss[0]+"\n")
os.chmod(path,0o600)
print("Share link saved at:",path)
PY

echo "[6/6] Verify Xray listener"
sleep 2
systemctl is-active --quiet x-ui
ss -lntup | grep ':443'

echo
echo "3XUI_SHADOWSOCKS_OK"
echo "Method: $METHOD"
echo "Port: $PORT"
echo "Client: $CLIENT_EMAIL"
echo "Run this locally to display the client link:"
echo "  cat /root/karen-secrets/3xui-shadowsocks-link.txt"
echo "Do NOT paste the ss:// link into chat."
