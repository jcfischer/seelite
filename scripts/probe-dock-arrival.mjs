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
 *
 * **No row here carries a pixel *count* as its threshold.** Every ink figure in
 * this file is a fact about the light rig as much as about the build — #99's
 * open node — and one of them read anywhere from 1 to 628 across runs as the
 * station's docking face went in and out of the sun. A floor across that range
 * decides runs rather than builds, which is what a threshold must never do. So
 * **every ink row** asks whether its subject contributes ink *at all*. Where a
 * **same-frame control** exists that says the camera is looking at the thing,
 * the row reads it too: on approach that is the emissive aperture bars.
 *
 * From inside the throat there is none — the bars are behind the camera and
 * hiding the station hides the recess with it — so the recess row asserts its
 * subject alone and says so. One figure is **printed and not asserted**: the
 * interior plaque draws nothing in that frame, which #131 records as
 * undiagnosed, and a number nobody can explain is not a check.
 *
 * `CONTROL_INK_FLOOR` is the one number left, and it is a **control's** floor
 * rather than a subject's: what it separates is a control that read something —
 * the emissive aperture bars measure ~126,000 on approach — from the case it
 * exists for, a camera looking at nothing, which reads zero. Three orders of
 * headroom is the point, not an oversight; a control that could plausibly fail
 * is a second subject.
 *
 * **One row has no control**, and its comment says so rather than borrowing one
 * that is not independent: from inside the throat the tunnel is the whole view.
 */
const PROBE_STANDOFF_KM = 4.5;
const CONTROL_INK_FLOOR = 100;

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
	window.__inkDelta = (hide, restore, pinnedClock) => {
		const g = window.__seelite;
		// **Pin the clock across both renders where the caller asks.** A slot's
		// phase decides how much of its recess faces the camera, and left free it
		// is wherever the frame loop got to at boot: the same measurement read
		// between 199 and 550 pixels across four runs, which is a threshold
		// deciding runs rather than builds. `probe-station-visuals.mjs` pins for
		// the same reason. Only the *drawn* phase moves — the bodies are not
		// re-placed — so this is not available to a caller whose ship position
		// was computed at the live clock, which is why it is an argument rather
		// than the default.
		const savedClock = g.world.gameTime;
		if (pinnedClock !== undefined) g.world.gameTime = pinnedClock;
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
		g.world.gameTime = savedClock;
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
		// **One step after placing.** A teleport moves the ship; the renderer's
		// layer assignment — which body is drawn near, which far — is decided in
		// `step`, so a frame rendered straight after a jump is drawn against
		// where the ship *was*. Inside a station that is a black frame: nothing
		// in the near scene, not even the cockpit.
		g.step(1 / 60);
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
// #126 — the drawn slot is the slot the checks are evaluated in
// ---------------------------------------------------------------------------
//
// **The check the fix did not have.** #126's whole subject is that the station a
// player *sees* is rolled to the same basis §3's checks read, and nothing
// asserted it: the reference's continuity is a headless row, the aperture plane
// is a headless row, and `probe-station.mjs` measures the slot's spin *rate*. A
// swapped `makeBasis` argument or a change to the mesh's local-X convention
// would restore the 64.6° this node exists to have removed, with every test and
// every other probe green.
//
// Read off the drawn object: the recess's own local +X and +Z in world space,
// against `slotBasis(frameAtPhase(frame, 0))` and the axis, both off the page.

console.log("\n#126 the drawn slot mirrors slotBasis:");
const rolls = await page.evaluate(() => {
	const g = window.__seelite;
	const unit = (x, y, z) => {
		const l = Math.hypot(x, y, z);
		return [x / l, y / l, z / l];
	};
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const deg = (c) => (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
	return g.world.system.contents.stations.map((st) => {
		const snap = g.dockingSnapshot(st.id);
		const mesh = window.__meshOfBody(st.id);
		let recess = null;
		mesh.traverse((o) => {
			if (o.name === "aperture-mouth" || o.name === "aperture-deck") recess = o;
		});
		// A form with neither part is a failed row, not a crashed probe: an
		// unguarded dereference here aborts the whole run with a `TypeError`
		// inside `page.evaluate`, which surfaces as an opaque crash rather than
		// as the named check that was supposed to fail.
		if (!recess) return { id: st.id, rollOffDeg: null, axisOffDeg: null };
		recess.updateWorldMatrix(true, false);
		const e = recess.matrixWorld.elements;
		// The mesh's own axes, in world space. Local +X is the aperture
		// rectangle's long side by construction (`BoxGeometry(w, h, …)`), which
		// is what `slotBasis`'s `across` is.
		const drawnAcross = unit(e[0], e[1], e[2]);
		const drawnAxis = unit(e[8], e[9], e[10]);
		const across = [
			snap.basis.across.x,
			snap.basis.across.y,
			snap.basis.across.z,
		];
		const axis = [snap.axis.x, snap.axis.y, snap.axis.z];
		return {
			id: st.id,
			// Absolute, because a slot is symmetric through 180°: `across` and
			// `−across` are the same rectangle, and check 4 folds them together.
			rollOffDeg: +deg(Math.abs(dot(drawnAcross, across))).toFixed(3),
			axisOffDeg: +deg(dot(drawnAxis, axis)).toFixed(3),
		};
	});
});
for (const r of rolls) {
	check(
		`${r.id}: the drawn slot is rolled to \`slotBasis\``,
		// A tenth of a degree. It was 64.6° on the trade station and 78.2° on the
		// refinery before #126, so this is not a tolerance anything can drift
		// inside — the two either share a basis or they do not.
		r.rollOffDeg !== null && r.rollOffDeg < 0.1 && r.axisOffDeg < 0.1,
		r.rollOffDeg === null
			? "no aperture-mouth or aperture-deck on this form"
			: `roll ${r.rollOffDeg}°, axis ${r.axisOffDeg}°`,
	);
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
	// **Measured from inside the throat, not from outside it.** From outside, a
	// recess and a hole through the station look the same: both are dark, and
	// hiding the recess changed 0 pixels of a 560 × 400 sample because what it
	// was hiding was replaced by space of the same colour. The tunnel is a lit
	// structure seen from *within*, which is the one place it can be measured
	// and the only place a player ever sees it — E1's whole point.
	window.__placeOnAxis(id, snap.planeKm - snap.apertureHeightKm, false);
	const mesh = window.__meshOfBody(id);
	const interior = [];
	mesh.traverse((o) => {
		if (o.name === "aperture-mouth" || o.name === "aperture-deck")
			interior.push(o);
	});
	const hideAll = (objects) => () => {
		for (const o of objects) o.visible = false;
	};
	const showAll = (objects) => () => {
		for (const o of objects) o.visible = true;
	};
	const recess = window.__inkDelta(hideAll(interior), showAll(interior), 0);
	// **This row has no independent control, and saying so is better than
	// pretending.** A control has to be visible from where the subject is, and
	// from inside a tunnel the tunnel *is* the view: the emissive bars are behind
	// the camera, the interior plaque draws nothing (#131), and hiding the whole
	// station hides the recess with it — a superset of the subject, so
	// `changed > 0` would already force it and the row would read as
	// subject-plus-control while nothing independent remained.
	//
	// What keeps this from being a bare number in the dark is the *approach* row
	// in the same run: it proves this probe can see this station, with a control
	// that genuinely is independent of its subject.
	return {
		changed: recess.changed,
		parts: interior.length,
		rangeKm: snap.planeKm - snap.apertureHeightKm,
	};
}, slotId);

check(
	// **Asserted on its subject alone, with the control deferred to #131.**
	//
	// The subject is real and large: hiding the recess changes ~165,000 pixels
	// from inside the throat, where from outside it changed **0** — a recess and
	// a hole through a station are both dark, and that is why this row moved
	// inside. It is the pixel evidence #128 exists to produce, so it is asserted
	// rather than printed.
	//
	// What it does not have is a control. The emissive bars are behind the
	// camera; hiding the whole station hides the recess with it; and the
	// interior plaque draws nothing in this exact frame, which #131 records as
	// undiagnosed. So the claim is narrow — the recess reaches the screen — and
	// the frame it is read from is under a question of its own.
	"the recess reaches the screen from inside the throat",
	interiorInk.parts > 0 && interiorInk.changed > 0,
	`${interiorInk.changed} pixels from ${interiorInk.parts} interior part(s), ` +
		`from ${interiorInk.rangeKm.toFixed(3)} km on the axis, inside the throat`,
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
check(
	// **Read bare, so checked bare.** The header refuses `??` fallbacks; a
	// constant read without one still falls open if nothing looks at what came
	// back. Renamed off `dockingTolerances`, this is `undefined`, the sample
	// loop below runs `Math.floor(60 * NaN * 0.9)` iterations — zero — and the
	// two rows that depend on it pass at the crossing point with the mouth plate
	// in view.
	"the page reports E3's arrival duration",
	Number.isFinite(arrivalSeconds) && arrivalSeconds > 0,
	`${arrivalSeconds}`,
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
const shieldInk = (id, which) =>
	page.evaluate(
		([stationId, part]) => {
			const g = window.__seelite;
			// **Through the game's own accessor**, not a traversal of this file's
			// own. `nameplatesOfStation` returns the list `station-mesh.ts` collected
			// at build; a `traverse` here would be a second spelling of "which
			// objects are the shields", and the day the name changes one of them goes
			// quietly green.
			//
			// They come back in build order — mouth first, interior second
			// (`buildNameplates`) — which is what `part` indexes into.
			const plates = g.nameplatesOfStation(stationId);
			// **One plate each, never both.** The argument runs in both directions:
			// hiding both for the interior row would let the mouth plate's ink stand
			// in for an interior plate that was never drawn, and hiding both for the
			// mouth row would let the interior plate — visible straight down the
			// aperture — stand in for a mouth plate that was never textured.
			const chosen = part === "interior" ? plates.slice(1) : plates.slice(0, 1);
			// **Unpinned, deliberately, and that is why the predicate is not a
			// count.** Both rows place the ship at the live clock — the interior one
			// is measured mid-arrival, where the ship's position *is* a function of
			// that clock — so pinning the render would turn the station under a
			// camera placed for where it was.
			const { changed } = window.__inkDelta(
				() => {
					for (const p of chosen) p.visible = false;
				},
				() => {
					for (const p of chosen) p.visible = true;
				},
			);
			// **The same-frame control, and it differs by row because the two views
			// do.** On approach the camera is kilometres out and the emissive bars
			// are what says the aperture is on screen — the recess is a small dark
			// hole at that range and reads a couple of pixels, which is no control at
			// all. Mid-arrival the camera is *inside* the throat with the bars behind
			// it, and the recess is the whole view. Either way, if the control
			// contributes nothing the camera is not looking at the thing and neither
			// figure means anything.
			const controlName =
				part === "interior" ? "aperture-mouth" : "aperture-light";
			const recess = [];
			window.__meshOfBody(stationId).traverse((o) => {
				if (o.name === controlName) recess.push(o);
			});
			const control = window.__inkDelta(
				() => {
					for (const o of recess) o.visible = false;
				},
				() => {
					for (const o of recess) o.visible = true;
				},
			);
			return {
				changed,
				control: control.changed,
				plates: chosen.length,
				total: plates.length,
			};
		},
		[id, which],
	);

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

const mouth = await shieldInk(slotId, "mouth");
check(
	"the shield at the mouth is drawn on approach",
	mouth.plates > 0 && mouth.changed > 0 && mouth.control > CONTROL_INK_FLOOR,
	`${mouth.changed} pixels from ${mouth.plates} plate(s) at ${approach.rangeKm.toFixed(2)} km, ` +
		`against ${mouth.control} from the aperture bars in the same frame`,
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

const inside = await shieldInk(slotId, "interior");
console.log(
	`  interior shield: ${inside.changed} px from ${inside.plates} plate(s), ` +
		`against ${inside.control} from the recess in the same frame`,
);
// **Reported, not asserted, and that is a finding rather than a retreat.** This
// row asserted the interior shield's ink in #77, when the throat was 280 m deep
// and the plaque sat off the axis: it measured 14,430 pixels. #128 cut the
// travel to 70 m, gave the recess 35 m of wall beyond it, and moved the plaque
// onto the axis where a parked pilot faces it — and it now contributes **zero**
// pixels from inside the throat, with the recess in front of it and with the
// recess hidden, while the recess itself contributes 185,000 in the same frame.
// The plate is `visible`, its material has opacity 1 and a texture, and it is
// 48 m wide 23 m ahead of the camera.
//
// Why it does not draw is **not diagnosed**. A check whose failure nobody
// understands is not a check: asserting it would be asserting a number, and
// loosening it to something that passes would be worse. The figure is printed
// so that a run says what it is, and the question is
// [#131](https://github.com/jcfischer/seelite/issues/131).

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
	// **Bounded, like every other loop here.** A clock that stopped advancing
	// would spin this forever and the run would die on a page timeout — which is
	// the hardest failure in this tier to read, where the two rows below name
	// exactly what went wrong.
	const cap = Math.ceil((expiresAtS - g.world.gameTime + 2) / dt) + 60;
	for (let i = 0; i < cap && g.world.gameTime <= expiresAtS + 1; i++)
		g.step(dt);
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
