/**
 * Layer handoff — spec §9.10, and the one property in the suite that could not
 * be measured until there was a real system to measure it in.
 *
 *   npm run dev                        # in one shell
 *   node scripts/probe-handoff.mjs     # in another
 *
 * ## The claim
 *
 * A body crossing `HANDOFF_KM` moves between the far layer (drawn at
 * `FAR_SCALE`, position and radius both) and the near layer (drawn at 1:1
 * kilometres), and **does not pop in apparent size** when it does.
 *
 * The reason it holds is one line of arithmetic: scaling a body's position and
 * its radius by the same factor leaves `radius / distance` — the angle it
 * subtends — unchanged. The reason it is worth a probe is that the same line is
 * one edit away from being false. A mesh reparented without being rescaled, or
 * rescaled without being reparented, changes the body's on-screen size by 10⁵
 * on a single frame; nothing in the type system objects, no headless test can
 * see it, and the symptom in play is a station that vanishes or fills the
 * screen as you approach.
 *
 * ## How it is measured, and what each check can actually catch
 *
 * Not by comparing two screenshots. Two checks per sample, because the obvious
 * one is weaker than it looks:
 *
 * 1. **The two scale factors agree.** `drawnRadius / radiusKm` and
 *    `drawnDistance / trueDistance` are each the factor its layer applied, and
 *    they must be the same number. This is the handoff's actual claim, and the
 *    failure it catches is a mesh reparented without being rescaled, or
 *    rescaled without being reparented.
 *
 *    Note what it does **not** catch, because the first version of this probe
 *    asserted only `drawnRadius / drawnDistance == radiusKm / trueDistance` and
 *    claimed it caught "a scale error applied consistently in both layers". It
 *    does not: that ratio is `(radiusKm·k)/(|rel|·k)`, and `k` cancels. Measured
 *    rather than reasoned — with `FAR_SCALE` set to 1e-3, a hundred times wrong,
 *    all sixteen checks passed. The claim was simply false; splitting the ratio
 *    into its two factors is what makes the weaker, true claim checkable.
 *
 * 2. **The factor is the one the layer is supposed to use** — 1 in the near
 *    layer, `FAR_SCALE` in the far one, both read off the page.
 *
 * A `FAR_SCALE` that is simply *wrong* is caught by neither, and deliberately
 * not chased here. Both checks read the constant, and a third that did not —
 * asserting the drawn coordinate fits the float32 budget — cannot bite at these
 * distances: every sample sits within 1.05 × `HANDOFF_KM`, where even a
 * hundredfold error lands at 50 units against a budget of 10⁴. It was written,
 * measured, and removed rather than shipped as a check that cannot fail. The
 * budget is asserted where the distances are astronomical: `sim.test.ts`'s
 * "a far-layer coordinate stays inside the float32 budget", at the arrival
 * point, and the same bound in `probe-boot.mjs`. Both go red at 1e-3; this
 * probe stays green, which is the honest division of labour rather than a gap.
 *
 * The ship is **placed**, not flown. #10's cruise regime is what will eventually
 * cross these distances, and it does not exist; a probe that waited to arrive
 * under thrust at 2 km/s would take fourteen hours. Placing the ship is the same
 * write the save-load path will do, and the renderer cannot tell the difference.
 *
 * ## The subject
 *
 * A station, because a station's radius (1.2 km) is far smaller than
 * `HANDOFF_KM`, so every sample sits outside it and the geometry is
 * unambiguous. A gas giant's radius can exceed the handoff distance outright —
 * the camera is *inside* the sphere before the swap happens — which is a known
 * weak joint recorded in `units.ts` rather than something to measure here.
 */
import {
	installCamSim,
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

/**
 * Where to stand, as multiples of `HANDOFF_KM`, **in order**.
 *
 * Inward past the threshold, then back out through it. Both legs are needed and
 * the first version had only the first: walking strictly inward from a far boot
 * state takes the far→near transition and nothing else, so a `layerFor` that
 * admitted a body to the near layer and never released it would have passed
 * every check, including the one asserting both layers were seen.
 *
 * The outward leg is what pins the hysteresis band from the other side. 1.02× is
 * inside the 5% band, so a body already near must *stay* near — a renderer with
 * no hysteresis at all swaps there and fails. 1.2× is outside it, so the same
 * body must be released — a band that never releases fails there instead.
 */
const SAMPLES = [5, 1.2, 1.001, 0.999, 0.5, 0.2, 1.02, 1.2, 5];

/**
 * Tolerance on the apparent-size agreement, relative.
 *
 * 10⁻³, and it is loose on purpose: the scene graph holds float32, so a
 * far-layer coordinate of ~10³ units resolves to about 10⁻⁴ relative, and the
 * frame loop advances the clock between the write and the read so the body has
 * moved a few metres of its own. The failure this guards against is a factor of
 * 10⁵, not a factor of 1.001.
 */
const EPS = 1e-3;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();

const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const setup = await page.evaluate(() => {
	const g = window.__seelite;
	const station = g.world.system.bodies.find((b) => b.kind === "station");
	return {
		handoffKm: g.units.HANDOFF_KM,
		hysteresis: g.units.HANDOFF_HYSTERESIS,
		farScale: g.units.FAR_SCALE,
		nearFarKm: g.units.NEAR_FAR_KM,
		id: station ? station.id : null,
		radiusKm: station ? station.radiusKm : null,
		system: g.world.system.record.name,
	};
});

check(
	"the system has a station to approach",
	setup.id !== null,
	`${setup.system}: ${setup.id ?? "none"}`,
);
if (setup.id === null) {
	await browser.close();
	exit();
}
// The **band**, not the threshold. A body held in the near layer by the
// hysteresis is held out to `HANDOFF_KM × HANDOFF_HYSTERESIS`, so that product
// is what has to fit inside the near layer's reach — checking the bare
// threshold leaves room for `NEAR_FAR_KM` to land between the two, where a body
// inside the band is drawn at 1:1 past the near camera's far plane and so is
// not drawn at all. That is exactly the vanishing-between-layers failure the
// constant's docstring warns about.
check(
	"the whole hysteresis band sits inside the near layer's reach",
	setup.handoffKm * setup.hysteresis < setup.nearFarKm,
	`band reaches ${(setup.handoffKm * setup.hysteresis).toFixed(0)} km, ` +
		`near layer reaches ${setup.nearFarKm} km`,
);
console.log(
	`\napproaching ${setup.id} (r = ${setup.radiusKm} km) in ${setup.system}, ` +
		`handoff at ${setup.handoffKm} km\n`,
);

/**
 * Put the camera `distanceKm` from the station and read one drawn frame.
 *
 * Radially outward from the star, so the ship is outside the station's orbit
 * and the geometry stays the same shape at every sample.
 *
 * Two `requestAnimationFrame`s before reading, not one: the first may already
 * be in flight when the position is written, so it can compose a frame from a
 * mix of the old and new ship positions. The second is unambiguously after the
 * write. Every number is then read in a single evaluate, so the mesh and the
 * simulation position it is checked against come from the same frame.
 */
async function sampleAt(distanceKm, id) {
	return page.evaluate(
		async ([d, bodyId]) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const n = Math.hypot(body.pos.x, body.pos.y, body.pos.z);
			g.world.ship.pos = {
				x: body.pos.x * (1 + d / n),
				y: body.pos.y * (1 + d / n),
				z: body.pos.z * (1 + d / n),
			};
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			await new Promise((r) => requestAnimationFrame(() => r()));
			await new Promise((r) => requestAnimationFrame(() => r()));

			const now = g.world.system.bodies.find((b) => b.id === bodyId);
			const mesh =
				g.nearScene.getObjectByName(bodyId) ??
				g.farScene.getObjectByName(bodyId);
			const layer = g.nearScene.getObjectByName(bodyId) ? "near" : "far";
			// One shared recovery, installed by `probe-guard.mjs` as an init
			// script — read in this evaluate, so it is the same frame as the mesh.
			const camSim = window.__recoverCamSim();
			return {
				layer,
				drawnRadius: mesh ? mesh.scale.x : null,
				drawnDistance: mesh
					? Math.hypot(mesh.position.x, mesh.position.y, mesh.position.z)
					: null,
				trueDistance: Math.hypot(
					now.pos.x - camSim.x,
					now.pos.y - camSim.y,
					now.pos.z - camSim.z,
				),
				radiusKm: now.radiusKm,
			};
		},
		[distanceKm, id],
	);
}

const seen = [];
// The expected layer, walked forward the way the renderer walks it: the
// threshold a body must beat depends on the layer it is already in. Modelled
// here rather than restated as a fixed list, so both constants come off the
// page and the band is asserted in the direction each sample approaches from.
// The boot state is far — the arrival point is four orders past the handoff.
let expectedLayer = "far";
for (const multiple of SAMPLES) {
	const want = setup.handoffKm * multiple;
	const s = await sampleAt(want, setup.id);
	seen.push({ multiple, ...s });

	if (s.drawnRadius === null) {
		check(`${multiple}× handoff: the body has a mesh`, false);
		continue;
	}

	const threshold = expectedLayer === "near" ? setup.hysteresis : 1;
	expectedLayer = multiple <= threshold ? "near" : "far";
	check(
		`${multiple}× handoff: drawn in the ${expectedLayer} layer`,
		s.layer === expectedLayer,
		`${s.trueDistance.toFixed(1)} km, found in ${s.layer}`,
	);

	// (1) The two factors the layer applied — to the radius and to the position
	// — must be the same number. This is the handoff's own claim, and it holds
	// whatever that number is.
	const kRadius = s.drawnRadius / s.radiusKm;
	const kPosition = s.drawnDistance / s.trueDistance;
	check(
		`${multiple}× handoff: radius and position scaled by the same factor`,
		Math.abs(kRadius - kPosition) <= EPS * Math.max(kRadius, kPosition),
		`radius ×${kRadius.toExponential(4)}, position ×${kPosition.toExponential(4)}`,
	);

	// (2) And it must be the factor this layer is supposed to use.
	const wantK = s.layer === "near" ? 1 : setup.farScale;
	check(
		`${multiple}× handoff: the factor is the ${s.layer} layer's`,
		Math.abs(kPosition - wantK) <= EPS * wantK,
		`applied ×${kPosition.toExponential(4)}, expected ×${wantK.toExponential(4)}`,
	);
}

// The probe must actually have crossed something. Every check above passes
// vacuously against a renderer that never changes a body's layer at all — it
// would simply report the same layer each time, and the apparent-size check
// would be measuring one scale factor six times.
const layers = new Set(seen.map((s) => s.layer));
check(
	"the body really did change layers",
	layers.size === 2,
	`layers seen: ${[...layers].join(", ")}`,
);

// And the crossing is continuous: the two samples a thousandth either side of
// the threshold sit 0.2% apart in distance, so their apparent sizes must sit
// 0.2% apart too. The tolerance is 0.5% — twice the real separation rather than
// the five times an earlier 1% allowed, and the comment then claimed the
// distances differed by 5%, which was the hysteresis constant misread as a
// sample spacing. This is the "does not pop" half stated directly, rather than
// inferred from each sample matching the truth.
const outer = seen.find((s) => s.multiple === 1.001);
const inner = seen.find((s) => s.multiple === 0.999);
if (outer?.drawnRadius && inner?.drawnRadius) {
	const a = outer.drawnRadius / outer.drawnDistance;
	const b = inner.drawnRadius / inner.drawnDistance;
	check(
		"apparent size is continuous across the threshold",
		Math.abs(a - b) <= 0.005 * Math.max(a, b),
		`${a.toExponential(4)} rad outside, ${b.toExponential(4)} rad inside`,
	);
} else {
	check("both sides of the threshold were sampled", false);
}

await browser.close();
exit();
