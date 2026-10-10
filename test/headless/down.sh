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

# SIGTERM is not enough: a shell stuck inside a C call does not run the signal handler, and an
# orphaned one keeps the mutter wayland lock -- every session after it then dies with
# "Failed to create_socket" and reports "shell never answered Eval". One 2026-10-10 run lost
# seven probes that way to a single timeout. Escalate, and prove it worked before deleting the
# bus socket: rm -f $SOCK first would take the lock-holder's own socket away and hide it.
left=$(pgrep -f "$WAYLAND" 2>/dev/null | wc -l)
if [ "$left" -gt 0 ]; then
	echo "WARN: $left harness process(es) ignored SIGTERM, escalating to SIGKILL" >&2
	for pid in $(pgrep -f "$WAYLAND" 2>/dev/null); do kill -KILL "$pid" 2>/dev/null; done
	sleep 1
fi
rm -f "$SOCK"

left=$(pgrep -f "$WAYLAND" 2>/dev/null | wc -l)
if [ "$left" -gt 0 ]; then
	echo "FATAL: $left harness process(es) survived SIGKILL; check: pgrep -af $WAYLAND" >&2
	exit 1
fi
echo "harness down: no $WAYLAND processes left"
