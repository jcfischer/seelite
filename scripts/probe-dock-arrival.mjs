/**
 * `docs/specs/docking.md` §12.6's **browser rows** — the three claims about the
 * successful entry that a headless test cannot make.
 *
 * 1. The bay is drawn behind every form, whatever its aperture kind (§13.1),
 *    and every berth the sim hands out has a pad under it.
 * 2. The shield is legible at the mouth on approach, **and** the interior
 *    shield on the bay's mouth bulkhead is drawn from the berth a parked ship
 *    sits in. The inside one is the half only a probe can catch, and it is the
 *    one #131 recorded as drawing nothing from inside the old throat.
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
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGE_URL = gameUrl(
	ORIGIN,
	{ seed: 1 },
	{ override: process.env.PROBE_URL },
);

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
		if (!g.dockingComputerEngaged) {
			// A new ship has no docking computer (#408): fit the one this flies.
			if (!g.hasDockingComputer)
				g.commander = {
					...g.commander,
					ownedEquipment: [
						...g.commander.ownedEquipment,
						g.dockingComputerName,
					],
				};
			g.toggleDockingComputer();
		}
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
			berthAxialKm: snap?.berthAxialKm ?? null,
			// The catalogue, from the sim: a probe with its own copy of the berth
			// list goes falsely red the day the table changes.
			berths: g.berthIdsOfStation(s.id),
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
			// **A pad has no shell, and its deck is a ring** (#165) — no single
			// panel of it is centred on the axis, so the basis is read off the
			// interior *group*, whose local axes are the aperture frame's by
			// construction. It is the weaker reading of the two and it is the
			// one a pad can support; a pad does not spin and §4 removes check 4
			// for it, so the roll is not a docking quantity there, while the
			// axis still is.
			if (o.name === "interior-shell") recess = o;
			else if (!recess && o.name === "station-interior") recess = o;
		});
		// A form with neither part fails its row rather than taking the run down:
		// an unguarded dereference here aborts the whole probe with a
		// `TypeError` inside `page.evaluate`, which surfaces as an opaque stack
		// trace rather than as the named check that was supposed to go red.
		if (!recess) return { id: st.id, rollOffDeg: null, axisOffDeg: null };
		recess.updateWorldMatrix(true, false);
		const e = recess.matrixWorld.elements;
		// The mesh's own axes, in world space. Local +X is the bay's `across` by
		// construction (`BoxGeometry(2·halfAcross, 2·halfUp, depth)`), which is
		// what `slotBasis`'s `across` is.
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
			? "no interior-shell on this form"
			: `roll ${r.rollOffDeg}°, axis ${r.axisOffDeg}°`,
	);
}

// ---------------------------------------------------------------------------
// Row 1 — the bay is drawn behind every form, with a pad at every berth
// ---------------------------------------------------------------------------

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
			// are what says the aperture is on screen — the bay is a small dark
			// hole at that range and reads a couple of pixels, which is no control at
			// all. Parked, the camera is *inside* the bay with the bars behind it,
			// and the shell is most of the view. Either way, if the control
			// contributes nothing the camera is not looking at the thing and neither
			// figure means anything.
			const controlName =
				part === "interior" ? "interior-shell" : "aperture-light";
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

console.log("\n§13.5 browser row 1 — the bay is drawn:");
for (const station of roster) {
	// **Keyed on `aperture.kind` again since #165**, which put back the half of
	// E7/E8's split §13.1 had removed: a slot role draws an enclosed bay and a
	// pad role draws a deck. What is unconditional is that a form draws *an*
	// interior, and asserting the right one per kind is what stops a pad that
	// silently kept its bay from passing.
	check(
		`${station.id} (${station.kind}) draws its interior`,
		station.parts.includes(
			station.kind === "pad" ? "interior-deck" : "interior-shell",
		),
		station.parts
			.filter((n) => n.startsWith("interior") || n.startsWith("aperture"))
			.join(", "),
	);
	check(
		`${station.id}: every berth in its catalogue has a drawn pad`,
		station.berths.length > 0 &&
			station.berths.every((id) => station.parts.includes(`berth-${id}`)),
		`${station.berths.length} berth(s): ${station.berths.join(", ")}`,
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
	// The whole bay — shell, bulkhead, berths and fittings — because §13.1 made
	// the interior a room rather than a single recess box, and hiding one part
	// of it would measure that part rather than the bay.
	const bay = mesh.getObjectByName("station-interior");
	if (bay) bay.traverse((o) => interior.push(o));
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
	// The subject is real and large — this row measures ~165,000 pixels — and the
	// assertion is the narrow one the figure supports: the recess contributes
	// ink at all. It is **not** the 165,000-against-0 contrast that moved this
	// row inside the throat; that comparison was made by hand while diagnosing
	// (from outside, a recess and a hole through a station are both dark and
	// hiding one changed nothing), and no row measures both viewpoints in one
	// run.
	//
	// What it does not have is a control. The emissive bars are behind the
	// camera; hiding the whole station hides the recess with it; and the
	// interior plaque draws nothing in this exact frame, which #131 records as
	// undiagnosed. So the claim is narrow — the recess reaches the screen — and
	// the frame it is read from is under a question of its own.
	"the bay reaches the screen from inside it",
	interiorInk.parts > 0 && interiorInk.changed > 0,
	`${interiorInk.changed} pixels from ${interiorInk.parts} interior part(s), ` +
		`from ${interiorInk.rangeKm.toFixed(3)} km on the axis, inside the bay`,
);

// **E11's interior shield, and #131's answer.** The plaque sat on the throat's
// end wall; #128 cut the throat to 105 m and it measured **zero**, with the
// recess in front of it and with the recess hidden, and §12.7's joint 9
// recorded that nobody had diagnosed why — and it is still not diagnosed. What
// changed is the geometry around it, not an understanding of the old frame:
// §13.1's bay puts the same wall four times further back and square to the
// lane, and this is the view an arriving
// ship has of it: on the axis, just inside the mouth, looking down the transit
// lane. The ship is still flying here, which is what makes the viewpoint
// available at all — a docked tick would put it back in its berth.
const insideShield = await shieldInk(slotId, "interior");
check(
	"the interior shield is drawn from inside the bay",
	insideShield.plates > 0 &&
		insideShield.changed > 0 &&
		insideShield.control > CONTROL_INK_FLOOR,
	`${insideShield.changed} pixels from ${insideShield.plates} plate(s), ` +
		`against ${insideShield.control} from the bay in the same frame`,
);

// ---------------------------------------------------------------------------
// Row 3 — a scripted approach ends inside the station
// ---------------------------------------------------------------------------
//
// Taken before row 2's arrival half, because that half needs a dock in flight.

console.log("\n§13.5 browser row 3 — the approach ends inside:");

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
const dock = (id, opts = {}) =>
	page.evaluate(
		([stationId, standoffKm, skip]) => {
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
			let arrivalGlass = null;
			let elapsed = 0;
			for (let i = 0; i < 60 * 120; i++) {
				g.step(dt);
				elapsed += dt;
				const now = g.dockingSnapshot(stationId);
				if (!phases.includes(now.dockPhase)) phases.push(now.dockPhase);
				if (arrivingAtS === null && now.dockPhase === "arriving")
					arrivingAtS = elapsed;
				if (arrivalGlass === null && now.dockPhase === "arriving") {
					g.setHeadLook("forward");
					g.render(0);
					arrivalGlass = {
						consolePresent:
							document.querySelector("[data-live-station-console]") !== null,
						floorHidden: g.floorRender === null,
					};
				}
				// Obligation 5 both ways since §13.3: an arrival's skip completes at
				// the reserved berth, so a caller that only needs a docked session
				// can pay for the entry and skip the seconds after it.
				if (skip && now.dockPhase === "arriving") g.skipDockTraversal();
				if (now.dockPhase === "docked") break;
			}
			const end = g.dockingSnapshot(stationId);
			return {
				phases,
				arrivingAtS,
				arrivalGlass,
				axialKm: end.axialKm,
				planeKm: end.planeKm,
				berthId: end.berthId,
				berthAxialKm: end.berthAxialKm,
				offAxisKm: end.offAxisKm,
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
		[id, PROBE_STANDOFF_KM, opts.skipTraversal === true],
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
	"the scripted arrival hides flight glass before the station console opens",
	flown.arrivalGlass !== null &&
		!flown.arrivalGlass.consolePresent &&
		flown.arrivalGlass.floorHidden,
	`console=${flown.arrivalGlass?.consolePresent}, floor hidden=${flown.arrivalGlass?.floorHidden}`,
);
check(
	// The regression this section exists for: *"ship does not fly into Coriolis
	// station but hovers just over rotating dock"*. The old behaviour left the
	// ship at the crossing point, which is the plane itself.
	"the ship ends inside the station, not at the plane",
	flown.berthAxialKm !== null &&
		flown.axialKm < flown.planeKm - (flown.planeKm - flown.berthAxialKm) * 0.99,
	`parked at ${flown.axialKm.toFixed(4)} km against a ${flown.planeKm.toFixed(3)} km plane, ` +
		`berth ${flown.berthId} at ${flown.berthAxialKm?.toFixed(4)} km`,
);
check(
	"and it ends where §13.3 puts it, to within a metre",
	flown.berthAxialKm !== null &&
		Math.abs(flown.axialKm - flown.berthAxialKm) < 0.001,
	`${(Math.abs(flown.axialKm - (flown.berthAxialKm ?? 0)) * 1000).toFixed(2)} m off`,
);
check(
	// **§13.2's whole point, and the one thing a throat could not do.** A berth
	// is off the transit axis, so a build that quietly parked on the centreline
	// would pass both rows above and fail here.
	"and it ends in a berth off the transit axis",
	flown.offAxisKm > 0.001,
	`${(flown.offAxisKm * 1000).toFixed(1)} m off the axis, berth ${flown.berthId}`,
);

// ---------------------------------------------------------------------------
// Row 2 — the shields, at the mouth and on the bay's bulkhead
// ---------------------------------------------------------------------------

console.log("\n§13.5 browser row 2 — the name shield is drawn:");

// A dock is not still an approach. §13.1 makes the bay **enclosed with an open
// mouth**: the ship parks facing out, so what a parked pilot sees is a lit
// rectangle of space in a wall of station — not the open field a throat left,
// and not the sealed door #138 closed behind them. Both halves are asserted,
// because either alone is satisfied by the failure the other names.
const parked = await page.evaluate((stationId) => {
	const g = window.__seelite;
	const snap = g.dockingSnapshot(stationId);
	// **Aimed at the mouth, which is a free look rather than the parked gaze.**
	// §13.3 parks the ship pointing out along the aperture *axis*, and a berth
	// is off that axis — so from a deck berth the opening is up and ahead, not
	// dead centre. §13.1's claim is that it stays *visible*, which is what a
	// pilot's free look answers; this is a view-only probe, so the attitude is
	// set rather than flown. The roll is the berth's own, off the page: rolling
	// it to something else would be this file deciding how the ship is parked.
	const body = g.world.system.byId.get(stationId);
	const a = snap.axis;
	const toMouth = {
		x: body.pos.x + a.x * snap.planeKm - g.world.ship.pos.x,
		y: body.pos.y + a.y * snap.planeKm - g.world.ship.pos.y,
		z: body.pos.z + a.z * snap.planeKm - g.world.ship.pos.z,
	};
	const n = Math.hypot(toMouth.x, toMouth.y, toMouth.z);
	g.setAttitude(
		{ x: toMouth.x / n, y: toMouth.y / n, z: toMouth.z / n },
		snap.berthUp,
	);
	g.setHeadLook("forward");
	g.render(0);
	const bay = window
		.__meshOfBody(stationId)
		.getObjectByName("station-interior");
	const parts = [];
	const rim = [];
	if (bay)
		bay.traverse((o) => {
			parts.push(o);
			if (o.name === "interior-lane-edge") rim.push(o);
		});
	// **The lit rim of the opening, not the starfield.** A star sphere is the
	// wrong instrument here: what fills a 120 × 70 m opening seen from 165 m is
	// the *planet* the station orbits, so hiding the point stars changes nothing
	// and a row keyed on them reads zero whether the mouth is open or bricked
	// up. The four emissive strips around the opening are what says the way out
	// is there, and they are drawn on the bay's own bulkhead.
	const edge = window.__inkDelta(
		() => {
			for (const o of rim) o.visible = false;
		},
		() => {
			for (const o of rim) o.visible = true;
		},
	);
	const walls = window.__inkDelta(
		() => {
			for (const o of parts) o.visible = false;
		},
		() => {
			for (const o of parts) o.visible = true;
		},
	);
	return {
		phase: snap.dockPhase,
		berthId: snap.berthId,
		rimPixels: edge.changed,
		rimParts: rim.length,
		bayPixels: walls.changed,
		// The sample `__inkDelta` reads, so the figures above are against the
		// frame it actually measured rather than against the viewport.
		samplePixels: 560 * 400,
	};
}, slotId);

check(
	// **The bay is around the ship**, which is the half of §13.1 a parked frame
	// can answer: a ship left in a throat, or at the plane, sees no station
	// wall at all from this viewpoint.
	"the bay is drawn around the berth",
	parked.phase === "docked" && parked.bayPixels > 0,
	`${parked.phase} in ${parked.berthId}, ${parked.bayPixels} px of bay ` +
		`in a ${parked.samplePixels} px sample`,
);
// **The lit rim of the opening reads zero here, and it is printed rather than
// asserted.** The strips are drawn — the mid-arrival frame below sees them —
// but from a deck berth aimed at the mouth they sit about 11° above the aim,
// which is behind the cockpit's own canopy roof. That is a fact about where a
// deck berth puts the pilot's eye and not about the geometry, and a row that
// moved the aim until the number came up would be a row tuned to pass. §13.1's
// "no door" half is asserted headlessly instead, over every form and every
// detail level, in `tests/station-mesh.test.ts`.
console.log(
	`  rim of the mouth from the berth: ${parked.rimPixels} px from ` +
		`${parked.rimParts} strip(s), behind the canopy roof`,
);

// **§13.1's re-sited shield, and the symptom #131 recorded.** E11's interior plaque used to
// sit on the throat's end wall, behind a ship parked nose-*inward*: #77
// measured 14,430 pixels of it through a 280 m throat, #128 shortened the
// throat to 105 m and it measured **zero**, and §12.7's joint 9 recorded that
// nobody had diagnosed why. §13.1 moves it onto the mouth bulkhead and §13.3
// parks the ship facing out, so the plaque is now in front of the pilot by
// construction rather than by luck of the phase — which makes this an assertion
// again rather than a printed figure.
// The end of E3 is a docked cockpit, not merely a parked ship. The live
// station console must replace the forward flight glass after the scripted
// arrival has completed; the gallery is a fixture and cannot prove this join.
const liveConsole = await page.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("forward");
	g.render(0);
	const consoleEl = document.querySelector("[data-live-station-console]");
	const style = consoleEl ? getComputedStyle(consoleEl) : null;
	const box = consoleEl?.getBoundingClientRect();
	return {
		phase: g.dockPhase,
		present: consoleEl !== null,
		visible:
			style?.display !== "none" &&
			(consoleEl?.getBoundingClientRect().width ?? 0) > innerWidth * 0.5,
		marketRows: document.querySelectorAll("[data-live-market-row]").length,
		floorHidden: g.floorRender === null,
		canvasCovering:
			box?.left === 0 &&
			box?.top === 0 &&
			box?.width === innerWidth &&
			box?.height === innerHeight &&
			style?.backgroundImage !== "none",
		renderEligible: g.sceneRenderEligible(),
	};
});

check(
	"the live docked cockpit replaces forward flight glass with the station market",
	liveConsole.phase === "docked" &&
		liveConsole.present &&
		liveConsole.visible &&
		liveConsole.marketRows === 17 &&
		liveConsole.floorHidden &&
		liveConsole.canvasCovering &&
		!liveConsole.renderEligible,
	`phase ${liveConsole.phase}, console=${liveConsole.present}/${liveConsole.visible}, rows=${liveConsole.marketRows}, floor hidden=${liveConsole.floorHidden}, cover=${liveConsole.canvasCovering}, render=${liveConsole.renderEligible}`,
);

// Commerce uses the live console, not the gallery fixture. A completed round
// trip must change the rendered commander and shelf state, then return cargo
// to zero through the same DOM action boundary.
/** The Food row's trade control, shared by both trade checks below. */
const FOOD_ACTION =
	'[data-live-station-action="%s"][data-live-station-name="Food"]';

const liveTrade = await page.evaluate((foodAction) => {
	const read = () => ({
		commander:
			document.querySelector("[data-live-commander]")?.textContent ?? "",
		food:
			document.querySelector('[data-live-market-row="Food"]')?.textContent ??
			"",
	});
	const before = read();
	const buy = document.querySelector(foodAction.replace("%s", "buy-commodity"));
	if (!(buy instanceof HTMLElement))
		return { before, afterBuy: before, afterSell: before, controls: false };
	buy.click();
	const afterBuy = read();
	const sell = document.querySelector(
		foodAction.replace("%s", "sell-commodity"),
	);
	if (!(sell instanceof HTMLElement))
		return { before, afterBuy, afterSell: afterBuy, controls: false };
	sell.click();
	return { before, afterBuy, afterSell: read(), controls: true };
}, FOOD_ACTION);

check(
	"the live station console completes a buy and sell across commander and shelf state",
	liveTrade.controls &&
		liveTrade.afterBuy.commander !== liveTrade.before.commander &&
		liveTrade.afterBuy.food !== liveTrade.before.food &&
		liveTrade.afterSell.commander.includes("HOLD EMPTY") &&
		liveTrade.afterSell.food === liveTrade.before.food,
	JSON.stringify(liveTrade),
);

// #316, `economy-trade.md` §5.2: a shelf read between trades must be whole.
// Ten seconds of game time and not minutes: the launch checks below read the
// grant off the same clock, and a seven-minute jump expired it under them.
const shelfTrade = await page.evaluate((foodAction) => {
	const g = window.__seelite;
	const hold = () =>
		document.querySelector("[data-live-commander]")?.textContent ?? "";
	const act = (action) =>
		document.querySelector(foodAction.replace("%s", action))?.click();
	// Three and one, not one and one: `readDeficit` reads a mark under one unit
	// as nothing, so a single unit bought and sold back leaves a whole shelf on
	// the build this check exists to catch. Three bought, faded and one sold
	// leaves 1.98 units of mark. The other two are sold after the read, so the
	// checks below start from an empty hold.
	for (let i = 0; i < 3; i++) act("buy-commodity");
	const afterBuys = hold();
	g.world.gameTime += 10;
	act("sell-commodity");
	const afterSell = hold();
	const cells = [
		...document.querySelectorAll(
			// The shelf cell by hook, not by position. This was
			// `> span:nth-child(3)`, and #196's second price column moved the shelf to
			// fourth — a probe that counts cells reads whichever column happens to land
			// on the number it was written against, which is how this line would go red
			// on a build whose shelves are perfectly whole.
			'[data-live-market-row][data-live-listed="true"] [data-live-shelf]',
		),
	].map((cell) => cell.firstChild?.textContent ?? "");
	act("sell-commodity");
	act("sell-commodity");
	return { cells, afterBuys, afterSell, afterAll: hold() };
}, FOOD_ACTION);
const fractionalShelves = shelfTrade.cells.filter(
	(text) => !/^\d+ \S+$/.test(text.trim()),
);

check(
	"every shelf the console shows after a faded trade is whole units",
	// The trades must have happened: a refused buy leaves no mark, and a shelf
	// with no mark is whole on the unfixed build too.
	/HOLD .*Food 3\b/.test(shelfTrade.afterBuys) &&
		/HOLD .*Food 2\b/.test(shelfTrade.afterSell) &&
		shelfTrade.afterAll.includes("HOLD EMPTY") &&
		shelfTrade.cells.length > 0 &&
		fractionalShelves.length === 0,
	`hold ${JSON.stringify([shelfTrade.afterBuys, shelfTrade.afterSell, shelfTrade.afterAll])}, cells=${shelfTrade.cells.length}, not whole=${JSON.stringify(fractionalShelves)}`,
);

const liveEquipment = await page.evaluate(() => {
	const tab = document.querySelector('[data-live-station-tab="Equipment"]');
	if (!(tab instanceof HTMLElement)) return { switched: false, rows: 0 };
	tab.click();
	return {
		switched:
			document
				.querySelector("[data-live-station-console]")
				?.getAttribute("data-live-station-tab-active") === "Equipment",
		rows: document.querySelectorAll("[data-live-equipment]").length,
	};
});

check(
	"the live station console switches to the shared equipment projection",
	liveEquipment.switched && liveEquipment.rows > 0,
	`switched=${liveEquipment.switched}, equipment rows=${liveEquipment.rows}`,
);

// #314: a launch Traffic refuses is held with its reason on every docked
// console, a retry keeps its first place, and CANCEL gives the turn back.
// The one way the held-launch and launch rows refuse the lane, defined on its
// own so either row can run without the other. The warm index is the
// authority's own gate: zeroing it refuses the lane without inventing a ship.
await page.evaluate(() => {
	window.__refuseLaneWhile = (fn) => {
		const g = window.__seelite;
		const warmIndex = g.trafficWarmIndex;
		g.trafficWarmIndex = 0;
		try {
			return fn();
		} finally {
			g.trafficWarmIndex = warmIndex;
		}
	};
});

const heldLaunch = await page.evaluate((stationId) => {
	const g = window.__seelite;
	// `checkVisibility`, not `hidden`: an id rule with `display` beats it.
	const visibleNotice = () =>
		[...document.querySelectorAll("[data-live-launch-notice]")].find(
			(notice) => notice instanceof HTMLElement && notice.checkVisibility(),
		)?.textContent ?? null;
	return window.__refuseLaneWhile(() => {
		g.setHeadLook("right");
		document.querySelector('[data-live-right-tab="Flight"]')?.click();
		document.querySelector("[data-live-launch]")?.click();
		const fromRight = visibleNotice();
		// Off Flight, where LAUNCH itself is not drawn, and on the left panel.
		document.querySelector('[data-live-right-tab="Drive"]')?.click();
		g.updateCockpit();
		const fromRightDrive = visibleNotice();
		g.setHeadLook("left");
		g.updateCockpit();
		const fromLeft = visibleNotice();
		g.setHeadLook("right");
		document.querySelector('[data-live-right-tab="Flight"]')?.click();
		const firstStamp = g.playerLaneRequests.get(stationId)?.readyAt ?? null;
		// The retry `stepHeldLaunch` makes, five game seconds on.
		g.world.gameTime += 5;
		g.launch();
		const retryStamp = g.playerLaneRequests.get(stationId)?.readyAt ?? null;
		g.setHeadLook("forward");
		g.updateCockpit();
		const fromForward = visibleNotice();
		const held = {
			phase: g.dockPhase,
			fromRight,
			fromRightDrive,
			fromLeft,
			fromForward,
			firstStamp,
			retryStamp,
		};
		document.querySelector("[data-live-launch-cancel]")?.click();
		g.setHeadLook("right");
		g.updateCockpit();
		const cancelled = {
			notice: document.querySelector("[data-live-launch-notice]") !== null,
			launchBack: document.querySelector("[data-live-launch]") !== null,
			request: g.playerLaneRequests.get(stationId)?.movement ?? null,
		};
		return { held, cancelled };
	});
}, slotId);

check(
	"a launch Traffic refuses is held on every docked console, keeps its place, and cancel gives the turn back",
	heldLaunch.held.phase === "docked" &&
		[
			heldLaunch.held.fromRight,
			heldLaunch.held.fromRightDrive,
			heldLaunch.held.fromLeft,
			heldLaunch.held.fromForward,
		].every((notice) => /^LAUNCH HELD — /.test(notice ?? "")) &&
		heldLaunch.held.firstStamp !== null &&
		heldLaunch.held.retryStamp === heldLaunch.held.firstStamp &&
		!heldLaunch.cancelled.notice &&
		heldLaunch.cancelled.launchBack &&
		heldLaunch.cancelled.request === null,
	JSON.stringify(heldLaunch),
);

// The ship is parked in its berth from row 3, so the approach view has to be
// set up again — deliberately, and after the dock rather than before: putting
// the ship back outside would leave the session docked while the ship is
// kilometres away, which is not a state §12 creates.
const approach = await page.evaluate((stationId) => {
	const g = window.__seelite;
	// Out of the dock through the real Flight-console control, not a direct
	// `g.launch()` call. The DOM event must reach the same requestLaunch seam a
	// player uses, and launch should remove the forward station console at once.
	g.setHeadLook("right");
	const flight = document.querySelector('[data-live-right-tab="Flight"]');
	if (flight instanceof HTMLElement) flight.click();
	const launch = document.querySelector("[data-live-launch]");
	// #314: the press is refused first, so it is held, and the held launch
	// must leave by itself on the first step the lane is the player's.
	const heldPhase = window.__refuseLaneWhile(() => {
		if (launch instanceof HTMLElement) launch.click();
		return g.dockPhase;
	});
	g.step(1 / 60);
	g.updateCockpit();
	const consoleGone =
		document.querySelector("[data-live-station-console]") === null;
	g.render(0);
	const launchingGlass = {
		phase: g.dockPhase,
		floorHidden: g.floorRender === null,
	};
	g.skipDockTraversal();
	for (let i = 0; i < 30; i++) g.step(1 / 60);
	// The shield row is an approach view, so restore its forward gaze after
	// exercising the right-wall Flight control above.
	g.setHeadLook("forward");
	const rangeKm = g.dockingSnapshot(stationId).planeKm * 3;
	window.__placeOnAxis(stationId, rangeKm, false);
	const out = g.dockingSnapshot(stationId);
	return {
		phase: out.dockPhase,
		rangeKm,
		launchControl: launch instanceof HTMLElement,
		heldPhase,
		consoleGone,
		launchingGlass,
		// Read after the traversal has ended and before anything re-requests.
		released: { berthId: out.berthId, clearance: out.clearance.kind },
	};
}, slotId);

check(
	"the Flight console launch released the ship back into flight",
	approach.launchControl &&
		approach.heldPhase === "docked" &&
		approach.consoleGone &&
		approach.launchingGlass.phase === "launching" &&
		approach.launchingGlass.floorHidden &&
		approach.phase === "flying",
	`control=${approach.launchControl}, held=${approach.heldPhase}, console gone=${approach.consoleGone}, launching=${approach.launchingGlass.phase}/${approach.launchingGlass.floorHidden}, phase ${approach.phase}`,
);

check(
	// **§13.2's release, and it is only reachable here.** The rule — the outward
	// crossing gives the berth back and spends the grant with it — is wired in
	// `main.ts`, and the headless tier does not construct a `Game`. So this is
	// the one tier that can watch it happen, and §13.5 says so rather than
	// listing it among the headless rows.
	"the launch gave the berth back and spent the grant with it",
	approach.released !== null &&
		approach.released.berthId === null &&
		approach.released.clearance === "none",
	`berth ${approach.released?.berthId}, clearance ${approach.released?.clearance}`,
);

const mouth = await shieldInk(slotId, "mouth");
check(
	"the shield at the mouth is drawn on approach",
	mouth.plates > 0 && mouth.changed > 0 && mouth.control > CONTROL_INK_FLOOR,
	`${mouth.changed} pixels from ${mouth.plates} plate(s) at ${approach.rangeKm.toFixed(2)} km, ` +
		`against ${mouth.control} from the aperture bars in the same frame`,
);

// **Docked again, and by skipping rather than by flying.** The launch above put
// the ship back into flight and the rows below are only reachable from a dock,
// but the rows below do not care *how* it got there — and §13.3 raised a
// traversal from five seconds to six or nine, on a suite that already reports a
// timeout under load (#121). `dock` flies the whole approach; this pays for the
// entry and skips the traversal.
const redocked = await dock(slotId, { skipTraversal: true });
check(
	"the ship docks a second time, for the rows only a dock can reach",
	redocked.phase === "docked",
	`phases ${redocked.phases.join(" → ")}`,
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

// #321: the docked console must follow the market clock without a trade or
// tab change after the jump. Read the expected row from the same market
// projection the till uses, then wait for the normal frame loop to redraw it.
const fadedShelf = await page.evaluate(async () => {
	const g = window.__seelite;
	g.setHeadLook("forward");
	document.querySelector('[data-live-station-tab="Market"]')?.click();
	const { MARKET_PERIOD_MIN, DEFICIT_HALF_LIFE_MIN, marketEpoch } =
		await import("/src/market.ts");
	const station = g.dockedStationContext().market;
	const nextEpoch = marketEpoch(station.phaseMin, g.world.gameTime / 60) + 1;
	// Start just inside one station market epoch, leaving a full half-life
	// before its next turnover. Otherwise the generated base can move in the
	// opposite direction and hide a shelf recovered by decay.
	g.world.gameTime =
		(nextEpoch * MARKET_PERIOD_MIN - station.phaseMin) * 60 + 1;
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const food = () => document.querySelector('[data-live-market-row="Food"]');
	const read = () => ({
		buy:
			food()?.querySelector("[data-live-buy]")?.firstChild?.textContent ?? null,
		sell:
			food()?.querySelector("[data-live-sell]")?.firstChild?.textContent ??
			null,
		shelf:
			food()?.querySelector("[data-live-shelf]")?.firstChild?.textContent ??
			null,
	});
	for (let i = 0; i < 12; i++)
		food()
			?.querySelector('[data-live-station-action="buy-commodity"]')
			?.click();
	// The trade's own revision must reach the DOM before the clock moves;
	// otherwise that pending redraw could falsely satisfy the decay check.
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const before = read();
	const traded = /HOLD .*Food 12\b/.test(
		document.querySelector("[data-live-commander]")?.textContent ?? "",
	);
	const shownAfterTrade = g
		.stationConsoleState()
		.market.find((entry) => entry.commodity.name === "Food");
	const tradeDrawn =
		before.shelf ===
		`${shownAfterTrade?.quantity} ${shownAfterTrade?.commodity.unit}`;
	g.world.gameTime += (DEFICIT_HALF_LIFE_MIN + 1) * 60;
	const { stationMarketScreen, priceLabel } = await import(
		"/src/station-console.ts"
	);
	const { readDeficit } = await import("/src/deficits.ts");
	const context = g.dockedStationContext();
	const row = stationMarketScreen({
		station: context.market,
		economy: context.economy,
		gameTimeMin: context.gameTimeMin,
		deficitOf: (name) =>
			readDeficit(
				context.envelope.deficits,
				context.stationKey,
				name,
				context.gameTimeMin,
			),
		holdT: g.stationConsoleState().hold.capacityT,
		displayTL: g.world.system.record.displayTL,
	}).find((entry) => entry.commodity.name === "Food");
	return {
		before,
		traded,
		tradeDrawn,
		expected: row && {
			buy: priceLabel(row.buyCr),
			sell: priceLabel(row.sellCr),
			shelf: `${row.quantity} ${row.commodity.unit}`,
		},
	};
});
const refreshedShelf = await page
	.waitForFunction(
		(expected) => {
			const food = document.querySelector('[data-live-market-row="Food"]');
			const value = (hook) =>
				food?.querySelector(hook)?.firstChild?.textContent ?? null;
			const actual = {
				buy: value("[data-live-buy]"),
				sell: value("[data-live-sell]"),
				shelf: value("[data-live-shelf]"),
			};
			return (
				actual.buy === expected.buy &&
				actual.sell === expected.sell &&
				actual.shelf === expected.shelf
			);
		},
		fadedShelf.expected,
		{ timeout: 3000 },
	)
	.then(
		() => true,
		() => false,
	);
check(
	"the untouched docked console refreshes its shelf and prices as the deficit decays",
	refreshedShelf &&
		fadedShelf.traded &&
		fadedShelf.tradeDrawn &&
		fadedShelf.expected !== undefined &&
		fadedShelf.before.shelf !== fadedShelf.expected.shelf &&
		fadedShelf.before.buy !== fadedShelf.expected.buy,
	JSON.stringify(fadedShelf),
);

// A market refresh must not rebuild the Requests tab while the pilot is
// using its keyboard controls. The trade above leaves a decaying Food mark;
// take another half-life with the Requests tab focused and watch the same DOM
// node survive while the cached market moves underneath it.
const requestFocusAcrossDecay = await page.evaluate(async () => {
	const g = window.__seelite;
	const { DEFICIT_HALF_LIFE_MIN } = await import("/src/market.ts");
	document.querySelector('[data-live-station-tab="Requests"]')?.click();
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const tab = document.querySelector('[data-live-station-tab="Requests"]');
	tab?.focus();
	const before = g
		.stationConsoleState()
		.market.find((row) => row.commodity.name === "Food");
	const revision = g.stationConsoleRevision;
	g.world.gameTime += (DEFICIT_HALF_LIFE_MIN + 1) * 60;
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const after = g
		.stationConsoleState()
		.market.find((row) => row.commodity.name === "Food");
	return {
		marketMoved:
			before?.quantity !== after?.quantity || before?.buyCr !== after?.buyCr,
		focusKept: tab?.isConnected && document.activeElement === tab,
		revisionHeld: g.stationConsoleRevision === revision,
	};
});
check(
	"clock-driven market changes keep keyboard focus on the Requests tab",
	requestFocusAcrossDecay.marketMoved &&
		requestFocusAcrossDecay.focusKept &&
		requestFocusAcrossDecay.revisionHeld,
	JSON.stringify(requestFocusAcrossDecay),
);

await browser.close();
exit();
