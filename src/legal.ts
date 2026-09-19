/**
 * The player's legal heat (`civilian-combat.md` H4) and what it does to a
 * station (`H5`, `H6`, `H7`'s second half).
 *
 * **The semantics are `combat-model.md` §4's and the figures are this node's.**
 * §4 rules legal status per galaxy, bounded, read as Clean, Wanted or
 * Fugitive, decaying lazily on a 30-minute half-life. It named no offence cost
 * and no threshold, and #362 set them with the principal: a Clean kill is 40,
 * a strike 15, Wanted at 10, Fugitive at 60, capped at 100. The scale is Elite's
 * legal value in shape — an offender band, and a fugitive band that one incident
 * does not reach. **One incident is the unit**, and that is `marginalOffenceHeat`
 * (H9): the two figures are what an offence costs on its own, not what it adds
 * to an incident that already carries one.
 *
 * **What is saved is `LegalStatus` and nothing else** — the heat, its stamp, and
 * the stations that saw an offence. A standing label and a station's hostility
 * are §8 projections, derived here on read
 * (`persistent-world-state.md` §7), and decay is never written back: a read at a
 * later clock decays the stored figure from its stamp, and a write stores the
 * decayed figure plus the offence, stamped then.
 *
 * **An offence is judged on the target's true standing** (`carrier-identity.md`
 * F7), whether or not the pilot scanned it. So `offenceHeat` takes a standing,
 * not what the pilot knew.
 *
 * ## The two refusals, and why they are not one field
 *
 * A station stops admitting this pilot for two unrelated reasons, and the code
 * has to keep them apart because their **exits** are different:
 *
 * - **The flip** (`docking.ts` §6) is a timed state the docking protocol owns —
 *   barging without clearance, or failing a shipyard scan, sets it for
 *   `HOSTILE_COOLDOWN_S`. It is session state with a countdown.
 * - **The law** (H5's witness, H7's shipyard standing) is derived from the
 *   saved row on every read, so it has no countdown. Its exit is heat decay
 *   below Wanted, and `stationHostile` and `dockingRefusedByLaw` say so by
 *   taking no timer at all.
 *
 * Handing the law's refusal to the flip's field would give it the flip's exit:
 * a pilot whose heat decayed out of Wanted would find the station still hostile
 * until a cooldown they never started ran out. That is the permanent lock-out
 * §6 refuses, arriving by the door that was installed to prevent it.
 */
import type { CarrierKey } from "./carrier-key";
import type { StationType } from "./station";
import {
	type LegalStatus,
	type WorldState,
	setLegalHeat,
	setLegalWitnesses,
} from "./world-state";

export const WANTED_HEAT = 10;
export const FUGITIVE_HEAT = 60;
export const HEAT_CAP = 100;
export const HEAT_HALF_LIFE_S = 30 * 60;

/** What an offence against a **Clean** carrier costs. */
export const OFFENCE_HEAT = { destroyed: 40, struck: 15 } as const;

export type Offence = keyof typeof OFFENCE_HEAT;
/** One vocabulary for the player and for a carrier (`combat-model.md` §4). */
export type Standing = "clean" | "wanted" | "fugitive";

/** H4 read through F7: a Wanted or Fugitive target is lawful to fire on. */
export const offenceHeat = (target: Standing, offence: Offence): number =>
	target === "clean" ? OFFENCE_HEAT[offence] : 0;

/**
 * H9: what one offence **adds** when the same carrier's incident already
 * carries a bigger one.
 *
 * A kill supersedes the strike that preceded it, so strike-then-kill costs 40
 * and not 55 — one incident, one charge, read as the worst thing done in it.
 * Summing is what the naive write does, and it is not a rounding difference: it
 * puts the pilot 15 heat and fifteen-odd minutes deeper into Wanted than the
 * ruling chose.
 *
 * `already` is read off the world (`traffic-engagement.ts`'s `chargedOffence`),
 * never off a counter — an incident outlives the session that opened it, and the
 * carrier's **row** is the copy that survives the reload. Not the episode ledger:
 * §4 keeps only the latest episode, and the kill's `interrupt` closes the
 * strike's before its `destroy` opens one that replaces it.
 */
export const marginalOffenceHeat = (
	target: Standing,
	offence: Offence,
	already: Offence | null,
): number =>
	Math.max(
		0,
		offenceHeat(target, offence) - (already ? offenceHeat(target, already) : 0),
	);

/** The stored heat decayed to `gameTime`. A clock before the stamp reads the
 *  stamp's figure: decay never runs backwards. */
export const heatAt = (status: LegalStatus, gameTime: number): number => {
	const elapsed = Math.max(0, gameTime - status.updatedAt);
	return status.heat * 2 ** (-elapsed / HEAT_HALF_LIFE_S);
};

export const legalStandingOf = (heat: number): Standing =>
	heat >= FUGITIVE_HEAT ? "fugitive" : heat >= WANTED_HEAT ? "wanted" : "clean";

export const legalStandingAt = (
	status: LegalStatus,
	gameTime: number,
): Standing => legalStandingOf(heatAt(status, gameTime));

/**
 * Add `heat` to a galaxy's `LegalStatus` at `gameTime`, and record the station
 * the offence happened beside (H5, H6).
 *
 * `witnessed` is required and `null` is an answer: it means the frame body was
 * not a station, which is every fight on a cruise leg. A default of `null` would
 * let a caller that never looked at its own frame body write a heat-only row and
 * look exactly like one that had nothing to witness.
 *
 * **The two halves are written separately, and neither may write the other.**
 * Heat is written decayed-and-stamped; the list is written without touching the
 * stamp, because the stamp is the heat's clock and restamping it to file a
 * witness would hold a pilot Wanted past H4's own duration on an act that cost
 * nothing. A lawful kill beside a station is that case, not an odd one: it adds
 * heat `0` and a witness.
 *
 * Nothing is written at all when there is neither heat nor a new witness, so a
 * lawful act in open space neither restamps the row nor marks the save dirty.
 */
export const withOffence = (
	world: WorldState,
	galaxyIndex: number,
	heat: number,
	gameTime: number,
	witnessed: CarrierKey | null,
): WorldState => {
	const before = world.galaxies[galaxyIndex].legalStatus;
	const witnesses =
		witnessed === null || before.witnesses.includes(witnessed)
			? null
			: [...before.witnesses, witnessed];
	if (!(heat > 0) && witnesses === null) return world;
	let next = world;
	if (heat > 0) {
		const now = heatAt(before, gameTime);
		next = setLegalHeat(
			next,
			galaxyIndex,
			Math.min(HEAT_CAP, now + heat),
			gameTime,
		);
	}
	if (witnesses !== null)
		next = setLegalWitnesses(next, galaxyIndex, witnesses, gameTime);
	return next;
};

/**
 * H5: the station an offence happened beside, seen.
 *
 * Hostility is the list **and** Wanted heat, which is what makes it survivable:
 * the only exit is decay, so no save can be locked out of its only station. That
 * is also why there is no timer here — see the header. The reach that decided
 * whether a station saw an offence at all is the frame body's, `NEAR_FAR_KM`,
 * and it is applied where the offence is charged (`main.ts`), not here: this
 * reads the list, and 20,000 km is not a second witness radius hiding in a
 * predicate.
 *
 * It is the witness half of `dockingRefusedByLaw`, which is its only production
 * caller — a berth's refusal is this plus the shipyard's standing rule. Kept
 * separate because it is what the HUD will one day need on its own (a station
 * hostile because it watched, against a shipyard hostile on standing), and
 * because two copies of the witness-and-decay test are two answers to it.
 */
export const stationHostile = (
	status: LegalStatus,
	station: CarrierKey,
	gameTime: number,
): boolean =>
	status.witnesses.includes(station) && heatAt(status, gameTime) >= WANTED_HEAT;

/**
 * H7's second half, with H5 inside it: whether this station's berth refuses this
 * pilot right now, for a reason of law rather than of the protocol.
 *
 * Two rules, one gate in front of them. **A shipyard refuses on standing
 * alone** — `combat-model.md` §4's "thresholds determine … shipyard hostility" —
 * while a trade station, a refinery and an outpost refuse only what they saw.
 * Both need Wanted heat, so the heat test comes first and both halves read as
 * the exit it gives them: decay.
 *
 * It takes the station as key **and** type because the two halves ask different
 * questions about it, and a caller that passed a type it had guessed would ship
 * a refusal at the wrong berths.
 */
export const dockingRefusedByLaw = (
	status: LegalStatus,
	station: { key: CarrierKey; type: StationType },
	gameTime: number,
): boolean =>
	station.type === "shipyard"
		? heatAt(status, gameTime) >= WANTED_HEAT
		: // The witness half is `stationHostile`'s, called rather than restated:
			// the two are one rule, and a berth that drifts from the other would
			// refuse for a reason nothing else in the file agrees to.
			stationHostile(status, station.key, gameTime);

/**
 * H6: drop the witness list once heat has decayed below Wanted.
 *
 * **Lazy, on read, and it returns the same world when there is nothing to
 * drop.** The caller is `main.ts`'s flight step, which runs on every frame a
 * session is alive; a clear that copied eight galaxy envelopes each time would
 * mark the save dirty for a pilot who has never fired on anyone. The list is
 * inert below Wanted — nothing reads it there — so this is H6's bound on its
 * size, not a behaviour.
 */
export const settleWitnesses = (
	world: WorldState,
	galaxyIndex: number,
	gameTime: number,
): WorldState => {
	const status = world.galaxies[galaxyIndex].legalStatus;
	if (status.witnesses.length === 0) return world;
	if (heatAt(status, gameTime) >= WANTED_HEAT) return world;
	return setLegalWitnesses(world, galaxyIndex, [], gameTime);
};
