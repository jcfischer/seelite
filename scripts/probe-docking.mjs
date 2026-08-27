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
		/**
		 * A stable direction perpendicular to the docking axis.
		 *
		 * **Not** the slot's rolled basis, deliberately. The hull-face run needs a
		 * lateral offset that stays put; the slot's `across` rotates with the
		 * station, so aiming at `across · 315 m` is aiming at a point that orbits
		 * the axis at 0.65 rpm, and the ship spends the approach chasing it round
		 * rather than flying at the hull. The roll *error* is still stated against
		 * the slot's own basis, because that is what check 4 measures.
		 *
		 * Seeded from whichever world axis is least parallel to the docking axis,
		 * which is arbitrary and allowed to be: the claim under test is "inside
		 * check 2's cone and outside the aperture", and the aperture is 120 × 70 m
		 * against a 315 m offset in any direction.
		 */
		perp(axis) {
			const D = window.__dock;
			const seed =
				Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
			const c = {
				x: axis.y * seed.z - axis.z * seed.y,
				y: axis.z * seed.x - axis.x * seed.z,
				z: axis.x * seed.y - axis.y * seed.x,
			};
			return D.scale(c, 1 / Math.hypot(c.x, c.y, c.z));
		},
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
			const seen = g.dockingSnapshot(id);
			const axis = seen.axis;
			const across = seen.basis.across;
			const up = seen.basis.up;

			const start = D.add(
				D.scale(axis, seen.planeKm + setup.standoffKm),
				D.scale(D.perp(axis), setup.offsetKm ?? 0),
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
				if (!setup.computer) {
					// Re-aim every frame at a **point on the station** — the aperture
					// centre, or for the hull-face run the point on the face this run
					// is aimed squarely at. Holding the nose parallel to the axis
					// instead was the first version and it drifted: the axis swings as
					// the station orbits, so a 378 m offset chosen to sit inside
					// check 2's cone had grown to 422 m by the plane and the entry
					// failed on the angle instead of on containment — the run passed
					// while measuring the wrong thing.
					//
					// Speed comes from the throttle, not from writing `ship.vel`. That
					// was the other first version: the assist reads a throttle of zero
					// as "hold station in the local frame" and has 2 km/s² of
					// authority, so it cancelled the whole commanded closing speed
					// inside a single step and nothing ever reached the plane.
					const snap = g.dockingSnapshot(id);
					// The aim point sits **two kilometres past the plane**, not on it.
					// Aiming at the plane itself was the version before this one and
					// the nose went unstable at the end of the run: as the ship
					// arrives, the vector to its own aim point shrinks to nothing and
					// its direction is decided by whatever noise is left, so check 2
					// read 59.5° at the crossing and the entry failed on the nose
					// angle rather than on containment. A point beyond the target is
					// what a pilot flying *through* a face aims at, and it keeps the
					// nose well conditioned all the way in.
					const aim = D.add(
						D.scale(snap.axis, snap.planeKm - 2),
						D.scale(D.perp(snap.axis), setup.offsetKm ?? 0),
					);
					const rad = ((setup.rollDeg ?? 0) * Math.PI) / 180;
					const rolled = D.add(
						D.scale(snap.basis.across, Math.cos(rad)),
						D.scale(snap.basis.up, Math.sin(rad)),
					);
					g.setAttitude(D.toward(id, aim), rolled);
					g.setThrottle(setup.closingKms / g.assistCapKms);
				}
				// A sparse trace, printed only when a run does not do what it was
				// set up to do. A passing run prints its verdict and nothing else;
				// a failing one needs the approach, and reconstructing it from a
				// single end-state sample is guesswork.
				if (i % 50 === 0 && trace.length < 20) {
					const s = g.dockingSnapshot(id);
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
				computerEngaged: after.computerEngaged,
				apertureWidthKm: after.apertureWidthKm,
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
		gateKms: g.docking.V_GATE_KMS,
		axisDeg: g.docking.AXIS_TOLERANCE_DEG,
	};
});

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
		`after ${good.elapsed.toFixed(1)} s of sim time`,
);
if (!good.docked) for (const line of good.trace) console.log(`    ${line}`);
check("the station answered the clearance request", good.cleared);
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
	const snap = g.dockingSnapshot();
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
		`${(face.apertureWidthKm * 500).toFixed(0)} m half-width: docked=${face.docked}`,
);
check(
	"the offset really is outside the aperture",
	faceOffsetKm > face.apertureWidthKm / 2,
	`${(faceOffsetKm * 1000).toFixed(0)} m against ${(face.apertureWidthKm * 500).toFixed(0)} m`,
);
console.log(
	`  at the plane: ${face.entry?.evaluation?.positionAngleDeg?.toFixed(1)}° off the axis by position, ` +
		`${face.entry?.evaluation?.noseAngleDeg?.toFixed(1)}° by nose, against a ${tolerances.axisDeg}° tolerance`,
);
check("a crossing happened at all", face.entry !== null);
check("the hull-face approach did not dock", !face.docked);
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
check("a crossing happened at all", rolled.entry !== null);
check("the mis-rolled approach did not dock", !rolled.docked);
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
