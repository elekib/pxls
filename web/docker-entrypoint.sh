#!/bin/sh
# Start pxls as an unprivileged user.
#
# Started as root (the default): make the data directory belong to PUID:PGID
# (default 1000:1000), then drop to that user and run the command. An install
# that used to run as root has a root-owned database; this fixes it in place.
#
# Started as another user (compose `user:`): run the command as is. The data
# directory must already be writable, and the user needs the group that owns
# /dev/rfcommN on the host (`group_add`, usually dialout, gid 20).
#
# The server itself holds no capabilities. The BlueZ tools that need
# CAP_NET_ADMIN (rfcomm, btmgmt, hciconfig) carry it as a file capability,
# set in the Dockerfile.
set -eu

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${PXLS_DATA_DIR:-/app/data}"
# Group of /dev/rfcommN, which the host's udev sets: dialout on Debian, Ubuntu
# and Raspberry Pi OS. Override with the host's gid if yours differs.
TTY_GID="${PXLS_TTY_GID:-$(getent group dialout | cut -d: -f3)}"

case "$PUID$PGID$TTY_GID" in
  *[!0-9]* | "") echo "pxls: PUID, PGID and PXLS_TTY_GID must be numbers" >&2; exit 1 ;;
esac

# Next.js keeps its runtime cache next to the server.
mkdir -p "$DATA_DIR" /app/.next/cache
for dir in "$DATA_DIR" /app/.next/cache; do
  # Only touch the tree when something in it has the wrong owner.
  if [ -n "$(find "$dir" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit)" ]; then
    chown -R "$PUID:$PGID" "$dir"
  fi
done

exec setpriv --reuid "$PUID" --regid "$PGID" --groups "$PGID,$TTY_GID" "$@"
