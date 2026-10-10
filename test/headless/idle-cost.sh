#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# © SHADE-glitch — how much CPU does this extension cost when nobody touches it?
#
#   test/headless/idle-cost.sh [window-seconds] [rounds]      # defaults 30 3
#
# Whole-shell CPU% is not attributable to anything: the user's real session idles at
# tens of percent on this laptop and none of it is ours. So this measures a
# *difference inside one process*: the same headless shell is sampled quiet before the
# extension is enabled and quiet again after it. The delta is what the extension keeps
# costing (its monitors, timers and signal handlers), with no boot drift and no
# cross-process comparison.
#
# Why /proc jiffies instead of sampling: utime/stime are counters, so the reading has no
# aliasing and no profiler overhead. Resolution is 1 tick = 10 ms of CPU; the script
# refuses to call a delta smaller than its own resolution "zero".
#
# What is NOT measured here, on purpose: per-copy cost. A CPU difference cannot see a
# 30 ms synchronous stall (it is 0.1% of a 30 s window); the probes already measure that
# directly as main-thread blocked time. See docs/maintenance/cost-measurement.md.
#
# Isolation is up.sh's, unchanged: private dbus, memory gsettings backend, scratch
# XDG roots, and DEBUG_COPYOUS_DBPATH pointing at a copy of the synthetic fixture.
# The live clipboard.db and the real dconf are never opened. A tripwire hashes the
# user's own config directory before and after, same as run.sh.
set -u

HARNESS=$(cd "$(dirname "$0")" && pwd)
WORK=${COPYOUS_WORK:-/tmp/copyous-harness}
OUT=$WORK/out
WINDOW=${1:-30}
ROUNDS=${2:-3}
CONFIG=${COPYOUS_IDLE_CONFIG:-live}
TICK=$(getconf CLK_TCK)

[ -f "$HARNESS/configs/$CONFIG.json" ] || { echo "no such config: $CONFIG" >&2; exit 2; }
command -v gnome-shell >/dev/null || { echo "gnome-shell not on PATH" >&2; exit 2; }

# Sum of utime+stime+cutime+cstime. The comm field is parenthesised and may contain
# spaces, so the line is cut at the *last* ") " and the remaining fields counted from
# there: after that cut, field 1 is `state`, so utime is 12, stime 13, cutime 14, cstime 15.
jiffies() {
	awk '{ line = $0; sub(/^[0-9]+ \(.*\) /, "", line); split(line, f, " ")
		print f[12] + f[13] + f[14] + f[15] }' "/proc/$1/stat" 2>/dev/null
}

pid_of_shell() { cat "$WORK/shell.pid"; }

wait_ready() {
	i=0
	while [ $i -lt 40 ]; do
		if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
			--method org.gnome.Shell.Eval '1+1' >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
		i=$((i + 1))
	done
	return 1
}

# Enable is a probe-shaped Eval: the real preamble plus a body that only turns the
# extension on and waits for the fixture fill to go quiet. No measurement happens inside
# it, and nothing is asserted -- this script produces numbers, not a verdict.
cat "$HARNESS/probes/_preamble.js" >"$OUT/idle-enable.eval.js"
cat <<'EOF' >>"$OUT/idle-enable.eval.js"
(async () => {
	const h = await __co.enable();
	__co.metric('entries', h.cont._entries.length);
	__co.done();
})().catch((e) => __co.fail(e));
EOF

LIVE_CONFIG_START=$( (cd "$HOME/.config/copyous@local" 2>/dev/null && /bin/ls -l | cksum) || true )
trap '"$HARNESS/down.sh" >/dev/null 2>&1' EXIT INT TERM

echo "config=$CONFIG  window=${WINDOW}s  rounds=$ROUNDS  CLK_TCK=$TICK"
echo
printf 'round   off_cpu_s   on_cpu_s   delta_s   delta_pct   enable_one_shot_s\n'

export DBUS_SESSION_BUS_ADDRESS=unix:path=$WORK/bus
TOTAL_DELTA=0

for r in $(seq 1 "$ROUNDS"); do
	RESULT=$OUT/idle-enable.json
	rm -f "$RESULT"
	"$HARNESS/up.sh" >/dev/null 2>&1 || { echo "round $r: up.sh failed"; exit 1; }
	wait_ready || { echo "round $r: shell never answered Eval"; exit 1; }

	# Boot settle, outside the measured window: the shell is still loading its theme and
	# the extension list during its first seconds, and that is not idle cost.
	sleep 15

	# A DISCARDED window before every measured window. Without it the bare-shell reading
	# is systematically inflated by work the shell defers past boot, and the first
	# three-round run reported a *negative* delta -- the instrument claiming the extension
	# saves CPU, when all it meant was "the shell had more to do at t=15s than at t=110s".
	sleep "$WINDOW"
	J0=$(jiffies "$(pid_of_shell)")
	T0=$(date +%s%N)
	sleep "$WINDOW"
	J1=$(jiffies "$(pid_of_shell)")
	T1=$(date +%s%N)
	[ -n "$J0$J1" ] || { echo "round $r: shell died mid-window"; exit 1; }
	OFF=$(awk -v j="$J1" -v j0="$J0" -v t="$T1" -v t0="$T0" -v k="$TICK" \
		'BEGIN { printf "%.4f", ((j - j0) / k) / ((t - t0) / 1e9) }')
	OFF_S=$(awk -v j="$J1" -v j0="$J0" -v k="$TICK" 'BEGIN { printf "%.3f", (j - j0) / k }')

	# Enable, then wait long past the fill so the measured window starts from quiet.
	E0=$(jiffies "$(pid_of_shell)")
	gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
		--method org.gnome.Shell.Eval \
		"globalThis.__coCfg = $(cat "$HARNESS/configs/$CONFIG.json"); globalThis.__coOut = '$RESULT'; \
eval(imports.byteArray.toString(GLib.file_get_contents('$OUT/idle-enable.eval.js')[1]))" \
		>/dev/null 2>&1
	i=0
	while [ ! -s "$RESULT" ] && [ $i -lt 90 ]; do sleep 5; i=$((i + 1)); done
	[ -s "$RESULT" ] || { echo "round $r: enable never finished"; tail -20 "$OUT/shell.log"; exit 1; }
	E1=$(jiffies "$(pid_of_shell)")
	ENABLE=$(awk -v j="$E1" -v j0="$E0" -v k="$TICK" 'BEGIN { printf "%.3f", (j - j0) / k }')
	ENTRIES=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$RESULT','utf8')).metrics.entries))")
	sleep 20
	J2=$(jiffies "$(pid_of_shell)")
	sleep "$WINDOW"
	J2=$(jiffies "$(pid_of_shell)")
	T2=$(date +%s%N)
	sleep "$WINDOW"
	J3=$(jiffies "$(pid_of_shell)")
	T3=$(date +%s%N)
	ON=$(awk -v j="$J3" -v j2="$J2" -v t="$T3" -v t2="$T2" -v k="$TICK" \
		'BEGIN { printf "%.4f", ((j - j2) / k) / ((t - t2) / 1e9) }')
	ON_S=$(awk -v j="$J3" -v j2="$J2" -v k="$TICK" 'BEGIN { printf "%.3f", (j - j2) / k }')

	D=$(awk -v a="$ON_S" -v b="$OFF_S" 'BEGIN { printf "%.3f", a - b }')
	DP=$(awk -v a="$ON" -v b="$OFF" 'BEGIN { printf "%.3f", (a - b) * 100 }')
	printf '%5s   %9s   %9s  %8s  %10s  %16s   (entries=%s)\n' \
		"$r" "$OFF_S" "$ON_S" "$D" "$DP" "$ENABLE" "$ENTRIES"
	TOTAL_DELTA=$(awk -v t="$TOTAL_DELTA" -v d="$D" 'BEGIN { printf "%.3f", t + d }')

	"$HARNESS/down.sh" >/dev/null 2>&1
	sleep 3
done

LIVE_CONFIG_END=$( (cd "$HOME/.config/copyous@local" 2>/dev/null && /bin/ls -l | cksum) || true )
[ "$LIVE_CONFIG_START" = "$LIVE_CONFIG_END" ] || echo "USER DATA TOUCHED: ~/.config/copyous@local changed during this run"

MEAN=$(awk -v n="$ROUNDS" -v t="$TOTAL_DELTA" 'BEGIN { printf "%.3f", t / n }')
RES_MS=$(awk -v k="$TICK" 'BEGIN { printf "%.1f", 1000 / k }')
RES_PCT=$(awk -v k="$TICK" -v w="$WINDOW" 'BEGIN { printf "%.3f", (1 / k) / w * 100 }')
echo
echo "mean idle delta over $ROUNDS rounds : ${MEAN} CPU-seconds per ${WINDOW}s window"
echo "instrument resolution             : one tick = ${RES_MS} ms of CPU = ${RES_PCT}% of a ${WINDOW}s window"
awk -v m="$MEAN" -v w="$WINDOW" -v k="$TICK" 'BEGIN {
	if (m * 1000 / w < (1000 / k)) print "VERDICT: NOT MEASURABLE -- mean is under one tick per window. Do not record this as \"zero cost\".";
	else print "VERDICT: MEASURABLE -- mean " sprintf("%.1f", m * 1000 / w) " ms of CPU per second of idle";
}'
