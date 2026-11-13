/**
 * https://github.com/jcfischer/seelite/issues/1234 — one page's animation loop,
 * held and given back, with a counter that proves it stopped.
 *
 * Two pages in one browser both keep drawing after a `bringToFront`: bringing a
 * page forward does not stop the one behind it, and the first run of
 * `scripts/measure-mining-nav-budget.mjs` priced one arm while the other page
 * drew 736 frames of a second copy of the game. So the arm that is not being
 * measured has its `requestAnimationFrame` replaced with a recorder, which
 * stops anything new from being scheduled; the loop dies on its next tick.
 * `__resume` replays the held callbacks onto the real scheduler and gives the
 * loop back.
 *
 * Installing this inside the page from `scripts/lib/` (the instrument imports
 * it over the dev server, as it already does for `field-stands.mjs`) keeps the
 * generation guard, the pending list and the frame counter out of the setup
 * that places the field and arms the cockpit, where they read as an independent
 * lifecycle threaded through the measurement.
 *
 * The caller must still prove the page held: `__holdState` reports the frame
 * counter **and the game clock**, because a page whose loop was still turning is
 * a second copy of the game pricing the arm, and the counter alone cannot tell
 * a stopped page from a slow one.
 */
export function installFrameControl(win) {
	const raf = win.requestAnimationFrame.bind(win);
	let generation = 0;
	let pending = [];
	win.__framesSoFar = 0;
	const countFrame = (gen) => {
		if (gen !== generation) return;
		win.__framesSoFar++;
		raf(() => countFrame(gen));
	};
	raf(() => countFrame(generation));
	win.__hold = () => {
		generation++;
		win.requestAnimationFrame = (callback) => {
			pending.push(callback);
			return 0;
		};
		return { pending: pending.length };
	};
	win.__holdState = () => ({
		generation,
		pending: pending.length,
		frames: win.__framesSoFar,
		gameTime: win.__seelite.world.gameTime,
		held: win.requestAnimationFrame.name === "",
	});
	win.__resume = () => {
		win.requestAnimationFrame = raf;
		const held = pending;
		pending = [];
		for (const callback of held) raf(callback);
		generation++;
		raf(() => countFrame(generation));
	};
}
