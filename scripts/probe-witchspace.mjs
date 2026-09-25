/**
 * #532's browser tier: the witchspace transition across a **real** jump.
 *
 * `tests/witchspace.test.ts` owns the phase, the look and the cue schedule;
 * `tests/witchspace-pass.test.ts` and `tests/arrival-rift.test.ts` own the two
 * drawn halves in isolation. What only a running game can show is that they are
 * wired: that the composer carries the pass through `rebuildSystem()`, that it
 * lights pixels on the frames around the cut, that the rift exists in the *new*
 * system and stands where a chase camera sees it, and that a cancel and the
 * arrival-only path end where they should.
 *
 * **What this cannot see is the look.** Every threshold here separates "drawn"
 * from "not drawn"; whether it reads as a jump is the strip's (`witchspace-*`
 * rows in `lib/view-set.mjs`) and the principal's.
 *
 * Readings go through `Game.witchspaceReading()` and the phase handle
 * `holdWitchspace`, never through a uniform: the frame loop rewrites the pass's
 * dials every frame, so a probe that wrote one would measure its own write
 * being overwritten.
 */
import { gameUrl } from "./lib/game-url.mjs";
import { SEED, VIEWPORT } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: VIEWPORT });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }));
await bootedGame(page);

await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
	let scratch = null;
	let ctx = null;
	window.__witch = {
		/** One shipped frame, in the loop's own order. */
		frame() {
			g.step(dt);
			g.render(dt);
		},
		/** Render and read in the same task; the canvas is not preserved. */
		capture() {
			const src = g.renderer.domElement;
			if (!scratch) {
				scratch = document.createElement("canvas");
				ctx = scratch.getContext("2d", { willReadFrequently: true });
			}
			scratch.width = src.width;
			scratch.height = src.height;
			g.render(0);
			ctx.drawImage(src, 0, 0);
			return ctx.getImageData(0, 0, scratch.width, scratch.height);
		},
		/** Fraction of pixels brighter than `floor`. */
		brighter(img, floor) {
			let n = 0;
			for (let i = 0; i < img.data.length; i += 4)
				if (luma(img.data, i) > floor) n++;
			return n / (img.width * img.height);
		},
		/** Fraction of pixels whose luma moved by more than `by`. */
		moved(a, b, by) {
			let n = 0;
			for (let i = 0; i < a.data.length; i += 4)
				if (Math.abs(luma(a.data, i) - luma(b.data, i)) > by) n++;
			return n / (a.width * a.height);
		},
		/** The nearest other system, committed and charged for. */
		chargeToNearest() {
			const here = g.world.system.record;
			const d = (a, b) =>
				Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
			const near = g.world.galaxy.systems
				.filter((s) => s.index !== here.index)
				.sort((a, b) => d(a, here) - d(b, here))[0];
			g.dropOut("probe");
			g.encounter = null;
			const committed = g.commitCourseTo(near.index);
			const charged = g.chargeJump();
			return {
				from: here.index,
				to: near.index,
				committed,
				charged,
				notice: g.jumpNotice,
			};
		},
	};
});

// The boot: the pass is in the composer and costs nothing.
const boot = await page.evaluate(() => {
	const g = window.__seelite;
	// Flying, so a charge is not refused as a docked start.
	if (g.dock?.phase !== "flying" && typeof g.resetFlightToStart === "function")
		g.resetFlightToStart();
	return g.witchspaceReading();
});
check(
	"the witchspace pass is in the composer, disabled, before any jump",
	boot.pass.inComposer && !boot.pass.enabled && boot.state === "idle",
	JSON.stringify(boot.pass),
);

// A real jump, a frame at a time.
const jump = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__witch;
	g.clockHeld = true;
	const start = w.chargeToNearest();
	const frames = [];
	for (
		let i = 0;
		i < 200 && g.world.system.record.index === start.from && start.charged;
		i++
	) {
		w.frame();
		const r = g.witchspaceReading();
		frames.push({
			system: g.world.system.record.index,
			state: r.state,
			phase: r.phase,
			enabled: r.pass.enabled,
			streak: r.pass.streak,
			tunnel: r.pass.tunnel,
			whiteout: r.pass.whiteout,
			beta: r.pass.beta,
			dark: r.pass.dark,
			skyZoom: r.skyZoom,
			controlHeld: r.controlHeld,
			rift: r.rift,
		});
	}
	const ship = g.world.ship.pos;
	const nose = g.nose();
	return { start, frames, ship: { ...ship }, nose: { ...nose } };
});
check(
	"a charge to the nearest system is accepted",
	jump.start.charged,
	JSON.stringify(jump.start),
);
const inOld = jump.frames.filter((f) => f.system === jump.start.from);
const arrived = jump.frames.at(-1);
check(
	"the jump arrives in the new system",
	arrived?.system === jump.start.to,
	`${jump.frames.length} frames, last system ${arrived?.system}`,
);
// The entry is the whole wind-up now (the principal's third flight): the sky
// starts to crowd forward in the charge's first second.
const early = inOld.filter((f) => f.phase !== null && f.phase < -2.4);
check(
	"the starbow builds from the start of the charge, and the sky cameras widen",
	early.length > 0 &&
		early.every((f) => f.enabled) &&
		early.at(-1).beta > 0 &&
		early.at(-1).skyZoom < 1,
	JSON.stringify(early.at(-1)),
);
const lastOld = inOld.at(-1);
check(
	"the old system's last frames are the point: the dark has closed and the sky is squeezed",
	lastOld?.enabled && lastOld.dark > 0.9 && lastOld.skyZoom < 0.5,
	JSON.stringify(lastOld),
);
check(
	"the first frame in the new system is in the dark, and the pilot's hands are held",
	arrived?.state === "exit" &&
		arrived.dark === 1 &&
		arrived.enabled &&
		arrived.controlHeld === true,
	JSON.stringify({ ...arrived, rift: undefined }),
);
check(
	"the arrival rift exists in the new system's scene",
	arrived?.rift?.inScene === true,
	JSON.stringify(arrived?.rift),
);
if (arrived?.rift) {
	const a = arrived.rift.anchor;
	const d = {
		x: a.x - jump.ship.x,
		y: a.y - jump.ship.y,
		z: a.z - jump.ship.z,
	};
	const along = d.x * jump.nose.x + d.y * jump.nose.y + d.z * jump.nose.z;
	check(
		"the rift stands behind the ship on its nose axis",
		along < 0 && Math.abs(Math.hypot(d.x, d.y, d.z) + along) < 1e-6,
		`${(along * 1000).toFixed(1)} m along the nose`,
	);
}

// The hands: a real throttle key during the arrival does nothing. This is a
// default-layout probe (#381 D11): Shift is throttle up in the shipped layout, and the same press is the control after the sky is
// back, where it must move the throttle — otherwise a dead key would pass.
const pressThrottle = async () => {
	await page.evaluate(() => {
		window.__seelite.throttle = 0;
	});
	await page.keyboard.down("Shift");
	const after = await page.evaluate(() => {
		const w = window.__witch;
		for (let i = 0; i < 6; i++) w.frame();
		return window.__seelite.throttle;
	});
	await page.keyboard.up("Shift");
	return after;
};
const heldThrottle = await pressThrottle();
check(
	"during the arrival a held throttle key does not move the throttle",
	heldThrottle === 0,
	`throttle ${heldThrottle}`,
);

// Lit: the held phases change pixels, measured against the same frame unheld.
// And the tunnel is **behind the cabin**: the principal ruled it goes outside
// the canopy, so a cabin pixel must not move when the tunnel comes up.
const lit = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__witch;
	g.view = "cockpit";
	// **Bloom off for the occlusion question.** The tunnel's throat is bright
	// and its halo lands on the scanner deck, which is light and is meant to;
	// whether the tunnel is drawn *over* the cabin is a different question, and
	// with the halo in it the first reading counted 28% of the cabin as moved.
	g.bloomPass.enabled = false;
	g.holdWitchspace(1.5);
	const cut = w.capture();
	// The cabin's own pixels: where the held frame changes when the cabin is
	// taken away. `cabinHidden` is what the placement tools use to clear it.
	g.cabinHidden = true;
	const cutClear = w.capture();
	g.cabinHidden = false;
	// **Cover is independence from the sky**, not difference from it: the
	// tunnel's dark reaches match black space, so "moved against the plain
	// frame" read 79% on a frame the tunnel covered whole. Take the sky layers
	// away and a covered pixel must not change.
	const skies = [g.backdropScene, g.farScene, g.approachScene];
	for (const scene of skies) scene.visible = false;
	const cutNoSky = w.capture();
	for (const scene of skies) scene.visible = true;
	g.holdWitchspace(-3);
	const plain = w.capture();
	g.bloomPass.enabled = true;
	g.holdWitchspace(-1.5);
	const streak = w.capture();
	g.holdWitchspace(-3);
	const plainLit = w.capture();
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
	let cabin = 0;
	let cabinMoved = 0;
	let outside = 0;
	let outsideStable = 0;
	const cabinMask = new Uint8Array(cut.data.length / 4);
	for (let i = 0; i < cut.data.length; i += 4) {
		const isCabin = Math.abs(luma(cut.data, i) - luma(cutClear.data, i)) > 10;
		const moved = Math.abs(luma(cut.data, i) - luma(plain.data, i)) > 10;
		if (isCabin) {
			cabinMask[i / 4] = 1;
			cabin++;
			if (moved) cabinMoved++;
		} else {
			outside++;
			if (Math.abs(luma(cut.data, i) - luma(cutNoSky.data, i)) <= 3)
				outsideStable++;
		}
	}
	// **The starbow is light crowding toward the nose**, so it is read as where
	// the lit sky pixels are, not how many moved: the field is sparse, and a
	// moved-pixel count was 4.5% on a frame whose stars had visibly converged.
	const litRadius = (img) => {
		const cx = img.width / 2;
		const cy = img.height / 2;
		const half = Math.hypot(cx, cy);
		let n = 0;
		const band = { inner: [0, 0], outer: [0, 0] };
		for (let y = 0; y < img.height; y++)
			for (let x = 0; x < img.width; x++) {
				const p = y * img.width + x;
				if (cabinMask[p] || luma(img.data, p * 4) <= 40) continue;
				n++;
				const r = Math.hypot(x - cx, y - cy) / half;
				const which = r < 0.33 ? band.inner : r > 0.66 ? band.outer : null;
				if (!which) continue;
				// Blue minus red: Doppler shifts the light ahead blue and the
				// light at the rim red.
				which[0] += img.data[p * 4 + 2] - img.data[p * 4];
				which[1]++;
			}
		const mean = ([sum, k]) => (k ? sum / k : null);
		return { n, inner: mean(band.inner), outer: mean(band.outer) };
	};
	// Chase, at a phase where the rift is open and the tunnel has collapsed.
	g.view = "chase";
	g.holdWitchspace(4.3);
	const withRift = w.capture();
	// The control: the same frame with the rift off the camera's layer. Not
	// `visible`, which `presentWitchspace` rewrites on every render.
	const rift = g.arrivalRift?.object;
	let riftMoved = null;
	if (rift) {
		rift.layers.set(31);
		const without = w.capture();
		rift.layers.set(0);
		riftMoved = w.moved(withRift, without, 10);
	}
	const reading = g.witchspaceReading();
	g.view = "cockpit";
	g.holdWitchspace(null);
	// Where the pass sits: after the approach layer's pass, before the near's.
	const passes = g.composer.passes;
	const at = passes.indexOf(g.witchspacePass);
	return {
		cabinShare: cabin / (cabin + outside),
		cabinMoved: cabin ? cabinMoved / cabin : null,
		outsideStable: outside ? outsideStable / outside : null,
		starbow: litRadius(streak),
		sky: litRadius(plainLit),
		riftMoved,
		riftReading: reading.rift,
		before: passes[at - 1]?.scene === g.approachScene,
		// The *first* pass holding the near scene, not merely the next one: the
		// AO pass holds it too, and a pass moved after the near layer passed a
		// next-one check against it in the red build.
		after: at + 1 === passes.findIndex((p) => p.scene === g.nearScene),
	};
});
check(
	"the pass is drawn between the approach layer and the near one",
	lit.before && lit.after,
	`before is approach: ${lit.before}, after is near: ${lit.after}`,
);
check(
	"held in the tunnel, it covers everything outside the cabin",
	lit.outsideStable > 0.97,
	`${((lit.outsideStable ?? 0) * 100).toFixed(1)}% of outside pixels unchanged with the sky taken away`,
);
check(
	"and the cabin is drawn over it, not under it",
	lit.cabinShare > 0.1 && lit.cabinMoved < 0.2,
	`the cabin is ${(lit.cabinShare * 100).toFixed(1)}% of the frame and ${((lit.cabinMoved ?? 1) * 100).toFixed(1)}% of it moved`,
);
check(
	"held in the starbow, more of the sky is in the frame — the aberration",
	lit.sky.n > 0 && lit.starbow.n > 1.5 * lit.sky.n,
	`${lit.starbow.n} lit sky pixels against ${lit.sky.n} at rest`,
);
// The light-weighted radius was tried first and does not shrink at this
// phase: the widened frame fills evenly with stars. Checked later in the
// wind-up it passes only because the dark has cut the rim away, which is a
// control that removes two things; so beaming is not claimed here.
check(
	"and it is Doppler-shifted: bluer toward the nose, redder toward the rim",
	lit.starbow.inner !== null &&
		lit.starbow.outer !== null &&
		lit.sky.inner !== null &&
		lit.sky.outer !== null &&
		lit.starbow.inner - lit.starbow.outer > lit.sky.inner - lit.sky.outer + 20,
	`blue minus red, inner and outer: ${lit.starbow.inner?.toFixed(1)} and ${lit.starbow.outer?.toFixed(1)} against ${lit.sky.inner?.toFixed(1)} and ${lit.sky.outer?.toFixed(1)} at rest`,
);
check(
	"from the chase camera the rift is open and draws pixels",
	lit.riftMoved > 0.02 &&
		lit.riftReading?.visible === true &&
		lit.riftReading.strength > 0.5,
	`${((lit.riftMoved ?? 0) * 100).toFixed(1)}% of pixels moved; ${JSON.stringify(lit.riftReading)}`,
);

// The exit ends: the pass goes quiet and the rift is torn down.
const ended = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__witch;
	let frames = 0;
	let handsBackAt = null;
	while (g.witchspaceReading().state !== "idle" && frames < 600) {
		const before = g.witchspaceReading();
		w.frame();
		frames++;
		if (
			handsBackAt === null &&
			before.controlHeld &&
			!g.witchspaceReading().controlHeld
		)
			handsBackAt = before.phase;
	}
	g.render(g.units.MAX_DT);
	return { frames, handsBackAt, reading: g.witchspaceReading() };
});
check(
	"the hands come back when the sky has",
	ended.handsBackAt !== null &&
		Math.abs(ended.handsBackAt - ended.reading.controlBackS) < 0.1,
	`at ${ended.handsBackAt} s, controlBackS ${ended.reading.controlBackS}`,
);
const liveThrottle = await pressThrottle();
check(
	"and the same key moves the throttle once they have",
	liveThrottle > 0,
	`throttle ${liveThrottle}`,
);
check(
	"the exit ends idle, the pass disabled and the rift gone",
	ended.reading.state === "idle" &&
		!ended.reading.pass.enabled &&
		ended.reading.rift === null &&
		ended.reading.skyZoom === 1,
	`${ended.frames} frames; ${JSON.stringify({ ...ended.reading, look: undefined })}`,
);

// A cancel mid-entry retracts rather than popping, and no jump happens.
const cancel = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__witch;
	const start = w.chargeToNearest();
	let before = null;
	for (let i = 0; i < 200; i++) {
		w.frame();
		before = g.witchspaceReading();
		if (before.phase !== null && before.phase > -0.5) break;
	}
	g.cancelJumpCharge("probe");
	g.render(0);
	const at = g.witchspaceReading();
	let frames = 0;
	while (g.witchspaceReading().state !== "idle" && frames < 120) {
		w.frame();
		frames++;
	}
	return {
		start,
		before,
		at,
		frames,
		after: g.witchspaceReading(),
		system: g.world.system.record.index,
	};
});
check(
	"a cancel mid-entry retracts from what was on screen",
	cancel.start.charged &&
		cancel.at.state === "retract" &&
		cancel.at.pass.enabled &&
		Math.abs(cancel.at.pass.streak - cancel.before.pass.streak) < 1e-9,
	`streak ${cancel.before?.pass.streak.toFixed(3)} → ${cancel.at?.pass.streak.toFixed(3)}`,
);
check(
	"and fades out without a jump",
	cancel.after.state === "idle" &&
		!cancel.after.pass.enabled &&
		cancel.system === cancel.start.from,
	`${cancel.frames} frames, system ${cancel.system} (from ${cancel.start.from})`,
);

// The exit with no entry (#530's arrival).
const arrival = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__witch;
	const system = g.world.system.record.index;
	g.playArrival();
	w.frame();
	return {
		reading: g.witchspaceReading(),
		same: g.world.system.record.index === system,
	};
});
check(
	"playArrival draws the exit and the rift without a jump",
	arrival.same &&
		arrival.reading.state === "exit" &&
		arrival.reading.pass.enabled &&
		arrival.reading.rift?.inScene === true,
	JSON.stringify({ ...arrival.reading, look: undefined }),
);

await browser.close();
exit();
