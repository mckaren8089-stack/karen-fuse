#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/mckaren8089-stack/karen-fuse.git"
BRANCH="infra/bootstrap-vps-test"
APP_DIR="/opt/karen-lab/karen-fuse"
CONTAINER="karen-fuse-web"
IMAGE="karen-fuse:test"

echo "[1/7] System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git docker.io ufw

echo "[2/7] Docker"
systemctl enable --now docker

echo "[3/7] Firewall"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[4/7] Fetch Karen Fuse test branch"
mkdir -p /opt/karen-lab
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "[5/7] Build web image"
cd "$APP_DIR"
docker build -f infra/Dockerfile.web -t "$IMAGE" .

echo "[6/7] Start Karen Fuse"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d   --name "$CONTAINER"   --restart unless-stopped   -p 80:80   "$IMAGE"

echo "[7/7] Local health check"
sleep 2
curl -fsS http://127.0.0.1/ >/dev/null

echo
echo "BOOTSTRAP_OK"
echo "Container: $CONTAINER"
echo "HTTP: http://$(hostname -I | awk '{print $1}')/"
echo "Next: run bash $APP_DIR/infra/healthcheck.sh"
