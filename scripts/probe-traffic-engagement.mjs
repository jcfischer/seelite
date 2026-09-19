/**
 * The browser tier for firing on ordinary traffic in the running game
 * (`docs/specs/civilian-combat.md`, changes 1 and 2).
 *
 * The headless rows own the arithmetic — `tests/traffic-engagement.test.ts`
 * (the condition model, the reaction per role, the divert, the destroy and who
 * flies it), `tests/legal.test.ts` (heat and H9's supersession),
 * `tests/carrier-standing.test.ts` (standing and the hold) and
 * `tests/raider-wreck.test.ts` (the manifest drop and the partial scoop). What
 * only the page can answer is the wiring:
 *
 * - a civilian near the player is a contact, and selecting it pulls the
 *   gimballed beam onto it — #43's third combat target;
 * - the first shot that lands hands it from its projection to flight, and it
 *   runs rather than fights;
 * - **the frame the hull gives way diverts it**: the row turns `repairing` at
 *   its own ordinal while the ship goes on running, its home berth is booked to
 *   the first departure its schedule makes after H3d's `T`, and the strike's
 *   heat is written;
 * - **out of the band it is gone from the sky and standing in its home berth**:
 *   no contact and no selectable mark, a `parked-home` projection, one hull per
 *   berth, and the system's lanes still admit the pilot;
 * - **it rejoins its schedule at a departure**, at the same instance ordinal,
 *   and the berth is free again;
 * - the kill is a world-state destroy, the contact goes, the canisters are the
 *   manifest line for line, and a strike followed by the kill costs one
 *   offence's heat rather than two (H9);
 * - Traffic authority is ready again after the kill, so the system's lanes
 *   still admit the player;
 * - the replacement flies at the next instance ordinal;
 * - an armed hull, struck, fires back.
 *
 * **The pilot is tethered**: it holds a fixed offset behind the target and its
 * nose on it. That proves the wiring reaches a divert and a kill, not that a
 * pilot can bring either about — the principal flying a strike and a return is
 * that evidence, and it is this node's third tier.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/**
 * The two printed shield facings, read back out of the line as painted.
 *
 * Parsing what the glass printed is not restating a constant: the numbers come
 * from the page. What is deliberately *not* here is any rule for turning a
 * condition into those numbers — that is `targetConditionLine`'s, and a probe
 * carrying a copy of it would keep passing after it was retuned.
 */
/**
 * **A predicate that throws aborts the run; one that returns `null` lets the row
 * fail and the rest of the probe keep reporting.** The first version threw here,
 * which is the wrong shape twice over: a check's whole job is to say what it saw,
 * and a `TypeError` partway through a `check(...)` argument prints no payload and
 * forfeits every row after it. Callers therefore test the result.
 *
 * `null` rather than `[]`: `[].every(…)` is vacuously true and `Math.min(...[])`
 * is `Infinity`, so an empty array would turn a line it could not read into a row
 * that passes.
 */
function pools(line) {
	const m = /^SHD F (\d+) A (\d+)\s/.exec(line);
	return m ? [Number(m[1]), Number(m[2])] : null;
}

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
	await bootedGame(page);

	await page.evaluate(async () => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const sim = await import("/src/sim.ts");
		const standingMod = await import("/src/carrier-standing.ts");
		const engagementMod = await import("/src/traffic-engagement.ts");
		// Constants read off the page, never restated here (CLAUDE.md).
		const legalMod = await import("/src/legal.ts");
		const gimbalMod = await import("/src/gimbal.ts");
		const wreckMod = await import("/src/raider-wreck.ts");
		const conditionMod = await import("/src/ship-condition.ts");
		const dt = g.units.MAX_DT;
		const frame = () => {
			g.step(dt);
			g.render(dt);
		};
		const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
		const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
		const len = (a) => Math.hypot(a.x, a.y, a.z);
		const unit = (a) => {
			const l = len(a) || 1;
			return { x: a.x / l, y: a.y / l, z: a.z / l };
		};
		const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
		const SLOW = new Set(["local-departure", "local-approach"]);

		/** A flying, slow route of the wanted kind at the clock as it stands. */
		const findRoute = (want) => {
			const record = g.world.system.record;
			for (const route of g.trafficRoutes) {
				if (!SLOW.has(route.phase)) continue;
				const actor = g.trafficActors.find((a) => a.key === route.key);
				if (!actor) continue;
				const armed = engagementMod.ARMED_TRAFFIC_HULLS.has(actor.hullId);
				if (armed !== want.armed) continue;
				const { instanceOrdinal } = g.carrierCondition(route.key);
				const standing = standingMod.carrierStanding(
					record.seed,
					route.key,
					instanceOrdinal,
					g.world.gameTime,
				);
				if (want.standing && standing !== want.standing) continue;
				return { key: route.key, actor, standing };
			}
			return null;
		};

		window.__engagementProbe = {
			frame,
			/** Run the clock until a route of the wanted kind is flying slowly. */
			seek(want, maxSeconds) {
				for (let t = 0; t < maxSeconds; t += dt) {
					const found = findRoute(want);
					if (found) return found;
					// Authority only: nothing is drawn while the clock runs to a route.
					g.step(dt);
				}
				return null;
			},
			/** Put the ship `km` behind the carrier, co-moving, nose on it. */
			tether(key, km, offNoseRad = 0) {
				const route = g.trafficRoutes.find((r) => r.key === key);
				const contact = g.trafficContacts.get(key);
				const pos = contact?.pos ?? route.pos;
				const vel = contact?.velocity ?? route.vel;
				const back = unit(
					route?.nose ? scale(route.nose, -1) : { x: 0, y: 0, z: 1 },
				);
				window.__engagementProbe.offset = scale(back, km);
				g.world.ship.pos = add(pos, window.__engagementProbe.offset);
				g.world.ship.vel = { ...vel };
				g.throttle = 0;
				window.__engagementProbe.aimAt(pos, offNoseRad);
				g.setHeadLook("forward");
			},
			/** The offence pair a write is measured against: the status as it
			 *  stands now, and the status before the write decayed to this frame.
			 *  The divert and the kill both need exactly this, and two copies that
			 *  call the halves different things (`beforeHeat`, `before`) is how a
			 *  probe's arithmetic and the game's drift apart. */
			snapshotLegal(before) {
				const { heat, updatedAt } = window.__seelite.trafficReadout().legal;
				return {
					legal: { heat, updatedAt },
					before: this.heatAt(before, updatedAt),
				};
			},
			/** One tethered frame: hold the offset, nose on the target or
			 *  `offNoseRad` beside it. `framesFired` counts the frames this rig has
			 *  held the beam open, across every target — the shield-side bound the
			 *  divert's trigger is judged against has to be counted from the first
			 *  shot of the fight, not from the start of one loop. */
			framesFired: 0,
			follow(key, firing, offNoseRad = 0) {
				const contact = g.trafficContacts.get(key);
				if (!contact) return false;
				g.world.ship.pos = add(contact.pos, window.__engagementProbe.offset);
				g.world.ship.vel = { ...contact.velocity };
				window.__engagementProbe.aimAt(contact.pos, offNoseRad);
				if (firing) {
					g.keys.add(" ");
					window.__engagementProbe.framesFired++;
				} else g.keys.delete(" ");
				frame();
				g.keys.delete(" ");
				return true;
			},
			/** Nose on `pos`, or `offNoseRad` beside it in the horizontal. */
			aimAt(pos, offNoseRad = 0) {
				const toward = unit(sub(pos, g.world.ship.pos));
				const aside = unit({ x: -toward.z, y: 0, z: toward.x });
				g.setAttitude(
					unit(
						add(
							scale(toward, Math.cos(offNoseRad)),
							scale(aside, Math.sin(offNoseRad)),
						),
					),
					g.shipUp(),
				);
			},
			offenceHeat: legalMod.OFFENCE_HEAT.destroyed,
			strikeOffence: legalMod.OFFENCE_HEAT.struck,
			heatAt: legalMod.heatAt,
			// How long a full shield side takes the pulse laser: the divert's
			// trigger is the first hit that gets past it (H3d), and this is read
			// off the module rather than multiplied out here.
			shieldSeconds:
				conditionMod.SHIELD_POOL / conditionMod.PULSE_LASER.damagePerS,
			gimbalConeRad: gimbalMod.GIMBAL_CONE_RAD,
			lifecycleS: wreckMod.RAIDER_WRECK_S + wreckMod.RAIDER_REPAIR_S,
			advanceTo(t) {
				g.world.gameTime = t;
				sim.advanceSystem(g.world.system, t);
				frame();
			},
		};
	});

	// -------------------------------------------------------------------------
	// A Clean civilian, found and selected.
	// -------------------------------------------------------------------------
	const found = await page.evaluate(async () => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const { trafficInSights } = await import("/src/traffic-engagement.ts");
		const target = p.seek({ armed: false, standing: "clean" }, 900);
		if (!target) return { target: null };
		// Inside and outside the gimbal's cone, read off the page.
		const off = p.gimbalConeRad / 2;
		p.tether(target.key, 1.2, off);
		p.frame();
		g.targetId = target.key;
		// First twice the cone off the nose: the mark must not show.
		const outside = p.gimbalConeRad * 2;
		for (let i = 0; i < 20; i++) p.follow(target.key, false, outside);
		const markOutside = g.selectedRender && { ...g.selectedRender };
		// Then half the cone off the nose, inside it, not firing.
		for (let i = 0; i < 20; i++) p.follow(target.key, false, off);
		const mark = g.selectedRender && { ...g.selectedRender };
		const contact = g.trafficContacts.get(target.key);
		const readout = g
			.trafficReadout()
			.contacts.find((c) => c.key === target.key);
		return {
			target,
			listed: g.selectableIds().includes(target.key),
			selected: g.trafficSelected(),
			boresightHits:
				contact &&
				trafficInSights(
					g.cameraPos(),
					g.weaponAim(),
					contact.pos,
					target.actor.hullId,
				),
			beamHits:
				contact &&
				trafficInSights(
					g.cameraPos(),
					g.beamAim(),
					contact.pos,
					target.actor.hullId,
				),
			readout,
			mark,
			markOutside,
		};
	});
	check(
		"a slow Clean civilian flies near the player and is a selectable contact",
		found.target !== null && found.listed && found.selected,
		JSON.stringify(found),
	);
	check(
		"selecting it pulls the gimballed beam onto a hull the boresight misses (#43's third target)",
		found.boresightHits === false && found.beamHits === true,
		JSON.stringify({ bore: found.boresightHits, beam: found.beamHits }),
	);
	check(
		"the painted label says ON TARGET inside the gimbal's cone and not outside it",
		found.mark?.id === found.target?.key &&
			found.mark.onTarget === true &&
			found.mark.text.includes("ON TARGET") &&
			found.markOutside?.id === found.target?.key &&
			found.markOutside.onTarget === false &&
			!found.markOutside.text.includes("ON TARGET"),
		JSON.stringify({ mark: found.mark, outside: found.markOutside }),
	);
	if (!found.target) throw new Error("no target to fight");
	const key = found.target.key;

	// -------------------------------------------------------------------------
	// The first shot engages; the civilian runs.
	// -------------------------------------------------------------------------
	const engaged = await page.evaluate(async (key) => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const conditionMod = await import("/src/ship-condition.ts");
		const hud = await import("/src/duel-hud.ts");
		// The painted mark, plus **what the formatter itself says this condition
		// prints**. The row's whole question is whether the glass and the sim agree,
		// and a probe carrying its own copy of the form could keep passing while the
		// two disagreed — which is CLAUDE.md's reason for reading off the page.
		const painted = () => {
			const record = g.selectedRender;
			if (!record) return null;
			const fight = g.trafficEngagements?.get(key);
			return {
				...record,
				expected: fight ? hud.targetConditionLine(fight.condition).text : null,
			};
		};
		// **The first shot, on its own frame.** A carrier nobody has fired on has no
		// condition to read — it is a schedule projection, not a flown ship — so
		// this is the earliest frame the line can exist on, and a snapshot taken
		// before it measures the absence of a thing that was never due.
		p.follow(key, true);
		const first = painted();
		for (let i = 0; i < 9; i++) p.follow(key, true);
		return {
			contact: g.trafficReadout().contacts.find((c) => c.key === key),
			first,
			mark: painted(),
			// Off the module, never restated here (CLAUDE.md).
			shieldPool: conditionMod.SHIELD_POOL,
		};
	}, key);
	check(
		"the first shot hands it from its projection to flight, and it runs rather than fights",
		engaged.contact?.engaged === true &&
			["flee", "evade"].includes(engaged.contact.phase) &&
			engaged.contact.condition === "operational",
		JSON.stringify(engaged.contact),
	);
	// -------------------------------------------------------------------------
	// The glass says what the sim has been saying since #362 (#395). This is the
	// half that was missing: the principal fired on ordinary traffic for twenty
	// to thirty seconds and reported that nothing happened, and they were reading
	// the glass correctly — the sim was right and the glass was silent.
	// -------------------------------------------------------------------------
	check(
		// **What this row can and cannot say.** It reads the record the draw hands
		// the painter and compares it to the formatter's own output, so it proves
		// the game computed this line for this frame and offered it to the label —
		// which is the wire this node was opened for, because the sim had been right
		// and this handoff had been missing for twenty seconds of beam. It does
		// **not** prove ink reached the canvas: a row that can be satisfied by a
		// record cannot see text that is clipped, mispositioned, or drawn in a
		// colour nobody can read. The pixels are `probe-duel-hud.mjs`'s, which
		// counts them in the band this line is painted in and fails at `paint > 30`.
		"the frame the fight begins offers the condition line to the mark, and it is the line the sim's own formatter prints",
		// **Test the record for, do not optional-chain past it.** `first?.x !== null`
		// is true when `first` is null — the chain yields `undefined`, which is not
		// `null` — and the next clause then dereferences the null and the run dies
		// on a TypeError instead of reporting a failed row with its payload. A check
		// that throws cannot say what it saw, which is the only thing it is for.
		engaged.first !== null &&
			engaged.first.conditionLine !== null &&
			engaged.first.conditionLine === engaged.first.expected &&
			// The one figure on the line known before it is read: H3d spends hull
			// points only once a facing is gone, so on this frame the hull is whole.
			engaged.first.conditionLine.endsWith("HULL 100%"),
		JSON.stringify(engaged.first),
	);
	check(
		"held in the beam, both facings print and the one it is taking comes down",
		// Both facings print, every time, which is what makes *which* one is going
		// readable: meeting a carrier from ahead and from behind are different
		// fights. Which of the two the beam finds depends on how it fled, so this
		// asks only that the line names both and one has fallen. Pairing a pinned
		// geometry to a named facing is `tests/duel-hud.test.ts`'s.
		engaged.first !== null &&
			engaged.mark !== null &&
			engaged.mark.conditionLine !== null &&
			engaged.mark.conditionLine === engaged.mark.expected &&
			engaged.mark.conditionLine !== engaged.first.conditionLine &&
			(() => {
				const p = pools(engaged.mark.conditionLine);
				return (
					p !== null &&
					p.every((n) => n <= engaged.shieldPool) &&
					Math.min(...p) < engaged.shieldPool
				);
			})(),
		JSON.stringify({ first: engaged.first, mark: engaged.mark }),
	);

	// -------------------------------------------------------------------------
	// The hull gives way: the divert, the berth, and the return (change 2).
	// -------------------------------------------------------------------------
	const diverted = await page.evaluate(async (key) => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const traffic = await import("/src/station-traffic.ts");
		const presenceMod = await import("/src/traffic-engagement.ts");
		const conditionMod = await import("/src/ship-condition.ts");
		const wreck = await import("/src/raider-wreck.ts");
		const contactMod = await import("/src/display-contact.ts");
		const before = g.trafficReadout().legal;
		const actor = g.trafficActors.find((a) => a.key === key);
		const hullFull = conditionMod.fullCondition(actor.hullId).hull;
		let steps = 0;
		let strike = null;
		// The hull as the fight saw it a frame ago. H3d's trigger is the first
		// hit that reaches hull points, so the fact to read is not how long the
		// shields took — which depends on which side of them the beam found — but
		// that the hull was whole until the frame the row turned.
		let hullWas = hullFull;
		// **The mark one frame before the divert, and the mark on it.** The word
		// has to arrive on the strike rather than have been there already: a pilot
		// who has only stripped shields is looking at a carrier still flying its
		// schedule (H3d), and a word that never left the name would say nothing
		// about what their shot had just done.
		let beforeMark = null;
		let atMark = null;
		let homeKmAt = null;
		for (; steps < 6000; steps++) {
			if (!p.follow(key, true)) break;
			const row = g.trafficReadout().contacts.find((c) => c.key === key);
			if (row === undefined) continue;
			if (row.condition === "operational") {
				hullWas = row.hull ?? hullWas;
				beforeMark = g.selectedRender && { ...g.selectedRender };
				continue;
			}
			atMark = g.selectedRender && { ...g.selectedRender };
			// **The figure is read off the painted label and not re-derived here.**
			// Two drafts were wrong before this one. The first measured `Math.hypot`
			// over the station body: a second copy of a distance definition, which
			// keeps asserting the old rule after the rule moves. The second called
			// production's own `homeStationKm`, which is closer and still not right —
			// that range is measured from the camera the label is projected against,
			// and a probe cannot honestly name that point, because the Three camera
			// works in layer units and not world kilometres. So the browser tier asks
			// the question it is actually for: on the frame the divert wrote, does the
			// name line carry the word, and a `HOME` figure that is a real distance?
			// **That the figure is the pilot's own range to the station body is
			// `tests/display-contact.test.ts`'s**, where the origin is an argument and
			// can be stated exactly. A browser row cannot pin an arithmetic it cannot
			// name the inputs to, and pretending otherwise is the false-constant
			// failure in the other direction.
			const printed = atMark?.text?.match(/HOME (\d+(?:\.\d+)?) km$/);
			homeKmAt = printed ? Number(printed[1]) : null;
			// Snapshot the legal pair on the frame the divert wrote it, so each
			// write can be measured against the status that stood before it —
			// decayed to the same clock, and exactly, with no decay law restated
			// here.
			const carrier = g.carrierCondition(key);
			strike = {
				at: g.world.gameTime,
				...p.snapshotLegal(before),
				carrier,
				// The row, not the contact row: presence reads a repairing
				// carrier's recovery kind to tell a divert from a wreck.
				presence: presenceMod.trafficPresence(carrier),
				strikeOffence: p.strikeOffence,
				hullFull,
				hullWas,
				hullNow: row.hull,
				// The repair's own clock: the divert write's `now`, off the row
				// rather than off the frame counter, so the booking below is
				// computed from the instant the divert itself used.
				startedAt: carrier.recovery?.startedAt ?? null,
			};
			break;
		}
		if (!strike) return { strike: null };
		const readout = g.trafficReadout();
		const parked = readout.parkedHome.find((row) => row.key === key) ?? null;
		const contact = readout.contacts.find((c) => c.key === key);
		// The berths Traffic is holding, one hull each: a struck carrier's
		// schedule still says it is away, so this is the tick where a second ship
		// could have been handed the berth it is standing in.
		const berths = new Set();
		let berthCollision = null;
		for (const route of g.trafficRoutes) {
			if (!route.berthId || !route.terminalStationId) continue;
			const id = `${route.terminalStationId}/${route.berthId}`;
			if (berths.has(id)) berthCollision = id;
			berths.add(id);
		}
		return {
			strike,
			steps,
			seconds: steps * g.units.MAX_DT,
			secondsFired: p.framesFired * g.units.MAX_DT,
			shieldSeconds: p.shieldSeconds,
			repairS: wreck.RAIDER_REPAIR_S,
			parked,
			// The mark either side of the strike, and the home station's range as
			// the label itself printed it, in kilometres.
			beforeMark,
			atMark,
			homeKm: homeKmAt,
			divertLabel: contactMod.DIVERT_LABEL,
			// Booked to the next departure its own schedule makes after T —
			// recomputed from the instant the divert wrote, not from the frame the
			// probe happened to read it on.
			nextDepartureAtS: traffic.nextTrafficDepartureAtS(
				actor.schedule,
				(strike.startedAt ?? strike.at) + wreck.RAIDER_REPAIR_S,
			),
			scheduleAwayAtS: traffic.trafficScheduleAt(actor, parked?.backAtS ?? 0)
				.desired,
			// H3's intent survives the divert: the ship is still being flown.
			stillEngaged: contact?.engaged === true,
			stillFleeing: ["flee", "evade"].includes(contact?.phase),
			berthCollision,
			authorityReady: readout.authorityReady,
		};
	}, key);
	check(
		"the divert lands on the frame the hull gives way, with the hull whole until that frame (H3d)",
		diverted.strike !== null &&
			diverted.strike.carrier.condition === "repairing" &&
			diverted.strike.hullWas === diverted.strike.hullFull &&
			diverted.strike.hullNow < diverted.strike.hullFull,
		// How long the beam was open (`secondsFired` s) against the bound one
		// shield side puts up with (`shieldSeconds` s): shown, not asserted,
		// because which side of the carrier the beam found is a matter of how it
		// fled. `tests/traffic-engagement.test.ts` holds the arithmetic on a rig
		// where the geometry is pinned.
		JSON.stringify(diverted),
	);
	// -------------------------------------------------------------------------
	// The other half of what the principal could not see: that the carrier has
	// left its schedule, and roughly how far away that is. The word arrives on
	// the frame the hull gives way — the same frame H3c writes the divert and H4
	// charges the strike — so cause and consequence land together on the glass
	// rather than only in the world state.
	// -------------------------------------------------------------------------
	check(
		"a carrier still flying its schedule carries no state word beside its name",
		diverted.beforeMark !== null &&
			!diverted.beforeMark.text.includes(diverted.divertLabel),
		JSON.stringify(diverted.beforeMark),
	);
	check(
		"the frame the hull gives way puts the word and a home station figure on the name line",
		diverted.atMark !== null &&
			diverted.atMark.id === key &&
			diverted.atMark.text.includes(diverted.divertLabel) &&
			// A distance the pilot could fly, not a `HOME 0.0 km` or a `HOME NaN
			// km`. Zero is excluded on purpose: it is the one reading that contradicts
			// the word beside it, and `trafficDivertCue` is written to return the word
			// alone rather than that pair.
			diverted.homeKm !== null &&
			Number.isFinite(diverted.homeKm) &&
			diverted.homeKm > 0,
		JSON.stringify(diverted.atMark),
	);
	check(
		"and it is still being read as a fight: the facing that ran out prints 0",
		// `min === 0` is what the model guarantees on this frame — a hull point is
		// reached only once the facing the beam is on has nothing left — and it is
		// the frame the line goes red. What the *other* facing has left depends on
		// the flight, which is not something to pin from a tethered pilot.
		diverted.atMark !== null &&
			// `pools` returns `null` for a line that prints no two facings, so the
			// result is tested before it is spread — `Math.min(...null)` would end the
			// run instead of reporting the row.
			diverted.atMark.conditionLine !== null &&
			(() => {
				const p = pools(diverted.atMark.conditionLine);
				return p !== null && Math.min(...p) === 0;
			})() &&
			/HULL (?!0%)\d+%$/.test(diverted.atMark.conditionLine),
		JSON.stringify(diverted.atMark),
	);
	check(
		"the divert is the ship's own ordinal, and its home berth is booked to the next departure after H3d's T (H3c)",
		diverted.strike?.carrier.instanceOrdinal === 0 &&
			diverted.strike?.presence === "parked-home" &&
			diverted.parked?.backAtS === diverted.nextDepartureAtS &&
			diverted.parked?.backAtS >= diverted.strike?.at + diverted.repairS &&
			diverted.scheduleAwayAtS === "away",
		// The projection itself turns `parked-home` on the next authority tick,
		// which the row below reads: this frame is the strike's own.
		JSON.stringify(diverted),
	);
	check(
		"the strike is an offence of its own, and the ship under fire keeps running (H3, H4)",
		Math.abs(
			diverted.strike.legal.heat -
				diverted.strike.before -
				diverted.strike.strikeOffence,
		) < 1e-6 &&
			diverted.stillEngaged &&
			diverted.stillFleeing,
		JSON.stringify(diverted),
	);

	// Out of the band: gone from the sky, standing in its berth, and the lanes
	// still open behind it.
	const away = await page.evaluate(async (key) => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const contact = g.trafficContacts.get(key);
		// Past the dematerialization boundary, which is where a survivor used to
		// go back to the projection it was struck in.
		g.world.ship.pos = {
			x: contact.pos.x + 13_000,
			y: contact.pos.y,
			z: contact.pos.z,
		};
		g.world.ship.vel = { ...contact.velocity };
		p.frame();
		p.frame();
		const readout = g.trafficReadout();
		const held = readout.parkedHome.find((row) => row.key === key) ?? null;
		return {
			contactGone: !g.trafficContacts.has(key),
			selectable: g.selectableIds().includes(key),
			held: held !== null,
			routePhase: g.trafficRoutes.find((r) => r.key === key)?.phase ?? null,
			authorityReady: readout.authorityReady,
			backAtS: held?.backAtS ?? null,
		};
	}, key);
	check(
		"out of the band a diverted carrier is gone from the sky and held at its berth, with the system's lanes still open (H3b)",
		away.contactGone &&
			away.selectable === false &&
			away.held === true &&
			away.routePhase === "parked-home" &&
			away.authorityReady === true &&
			diverted.berthCollision === null,
		JSON.stringify({ away, collision: diverted.berthCollision }),
	);

	const returned = await page.evaluate(
		({ key, atS }) => {
			const p = window.__engagementProbe;
			const g = window.__seelite;
			p.advanceTo(atS + 1);
			for (let i = 0; i < 5; i++) p.frame();
			const carrier = g.carrierCondition(key);
			const readout = g.trafficReadout();
			return {
				condition: carrier.condition,
				instanceOrdinal: carrier.instanceOrdinal,
				routePhase: g.trafficRoutes.find((r) => r.key === key)?.phase ?? null,
				stillHeld: readout.parkedHome.some((row) => row.key === key),
				authorityReady: readout.authorityReady,
			};
		},
		{ key, atS: away.backAtS },
	);
	check(
		"at its completion the same ship is back on its schedule, and the berth is free (H3c)",
		returned.condition === "operational" &&
			returned.instanceOrdinal === 0 &&
			returned.routePhase !== "parked-home" &&
			returned.stillHeld === false &&
			returned.authorityReady === true,
		JSON.stringify(returned),
	);

	// -------------------------------------------------------------------------
	// The kill, on a fresh target: the strike then the kill is one offence.
	// -------------------------------------------------------------------------
	const next = await page.evaluate(() => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const target = p.seek({ armed: false, standing: "clean" }, 900);
		if (!target) return { target: null };
		p.tether(target.key, 1.2);
		p.frame();
		g.targetId = target.key;
		const readout = g
			.trafficReadout()
			.contacts.find((c) => c.key === target.key);
		return { target, manifest: readout?.manifest ?? null };
	});
	if (!next.target) throw new Error("no second target to kill");
	const killKey = next.target.key;

	const killed = await page.evaluate((key) => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const { heat, updatedAt } = g.trafficReadout().legal;
		const statusBefore = { heat, updatedAt };
		let steps = 0;
		// The divert's own write, captured on the frame it lands: H9's whole
		// claim is about the pair of writes, so they are measured separately
		// against the status that stood before each.
		let struck = null;
		for (; steps < 6000 && g.trafficContacts.has(key); steps++) {
			p.follow(key, true);
			if (!struck && g.carrierCondition(key).condition !== "operational")
				struck = p.snapshotLegal(statusBefore);
		}
		const now = g.world.gameTime;
		for (let i = 0; i < 3; i++) p.frame();
		g.leftTab = "Communications";
		g.setHeadLook("left");
		p.frame();
		const legalEl = document.querySelector("[data-live-legal-status]");
		const legalText = legalEl?.textContent ?? null;
		const legalVisible = legalEl ? legalEl.checkVisibility() : null;
		// H7 puts the readout on both left tabs: read the Navigation one too.
		g.leftTab = "Navigation";
		p.frame();
		const navEl = document.querySelector("[data-live-legal-status]");
		const navText = navEl?.textContent ?? null;
		const navVisible = navEl ? navEl.checkVisibility() : null;
		const readout = g.trafficReadout();
		return {
			steps,
			seconds: steps * g.units.MAX_DT,
			condition: g.carrierCondition(key).condition,
			contactGone: !g.trafficContacts.has(key),
			selectable: g.selectableIds().includes(key),
			canisters: g.canisters
				.filter((c) => c.id.startsWith(`${key}#`))
				.map((c) => ({ good: c.commodity, tonnes: c.tonnes })),
			// Each write is the stored figure less the status before it, decayed
			// to that write's own stamp. Correct for any heat the pilot already
			// had, not only for zero (sage #368), and it separates the strike's
			// 15 from the kill's 25 rather than reading their sum.
			struck,
			// `null`, not a fallback, when no strike was ever captured: the only
			// thing a fallback here could produce is a pair of numbers that read
			// as a decomposition of a strike that did not happen, and the row's
			// red would name the wrong cause. `struck: null` in the payload is
			// the real failure — the divert never landed.
			strikeWrite: struck ? struck.legal.heat - struck.before : null,
			killWrite: struck
				? readout.legal.heat - p.heatAt(struck.legal, readout.legal.updatedAt)
				: null,
			legal: readout.legal,
			legalText,
			legalVisible,
			navText,
			navVisible,
			authorityReady: readout.authorityReady,
			offenceHeat: p.offenceHeat,
			strikeOffence: p.strikeOffence,
			targetAfter: g.targetId,
			lastExit: g.lastExit,
			killedAt: now,
		};
	}, killKey);
	check(
		"held in the beam it dies, and the kill is a world-state destroy",
		killed.condition === "destroyed" &&
			killed.contactGone &&
			!killed.selectable &&
			// The lock goes with it: the replacement reuses the key (H1).
			killed.targetAfter !== killKey,
		JSON.stringify(killed),
	);
	check(
		"the canisters are the manifest, one per line, each holding its line's tonnes (H11)",
		JSON.stringify(killed.canisters) === JSON.stringify(next.manifest) &&
			next.manifest.length >= 1,
		JSON.stringify({ canisters: killed.canisters, manifest: next.manifest }),
	);
	check(
		"a Clean kill reads Wanted on both left tabs, and the cockpit says so (H4, H7)",
		killed.struck !== null &&
			// The incident's whole cost, not the kill's own write: this one was
			// struck first, so the kill wrote what was still owed. The row below
			// holds that split.
			Math.abs(killed.strikeWrite + killed.killWrite - killed.offenceHeat) <
				1e-6 &&
			killed.legal.standing === "wanted" &&
			killed.legalText === "WANTED" &&
			killed.legalVisible === true &&
			killed.navText === "WANTED" &&
			killed.navVisible === true,
		JSON.stringify({
			legal: killed.legal,
			strikeWrite: killed.strikeWrite,
			killWrite: killed.killWrite,
			text: killed.legalText,
			visible: killed.legalVisible,
			navText: killed.navText,
			navVisible: killed.navVisible,
		}),
	);
	check(
		"a strike and the kill that follows it cost one incident's heat, not two (H9)",
		killed.struck !== null &&
			// The strike's write, then the kill's, each measured against the
			// status that stood before it. Summing two offences — which is what a
			// write that ignores the incident does — would put the pair at 55.
			// Each figure is read as a delta of the saved heat across one write,
			// so the pair is held to the ruling's figure within a tolerance: an
			// exact `===` on floats that came through `2 ** (-elapsed /
			// HEAT_HALF_LIFE_S)` can come apart by an ulp with nothing wrong.
			Math.abs(killed.strikeWrite - killed.strikeOffence) < 1e-6 &&
			Math.abs(killed.killWrite - (killed.offenceHeat - killed.strikeOffence)) <
				1e-6 &&
			Math.abs(killed.strikeWrite + killed.killWrite - killed.offenceHeat) <
				1e-6,
		JSON.stringify({
			strike: killed.struck,
			strikeWrite: killed.strikeWrite,
			killWrite: killed.killWrite,
			offence: killed.offenceHeat,
			strikeOffence: killed.strikeOffence,
		}),
	);
	check(
		"Traffic authority is ready again after the kill, so the system's lanes still admit the player",
		killed.authorityReady === true,
		JSON.stringify(killed),
	);

	// -------------------------------------------------------------------------
	// The replacement.
	// -------------------------------------------------------------------------
	const replaced = await page.evaluate(
		({ key, killedAt }) => {
			const p = window.__engagementProbe;
			const g = window.__seelite;
			p.advanceTo(killedAt + p.lifecycleS + 1);
			for (let i = 0; i < 5; i++) p.frame();
			const carrier = g.carrierCondition(key);
			return {
				condition: carrier.condition,
				instanceOrdinal: carrier.instanceOrdinal,
				routed: g.trafficRoutes.some((r) => r.key === key),
				authorityReady: g.trafficReadout().authorityReady,
			};
		},
		{ key: killKey, killedAt: killed.killedAt },
	);
	check(
		"once the wreck and repair have run, the replacement flies its route at the next instance (H1)",
		replaced.condition === "operational" &&
			replaced.instanceOrdinal === 1 &&
			replaced.routed &&
			replaced.authorityReady,
		JSON.stringify(replaced),
	);

	// -------------------------------------------------------------------------
	// An armed hull fires back.
	// -------------------------------------------------------------------------
	const armed = await page.evaluate(() => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const target = p.seek({ armed: true }, 1800);
		if (!target) return { target: null };
		p.tether(target.key, 3);
		p.frame();
		g.targetId = target.key;
		const before = { ...g.condition };
		for (let i = 0; i < 10; i++) p.follow(target.key, true);
		let returned = false;
		for (let i = 0; i < 600 && g.trafficContacts.has(target.key); i++) {
			// Hold still and cease fire: an armed hull, struck, comes to the pilot.
			p.aimAt(g.trafficContacts.get(target.key).pos);
			p.frame();
			if (
				g.condition.fore + g.condition.aft + g.condition.hull <
				before.fore + before.aft + before.hull
			) {
				returned = true;
				break;
			}
		}
		const readout = g
			.trafficReadout()
			.contacts.find((c) => c.key === target.key);
		return { target, returned, readout };
	});
	check(
		"an armed hull, struck, fires back (H3)",
		armed.target !== null && armed.returned,
		JSON.stringify(armed),
	);
} finally {
	await browser.close();
}
exit();
