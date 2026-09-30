#!/usr/bin/env bash
set -Eeuo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROOT="/root/karen-backups"
WORK="$ROOT/$STAMP"
ARCHIVE="$ROOT/karen-vps-state-$STAMP.tar.gz"

mkdir -p "$WORK"
chmod 700 "$ROOT" "$WORK"

# 3x-ui state: database/settings plus optional certificates.
if [ -d /etc/x-ui ]; then
  cp -a /etc/x-ui "$WORK/"
fi
if [ -f /etc/default/x-ui ]; then
  mkdir -p "$WORK/etc-default"
  cp -a /etc/default/x-ui "$WORK/etc-default/"
fi
if [ -d /root/cert ]; then
  cp -a /root/cert "$WORK/"
fi

# Karen Lab host-side state that is not already source-controlled.
if [ -d /etc/karen-lab ]; then
  cp -a /etc/karen-lab "$WORK/"
fi

tar -C "$WORK" -czf "$ARCHIVE" .
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
chmod 600 "$ARCHIVE" "$ARCHIVE.sha256"

echo "BACKUP_OK"
echo "Archive: $ARCHIVE"
echo "SHA256: $(cut -d' ' -f1 "$ARCHIVE.sha256")"
echo "This archive contains credentials/secrets. Keep it off public GitHub."
