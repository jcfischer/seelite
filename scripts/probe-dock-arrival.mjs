/**
 * `docs/specs/docking.md` §12.6's **browser rows** — the three claims about the
 * successful entry that a headless test cannot make.
 *
 * 1. The throat is drawn behind every slot-bearing form and the deck under
 *    every pad.
 * 2. The shield is legible at the mouth on approach, **and** the interior
 *    shield is drawn and visible during the arrival. The inside one is the half
 *    only a probe can catch: it exists for a few seconds, from one angle, and
 *    nothing headless can see it at all.
 * 3. A scripted approach ends **inside** the station rather than hanging at the
 *    plane — the regression the whole section exists for, and a spatial claim.
 *
 * The arithmetic — where the law puts the ship, that it terminates, that it is
 * evaluated in the rotating frame — is `tests/arrival.test.ts` and
 * `tests/dock-session.test.ts`. Nothing is restated here: every threshold this
 * file compares against is read off the page (`dockingSnapshot`), which is the
 * repo's rule, because a probe carrying its own copy of a constant goes falsely
 * red the day the module changes it.
 */

import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGE_URL = process.env.PROBE_URL ?? ORIGIN + "/?seed=1";

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.addInitScript(() => {
	window.__meshOfBody = (id) =>
		window.__seelite.nearScene.getObjectByName(id) ??
		window.__seelite.farScene.getObjectByName(id) ??
		null;
});
await page.goto(PAGE_URL, { waitUntil: "load" });
await bootedGame(page);

// ---------------------------------------------------------------------------
// The stations this system actually has
// ---------------------------------------------------------------------------

const roster = await page.evaluate(() => {
	const g = window.__seelite;
	return g.world.system.contents.stations.map((s) => {
		const snap = g.dockingSnapshot(s.id);
		return {
			id: s.id,
			type: s.type,
			kind: snap?.apertureKind ?? null,
			planeKm: snap?.planeKm ?? null,
			dockedAxialKm: snap?.dockedAxialKm ?? null,
			// The names the mesh gives its parts, so the check below asks the
			// scene what it drew rather than assuming.
			parts: (() => {
				const mesh = window.__meshOfBody(s.id);
				const found = [];
				if (mesh) mesh.traverse((o) => found.push(o.name));
				return found;
			})(),
		};
	});
});

check(
	"the system generated stations to fly at",
	roster.length > 0,
	`${roster.length}`,
);

// ---------------------------------------------------------------------------
// Row 1 — the throat is drawn behind every slot, the deck under every pad
// ---------------------------------------------------------------------------

console.log("\n§12.6 browser row 1 — the interior is drawn:");
for (const station of roster) {
	// **By `aperture.kind`, not by a list of forms** (E7). The station's own
	// kind comes off the page, so a retune that made a type a pad moves this
	// check with it.
	// A slot's throat **is** its recess (E7 extends the aperture rather than
	// standing a second box behind it), so the part to look for differs by kind.
	const want = station.kind === "slot" ? "aperture-mouth" : "aperture-deck";
	check(
		`${station.id} (${station.kind}) draws its ${want}`,
		station.parts.includes(want),
		station.parts.filter((n) => n.startsWith("aperture")).join(", "),
	);
}

/**
 * The throat's **ink**, not merely its presence in the graph.
 *
 * A mesh in the scene graph is not a mesh on the screen: it can be behind the
 * hull, scaled to nothing, or culled. So the measurement is the frame with the
 * throat and the frame without it, from the one viewpoint it is meant to be
 * seen from — down the aperture axis — and what is asserted is the difference.
 *
 * One `evaluate` for both frames, for `probe-station-visuals.mjs`'s reason: the
 * station spins and its orbit carries it, so two captures taken across separate
 * calls differ by more than the effect being measured.
 */
const interiorInk = await page.evaluate(
	(id) => {
		const g = window.__seelite;
		const W = 560;
		const H = 400;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			// Render and read in the same task: a WebGL canvas without
			// `preserveDrawingBuffer` is cleared at the next composite.
			g.render(0);
			ctx.drawImage(g.renderer.domElement, 0, 0, W, H);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const snap = g.dockingSnapshot(id);
		const body = g.world.system.byId.get(id);
		const axis = snap.axis;
		// On the axis, a few slot-widths out, looking straight in — the arriving
		// ship's own view.
		// Close in: the slot is 120 m across, so from a couple of core radii out it
		// subtends a handful of pixels and the difference this measures is smaller
		// than the anti-aliasing on its own edge. One aperture-width off the face
		// puts the mouth across a good part of the frame.
		const rangeKm = snap.planeKm + snap.apertureWidthKm;
		g.world.ship.pos = {
			x: body.pos.x + axis.x * rangeKm,
			y: body.pos.y + axis.y * rangeKm,
			z: body.pos.z + axis.z * rangeKm,
		};
		g.world.ship.vel = { x: 0, y: 0, z: 0 };
		g.setAttitude(
			{ x: -axis.x, y: -axis.y, z: -axis.z },
			{ x: snap.basis.up.x, y: snap.basis.up.y, z: snap.basis.up.z },
		);

		const mesh = window.__meshOfBody(id);
		const interior = [];
		mesh.traverse((o) => {
			if (o.name === "aperture-mouth" || o.name === "aperture-deck")
				interior.push(o);
		});
		const drawn = frame();
		for (const o of interior) o.visible = false;
		const without = frame();
		for (const o of interior) o.visible = true;

		let changed = 0;
		for (let i = 0; i < drawn.length; i += 4) {
			if (
				Math.abs(drawn[i] - without[i]) +
					Math.abs(drawn[i + 1] - without[i + 1]) +
					Math.abs(drawn[i + 2] - without[i + 2]) >
				12
			)
				changed++;
		}
		return { changed, parts: interior.length, rangeKm };
	},
	roster.find((s) => s.kind === "slot")?.id ?? roster[0].id,
);

check(
	"the interior contributes pixels on the axis view",
	interiorInk.parts > 0 && interiorInk.changed > 200,
	`${interiorInk.changed} pixels change when ${interiorInk.parts} interior part(s) are hidden, ` +
		`from ${interiorInk.rangeKm.toFixed(2)} km on the axis`,
);

// ---------------------------------------------------------------------------
// Row 3 — a scripted approach ends inside the station
// ---------------------------------------------------------------------------
//
// Taken before row 2's arrival half, because that half needs a dock in flight.

console.log("\n§12.6 browser row 3 — the approach ends inside:");

/**
 * Fly an entry at the given station and step until the dock settles.
 *
 * **Flown by §7's docking computer, which is what "a scripted approach" means
 * in §12.6's row 3.** A hand-set attitude cannot work here and that is a fact
 * about the station rather than about the probe: the slot turns at up to 3 rpm,
 * so over the ten-odd seconds an approach takes it rolls through more than half
 * a turn — an attitude set once at the start is 234° out by the crossing and
 * fails check 4 by a mile. The computer tracks the roll, which is what a pilot
 * does and what `dockingComputerStep` exists for.
 */
const dock = (id) =>
	page.evaluate((stationId) => {
		const g = window.__seelite;
		const snap = g.dockingSnapshot(stationId);
		const body = g.world.system.byId.get(stationId);
		const axis = snap.axis;
		// Outside the computer's own standoff, on the axis, at rest in the
		// station's frame — from there the whole approach is the autopilot's.
		const standoff = g.dockingTolerances.COMPUTER_STANDOFF_KM ?? 3;
		g.world.ship.pos = {
			x: body.pos.x + axis.x * (snap.planeKm + standoff * 1.5),
			y: body.pos.y + axis.y * (snap.planeKm + standoff * 1.5),
			z: body.pos.z + axis.z * (snap.planeKm + standoff * 1.5),
		};
		g.world.ship.vel = { ...g.stationVelocity(stationId) };
		g.regime = "normal";
		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		g.setThrottle(0);
		g.setAttitude({ x: -axis.x, y: -axis.y, z: -axis.z }, snap.basis.up);
		// §6: clearance is a precondition, not a check. Without a live grant this
		// is a barge and the entry fails whatever the geometry says.
		//
		// **Select the station first.** `requestDockingClearance` answers for the
		// *selected* target when there is one — §6's "when a station is the
		// selected target" — and falls back to the nearest only when there is
		// not. With another station selected the grant lands on that one and the
		// computer refuses this approach with `no-clearance`, which is the
		// protocol working rather than the probe's placement failing.
		g.targetId = stationId;
		g.requestDockingClearance();
		if (!g.dockingComputerEngaged) g.toggleDockingComputer();

		const dt = 1 / 60;
		const phases = [];
		let arrivingAtS = null;
		let elapsed = 0;
		for (let i = 0; i < 60 * 120; i++) {
			g.step(dt);
			elapsed += dt;
			const now = g.dockingSnapshot(stationId);
			if (!phases.includes(now.dockPhase)) phases.push(now.dockPhase);
			if (arrivingAtS === null && now.dockPhase === "arriving")
				arrivingAtS = elapsed;
			if (now.dockPhase === "docked") break;
		}
		const end = g.dockingSnapshot(stationId);
		return {
			phases,
			arrivingAtS,
			axialKm: end.axialKm,
			planeKm: end.planeKm,
			dockedAxialKm: end.dockedAxialKm,
			phase: end.dockPhase,
			lastEntryDocked: end.lastEntry?.docked ?? null,
			// Named, so a failed entry says *which* check refused it rather than
			// leaving the reader to guess.
			failed: end.lastEntry?.evaluation
				? Object.entries(end.lastEntry.evaluation.checks ?? {})
						.filter(([, ok]) => ok === false)
						.map(([name]) => name)
				: [],
			refusal: g.dockingSnapshot(stationId).computerRefusal ?? null,
		};
	}, id);

const slotId = roster.find((s) => s.kind === "slot")?.id ?? roster[0].id;
/** E3's duration, read off the page rather than restated. */
const arrivalSeconds = await page.evaluate(
	() => window.__seelite.dockingTolerances.ARRIVAL_SECONDS,
);
const flown = await dock(slotId);

check(
	"a scripted approach docks",
	flown.phase === "docked",
	`phases ${flown.phases.join(" → ")}, last entry docked=${flown.lastEntryDocked}` +
		`${flown.failed.length ? `, failed ${flown.failed.join(", ")}` : ""}` +
		`${flown.refusal ? `, computer refused: ${flown.refusal}` : ""}`,
);
check(
	// **E2**: the crossing hands the ship over, and the arrival is a state of
	// its own rather than an instant. A build that set `docked` at the plane
	// would never show `arriving` here.
	"the crossing hands over to an arrival before it parks",
	flown.phases.join(",") === "flying,arriving,docked",
	flown.phases.join(" → "),
);
check(
	// The regression this section exists for: *"ship does not fly into Coriolis
	// station but hovers just over rotating dock"*. The old behaviour left the
	// ship at the crossing point, which is the plane itself.
	"the ship ends inside the station, not at the plane",
	flown.axialKm < flown.planeKm - (flown.planeKm - flown.dockedAxialKm) * 0.99,
	`parked at ${flown.axialKm.toFixed(4)} km against a ${flown.planeKm.toFixed(3)} km plane, ` +
		`docked position ${flown.dockedAxialKm.toFixed(4)} km`,
);
check(
	"and it ends where §12.2 puts it, to within a metre",
	Math.abs(flown.axialKm - flown.dockedAxialKm) < 0.001,
	`${(Math.abs(flown.axialKm - flown.dockedAxialKm) * 1000).toFixed(2)} m off`,
);

// ---------------------------------------------------------------------------
// Row 2 — the shields, at the mouth and inside the throat
// ---------------------------------------------------------------------------

console.log("\n§12.6 browser row 2 — the name shield is drawn:");

/**
 * The shield's ink at one viewpoint: the frame with the plates and the frame
 * without them, in one task for the reason row 1 gives.
 */
const shieldInk = (id) =>
	page.evaluate((stationId) => {
		const g = window.__seelite;
		const W = 560;
		const H = 400;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			g.render(0);
			ctx.drawImage(g.renderer.domElement, 0, 0, W, H);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const drawn = frame();
		const plates = g.setNameplatesVisible(stationId, false);
		const without = frame();
		g.setNameplatesVisible(stationId, true);
		let changed = 0;
		for (let i = 0; i < drawn.length; i += 4) {
			if (
				Math.abs(drawn[i] - without[i]) +
					Math.abs(drawn[i + 1] - without[i + 1]) +
					Math.abs(drawn[i + 2] - without[i + 2]) >
				12
			)
				changed++;
		}
		return { changed, plates };
	}, id);

// The ship is parked in the throat from row 3, so the approach view has to be
// set up again — deliberately, and after the dock rather than before: putting
// the ship back outside would leave the session docked while the ship is
// kilometres away, which is not a state §12 creates.
const approach = await page.evaluate((stationId) => {
	const g = window.__seelite;
	// Out of the dock first, the way the game leaves one.
	g.launch();
	g.skipDockTraversal();
	for (let i = 0; i < 30; i++) g.step(1 / 60);
	const snap = g.dockingSnapshot(stationId);
	const body = g.world.system.byId.get(stationId);
	const axis = snap.axis;
	const rangeKm = snap.planeKm * 3;
	g.world.ship.pos = {
		x: body.pos.x + axis.x * rangeKm,
		y: body.pos.y + axis.y * rangeKm,
		z: body.pos.z + axis.z * rangeKm,
	};
	g.world.ship.vel = { x: 0, y: 0, z: 0 };
	g.setAttitude({ x: -axis.x, y: -axis.y, z: -axis.z }, snap.basis.up);
	return { phase: g.dockingSnapshot(stationId).dockPhase, rangeKm };
}, slotId);

check(
	"the launch released the ship back into flight",
	approach.phase === "flying",
	approach.phase,
);

const mouth = await shieldInk(slotId);
check(
	"the shield at the mouth is drawn on approach",
	mouth.plates > 0 && mouth.changed > 40,
	`${mouth.changed} pixels from ${mouth.plates} plate(s) at ${approach.rangeKm.toFixed(2)} km`,
);

// The interior shield: measured **during** the arrival, which is the only time
// it can be seen at all. A dock is flown again and stopped mid-traversal.
const midArrival = await page.evaluate(
	async ([stationId, arrivalSeconds]) => {
		const g = window.__seelite;
		const snap = g.dockingSnapshot(stationId);
		const body = g.world.system.byId.get(stationId);
		const axis = snap.axis;
		const standoff = 4.5;
		g.world.ship.pos = {
			x: body.pos.x + axis.x * (snap.planeKm + standoff),
			y: body.pos.y + axis.y * (snap.planeKm + standoff),
			z: body.pos.z + axis.z * (snap.planeKm + standoff),
		};
		g.world.ship.vel = { ...g.stationVelocity(stationId) };
		g.regime = "normal";
		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		g.setThrottle(0);
		g.setAttitude({ x: -axis.x, y: -axis.y, z: -axis.z }, snap.basis.up);
		g.targetId = stationId;
		g.requestDockingClearance();
		if (!g.dockingComputerEngaged) g.toggleDockingComputer();
		for (let i = 0; i < 60 * 120; i++) {
			g.step(1 / 60);
			if (g.dockingSnapshot(stationId).dockPhase === "arriving") break;
		}
		// **Half way down the throat.** The duration comes off the page, so this
		// lands mid-traversal whatever E3's value is retuned to — far enough in
		// that the mouth plate is behind the camera and the end wall's is ahead
		// of it.
		for (let i = 0; i < Math.floor(60 * arrivalSeconds * 0.9); i++)
			g.step(1 / 60);
		const now = g.dockingSnapshot(stationId);
		return { phase: now.dockPhase, axialKm: now.axialKm, planeKm: now.planeKm };
	},
	[slotId, arrivalSeconds],
);

check(
	"the probe is inside the throat, mid-arrival",
	midArrival.phase === "arriving" && midArrival.axialKm < midArrival.planeKm,
	`${midArrival.phase} at ${midArrival.axialKm.toFixed(4)} km inside a ${midArrival.planeKm.toFixed(3)} km plane`,
);

const inside = await shieldInk(slotId);
check(
	// The half only a probe can catch: it exists for a few seconds, from one
	// angle, and nothing headless can see it at all.
	"the interior shield is visible during the arrival",
	inside.plates > 0 && inside.changed > 40,
	`${inside.changed} pixels from ${inside.plates} plate(s)`,
);

await browser.close();
exit();
