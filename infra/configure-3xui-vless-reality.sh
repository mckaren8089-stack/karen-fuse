#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/x-ui/install-result.env"
SS_REMARK="Karen-SS-443"
REALITY_REMARK="Karen-VLESS-Reality-443"
CLIENT_EMAIL="karen-reality-test"
PORT=443
STATE_DIR="/root/karen-secrets"

if [ ! -r "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not readable"
  exit 1
fi

# shellcheck disable=SC1091
source "$ENV_FILE"

BASE_PATH="${XUI_WEB_BASE_PATH#/}"
BASE_PATH="${BASE_PATH%/}"
API="http://127.0.0.1:${XUI_PANEL_PORT}/${BASE_PATH}/panel/api"
BEARER=(-H "Authorization: Bearer ${XUI_API_TOKEN}")
JSON=(-H "Authorization: Bearer ${XUI_API_TOKEN}" -H "Content-Type: application/json")
PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

SS_ID=""
REALITY_ID=""
SS_DISABLED=0
REALITY_ADDED=0

api_ok() {
  python3 - "$1" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
if not r.get("success"):
    raise SystemExit("API ERROR: "+str(r))
PY
}

rollback() {
  rc=$?
  set +e
  if [ "$REALITY_ADDED" = "1" ] && [ -n "$REALITY_ID" ]; then
    curl -fsS "${BEARER[@]}" -X POST \
      -F enable=false "$API/inbounds/setEnable/$REALITY_ID" >/dev/null 2>&1 || true
  fi
  if [ "$SS_DISABLED" = "1" ] && [ -n "$SS_ID" ]; then
    curl -fsS "${BEARER[@]}" -X POST \
      -F enable=true "$API/inbounds/setEnable/$SS_ID" >/dev/null 2>&1 || true
  fi
  echo "ROLLBACK_ATTEMPTED"
  exit "$rc"
}
trap rollback ERR

echo "[1/8] Preserve and disable the current Shadowsocks inbound"
OPTIONS="$(curl -fsS "${BEARER[@]}" "$API/inbounds/options")"
SS_ID="$(python3 - "$OPTIONS" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
for x in r.get("obj") or []:
    if x.get("remark")=="Karen-SS-443" and x.get("port")==443 and x.get("protocol")=="shadowsocks":
        print(x["id"]); break
PY
)"
if [ -n "$SS_ID" ]; then
  curl -fsS "${BEARER[@]}" "$API/inbounds/get/$SS_ID" > "$STATE_DIR/pre-reality-shadowsocks.json"
  chmod 600 "$STATE_DIR/pre-reality-shadowsocks.json"
  RESP="$(curl -fsS "${BEARER[@]}" -X POST -F enable=false "$API/inbounds/setEnable/$SS_ID")"
  api_ok "$RESP"
  SS_DISABLED=1
  sleep 2
else
  echo "Current Shadowsocks inbound not found; continuing."
fi

if ss -lntup | grep -q ':443'; then
  echo "ERROR: port 443 is still occupied after disabling Shadowsocks"
  ss -lntup | grep ':443' || true
  exit 1
fi

echo "[2/8] Ask 3x-ui for a UUID and REALITY X25519 keypair"
UUID_RESP="$(curl -fsS "${BEARER[@]}" "$API/server/getNewUUID")"
KEY_RESP="$(curl -fsS "${BEARER[@]}" "$API/server/getNewX25519Cert")"

read -r CLIENT_UUID PRIVATE_KEY PUBLIC_KEY < <(python3 - "$UUID_RESP" "$KEY_RESP" <<'PY'
import json,sys
u=json.loads(sys.argv[1]); k=json.loads(sys.argv[2])
if not u.get("success") or not k.get("success"):
    raise SystemExit("ERROR generating UUID or X25519 keypair")
uuid=(u.get("obj") or {}).get("uuid","")
priv=(k.get("obj") or {}).get("privateKey","")
pub=(k.get("obj") or {}).get("publicKey","")
if not all((uuid,priv,pub)):
    raise SystemExit("ERROR: generated credentials incomplete")
print(uuid,priv,pub)
PY
)

SHORT_ID="$(openssl rand -hex 8)"
SPIDER="/$(openssl rand -hex 8)"

echo "[3/8] Let 3x-ui choose a feasible REALITY target"
TARGET=""
SNI=""
for candidate in "www.microsoft.com:443|www.microsoft.com" "www.apple.com:443|www.apple.com" "www.yahoo.com:443|www.yahoo.com"; do
  cand_target="${candidate%%|*}"
  cand_sni="${candidate#*|}"
  SCAN="$(curl -fsS "${BEARER[@]}" -X POST \
    --data-urlencode "target=$cand_target" \
    --data-urlencode "sni=$cand_sni" \
    --data-urlencode "xver=0" \
    --data-urlencode "allowPrivate=false" \
    "$API/server/scanRealityTarget" || true)"
  read -r feasible result_target result_sni < <(python3 - "$SCAN" "$cand_target" "$cand_sni" <<'PY'
import json,sys
try:
    r=json.loads(sys.argv[1])
except Exception:
    print("false",sys.argv[2],sys.argv[3]); raise SystemExit
o=r.get("obj") or {}
names=o.get("serverNames") or []
print(str(bool(r.get("success") and o.get("feasible"))).lower(),
      o.get("target") or sys.argv[2],
      (names[0] if names else sys.argv[3]))
PY
)
  if [ "$feasible" = "true" ]; then
    TARGET="$result_target"
    SNI="$result_sni"
    break
  fi
done

if [ -z "$TARGET" ] || [ -z "$SNI" ]; then
  echo "ERROR: none of the candidate REALITY targets passed the panel feasibility scan"
  exit 1
fi
echo "REALITY target selected: $TARGET / SNI: $SNI"

echo "[4/8] Create VLESS + REALITY on TCP/443"
PAYLOAD="$(python3 - "$PUBLIC_IP" "$CLIENT_UUID" "$PRIVATE_KEY" "$PUBLIC_KEY" "$SHORT_ID" "$SPIDER" "$TARGET" "$SNI" <<'PY'
import json,sys
ip,uuid,priv,pub,sid,spx,target,sni=sys.argv[1:]
obj={
  "enable": True,
  "remark": "Karen-VLESS-Reality-443",
  "listen": "",
  "port": 443,
  "protocol": "vless",
  "expiryTime": 0,
  "total": 0,
  "trafficReset": "never",
  "shareAddrStrategy": "custom",
  "shareAddr": ip,
  "settings": {
    "clients": [{
      "id": uuid,
      "email": "karen-reality-test",
      "flow": "xtls-rprx-vision",
      "limitIp": 0,
      "totalGB": 0,
      "expiryTime": 0,
      "enable": True,
      "tgId": 0,
      "subId": "karen-reality-test",
      "comment": "Karen Lab REALITY acceptance test",
      "reset": 0
    }],
    "decryption": "none",
    "encryption": "none",
    "fallbacks": []
  },
  "streamSettings": {
    "network": "tcp",
    "tcpSettings": {"header":{"type":"none"}},
    "security": "reality",
    "realitySettings": {
      "show": False,
      "xver": 0,
      "target": target,
      "serverNames": [sni],
      "privateKey": priv,
      "minClientVer": "",
      "maxClientVer": "",
      "maxTimediff": 0,
      "shortIds": [sid],
      "mldsa65Seed": "",
      "settings": {
        "publicKey": pub,
        "fingerprint": "chrome",
        "serverName": "",
        "spiderX": spx,
        "mldsa65Verify": ""
      }
    }
  },
  "sniffing": {
    "enabled": True,
    "destOverride": ["http","tls","quic","fakedns"],
    "metadataOnly": False,
    "routeOnly": False,
    "ipsExcluded": [],
    "domainsExcluded": []
  }
}
print(json.dumps(obj,separators=(",",":")))
PY
)"

ADD="$(curl -fsS "${JSON[@]}" -X POST "$API/inbounds/add" -d "$PAYLOAD")"
api_ok "$ADD"
REALITY_ADDED=1
sleep 2

echo "[5/8] Resolve the new inbound ID"
OPTIONS="$(curl -fsS "${BEARER[@]}" "$API/inbounds/options")"
REALITY_ID="$(python3 - "$OPTIONS" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
for x in r.get("obj") or []:
    if x.get("remark")=="Karen-VLESS-Reality-443" and x.get("port")==443 and x.get("protocol")=="vless":
        print(x["id"]); break
else:
    raise SystemExit("ERROR: REALITY inbound not found after creation")
PY
)"
echo "Reality inbound ID: $REALITY_ID"

echo "[6/8] Verify Xray is listening on TCP/443"
systemctl is-active --quiet x-ui
ss -lntup | grep ':443' >/dev/null
ss -lntup | grep ':443'

echo "[7/8] Export the panel-generated VLESS share link locally"
LINKS="$(curl -fsS "${BEARER[@]}" "$API/clients/links/$CLIENT_EMAIL")"
python3 - "$LINKS" "$PUBLIC_IP" <<'PY'
import json,sys,os
r=json.loads(sys.argv[1])
links=r.get("obj") or []
v=[x for x in links if isinstance(x,str) and x.startswith("vless://")]
if not v:
    raise SystemExit("ERROR: panel did not return a VLESS share link")
link=v[0]
if sys.argv[2] not in link or "security=reality" not in link:
    raise SystemExit("ERROR: generated VLESS link is missing public address or REALITY parameters")
path="/root/karen-secrets/3xui-vless-reality-link.txt"
with open(path,"w") as f:
    f.write(link+"\n")
os.chmod(path,0o600)
print("VLESS + REALITY share link: OK")
PY

echo "[8/8] Final status"
trap - ERR
echo "3XUI_VLESS_REALITY_OK"
echo "Public endpoint: $PUBLIC_IP:$PORT"
echo "Target/SNI: $TARGET / $SNI"
echo "Link file: /root/karen-secrets/3xui-vless-reality-link.txt"
echo "Do NOT paste the vless:// link into chat."
