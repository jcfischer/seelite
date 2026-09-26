/**
 * #537's browser tier: the cruise sky's light shift, in a running game.
 *
 * `tests/light-shift.test.ts` owns the physics and the starbow's hue. What only
 * a running game can show is that the star shader carries them, about the
 * ship's heading, and that nothing a pilot reads to fly has moved:
 *
 * - **The GLSL copy places a star where `aberrate` does, about the heading.**
 *   One star 40° off the heading, where the unshifted camera cannot see it, is
 *   found where the function says it is seen; and again with the head turned,
 *   which is what separates the ship's heading from the camera's.
 * - **Bodies stay true, in cruise.** On a live leg with the clock held, and with
 *   the star layer and the streaks taken away, the frame at full shift is the
 *   frame with none, pixel for pixel; and the sky cameras keep the near
 *   camera's focal scale, which is what keeps every marker on its body.
 * - **It follows the speed, and a drop-out eases.** Live cruise draws the β the
 *   intensity asks for about the ship's nose; after a drop-out it is still
 *   there one frame later and gone a few seconds after.
 *
 * **Not here: whether the keys still fly.** The shift is a shader uniform and
 * reaches no input, so a key row could not fail from it; the rows that were
 * here measured input handling on any build and were removed (sage round 1 on
 * #538). Flyability is the two rows above that hold the bodies and markers, and
 * the principal flying it.
 *
 * **What this cannot see is the look.** That is the `cruise-*` views in
 * `lib/view-set.mjs` and the principal's.
 */
import { installCruiseLeg } from "./lib/cruise-page.mjs";
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
await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
await bootedGame(page);
await page.evaluate(installCruiseLeg);

await page.evaluate(async () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const shift = await import("/src/light-shift.ts");
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
	let scratch = null;
	let ctx = null;
	window.__light = {
		shift,
		luma,
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
		/** Fraction of pixels whose luma moved by more than `by`. */
		moved(a, b, by) {
			let n = 0;
			for (let i = 0; i < a.data.length; i += 4)
				if (Math.abs(luma(a.data, i) - luma(b.data, i)) > by) n++;
			return n / (a.width * a.height);
		},
		/** Centroid of the pixels whose luma moved by more than `by`. */
		centroid(a, b, by) {
			let n = 0;
			let sx = 0;
			let sy = 0;
			for (let y = 0; y < a.height; y++)
				for (let x = 0; x < a.width; x++) {
					const i = (y * a.width + x) * 4;
					if (Math.abs(luma(a.data, i) - luma(b.data, i)) <= by) continue;
					n++;
					sx += x;
					sy += y;
				}
			return n ? { n, x: sx / n, y: sy / n } : { n };
		},
		/**
		 * Run `fn` on a bare cockpit frame — no bloom, no streaks, clock held —
		 * and restore both whatever `fn` does, so no row leaks into the next.
		 */
		bare(fn) {
			g.clockHeld = true;
			g.view = "cockpit";
			g.bloomPass.enabled = false;
			g.nearScene.remove(g.warp.object);
			try {
				return fn();
			} finally {
				g.nearScene.add(g.warp.object);
				g.bloomPass.enabled = true;
				g.holdCruiseLight(null);
			}
		},
		/**
		 * A unit direction on the backdrop sphere to drawing-buffer pixels,
		 * through `cam`'s own matrices: where a star in that direction is drawn.
		 */
		project(cam, dir, width, height) {
			const R = g.units.BACKDROP_RADIUS;
			const c = cam.matrixWorld.elements;
			const p = {
				x: c[12] + dir.x * R,
				y: c[13] + dir.y * R,
				z: c[14] + dir.z * R,
			};
			const v = cam.matrixWorldInverse.elements;
			const m = cam.projectionMatrix.elements;
			const vx = v[0] * p.x + v[4] * p.y + v[8] * p.z + v[12];
			const vy = v[1] * p.x + v[5] * p.y + v[9] * p.z + v[13];
			const vz = v[2] * p.x + v[6] * p.y + v[10] * p.z + v[14];
			const cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
			const cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
			const cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
			return {
				x: ((cx / cw + 1) / 2) * width,
				y: ((1 - cy / cw) / 2) * height,
			};
		},
	};
});

// The boot: an idle sky, and the star material nowhere but the backdrop.
const boot = await page.evaluate(() => {
	const g = window.__seelite;
	if (g.dock?.phase !== "flying" && typeof g.resetFlightToStart === "function")
		g.resetFlightToStart();
	g.render(0);
	const users = [];
	for (const [name, scene] of [
		["backdrop", g.backdropScene],
		["far", g.farScene],
		["approach", g.approachScene],
		["near", g.nearScene],
	])
		scene.traverse((o) => {
			if (o.material === g.starMaterial) users.push(name);
		});
	return { reading: g.cruiseLightReading(), users: [...new Set(users)] };
});
check(
	"the light shift is idle at boot",
	boot.reading.beta === 0 && boot.reading.heldAt === null,
	JSON.stringify(boot.reading),
);
check(
	"the shifted star material draws the backdrop and nothing else",
	boot.users.length === 1 && boot.users[0] === "backdrop",
	boot.users.join(", "),
);

// Real cruise, a frame at a time, rendered each frame so the ease runs.
const live = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__light;
	const leg = window.__cruiseLeg({ render: true });
	const p = g.cruiseParams;
	const intensity =
		Math.log(g.cruiseSpeedKms / p.vMinKms) / Math.log(p.vMaxKms / p.vMinKms);
	const nose = g.nose();
	const r = g.cruiseLightReading();
	const focal = (cam) => [
		cam.projectionMatrix.elements[0],
		cam.projectionMatrix.elements[5],
	];
	return {
		leg,
		reading: r,
		want: w.shift.cruiseBeta(intensity),
		headingErr: Math.hypot(
			r.heading.x - nose.x,
			r.heading.y - nose.y,
			r.heading.z - nose.z,
		),
		skyZoom: g.witchspaceReading().skyZoom,
		near: focal(g.nearCamera),
		skies: [g.backdropCamera, g.farCamera, g.approachCamera].map(focal),
	};
});
check(
	"live cruise draws the beta its speed asks for",
	live.leg.regime === "cruise" &&
		live.reading.beta > 0 &&
		Math.abs(live.reading.beta - live.want) < 1e-3,
	`beta ${live.reading.beta.toFixed(4)} against ${live.want.toFixed(4)}, to ${live.leg.to}`,
);
check(
	"the shift is about the ship's nose",
	live.headingErr < 1e-5,
	`off by ${live.headingErr.toExponential(2)}`,
);
check(
	"the sky cameras keep the near camera's focal scale, so markers sit on bodies",
	live.skyZoom === 1 &&
		live.skies.every(
			([x, y]) =>
				Math.abs(x - live.near[0]) < 1e-9 && Math.abs(y - live.near[1]) < 1e-9,
		),
	`zoom ${live.skyZoom}, near ${live.near.map((v) => v.toFixed(4))}, skies ${JSON.stringify(live.skies.map((s) => s.map((v) => v.toFixed(4))))}`,
);

// **Bodies stay true, in cruise.** On the live leg with the clock held: the star
// layer and the streaks are taken away, and the frame must not move between no
// shift and full shift. A same-build control pairs the full frame with itself,
// and a positive control keeps the star layer, so the reading can see a change.
const truth = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__light;
	// The positive control keeps the streaks too: the sky is what moves.
	g.clockHeld = true;
	g.view = "cockpit";
	g.bloomPass.enabled = false;
	g.holdCruiseLight(0);
	const skyOff = w.capture();
	g.holdCruiseLight(1);
	const skyOn = w.capture();
	g.bloomPass.enabled = true;
	const [bare0, bare1, bare1again] = w.bare(() => {
		g.starGroup.visible = false;
		try {
			g.holdCruiseLight(0);
			const off = w.capture();
			g.holdCruiseLight(1);
			return [off, w.capture(), w.capture()];
		} finally {
			g.starGroup.visible = true;
		}
	});
	const lit = (img) => {
		let n = 0;
		for (let i = 0; i < img.data.length; i += 4)
			if (w.luma(img.data, i) > 30) n++;
		return n / (img.width * img.height);
	};
	return {
		regime: g.regime,
		control: w.moved(bare1, bare1again, 2),
		bodies: w.moved(bare0, bare1, 2),
		sky: w.moved(skyOff, skyOn, 20),
		lit: lit(bare0),
	};
});
check(
	"the bare cruise frame has something in it to move (the cabin, the bodies)",
	truth.regime === "cruise" && truth.lit > 0.05,
	`${truth.regime}, ${(truth.lit * 100).toFixed(1)}% lit`,
);
check(
	"a bare frame is the same frame twice (the control)",
	truth.control === 0,
	`${(truth.control * 100).toFixed(4)}% moved`,
);
check(
	"in cruise, with the star layer and streaks away, full shift moves no pixel",
	truth.bodies === 0,
	`${(truth.bodies * 100).toFixed(4)}% moved`,
);
check(
	"with the star layer in, full shift does move the sky (the positive control)",
	truth.sky > 0.001,
	`${(truth.sky * 100).toFixed(3)}% moved`,
);

// **The GLSL copy, about the heading.** One bright star on the sky's own
// material, placed `deg` off the heading toward `toward` — the camera's up in
// the forward view, the camera's forward with the head turned — and found where
// `aberrate` says it is seen. The head-turned row is what separates the ship's
// heading from the camera's: a shader that shifted about the view direction
// passes the forward row and fails that one.
const starCheck = (deg, toward, headLook) =>
	page.evaluate(
		({ deg, toward, headLook }) => {
			const g = window.__seelite;
			const w = window.__light;
			const R = g.units.BACKDROP_RADIUS;
			return w.bare(() => {
				g.setHeadLook(headLook);
				g.cabinHidden = true;
				g.holdCruiseLight(1);
				g.render(0);
				const cam = g.backdropCamera;
				cam.updateMatrixWorld();
				const e = cam.matrixWorld.elements;
				const { heading: h, beta } = g.cruiseLightReading();
				const dotv = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
				const pick =
					toward === "up"
						? { x: e[4], y: e[5], z: e[6] }
						: { x: -e[8], y: -e[9], z: -e[10] };
				const k = dotv(pick, h);
				const u = {
					x: pick.x - k * h.x,
					y: pick.y - k * h.y,
					z: pick.z - k * h.z,
				};
				const ul = Math.hypot(u.x, u.y, u.z);
				const th = (deg * Math.PI) / 180;
				const d = {
					x: Math.cos(th) * h.x + (Math.sin(th) * u.x) / ul,
					y: Math.cos(th) * h.y + (Math.sin(th) * u.y) / ul,
					z: Math.cos(th) * h.z + (Math.sin(th) * u.z) / ul,
				};
				const layer = g.starGroup.children[0];
				const geometry = new layer.geometry.constructor();
				const Attr = layer.geometry.attributes.position.constructor;
				geometry.setAttribute(
					"position",
					new Attr(new Float32Array([d.x * R, d.y * R, d.z * R]), 3),
				);
				geometry.setAttribute(
					"aColor",
					new Attr(new Float32Array([4, 4, 4]), 3),
				);
				geometry.setAttribute("aSize", new Attr(new Float32Array([0.02]), 1));
				const star = new layer.constructor(geometry, g.starMaterial);
				star.frustumCulled = false;
				const hidden = g.starGroup.children.slice();
				for (const c of hidden) c.visible = false;
				const without = w.capture();
				g.starGroup.add(star);
				const shifted = w.capture();
				g.holdCruiseLight(0);
				const rest = w.capture();
				g.starGroup.remove(star);
				geometry.dispose();
				for (const c of hidden) c.visible = true;
				g.setHeadLook("forward");
				g.cabinHidden = false;
				const at = (dir) => w.project(cam, dir, without.width, without.height);
				return {
					beta,
					offNose:
						(Math.acos(
							Math.max(-1, Math.min(1, -e[8] * h.x - e[9] * h.y - e[10] * h.z)),
						) *
							180) /
						Math.PI,
					want: at(w.shift.aberrate(d, h, beta)),
					wantAtRest: at(d),
					got: w.centroid(without, shifted, 20),
					atRest: w.centroid(without, rest, 20),
				};
			});
		},
		{ deg, toward, headLook },
	);
const missOf = (got, want) =>
	got.n ? Math.hypot(got.x - want.x, got.y - want.y) : Number.POSITIVE_INFINITY;
const fmt = (p) => (p.n === 0 ? "none" : `${p.x.toFixed(1)},${p.y.toFixed(1)}`);

const ahead = await starCheck(40, "up", "forward");
check(
	"a star 40° off the nose is off the unshifted frame",
	ahead.atRest.n === 0,
	`${ahead.atRest.n} px lit`,
);
const aheadMiss = missOf(ahead.got, ahead.want);
check(
	"the shader draws it where aberrate() says it is seen",
	ahead.got.n > 0 && aheadMiss < 3,
	`${ahead.got.n} px at ${fmt(ahead.got)} against ${fmt({ n: 1, ...ahead.want })} (${aheadMiss.toFixed(2)} px) at beta ${ahead.beta}`,
);

// Head turned: the camera looks well off the nose, and a star 82° off the
// heading toward where it looks is on screen both at rest and shifted: at rest
// about 15° past the view axis from the nose, shifted about 20° short of it.
const side = await starCheck(82, "forward", "left");
const sideRestMiss = missOf(side.atRest, side.wantAtRest);
const sideMiss = missOf(side.got, side.want);
check(
	"with the head turned the camera looks well off the nose",
	side.offNose > 30,
	`${side.offNose.toFixed(1)}° off the nose`,
);
check(
	"head turned, the unshifted star is where it always was",
	side.atRest.n > 0 && sideRestMiss < 3,
	`${fmt(side.atRest)} against ${fmt({ n: 1, ...side.wantAtRest })} (${sideRestMiss.toFixed(2)} px)`,
);
check(
	"head turned, the shifted star is where aberrate() puts it about the ship's heading",
	side.got.n > 0 && sideMiss < 3,
	`${fmt(side.got)} against ${fmt({ n: 1, ...side.want })} (${sideMiss.toFixed(2)} px)`,
);

// **A drop-out eases.** Live β, then a drop-out: still drawn one frame later,
// gone within a few seconds.
const ease = await page.evaluate(() => {
	const g = window.__seelite;
	const w = window.__light;
	g.clockHeld = true;
	g.holdCruiseLight(null);
	for (let i = 0; i < 10; i++) w.frame();
	const cruising = g.cruiseLightReading().beta;
	g.dropOut("probe");
	w.frame();
	const oneFrame = g.cruiseLightReading().beta;
	for (let i = 0; i < 40; i++) w.frame();
	return {
		regime: g.regime,
		cruising,
		oneFrame,
		settled: g.cruiseLightReading().beta,
	};
});
check(
	"a drop-out does not snap the sky in one frame",
	ease.cruising > 0 && ease.oneFrame > 0 && ease.oneFrame < ease.cruising,
	`${ease.cruising.toFixed(4)} → ${ease.oneFrame.toFixed(4)}`,
);
check(
	"and the sky is back to rest a few seconds later",
	ease.regime !== "cruise" && ease.settled === 0,
	`${ease.regime}, beta ${ease.settled}`,
);

await browser.close();
exit();
