#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# © SHADE-glitch — isolated headless GNOME Shell for copyous verification.
#
#   test/headless/up.sh [config-name]
#
# Starts a second gnome-shell that cannot touch the live session:
#
#   * its own dbus-daemon on a private socket,
#   * XDG_DATA_HOME pointed at a scratch tree, so the extension's app-data
#     (highlight.min.js, languages/, images/) is read from a *copy*,
#   * GSETTINGS_BACKEND=memory, so no setting write ever reaches the real dconf,
#   * DEBUG_COPYOUS_DBPATH pointed at a synthetic fixture, so the live
#     clipboard.db is never opened by this process.
#
# Deliberately NOT set -e: a guard like `[ -n "$pid" ] && kill $pid` returns
# false on the normal path and used to abort the whole script silently.
set -u

HARNESS=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HARNESS/../.." && pwd)
WORK=${COPYOUS_WORK:-/tmp/copyous-harness}
EXT=$REPO/copyous@local
[ -d "$EXT/lib" ] || EXT=$REPO # run from a checkout where the dir *is* the extension
SOCK=$WORK/bus
WAYLAND=wayland-copyous-harness

mkdir -p "$WORK/out"

# Teardown of anything left from a previous run. Matched on the private socket
# path so this can never hit the user's real session shell -- `pgrep -x
# gnome-shell` is NOT safe here, it also matches a headless shell.
for pid in $(pgrep -f "unix:path=$SOCK" 2>/dev/null); do kill "$pid" 2>/dev/null; done
for pid in $(pgrep -f "$WAYLAND" 2>/dev/null); do kill "$pid" 2>/dev/null; done
[ -f "$WORK/shell.pid" ] && kill "$(cat "$WORK/shell.pid")" 2>/dev/null
sleep 2
rm -f "$SOCK" "$WORK/shell.pid" "$WORK/dbus.pid" "$WORK/out/shell.log"

# --- scratch XDG tree -------------------------------------------------------------
# The extension itself is symlinked so an edit to lib/*.js is what gets loaded on
# the next start. The app-data is copied, never symlinked: a symlink would let
# this second shell write into the real ~/.local/share/copyous@local.
rm -rf "$WORK/xdg"
mkdir -p "$WORK/xdg/gnome-shell/extensions"
ln -s "$EXT" "$WORK/xdg/gnome-shell/extensions/copyous@local"

APPDATA=$HOME/.local/share/copyous@local
mkdir -p "$WORK/xdg/copyous@local"
for asset in highlight.min.js languages; do
	if [ -e "$APPDATA/$asset" ]; then
		cp -a "$APPDATA/$asset" "$WORK/xdg/copyous@local/"
	else
		echo "WARN: $APPDATA/$asset missing -- Code items will render unhighlighted" >&2
	fi
done
# images/ is NOT copied: the fixture generates its own PNGs under $WORK/fixture.

# --- fixture ----------------------------------------------------------------------
if [ ! -s "$WORK/fixture/fixture.db" ] || [ "${COPYOUS_REFRESH_FIXTURE:-}" = "1" ]; then
	node "$HARNESS/make-fixture.js" --out "$WORK/fixture" 2>&1 | grep -v Warning
fi
if [ ! -s "$WORK/fixture/fixture.db" ]; then
	echo "FATAL: no fixture at $WORK/fixture/fixture.db" >&2
	exit 1
fi

# The probes delete entries and bump timestamps on purpose, so the fixture must never
# be the database a session actually opens -- otherwise the row count walks itself down
# across a run (255 -> 250 over 15 sessions) and re-running the suite is not idempotent.
# Keep fixture.db pristine, hand each session its own copy.
SESSION_DB=$WORK/session.db
rm -f "$SESSION_DB" "$SESSION_DB-wal" "$SESSION_DB-shm"
cp "$WORK/fixture/fixture.db" "$SESSION_DB"

# --- start ------------------------------------------------------------------------
export GSETTINGS_BACKEND=memory
export XDG_DATA_HOME="$WORK/xdg"
export GSETTINGS_SCHEMA_DIR="$EXT/schemas"
export DEBUG_COPYOUS_DBPATH="$SESSION_DB"
export WAYLAND_DISPLAY=$WAYLAND
export DBUS_SESSION_BUS_ADDRESS=unix:path=$SOCK

dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --print-pid >"$WORK/dbus.pid" 2>/dev/null ||
	dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork

nohup gnome-shell --headless --wayland-display=$WAYLAND \
	--virtual-monitor 1280x800 --unsafe-mode >"$WORK/out/shell.log" 2>&1 &
echo $! >"$WORK/shell.pid"

# These three flags are the whole reason this works; when up.sh stops working
# after a GNOME upgrade, they are the first things to re-check.
echo "shell : $(cat "$WORK/shell.pid")  (--headless --unsafe-mode --virtual-monitor 1280x800)"
echo "bus   : $SOCK"
echo "db    : $DEBUG_COPYOUS_DBPATH"
echo "log   : $WORK/out/shell.log"
