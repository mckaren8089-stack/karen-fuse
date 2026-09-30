#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/x-ui/install-result.env"
CLIENT_EMAIL="karen-test"
REMARK="Karen-SS-443"

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
PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)"

echo "[1/4] Find the current Shadowsocks inbound"
OPTIONS="$(curl -fsS -H "Authorization: Bearer ${XUI_API_TOKEN}" "$API/inbounds/options")"
INBOUND_ID="$(python3 - "$OPTIONS" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
for x in r.get("obj") or []:
    if x.get("remark")=="Karen-SS-443" and x.get("port")==443 and x.get("protocol")=="shadowsocks":
        print(x["id"]); break
else:
    raise SystemExit("ERROR: Karen-SS-443 inbound not found")
PY
)"
echo "Inbound ID: $INBOUND_ID"

echo "[2/4] Set the share address explicitly to the VPS public IPv4"
CURRENT="$(curl -fsS -H "Authorization: Bearer ${XUI_API_TOKEN}" "$API/inbounds/get/$INBOUND_ID")"
PAYLOAD="$(python3 - "$CURRENT" "$PUBLIC_IP" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
obj=r.get("obj")
if not isinstance(obj,dict):
    raise SystemExit("ERROR: inbound payload missing")
obj["shareAddrStrategy"]="custom"
obj["shareAddr"]=sys.argv[2]
print(json.dumps(obj,separators=(",",":")))
PY
)"
RESP="$(curl -fsS "${AUTH[@]}" -X POST "$API/inbounds/update/$INBOUND_ID" -d "$PAYLOAD")"
python3 - "$RESP" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
if not r.get("success"):
    raise SystemExit("ERROR updating inbound: "+str(r))
print("Inbound update: OK")
PY

echo "[3/4] Regenerate the panel share link"
LINKS="$(curl -fsS -H "Authorization: Bearer ${XUI_API_TOKEN}" "$API/clients/links/$CLIENT_EMAIL")"
mkdir -p /root/karen-secrets
chmod 700 /root/karen-secrets
python3 - "$LINKS" "$PUBLIC_IP" <<'PY'
import json,sys,os
r=json.loads(sys.argv[1])
ip=sys.argv[2]
links=r.get("obj") or []
ss=[x for x in links if isinstance(x,str) and x.startswith("ss://")]
if not ss:
    raise SystemExit("ERROR: panel did not return an ss:// link")
link=ss[0]
if f"@{ip}:443" not in link:
    raise SystemExit("ERROR: regenerated link still does not contain the public address")
path="/root/karen-secrets/3xui-shadowsocks-link.txt"
with open(path,"w") as f:
    f.write(link+"\n")
os.chmod(path,0o600)
print("Corrected share link: OK")
PY

echo "[4/4] Verify Xray is still listening on 443"
systemctl is-active --quiet x-ui
ss -lntup | grep ':443'

echo
echo "3XUI_SHARE_ADDRESS_FIXED"
echo "Public address: $PUBLIC_IP"
echo "Corrected link file: /root/karen-secrets/3xui-shadowsocks-link.txt"
echo "Do NOT paste the ss:// link into chat."
