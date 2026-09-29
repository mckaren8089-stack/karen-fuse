#!/usr/bin/env bash
set -u

echo "=== Karen Lab VPS health check ==="
echo
echo "[system]"
uname -a
echo
free -h
echo
df -h /
echo
echo "[docker]"
docker --version
docker ps --filter name=karen-fuse-web
echo
echo "[local web]"
curl -sS --max-time 10 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/
echo
echo "[outbound]"
for url in https://github.com https://api.github.com https://registry-1.docker.io/v2/; do
  code=$(curl -sS -L --max-time 15 -o /dev/null -w "%{http_code}" "$url" || true)
  echo "$url -> $code"
done
echo
echo "[network]"
ip -brief address show
ip route
