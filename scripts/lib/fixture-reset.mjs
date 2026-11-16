/**
 * Node #725: put a page back on its fixture — the ship at its boot position,
 * the game clock at the fixture's — and refuse a reset that opened #241's
 * occlusion gate.
 *
 * Moved here from `measure-shadow-enclosure.mjs`'s `resetClock` (node #723),
 * so a ladder that needs the reset takes this one rather than a copy.
 *
 * **Why a ladder resets at all.** The station orbits and spins on game time,
 * and whatever ran before a rung took as long as it took: on #723's first two
 * runs the 1.5-radii rung read an enclosure of 0.9102 and 1.2121 rad. Reset
 * before every placement and a rung is the same framing whatever ran first.
 *
 * **The ship goes to the boot position first.** `__startClockAt` draws two
 * frames, and a body moves only when a frame steps it, so a reset with the
 * ship still at the last rung draws two frames with the station jumped back
 * beside it. Two frames open #241's gate and thirty close it, so that
 * transient left the gate open at 5 and 3 radii, below its threshold.
 *
 * That holds only while the boot position is not itself enclosed, so the
 * reset refuses two things. A gate it opened — shut before, open after — is
 * the first (`resetOpenedGate`). The second is a gate that was already open
 * and that the boot position is holding open (`resetHeldGateOpen`): the bay
 * reset runs straight after the 1.5-radii rung, where the gate is open, so
 * open → open is what an enclosed boot would read there, and the first check
 * cannot see it. `stepOcclusionGate` zeroes `pending` on every frame the gate
 * already wants the state it is in, so an open gate passes only if the boot
 * frames started counting it toward closing. Those frames are
 * `__startClockAt`'s two (`view-placement.mjs`), drawn with the ship at boot
 * and the clock at the fixture, which is why the state is read after them.
 *
 * What neither refuses is a shut gate at a boot enclosed between the gate's
 * two thresholds: it stays shut, so nothing read after the reset was drawn
 * with the pair on, and the reset did not change the gate.
 *
 * Needs `installViewPlacement` (for `__returnToBootPosition` and
 * `__startClockAt`) and a `__rememberBootPosition` call before the first
 * placement; with nothing remembered, `__returnToBootPosition`'s own error is
 * what the caller gets. Imports nothing, so the decision below is testable
 * headless (`tests/fixture-reset.test.ts`).
 */

/**
 * Did the reset open the gate? True only for shut → open.
 *
 * Throws on a gate state that is not a boolean: `!undefined && undefined` is
 * falsy, so a page that stopped reporting the gate would pass every reset.
 *
 * @param {{ before: boolean, after: boolean }} gate
 * @returns {boolean}
 */
export const resetOpenedGate = ({ before, after }) => {
	if (typeof before !== "boolean" || typeof after !== "boolean")
		throw new Error(
			`resetOpenedGate: the occlusion gate read ${String(before)} before the reset and ${String(after)} after it; both must be booleans`,
		);
	return !before && after;
};

/**
 * Is the boot position holding an open gate open? True only for an open gate
 * whose close counter the boot frames left at zero.
 *
 * Throws on a state it cannot read, for `resetOpenedGate`'s reason.
 *
 * @param {{ open: boolean, pending: number }} gate the state after the reset
 * @returns {boolean}
 */
export const resetHeldGateOpen = ({ open, pending }) => {
	if (typeof open !== "boolean" || !Number.isFinite(pending))
		throw new Error(
			`resetHeldGateOpen: the occlusion gate read open ${String(open)}, pending ${String(pending)} after the reset; need a boolean and a finite count`,
		);
	return open && pending === 0;
};

/**
 * The ship to its remembered boot position, then the clock to `clockS`; throws
 * if that opened the occlusion gate or left it held open at the boot position.
 */
export async function resetToFixture(page, clockS) {
	const before = await page.evaluate(
		() => window.__seelite.occlusionState.open,
	);
	await page.evaluate(() => window.__returnToBootPosition());
	await page.evaluate((t) => window.__startClockAt(t), clockS);
	// One read after `__startClockAt`'s frames, so the reset makes no more
	// round trips than it did with a gate-only check.
	const after = await page.evaluate(() => {
		const s = window.__seelite.occlusionState;
		return { open: s.open, pending: s.pending };
	});
	const opened = resetOpenedGate({ before, after: after.open });
	const held = !opened && resetHeldGateOpen(after);
	if (!opened && !held) return;
	const { boot, enclosureRad } = await page.evaluate(() => ({
		boot: window.__bootPos,
		enclosureRad: window.__seelite.occlusionState.enclosureRad,
	}));
	const at = boot
		? `(${boot.x.toFixed(3)}, ${boot.y.toFixed(3)}, ${boot.z.toFixed(3)}) km`
		: "(unread)";
	const rad = Number.isFinite(enclosureRad)
		? enclosureRad.toFixed(4)
		: "(unread)";
	throw new Error(
		opened
			? `resetToFixture: the reset opened the occlusion gate — the boot position ${at} is enclosed (enclosure ${rad} rad at clock ${clockS} s)`
			: `resetToFixture: the occlusion gate was open before the reset and the boot position ${at} is holding it open — its close counter read 0 after the boot frames (enclosure ${rad} rad at clock ${clockS} s)`,
	);
}

/**
 * Node #1042: run frames until the occlusion gate is shut, and say how many it
 * took.
 *
 * A gate opens after `openFrames` and closes only after `closeFrames`, and
 * between `closeRad` and `openRad` an open gate is held open by the pose it
 * stands at. So the state a ladder inherits is whatever the sections before it
 * left, plus however many frames this host happened to draw since: on `main` a
 * flank pose at 0.36–0.43 rad held the gate open into the 20 and 12 radii rungs
 * on two runs in three, and three settle frames per rung let it close partway
 * down the ladder and reopen at 3. Place the camera on a pose whose enclosure
 * is under `closeRad`, call this, and every run starts from the same shut gate.
 *
 * `advance(page, frames)` draws that many frames (`settleFrames`), passed in so
 * this file still imports nothing. A gate that never shuts means the pose is
 * enclosed, and it throws with the enclosure rather than reading on.
 *
 * @param {object} page
 * @param {(page: object, frames: number) => Promise<unknown>} advance
 * @param {{ batchFrames?: number, maxFrames?: number }} [limits]
 * @returns {Promise<{ frames: number, enclosureRad: number }>}
 */
export async function waitForGateShut(
	page,
	advance,
	{ batchFrames = 10, maxFrames = 300 } = {},
) {
	let frames = 0;
	for (;;) {
		const s = await page.evaluate(() => window.__seelite.occlusionState);
		if (typeof s?.open !== "boolean")
			throw new Error(
				`waitForGateShut: the occlusion gate read ${String(s?.open)}; it must be a boolean`,
			);
		if (!s.open) return { frames, enclosureRad: s.enclosureRad };
		if (frames >= maxFrames)
			throw new Error(
				`waitForGateShut: the occlusion gate was still open after ${frames} frames (enclosure ${Number(s.enclosureRad).toFixed(4)} rad, pending ${s.pending}); the pose is holding it open`,
			);
		await advance(page, batchFrames);
		frames += batchFrames;
	}
}
