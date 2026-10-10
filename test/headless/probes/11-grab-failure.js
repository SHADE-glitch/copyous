// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 11: a denied modal grab must not strand the dialog's state.
//
// What this guards. `open()` sets `_updateCursor = false` before it shows, and the only
// place that put it back was `close()` -- which begins with `if (!this.opened) return`.
// When `pushModal` is refused the dialog never becomes opened, so that early return wins,
// `_updateCursor` stays false for the rest of the session, and `show-at-pointer` silently
// stops following the pointer until logout.
//
// Why the denial has to be injected. `Main.pushModal` is an exported *function* of
// `ui/main.js`, so it cannot be swapped (module namespaces are read-only). The one thing it
// does that can fail is `global.stage.grab(actor)`, and that is an instance method -- so the
// injection goes there: for one `open()` call the stage hands back a grab that reports
// itself revoked and dismisses silently. Everything the dialog does after that is its own
// code: it detects `grabFailed`, calls `Main.popModal`, hides itself and returns. The probe
// asserts the *unwind*, not the injection, and refuses to call itself a pass unless the
// branch was actually entered.
//
// The alternative -- hold another SYSTEM_MODAL grab and let Mutter deny the dialog's
// request -- is tried first and *recorded*: a later request takes the grab rather than being
// refused, so it does not produce the failure. If a future GNOME changes that, the recorded
// step shows it and this injection can go away.
//
// This is also why the log line in that branch went from `logger.error` to `logger.warn`:
// `error` prints as a shell CRITICAL, which is the line `docs/maintenance/reading-the-log.md` counts as the
// session's health signal, so a deliberately provoked denial would redden the suite forever.

(async () => {
	const co = globalThis.__co;
	const { Main, St, dlg } = await co.enable();
	const Shell = imports.gi.Shell;

	const stack = () => Main.modalActorFocusStack.length;

	// --- the honest attempt, recorded -------------------------------------------------
	const blocker = new St.Widget({ reactive: true, x: 0, y: 0, width: 8, height: 8 });
	Main.layoutManager.uiGroup.add_child(blocker);
	blocker.show();
	const hold = Main.pushModal(blocker, { actionMode: Shell.ActionMode.SYSTEM_MODAL });
	dlg.open();
	await co.sleep(700);
	co.rec('secondHolderExperiment', {
		dialogOpenedAnyway: dlg.opened,
		holderRevoked: hold?.is_revoked?.() ?? 'no is_revoked',
		modalDepthAfter: stack(),
	});
	if (dlg.opened) {
		dlg.close();
		await co.sleep(700);
	}
	Main.popModal(hold);
	blocker.destroy();

	// --- the injection ----------------------------------------------------------------
	const stage = global.stage;
	const hadOwnGrab = Object.prototype.hasOwnProperty.call(stage, 'grab');
	const realGrab = stage.grab;
	let branchEntered = false;
	let restored = false;

	co.chk('grabIsAPrototypeMethod', !hadOwnGrab ? true : 'the stage already carries an own grab -- something is shadowing it');

	try {
		stage.grab = () => ({ is_revoked: () => true, dismiss: () => {} });

		dlg.open();
		await co.sleep(700);

		branchEntered = dlg.opened === false;
		co.chk('dialogDidNotOpenOnDeniedGrab', dlg.opened === false ? true : `opened=${dlg.opened}`);
		co.chk('dialogHiddenAgain', dlg.visible === false ? true : `visible=${dlg.visible}`);
		// `close()` leaves it null; the denied path must leave it not-a-grab either way.
		co.chk('noGrabLeftRegistered', dlg._grab == null ? true : `_grab=${dlg._grab}`);

		// The whole point: the flag `open()` flipped must be flipped back by the same call.
		co.chk(
			'updateCursorRestoredOnDeniedGrab',
			dlg._updateCursor === true
				? true
				: `_updateCursor=${dlg._updateCursor} -- show-at-pointer is off for the rest of the session`,
		);
		co.chk('modalStackCleanAfterFailure', stack() === 0 ? true : `depth=${stack()}`);
	} finally {
		delete stage.grab;
		restored = !Object.prototype.hasOwnProperty.call(stage, 'grab') && stage.grab === realGrab;
	}

	co.chk('grabRestored', restored ? true : 'the stage keeps the stub -- every later probe would inherit it');
	co.chk('failureBranchActuallyEntered', branchEntered ? true : 'open() reported success, so the denied-grab path never ran');

	// Control: with the real grab back, opening must work again -- otherwise "restored"
	// could equally mean "the dialog is now broken".
	dlg.open();
	await co.sleep(700);
	co.chk('dialogOpensAfterADeniedGrab', dlg.opened === true ? true : 'the dialog never recovers after one denied grab');
	co.chk('modalTakenOnRealOpen', stack() === 1 ? true : `depth=${stack()}`);

	dlg.close();
	await co.sleep(700);
	co.chk('closeAfterRecovery', dlg.opened === false && stack() === 0 ? true : `opened=${dlg.opened} depth=${stack()}`);

	co.done();
})().catch((e) => globalThis.__co.fail(e));
