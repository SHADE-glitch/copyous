#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# © SHADE-glitch — run the prefs copy invariants without a logout.
#
#   test/prefs/run.sh
#
# This is the only part of the playbook that can verify `lib/preferences/**` while the
# user's session keeps running: the settings dialog is a separate gjs process, so it never
# inherits the shell's ES-module cache. It needs two things the headless-shell harness must
# NOT have, and one it must not touch:
#
#   * Xvfb -- Adw refuses to build a window with no display. Absent that, this script
#     exits 77 and says so; a skipped run is never a pass.
#   * GI_TYPELIB_PATH pointing at /usr/lib/gnome-shell/girepository-1.0, because loading
#     the shell's prefs API pulls in `Shew`, which lives in a directory gjs does not scan
#     by default. It has to be in the environment *before* the first gi:// import, so it
#     cannot be fixed from inside harness.js.
#   * GSETTINGS_BACKEND=memory -- fillPreferencesWindow() runs migrateSettings(), and every
#     row binds its control to the settings object. Without this, verifying the settings UI
#     would write into the user's real dconf.
#
# Environment:
#   COPYOUS_PREFS_ROOT   verify a copy of the repo instead of the live tree (used to provoke
#                        a guard red; never edit the working tree to do that)
#   COPYOUS_PREFS_DUMP=1  also print every row/group/button as tab-separated text
#   COPYOUS_PREFS_BIN    the gjs binary (default: gjs)
set -u

PREFS=$(cd "$(dirname "$0")" && pwd)
SHELL_TYPELIB=/usr/lib/gnome-shell/girepository-1.0

if command -v xvfb-run >/dev/null 2>&1; then
	HAVE_XVFB=1
elif [ -x /usr/bin/Xvfb ]; then
	HAVE_XVFB=2
else
	echo "SKIP: no Xvfb on this machine -- the settings UI needs a display to be built."
	echo "      On Ubuntu: apt install xvfb (a test-only tool; the extension itself does not"
	echo "      depend on it). Exit 77 means NOT VERIFIED, not passed."
	exit 77
fi

[ -d "$SHELL_TYPELIB" ] || {
	echo "SKIP: $SHELL_TYPELIB not found; the shell's prefs API cannot be loaded."
	exit 77
}

GJS=${COPYOUS_PREFS_BIN:-gjs}
command -v "$GJS" >/dev/null 2>&1 || {
	echo "FAIL: gjs not on PATH"
	exit 1
}

export GSETTINGS_BACKEND=memory
export GI_TYPELIB_PATH="$SHELL_TYPELIB${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"

# 1280x900: the window asks for 810px of height and Adw will not realize pages that fall
# outside the allocation, which would make a row invisible to the walk rather than bare.
# Word-splitting is why this is a function and not a "$WRAPPER" string: `--server-args`
# takes one value that contains spaces.
run_prefs() {
	if [ "$HAVE_XVFB" = 1 ]; then
		xvfb-run -a --server-args="-screen 0 1280x900x24" "$GJS" -m "$PREFS/harness.js"
		return $?
	fi
	DISPLAY=${DISPLAY:-:99}
	export DISPLAY
	/usr/bin/Xvfb "$DISPLAY" -screen 0 1280x900x24 >/dev/null 2>&1 &
	XVFB_PID=$!
	# `command kill`, not the interactive alias: same reason the probes use /bin/rm.
	trap 'command kill "$XVFB_PID" 2>/dev/null' EXIT INT TERM
	timeout 180 "$GJS" -m "$PREFS/harness.js"
	rc=$?
	command kill "$XVFB_PID" 2>/dev/null
	trap - EXIT INT TERM
	return $rc
}

# The harness runs against the maintainer's real data directory (only dconf is redirected,
# via GSETTINGS_BACKEND=memory), so a prefs-side write would land on real files. Two checks,
# with different strictness on purpose:
#
#   ~/.config/copyous@local        content + metadata. Nothing in the settings process has a
#                                  reason to touch it, so any change is the harness's fault.
#   ~/.local/share/copyous@local   *file names only*. The live shell keeps writing
#                                  clipboard.db-wal in there while the session runs, so a size
#                                  or mtime comparison would fire on the user's own clipboard.
LIVE_CONFIG_START=$( (cd "$HOME/.config/copyous@local" 2>/dev/null && /bin/ls -l | cksum) || true )
LIVE_SHARE_START=$( (cd "$HOME/.local/share/copyous@local" 2>/dev/null && find . | sort | cksum) || true )

OUT=$(run_prefs 2>&1)
rc=$?
printf '%s\n' "$OUT"

# gjs prefixes every console line, so the summary has to be found after stripping it.
NORM=$(printf '%s\n' "$OUT" | sed 's/^Gjs-Console-Message: [0-9:.]* //')
SUMMARY=$(printf '%s\n' "$NORM" | grep -E '^# [0-9]+/[0-9]+ checks passed$' | tail -1)

# Never read green from silence: an instrument that dies halfway prints no verdict at all,
# and the exit code alone is not enough proof that the checks ran.
if [ -z "$SUMMARY" ]; then
	echo "prefs invariants: NOT VERIFIED -- the harness printed no '# N/M checks passed' line"
	exit 1
fi
PASSED=$(printf '%s\n' "$SUMMARY" | sed 's|^# \([0-9]*\)/.*$|\1|')
TOTAL=$(printf '%s\n' "$SUMMARY" | sed 's|^# [0-9]*/\([0-9]*\) .*$|\1|')

LIVE_CONFIG_END=$( (cd "$HOME/.config/copyous@local" 2>/dev/null && /bin/ls -l | cksum) || true )
LIVE_SHARE_END=$( (cd "$HOME/.local/share/copyous@local" 2>/dev/null && find . | sort | cksum) || true )
TOUCHED=0
[ "$LIVE_CONFIG_START" = "$LIVE_CONFIG_END" ] || { echo "USER DATA TOUCHED: ~/.config/copyous@local changed"; TOUCHED=1; }
[ "$LIVE_SHARE_START" = "$LIVE_SHARE_END" ] || { echo "USER DATA TOUCHED: a file appeared or vanished in ~/.local/share/copyous@local"; TOUCHED=1; }

if [ "$rc" != 0 ] || [ "$PASSED" != "$TOTAL" ]; then
	echo "prefs invariants: RED -- $SUMMARY (exit $rc)"
	[ "$TOUCHED" = 1 ] && echo "prefs invariants: also wrote user data"
	exit 1
fi
if [ "$TOUCHED" = 1 ]; then
	echo "prefs invariants: RED -- checks passed but user data changed"
	exit 1
fi
echo "prefs invariants: green -- $SUMMARY (user data untouched)"
exit 0
