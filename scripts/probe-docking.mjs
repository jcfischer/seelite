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
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = gameUrl(ORIGIN, { seed: 42 }, { override: process.env.PROBE_URL });

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
			// which needs a direction that does not rotate. Zero is `basis.up`
			// since #158: the ship's up on the slot's short axis, so its beam
			// lies along the long one.
			const rolled = D.add(
				D.scale(snap.basis.up, Math.cos(rad)),
				D.scale(snap.basis.across, -Math.sin(rad)),
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
			const up = seen.basis.up;

			const start = D.add(
				D.scale(axis, seen.planeKm + setup.standoffKm),
				D.scale(seen.reference, setup.offsetKm ?? 0),
			);
			D.place(id, start, { x: 0, y: 0, z: 0 });
			g.targetId = id;
			// **A per-run reset to the page's own full condition.** An earlier
			// version wrote a renamed field's old name: it silently created a stray
			// property, no reset landed, and §9.2.5's "at most a quarter of the
			// pool" quietly became a cumulative measurement across every run before
			// it. A write to a page object cannot fail, so the next line throws
			// when the field it replaces is not there.
			if (!("condition" in g)) throw new Error("Game has no `condition`");
			g.condition = structuredClone(g.dockingSnapshot(id).conditionFull);
			g.lastEntry = null;
			// **The session, not a `dockedAt` flag.** #77 replaced the nullable id
			// with §12's state machine, and `dockedAt` is a derived getter now.
			// Resetting the session is also what a run *needs*: while it is not
			// `flying`, `step` runs the arrival and ignores every input, so a run
			// that inherited a docked session from the one before it would fly
			// nothing at all — which is exactly what the four §9.2.4 and §9.2.5
			// rows reported when this line was still the old one.
			g.resetDock();

			const cleared = g.requestDockingClearance();

			// **Disengaged first, every run.** The computer is session state and it
			// survives a run that never docked, so the second scripted approach
			// inherited an autopilot still flying the first one — it overrode the
			// throttle and the attitude every frame and the run measured the
			// computer under a name that said "hand-flown".
			g.dockingComputerEngaged = false;
			if (setup.computer) {
				{
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
			} else {
				// A hand-flown profile, aimed at a fixed point on the station and
				// re-aimed every frame below. The loop owns the aiming; this only sets
				// the first attitude so the ship does not spend its first frames
				// turning out of whatever the previous run left it in.
				// **`up`, check 4's zero since #158.** The seed was `across`, which
				// under the corrected check is a 90° mis-roll — the opposite of what
				// the line is for. Harmless, because `reaim` overwrites the attitude
				// every frame, and wrong for exactly as long as nobody read it.
				g.setAttitude(D.scale(axis, -1), up);
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
			if (!after) return { noSnapshot: true, id };
			return {
				id,
				spinRpm: station.spinRpm,
				elapsed,
				cleared: cleared.id !== null,
				grantLive: after.grantLive,
				// **Both: the verdict *and* the state it hands over to.** The loop
				// above stops at the crossing, and since #77 a passed entry hands over
				// to a five-second arrival before `dockedAt` is anything — so the
				// verdict alone is what §9.2 is about. But a build that evaluated
				// `docked` and never entered the session would keep every row here
				// green, which is the regression #77 exists to have fixed.
				docked:
					after.lastEntry?.docked === true &&
					after.dockPhase !== "flying" &&
					// **Scoped to this station**, which the old `after.dockedAt === id`
					// carried and the first rewrite dropped: `dockPhase` is true of an
					// arrival at *any* station, so without this a run that docked
					// somewhere else would report the row green.
					g.dock.stationId === id,
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
const BASE = { standoffKm: 3.2 };

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

// Docking has an exit, and since #77 the exit is §12.2's launch rather than a
// range test. Not one of §9.2's five rows — it is a property of this node's
// *wiring* rather than of the model — but it is reachable only from a docked
// ship, which only the probe tier has, and the first version of
// `resolveCrossing` set `dockedAt` and never cleared it.
//
// **`UNDOCK_CLEAR_KM` retired with #77** and this block changed with it. It
// used to teleport the ship out past a clearance radius and assert the flag had
// dropped; #68 shipped that radius as an anti-latch measure and said so in its
// own docstring. §12.2 designed leaving, so the ship now *launches* — and what
// this asserts is the same thing it always did: that the state ends, and the
// autopilot flies again afterwards.
console.log("\ndocking has an exit:");
if (!good.docked)
	console.log("  skipped: §9.2.3 did not dock, so there is nothing to leave");
const undock = good.docked
	? await page.evaluate(
			async ([dt]) => {
				const g = window.__seelite;
				const D = window.__dock;
				const id = D.spinner().id;
				const snap = g.dockingSnapshot(id);
				// **Before anything below touches the ship.** What is under test is that
				// the dock left no throttle running: the autopilot wrote one on the frame
				// it crossed the plane, and clearing the engaged flag alone left the
				// assist accelerating a docked ship.
				const throttleAfterDock = snap.throttle;
				// The arrival has to finish before a launch is possible — E5 parks the
				// ship first, and `requestLaunch` refuses from any other state.
				for (let i = 0; i < 60 * 20; i++) {
					g.step(dt);
					g.render(dt);
					if (g.dockingSnapshot(id).dockPhase === "docked") break;
				}
				const wasDocked = g.dockedAt === id;
				// **`persistent-world-state.md` §9.10's docking channel, at the
				// one place it is actually reachable.** The write lives in
				// `main.ts`'s crossing handler, so no headless tier touches it:
				// `world-state.test.ts` proves `observeDocking` does the right
				// thing to a world, and nothing proved the game ever calls it.
				// The row is read *before* the launch below, because launching
				// is what leaves the station.
				const station = g.world.system.contents.stations.find(
					(s) => s.id === id,
				);
				const dockedKnowledge = (() => {
					const env = g.commerceWorld.galaxies[g.world.system.record.galaxy];
					// **The whole key, never a suffix of it, and the game's own
					// `carrierKey` rather than a second copy of its format.**
					// Written as an `endsWith` over every row in the galaxy
					// first: the four `station-*` ids are not suffixes of each
					// other so it held at this seed, but it drops the system
					// index, and after a jump the first inserted
					// `*:station-refinery` from some other system wins — the
					// check named "the station it docked at" would then be
					// reading a carrier the ship never visited. Spelling the
					// key out here was the same mistake one layer up:
					// `persistent-world-state.md` §2 owns that shape.
					const key = g.carrierKey(
						g.world.system.record.index,
						station?.localCarrierId,
					);
					const row = env?.knowledge?.[key];
					return {
						key,
						type: station?.type ?? null,
						source: row?.source ?? null,
						observedAt: row?.observedAt ?? null,
						marker: row?.knownPrivateFacts?.blackMarket ?? null,
					};
				})();
				// This section verifies the docking session's exit and re-entry latch,
				// not shared Traffic ordering (the route probe owns both older-turn and
				// active-lane cases). Isolate the session so a legitimate older Traffic
				// launch cannot turn this into a second arbitration test.
				g.clearTrafficPresentation();
				g.trafficSystemIndex = g.world.system.record.index;
				g.trafficActors = [];
				g.trafficWarmIndex = 0;
				g.trafficTick = Math.floor(g.world.gameTime * 10 + 1e-8);
				const launched = g.launch();
				// Obligation 5: a launch is unconditionally skippable.
				const skipped = g.skipDockTraversal();
				for (let i = 0; i < 60; i++) {
					g.step(dt);
					g.render(dt);
				}
				const after = g.dockingSnapshot(id);
				// **A fresh grant first, since §13.2.** The outward crossing spends
				// the clearance along with the berth it reserved — a grant that
				// outlived its berth is one no berth answers for — so the autopilot
				// refuses with `no-clearance` rather than flying, and this row would
				// go red for a reason it is not about. Re-requesting is free (§6).
				// What is under test is the *latch*: that leaving the dock lets the
				// computer fly again.
				g.targetId = id;
				g.requestDockingClearance();
				{
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
				// One step, so what is measured is the autopilot actually flying rather
				// than a flag having been flipped.
				g.step(dt);
				g.render(dt);
				const flying = g.dockingSnapshot(id);
				const arrivalQueued =
					g.playerLaneRequests.get(id)?.movement === "arrival";
				return {
					engagedAfterStep: flying?.computerEngaged ?? false,
					throttleAfterStep: flying?.throttle ?? 0,
					arrivalQueued,
					wasDocked,
					dockedKnowledge,
					launched,
					skipped,
					stillDocked: g.dockedAt === id,
					phase: after.dockPhase,
					computerCanEngage: g.dockingComputerEngaged,
					throttle: throttleAfterDock,
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
		"docking observed the station it docked at",
		undock.dockedKnowledge.source === "docking" &&
			Number.isFinite(undock.dockedKnowledge.observedAt),
		`${undock.dockedKnowledge.type} ${undock.dockedKnowledge.key}: source ${undock.dockedKnowledge.source} at ${undock.dockedKnowledge.observedAt}`,
	);
	/**
	 * **The fence arm of §9.10's docking channel is not covered, and this says
	 * so rather than pretending.**
	 *
	 * The previous version asserted `(type === "refinery") === (marker !== null)`
	 * and was sold as "a marker exactly when the station is a refinery". This
	 * fixture docks at `D.spinner()`, and `station.ts` gives `spins: false` to
	 * the refinery and the outpost — so `type` is never `refinery` here and the
	 * biconditional collapses to `marker === null`, which any non-refinery
	 * docking satisfies.
	 * A build that never wrote a refinery marker at all passed it.
	 *
	 * Half of it is real and stays above: a non-refinery docking must *not*
	 * manufacture a marker. The other half needs a docking at a refinery, which
	 * is a different approach profile and a different probe. **This asserts the
	 * fixture's shape instead**, so the day it does yield a refinery the row goes
	 * red and whoever sees it writes the arm rather than inheriting a check that
	 * silently covers one side.
	 */
	check(
		"a non-refinery docking manufactures no fence marker — and this fixture has only those",
		undock.dockedKnowledge.type !== "refinery" &&
			undock.dockedKnowledge.marker === null,
		`docked at a ${undock.dockedKnowledge.type}, marker ${JSON.stringify(undock.dockedKnowledge.marker)} — the refinery arm is unproven in this tier`,
	);
	check("§12.2's launch is accepted from a docked ship", undock.launched);
	check(
		"and it is unconditionally skippable (§12.6 obligation 5)",
		undock.skipped,
	);
	check(
		// **Both halves measured, not one asserted and the other printed.** The
		// first version of this row named the position and tested only the phase,
		// leaving `axialKm` and `planeKm` in the message string alone — a name that
		// claims more than its predicate is the same defect as prose that claims
		// more than its code.
		"launching clears the dock and releases the ship outside the plane",
		!undock.stillDocked &&
			undock.phase === "flying" &&
			undock.axialKm > undock.planeKm,
		`${undock.phase}, at ${undock.axialKm.toFixed(3)} km against a ${undock.planeKm.toFixed(3)} km plane`,
	);

	check(
		// **After a step**, not straight after the toggle. `toggleDockingComputer`
		// gates only on `hasDockingComputer`, which this run makes true by fitting
		// the computer, so asserting the flag alone cannot fail. What can fail is
		// `stepDockingComputer`'s `if (… || this.dockedAt) return false` — which
		// is the latch — so the assertion is that the autopilot is *still*
		// engaged and commanding a throttle a step later.
		"and the docking computer controls the next approach after a step",
		undock.engagedAfterStep &&
			(undock.throttleAfterStep > 0 || undock.arrivalQueued),
		`engaged=${undock.engagedAfterStep} throttle=${undock.throttleAfterStep} arrivalQueued=${undock.arrivalQueued}`,
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

// A nearby trajectory can cross the *infinite mathematical plane* that carries
// the aperture without crossing the station. The principal reproduced this at
// 1.6 km with no request, impact, or attempted entry; it must remain an inert
// fly-by rather than silently creating a hostile protocol state.
console.log("\npassive station fly-by:");
const passiveFlyby = await page.evaluate(() => {
	const g = window.__seelite;
	const D = window.__dock;
	const id = D.spinner().id;
	g.dockingComputerEngaged = false;
	g.dockingStates.delete(id);
	g.resetDock();
	g.lastEntry = null;
	const snap = g.dockingSnapshot(id);
	const lateral = D.scale(snap.reference, 1.6);
	const beforeRel = D.add(D.scale(snap.axis, snap.planeKm + 0.01), lateral);
	D.place(id, beforeRel, D.scale(snap.axis, -0.2));
	const before = g.dockingApproaches();
	const afterRel = D.add(D.scale(snap.axis, snap.planeKm - 0.01), lateral);
	D.place(id, afterRel, D.scale(snap.axis, -0.2));
	g.stepDocking(before);
	const after = g.dockingSnapshot(id);
	return {
		rangeKm: after.rangeKm,
		hostile: after.hostile,
		entry: after.lastEntry,
	};
});
check(
	"crossing the aperture plane 1.6 km off the station is only a passive fly-by",
	passiveFlyby.rangeKm > 1.5 &&
		passiveFlyby.hostile === false &&
		passiveFlyby.entry === null,
	JSON.stringify(passiveFlyby),
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
// Over all three pools, so a hit that landed in the wrong one still counts as
// lost; the row after `failedEntryUnderGate` says which pool it was.
const pools = (c) => c.fore + c.aft + c.hull;
// What a head-on entry can reach, which §2.1's bound and `poolMax` are against.
const headOn = (c) => c.fore + c.hull;
const lost = pools(rolled.conditionBefore) - pools(rolled.conditionAfter);
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
check(
	// §2: the incoming direction selects the pool. A nose-first entry meets the
	// station ahead, so it is the fore shield and never the aft.
	"the entry struck the fore shield, not the aft",
	rolled.conditionAfter.fore < rolled.conditionBefore.fore &&
		rolled.conditionAfter.aft === rolled.conditionBefore.aft,
	`fore ${rolled.conditionBefore.fore}→${rolled.conditionAfter.fore}, ` +
		`aft ${rolled.conditionBefore.aft}→${rolled.conditionAfter.aft}`,
);
check("D1: the ship survived it", rolled.alive);
check(
	// The bound is against `poolMax`, so it is only a per-entry bound if the run
	// started from a full pool. Asserted rather than assumed: the reset used to
	// write a field that did not exist, the bound went on passing, and nothing
	// said the pool it was measured against was the pool the run began with.
	"the run started from a full pool, so the bound below is per-entry",
	headOn(rolled.conditionBefore) === rolled.poolMax,
	`${headOn(rolled.conditionBefore)} of ${rolled.poolMax}`,
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

// `in-system-travel.md` §4: re-entering cruise is a spool-up **cancelled by
// damage**. Behavioural rather than a source scan: arm a spool-up, land damage
// through the game's own funnel, and read the spool back. The condition is
// restored afterwards so no later row inherits the hit.
const spool = await page.evaluate(() => {
	const g = window.__seelite;
	const saved = structuredClone(g.condition);
	g.spoolLeftS = 2;
	g.takeDamage(1, "fore", "probe damage");
	const after = { spoolLeftS: g.spoolLeftS, lastExit: g.lastExit };
	g.condition = saved;
	return after;
});
check(
	"damage cancels a cruise spool-up and says why",
	spool.spoolLeftS === 0 &&
		spool.lastExit === "spool-up cancelled — probe damage",
	JSON.stringify(spool),
);

// ---------------------------------------------------------------------------
// §3's docking director — `hud-and-scanner.md` §3, rebuilt as a corridor.
//
// The headless tiers own the arithmetic: `tests/docking-director.test.ts`
// sweeps the cue against checks 2 and 4, and `tests/docking-tunnel.test.ts`
// proves the corridor is a sufficient condition for the position half and for
// containment. What is left for this tier is what only a rendered frame can
// answer — that the corridor reaches the glass, that the nose gauge moves with
// the pose, and that the director stays inside the canopy instead of drawing
// over the physical cockpit, which is the defect the first build shipped with.
// ---------------------------------------------------------------------------

/**
 * Park the ship on the axis at a standoff, point the nose `noseDeg` off the
 * inward axis, roll it `rollDeg` off the slot, render one frame, and read both
 * what the director recorded and what reached the overlay.
 */
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
			// the game exposes no rotate. Only used to aim, never to measure.
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
					// The **unrolled** reference: a lateral offset stated in the slot's
					// own basis would orbit the axis as the station turns.
					D.scale(snap.reference, setup.lateralKm ?? 0),
				),
				{ x: 0, y: 0, z: 0 },
			);
			g.targetId = id;
			g.dockingComputerEngaged = false;
			g.setHeadLook(setup.headLook ?? "forward");

			const inward = D.scale(snap.axis, -1);
			// Yaw about the slot's `up`, then pitch about its `across`. The pitch
			// exists so a row can put the corridor low in the frame, where the clip
			// line is, rather than only ever on the horizon.
			const nose = rotate(
				rotate(inward, snap.basis.up, ((setup.noseDeg ?? 0) * Math.PI) / 180),
				snap.basis.across,
				((setup.pitchDeg ?? 0) * Math.PI) / 180,
			);
			const up = rotate(
				// Check 4's zero (#158) — the short axis, not the long one.
				snap.basis.up,
				snap.axis,
				((setup.rollDeg ?? 0) * Math.PI) / 180,
			);
			g.setAttitude(nose, up);

			// **Reset the protocol every run.** §6 state is session state and it
			// survives the run that made it — without this, a row asserting the
			// director is *absent* inherits the previous row's live grant.
			const held = g.dockingStateOf(id);
			held.clearance = { kind: "none" };
			held.hostile = false;
			held.hostileUntilS = null;

			if (setup.clear) g.requestDockingClearance();
			if (setup.deny) {
				// Re-fetched: `requestClearance` is pure and the game stores the *new*
				// state, so an object taken before the request is an orphan.
				g.dockingStateOf(id).clearance = {
					kind: "denied",
					reason: "contraband",
				};
			}
			if (setup.hostile) {
				const current = g.dockingStateOf(id);
				current.hostile = true;
				current.hostileUntilS = g.world.gameTime + 600;
			}

			g.render(dt);
			const drawn = g.directorRender;

			// **What the record cannot honestly self-report.** `directorRender` is
			// assembled at the end of the draw whether or not the strokes landed, so
			// deleting every `ctx.stroke()` would leave every field below unchanged.
			// This reads the overlay's own pixels.
			//
			// The sample geometry is **passed in**, never taken from the record:
			// deriving it from `drawn` makes every control frame vacuous, because
			// `drawn` is null on exactly the frames a control needs to read.
			const overlay = document.getElementById("overlay");
			const ringPoints = (region) => {
				const points = [];
				for (let i = 0; i < 24; i++) {
					const a = (i / 24) * Math.PI * 2;
					points.push({
						x: Math.round(region.x + Math.cos(a) * region.r),
						y: Math.round(region.y + Math.sin(a) * region.r),
					});
				}
				return points;
			};
			const gridPoints = (region) => {
				const points = [];
				for (let i = 0; i < region.samples; i++)
					for (let j = 0; j < region.samples; j++)
						points.push({
							x: Math.round(
								region.x0 +
									((region.x1 - region.x0) * i) / (region.samples - 1),
							),
							y: Math.round(
								region.y0 +
									((region.y1 - region.y0) * j) / (region.samples - 1),
							),
						});
				return points;
			};

			const sample = (region) => {
				if (!region || !overlay)
					return { where: [], hits: 0, colour: null, count: 0 };
				const octx = overlay.getContext("2d");
				const points =
					region.kind === "ring" ? ringPoints(region) : gridPoints(region);

				// **One readback over the whole region, then indexed.** Each
				// `getImageData` is a synchronous read off an accelerated canvas, and
				// the grid regions are hundreds of points — a per-point call was
				// hundreds of stalls where one box read does.
				// Reduced rather than spread: `Math.min(...xs)` passes one argument per
				// point, which is fine at 22 x 22 and throws on the argument limit a
				// couple of doublings later.
				let minX = Number.POSITIVE_INFINITY;
				let minY = Number.POSITIVE_INFINITY;
				let maxX = Number.NEGATIVE_INFINITY;
				let maxY = Number.NEGATIVE_INFINITY;
				for (const point of points) {
					if (point.x < minX) minX = point.x;
					if (point.y < minY) minY = point.y;
					if (point.x > maxX) maxX = point.x;
					if (point.y > maxY) maxY = point.y;
				}
				const x0 = Math.max(0, minX - 2);
				const y0 = Math.max(0, minY - 2);
				const x1 = Math.min(overlay.width, maxX + 3);
				const y1 = Math.min(overlay.height, maxY + 3);
				if (x1 <= x0 || y1 <= y0)
					return { where: [], hits: 0, colour: null, count: 0 };
				const box = octx.getImageData(x0, y0, x1 - x0, y1 - y0);
				const at = (px, py) => {
					if (px < x0 || py < y0 || px >= x1 || py >= y1) return null;
					const i = ((py - y0) * box.width + (px - x0)) * 4;
					return box.data[i + 3] > 0
						? [box.data[i], box.data[i + 1], box.data[i + 2]]
						: null;
				};

				let hits = 0;
				const hitPoints = [];
				const counts = {};
				for (const point of points) {
					let found = null;
					for (let dy = -1; dy <= 1 && !found; dy++)
						for (let dx = -1; dx <= 1 && !found; dx++)
							found = at(point.x + dx, point.y + dy);
					if (found) {
						hits++;
						// Up to eight hit coordinates, carried purely so a failing row can
						// say *where*. This is how the clip row's first version was caught
						// reading the debug HUD's text instead of the director's ink.
						if (hitPoints.length < 8) hitPoints.push([point.x, point.y]);
						// Quantised to 32-level channels: an anti-aliased stroke lands a
						// dozen near-identical shades, which splits its own count and
						// leaves no majority. The probe never names a colour.
						const key = found.map((c) => c >> 5).join(",");
						counts[key] = (counts[key] ?? 0) + 1;
					}
				}
				const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
				return {
					where: hitPoints,
					hits,
					colour: dominant ? dominant[0] : null,
					count: dominant ? dominant[1] : 0,
				};
			};

			const ringSample = sample(setup.sampleRing);
			const belowSample = sample(setup.sampleBelow);
			const aboveSample = sample(setup.sampleAbove);

			return {
				id,
				apertureKind: snap.apertureKind,
				overlayHeight: overlay ? overlay.height : 0,
				ringSample,
				belowSample,
				aboveSample,
				drawn: drawn
					? {
							funnelRadiusPx: drawn.funnelRadiusPx,
							centre: drawn.centre,
							axisMarker: drawn.axisMarker,
							markerOffScale: drawn.markerOffScale,
							tunnelRingsDrawn: drawn.tunnelRingsDrawn,
							throatCornersPx: drawn.throatCornersPx,
							funnelState: drawn.funnelState,
							clearanceText: drawn.clearanceText,
							blocking: drawn.blocking,
							noseDeg: drawn.state.axis.nose.deg,
							noseWithin: drawn.state.axis.nose.within,
							noseToleranceDeg: drawn.state.axis.nose.toleranceDeg,
							positionDeg: drawn.state.axis.position.deg,
							rollDeg: drawn.state.roll?.deg ?? null,
							rollWithin: drawn.state.roll?.within ?? null,
							grantRemainingS: drawn.state.grantRemainingS,
							aligned: drawn.state.aligned,
							rangeKm: drawn.state.rangeKm,
							tunnelRings: drawn.state.tunnel.rings.length,
							throatHalfWidthKm: drawn.state.tunnel.throat.halfWidthKm,
							mouthHalfWidthKm: drawn.state.tunnel.rings.at(-1).halfWidthKm,
						}
					: null,
			};
		},
		[dt, setup],
	);
}

const AXIS_DEG = tolerances.axisDeg;
const directorRangeKm = await page.evaluate(
	() => window.__seelite.directorRangeKm,
);
/** Read off the page rather than restated: the clip line is the renderer's. */
const GLASS_BOTTOM = await page.evaluate(
	() => window.__seelite.glassBottomFraction,
);

/** What every director row starts from — spread rather than repeated, for the
 *  reason `BASE` above exists. */
const APPROACH = {
	standoffKm: BASE.standoffKm,
	noseDeg: 0,
	rollDeg: 0,
	clear: true,
};

const inside = await directorAt({ ...APPROACH, noseDeg: AXIS_DEG - 5 });
check(
	"the director is on the glass on a cleared approach",
	Boolean(inside.drawn) &&
		inside.drawn.funnelRadiusPx > 0 &&
		Boolean(inside.drawn.axisMarker),
	JSON.stringify(inside.drawn ?? inside),
);

// ---------------------------------------------------------------------------
// The corridor
// ---------------------------------------------------------------------------

check(
	"the corridor is drawn, and its throat is the aperture while its mouth is not",
	inside.drawn?.tunnelRingsDrawn > 0 &&
		inside.drawn.tunnelRings > 1 &&
		Math.abs(inside.drawn.throatHalfWidthKm - inside.drawn.mouthHalfWidthKm) >
			1e-6 &&
		inside.drawn.mouthHalfWidthKm > inside.drawn.throatHalfWidthKm,
	`${inside.drawn?.tunnelRingsDrawn}/${inside.drawn?.tunnelRings} rings drawn; ` +
		`throat ${inside.drawn?.throatHalfWidthKm?.toFixed(4)} km, mouth ${inside.drawn?.mouthHalfWidthKm?.toFixed(4)} km`,
);

/**
 * The screen-space tilt of the corridor's throat, degrees, folded to (−90, 90].
 *
 * This is the reading the roll ticks used to give. "The rectangle turns with
 * the slot" is a fact about the geometry and is checked headless; whether a
 * *rolled pilot* can read a roll error off the drawn corridor is a fact about
 * the glass, and only a rendered frame answers it.
 */
const fold = (deg) => {
	let d = deg;
	while (d > 90) d -= 180;
	while (d <= -90) d += 180;
	return d;
};

const throatTiltDeg = (measured) => {
	const corners = measured.drawn?.throatCornersPx;
	if (!corners || corners.length !== 4) return null;
	// The rectangle's width edge: corner 0 to corner 1 is `across` in the draw.
	const dx = corners[1].x - corners[0].x;
	// Canvas y grows downward, so negate to read as a normal angle.
	const dy = -(corners[1].y - corners[0].y);
	return fold((Math.atan2(dy, dx) * 180) / Math.PI);
};

/**
 * The relation, measured and then pinned: the drawn corridor's width edge sits
 * at `−roll`, folded.
 *
 * **The offset was 90° until #158**, when the fixtures put the ship's up along
 * the slot's *width* and the rectangle's width edge therefore stood vertical on
 * the glass at zero roll. Check 4's zero is the slot's short axis now, so at
 * zero roll the ship's beam and the throat's width edge are the same direction
 * and the edge lies flat — the intercept moved, and only the intercept.
 *
 * The slope is unchanged and is the thing the row is for: exactly one degree of
 * tilt per degree of roll, because the corridor is a world object and the
 * camera is what turns.
 */
const rollSamples = [];
for (const rollDeg of [-30, -12, 0, 12, 30]) {
	const measured = await directorAt({ ...APPROACH, rollDeg });
	rollSamples.push({ rollDeg, tiltDeg: throatTiltDeg(measured) });
}
check(
	// **The row that says the corridor carries check 4.** The roll ticks are
	// gone, and "the rectangle turns with the slot" — the headless row — is a
	// fact about the geometry that says nothing about whether a rolled pilot can
	// read a roll error off the glass. A corridor that ignored the slot's phase
	// would sit at one tilt for every roll and fail this.
	"the drawn throat's tilt tracks the ship's roll, one degree for one",
	rollSamples.every(
		(sample) =>
			sample.tiltDeg !== null &&
			Math.abs(fold(-sample.rollDeg - sample.tiltDeg)) < 1,
	),
	rollSamples.map((s) => `${s.rollDeg}°→${s.tiltDeg?.toFixed(1)}°`).join("  "),
);

const beyondMouth = await directorAt({ ...APPROACH, standoffKm: 3.2 });
const throughMouth = await directorAt({ ...APPROACH, standoffKm: 2.2 });
check(
	"the fixed corridor holds its mouth as the ship closes",
	Math.abs(
		(beyondMouth.drawn?.mouthHalfWidthKm ?? Number.NaN) -
			(throughMouth.drawn?.mouthHalfWidthKm ?? Number.NaN),
	) < 1e-6,
	`${beyondMouth.drawn?.mouthHalfWidthKm?.toFixed(3)} km outside, ` +
		`${throughMouth.drawn?.mouthHalfWidthKm?.toFixed(3)} km through`,
);
check(
	"rings are omitted as the ship passes through the fixed corridor",
	(beyondMouth.drawn?.tunnelRingsDrawn ?? 0) >
		(throughMouth.drawn?.tunnelRingsDrawn ?? Number.POSITIVE_INFINITY) &&
		(throughMouth.drawn?.tunnelRingsDrawn ?? 0) > 0,
	`${beyondMouth.drawn?.tunnelRingsDrawn}/${beyondMouth.drawn?.tunnelRings} outside, ` +
		`${throughMouth.drawn?.tunnelRingsDrawn}/${throughMouth.drawn?.tunnelRings} through`,
);

// ---------------------------------------------------------------------------
// The nose gauge
// ---------------------------------------------------------------------------

const markerFraction = (measured) =>
	Math.hypot(
		measured.drawn.axisMarker.x - measured.drawn.centre.x,
		measured.drawn.axisMarker.y - measured.drawn.centre.y,
	) / measured.drawn.funnelRadiusPx;

check(
	// **The ring is a gauge, not a projection**, and this is what that means: the
	// marker sits at the error as a fraction of the tolerance. A true projection
	// of a 35° cone at this field of view is 1.21 times half the canvas height —
	// larger than the screen — which is why the first build read as arcs running
	// off every edge.
	"the nose marker sits at the error as a fraction of the tolerance",
	Boolean(inside.drawn?.axisMarker) &&
		Math.abs(markerFraction(inside) - (AXIS_DEG - 5) / AXIS_DEG) < 0.02 &&
		inside.drawn.noseWithin === true &&
		inside.drawn.markerOffScale === false,
	`${markerFraction(inside).toFixed(3)} of the ring for ${inside.drawn?.noseDeg?.toFixed(1)}° of ${AXIS_DEG}°`,
);

const outside = await directorAt({ ...APPROACH, noseDeg: AXIS_DEG + 5 });
check(
	"five degrees past the tolerance puts the marker outside the ring",
	outside.drawn?.noseWithin === false &&
		outside.drawn.aligned === false &&
		markerFraction(outside) > 1,
	`${markerFraction(outside).toFixed(3)} of the ring for ${outside.drawn?.noseDeg?.toFixed(1)}°`,
);

const wayOff = await directorAt({ ...APPROACH, noseDeg: 170 });
check(
	// Past the gauge's range the marker stops moving, and says so — a marker
	// silently pinned to the rim reads as "nearly there" while the pilot is
	// facing away from the station.
	"a nose pointing away is off-scale rather than pinned at the rim",
	wayOff.drawn?.markerOffScale === true &&
		// The clamp, against what an unclamped gauge would have drawn: 170° of a
		// 35° tolerance is 4.86 rings out, so a marker that simply scaled would be
		// far off the canvas. The first version compared the clamped value against
		// three times another clamped value and held by construction.
		markerFraction(wayOff) < (170 / AXIS_DEG) * 0.5 &&
		markerFraction(wayOff) > 1,
	`${markerFraction(wayOff).toFixed(3)} of the ring for ${wayOff.drawn?.noseDeg?.toFixed(1)}°, against ${(170 / AXIS_DEG).toFixed(2)} unclamped`,
);

// ---------------------------------------------------------------------------
// When the director is on the glass at all
// ---------------------------------------------------------------------------

const unasked = await directorAt({ ...APPROACH, clear: false });
check(
	// Requesting clearance is what turns the instrument on. The first build gated
	// on `VICINITY_KM` — §6's ten-thousand kilometre *request* range — and put a
	// funnel on glass through most of ordinary flight.
	"an approach with no clearance requested has no director at all",
	unasked.drawn === null,
	JSON.stringify(unasked.drawn),
);

const distant = await directorAt({
	...APPROACH,
	standoffKm: directorRangeKm * 2,
});
check(
	"beyond the approach range it is off, however good the clearance",
	distant.drawn === null,
	`${directorRangeKm} km range; drawn: ${JSON.stringify(distant.drawn)}`,
);

const denied = await directorAt({ ...APPROACH, clear: false, deny: true });
check(
	// §3: "a red mark alone never carries the consequence" — a refusal keeps the
	// director precisely so it can be written.
	"a denied approach keeps the director and writes the reason",
	denied.drawn?.blocking === true &&
		/DO NOT ENTER/.test(denied.drawn.clearanceText) &&
		/contraband/i.test(denied.drawn.clearanceText),
	denied.drawn?.clearanceText,
);

check(
	"a live grant reads as a positive state with its remaining window",
	inside.drawn?.blocking === false &&
		inside.drawn.grantRemainingS > 0 &&
		/CLEARED/.test(inside.drawn.clearanceText),
	inside.drawn?.clearanceText,
);

const hostile = await directorAt({ ...APPROACH, hostile: true });
check(
	"hostility outranks the grant on the glass",
	hostile.drawn?.blocking === true &&
		/hostile/i.test(hostile.drawn.clearanceText),
	hostile.drawn?.clearanceText,
);

const turned = await directorAt({ ...APPROACH, headLook: "left" });
check(
	"a head turn takes the director off the glass with everything else on it",
	turned.drawn === null,
	JSON.stringify(turned.drawn),
);
await page.evaluate(() => window.__seelite.setHeadLook("forward"));

check(
	"the funnel is painted in the state the cue is in, and a refusal outranks the geometry",
	inside.drawn?.funnelState === "clear" &&
		outside.drawn?.funnelState === "off-axis" &&
		hostile.drawn?.funnelState === "blocked",
	`${inside.drawn?.funnelState} / ${outside.drawn?.funnelState} / ${hostile.drawn?.funnelState}`,
);

// ---------------------------------------------------------------------------
// What only the canvas can answer
// ---------------------------------------------------------------------------

/**
 * The ring and the band the paint rows below sample — **one geometry, every
 * frame**. Taken once from the aligned run's record and then held fixed,
 * because a sampler keyed off each frame's own record never runs on the frames
 * a control needs to read.
 */
const SAMPLE_RING = {
	kind: "ring",
	x: inside.drawn.centre.x,
	y: inside.drawn.centre.y,
	r: inside.drawn.funnelRadiusPx,
};

/**
 * A band of the physical cockpit, immediately below the glass.
 *
 * **Bounded above by the clip line and below by the debug HUD.** The first
 * version ran to the bottom of the frame and was reading the two debug text
 * lines, whose content differs with the clearance state — so it reported the
 * director painting below the glass when what had changed was a word in a
 * status line. Their tops were measured at about 0.71 of the frame; this stops
 * short of them.
 */
const SAMPLE_BELOW = {
	kind: "rect",
	x0: inside.drawn.centre.x * 0.3,
	x1: inside.drawn.centre.x * 1.7,
	y0: inside.overlayHeight * GLASS_BOTTOM + 3,
	y1: inside.overlayHeight * 0.7,
	samples: 22,
};

/**
 * The mirror band, immediately **above** the clip line.
 *
 * Without it the clip row is zero against zero and cannot fail: a pose whose
 * corridor never reaches the clip line at all is indistinguishable from a
 * working clip, and `sample()` returns zero for a region it cannot read. This
 * band is the arm that must register hits, so the zero below it means the ink
 * was stopped rather than never present.
 */
const SAMPLE_ABOVE = {
	kind: "rect",
	x0: inside.drawn.centre.x * 0.3,
	x1: inside.drawn.centre.x * 1.7,
	y0: inside.overlayHeight * GLASS_BOTTOM - 30,
	y1: inside.overlayHeight * GLASS_BOTTOM - 3,
	samples: 22,
};

const paintAligned = await directorAt({
	...APPROACH,
	noseDeg: AXIS_DEG - 5,
	sampleRing: SAMPLE_RING,
});
// A pitched pose for the clip rows, so the corridor is projected down across
// the clip line instead of sitting on the horizon where nothing would be cut.
const pitched = await directorAt({
	...APPROACH,
	pitchDeg: 26,
	sampleBelow: SAMPLE_BELOW,
	sampleAbove: SAMPLE_ABOVE,
});
const pitchedAbsent = await directorAt({
	...APPROACH,
	pitchDeg: 26,
	clear: false,
	sampleBelow: SAMPLE_BELOW,
	sampleAbove: SAMPLE_ABOVE,
});
const paintOffAxis = await directorAt({
	...APPROACH,
	noseDeg: AXIS_DEG + 5,
	sampleRing: SAMPLE_RING,
});
const paintAbsent = await directorAt({
	...APPROACH,
	// **The same pose as `paintAligned`**, differing only in the clearance. The
	// first version left the nose at zero, so the two frames also differed in
	// attitude — the attitude reference and every body bracket moved between
	// them, and the row was reading that difference as director ink.
	noseDeg: AXIS_DEG - 5,
	clear: false,
	sampleRing: SAMPLE_RING,
});

check(
	// **The row the record cannot fake.** Every field row above reads
	// `directorRender`, which the draw assembles whether or not its strokes
	// landed — delete the `ctx.arc`/`ctx.stroke` calls and they all stay green
	// while the pilot sees nothing.
	//
	// The control is the frame with no clearance, where the director is absent by
	// the rule two blocks up. It reads the **same pixels**.
	"the tolerance ring is actually painted on the overlay, and absent when the director is",
	// **The difference, not an absolute empty control.** The attitude reference
	// and visible proper-name labels can cross this circle, so the control frame
	// is not empty and its exact count changes with generated names; what has to
	// vanish is the director's own ink. Keep the control a strict minority as a
	// second arm, so an unrelated saturated circle cannot satisfy the difference.
	paintAligned.ringSample.hits - paintAbsent.ringSample.hits > 12 &&
		paintAbsent.ringSample.hits < paintAligned.ringSample.hits / 3,
	`${paintAligned.ringSample.hits} of 24 painted, ${paintAbsent.ringSample.hits} with no director`,
);

check(
	// `funnelState` above is a string the draw recorded. This is the colour it
	// stroked, on the same pixels, five degrees either side of the tolerance —
	// taken as the dominant bucket over the circumference, because the marker is
	// stroked in the same colour and one sample is not a reading.
	"the painted ring changes colour when the cue leaves the tolerance",
	typeof paintAligned.ringSample.colour === "string" &&
		typeof paintOffAxis.ringSample.colour === "string" &&
		paintAligned.ringSample.count > 12 &&
		paintOffAxis.ringSample.count > 12 &&
		paintAligned.ringSample.colour !== paintOffAxis.ringSample.colour,
	`${paintAligned.ringSample.colour} x${paintAligned.ringSample.count} then ${paintOffAxis.ringSample.colour} x${paintOffAxis.ringSample.count}`,
);

check(
	// **The defect the first build shipped with.** The laser tracer clips to the
	// glass because the lower third of the frame is physical cockpit hardware;
	// the director had no clip and drew its rings straight down over the dash
	// deck, the scanner well and both console housings. The control is the frame
	// with no director, so this measures the director's ink and not the
	// cockpit's own.
	"the director stays inside the canopy and paints nothing on the physical cockpit",
	// **Zero, on both frames.** An earlier version asserted only
	// `pitched <= pitchedAbsent`, which a build painting a few points below the
	// glass could satisfy whenever the control happened to paint more — and the
	// control's own instability was the stated reason for the inequality. That
	// instability came from the band running down into the debug HUD, whose text
	// changes with the clearance state; bounded above by the clip line and below
	// by that text, the band is empty on both frames and an absolute zero is what
	// the claim actually is. Removing the clip puts 21 points in it.
	// **And the band above it must register hits**, from the same frame. Without
	// that arm this row is zero against zero: a pose whose corridor never reaches
	// the clip line passes it, and so does a region the sampler could not read.
	pitched.belowSample.hits === 0 &&
		pitchedAbsent.belowSample.hits === 0 &&
		pitched.aboveSample.hits - pitchedAbsent.aboveSample.hits > 8,
	`${pitched.aboveSample.hits} painted just above the clip line and ${pitched.belowSample.hits} below it, ` +
		`against ${pitchedAbsent.aboveSample.hits} and ${pitchedAbsent.belowSample.hits} with no director` +
		`${pitched.belowSample.hits ? ` — at ${JSON.stringify(pitched.belowSample.where)}` : ""}`,
);

await browser.close();
exit();
