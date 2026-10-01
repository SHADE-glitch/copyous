#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# © SHADE-glitch — tear down whatever up.sh started.
#
#   test/headless/down.sh
#
# run.sh calls this on exit via a trap, but it is also standalone: a crashed run
# used to leave a headless gnome-shell holding ~230 MB, and `pgrep -x gnome-shell`
# then returns *that* process instead of the user's real session shell, which makes
# every subsequent memory reading wrong. Kill by pidfile first, pattern second.
set -u

HARNESS=$(cd "$(dirname "$0")" && pwd)
WORK=${COPYOUS_WORK:-/tmp/copyous-harness}
SOCK=$WORK/bus
WAYLAND=wayland-copyous-harness

for f in "$WORK/shell.pid" "$WORK/dbus.pid"; do
	if [ -f "$f" ]; then
		kill "$(cat "$f")" 2>/dev/null
		rm -f "$f"
	fi
done
for pid in $(pgrep -f "$WAYLAND" 2>/dev/null); do kill "$pid" 2>/dev/null; done
for pid in $(pgrep -f "unix:path=$SOCK" 2>/dev/null); do kill "$pid" 2>/dev/null; done
sleep 1
rm -f "$SOCK"

left=$(pgrep -f "$WAYLAND" 2>/dev/null | wc -l)
if [ "$left" -gt 0 ]; then
	echo "WARN: $left harness process(es) survived SIGTERM; check: pgrep -af $WAYLAND" >&2
	exit 1
fi
echo "harness down: no $WAYLAND processes left"
