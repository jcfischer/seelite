/**
 * Put the running game into §3.8.1's state, through the real sim (#621).
 *
 * Shared by the `vents` capture rows and `probe-vent-display.mjs`, so the
 * frame the principal judges and the frame the probe measures are one state.
 *
 * **Nothing here writes a firing level or a cue.** The ship is handed a speed
 * above the assist cap along its nose and a spin above its rate envelope,
 * with the assist on, and the game's own `step` is run on fixed deltas: the
 * assist then burns the retro pair to bring the speed back (§3.10) and the
 * attitude vents to bring the spin back (§3.9), and both are saturated
 * because the return is more than one step's authority. What the plumes and
 * the markers draw is what that step fired and flagged.
 *
 * Then the clock is held, so the frame — the plumes' particles and the pulse's
 * phase both run on the game clock — is the same every time it is drawn.
 *
 * Runs **in the page** (`page.evaluate(holdVentState, args)`), so it may
 * reference nothing outside itself.
 *
 * @param {{ overCap: number, spin: number, steps: number, slipDeg?: number }} args
 *   `overCap` is the speed as a multiple of the cap; `spin` the yaw and roll
 *   rates as a multiple of each axis's peak; `steps` how many 1/60 s steps
 *   to fly before holding. `slipDeg` tips the velocity that far above the
 *   nose, so the prograde marker stands clear of the nose cross and of the
 *   bodies the start heading looks at — and the drift it adds is one more
 *   demand on the translation pairs. Ten degrees when omitted.
 */
export function holdVentState({ overCap, spin, steps, slipDeg = 10 }) {
	const g = window.__seelite;
	g.resetFlightToStart();
	// The start's own heading, which a reset fixes every run, and no
	// selection: a target's ring would sit over the velocity marker this
	// state is for.
	g.targetId = null;
	g.clockHeld = false;
	if (!g.assist) g.assist = true;
	g.throttle = 1;
	const cap = g.assistCapKms;
	const nose = g.nose();
	const up = g.shipUp();
	const slip = (slipDeg * Math.PI) / 180;
	const along = cap * overCap * Math.cos(slip);
	const above = cap * overCap * Math.sin(slip);
	const frame = g.assistFrame().vel;
	g.world.ship.vel = {
		x: frame.x + nose.x * along + up.x * above,
		y: frame.y + nose.y * along + up.y * above,
		z: frame.z + nose.z * along + up.z * above,
	};
	const max = g.flownPerformance.angularMax;
	g.rates = { pitch: 0, yaw: max.yaw * spin, roll: max.roll * spin };
	const dt = 1 / 60;
	for (let i = 0; i < steps; i++) g.step(dt);
	g.clockHeld = true;
	const firing = g.ventFiring ?? null;
	return {
		// A build from before #621 keeps no firing table on the game: that is
		// its honest `before`, and the caller captions it so.
		absent: !("ventFiring" in g),
		hull: g.flownHull,
		speedOverCap:
			Math.hypot(
				g.world.ship.vel.x - frame.x,
				g.world.ship.vel.y - frame.y,
				g.world.ship.vel.z - frame.z,
			) / cap,
		lit: firing
			? Object.entries(firing)
					.filter(([, level]) => level > 0)
					.map(([slot]) => slot)
			: [],
		cue: g.saturationCue
			? {
					linear: g.saturationCue.linear !== null,
					angular: g.saturationCue.angular !== null,
				}
			: null,
	};
}

/**
 * #647's state: a turn in a real cruise leg, through the real sim.
 *
 * The leg runs to the farthest body that is not the star, so it lasts. Once
 * the game reports cruise, the hull is handed `spin` times its peak yaw rate,
 * with the assist on, and the game's own `step` flies `steps` steps of 1/60 s:
 * the attitude vents bring the spin back and saturate, and cruise moves the
 * hull, so no translation vent fires. Then the clock is held.
 *
 * Runs **in the page**, so it may reference nothing outside itself.
 *
 * @param {{ spin: number, steps: number }} args
 */
export function holdCruiseTurnState({ spin, steps }) {
	const g = window.__seelite;
	g.resetFlightToStart();
	g.clockHeld = false;
	if (!g.assist) g.assist = true;
	let far = null;
	let farKm = 0;
	for (const b of g.world.system.bodies) {
		if (b.kind === "star") continue;
		const d = Math.hypot(
			b.pos.x - g.world.ship.pos.x,
			b.pos.y - g.world.ship.pos.y,
			b.pos.z - g.world.ship.pos.z,
		);
		if (d > farKm) {
			far = b;
			farKm = d;
		}
	}
	if (!far)
		throw new Error("holdCruiseTurnState: no body but the star to cruise to");
	g.targetId = far.id;
	g.faceTarget?.();
	g.engageCruise();
	const dt = 1 / 60;
	for (let i = 0; i < 600 && g.regime !== "cruise"; i++) g.step(dt);
	const engaged = g.regime === "cruise";
	const max = g.flownPerformance.angularMax;
	g.rates = { pitch: 0, yaw: max.yaw * spin, roll: 0 };
	for (let i = 0; i < steps; i++) g.step(dt);
	g.clockHeld = true;
	const family = new Map(
		g.flownPerformance.vents.map((v) => [v.slot, v.family]),
	);
	const firing = { ...(g.ventFiring ?? {}) };
	return {
		hull: g.flownHull,
		engaged,
		stillCruising: g.regime === "cruise",
		firing,
		lit: Object.entries(firing)
			.filter(([, level]) => level > 0)
			.map(([slot]) => ({ slot, family: family.get(slot) })),
		cue: g.saturationCue
			? {
					linear: g.saturationCue.linear !== null,
					angular: g.saturationCue.angular !== null,
				}
			: null,
	};
}
