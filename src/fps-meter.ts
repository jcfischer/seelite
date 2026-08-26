/**
 * A frame-rate readout, for judging what a change costs.
 *
 * **Not part of the HUD**, and query-gated in the game for that reason:
 * `hud-and-scanner.md` §5 puts developer tuning readouts on a Tuning tab and
 * says they may "never occupy the persistent player flight floor". A number in
 * the corner of a cockpit is exactly that. `?fps` mounts it; nothing else does.
 * The model workbench shows it unconditionally, because a workbench is already
 * an instrument rather than a view of the game.
 *
 * **It counts its own animation frames rather than reading the renderer's
 * counter.** Every `requestAnimationFrame` callback fires once per composited
 * frame, so the two agree, and the meter needs nothing from the page it is
 * measuring.
 *
 * **A stall is reported, not frozen through.** A meter driven only by
 * `requestAnimationFrame` stops updating exactly when the page stops painting,
 * so it holds the last healthy number on screen — failing open into something
 * reassuring, which is the opposite of what an instrument should do. A timer
 * runs alongside it and takes over when no frame has arrived for longer than a
 * stall threshold, showing how long the page has been stopped — and knows the
 * difference between a stall and a backgrounded tab, which also stops frames
 * and is not a fault.
 *
 * It shows the frame *time* beside the rate, because the two carry different
 * information at the low end: 60 fps and 55 fps are 16.7 ms and 18.2 ms, but
 * 15 fps and 7 fps are 67 ms and 143 ms. Below about 20 fps the milliseconds
 * are what tell you how much has to come off.
 *
 * The worst frame in the window is shown too. A mean of 30 hides a 250 ms
 * hitch, and a hitch is what a player feels.
 */

const STYLE_ID = "seelite-fps-style";
const STYLE = `
#seelite-fps {
  position: fixed; top: 8px; right: 10px; z-index: 40;
  padding: 4px 8px; pointer-events: none;
  font: 11px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
  color: #cfe6f2; background: rgba(4, 11, 16, .66);
  border: 1px solid rgba(124, 183, 211, .3);
  letter-spacing: .06em; white-space: pre;
}
#seelite-fps b { color: #f0bc67; font-weight: normal; }
`;

/** How long a sample covers, milliseconds. Long enough that the number is not
 *  noise, short enough to follow the camera as it closes on something. */
const WINDOW_MS = 500;

/** How long without a frame counts as a stall rather than a slow frame. Four
 *  windows: long enough that a 2 fps crawl still reports as a rate. */
const STALL_MS = WINDOW_MS * 4;

/**
 * Mount the readout, and return the function that removes it.
 *
 * **Idempotent**: two call sites can reach this on one page — `?fps` in
 * `main.ts` and the workbench, which shows it unconditionally — and two
 * absolutely-positioned readouts at the same corner would sit on top of each
 * other. The second call is a no-op that hands back a no-op, so neither caller
 * has to know about the other.
 */
export function mountFpsMeter(): () => void {
	if (document.querySelector("[data-fps-meter]")) return () => {};
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}
	const readout = document.createElement("div");
	readout.id = "seelite-fps";
	readout.dataset.fpsMeter = "";
	readout.textContent = "— fps";
	document.body.append(readout);

	let frames = 0;
	let worst = 0;
	let last = performance.now();
	let windowStart = last;
	let handle = 0;
	let stopped = false;

	const show = (html: string) => {
		// Every part of this is a number this file formatted, so there is nothing
		// to escape — and `innerHTML` lets the rate read apart from the figures
		// that qualify it.
		readout.innerHTML = html;
	};

	const tick = () => {
		if (stopped) return;
		const now = performance.now();
		const delta = now - last;
		last = now;
		frames += 1;
		if (delta > worst) worst = delta;
		if (now - windowStart >= WINDOW_MS) {
			const seconds = (now - windowStart) / 1000;
			const fps = frames / seconds;
			show(
				`<b>${fps.toFixed(1)}</b> fps · ${(1000 / fps).toFixed(0)} ms` +
					` · worst ${worst.toFixed(0)} ms`,
			);
			frames = 0;
			worst = 0;
			windowStart = now;
		}
		handle = requestAnimationFrame(tick);
	};
	handle = requestAnimationFrame(tick);

	/**
	 * The stall watch. `setInterval` keeps running when the compositor does not,
	 * which is the whole point: without it the readout holds its last healthy
	 * figure for as long as the page is frozen.
	 *
	 * **A backgrounded tab is not a stall**, and reporting one as such would make
	 * this the false-alarm counterpart of the failure it exists to prevent —
	 * every return to the tab greeting you with `stalled · 12.4 s` for a page
	 * that was working perfectly. `document.hidden` distinguishes them, and the
	 * frame clock is reset on the way back so the first window after is measured
	 * rather than inherited.
	 *
	 * It wakes at the threshold rather than at the sample window: a watch that
	 * cannot fire until four windows have passed has no reason to look sooner,
	 * and this runs for the lifetime of every workbench session.
	 */
	const watch = window.setInterval(() => {
		if (document.hidden) {
			last = performance.now();
			windowStart = last;
			frames = 0;
			worst = 0;
			return;
		}
		const since = performance.now() - last;
		if (since > STALL_MS)
			show(`<b>stalled</b> · ${(since / 1000).toFixed(1)} s`);
	}, STALL_MS);

	return () => {
		stopped = true;
		cancelAnimationFrame(handle);
		window.clearInterval(watch);
		readout.remove();
	};
}
