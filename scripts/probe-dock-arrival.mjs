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
 * `tests/dock-session.test.ts`.
 *
 * **Every quantity the game owns is read off the page** (`dockingSnapshot`,
 * `dockingTolerances`), which is the repo's rule: a probe carrying its own copy
 * of a constant goes falsely red the day the module changes it. The pixel
 * counts and the standoffs below are **not** that — they are this file's own
 * thresholds, measured against the frames it captures, and they are written out
 * rather than derived because nothing in the game owns them. An earlier version
 * of this paragraph claimed nothing was restated at all, which was false of its
 * own next thirty lines.
 *
 * And nothing here falls open. A page constant is read without a fallback: `??`
 * on a missing tolerance substitutes a plausible number and turns a rename into
 * a green run, which is the exact failure the read-it-off-the-page rule exists
 * to prevent.
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

/**
 * This file's own thresholds — **not** the game's, and named here so the three
 * places that used to spell them inline cannot drift apart.
 *
 * `PROBE_STANDOFF_KM` is where a run starts an approach from: outside §7's
 * three-kilometre computer standoff, so the whole approach is the autopilot's.
 * The two ink floors are what a drawn thing has to contribute for the frame to
 * say it is there; both are far under what a passing run measures — the
 * interior reads a few hundred pixels against a floor of 200, and each shield
 * a thousand or more against 40 — and far over the handful the anti-aliasing on
 * one edge moves.
 */
const PROBE_STANDOFF_KM = 4.5;
const INTERIOR_INK_FLOOR = 200;
const SHIELD_INK_FLOOR = 40;

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

	/**
	 * How many pixels a thing contributes: the frame with it, the frame without
	 * it, and the count of what changed.
	 *
	 * One helper because both measurements in this file are the same twenty-five
	 * lines, and a retune of the capture size or the per-pixel threshold has to
	 * land on both or on neither. `hide` is called between the two captures and
	 * `restore` after, so the caller says *what* is being measured and nothing
	 * else.
	 *
	 * **Both frames in one task**, for `probe-station-visuals.mjs`'s reason: the
	 * station spins and its orbit carries it, so two captures taken across
	 * separate calls differ by more than the effect being measured.
	 */
	window.__inkDelta = (hide, restore) => {
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
		const drawn = frame();
		const hidden = hide();
		const without = frame();
		restore();
		let changed = 0;
		for (let i = 0; i < drawn.length; i += 4) {
			// Summed across the channels, against a threshold that ignores the
			// last bit of tone mapping without ignoring a drawn edge.
			if (
				Math.abs(drawn[i] - without[i]) +
					Math.abs(drawn[i + 1] - without[i + 1]) +
					Math.abs(drawn[i + 2] - without[i + 2]) >
				12
			)
				changed++;
		}
		return { changed, hidden };
	};

	/**
	 * Place the ship on a station's aperture axis at `rangeKm`, at rest in the
	 * station's frame, aimed down the axis — and, when asked, with clearance
	 * granted and §7's computer flying.
	 *
	 * One helper because three runs in this file need exactly this, and three
	 * copies drift the day the clearance protocol changes. **Selecting the
	 * station is part of it**: `requestDockingClearance` answers for the
	 * *selected* target when there is one, so without this the grant can land on
	 * a different station and the computer refuses with `no-clearance`.
	 */
	window.__placeOnAxis = (id, rangeKm, engage) => {
		const g = window.__seelite;
		const snap = g.dockingSnapshot(id);
		const body = g.world.system.byId.get(id);
		const a = snap.axis;
		g.world.ship.pos = {
			x: body.pos.x + a.x * rangeKm,
			y: body.pos.y + a.y * rangeKm,
			z: body.pos.z + a.z * rangeKm,
		};
		g.world.ship.vel = { ...g.stationVelocity(id) };
		g.regime = "normal";
		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		g.setThrottle(0);
		g.setAttitude({ x: -a.x, y: -a.y, z: -a.z }, snap.basis.up);
		if (!engage) return snap;
		g.targetId = id;
		g.requestDockingClearance();
		if (!g.dockingComputerEngaged) g.toggleDockingComputer();
		return snap;
	};
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

/**
 * The station the throat rows are measured on.
 *
 * **No fallback to a pad.** `?? roster[0].id` was the first spelling and it is
 * exactly the failure this file's header refuses: with no slot in the system
 * the throat ink row, row 3 and the interior-shield row would every one of them
 * measure a *pad* and still report green. A system with no slot station is a
 * generator change, not a run to paper over.
 */
const slotId = roster.find((s) => s.kind === "slot")?.id;
check(
	"the system has a slot station to fly a throat at",
	slotId !== undefined,
	roster.map((s) => `${s.id}:${s.kind}`).join(", "),
);
if (slotId === undefined) {
	await browser.close();
	exit();
}

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
const interiorInk = await page.evaluate((id) => {
	const g = window.__seelite;
	const snap = g.dockingSnapshot(id);
	// Close in: the slot is 120 m across, so from a couple of core radii out it
	// subtends a handful of pixels and the difference this measures is smaller
	// than the anti-aliasing on its own edge. One aperture-width off the face
	// puts the mouth across a good part of the frame — on the axis, looking
	// straight in, which is the arriving ship's own view.
	const rangeKm = snap.planeKm + snap.apertureWidthKm;
	window.__placeOnAxis(id, rangeKm, false);
	const mesh = window.__meshOfBody(id);
	const interior = [];
	mesh.traverse((o) => {
		if (o.name === "aperture-mouth" || o.name === "aperture-deck")
			interior.push(o);
	});
	const { changed } = window.__inkDelta(
		() => {
			for (const o of interior) o.visible = false;
		},
		() => {
			for (const o of interior) o.visible = true;
		},
	);
	return { changed, parts: interior.length, rangeKm };
}, slotId);

check(
	"the interior contributes pixels on the axis view",
	interiorInk.parts > 0 && interiorInk.changed > INTERIOR_INK_FLOOR,
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
	page.evaluate(
		([stationId, standoffKm]) => {
			const g = window.__seelite;
			// Outside §7's computer standoff, on the axis, at rest in the station's
			// frame, with clearance granted and the autopilot flying — all of which
			// is `__placeOnAxis`, because three runs in this file need exactly it.
			window.__placeOnAxis(
				stationId,
				g.dockingSnapshot(stationId).planeKm + standoffKm,
				true,
			);

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
				refusal: end.computerRefusal ?? null,
			};
		},
		[id, PROBE_STANDOFF_KM],
	);

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
		let plates = 0;
		const { changed } = window.__inkDelta(
			() => {
				plates = g.setNameplatesVisible(stationId, false);
			},
			() => g.setNameplatesVisible(stationId, true),
		);
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
	const rangeKm = g.dockingSnapshot(stationId).planeKm * 3;
	window.__placeOnAxis(stationId, rangeKm, false);
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
	mouth.plates > 0 && mouth.changed > SHIELD_INK_FLOOR,
	`${mouth.changed} pixels from ${mouth.plates} plate(s) at ${approach.rangeKm.toFixed(2)} km`,
);

// The interior shield: measured **during** the arrival, which is the only time
// it can be seen at all. A dock is flown again and stopped mid-traversal.
const midArrival = await page.evaluate(
	async ([stationId, arrivalSeconds, standoffKm]) => {
		const g = window.__seelite;
		window.__placeOnAxis(
			stationId,
			g.dockingSnapshot(stationId).planeKm + standoffKm,
			true,
		);
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
	[slotId, arrivalSeconds, PROBE_STANDOFF_KM],
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
	// **At this clock, and the name says so.** The plaque sits on the mesh's own
	// axes while the ship's roll is not tied to them (§12.7's joint 8), so which
	// part of the end wall faces the pilot is a function of the slot's phase —
	// the long-dock section below advances ten minutes and the same view then
	// reads zero. This row is evidence that the interior shield is drawn and
	// reachable; E11's claim that it is visible *throughout* an arrival is owed a
	// check that joint 8 has to close first.
	"the interior shield is visible during the arrival at this clock",
	inside.plates > 0 && inside.changed > SHIELD_INK_FLOOR,
	`${inside.changed} pixels from ${inside.plates} plate(s)`,
);

// ---------------------------------------------------------------------------
// The clock drives §6 while docked, too
// ---------------------------------------------------------------------------
//
// Not one of §12.6's rows, and it is here because it is only reachable from a
// docked ship. §12's three states return from `step` before the flight tail,
// and the first build of that branch left the §6 protocol tick behind with it —
// so a ship that sat docked kept a grant that never expired while #10's clock
// ran the whole time. Obligation 4 says the world keeps running; this is what
// that means for the one subsystem a docked ship still has.

// **Last, and that ordering is a finding rather than housekeeping.** Run before
// the shield rows, its ten minutes of game time moved the slot's phase and the
// interior shield then measured **zero** from the same view at the same axial
// distance. The plaque is mounted on the mesh's own axes and the ship's roll is
// not tied to them — §12.7's joint 8 — so which part of the end wall is in
// front of the pilot depends on the phase the station happens to be at. Until
// that joint is closed, a view of the interior shield is only reproducible at a
// clock this file has not advanced.

console.log("\nthe clearance protocol runs while docked:");
const grant = await page.evaluate((stationId) => {
	const g = window.__seelite;
	const before = g.dockingSnapshot(stationId);
	// The expiry off the page, not a restated `GRANT_WINDOW_S`.
	const expiresAtS =
		before.clearance.kind === "granted" ? before.clearance.expiresAtS : null;
	if (expiresAtS === null)
		return { phase: before.dockPhase, expiresAtS, live: null, after: null };
	// A tenth of a second a step, so a ten-minute window is six thousand of
	// them rather than thirty-six thousand. Nothing here is measuring a frame.
	const dt = 0.1;
	while (g.world.gameTime <= expiresAtS + 1) g.step(dt);
	const after = g.dockingSnapshot(stationId);
	return {
		phase: after.dockPhase,
		expiresAtS,
		live: after.grantLive,
		after: g.world.gameTime,
	};
}, slotId);

check(
	"the ship is still docked across the whole interval",
	grant.phase === "docked",
	`${grant.phase} at t+${grant.after?.toFixed(0) ?? "?"}`,
);
check(
	"and its grant expired on the clock rather than outliving the dock",
	grant.expiresAtS !== null && grant.live === false,
	`grant expired at ${grant.expiresAtS?.toFixed(0) ?? "none"}, live=${grant.live}`,
);

await browser.close();
exit();
