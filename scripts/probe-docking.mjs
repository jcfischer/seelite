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
			g.condition = { shield: setup.shield, hull: setup.hull };
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
			const before = { ...g.condition };
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
const good = await fly({
	standoffKm: 3.2,
	computer: true,
	shield: 100,
	hull: 100,
});
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
const undock = await page.evaluate(
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
		return {
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
);
check("the ship was docked to begin with", undock.wasDocked);
check(
	"leaving the plane clears the dock",
	!undock.stillDocked,
	`${undock.axialKm.toFixed(3)} km against a ${undock.planeKm.toFixed(3)} km plane ` +
		`plus a ${undock.clearKm} km clearance`,
);
check(
	"and the docking computer can be engaged again",
	undock.computerCanEngage,
);
check(
	"docking left no throttle running",
	undock.throttle === 0,
	`throttle ${undock.throttle}`,
);
await page.evaluate(() => {
	window.__seelite.dockingComputerEngaged = false;
});

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
	standoffKm: 3.2,
	offsetKm: faceOffsetKm,
	closingKms: tolerances.gateKms * 0.5,
	rollDeg: 0,
	shield: 100,
	hull: 100,
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
	standoffKm: 3.2,
	// Just under the gate, so the roll is the **only** row that fails: an
	// approach commanded at exactly `V_GATE` arrives at 1.005× it once the
	// assist's lateral remainder is counted, and a run failing two rows cannot
	// say which one D1 is being demonstrated on. The exactly-at-the-gate claim
	// is §9.1.10's, and it is a unit test because it is arithmetic.
	closingKms: tolerances.gateKms * 0.9,
	rollDeg: 90,
	shield: 100,
	hull: 100,
});
if (!rolled.entry) for (const line of rolled.trace) console.log(`    ${line}`);
const lost =
	rolled.conditionBefore.shield +
	rolled.conditionBefore.hull -
	(rolled.conditionAfter.shield + rolled.conditionAfter.hull);
console.log(
	`  90° out just under the gate: docked=${rolled.docked}, ` +
		`pool ${lost.toFixed(1)} lost of 200, alive=${rolled.alive}`,
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
	"D1: it cost at most a quarter of the pool",
	lost <= 200 / 4 + 1e-9,
	`${lost.toFixed(2)} of 200`,
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

await browser.close();
exit();
