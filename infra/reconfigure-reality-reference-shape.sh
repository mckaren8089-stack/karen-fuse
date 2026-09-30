#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/x-ui/install-result.env"
REMARK="Karen-VLESS-Reality-443"
CLIENT_EMAIL="karen-reality-test"
TARGET="play.google.com:443"
SNI="play.google.com"
FINGERPRINT="random"
SPIDER="/"
STATE_DIR="/root/karen-secrets"
BACKUP_JSON="$STATE_DIR/pre-reference-shaped-reality.json"
LINK_FILE="$STATE_DIR/3xui-vless-reality-reference-link.txt"

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

api_ok() {
  python3 - "$1" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
if not r.get("success"):
    raise SystemExit("API ERROR: "+str(r))
PY
}

INBOUND_ID=""
ORIGINAL_FLOW="xtls-rprx-vision"
UPDATED_INBOUND=0
UPDATED_FLOW=0

rollback() {
  rc=$?
  set +e
  echo "ERROR: reference-shaped REALITY update failed; restoring previous state."

  if [ "$UPDATED_INBOUND" = "1" ] && [ -s "$BACKUP_JSON" ] && [ -n "$INBOUND_ID" ]; then
    RESTORE_PAYLOAD="$(python3 - "$BACKUP_JSON" <<'PY' 2>/dev/null || true
import json,sys
with open(sys.argv[1]) as f:
    r=json.load(f)
obj=r.get("obj") or {}
keep = {
  k: obj[k] for k in (
    "enable","remark","listen","port","protocol","expiryTime","total",
    "trafficReset","shareAddrStrategy","shareAddr","settings",
    "streamSettings","sniffing"
  ) if k in obj
}
print(json.dumps(keep,separators=(",",":")))
PY
)"
    if [ -n "$RESTORE_PAYLOAD" ]; then
      curl -fsS "${JSON[@]}" -X POST "$API/inbounds/update/$INBOUND_ID" \
        -d "$RESTORE_PAYLOAD" >/dev/null 2>&1 || true
    fi
  fi

  if [ "$UPDATED_FLOW" = "1" ]; then
    RESTORE_FLOW="$ORIGINAL_FLOW"
    [ -n "$RESTORE_FLOW" ] || RESTORE_FLOW="none"
    curl -fsS "${JSON[@]}" -X POST "$API/clients/bulkAdjust" \
      -d "$(python3 - "$CLIENT_EMAIL" "$RESTORE_FLOW" <<'PY'
import json,sys
print(json.dumps({
  "emails":[sys.argv[1]],
  "addDays":0,
  "addBytes":0,
  "flow":sys.argv[2]
},separators=(",",":")))
PY
)" >/dev/null 2>&1 || true
  fi

  echo "ROLLBACK_ATTEMPTED"
  exit "$rc"
}
trap rollback ERR

echo "[1/7] Locate and preserve the current REALITY inbound"
OPTIONS="$(curl -fsS "${BEARER[@]}" "$API/inbounds/options")"
INBOUND_ID="$(python3 - "$OPTIONS" "$REMARK" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
remark=sys.argv[2]
for x in r.get("obj") or []:
    if x.get("remark")==remark and x.get("port")==443 and x.get("protocol")=="vless":
        print(x["id"])
        break
PY
)"
if [ -z "$INBOUND_ID" ]; then
  echo "ERROR: current REALITY inbound not found"
  exit 1
fi

CURRENT="$(curl -fsS "${BEARER[@]}" "$API/inbounds/get/$INBOUND_ID")"
printf '%s\n' "$CURRENT" > "$BACKUP_JSON"
chmod 600 "$BACKUP_JSON"

ORIGINAL_FLOW="$(python3 - "$CURRENT" "$CLIENT_EMAIL" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
obj=r.get("obj") or {}
s=obj.get("settings") or {}
if isinstance(s,str):
    s=json.loads(s)
for c in s.get("clients") or []:
    if c.get("email")==sys.argv[2]:
        print(c.get("flow") or "")
        break
else:
    raise SystemExit("ERROR: test client not found in REALITY inbound")
PY
)"

echo "[2/7] Preflight the reference SNI/target on this server"
SCAN="$(curl -fsS "${BEARER[@]}" -X POST \
  --data-urlencode "target=$TARGET" \
  --data-urlencode "sni=$SNI" \
  --data-urlencode "xver=0" \
  --data-urlencode "allowPrivate=false" \
  "$API/server/scanRealityTarget")"

python3 - "$SCAN" "$SNI" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
o=r.get("obj") or {}
names=o.get("serverNames") or []
if not (r.get("success") and o.get("feasible")):
    raise SystemExit("ERROR: play.google.com did not pass 3x-ui REALITY feasibility scan")
if sys.argv[2] not in names:
    raise SystemExit("ERROR: feasibility scan did not return play.google.com as an accepted serverName")
print("REALITY target preflight: OK")
PY

echo "[3/7] Re-shape REALITY transport to match the known-working direct profile"
UPDATE_PAYLOAD="$(python3 - "$CURRENT" "$TARGET" "$SNI" "$FINGERPRINT" "$SPIDER" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
obj=r.get("obj") or {}
target,sni,fp,spider=sys.argv[2:]

def decode(v):
    if isinstance(v,str):
        return json.loads(v)
    return v

settings=decode(obj.get("settings") or {})
stream=decode(obj.get("streamSettings") or {})
sniffing=decode(obj.get("sniffing") or {})

stream["network"]="tcp"
stream["security"]="reality"
stream["tcpSettings"]={"header":{"type":"none"}}
rs=stream.setdefault("realitySettings",{})
rs["show"]=False
rs["xver"]=0
rs["target"]=target
rs.pop("dest",None)
rs["serverNames"]=[sni]
client_defaults=rs.setdefault("settings",{})
client_defaults["fingerprint"]=fp
client_defaults["serverName"]=""
client_defaults["spiderX"]=spider

payload={
  "enable": obj.get("enable",True),
  "remark": obj.get("remark","Karen-VLESS-Reality-443"),
  "listen": obj.get("listen",""),
  "port": 443,
  "protocol": "vless",
  "expiryTime": obj.get("expiryTime",0),
  "total": obj.get("total",0),
  "trafficReset": obj.get("trafficReset","never"),
  "shareAddrStrategy": obj.get("shareAddrStrategy","custom"),
  "shareAddr": obj.get("shareAddr",""),
  "settings": settings,
  "streamSettings": stream,
  "sniffing": sniffing,
}
print(json.dumps(payload,separators=(",",":")))
PY
)"

RESP="$(curl -fsS "${JSON[@]}" -X POST "$API/inbounds/update/$INBOUND_ID" -d "$UPDATE_PAYLOAD")"
api_ok "$RESP"
UPDATED_INBOUND=1

echo "[4/7] Clear XTLS Vision flow for the test client"
FLOW_PAYLOAD="$(python3 - "$CLIENT_EMAIL" <<'PY'
import json,sys
print(json.dumps({
  "emails":[sys.argv[1]],
  "addDays":0,
  "addBytes":0,
  "flow":"none"
},separators=(",",":")))
PY
)"
RESP="$(curl -fsS "${JSON[@]}" -X POST "$API/clients/bulkAdjust" -d "$FLOW_PAYLOAD")"
api_ok "$RESP"
UPDATED_FLOW=1
sleep 2

echo "[5/7] Verify stored config and Xray listener"
CHECK="$(curl -fsS "${BEARER[@]}" "$API/inbounds/get/$INBOUND_ID")"
python3 - "$CHECK" "$CLIENT_EMAIL" "$TARGET" "$SNI" <<'PY'
import json,sys
r=json.loads(sys.argv[1])
obj=r.get("obj") or {}

def decode(v):
    if isinstance(v,str):
        return json.loads(v)
    return v

settings=decode(obj.get("settings") or {})
stream=decode(obj.get("streamSettings") or {})
rs=stream.get("realitySettings") or {}

if stream.get("network")!="tcp" or stream.get("security")!="reality":
    raise SystemExit("ERROR: REALITY/TCP not stored")
if (rs.get("target") or rs.get("dest")) != sys.argv[3]:
    raise SystemExit("ERROR: target mismatch after update")
if rs.get("serverNames") != [sys.argv[4]]:
    raise SystemExit("ERROR: SNI mismatch after update")

client=None
for c in settings.get("clients") or []:
    if c.get("email")==sys.argv[2]:
        client=c
        break
if not client:
    raise SystemExit("ERROR: test client missing after update")
if client.get("flow") not in ("",None):
    raise SystemExit("ERROR: XTLS flow was not cleared")
print("Stored REALITY shape: OK")
PY

systemctl is-active --quiet x-ui
ss -lntp | grep ':443' >/dev/null

echo "[6/7] Export a fresh client link privately"
LINKS="$(curl -fsS "${BEARER[@]}" "$API/clients/links/$CLIENT_EMAIL")"
python3 - "$LINKS" "$SNI" "$LINK_FILE" <<'PY'
import json,sys,os,urllib.parse
r=json.loads(sys.argv[1])
links=r.get("obj") or []
v=[x for x in links if isinstance(x,str) and x.startswith("vless://")]
if not v:
    raise SystemExit("ERROR: panel did not return a VLESS link")
link=v[0]
q=urllib.parse.parse_qs(urllib.parse.urlsplit(link).query)
if q.get("security",[""])[0]!="reality":
    raise SystemExit("ERROR: exported link is not REALITY")
if q.get("sni",[""])[0]!=sys.argv[2]:
    raise SystemExit("ERROR: exported link has wrong SNI")
if q.get("fp",[""])[0]!="random":
    raise SystemExit("ERROR: exported link has wrong fingerprint")
if q.get("flow",[""])[0]:
    raise SystemExit("ERROR: exported link still carries XTLS flow")
with open(sys.argv[3],"w") as f:
    f.write(link+"\n")
os.chmod(sys.argv[3],0o600)
print("Reference-shaped client link: OK")
PY

echo "[7/7] Final status"
trap - ERR
echo "REFERENCE_SHAPED_REALITY_OK"
echo "Endpoint remains: TCP/443 on the current VPS"
echo "SNI: play.google.com"
echo "Flow: none"
echo "Fingerprint: random"
echo "SpiderX: /"
echo "Link file: $LINK_FILE"
echo "Do NOT paste the VLESS link into public logs."
