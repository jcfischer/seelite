/**
 * Station identity — node #28's spatial tier: `station-types.md` §7 and §9.2,
 * `docking.md` §4 and §9.2.2.
 *
 *   npm run dev                       # in one shell
 *   node scripts/probe-station.mjs    # in another
 *
 * Three claims, none of which a headless test can reach:
 *
 * 1. **The three silhouettes are distinguishable — by outline, not by colour.**
 *    §7 rests station identity on the shape a player sees before colour and
 *    before any detail resolves, so the measurement is a *desaturated* one:
 *    every frame is reduced to luminance before anything is compared, and the
 *    three `STATION_COLORS` cannot contribute to a pass. Colour differences are
 *    the easy way for this probe to go green while the outlines are identical,
 *    which is exactly the failure §7 is a decision about.
 *
 * 2. **The slot tracks the spin.** Its screen-space orientation advances at the
 *    station's own `spinRpm`, measured at both ends of §4's range — this world
 *    holds a 0.91 rpm trade station and a 2.95 rpm shipyard, so the two ends are
 *    the generator's own values rather than ones written in by the probe.
 *
 * 3. **The assembly obeys the distance rule**, drydock frame and all: near
 *    within `HANDOFF_KM`, far beyond it, read off the page.
 *
 * ## How the silhouette is isolated
 *
 * Not by thresholding the frame — a starfield puts lit pixels everywhere and
 * the station is lit by a sun whose direction depends on where in its orbit it
 * is. Instead each station is measured **twice**, once drawn and once with its
 * mesh hidden, and the silhouette is the set of pixels that changed. That makes
 * the mask exact rather than tuned, and it costs one extra render.
 *
 * The masks are then cropped to their own bounding boxes and resampled to a
 * fixed grid before being compared, so the comparison is of *shape* and not of
 * apparent size: two stations at slightly different ranges, or with different
 * core radii (0.6 km against the refinery's 0.4), would otherwise "differ" for
 * a reason that has nothing to do with their outlines.
 *
 * ## The viewpoint
 *
 * Each station is viewed **along its own aperture axis**, from the same range,
 * because that is the view a docking approach actually has and because it is the
 * one viewpoint defined for all three types. The axis comes off the page
 * (`poseOfStation`) rather than being re-derived here: a probe with its own copy
 * of the rule asserts its own copy.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/**
 * Seed 1, and not an arbitrary one: its start system holds all three station
 * types — the only way to compare three silhouettes under one lighting setup —
 * and its two Coriolis stations happen to sit at 0.91 and 2.95 rpm, which is
 * §4's range measured at both ends without the probe writing a spin itself.
 */
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=1`;

/** Where the camera stands, kilometres from the station centre. Far enough that
 *  the shipyard's 1.5 km frame is inside the frame, close enough that the
 *  refinery's 0.4 km drum is hundreds of pixels across. */
const RANGE_KM = 5;

/** The mask is resampled to this grid before shapes are compared. */
const GRID = 24;

/**
 * How much two silhouettes must differ, as `1 − IoU` on the resampled masks.
 *
 * A floor, and it is only meaningful against the metric's own noise — so the
 * run measures that too, by capturing one station twice (the control below).
 * Measured: the three pairs come out at about 0.35 (trade/refinery), 0.61
 * (trade/shipyard) and 0.62 (refinery/shipyard), against a control of 0.02.
 * The closest pair is the two compact types, which is where the identity claim
 * is hardest, and 0.25 leaves that pair about 40% of headroom while sitting an
 * order of magnitude above the noise.
 */
const MIN_DIFFERENCE = 0.25;

/** What re-measuring one station back to back may differ by. Not zero: the
 *  clock advances between the two captures, so a boundary cell or two moves. */
const MAX_CONTROL_DIFFERENCE = 0.05;

/** Tolerance on the measured spin rate, relative. Loose because the station is
 *  also moving along its orbit between the two samples, and because the frame
 *  loop decides when the samples land rather than the probe. */
const SPIN_TOLERANCE = 0.06;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();

const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const setup = await page.evaluate(() => {
	const g = window.__seelite;
	return {
		system: g.world.system.record.name,
		handoffKm: g.units.HANDOFF_KM,
		hysteresis: g.units.HANDOFF_HYSTERESIS,
		stations: g.world.system.contents.stations.map((s) => ({
			id: s.id,
			type: s.type,
			spinRpm: s.spinRpm,
			blackMarket: s.blackMarket,
		})),
	};
});

console.log(
	`\n${setup.system}: ${setup.stations
		.map((s) => `${s.type} (${s.spinRpm.toFixed(2)} rpm)`)
		.join(", ")}\n`,
);

check(
	"the system holds all three station types",
	new Set(setup.stations.map((s) => s.type)).size === 3,
	setup.stations.map((s) => s.type).join(", "),
);
if (new Set(setup.stations.map((s) => s.type)).size !== 3) {
	await browser.close();
	exit();
}

/**
 * Put the camera on a station's aperture axis at `RANGE_KM` and look back down
 * it, so the aperture faces the viewer.
 *
 * The ship is placed rather than flown, for `probe-handoff.mjs`'s reason: the
 * distances involved take hours under thrust, and the renderer cannot tell a
 * placed ship from a flown one.
 */
async function viewAlongAxis(id, rangeKm) {
	return page.evaluate(
		async ([bodyId, range]) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const pose = g.poseOfStation(bodyId);
			g.world.ship.pos = {
				x: body.pos.x + pose.axis.x * range,
				y: body.pos.y + pose.axis.y * range,
				z: body.pos.z + pose.axis.z * range,
			};
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			// A camera looks down its own −Z, so aiming at the station means
			// mapping −Z onto −axis. `Vector3` is not reachable from the page, so
			// the two vectors are borrowed from an object that already holds some.
			const from = g.nearScene.position.clone().set(0, 0, -1);
			const to = g.nearScene.position
				.clone()
				.set(-pose.axis.x, -pose.axis.y, -pose.axis.z);
			g.orientation.setFromUnitVectors(from, to);
			await new Promise((r) => requestAnimationFrame(() => r()));
			await new Promise((r) => requestAnimationFrame(() => r()));
			return { axis: pose.axis, gameTime: g.world.gameTime };
		},
		[id, rangeKm],
	);
}

/**
 * The station's silhouette as a `GRID × GRID` occupancy mask.
 *
 * Two synchronous renders, one with the mesh hidden, differenced in luminance —
 * see the header. Both happen inside one evaluate so no frame can land between
 * them and move the station.
 */
async function silhouette(id) {
	return page.evaluate(
		([bodyId, grid]) => {
			const g = window.__seelite;
			const W = 600;
			const H = 420;
			const src = g.renderer.domElement;
			const scratch = document.createElement("canvas");
			scratch.width = W;
			scratch.height = H;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });

			/** Luminance only: §7's claim is about outline, so colour must not be
			 *  able to carry a pass. */
			const luma = () => {
				// Render and read in the same task — a WebGL canvas without
				// `preserveDrawingBuffer` is cleared at the next composite.
				g.render(0);
				ctx.drawImage(src, 0, 0, W, H);
				const d = ctx.getImageData(0, 0, W, H).data;
				const out = new Float32Array(W * H);
				for (let i = 0; i < W * H; i++)
					out[i] =
						0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
				return out;
			};

			const mesh =
				g.nearScene.getObjectByName(bodyId) ??
				g.farScene.getObjectByName(bodyId);
			if (!mesh) return { missing: true };
			const withIt = luma();
			mesh.visible = false;
			const without = luma();
			mesh.visible = true;
			g.render(0);

			// Anything that changed by more than a JPEG-ish nudge is the station.
			// The threshold is on a difference of two frames of the same scene, so
			// it is not a lighting guess.
			const mask = new Uint8Array(W * H);
			let count = 0;
			let minX = W;
			let maxX = -1;
			let minY = H;
			let maxY = -1;
			for (let i = 0; i < W * H; i++) {
				if (Math.abs(withIt[i] - without[i]) <= 6) continue;
				mask[i] = 1;
				count++;
				const x = i % W;
				const y = (i / W) | 0;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
			if (count === 0) return { empty: true, W, H };

			// Crop to the station's own bounding box and resample, so the shapes are
			// compared and their apparent sizes are not.
			const bw = maxX - minX + 1;
			const bh = maxY - minY + 1;
			const cells = [];
			for (let gy = 0; gy < grid; gy++) {
				for (let gx = 0; gx < grid; gx++) {
					let hits = 0;
					let seen = 0;
					// Both ends relative to the box, then offset once. Adding `minX`
					// to a value that already carried it is how the first version of
					// this loop sampled a strip miles off the station and scored
					// every pair identical — at zero, which is what an empty mask
					// scores and so looked like a shape claim rather than a bug.
					const x0 = minX + Math.floor((gx * bw) / grid);
					const x1 =
						minX +
						Math.max(
							Math.floor((gx * bw) / grid) + 1,
							Math.floor(((gx + 1) * bw) / grid),
						);
					const y0 = minY + Math.floor((gy * bh) / grid);
					const y1 =
						minY +
						Math.max(
							Math.floor((gy * bh) / grid) + 1,
							Math.floor(((gy + 1) * bh) / grid),
						);
					for (let y = y0; y < Math.min(y1, H); y++)
						for (let x = x0; x < Math.min(x1, W); x++) {
							seen++;
							hits += mask[y * W + x];
						}
					cells.push(seen > 0 && hits / seen > 0.5 ? 1 : 0);
				}
			}
			return {
				cells,
				pixels: count,
				box: { w: bw, h: bh },
				coverage: count / (bw * bh),
			};
		},
		[id, GRID],
	);
}

const shapes = new Map();
for (const station of setup.stations) {
	await viewAlongAxis(station.id, RANGE_KM);
	const shape = await silhouette(station.id);
	check(
		`${station.type}: the station is drawn and has a silhouette to measure`,
		!shape.missing && !shape.empty && shape.pixels > 500,
		shape.missing
			? "no mesh"
			: shape.empty
				? "no pixels changed"
				: `${shape.pixels} px, box ${shape.box.w}×${shape.box.h}, ` +
					`fill ${(100 * shape.coverage).toFixed(0)}%`,
	);
	if (shape.cells) shapes.set(station.type, shape);
	// The control, captured back to back from the same viewpoint: it measures the
	// metric's noise and nothing else. Re-aiming first would fold in a second of
	// spin and orbit, which is a real change of shape rather than instability —
	// the first version did that and read 0.05, indistinguishable from a flaky
	// mask.
	if (station.type === "trade" && shape.cells)
		shapes.set("trade-again", await silhouette(station.id));
}

/** Intersection over union on the resampled masks. 1 is identical. */
const iou = (a, b) => {
	let inter = 0;
	let union = 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] && b[i]) inter++;
		if (a[i] || b[i]) union++;
	}
	return union === 0 ? 1 : inter / union;
};

const types = [...shapes.keys()].filter((t) => t !== "trade-again");
console.log(
	`\nsilhouettes at ${RANGE_KM} km, desaturated, ${GRID}×${GRID} after crop:`,
);
for (let i = 0; i < types.length; i++) {
	for (let j = i + 1; j < types.length; j++) {
		const difference =
			1 - iou(shapes.get(types[i]).cells, shapes.get(types[j]).cells);
		console.log(
			`  ${types[i]} vs ${types[j]}: 1 − IoU = ${difference.toFixed(3)}`,
		);
		check(
			`${types[i]} and ${types[j]} differ by outline alone`,
			difference > MIN_DIFFERENCE,
			`1 − IoU = ${difference.toFixed(3)} (floor ${MIN_DIFFERENCE})`,
		);
	}
}

/**
 * The control: one station measured twice.
 *
 * Without it the floor above is a number in a comment. This puts the metric's
 * noise in the same run as the claim it supports — and it fails loudly if the
 * mask ever becomes unstable frame to frame, which would make every pairwise
 * figure above meaningless rather than merely noisy.
 */
{
	const control =
		1 - iou(shapes.get("trade").cells, shapes.get("trade-again").cells);
	console.log(
		`  control (trade measured twice): 1 − IoU = ${control.toFixed(3)}`,
	);
	check(
		"re-measuring one station reproduces its silhouette",
		control < MAX_CONTROL_DIFFERENCE,
		`1 − IoU = ${control.toFixed(3)} (ceiling ${MAX_CONTROL_DIFFERENCE})`,
	);
}

/**
 * The slot's screen-space orientation, radians.
 *
 * The aperture group's local +X is the slot's long axis — the thing check 4's
 * roll is matched to — so this projects that axis through the near camera and
 * reports its angle on screen. Pixels rather than NDC, so the viewport's aspect
 * ratio does not shear the angle.
 */
async function slotAngle(id) {
	return page.evaluate(
		([bodyId]) => {
			const g = window.__seelite;
			const mesh =
				g.nearScene.getObjectByName(bodyId) ??
				g.farScene.getObjectByName(bodyId);
			const aperture = mesh?.getObjectByName("aperture");
			if (!aperture) return { missing: true };
			g.render(0);
			const origin = aperture.getWorldPosition(g.nearScene.position.clone());
			const tip = aperture.localToWorld(
				g.nearScene.position.clone().set(1, 0, 0),
			);
			const camera = g.nearCamera;
			const a = origin.clone().project(camera);
			const b = tip.clone().project(camera);
			const el = g.renderer.domElement;
			return {
				angle: Math.atan2((b.y - a.y) * el.height, (b.x - a.x) * el.width),
				gameTime: g.world.gameTime,
			};
		},
		[id],
	);
}

/** Signed angular difference, wrapped into (−π, π]. */
const wrap = (d) => {
	const TAU = Math.PI * 2;
	let x = d % TAU;
	if (x > Math.PI) x -= TAU;
	if (x <= -Math.PI) x += TAU;
	return x;
};

console.log("\nspin tracking:");
for (const station of setup.stations) {
	if (station.spinRpm === 0) continue;
	await viewAlongAxis(station.id, RANGE_KM);
	const first = await slotAngle(station.id);
	if (first.missing) {
		check(
			`${station.type}: the slot is drawn`,
			false,
			"no aperture in the mesh",
		);
		continue;
	}
	// Long enough to measure, short enough that the fastest station turns well
	// under half a revolution — past π the wrap makes the direction ambiguous.
	await page.waitForTimeout(1500);
	const second = await slotAngle(station.id);

	const dt = second.gameTime - first.gameTime;
	const measured = Math.abs(wrap(second.angle - first.angle)) / dt;
	const expected = (2 * Math.PI * station.spinRpm) / 60;
	console.log(
		`  ${station.type} at ${station.spinRpm.toFixed(2)} rpm: ` +
			`${measured.toFixed(4)} rad/s measured, ${expected.toFixed(4)} expected ` +
			`over ${dt.toFixed(2)} s of game time`,
	);
	check(
		`${station.type}'s slot turns at its own ${station.spinRpm.toFixed(2)} rpm`,
		Math.abs(measured - expected) / expected < SPIN_TOLERANCE,
		`${((100 * (measured - expected)) / expected).toFixed(1)}% off`,
	);
}

const pad = setup.stations.find((s) => s.spinRpm === 0);
if (pad) {
	await viewAlongAxis(pad.id, RANGE_KM);
	const first = await slotAngle(pad.id);
	await page.waitForTimeout(1200);
	const second = await slotAngle(pad.id);
	// The refinery's pad does not rotate at all (§4), which is what removes the
	// roll match from its docking interaction. A pad that crept would make that
	// a different game without failing any headless test.
	check(
		"the refinery's pad does not turn",
		Math.abs(wrap(second.angle - first.angle)) < 0.02,
		`${Math.abs(wrap(second.angle - first.angle)).toFixed(4)} rad over ` +
			`${(second.gameTime - first.gameTime).toFixed(2)} s`,
	);
}

/**
 * The layer rule, for the whole assembly.
 *
 * `probe-handoff.mjs` owns the handoff's arithmetic — that the two scale factors
 * agree — and does it on a station. What it cannot see is that a station is no
 * longer one mesh: it is a group with an aperture and, for the shipyard, a
 * 1.5 km frame. So this asserts the *assembly* moves as one, which is the thing
 * a reparent-by-mesh implementation would get wrong.
 */
console.log("\nlayering:");
const shipyard = setup.stations.find((s) => s.type === "shipyard");
if (shipyard) {
	for (const [multiple, want] of [
		[0.4, "near"],
		[1.4, "far"],
		[0.4, "near"],
	]) {
		const state = await page.evaluate(
			async ([id, distanceKm]) => {
				const g = window.__seelite;
				const body = g.world.system.bodies.find((b) => b.id === id);
				const n = Math.hypot(body.pos.x, body.pos.y, body.pos.z);
				g.world.ship.pos = {
					x: body.pos.x * (1 + distanceKm / n),
					y: body.pos.y * (1 + distanceKm / n),
					z: body.pos.z * (1 + distanceKm / n),
				};
				g.world.ship.vel = { x: 0, y: 0, z: 0 };
				await new Promise((r) => requestAnimationFrame(() => r()));
				await new Promise((r) => requestAnimationFrame(() => r()));
				const near = g.nearScene.getObjectByName(id);
				const far = g.farScene.getObjectByName(id);
				const mesh = near ?? far;
				return {
					layer: near ? "near" : far ? "far" : "none",
					hasAperture: !!mesh?.getObjectByName("aperture"),
					hasDrydock: !!mesh?.getObjectByName("drydock"),
				};
			},
			[shipyard.id, setup.handoffKm * multiple],
		);
		check(
			`at ${multiple}× handoff the shipyard is drawn ${want}`,
			state.layer === want,
			`drawn ${state.layer}`,
		);
		check(
			`at ${multiple}× handoff the assembly moved whole`,
			state.hasAperture && state.hasDrydock,
			`aperture ${state.hasAperture}, drydock ${state.hasDrydock}`,
		);
	}
}

await browser.close();
exit();
