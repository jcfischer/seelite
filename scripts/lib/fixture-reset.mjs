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
 * reset refuses a gate it opened: shut before and open after is the defect.
 * An open gate that stays open is not refused — the reset did not open it,
 * and it closes on its own frames.
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
 * The ship to its remembered boot position, then the clock to `clockS`; throws
 * if that opened the occlusion gate.
 */
export async function resetToFixture(page, clockS) {
	const gate = () => page.evaluate(() => window.__seelite.occlusionState.open);
	const before = await gate();
	await page.evaluate(() => window.__returnToBootPosition());
	await page.evaluate((t) => window.__startClockAt(t), clockS);
	const after = await gate();
	if (resetOpenedGate({ before, after })) {
		const { boot, enclosureRad } = await page.evaluate(() => ({
			boot: window.__bootPos,
			enclosureRad: window.__seelite.occlusionState.enclosureRad,
		}));
		const at = boot
			? `(${boot.x.toFixed(3)}, ${boot.y.toFixed(3)}, ${boot.z.toFixed(3)}) km`
			: "(unread)";
		throw new Error(
			`resetToFixture: the reset opened the occlusion gate — the boot position ${at} is enclosed (enclosure ${enclosureRad?.toFixed(4)} rad at clock ${clockS} s)`,
		);
	}
}
