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
ALL_PROBES="01 02 03 04 05 06 07 08 09 10 11 12 13"
ALL_CONFIGS="live unwindowed horizontal"

CFG=${1:-}
if [ -z "$CFG" ]; then
	cat >&2 <<EOF
usage: $0 <config|all> [probe ...]
  configs: $ALL_CONFIGS all
  probes : $ALL_PROBES  (01 search-equivalence 02 lifecycle-modal 03 invariants
                         04 windowed-structure 05 windowed-cost 06 ux-hidden
                         07 wiring 08 permissions 09 cache-residue
                         10 notification-loopgap 11 grab-failure
                         12 actions-config 13 media-duration)
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

# A stalled session is un-attributable unless something records the moment: by the time a human
# looks, the shell is dead and the only artifact left is a log that simply stopped. This writes
# down what the kernel already knows -- busy or waiting, waiting on what, and whether it is
# paging -- before teardown. The two majflt samples 2s apart are the point: they separate a
# deadlock from a swap storm on this laptop, and the two things need opposite responses.
snapshot_stall() {
	cfg=$1
	name=$2
	poll=$3
	snap=$OUT/$cfg-$name.stall.txt
	shellpid=$(cat "$WORK/shell.pid" 2>/dev/null)
	{
		echo "stall: $cfg/$name after $((poll * 5))s, at $(date +%H:%M:%S)"
		echo "shell pid: ${shellpid:-unknown}"
		if [ -n "$shellpid" ] && [ -d "/proc/$shellpid" ]; then
			ps -o pid,stat,time,wchan:26,rss,args -p "$shellpid"
			echo "wchan: $(cat "/proc/$shellpid/wchan" 2>/dev/null)"
			echo "majflt sample 1: $(awk '{print $12}' "/proc/$shellpid/stat" 2>/dev/null)"
			sleep 2
			echo "majflt sample 2: $(awk '{print $12}' "/proc/$shellpid/stat" 2>/dev/null)"
			echo "thread names:"
			for t in "/proc/$shellpid"/task/*; do cat "$t/comm" 2>/dev/null; done | sort | uniq -c | sort -rn | head -12
			echo "per-thread state/wchan:"
			ps -o tid,stat,wchan:26 -p "$shellpid" -L 2>/dev/null | head -14
			eval_out=$(timeout 5 gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
				--method org.gnome.Shell.Eval '1+1' 2>&1)
			echo "eval rc=$? reply: $(printf '%s' "$eval_out" | tr '\n' ' ' | head -c 120)"
		fi
		echo "memory: $(grep -E 'SwapTotal|SwapFree|^MemAvailable' /proc/meminfo | tr '\n' ' ')"
		# Which phase was running: a probe that never finishes writes no result file, so the phase
		# markers in the log are the only attribution. Tailing 8 lines is not enough -- in the
		# observed stall the marker sat under 200+ Clutter warnings.
		echo "probe phases reached:"
		grep -a '\[copyous-probe\]' "$OUT/$cfg-$name.shell.log" 2>/dev/null | tail -12
		echo "log tail:"
		tail -8 "$OUT/$cfg-$name.shell.log" 2>/dev/null
	} >"$snap" 2>&1
	echo "     stall snapshot: $snap"
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
	# One knob so the stall instrumentation can be exercised in seconds rather than by waiting
	# out a real 450s timeout: CO_PROBE_POLL counts the 5-second ticks.
	poll=${CO_PROBE_POLL:-90}
	while [ ! -s "$result" ] && [ $i -lt "$poll" ]; do
		sleep 5
		i=$((i + 1))
	done
	cp "$OUT/shell.log" "$OUT/$config-$name.shell.log" 2>/dev/null
	if [ -s "$result" ]; then
		node "$HARNESS/verdict.js" "$result" "$name"
	else
		echo "     TIMEOUT after $((poll * 5))s"
		snapshot_stall "$config" "$name" "$poll"
		return 1
	fi
}

# Tripwire for the one thing a test run must never touch: the user's own settings directory.
# The isolation in up.sh is asserted there, but an assertion only refuses to start -- this
# catches damage done anyway. `~/.local/share` is deliberately not hashed: the live session
# writes clipboard history there while the tests run, so it would always differ.
LIVE_CONFIG_START=$( (cd "$HOME/.config/copyous@local" 2>/dev/null && /bin/ls -l | cksum) || true )

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
		# Two files under one prefix used to silently become a two-line $name, which then built a
		# nonexistent eval path: the session started, the file never appeared, and 450s later the
		# arm reported a timeout that had nothing to do with the product (2026-10-10, my own
		# 99-diag-* pair). Fail before up.sh, while the answer is still cheap.
		if [ "$(printf '%s\n' "$name" | wc -l)" -gt 1 ]; then
			echo "ambiguous probe prefix: $probe matches $(printf '%s' "$name" | tr '\n' ' ')" >&2
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
		# Teardown output must be silent on success and LOUD on failure. Swallowing it is how one
		# timed-out probe became seven "shell never answered Eval" on 2026-10-10: the surviving
		# shell kept mutter's wayland lock, and that is the one thing a new session cannot wait
		# out -- so the failures after it measured the lock, not the product.
		downmsg=$("$HARNESS/down.sh" 2>&1)
		downdc=$?
		case "$downmsg" in *escalat*) echo "  note: $downmsg" ;; esac
		if [ $downdc -ne 0 ]; then
			echo "  -> teardown FAILED after $name: $downmsg"
			echo "     stopping the run; every session after this would fail on the leftover lock"
			FAIL=1
			break 2
		fi
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

# A rejected promise with no handler is GJS's third print form: it matches neither CRITICAL
# nor JS ERROR, and it is how a broken actions config announced itself for an hour and a half
# while every gate above stayed green.
rejects=$(cat "$OUT"/*.shell.log 2>/dev/null | grep -acE "Unhandled promise rejection")
[ -z "$rejects" ] && rejects=0
echo "unhandled promise rejections across all sessions: $rejects"
if [ "$rejects" -gt 0 ]; then
	FAIL=1
	cat "$OUT"/*.shell.log | grep -a -A2 "Unhandled promise rejection" | grep -aE "Unhandled promise rejection|\.js:" | head -12

fi

LIVE_CONFIG_END=$( (cd "$HOME/.config/copyous@local" 2>/dev/null && /bin/ls -l | cksum) || true )
if [ "$LIVE_CONFIG_START" != "$LIVE_CONFIG_END" ]; then
	FAIL=1
	echo "USER DATA TOUCHED: ~/.config/copyous@local changed during the run ($LIVE_CONFIG_START -> $LIVE_CONFIG_END)"
	echo "  a probe escaped the isolation; do not trust any number from this run"
fi

# GJS prints access to a disposed object as a *warning*, so it matches neither CRITICAL
# nor JS ERROR -- the gate above is blind to the whole class. Count it, and attribute it:
# ours if a stack frame is under extensions/copyous@local/, or if the message itself names
# one of our registered classes (they are all Gjs_common_gjs_<Name> because every class is
# registered through lib/common/gjs.js). Foreign ones are reported, never judged: grepping
# this by extension name instead gives absurd false hits, and a gate that cries wolf is
# switched off within a week.
dpair=$(cat "$OUT"/*.shell.log 2>/dev/null | awk '
	/has been already disposed/ {
		total++
		if ($0 ~ /Gjs_common_gjs_/) { ours++; next }
		pending = 1; frames = 0; next
	}
	pending {
		if ($0 ~ /extensions\/copyous@local\//) { ours++; pending = 0; next }
		if ($0 ~ /== Stack trace/ || $0 ~ /#[0-9]+ /) {
			frames++
			if (frames >= 40) pending = 0
			next
		}
		pending = 0
	}
	END { printf "%d %d\n", total, ours }
')
disposed_total=${dpair%% *}
disposed_ours=${dpair##* }
[ -z "$disposed_total" ] && disposed_total=0
[ -z "$disposed_ours" ] && disposed_ours=0
echo "disposed-object warnings: $disposed_total total, $disposed_ours attributable to copyous, $((disposed_total - disposed_ours)) foreign (reported only)"
if [ "$disposed_ours" -gt 0 ]; then
	FAIL=1
	echo "  ^ a destroy chain is open; this is the class CRITICAL/JS ERROR cannot see"
	cat "$OUT"/*.shell.log | grep -a -A12 "has been already disposed" | grep -aE "has been already disposed|copyous@local" | head -12
fi

# The fourth print form is C-side, and the three patterns above cannot see it: GLib writes its own
# failures without the word CRITICAL anywhere in the body. On this machine's live session the line
# is literally `g_object_unref: assertion 'G_IS_OBJECT (object)' failed` -- 27 of them across the
# last eight boots while every gate above printed 0. That shape IS a double unref or a ref on a
# non-object, the same family as the disposed warnings, so being blind to it is being blind to the
# exact bug class this harness was built for.
#
# Attribution is deliberately weaker than the disposed rule: a C assertion carries no JS stack, so
# only a frame naming our path within a few lines can tie one to us. Those are judged; the rest
# are reported with their counts, because "the grep found no CRITICAL" is not evidence of anything.
apair=$(cat "$OUT"/*.shell.log 2>/dev/null | awk '
	/extensions\/copyous@local\/|Gjs_common_gjs_/ { ours_line = NR }
	/assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL/ {
		total++
		if (ours_line && NR - ours_line <= 6) ours++
		next
	}
	END { printf "%d %d\n", total, ours }
')
assert_total=${apair%% *}
assert_ours=${apair##* }
[ -z "$assert_total" ] && assert_total=0
[ -z "$assert_ours" ] && assert_ours=0
echo "GLib assertion/critical lines: $assert_total total, $assert_ours within 6 lines of a copyous frame, $((assert_total - assert_ours)) unattributed (reported only)"
if [ "$assert_ours" -gt 0 ]; then
	FAIL=1
	echo "  ^ a C-side lifetime failure next to our code; neither CRITICAL nor disposed counting sees this class"
	cat "$OUT"/*.shell.log | grep -a -B2 -A2 -E "assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL" | head -14
elif [ "$assert_total" -gt 0 ]; then
	cat "$OUT"/*.shell.log | grep -aE "assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL" | sort | uniq -c | head -6
fi

echo "=== timing lines from the last session ==="
grep -a "\[timing\]" "$OUT/shell.log" 2>/dev/null | tail -12

if [ $FAIL -eq 0 ]; then
	echo "RESULT: PASS"
else
	echo "RESULT: FAIL"
fi
exit $FAIL
