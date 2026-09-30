#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/x-ui/install-result.env"
REALITY_REMARK="Karen-VLESS-Reality-443"
CLIENT_EMAIL="karen-reality-reference"
PORT=443
TARGET="play.google.com:443"
SNI="play.google.com"
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

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$STATE_DIR/pre-reference-reality-${STAMP}.json"
LINK_FILE="$STATE_DIR/3xui-vless-reality-reference-link.txt"
CHANGED=0
REALITY_ID=""

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
  if [ "$CHANGED" = "1" ] && [ -n "$REALITY_ID" ] && [ -r "$BACKUP" ]; then
    ORIGINAL="$(python3 - "$BACKUP" <<'PY' 2>/dev/null || true
import json,sys
with open(sys.argv[1]) as f:
    r=json.load(f)
obj=r.get("obj")
if isinstance(obj,dict):
    print(json.dumps(obj,separators=(",",":")))
PY
)"
    if [ -n "$ORIGINAL" ]; then
      curl -fsS "${JSON[@]}" -X POST "$API/inbounds/update/$REALITY_ID" -d "$ORIGINAL" >/dev/null 2>&1 || true
      sleep 2
    fi
  fi
  echo "ROLLBACK_ATTEMPTED"
  exit "$rc"
}
trap rollback ERR

echo "[1/8] Locate and preserve the current REALITY inbound"
OPTIONS="$(curl -fsS "${BEARER[@]}" "$API/inbounds/options")"
REALITY_ID="$(python3 - "$OPTIONS" "$REALITY_REMARK" "$PORT" <<'PY'
import json,sys
r=json.loads(sys.argv[1]); remark=sys.argv[2]; port=int(sys.argv[3])
for x in r.get("obj") or []:
    if x.get("remark")==remark and x.get("port")==port and x.get("protocol")=="vless":
        print(x["id"]); break
else:
    raise SystemExit("ERROR: expected REALITY inbound not found")
PY
)"

curl -fsS "${BEARER[@]}" "$API/inbounds/get/$REALITY_ID" > "$BACKUP"
chmod 600 "$BACKUP"

echo "[2/8] Validate the reference REALITY target before changing anything"
SCAN="$(curl -fsS "${BEARER[@]}" -X POST   --data-urlencode "target=$TARGET"   --data-urlencode "sni=$SNI"   --data-urlencode "xver=0"   --data-urlencode "allowPrivate=false"   "$API/server/scanRealityTarget")"

python3 - "$SCAN" "$TARGET" "$SNI" <<'PY'
import json,sys
r=json.loads(sys.argv[1]); target=sys.argv[2]; sni=sys.argv[3]
o=r.get("obj") or {}
if not r.get("success") or not o.get("feasible"):
    raise SystemExit("ERROR: play.google.com did not pass 3x-ui REALITY target validation")
names=o.get("serverNames") or []
if names and sni not in names:
    raise SystemExit("ERROR: requested SNI is not valid for the scanned target")
print("REALITY_TARGET_OK:", target, "/", sni)
PY

# Cross-check with Xray's own TLS inspector when the bundled binary is available.
XRAY_BIN=""
for p in /usr/local/x-ui/bin/xray-linux-* /usr/local/x-ui/bin/xray; do
  if [ -x "$p" ]; then XRAY_BIN="$p"; break; fi
done
if [ -n "$XRAY_BIN" ]; then
  "$XRAY_BIN" tls ping "$TARGET" >/tmp/karen-xray-tls-ping.txt 2>&1 || {
    cat /tmp/karen-xray-tls-ping.txt
    echo "ERROR: xray tls ping rejected the selected target"
    exit 1
  }
  echo "XRAY_TLS_PING_OK"
else
  echo "XRAY_TLS_PING_SKIPPED: bundled xray binary not found at expected path"
fi

echo "[3/8] Generate fresh VLESS and REALITY credentials"
UUID_RESP="$(curl -fsS "${BEARER[@]}" "$API/server/getNewUUID")"
KEY_RESP="$(curl -fsS "${BEARER[@]}" "$API/server/getNewX25519Cert")"

read -r CLIENT_UUID PRIVATE_KEY PUBLIC_KEY < <(python3 - "$UUID_RESP" "$KEY_RESP" <<'PY'
import json,sys
u=json.loads(sys.argv[1]); k=json.loads(sys.argv[2])
if not u.get("success") or not k.get("success"):
    raise SystemExit("ERROR: credential generation failed")
uuid=(u.get("obj") or {}).get("uuid","")
priv=(k.get("obj") or {}).get("privateKey","")
pub=(k.get("obj") or {}).get("publicKey","")
if not all((uuid,priv,pub)):
    raise SystemExit("ERROR: generated credentials incomplete")
print(uuid,priv,pub)
PY
)"

# Match the known-working profile shape: six hex characters.
SHORT_ID="$(openssl rand -hex 3)"
PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)"

echo "[4/8] Replace only the REALITY profile shape on TCP/443"
CURRENT="$(cat "$BACKUP")"
PAYLOAD="$(python3 - "$CURRENT" "$PUBLIC_IP" "$CLIENT_UUID" "$PRIVATE_KEY" "$PUBLIC_KEY" "$SHORT_ID" "$TARGET" "$SNI" "$CLIENT_EMAIL" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
obj=r.get("obj")
if not isinstance(obj,dict):
    raise SystemExit("ERROR: missing current inbound object")
ip,uuid,priv,pub,sid,target,sni,email=sys.argv[2:]

obj["enable"]=True
obj["listen"]=""
obj["port"]=443
obj["protocol"]="vless"
obj["shareAddrStrategy"]="custom"
obj["shareAddr"]=ip
obj["settings"]={
  "clients":[{
    "id":uuid,
    "email":email,
    "flow":"",
    "limitIp":0,
    "totalGB":0,
    "expiryTime":0,
    "enable":True,
    "tgId":0,
    "subId":"karen-reality-reference",
    "comment":"Karen Lab known-working-shape REALITY test",
    "reset":0
  }],
  "decryption":"none",
  "encryption":"none",
  "fallbacks":[]
}
obj["streamSettings"]={
  "network":"tcp",
  "tcpSettings":{"header":{"type":"none"}},
  "security":"reality",
  "realitySettings":{
    "show":False,
    "xver":0,
    "target":target,
    "serverNames":[sni],
    "privateKey":priv,
    "minClientVer":"",
    "maxClientVer":"",
    "maxTimediff":0,
    "shortIds":[sid],
    "mldsa65Seed":"",
    "settings":{
      "publicKey":pub,
      "fingerprint":"random",
      "serverName":sni,
      "spiderX":"/",
      "mldsa65Verify":""
    }
  }
}
obj["sniffing"]={
  "enabled":True,
  "destOverride":["http","tls","quic"],
  "metadataOnly":False,
  "routeOnly":True,
  "ipsExcluded":[],
  "domainsExcluded":[]
}
print(json.dumps(obj,separators=(",",":")))
PY
)"

RESP="$(curl -fsS "${JSON[@]}" -X POST "$API/inbounds/update/$REALITY_ID" -d "$PAYLOAD")"
api_ok "$RESP"
CHANGED=1
sleep 3

echo "[5/8] Verify the stored 3x-ui configuration"
VERIFY="$(curl -fsS "${BEARER[@]}" "$API/inbounds/get/$REALITY_ID")"
python3 - "$VERIFY" "$SNI" "$TARGET" <<'PY'
import json,sys
r=json.loads(sys.argv[1]); sni=sys.argv[2]; target=sys.argv[3]
o=r.get("obj") or {}

def decode(v):
    if isinstance(v,str):
        return json.loads(v)
    return v or {}

settings=decode(o.get("settings"))
stream=decode(o.get("streamSettings"))
clients=settings.get("clients") or []
if len(clients)!=1:
    raise SystemExit("ERROR: unexpected client count after update")
if clients[0].get("flow") not in ("",None):
    raise SystemExit("ERROR: Vision flow is still enabled")
if stream.get("network")!="tcp" or stream.get("security")!="reality":
    raise SystemExit("ERROR: transport/security mismatch")
rs=stream.get("realitySettings") or {}
if rs.get("target")!=target or sni not in (rs.get("serverNames") or []):
    raise SystemExit("ERROR: REALITY target/SNI mismatch")
cs=rs.get("settings") or {}
if cs.get("fingerprint")!="random" or cs.get("serverName")!=sni or cs.get("spiderX")!="/":
    raise SystemExit("ERROR: client REALITY defaults do not match reference shape")
print("REFERENCE_PROFILE_STORED_OK")
PY

echo "[6/8] Verify Xray owns TCP/443"
systemctl is-active --quiet x-ui
if ! ss -H -lntp | grep -qE '[:.]443\b'; then
  echo "ERROR: no TCP/443 listener after update"
  exit 1
fi
echo "TCP_443_LISTENER_OK"

echo "[7/8] Write an exact no-Vision import link locally"
python3 - "$CLIENT_UUID" "$PUBLIC_IP" "$PUBLIC_KEY" "$SHORT_ID" "$SNI" "$LINK_FILE" <<'PY'
import os,sys,urllib.parse
uuid,ip,pbk,sid,sni,path=sys.argv[1:]
params=[
    ("type","tcp"),
    ("headerType","none"),
    ("security","reality"),
    ("encryption","none"),
    ("pbk",pbk),
    ("fp","random"),
    ("sni",sni),
    ("sid",sid),
    ("spx","/"),
]
q=urllib.parse.urlencode(params)
name=urllib.parse.quote("Karen-REALITY-reference")
link=f"vless://{uuid}@{ip}:443?{q}#{name}"
with open(path,"w") as f:
    f.write(link+"\n")
os.chmod(path,0o600)
if "flow=" in link:
    raise SystemExit("ERROR: generated link unexpectedly contains flow")
print("IMPORT_LINK_OK")
PY

echo "[8/8] Final status"
trap - ERR
echo "KAREN_REALITY_REFERENCE_READY"
echo "Endpoint: $PUBLIC_IP:$PORT"
echo "Transport: VLESS + TCP/RAW + REALITY"
echo "Flow: none"
echo "Fingerprint: random"
echo "SNI/target: $SNI / $TARGET"
echo "Short ID: 6 hex chars"
echo "Import link: $LINK_FILE"
echo "Rollback snapshot: $BACKUP"
echo "Do NOT paste the import link into chat."
