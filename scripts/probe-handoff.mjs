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
 * ## How it is measured
 *
 * Not by comparing two screenshots. Apparent size is `drawnRadius /
 * drawnDistance` in whatever units the body's layer draws in, and the assertion
 * is that this equals `radiusKm / trueDistanceKm` — the real angle, computed in
 * float64 from the simulation — at every sampled distance, on both sides of the
 * threshold. That is stronger than "the two frames either side look alike": it
 * catches a scale error that happens to be applied consistently in both layers,
 * which a difference test would wave through.
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
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

/**
 * Where to stand, as multiples of `HANDOFF_KM`.
 *
 * Two clear of the threshold on each side and two within a percent of it. The
 * tight pair is the point: a handoff implemented with the wrong sign, or with a
 * hysteresis band that never releases, still looks correct at 5× and 0.2×.
 */
const SAMPLES = [5, 1.2, 1.001, 0.999, 0.5, 0.2];

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

let failures = 0;
let checks = 0;
const check = (label, ok, detail) => {
	checks++;
	if (!ok) failures++;
	console.log(
		`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
	);
};

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on("pageerror", (e) => {
	failures++;
	console.log(`PAGEERROR ${e.message}`);
});
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const setup = await page.evaluate(() => {
	const g = window.__seelite;
	const station = g.world.system.bodies.find((b) => b.kind === "station");
	return {
		handoffKm: g.units.HANDOFF_KM,
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
	console.log(`\n${checks - failures}/${checks} checks passed`);
	process.exit(1);
}
check(
	"the handoff sits inside the near layer's reach",
	setup.handoffKm < setup.nearFarKm,
	`handoff ${setup.handoffKm} km, near layer reaches ${setup.nearFarKm} km`,
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
			// The camera's sim position, recovered the way probe-boot recovers it:
			// from the ship mesh, which is drawn at `shipSim - camSim`. Reading a
			// private field would be asserting on an accessor the probe invented.
			const shipMesh = g.nearScene.getObjectByName("ship");
			const camSim = {
				x: g.world.ship.pos.x - shipMesh.position.x,
				y: g.world.ship.pos.y - shipMesh.position.y,
				z: g.world.ship.pos.z - shipMesh.position.z,
			};
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
for (const multiple of SAMPLES) {
	const want = setup.handoffKm * multiple;
	const s = await sampleAt(want, setup.id);
	seen.push({ multiple, ...s });

	if (s.drawnRadius === null) {
		check(`${multiple}× handoff: the body has a mesh`, false);
		continue;
	}

	// The layer the rule asks for. A body already in the near layer is held
	// there by the hysteresis band until 5% past the threshold, so the samples
	// are ordered outward-to-inward and only the unambiguous ones are asserted:
	// 1.001× is approached from outside and so is still far, 0.999× is the first
	// sample inside and so is near.
	const wantLayer = multiple < 1 ? "near" : "far";
	check(
		`${multiple}× handoff: drawn in the ${wantLayer} layer`,
		s.layer === wantLayer,
		`${s.trueDistance.toFixed(1)} km, found in ${s.layer}`,
	);

	// The claim itself. `radius / distance` is the small-angle form of the angle
	// the body subtends, and it must not care which layer drew it.
	const drawn = s.drawnRadius / s.drawnDistance;
	const real = s.radiusKm / s.trueDistance;
	check(
		`${multiple}× handoff: apparent size is the true one`,
		Math.abs(drawn - real) <= EPS * real,
		`drawn ${drawn.toExponential(4)} rad, true ${real.toExponential(4)} rad`,
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
// the threshold must agree on apparent size to far better than the 5% their
// distances differ by. This is the "does not pop" half stated directly, rather
// than inferred from each sample matching the truth.
const outer = seen.find((s) => s.multiple === 1.001);
const inner = seen.find((s) => s.multiple === 0.999);
if (outer?.drawnRadius && inner?.drawnRadius) {
	const a = outer.drawnRadius / outer.drawnDistance;
	const b = inner.drawnRadius / inner.drawnDistance;
	check(
		"apparent size is continuous across the threshold",
		Math.abs(a - b) <= 0.01 * Math.max(a, b),
		`${a.toExponential(4)} rad outside, ${b.toExponential(4)} rad inside`,
	);
} else {
	check("both sides of the threshold were sampled", false);
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
