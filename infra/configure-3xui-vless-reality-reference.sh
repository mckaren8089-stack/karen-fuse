#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/x-ui/install-result.env"
if [ ! -r "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not readable"
  exit 1
fi

# shellcheck disable=SC1091
source "$ENV_FILE"
export XUI_PANEL_PORT XUI_WEB_BASE_PATH XUI_API_TOKEN

python3 - <<'PY'
import datetime
import glob
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.parse
import urllib.request

REMARK = "Karen-VLESS-Reality-443"
TARGET = "play.google.com:443"
SNI = "play.google.com"
PORT = 443
STATE_DIR = "/root/karen-secrets"

panel_port = os.environ["XUI_PANEL_PORT"]
base_path = os.environ.get("XUI_WEB_BASE_PATH", "").strip("/")
token = os.environ["XUI_API_TOKEN"]
api = f"http://127.0.0.1:{panel_port}/"
if base_path:
    api += base_path + "/"
api += "panel/api"

os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
os.chmod(STATE_DIR, 0o700)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup_path = f"{STATE_DIR}/pre-reference-reality-{stamp}.json"
link_path = f"{STATE_DIR}/3xui-vless-reality-reference-link.txt"

changed = False
inbound_id = None
original_response = None

def request(path, method="GET", json_data=None, form_data=None, timeout=25):
    headers = {"Authorization": f"Bearer {token}"}
    body = None
    if json_data is not None:
        body = json.dumps(json_data, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json"
    elif form_data is not None:
        body = urllib.parse.urlencode(form_data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(api + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())

def require_success(resp, label):
    if not resp.get("success"):
        raise RuntimeError(f"{label}: API returned failure: {resp}")

def decode_nested(value):
    if isinstance(value, str):
        return json.loads(value)
    return value or {}

def rollback():
    global changed
    if changed and inbound_id is not None and original_response:
        try:
            obj = original_response.get("obj")
            if isinstance(obj, dict):
                resp = request(f"/inbounds/update/{inbound_id}", method="POST", json_data=obj)
                require_success(resp, "rollback")
                time.sleep(2)
                print("ROLLBACK_OK")
                return
        except Exception as exc:
            print(f"ROLLBACK_FAILED: {exc}")
    print("ROLLBACK_NOT_NEEDED")

try:
    print("[1/8] Locate and preserve the current REALITY inbound")
    options = request("/inbounds/options")
    require_success(options, "inbound options")
    for item in options.get("obj") or []:
        if item.get("remark") == REMARK and item.get("port") == PORT and item.get("protocol") == "vless":
            inbound_id = item.get("id")
            break
    if inbound_id is None:
        raise RuntimeError("expected REALITY inbound not found")

    original_response = request(f"/inbounds/get/{inbound_id}")
    require_success(original_response, "read current REALITY inbound")
    with open(backup_path, "w", encoding="utf-8") as fh:
        json.dump(original_response, fh, ensure_ascii=False, separators=(",", ":"))
    os.chmod(backup_path, 0o600)

    print("[2/8] Validate play.google.com as the controlled REALITY target")
    scan = request(
        "/server/scanRealityTarget",
        method="POST",
        form_data={
            "target": TARGET,
            "sni": SNI,
            "xver": "0",
            "allowPrivate": "false",
        },
    )
    require_success(scan, "REALITY target scan")
    scan_obj = scan.get("obj") or {}
    if not scan_obj.get("feasible"):
        raise RuntimeError("play.google.com did not pass REALITY target validation")
    # The panel's serverNames list intentionally filters wildcard SANs.
    # CertValid/Feasible is authoritative here because x509 hostname verification
    # still accepts a matching wildcard certificate for the requested SNI.
    print("REALITY_TARGET_OK")

    binaries = sorted(glob.glob("/usr/local/x-ui/bin/xray-linux-*"))
    if os.path.isfile("/usr/local/x-ui/bin/xray") and os.access("/usr/local/x-ui/bin/xray", os.X_OK):
        binaries.append("/usr/local/x-ui/bin/xray")
    binaries = [p for p in binaries if os.access(p, os.X_OK)]
    if binaries:
        check = subprocess.run(
            [binaries[0], "tls", "ping", TARGET],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=30,
        )
        if check.returncode != 0:
            print(check.stdout[-3000:])
            raise RuntimeError("xray tls ping rejected play.google.com")
        print("XRAY_TLS_PING_OK")
    else:
        print("XRAY_TLS_PING_SKIPPED")

    print("[3/8] Generate fresh VLESS and REALITY credentials")
    uuid_resp = request("/server/getNewUUID")
    key_resp = request("/server/getNewX25519Cert")
    require_success(uuid_resp, "UUID generation")
    require_success(key_resp, "X25519 generation")
    client_uuid = (uuid_resp.get("obj") or {}).get("uuid")
    key_obj = key_resp.get("obj") or {}
    private_key = key_obj.get("privateKey")
    public_key = key_obj.get("publicKey")
    if not all((client_uuid, private_key, public_key)):
        raise RuntimeError("generated credentials are incomplete")

    short_id = secrets.token_hex(3)
    with urllib.request.urlopen("https://api.ipify.org", timeout=10) as resp:
        public_ip = resp.read().decode().strip()

    print("[4/8] Apply the known-working client shape on the existing TCP/443 inbound")
    current = original_response.get("obj")
    if not isinstance(current, dict):
        raise RuntimeError("missing current inbound object")

    payload = dict(current)
    payload.update({
        "enable": True,
        "listen": "",
        "port": 443,
        "protocol": "vless",
        "shareAddrStrategy": "custom",
        "shareAddr": public_ip,
    })
    payload["settings"] = {
        "clients": [{
            "id": client_uuid,
            "email": "karen-reality-reference",
            "flow": "",
            "limitIp": 0,
            "totalGB": 0,
            "expiryTime": 0,
            "enable": True,
            "tgId": 0,
            "subId": "karen-reality-reference",
            "comment": "Karen Lab controlled REALITY reference-shape test",
            "reset": 0,
        }],
        "decryption": "none",
        "encryption": "none",
        "fallbacks": [],
    }
    payload["streamSettings"] = {
        "network": "tcp",
        "tcpSettings": {"header": {"type": "none"}},
        "security": "reality",
        "realitySettings": {
            "show": False,
            "xver": 0,
            "target": TARGET,
            "serverNames": [SNI],
            "privateKey": private_key,
            "minClientVer": "",
            "maxClientVer": "",
            "maxTimediff": 0,
            "shortIds": [short_id],
            "mldsa65Seed": "",
            "settings": {
                "publicKey": public_key,
                "fingerprint": "random",
                "serverName": SNI,
                "spiderX": "/",
                "mldsa65Verify": "",
            },
        },
    }
    payload["sniffing"] = {
        "enabled": True,
        "destOverride": ["http", "tls", "quic"],
        "metadataOnly": False,
        "routeOnly": True,
        "ipsExcluded": [],
        "domainsExcluded": [],
    }

    update = request(f"/inbounds/update/{inbound_id}", method="POST", json_data=payload)
    require_success(update, "update REALITY inbound")
    changed = True
    time.sleep(3)

    print("[5/8] Verify the stored profile")
    verify = request(f"/inbounds/get/{inbound_id}")
    require_success(verify, "verify REALITY inbound")
    obj = verify.get("obj") or {}
    settings = decode_nested(obj.get("settings"))
    stream = decode_nested(obj.get("streamSettings"))
    clients = settings.get("clients") or []
    if len(clients) != 1:
        raise RuntimeError("unexpected client count")
    if clients[0].get("flow") not in ("", None):
        raise RuntimeError("Vision flow is still enabled")
    if stream.get("network") != "tcp" or stream.get("security") != "reality":
        raise RuntimeError("transport/security mismatch")
    reality = stream.get("realitySettings") or {}
    if reality.get("target") != TARGET or SNI not in (reality.get("serverNames") or []):
        raise RuntimeError("REALITY target/SNI mismatch")
    defaults = reality.get("settings") or {}
    if defaults.get("fingerprint") != "random":
        raise RuntimeError("fingerprint is not random")
    if defaults.get("serverName") != SNI or defaults.get("spiderX") != "/":
        raise RuntimeError("SNI/spiderX mismatch")
    print("REFERENCE_PROFILE_STORED_OK")

    print("[6/8] Verify x-ui and TCP/443")
    subprocess.run(["systemctl", "is-active", "--quiet", "x-ui"], check=True)
    listeners = subprocess.check_output(["ss", "-H", "-lntp"], text=True)
    if ":443 " not in listeners and ":443\n" not in listeners:
        raise RuntimeError("no TCP/443 listener after update")
    print("TCP_443_LISTENER_OK")

    print("[7/8] Create an exact no-Vision import link")
    query = urllib.parse.urlencode([
        ("type", "tcp"),
        ("headerType", "none"),
        ("security", "reality"),
        ("encryption", "none"),
        ("pbk", public_key),
        ("fp", "random"),
        ("sni", SNI),
        ("sid", short_id),
        ("spx", "/"),
    ])
    name = urllib.parse.quote("Karen-REALITY-reference")
    link = f"vless://{client_uuid}@{public_ip}:443?{query}#{name}"
    if "flow=" in link:
        raise RuntimeError("generated link unexpectedly contains flow")
    with open(link_path, "w", encoding="utf-8") as fh:
        fh.write(link + "\n")
    os.chmod(link_path, 0o600)
    print("IMPORT_LINK_OK")

    print("[8/8] Final status")
    print("KAREN_REALITY_REFERENCE_READY")
    print(f"Endpoint: {public_ip}:443")
    print("Transport: VLESS + TCP/RAW + REALITY")
    print("Flow: none")
    print("Fingerprint: random")
    print(f"SNI/target: {SNI} / {TARGET}")
    print("Short ID: 6 hex chars")
    print(f"Import link: {link_path}")
    print(f"Rollback snapshot: {backup_path}")
    print("Do NOT paste the import link into chat.")

except Exception as exc:
    print(f"ERROR: {exc}")
    rollback()
    sys.exit(1)
PY
