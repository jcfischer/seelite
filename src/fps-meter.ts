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
 * frame, so what this counts is the compositor's rate — and the meter needs
 * nothing from the page it is measuring. It is not the renderer's draw count
 * and does not track it; the paragraph below is about where the two part.
 *
 * **What it measures is the page's frame service, not the game's loop.** That
 * distinction is the whole of what this instrument is and is not, and an
 * earlier version of this comment got it wrong in the direction that flatters
 * the tool.
 *
 * `requestAnimationFrame` fires once per composited frame whether or not
 * anything drew into it. So the rate here tracks what a frame *costs* — which
 * is what the meter was added for, and why a heavier shader moves it — and it
 * is blind to whether the scene changed. Kill the game's render loop with an
 * exception and this reads a healthy 60 over a frozen picture, because its own
 * callback is still being served. Detecting that needs something the game
 * hands it, and the meter deliberately takes nothing from the page it
 * measures.
 *
 * The stall watch is narrower still. A meter driven only by rAF stops updating
 * exactly when the page stops painting, holding its last healthy number on
 * screen, so a timer runs alongside and takes over when frames stop arriving.
 * What that covers is the page-wide cases: a tab throttled to nothing, and a
 * backgrounded tab, which it tells apart from a fault because that also stops
 * frames and is not one. What it does not cover is a **blocked main thread**,
 * which stops the timer too — no instrument written in the page's own
 * JavaScript reports that from inside.
 *
 * It reports three numbers rather than one; why each is there is at the line
 * that formats it.
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
			// The frame *time* rides beside the rate because the two carry
			// different information at the low end: 60 and 55 fps are 16.7 and
			// 18.2 ms, but 15 and 7 fps are 67 and 143 ms — below about 20 fps
			// the milliseconds are what say how much has to come off. And the
			// worst frame in the window rides beside both, because a mean of 30
			// hides a 250 ms hitch, and the hitch is what a player feels.
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
	 * `document.hidden` is read because a backgrounded tab stops frames and is
	 * not a fault. It wakes at its own threshold rather than at the sample
	 * window — a watch that cannot fire until four windows have passed has no
	 * reason to look sooner, and this runs for the lifetime of every workbench
	 * session.
	 */
	// The counters are reset on the way back from a hidden tab rather than
	// every 2 s while it is hidden. Polling `document.hidden` had the timer
	// zeroing counters no rAF was incrementing, for as long as the tab stayed
	// in the background — an event says the same thing once.
	const onVisibility = () => {
		if (document.hidden) return;
		last = performance.now();
		windowStart = last;
		frames = 0;
		worst = 0;
	};
	document.addEventListener("visibilitychange", onVisibility);

	const watch = window.setInterval(() => {
		if (document.hidden) return;
		const since = performance.now() - last;
		if (since > STALL_MS)
			show(`<b>stalled</b> · ${(since / 1000).toFixed(1)} s`);
	}, STALL_MS);

	return () => {
		stopped = true;
		cancelAnimationFrame(handle);
		window.clearInterval(watch);
		document.removeEventListener("visibilitychange", onVisibility);
		readout.remove();
	};
}
