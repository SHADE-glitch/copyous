#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# © SHADE-glitch — run the headless probes and print a verdict.
#
#   test/headless/run.sh <config> [probe ...]
#   test/headless/run.sh all                 # every config, every probe
#   test/headless/run.sh live 01 03          # two probes, live config only
#
# Each probe gets its OWN shell session. Sharing one session means the earlier
# probe's opens, searches and destroys are baked into the later probe's timings and
# memory, which is exactly how a 6x fill improvement once read as "no change".
#
# Configs live in configs/*.json and are injected as `globalThis.__coCfg` before the
# probe body, so the settings are applied inside the shell process -- GSETTINGS_BACKEND
# is per-process, so writing them from this script would do nothing.
#
# Results land in $COPYOUS_WORK/out (default /tmp/copyous-harness/out), never in the
# repo, so there is nothing to gitignore and a crash leaves the artifacts in /tmp.
set -u

HARNESS=$(cd "$(dirname "$0")" && pwd)
WORK=${COPYOUS_WORK:-/tmp/copyous-harness}
OUT=$WORK/out
ALL_PROBES="01 02 03 04 05 06"
ALL_CONFIGS="live unwindowed horizontal"

CFG=${1:-}
if [ -z "$CFG" ]; then
	cat >&2 <<EOF
usage: $0 <config|all> [probe ...]
  configs: $ALL_CONFIGS all
  probes : $ALL_PROBES  (01 search-equivalence 02 lifecycle-modal 03 invariants
                         04 windowed-structure 05 windowed-cost 06 ux-hidden)
EOF
	exit 2
fi
shift
CONFIGS="$CFG"
[ "$CFG" = "all" ] && CONFIGS=$ALL_CONFIGS
PROBES=${*:-$ALL_PROBES}
[ -z "$PROBES" ] && PROBES=$ALL_PROBES

mkdir -p "$OUT"
# Must be set before anything calls gdbus. Exporting it only after the shell came up
# meant wait_for_shell talked to the *user's real* session bus and tried to Eval there.
export DBUS_SESSION_BUS_ADDRESS=unix:path=$WORK/bus
trap '"$HARNESS/down.sh" >/dev/null 2>&1' EXIT INT TERM

wait_for_shell() {
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

run_probe() {
	probe=$1
	name=$2
	json=$3
	config=$4
	# Namespaced by config: without it, `run.sh all` overwrites each arm's result and
	# leaves only the last config on disk, so the per-arm comparison the suite exists for
	# cannot be made afterwards.
	result=$OUT/$config-$name.json
	rm -f "$result"
	echo "  -> $name"
	# The JS is loaded from a file *by the shell*, not pasted into the Eval string:
	# probe bodies are full of backticks and ${}, which a double-quoted shell string
	# would happily try to expand.
	cat "$HARNESS/probes/_preamble.js" "$HARNESS/probes/$name.js" >"$OUT/$config-$name.eval.js"
	gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
		--method org.gnome.Shell.Eval \
		"globalThis.__coCfg = $json; globalThis.__coOut = '$result'; \
eval(imports.byteArray.toString(GLib.file_get_contents('$OUT/$config-$name.eval.js')[1]))" \
		>/dev/null 2>&1
	i=0
	while [ ! -s "$result" ] && [ $i -lt 90 ]; do
		sleep 5
		i=$((i + 1))
	done
	cp "$OUT/shell.log" "$OUT/$config-$name.shell.log" 2>/dev/null
	if [ -s "$result" ]; then
		node "$HARNESS/verdict.js" "$result" "$name"
	else
		echo "     TIMEOUT after 450s"
		return 1
	fi
}

FAIL=0
for config in $CONFIGS; do
	if [ ! -f "$HARNESS/configs/$config.json" ]; then
		echo "no such config: $config" >&2
		FAIL=1
		continue
	fi
	json=$(cat "$HARNESS/configs/$config.json")
	echo "=== config: $config ==="
	for probe in $PROBES; do
		name=$(ls "$HARNESS/probes/" | grep "^$probe-[0-9a-z-]*\.js$" | sed 's/\.js$//')
		if [ -z "$name" ]; then
			echo "no such probe: $probe" >&2
			FAIL=1
			continue
		fi
		"$HARNESS/up.sh" >/dev/null 2>&1
		if ! wait_for_shell; then
			echo "  -> $name FAILED: shell never answered Eval"
			tail -20 "$OUT/shell.log" 2>/dev/null
			FAIL=1
			continue
		fi
		run_probe "$probe" "$name" "$json" "$config" || FAIL=1
		"$HARNESS/down.sh" >/dev/null 2>&1
	done
done

echo "=== shell log verdict (every session) ==="
crit=$(cat "$OUT"/*.shell.log 2>/dev/null | grep -acE "CRITICAL|JS ERROR")
[ -z "$crit" ] && crit=0
echo "CRITICAL/JS ERROR lines across all sessions: $crit"
if [ "$crit" -gt 0 ]; then
	FAIL=1
	cat "$OUT"/*.shell.log | grep -aE "CRITICAL|JS ERROR" | head -8
fi

echo "=== timing lines from the last session ==="
grep -a "\[timing\]" "$OUT/shell.log" 2>/dev/null | tail -12

if [ $FAIL -eq 0 ]; then
	echo "RESULT: PASS"
else
	echo "RESULT: FAIL"
fi
exit $FAIL
