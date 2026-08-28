/**
 * Docking, the spatial tier — `docs/specs/docking.md` §9.2.3, §9.2.4, §9.2.5.
 *
 *   npm run dev                       # in one shell
 *   node scripts/probe-docking.mjs    # in another
 *
 * Three scripted approaches, all of them flown by the game's own `step`:
 *
 * 3. **A correct profile docks.** Cleared, the docking computer engaged, driven
 *    from a few kilometres out until the aperture plane is crossed.
 * 4. **A hull-face approach is refused.** Aimed squarely at the hull *inside*
 *    check 2's 35° cone and outside the aperture. §3 records this as the hole
 *    that check 5 closes, and it is a spatial claim, so it gets the spatial tier
 *    rather than only the unit one.
 * 5. **A mis-rolled approach fails and survives.** D1's whole content: a failed
 *    entry damages the ship rather than destroying it.
 *
 * **§9.2's other two rows are already shipped elsewhere and are not repeated
 * here.** §9.2.1's layering and §9.2.2's spin tracking are both in
 * `probe-station.mjs`, which measures the drydock assembly across `HANDOFF_KM`
 * and the slot's screen-space rate at §4's two ends. A second copy would be a
 * second thing to keep in step with the constants, which is the failure the
 * "read constants off the page" rule exists to prevent.
 *
 * Every number this file needs — the gate, the tolerances, the aperture, the
 * axis, the slot's rolled basis — is read off `window.__seelite`
 * (`dockingSnapshot`, `units`). Nothing is restated: a probe carrying its own
 * copy of a constant goes falsely red the day the module retunes it, which is a
 * bug reported against a renderer that is behaving correctly.
 */
import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

/** Sim seconds a scripted approach is given before the run is called a failure.
 *  Generous against the ~110 s the computer takes from three kilometres. */
const LIMIT_S = 200;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const dt = await page.evaluate(() => window.__seelite.units.MAX_DT);

/**
 * The page-side helpers, installed once.
 *
 * As an init-free `addScriptTag` equivalent: an evaluated function per run
 * would be three copies of the same vector arithmetic, and the third would be
 * the one that drifts.
 */
await page.evaluate(() => {
	const g = window.__seelite;
	const V = (a) => ({ x: a.x, y: a.y, z: a.z });
	window.__dock = {
		add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
		scale: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
		/** A spinning station, which is the one the roll match applies to. */
		spinner: () =>
			g.world.system.contents.stations.find((s) => s.spinRpm > 0) ??
			g.world.system.contents.stations[0],

		/** The unit vector from the ship to a station-relative point. */
		toward(id, rel) {
			const body = g.world.system.byId.get(id);
			const d = {
				x: body.pos.x + rel.x - g.world.ship.pos.x,
				y: body.pos.y + rel.y - g.world.ship.pos.y,
				z: body.pos.z + rel.z - g.world.ship.pos.z,
			};
			const n = Math.hypot(d.x, d.y, d.z);
			return n === 0 ? { x: 1, y: 0, z: 0 } : window.__dock.scale(d, 1 / n);
		},
		/**
		 * One frame of a hand-flown profile: point at a fixed station-relative
		 * point, hold the roll error this run was set up with, and command the
		 * closing speed on the throttle.
		 *
		 * Re-aimed **every frame**, because the station is on an orbit and its
		 * slot is turning; an attitude set once drifts off both the axis and the
		 * roll over a 30 s approach. A player watching the HUD does the same
		 * thing with the stick.
		 *
		 * The aim point sits **two kilometres past the plane**, not on it. Aiming
		 * at the plane itself was the version before this one and the nose went
		 * unstable at the end of the run: as the ship arrives, the vector to its
		 * own aim point shrinks to nothing and its direction is decided by
		 * whatever noise is left, so check 2 read 59.5° at the crossing and the
		 * entry failed on the nose angle rather than on containment. A point
		 * beyond the target is what a pilot flying *through* a face aims at, and
		 * it keeps the nose well conditioned all the way in.
		 *
		 * Speed comes from the **throttle**, not from writing `ship.vel`. Writing
		 * the velocity was the first version and it went nowhere: the assist
		 * reads a throttle of zero as "hold station in the local frame" and has
		 * 2 km/s² of authority, so it cancelled the whole commanded closing speed
		 * inside a single step.
		 */
		reaim(id, setup) {
			const D = window.__dock;
			const snap = g.dockingSnapshot(id);
			if (!snap) return;
			const aim = D.add(
				D.scale(snap.axis, snap.planeKm - 2),
				// The **unrolled** reference off the page, not a perpendicular this
				// file seeds for itself. The lateral offset must not rotate with the
				// slot — aiming at `basis.across · 315 m` is aiming at a point that
				// orbits the axis at 0.65 rpm — and the convention for "not parallel
				// to this axis" belongs to `docking.ts`, which now has exactly one.
				D.scale(snap.reference, setup.offsetKm ?? 0),
			);
			const rad = ((setup.rollDeg ?? 0) * Math.PI) / 180;
			// The roll error is stated against the **slot's** own basis, because
			// that is what check 4 measures — unlike the lateral offset above,
			// which needs a direction that does not rotate.
			const rolled = D.add(
				D.scale(snap.basis.across, Math.cos(rad)),
				D.scale(snap.basis.up, Math.sin(rad)),
			);
			g.setAttitude(D.toward(id, aim), rolled);
			g.setThrottle(setup.closingKms / g.assistCapKms);
		},
		/** Park the ship at a station-relative offset with a station-relative
		 *  velocity — the §1 conversion, done the way the game does it. */
		place(id, rel, vRel) {
			const body = g.world.system.byId.get(id);
			const vel = g.stationVelocity(id);
			g.world.ship.pos = window.__dock.add(V(body.pos), rel);
			g.world.ship.vel = window.__dock.add(V(vel), vRel);
			g.regime = "normal";
			g.setThrottle(0);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
		},
	};
});

/**
 * Drive the game until it crosses an aperture plane, or until the clock runs
 * out.
 *
 * `g.step(dt)` and `g.render(dt)`, exactly as `probe-cruise.mjs` drives a leg:
 * this runs what the game runs rather than a probe's own copy of the order.
 */
async function fly(setup) {
	return page.evaluate(
		async ([dt, limitS, setup]) => {
			const g = window.__seelite;
			const D = window.__dock;
			const station = D.spinner();
			const id = station.id;

			// A snapshot first, purely to read the frame: the axis, the plane and
			// the rolled basis are the renderer's, and everything placed below is
			// stated in them.
			// `dockingSnapshot` returns null when there is no station to snapshot.
			// With an explicit id that cannot happen for a station taken out of
			// this system's own contents — but an unguarded dereference turns any
			// future violation of that into a bare `TypeError` inside
			// `page.evaluate`, which surfaces as an opaque probe crash instead of
			// a named failure.
			const seen = g.dockingSnapshot(id);
			if (!seen) return { noSnapshot: true, id };
			const axis = seen.axis;
			const across = seen.basis.across;
			const up = seen.basis.up;

			const start = D.add(
				D.scale(axis, seen.planeKm + setup.standoffKm),
				D.scale(seen.reference, setup.offsetKm ?? 0),
			);
			D.place(id, start, { x: 0, y: 0, z: 0 });
			g.targetId = id;
			// **`interimCondition`, not `condition`.** The field was renamed and
			// this line was not: it silently created a stray property, no per-run
			// health reset landed, and §9.2.5's "at most a quarter of the pool"
			// quietly became a cumulative measurement across every run before it.
			// A write to a page object cannot fail, which is what made it invisible.
			g.interimCondition = { shield: setup.shield, hull: setup.hull };
			g.lastEntry = null;
			g.dockedAt = null;

			const cleared = g.requestDockingClearance();

			// **Disengaged first, every run.** The computer is session state and it
			// survives a run that never docked, so the second scripted approach
			// inherited an autopilot still flying the first one — it overrode the
			// throttle and the attitude every frame and the run measured the
			// computer under a name that said "hand-flown".
			g.dockingComputerEngaged = false;
			if (setup.computer) {
				g.toggleDockingComputer();
			} else {
				// A hand-flown profile, aimed at a fixed point on the station and
				// re-aimed every frame below. The loop owns the aiming; this only sets
				// the first attitude so the ship does not spend its first frames
				// turning out of whatever the previous run left it in.
				g.setAttitude(D.scale(axis, -1), across);
				g.setThrottle(setup.closingKms / g.assistCapKms);
			}

			let elapsed = 0;
			const trace = [];
			const before = { ...g.interimCondition };
			for (let i = 0; i < limitS / dt; i++) {
				if (g.lastEntry || g.dockedAt) break;
				if (!setup.computer) D.reaim(id, setup);

				// A sparse trace, printed only when a run does not do what it was
				// set up to do. A passing run prints its verdict and nothing else;
				// a failing one needs the approach, and reconstructing it from a
				// single end-state sample is guesswork.
				if (i % 50 === 0 && trace.length < 20) {
					const s = g.dockingSnapshot(id);
					if (!s) break;
					trace.push(
						`t=${elapsed.toFixed(1)} axial=${s.axialKm.toFixed(3)} ` +
							`off=${(s.offAxisKm * 1000).toFixed(1)}m v=${s.closingKms.toFixed(4)} ` +
							`thr=${s.throttle.toFixed(4)} frame=${s.frameBodyId}`,
					);
				}
				g.step(dt);
				g.render(dt);
				elapsed += dt;
			}

			const after = g.dockingSnapshot(id);
			if (!after) return { noSnapshot: true, id };
			return {
				id,
				spinRpm: station.spinRpm,
				elapsed,
				cleared: cleared.id !== null,
				grantLive: after.grantLive,
				docked: after.dockedAt === id,
				hostile: after.hostile,
				alive: after.alive,
				conditionBefore: before,
				conditionAfter: after.condition,
				entry: after.lastEntry,
				trace,
				poolMax: after.poolMax,
				// The crossing's own measured speed, so §9.2's record is a
				// measurement rather than the setpoint that was asked for.
				entrySpeedKms: after.lastEntry?.evaluation?.speedKms ?? null,
				computerEngaged: after.computerEngaged,
				apertureWidthKm: after.apertureWidthKm,
				apertureHeightKm: after.apertureHeightKm,
				planeKm: after.planeKm,
				axialKm: after.axialKm,
			};
		},
		[dt, LIMIT_S, setup],
	);
}

/**
 * What every run starts from: the standoff and the pools.
 *
 * Spread rather than repeated at three call sites — a retune of the standoff
 * that reached two of them would silently change what the third measures rather
 * than failing.
 */
const BASE = { standoffKm: 3.2, shield: 100, hull: 100 };

const tolerances = await page.evaluate(() => {
	const g = window.__seelite;
	return {
		gateKms: g.dockingTolerances.V_GATE_KMS,
		axisDeg: g.dockingTolerances.AXIS_TOLERANCE_DEG,
	};
});

/**
 * The three rows both failure runs share: a crossing happened, it did not dock,
 * and speed is not what refused it.
 *
 * One helper because the two blocks had it spelled out twice and differing only
 * by label — and because the third row is the one that makes the other two mean
 * anything. A run that failed on the gate would refuse for a reason neither
 * §9.2.4 nor §9.2.5 is about.
 */
function failedEntryUnderGate(what, run) {
	check(`${what}: a crossing happened at all`, run.entry !== null);
	check(`${what} did not dock`, !run.docked);
	check(
		`${what} arrived under the gate, so speed is not what refused it`,
		run.entry?.evaluation?.checks?.closingSpeed === true,
		`${run.entrySpeedKms?.toFixed(4) ?? "no crossing"} km/s against ${tolerances.gateKms}`,
	);
}

// ---------------------------------------------------------------------------
// §9.2.3 — a scripted approach docks
// ---------------------------------------------------------------------------

console.log("\n§9.2.3 a correct profile docks:");
const good = await fly({ ...BASE, computer: true });
console.log(
	`  ${good.id} at ${good.spinRpm.toFixed(2)} rpm: docked=${good.docked} ` +
		`after ${good.elapsed.toFixed(1)} s of sim time, ` +
		`crossing at ${good.entrySpeedKms?.toFixed(4) ?? "?"} km/s ` +
		`against a ${tolerances.gateKms} km/s gate`,
);
if (!good.docked) for (const line of good.trace) console.log(`    ${line}`);
check("the station answered the clearance request", good.cleared);
check(
	// Not `entry === null || ...`, which was the first spelling and is satisfied
	// by the absence of the crossing it claims to measure.
	"the docking computer crossed under the gate",
	good.entry?.evaluation?.checks?.closingSpeed === true,
	`${good.entrySpeedKms?.toFixed(4) ?? "no crossing"} km/s against ${tolerances.gateKms}`,
);
check(
	"a correct profile docks",
	good.docked,
	JSON.stringify(good.entry?.evaluation?.checks ?? null),
);
check(
	"and it took a real approach rather than starting inside",
	good.elapsed > 10,
	`${good.elapsed.toFixed(1)} s`,
);
check(
	"docking cost the ship nothing",
	good.conditionAfter.hull === good.conditionBefore.hull,
);

// Docking is not a one-way latch. Not one of §9.2's five rows — it is a
// property of this node's *wiring* rather than of the model — but it is
// reachable only from a docked ship, which only the probe tier has, and the
// first version of `resolveCrossing` set `dockedAt` and never cleared it.
console.log("\ndocking has an exit:");
if (!good.docked)
	console.log("  skipped: §9.2.3 did not dock, so there is nothing to leave");
const undock = good.docked
	? await page.evaluate(
			async ([dt]) => {
				const g = window.__seelite;
				const D = window.__dock;
				const id = D.spinner().id;
				const wasDocked = g.dockedAt === id;
				const snap = g.dockingSnapshot(id);
				// **Before anything below touches the ship.** `place` sets the throttle to
				// zero itself, so reading it afterwards would assert that `place` works.
				// What is under test is that the dock left no throttle running: the
				// autopilot wrote one on the frame it crossed the plane, and clearing the
				// engaged flag alone left the assist accelerating a docked ship.
				const throttleAfterDock = snap.throttle;
				// Pushed straight back out along the axis, which is the least a launch
				// could possibly be — the sequence itself is not this node's.
				D.place(id, D.scale(snap.axis, snap.planeKm + 0.5), {
					x: 0,
					y: 0,
					z: 0,
				});
				for (let i = 0; i < 20; i++) {
					g.step(dt);
					g.render(dt);
				}
				const after = g.dockingSnapshot(id);
				g.toggleDockingComputer();
				// One step, so what is measured is the autopilot actually flying rather
				// than a flag having been flipped.
				g.step(dt);
				g.render(dt);
				const flying = g.dockingSnapshot(id);
				return {
					engagedAfterStep: flying?.computerEngaged ?? false,
					throttleAfterStep: flying?.throttle ?? 0,
					wasDocked,
					stillDocked: g.dockedAt === id,
					computerCanEngage: g.dockingComputerEngaged,
					// Read **before** the toggle above re-engages anything: what is being
					// asserted is that the dock left the ship at rest, not that the
					// re-engagement did.
					throttle: throttleAfterDock,
					clearKm: g.dockingTolerances.UNDOCK_CLEAR_KM,
					axialKm: after.axialKm,
					planeKm: after.planeKm,
				};
			},
			[dt],
		)
	: null;
if (undock) {
	check("the ship was docked to begin with", undock.wasDocked);
	check(
		"leaving the plane clears the dock",
		!undock.stillDocked,
		`${undock.axialKm.toFixed(3)} km against a ${undock.planeKm.toFixed(3)} km plane ` +
			`plus a ${undock.clearKm} km clearance`,
	);
	check(
		// **After a step**, not straight after the toggle. `toggleDockingComputer`
		// gates only on `hasDockingComputer`, which is a constant `true`, so
		// asserting the flag alone cannot fail. What can fail is
		// `stepDockingComputer`'s `if (… || this.dockedAt) return false` — which
		// is the latch — so the assertion is that the autopilot is *still*
		// engaged and commanding a throttle a step later.
		"and the docking computer flies again after a step",
		undock.engagedAfterStep && undock.throttleAfterStep > 0,
		`engaged=${undock.engagedAfterStep} throttle=${undock.throttleAfterStep}`,
	);
	check(
		"docking left no throttle running",
		undock.throttle === 0,
		`throttle ${undock.throttle}`,
	);
	await page.evaluate(() => {
		window.__seelite.dockingComputerEngaged = false;
		window.__seelite.setThrottle(0);
	});
}

// ---------------------------------------------------------------------------
// §9.2.4 — a hull-face approach is refused
// ---------------------------------------------------------------------------
//
// Inside check 2's cone and outside the aperture. The offset is derived from
// the page's own core radius and tolerance rather than typed: at 0.6 km and 35°
// the cone admits about 0.42 km, four times the slot's half-length.

console.log("\n§9.2.4 a hull-face approach is refused:");
const faceOffsetKm = await page.evaluate((deg) => {
	const g = window.__seelite;
	// The **spinner**, which is the station `fly` actually flies. Taking the
	// nearest station's core radius instead would scale the offset off a body
	// this run never approaches, and the two differing would make §9.2.4 fail on
	// `axisAlignment` rather than on the containment claim it is making.
	const snap = g.dockingSnapshot(window.__dock.spinner().id);
	// Three quarters of the way to the cone's edge: comfortably inside check 2,
	// six times outside check 5, and not sitting on either boundary — a probe
	// that measured a boundary would be re-testing what the headless rows own.
	// Nine tenths was the first figure and it was too close to the edge to
	// survive the axis swinging over a 60 s approach.
	return 0.75 * snap.planeKm * Math.tan((deg * Math.PI) / 180);
}, tolerances.axisDeg);
const face = await fly({
	...BASE,
	offsetKm: faceOffsetKm,
	closingKms: tolerances.gateKms * 0.5,
	rollDeg: 0,
});
if (!face.entry) for (const line of face.trace) console.log(`    ${line}`);
console.log(
	`  offset ${(faceOffsetKm * 1000).toFixed(0)} m against a ` +
		`${(face.apertureWidthKm * 500).toFixed(0)} × ${(face.apertureHeightKm * 500).toFixed(0)} m ` +
		`half-aperture: docked=${face.docked}`,
);
const cornerKm = Math.hypot(
	face.apertureWidthKm / 2,
	face.apertureHeightKm / 2,
);
check(
	// Against the rectangle's **corner radius**, which is the only bound that
	// holds whichever way the reference direction points. Two earlier versions
	// were weaker: the width half alone (which may be the larger of the two
	// while containment judges the smaller), then the larger half-extent (which
	// still leaves the diagonal unproved).
	"the offset really is outside the aperture, in any direction",
	faceOffsetKm > cornerKm,
	`${(faceOffsetKm * 1000).toFixed(0)} m against a ${(cornerKm * 1000).toFixed(0)} m corner radius`,
);
console.log(
	`  at the plane: ${face.entry?.evaluation?.positionAngleDeg?.toFixed(1)}° off the axis by position, ` +
		`${face.entry?.evaluation?.noseAngleDeg?.toFixed(1)}° by nose, against a ${tolerances.axisDeg}° tolerance`,
);
failedEntryUnderGate("the hull-face approach", face);
check(
	"and it failed on containment, not on an angle",
	face.entry?.evaluation?.checks?.containment === false &&
		face.entry?.evaluation?.checks?.axisAlignment === true,
	JSON.stringify(face.entry?.evaluation?.checks ?? null),
);

// ---------------------------------------------------------------------------
// §9.2.5 — a mis-rolled approach fails and survives
// ---------------------------------------------------------------------------

console.log("\n§9.2.5 a mis-rolled approach fails and survives:");
const rolled = await fly({
	...BASE,
	// Just under the gate, so the roll is the **only** row that fails: an
	// approach commanded at exactly `V_GATE` arrives at 1.005× it once the
	// assist's lateral remainder is counted, and a run failing two rows cannot
	// say which one D1 is being demonstrated on. The exactly-at-the-gate claim
	// is §9.1.10's, and it is a unit test because it is arithmetic.
	closingKms: tolerances.gateKms * 0.9,
	rollDeg: 90,
});
if (!rolled.entry) for (const line of rolled.trace) console.log(`    ${line}`);
const lost =
	rolled.conditionBefore.shield +
	rolled.conditionBefore.hull -
	(rolled.conditionAfter.shield + rolled.conditionAfter.hull);
console.log(
	`  90° out just under the gate: docked=${rolled.docked}, ` +
		`pool ${lost.toFixed(1)} lost of ${rolled.poolMax}, alive=${rolled.alive}`,
);
failedEntryUnderGate("the mis-rolled approach", rolled);
check(
	"and it failed on the roll row",
	rolled.entry?.evaluation?.checks?.rollMatch === false,
	JSON.stringify(rolled.entry?.evaluation?.checks ?? null),
);
check("it cost the ship something", lost > 0, `${lost.toFixed(2)} of the pool`);
check("D1: the ship survived it", rolled.alive);
check(
	// The bound is against `poolMax`, so it is only a per-entry bound if the run
	// started from a full pool. Asserted rather than assumed: the reset used to
	// write a field that did not exist, the bound went on passing, and nothing
	// said the pool it was measured against was the pool the run began with.
	"the run started from a full pool, so the bound below is per-entry",
	rolled.conditionBefore.shield + rolled.conditionBefore.hull ===
		rolled.poolMax,
	`${rolled.conditionBefore.shield + rolled.conditionBefore.hull} of ${rolled.poolMax}`,
);
check(
	"D1: it cost at most a quarter of the pool",
	lost <= rolled.poolMax / 4 + 1e-9,
	`${lost.toFixed(2)} of ${rolled.poolMax}`,
);
check(
	"the bounce left the ship outside the station, not in it",
	rolled.axialKm > rolled.planeKm,
	`${rolled.axialKm.toFixed(3)} km against a ${rolled.planeKm.toFixed(3)} km plane`,
);
check(
	"a piloting error is not a protocol violation: the grant survived",
	rolled.grantLive && !rolled.hostile,
);

// ---------------------------------------------------------------------------
// §3's docking director — `hud-and-scanner.md`, the cues #9 left without a
// visual referent.
//
// `docking.md` §3.2 records that check 2's cone and check 4's roll were set
// wide **partly because the instruments did not exist**. The headless tier
// (`tests/docking-director.test.ts`) proves the cue reads the same angle the
// check does; this tier proves the cue reaches the glass, and that it moves
// when the pose does. A cue that agreed with the check and was never painted
// would pass the first tier alone.
// ---------------------------------------------------------------------------

/** Park the ship on the axis at a standoff, point the nose `noseDeg` off the
 *  inward axis and roll it `rollDeg` off the slot, then render one frame and
 *  read what the director actually drew. */
async function directorAt(setup) {
	return page.evaluate(
		async ([dt, setup]) => {
			const g = window.__seelite;
			const D = window.__dock;
			const station = setup.pad
				? g.world.system.contents.stations.find((s) => s.spinRpm === 0)
				: D.spinner();
			if (!station) return { noStation: true };
			const id = station.id;
			const snap = g.dockingSnapshot(id);
			if (!snap) return { noSnapshot: true, id };

			// Rodrigues, page-side: the probe needs a pose *off* the tolerance and
			// the game exposes no rotate. Only used to aim, never to measure — every
			// number checked below is the renderer's own.
			const rotate = (v, k, rad) => {
				const c = Math.cos(rad);
				const s = Math.sin(rad);
				const kv = {
					x: k.y * v.z - k.z * v.y,
					y: k.z * v.x - k.x * v.z,
					z: k.x * v.y - k.y * v.x,
				};
				const kd = k.x * v.x + k.y * v.y + k.z * v.z;
				return D.add(
					D.add(D.scale(v, c), D.scale(kv, s)),
					D.scale(k, kd * (1 - c)),
				);
			};

			D.place(
				id,
				D.add(
					D.scale(snap.axis, snap.planeKm + setup.standoffKm),
					// The **unrolled** reference, for this file's existing reason: a
					// lateral offset stated in the slot's own basis orbits the axis.
					D.scale(snap.reference, setup.lateralKm ?? 0),
				),
				{ x: 0, y: 0, z: 0 },
			);
			g.targetId = id;
			g.dockingComputerEngaged = false;
			g.setHeadLook(setup.headLook ?? "forward");

			const inward = D.scale(snap.axis, -1);
			const nose = rotate(
				inward,
				snap.basis.up,
				((setup.noseDeg ?? 0) * Math.PI) / 180,
			);
			const up = rotate(
				snap.basis.across,
				snap.axis,
				((setup.rollDeg ?? 0) * Math.PI) / 180,
			);
			g.setAttitude(nose, up);

			// **Reset the protocol every run**, for the reason this file already
			// records about the docking computer: §6 state is session state and it
			// survives the run that made it. Without this the uncleared row
			// inherited the previous row's live grant and asserted "no clearance"
			// against a station that had cleared the ship ten minutes ago.
			const held = g.dockingStateOf(id);
			held.clearance = { kind: "none" };
			held.hostile = false;
			held.hostileUntilS = null;

			if (setup.clear) g.requestDockingClearance();
			if (setup.hostile) {
				// **Re-fetched, not `held`.** `requestClearance` is pure and the game
				// stores the *new* state, so the object taken before the request is
				// an orphan the moment a grant lands — mutating it set hostility on
				// nothing and the row read "CLEARED" against a hostile station.
				const current = g.dockingStateOf(id);
				current.hostile = true;
				current.hostileUntilS = g.world.gameTime + 600;
			}

			// A rendered frame, not a computed one: `directorRender` is written by
			// the draw, so an unrendered frame leaves it null and every row below
			// goes red rather than silently reading a state nobody painted.
			g.render(dt);
			const drawn = g.directorRender;
			return {
				id,
				apertureKind: snap.apertureKind,
				drawn: drawn
					? {
							funnelRadiusPx: drawn.funnelRadiusPx,
							centre: drawn.centre,
							axisMarker: drawn.axisMarker,
							rollTicksDeg: drawn.rollTicksDeg,
							rollTickPointsPx: drawn.rollTickPointsPx,
							funnelState: drawn.funnelState,
							clearanceText: drawn.clearanceText,
							blocking: drawn.blocking,
							noseDeg: drawn.state.axis.nose.deg,
							noseWithin: drawn.state.axis.nose.within,
							noseToleranceDeg: drawn.state.axis.nose.toleranceDeg,
							positionDeg: drawn.state.axis.position.deg,
							rollDeg: drawn.state.roll?.deg ?? null,
							rollSignedDeg: drawn.state.rollSignedDeg,
							corridor: drawn.corridor,
							rollWithin: drawn.state.roll?.within ?? null,
							rollToleranceDeg: drawn.state.roll?.toleranceDeg ?? null,
							grantRemainingS: drawn.state.grantRemainingS,
							aligned: drawn.state.aligned,
						}
					: null,
			};
		},
		[dt, setup],
	);
}

const AXIS_DEG = tolerances.axisDeg;
const rollDegOf = await page.evaluate(
	() => window.__seelite.dockingTolerances.ROLL_TOLERANCE_DEG,
);

const inside = await directorAt({
	standoffKm: 3.2,
	noseDeg: AXIS_DEG - 5,
	rollDeg: 0,
	clear: true,
});
check(
	"the director is on the glass on a cleared approach",
	Boolean(inside.drawn) &&
		inside.drawn.funnelRadiusPx > 0 &&
		inside.drawn.axisMarker !== null,
	JSON.stringify(inside.drawn ?? inside),
);
check(
	"the funnel is the axis tolerance, and the nose cue reads inside it",
	inside.drawn?.noseToleranceDeg === AXIS_DEG &&
		Math.abs(inside.drawn.noseDeg - (AXIS_DEG - 5)) < 0.5 &&
		inside.drawn.noseWithin === true,
	`${inside.drawn?.noseDeg?.toFixed(2)}° against ${AXIS_DEG}°`,
);
check(
	"the axis marker sits inside the funnel it is being flown into",
	inside.drawn?.axisMarker !== null &&
		Math.hypot(
			inside.drawn.axisMarker.x - inside.drawn.centre.x,
			inside.drawn.axisMarker.y - inside.drawn.centre.y,
		) < inside.drawn.funnelRadiusPx,
	`${Math.hypot(
		(inside.drawn?.axisMarker?.x ?? 0) - (inside.drawn?.centre?.x ?? 0),
		(inside.drawn?.axisMarker?.y ?? 0) - (inside.drawn?.centre?.y ?? 0),
	).toFixed(
		1,
	)} px against a ${inside.drawn?.funnelRadiusPx?.toFixed(1)} px funnel`,
);

const outside = await directorAt({
	standoffKm: 3.2,
	noseDeg: AXIS_DEG + 5,
	rollDeg: 0,
	clear: true,
});
check(
	// The row that separates a drawn cue from a painted decoration: the same
	// funnel, a pose five degrees the other side of the tolerance, and the
	// verdict has to flip. A director that always read "aligned" passes every
	// row above.
	"five degrees past the tolerance flips the cue, and the marker leaves the funnel",
	outside.drawn?.noseWithin === false &&
		outside.drawn.aligned === false &&
		Math.hypot(
			outside.drawn.axisMarker.x - outside.drawn.centre.x,
			outside.drawn.axisMarker.y - outside.drawn.centre.y,
		) > outside.drawn.funnelRadiusPx,
	`${outside.drawn?.noseDeg?.toFixed(2)}° against ${AXIS_DEG}°`,
);

const misrolled = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: rollDegOf + 8,
	clear: true,
});
check(
	"the roll ring reads check 4's angle and fails past its tolerance",
	inside.drawn?.rollWithin === true &&
		inside.drawn.rollToleranceDeg === rollDegOf &&
		misrolled.drawn?.rollWithin === false &&
		Math.abs(misrolled.drawn.rollDeg - (rollDegOf + 8)) < 0.5,
	`${inside.drawn?.rollDeg?.toFixed(2)}° then ${misrolled.drawn?.rollDeg?.toFixed(2)}° against ${rollDegOf}°`,
);
const counterRolled = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: -(rollDegOf + 8),
	clear: true,
});
check(
	// **Not the gap between the ticks.** The first version asserted
	// `ticks[1] - ticks[0] === rollDeg`, which the draw satisfied by
	// construction — it built the pair *from* that number. This ties the drawn
	// tick to the pose the probe commanded, and it separates the two directions:
	// the symmetric pair it replaced painted +58° and −58° identically.
	//
	// Tick 0 is the **ship**, pinned at screen up because the camera is the
	// ship; tick 1 is the slot's reference, and it is the one that moves.
	"the ring pins the ship at screen up and moves the slot reference by the commanded roll",
	misrolled.drawn?.rollTicksDeg?.[0] === 0 &&
		Math.abs(Math.abs(misrolled.drawn.rollTicksDeg[1]) - (rollDegOf + 8)) <
			0.5 &&
		counterRolled.drawn?.rollTicksDeg?.[0] === 0 &&
		misrolled.drawn.rollTicksDeg[1] * counterRolled.drawn.rollTicksDeg[1] < 0,
	`${JSON.stringify(misrolled.drawn?.rollTicksDeg)} then ${JSON.stringify(
		counterRolled.drawn?.rollTicksDeg,
	)} for ±${rollDegOf + 8}°`,
);
check(
	// The degrees above are the record's; this is where they landed in pixels.
	// A sign flip between the right-handed rotation about the outward axis and
	// canvas's y-down angles satisfies the degree row identically and puts the
	// reference on the wrong side of the pilot's screen — so the side is pinned
	// rather than reasoned about, and the two directions must differ in it.
	"the reference tick lands on opposite sides of the screen for opposite rolls",
	misrolled.drawn?.rollTickPointsPx?.length === 2 &&
		counterRolled.drawn?.rollTickPointsPx?.length === 2 &&
		Math.abs(misrolled.drawn.rollTickPointsPx[0].x - misrolled.drawn.centre.x) <
			1e-6 &&
		(misrolled.drawn.rollTickPointsPx[1].x - misrolled.drawn.centre.x) *
			(counterRolled.drawn.rollTickPointsPx[1].x -
				counterRolled.drawn.centre.x) <
			0,
	`${JSON.stringify(misrolled.drawn?.rollTickPointsPx)} then ${JSON.stringify(
		counterRolled.drawn?.rollTickPointsPx,
	)}`,
);

const offAxis = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: 0,
	lateralKm: 3.4,
	clear: true,
});
check(
	// Check 2's position half is a translation task, so it reads as a bar rather
	// than a second ring — and the bar has to move. On the axis it is empty and
	// green; far enough off it, it is full and amber.
	"the corridor bar fills and fails as the ship leaves the approach axis",
	inside.drawn?.corridor?.within === true &&
		inside.drawn.corridor.fill < 0.05 &&
		offAxis.drawn?.corridor?.within === false &&
		offAxis.drawn.corridor.fill === 1 &&
		offAxis.drawn.positionDeg > AXIS_DEG,
	`${inside.drawn?.corridor?.fill?.toFixed(3)} on axis, ${offAxis.drawn?.corridor?.fill} at ${offAxis.drawn?.positionDeg?.toFixed(1)}°`,
);

const pad = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: 40,
	clear: true,
	pad: true,
});
check(
	// A pad has no long axis to match, so an empty ring would read as a failed
	// one. §4's whole point: the absence has to be an absence.
	"a pad draws no roll ring, and a 40° roll is still aligned there",
	pad.drawn !== null &&
		pad.apertureKind === "pad" &&
		pad.drawn.rollTicksDeg === null &&
		pad.drawn.aligned === true,
	`${pad.apertureKind}, ticks ${JSON.stringify(pad.drawn?.rollTicksDeg ?? null)}`,
);

check(
	"a live grant reads as a positive state with its remaining window",
	inside.drawn?.blocking === false &&
		inside.drawn.grantRemainingS > 0 &&
		/CLEARED/.test(inside.drawn.clearanceText),
	inside.drawn?.clearanceText,
);

const uncleared = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: 0,
	clear: false,
});
check(
	// §3: "a red mark alone never carries the consequence" — the refusal has to
	// be written, and it has to say which refusal it is.
	"an approach with no grant is blocking, and the glass writes the reason",
	uncleared.drawn?.blocking === true &&
		/DO NOT ENTER/.test(uncleared.drawn.clearanceText) &&
		/clearance/i.test(uncleared.drawn.clearanceText),
	uncleared.drawn?.clearanceText,
);

const hostile = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: 0,
	clear: true,
	hostile: true,
});
check(
	"hostility outranks the grant on the glass",
	hostile.drawn?.blocking === true &&
		/hostile/i.test(hostile.drawn.clearanceText),
	hostile.drawn?.clearanceText,
);

check(
	// **The one cue decision the draw makes rather than copies.** Every other
	// browser row above reads a field the director computed and the record
	// carried across unchanged, which the headless tier already covers; a funnel
	// that stayed green past the tolerance would pass all of them.
	"the funnel is painted in the state the cue is in, and a refusal outranks the geometry",
	inside.drawn?.funnelState === "clear" &&
		outside.drawn?.funnelState === "off-axis" &&
		hostile.drawn?.funnelState === "blocked",
	`${inside.drawn?.funnelState} / ${outside.drawn?.funnelState} / ${hostile.drawn?.funnelState}`,
);

const turned = await directorAt({
	standoffKm: 3.2,
	noseDeg: 0,
	rollDeg: 0,
	clear: true,
	headLook: "left",
});
check(
	// The director is glass, and a focused console has replaced the glass. §5's
	// head-turn grammar, applied to the newest thing on it.
	"a head turn takes the director off the glass with everything else on it",
	turned.drawn === null,
	JSON.stringify(turned.drawn),
);
await page.evaluate(() => window.__seelite.setHeadLook("forward"));

await browser.close();
exit();
