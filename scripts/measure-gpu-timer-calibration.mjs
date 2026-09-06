/**
 * Is `EXT_disjoint_timer_query_webgl2` telling the truth on this renderer?
 *
 *   npm run dev
 *   node scripts/measure-gpu-timer-calibration.mjs
 *
 * This is an instrument, not a probe: it always reports, names the rasterizer
 * it ran on, and states no machine-independent budget. It exists because
 * `src/frame-attribution.ts` reported a GPU median three to four times the
 * frame under `status: "supported"` (#246), and because whatever ships as a
 * refusal has to be re-runnable by whoever wants to lift it later.
 *
 * ## Four sections, in the order the script runs them
 *
 * **Span.** Does the query measure the work between its own tokens? An empty
 * bracket, a bracket around the composer, and an empty bracket in a frame that
 * draws nothing. If the empty arms read zero, the query is not simply summing
 * whatever the GPU is doing while it is open.
 *
 * **Gain.** *How much* does it say that work costs? The workload is scaled by
 * rendering the composer K times inside one bracket, so true cost is linear in
 * K by construction. Beside it a **fenced** wall clock: K renders then a 1x1
 * `readPixels`, which blocks until the GPU is done. `gl.finish()` is not used —
 * this repo has already measured that it does not fence here. `clientWaitSync`
 * was tried and read 0.40-1.50 ms against an 11.50 ms/render ramp, so it does
 * not fence here either; the mechanism was not chased.
 *
 * Read the **marginal** cost of one more render, not the fitted intercept. The
 * intercept moved +36.2, -30.5 and +3.1 ms across three runs of this script
 * while the marginal held at 38.9-45.1 ms against a true 11.5; a slope over
 * four rungs whose first row carries the previous frame's tail is not a
 * quantity to quote.
 *
 * **Floor.** Does the reading carry a fixed cost per query? A single scissored
 * `clear` — microseconds of real GPU work, and small enough to fit one command
 * buffer — bracketed by a query. This arm was written expecting a floor and did
 * not find one: it reads **0.03 ms** on ANGLE Metal against a fenced 0.60 ms.
 * That is what rules out "a fixed cost per query" and leaves the summing, and
 * it is why the numbers above are stated as measured rather than derived — how
 * many command buffers a composer render spans, and how far their spans
 * overlap, would need instrumentation inside Metal.
 * **Verdict.** What the shipped sampler says on this renderer, from
 * `attributionSnapshot()` itself. `probe-frame-attribution.mjs` runs through
 * SwiftShader, which does not expose the extension at all — it reads
 * `unavailable` there and cannot exercise a refusal — so this is the only place
 * the refused states are shown firing.
 *
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import {
	flightFraming,
	installViewFraming,
	setView,
	settleFrames,
} from "./lib/view-placement.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const SEED = 47;
const RADII = Number(process.env.RADII ?? 1.2);
const REPS = Number(process.env.REPS ?? 12);
const SPAN_FRAMES = Number(process.env.SPAN_FRAMES ?? 60);
const KS = Object.freeze([1, 2, 3, 4]);

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/frame-attribution.ts",
]);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Both installers run through `addInitScript`, so they precede the navigation.
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "gpu timer calibration");

// The sampler owns a query ring of its own; a second live query would be
// measuring the diagnostic rather than the frame.
await page.evaluate(() => window.__seelite.disableFrameAttribution?.());
const framing = flightFraming("planet-5", RADII, "cockpit");
await setView(page, framing.view);
await framing.place(page);
await settleFrames(page, 10);

const run = await page.evaluate(
	async ({ ks, reps, spanFrames }) => {
		const g = window.__seelite;
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
		if (!ext) return { error: "EXT_disjoint_timer_query_webgl2 is absent" };
		const composer = g.composer;
		const px = new Uint8Array(4);
		const frame = () => new Promise((r) => requestAnimationFrame(r));

		/** Block until the GPU has finished everything submitted so far. */
		const fence = () => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
		};

		const med = (xs) => {
			const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
			return s.length ? s[s.length >> 1] : null;
		};
		const pick = (xs, q) => {
			const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
			return s.length
				? s[Math.min(s.length - 1, Math.floor(s.length * q))]
				: null;
		};

		// ---- Section 1: span -------------------------------------------------
		/** One span arm, wrapping `composer.render` for `frames` frames. */
		const spanArm = async (mode) => {
			const samples = [];
			const cadence = [];
			let last = null;
			let pending = null;
			const real = composer.render.bind(composer);
			const drain = () => {
				if (!pending) return;
				if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
					gl.deleteQuery(pending);
					pending = null;
					return;
				}
				if (!gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) return;
				const ns = Number(gl.getQueryParameter(pending, gl.QUERY_RESULT));
				gl.deleteQuery(pending);
				pending = null;
				if (Number.isFinite(ns) && ns >= 0) samples.push(ns / 1e6);
			};
			composer.render = (...args) => {
				drain();
				if (pending) return mode === "skip" ? undefined : real(...args);
				const q = gl.createQuery();
				gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
				if (mode === "around") {
					const out = real(...args);
					gl.endQuery(ext.TIME_ELAPSED_EXT);
					pending = q;
					return out;
				}
				gl.endQuery(ext.TIME_ELAPSED_EXT);
				pending = q;
				return mode === "skip" ? undefined : real(...args);
			};
			for (let i = 0; i < spanFrames; i++)
				await new Promise((r) =>
					requestAnimationFrame((t) => {
						if (last !== null) cadence.push(t - last);
						last = t;
						r();
					}),
				);
			for (let i = 0; i < 20; i++) {
				drain();
				await frame();
			}
			composer.render = real;
			for (let i = 0; i < 10; i++) await frame();
			return {
				mode,
				n: samples.length,
				median: med(samples),
				p95: pick(samples, 0.95),
				cadence: med(cadence),
			};
		};

		// ---- Section 2 and 3: one timed reading ------------------------------
		/**
		 * `arm` is "timer", "drained" (GPU emptied before `beginQuery`), "wall"
		 * (fenced, no query), "floor" (one scissored clear under a query) or
		 * "floorWall" (the same clear, fenced and untimed — the floor arm's own
		 * control, and without it 0.03 ms has nothing to be small against).
		 */
		const once = (k, arm) =>
			new Promise((resolve, reject) => {
				requestAnimationFrame(() => {
					try {
						if (arm === "wall") {
							fence();
							const t0 = performance.now();
							for (let i = 0; i < k; i++) composer.render();
							fence();
							resolve({ value: performance.now() - t0 });
							return;
						}
						if (arm === "floorWall") {
							fence();
							const t0 = performance.now();
							trivial();
							fence();
							resolve({ value: performance.now() - t0 });
							return;
						}
						if (arm === "drained" || arm === "floor") fence();
						const q = gl.createQuery();
						gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
						if (arm === "floor") trivial();
						else for (let i = 0; i < k; i++) composer.render();
						gl.endQuery(ext.TIME_ELAPSED_EXT);
						const poll = () => {
							if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
								gl.deleteQuery(q);
								resolve({ value: null, disjoint: true });
								return;
							}
							if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
								requestAnimationFrame(poll);
								return;
							}
							const ns = Number(gl.getQueryParameter(q, gl.QUERY_RESULT));
							gl.deleteQuery(q);
							resolve({
								value: Number.isFinite(ns) && ns >= 0 ? ns / 1e6 : null,
							});
						};
						requestAnimationFrame(poll);
					} catch (err) {
						reject(err);
					}
				});
			});

		/** Microseconds of real GPU work: one pixel cleared on the backbuffer. */
		const trivial = () => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.enable(gl.SCISSOR_TEST);
			gl.scissor(0, 0, 1, 1);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.disable(gl.SCISSOR_TEST);
		};

		const spans = [];
		// Interleaved rather than blocked: a fixed arm order measures the order.
		for (let round = 0; round < 3; round++)
			for (const mode of ["empty", "around", "skip"])
				spans.push({ round, ...(await spanArm(mode)) });

		for (let i = 0; i < 20; i++) await frame();
		for (const k of ks)
			for (const arm of ["timer", "drained", "wall"]) await once(k, arm);

		const rows = new Map(
			ks.map((k) => [k, { timer: [], drained: [], wall: [] }]),
		);
		let disjointSeen = 0;
		for (let r = 0; r < reps; r++)
			for (const k of ks)
				for (const arm of ["timer", "drained", "wall"]) {
					const out = await once(k, arm);
					if (out.disjoint) disjointSeen++;
					rows.get(k)[arm].push(out.value);
				}

		const floor = { timer: [], wall: [] };
		for (let r = 0; r < reps; r++) {
			floor.timer.push((await once(1, "floor")).value);
			floor.wall.push((await once(1, "floorWall")).value);
		}

		return {
			spans,
			disjointSeen,
			rows: ks.map((k) => ({
				k,
				timer: med(rows.get(k).timer),
				drained: med(rows.get(k).drained),
				wall: med(rows.get(k).wall),
				n: rows.get(k).timer.filter((x) => x !== null).length,
			})),
			floor: { timer: med(floor.timer), wall: med(floor.wall) },
		};
	},
	{ ks: KS, reps: REPS, spanFrames: SPAN_FRAMES },
);

console.log(`renderer: ${renderer}`);
if (run.error) {
	console.log(`  ${run.error} — nothing to calibrate on this context`);
	await browser.close();
	process.exit(1);
}
console.log(
	`subject: planet-5 at ${RADII} radii, cockpit, ${REPS} reps per cell, seed ${SEED}\n`,
);

console.log("span   round      n   median      p95   rAF cadence");
for (const s of run.spans) {
	const f = (x) => String(x === null ? "—" : x.toFixed(2)).padStart(8);
	console.log(
		`${s.mode.padEnd(7)}${String(s.round).padEnd(7)}${String(s.n).padStart(4)}${f(s.median)}${f(s.p95)}${f(s.cadence)}`,
	);
}

console.log("\n  K   timer ms   drained ms   fenced wall ms   timer/wall");
for (const r of run.rows) {
	const f = (x, w) => String(x === null ? "—" : x.toFixed(2)).padStart(w);
	const ratio =
		r.timer !== null && r.wall ? (r.timer / r.wall).toFixed(2) : "—";
	console.log(
		`  ${r.k}   ${f(r.timer, 8)}   ${f(r.drained, 10)}   ${f(r.wall, 14)}   ${ratio.padStart(10)}`,
	);
}

const first = run.rows[0];
const last = run.rows[run.rows.length - 1];
// `null - null` is 0, so a run where every timer rep came back disjoint would
// otherwise print a confident `timer 0.00 ms` where the rows above print a dash.
const marginalIsReadable =
	first &&
	last &&
	last.k > first.k &&
	[first, last].every(
		(r) => r.timer !== null && r.drained !== null && r.wall !== null,
	);
if (marginalIsReadable) {
	const dk = last.k - first.k;
	const per = (a, b) => (b - a) / dk;
	const dT = per(first.timer, last.timer);
	const dD = per(first.drained, last.drained);
	const dW = per(first.wall, last.wall);
	console.log(
		`\n  per extra composer render — timer ${dT.toFixed(2)} ms, drained ${dD.toFixed(2)} ms, fenced ${dW.toFixed(2)} ms`,
	);
	console.log(
		`  marginal over-report: ${(dT / dW).toFixed(2)}x undrained, ${(dD / dW).toFixed(2)}x drained`,
	);
}

const { timer: fT, wall: fW } = run.floor;
if (fT !== null && fW !== null) {
	console.log(
		`\n  one scissored clear — timer ${fT.toFixed(2)} ms against a fenced ${fW.toFixed(2)} ms`,
	);
	console.log(
		fT > fW
			? "  a workload this small is reported above its cost — there is a per-query floor"
			: "  a workload small enough to fit one command buffer is reported honestly,\n" +
					"  so the excess above is summing rather than a fixed cost per query",
	);
}
console.log(
	`\n  disjoint results seen: ${run.disjointSeen} — a non-zero count means these figures are not comparable`,
);

// What the shipped sampler makes of this renderer, from its own snapshot.
const verdict = await page.evaluate(async () => {
	const g = window.__seelite;
	await g.enableFrameAttribution();
	for (let i = 0; i < 90; i++)
		await new Promise((r) => requestAnimationFrame(r));
	const snap = g.attributionSnapshot();
	g.disableFrameAttribution();
	return snap ? { ...snap.gpu, rasterizer: snap.renderer.rasterizer } : null;
});
if (!verdict) console.log("\n  the sampler did not come up on this page");
else {
	console.log(`\n  src/frame-attribution.ts says: ${verdict.status}`);
	console.log(
		`  median ${verdict.medianMs?.toFixed(3) ?? "—"} ms over ${verdict.sampleCount} samples`,
	);
	if (verdict.reason) console.log(`  because: ${verdict.reason}`);
}
await browser.close();
