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
 * **The ladder has three rungs since #396, and they are ordered by rung.** A
 * kill is 40, a hull strike 15, and five seconds of landed fire on one ordinary
 * carrier 13 — `OFFENCE_LADDER` carries that order and `offenceRank` reads it,
 * because `marginalOffenceHeat` has to compare *which act* the incident already
 * carries rather than which figure is larger. Comparing the figures works for as
 * long as nobody retunes one into another, and the interval that keeps them
 * apart is `tests/legal.test.ts`'s, not this module's.
 *
 * ## Why the assault charge is remembered here and not on the carrier's row
 *
 * H9 reads an incident off the carrier's own row — `trafficPresence` says a
 * struck carrier is standing in its home berth, and that is what tells a kill it
 * is superseding a strike. **An assault has no such fact to read.** A traffic
 * carrier under fire receives exactly one transition from the player, H3c's
 * `disable`, and it is the hull strike that writes it; the sustained-fire charge
 * lands *before* the first hull point is spent, while the target is still an
 * operational Clean ship with nothing on its row saying anything happened to it.
 * A field on that row would have to describe a state the row's own enumeration
 * cannot hold, and `world-state.ts` refuses writes it has not been told about.
 *
 * So the charge is a second saved list beside `witnesses`, which is #396's
 * stated preference and the same door the witnesses came in by: omitted by
 * `canonicalEnvelope` when empty, so an old save keeps the bytes and the hash it
 * was written with, parsed to `[]` when absent, and cleared by `settleIncident`
 * on the same read below Wanted. **A mark is the record of a charge, so a charge
 * that cost nothing leaves none** (F7): a free rung must not sit in the row
 * discounting the next strike on that carrier by 13 the pilot was never billed.
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
	setLegalAssaulted,
} from "./world-state";

export const WANTED_HEAT = 10;
export const FUGITIVE_HEAT = 60;
export const HEAT_CAP = 100;
export const HEAT_HALF_LIFE_S = 30 * 60;

/**
 * What an offence against a **Clean** carrier costs.
 *
 * **`assault` sits in an interval it may not leave, and the interval is not a
 * dial.** At or below `WANTED_HEAT` the charge crosses Wanted and un-crosses it
 * on the next frame, so the offence is a flash nothing can act on; at or above
 * the strike's 15 the lattice below ties and two rungs the law has to order
 * become one. Its whole legal life is the open interval 10 … 15, which is why
 * `tests/legal.test.ts` pins the figure against both bounds rather than quoting
 * it. The figure itself is a **declared starting form** (H12's precedent): 13 is
 * eleven minutes Wanted, of the four to fourteen minutes the interval buys.
 */
export const OFFENCE_HEAT = { assault: 13, struck: 15, destroyed: 40 } as const;

export type Offence = keyof typeof OFFENCE_HEAT;

/**
 * The three rungs, least to most serious. **H9's lattice is this order and not
 * an ordering of the figures above** — the figures are dials and the order is
 * the law, so `marginalOffenceHeat` compares ranks. Read the two together: the
 * ordering is what the figures must never be allowed to contradict, and the test
 * that holds one is the test that holds the other.
 */
export const OFFENCE_LADDER = ["assault", "struck", "destroyed"] as const;

/** How serious one offence is, as its position on the ladder. */
export const offenceRank = (offence: Offence): number =>
	OFFENCE_LADDER.indexOf(offence);
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
 * **The comparison is by rank, not by heat, and #396's third rung is why.** A
 * `Math.max` over the two figures orders the lattice by price, which was sound
 * while the ladder had two rungs and their prices could not be argued about.
 * With three, and with every one of the three declared as a tunable starting
 * form, a retune that priced `assault` above `struck` would silently re-order
 * the law — an assault would supersede a strike — without a single row of this
 * file changing. Ordering by `OFFENCE_LADDER` makes that a contradiction between
 * two things in one module rather than a quiet behaviour.
 *
 * `already` is read off the world (`traffic-engagement.ts`'s `chargedOffence`),
 * never off a counter — an incident outlives the session that opened it. The
 * strike and the kill come from the carrier's **row**, which is the copy that
 * survives the reload; the assault comes from this module's own list, for the
 * reason given under "Why the assault charge is remembered here". Not the episode
 * ledger: §4 keeps only the latest episode, and the kill's `interrupt` closes the
 * strike's before its `destroy` opens one that replaces it.
 */
export const marginalOffenceHeat = (
	target: Standing,
	offence: Offence,
	already: Offence | null,
): number => {
	const cost = offenceHeat(target, offence);
	if (already === null || cost === 0) return cost;
	return offenceRank(already) >= offenceRank(offence)
		? 0
		: cost - offenceHeat(target, already);
};

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
 * Add `heat` to a galaxy's `LegalStatus` at `gameTime`, and file every station
 * that heard it (H5, H6, as amended by #396).
 *
 * `heardBy` is **required, and an empty list is an answer**: it means the caller
 * computed the earshot and nobody was in it. A default of `[]` would put back the
 * ambiguity that `witnessed: CarrierKey | null` was originally required to keep —
 * "nobody heard" against "the caller never looked" — and the caller that never
 * looked is the one that gets H5's refusal wrong in the direction that reads as
 * the law working. `distress.ts`'s `stationsInEarshot` is the computation, and it
 * returns `[]` honestly.
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
	heardBy: readonly CarrierKey[],
): WorldState => {
	const before = world.galaxies[galaxyIndex].legalStatus;
	const fresh = heardBy.filter((key) => !before.witnesses.includes(key));
	const witnesses = fresh.length ? [...before.witnesses, ...fresh] : null;
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
 * Record that this carrier's **sustained-fire charge** has been paid, so a reload
 * into the same fight cannot charge it again (#396 §2's binding obligation).
 *
 * **Only when the charge cost heat** (`charged` below), which is the caller's
 * figure and not a fact this module can derive. A mark is the record of a charge,
 * and a five seconds judged lawful at its tick (F7) is not one — the pilot was
 * never billed, and a later strike on the same carrier whose rotation has since
 * turned it Clean would read the mark as "the assault rung is already paid" and
 * cost 2 where 15 is owed. **A free act must not leave a discount behind.** What
 * stops the same five seconds being run twice is the fight's own latch
 * (`Engagement.assaultCharged`, latched on the crossing whether or not it cost),
 * and the world's copy exists to re-seed that latch across a reload — a reload
 * into a lawful five seconds has nothing to restore.
 *
 * **It is written with the heat and never restamps it.** `setLegalAssaulted`
 * touches the list only, for `withOffence`'s reason: a mark that restamped the
 * row would hold a pilot Wanted past the duration the last real offence set.
 */
export const markAssaultCharged = (
	world: WorldState,
	galaxyIndex: number,
	carrier: CarrierKey,
	/** What the charge cost. Zero means it was lawful, and a lawful act leaves no
	 *  mark — see the reason above. */
	charged: number,
	gameTime: number,
): WorldState => {
	if (charged <= 0) return world;
	const before = world.galaxies[galaxyIndex].legalStatus;
	if (before.assaulted.includes(carrier)) return world;
	return setLegalAssaulted(
		world,
		galaxyIndex,
		[...before.assaulted, carrier],
		gameTime,
	);
};

/** Whether this carrier's sustained-fire charge is already paid. */
export const assaultCharged = (
	status: LegalStatus,
	carrier: CarrierKey,
): boolean => status.assaulted.includes(carrier);

/**
 * H5: the station an offence happened beside, seen.
 *
 * Hostility is the list **and** Wanted heat, which is what makes it survivable:
 * the only exit is decay, so no save can be locked out of its only station. That
 * is also why there is no timer here — see the header. **Which stations are in
 * the list is not decided here either**: the reach is a station's earshot of the
 * victim (`distress.ts`'s `DISTRESS_RANGE_KM`, #396's amendment of H5), applied
 * where the offence is charged, and this predicate reads the resulting list. A
 * second radius hiding in a predicate is precisely what it is not — the same
 * figure applied twice would make the amendment a widening on the way in and a
 * narrowing on the way out.
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
 * H6: drop the saved offence memory once heat has decayed below Wanted — the
 * stations that heard, and the carriers whose sustained-fire charge is spent.
 *
 * **Lazy, on read, and it returns the same world when there is nothing to
 * drop.** The caller is `main.ts`'s flight step, which runs on every frame a
 * session is alive; a clear that copied eight galaxy envelopes each time would
 * mark the save dirty for a pilot who has never fired on anyone. The lists are
 * inert below Wanted — nothing reads them there — so this is H6's bound on their
 * size, not a behaviour.
 *
 * **Both lists, in one clear, because both incidents are bounded by the same
 * clock.** #396's "once per carrier per incident" needs an ending, and this is
 * the only ending the law has: an incident lasts exactly as long as the heat it
 * cost. Clearing one and not the other would either pardon a carrier forever or
 * hold a station hostile past its own decay, and both of those are the permanent
 * lock-out the header refuses.
 */
export const settleIncident = (
	world: WorldState,
	galaxyIndex: number,
	gameTime: number,
): WorldState => {
	const status = world.galaxies[galaxyIndex].legalStatus;
	if (status.witnesses.length === 0 && status.assaulted.length === 0)
		return world;
	if (heatAt(status, gameTime) >= WANTED_HEAT) return world;
	let next = world;
	if (status.witnesses.length)
		next = setLegalWitnesses(next, galaxyIndex, [], gameTime);
	if (next.galaxies[galaxyIndex].legalStatus.assaulted.length)
		next = setLegalAssaulted(next, galaxyIndex, [], gameTime);
	return next;
};
