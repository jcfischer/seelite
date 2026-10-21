/**
 * Put the running game into node #637's state, through the real sim: the
 * duel's raider flying, and firing its vents, from its own Hull step.
 *
 * Shared by the `npc-vents` capture row and `probe-npc-vents.mjs`, so the
 * frame the principal judges and the frame the probe measures are one state.
 *
 * **Nothing here writes a firing level.** A cruise leg to the farthest body,
 * a raider forced ahead, the contest flown out by the game's own `step` until
 * it interdicts, then `steps` more steps of the duel: the raider turns onto the
 * player and drives at them, and what its plumes draw is the table that step
 * fired (`EncounterContact.firing`). Then the clock is held — the plumes'
 * particles run on the game clock — and **the player, not the raider, is
 * moved**: placed `behindKm` off the raider's stern and a little above, looking
 * at it, so its drive and its aft vents face the camera. The raider stands
 * where the sim left it.
 *
 * Runs **in the page** (`page.evaluate(holdNpcVentState, args)`), so it may
 * reference nothing outside itself.
 *
 * @param {{ steps: number, behindKm: number }} args
 */
export function holdNpcVentState({ steps, behindKm }) {
	const g = window.__seelite;
	// The leg and the contest on the game's longest step, as the duel's capture
	// placer flies them; the duel itself on a frame's.
	const leg = g.units.MAX_DT;
	const dt = 1 / 60;
	g.resetFlightToStart();
	g.clockHeld = false;
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
	if (!far) throw new Error("holdNpcVentState: no body but the star");
	g.targetId = far.id;
	g.faceTarget?.();
	g.engageCruise();
	for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(leg);
	if (g.regime !== "cruise")
		throw new Error(
			`holdNpcVentState: no cruise to interdict (regime ${g.regime}, ${g.lastExit})`,
		);
	g.forceRaider("ahead", 0.5, 12);
	for (let i = 0; i < 600 && g.encounter?.phase !== "duel"; i++) g.step(leg);
	if (g.encounter?.phase !== "duel")
		throw new Error(
			`holdNpcVentState: the raider never interdicted (phase ${g.encounter?.phase ?? "none"}, regime ${g.regime}, ${g.lastExit})`,
		);
	for (let i = 0; i < steps; i++) {
		g.step(dt);
		g.render(dt);
	}
	g.clockHeld = true;
	const view = g.encounterView;
	if (!view) throw new Error("holdNpcVentState: no raider in view");
	// A build from before node #637 keeps no firing table on the contact: that
	// is its honest `before`, and the caller captions it so.
	const absent = !("firing" in view);
	const firing = { ...(view.firing ?? {}) };
	const n = view.nose;
	const u = view.up;
	const at = {
		x: view.pos.x - n.x * behindKm + u.x * behindKm * 0.35,
		y: view.pos.y - n.y * behindKm + u.y * behindKm * 0.35,
		z: view.pos.z - n.z * behindKm + u.z * behindKm * 0.35,
	};
	g.world.ship.pos = at;
	g.world.ship.vel = { ...view.vel };
	g.targetId = null;
	g.setAttitude(
		{ x: view.pos.x - at.x, y: view.pos.y - at.y, z: view.pos.z - at.z },
		u,
	);
	g.render(0);
	return {
		absent,
		hull: g.raiderContact?.shipType ?? "raider",
		name: view.name,
		firing,
		lit: Object.entries(firing)
			.filter(([, level]) => level > 0)
			.map(([slot, level]) => ({ slot, level })),
	};
}
