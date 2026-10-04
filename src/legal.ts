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
 * **An offence is one event, `chargeOffence`** (#633). It takes the raw facts
 * of the act and returns the next world and the heat, and the steps it is
 * composed of — the incident's arithmetic, the heat-and-hearer write, the
 * assault mark — are this module's own and not exported. So the law is written
 * here once, and `Game` hands over facts and adopts a world rather than putting
 * the charge together from the parts. The session around it — the hail guard,
 * the charge notice, the Communications log — stays `Game`'s (#72).
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
import { carrierStanding } from "./carrier-standing";
import { type EarshotStation, stationsInEarshot } from "./distress";
import type { StationType } from "./station";
import type { Vec3 } from "./vec3";
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
 * it. The figure itself is a **declared starting form** (H12's precedent), and
 * what it buys is derived rather than remembered: heat halves every
 * `HEAT_HALF_LIFE_S`, so a charge of `h` reads below Wanted after
 * `log2(h / WANTED_HEAT)` half-lives — **11.4 minutes** at 13, the figure H4
 * quotes, against the strike's 17.5 at 15. Two things follow from the shape of
 * that mapping, and both are worth knowing before touching the dial. The first is
 * that the interval's heat is not its legal life: 13 stands three-fifths of the
 * way up the 10 … 15 it may not leave, and buys sixty-five percent of the time
 * the top of that interval would buy, because the conversion is a logarithm and
 * its middle is not the middle. The second is that **this is a span of minutes
 * while `ASSAULT_FIRE_S` is five seconds of fire** — the price and the act are
 * different quantities, and the distance between them is not an argument for
 * moving either one.
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
 * `already` is read off the world (`chargedOffence`, below), never off a
 * counter — an incident outlives the session that opened it. The strike and the
 * kill come from the carrier's **row**, which is the copy that survives the
 * reload, handed over as the strike's clock (`OffenceFacts.carrier.struckAt`);
 * the assault comes from this module's own list, for the
 * reason given under "Why the assault charge is remembered here". Not the episode
 * ledger: §4 keeps only the latest episode, and the kill's `interrupt` closes the
 * strike's before its `destroy` opens one that replaces it.
 */
const marginalOffenceHeat = (
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
 * `heardBy` is **required, and an empty list is an answer**: it means the
 * earshot was computed and nobody was in it. A default of `[]` would put back the
 * ambiguity that `witnessed: CarrierKey | null` was originally required to keep —
 * "nobody heard" against "nobody looked" — and a charge that never looked is the
 * one that gets H5's refusal wrong in the direction that reads as the law
 * working. `distress.ts`'s `stationsInEarshot` is the computation, and it returns
 * `[]` honestly; since #633 its one caller is `chargeOffence`, which takes every
 * station as a required fact and computes the earshot itself.
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
const withOffence = (
	world: WorldState,
	galaxyIndex: number,
	heat: number,
	gameTime: number,
	heardBy: readonly CarrierKey[],
): WorldState => {
	const before = world.galaxies[galaxyIndex].legalStatus;
	// **The caller's list is taken as a set.** A hearer is a fact about a berth,
	// not a line in a save, and nothing upstream guarantees the caller's own
	// list has no repeats in it — a berth written twice is a saved row that says
	// one station heard the offence twice, and the size instrument would price
	// that as the law's cost.
	const fresh = [
		...new Set(heardBy.filter((key) => !before.witnesses.includes(key))),
	];
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
 * **Only when the charge cost heat** (`charged` below), which is
 * `chargeOffence`'s figure, priced in the same event. A mark is the record of a charge,
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
const markAssaultCharged = (
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

/** H9: the offence this carrier's incident says the pilot has already paid for.
 *
 *  The divert *is* the strike's incident: `disable` opened it, the repair is
 *  running, and the kill that interrupts it closes it. So a carrier standing in
 *  its home berth under a repair the player's own fire caused has already cost
 *  them H4's strike heat, and the kill that finishes it owes the difference and
 *  not a second offence. Read off the world rather than a counter, because the
 *  incident outlives the session that opened it.
 *
 *  **`standingAtStrike` is not decoration, and `null` does not mean "clean".**
 *  Only an offence against a Clean carrier costs anything (H4), so a strike on a
 *  carrier that was Wanted charged nothing, and the kill that follows it is
 *  worth its full 40 even if the rotation has since made the target Clean again
 *  — the rotation runs six hours and the repair 1200 s plus up to a cycle, so
 *  those two clocks do disagree sometimes. `null` says there is no strike to
 *  stand for, or that its standing cannot be established, and the answer to
 *  both is that nothing has been paid: the safe direction, because the
 *  alternative is a discount for a hit the player was never charged for.
 *
 *  **The second source is this module's own list.** A sub-hull offence leaves no
 *  trace on the carrier's row — an ordinary carrier under fire gets exactly one
 *  transition, H3c's `disable`, and the sustained-fire rung charges the pilot
 *  *before* the hull point that earns it is spent. So the fact lives beside
 *  `witnesses` in `LegalStatus` (the header says why), and it needs no standing
 *  of its own to be reported where the strike does: an assault mark is written
 *  only when it cost heat, and heat means the target was Clean at the tick it
 *  was judged (F7).
 *
 *  Moved here from `traffic-engagement.ts` by #633. It used to take the
 *  carrier's row and ask `trafficPresence` where the ship stands; that question
 *  is the caller's now (`strikeClock`), answered as the strike's clock, which is
 *  what lets this module price the incident without importing the module that
 *  imports it. */
const chargedOffence = (
	standingAtStrike: Standing | null,
	assaultPaid: boolean,
): Offence | null => {
	if (standingAtStrike !== null && offenceHeat(standingAtStrike, "struck") > 0)
		return "struck";
	return assaultPaid ? "assault" : null;
};

/**
 * One offence against one ordinary carrier, as raw facts (#633's D2): what was
 * done, where and when, to which carrier, and where every station in the system
 * stood. Nothing in it is a judgement — the standings, the incident, the heat
 * and the hearers are all derived inside `chargeOffence`.
 */
export interface OffenceFacts {
	offence: Offence;
	galaxy: number;
	/** The clock the act is judged at, and the stamp it is written with. */
	now: number;
	/** The system seed, which carries the galaxy: what a standing derives from. */
	systemSeed: number;
	carrier: {
		key: CarrierKey;
		/** The instance that was fired on — read **before** any transition the
		 *  act applied, because a kill's replacement is the next instance. */
		instanceOrdinal: number;
		/** The clock of the strike the carrier is standing in its home berth for
		 *  (`traffic-engagement.ts`'s `strikeClock`), or `null` when it is not
		 *  standing for one. Required for `FlightPerformance`'s reason: a caller
		 *  that forgot it would bill every kill after a strike its full 40. */
		struckAt: number | null;
	};
	/** Where the **victim** stood: the earshot is measured from it, never from
	 *  the pilot (#396's amendment of H5). */
	victim: Vec3;
	/** Every station in the system. `[]` is an answer — a system with no
	 *  station — and the earshot is computed here from it, so no caller can
	 *  hand over a hearer list it never looked for. */
	stations: readonly EarshotStation[];
}

/**
 * Charge one offence (H4, H5, H9, #396), as one event: the next world and what
 * the act cost (#633).
 *
 * **The standing is read at two clocks.** The target's at `now`, because an
 * offence is judged on true standing (F7), and the target's at the strike it is
 * standing for, because standing is never saved — it is a pure derivation from
 * the instance and the clock — and the repair's `startedAt` *is* the strike's
 * clock, H3c writing both in one tick. So the kill can ask what the earlier hit
 * actually cost without a field in the save.
 *
 * **An incident is charged once, as its largest rung** (H9): `chargedOffence`
 * names what the incident has already paid — the strike from the carrier's
 * clock, the assault from this module's list — and `marginalOffenceHeat` charges
 * the difference.
 *
 * **The hearers are filed whether or not the act cost heat.** A kill of a
 * Wanted carrier is lawful and free (F7), and a station that heard one heard
 * it; H6's hostility is the list *and* Wanted heat, so filing it can no more
 * make a Clean pilot hostile than the kill did. Gating the write on `heat > 0`
 * is what #366's first pass did, and it drops the third of H5 that is not about
 * heat.
 *
 * **An assault leaves its mark in the same event**, and only when it cost heat:
 * the mark is the record of a charge, and a free five seconds leaves no
 * discount behind. So an assault is one write and not two.
 *
 * **It hands back the world it was given when it wrote nothing** — a lawful act
 * with nobody in earshot, or a rung the incident had already paid — which is
 * what lets the caller save on a change in reference and on nothing else.
 */
export const chargeOffence = (
	world: WorldState,
	facts: OffenceFacts,
): { world: WorldState; heat: number } => {
	const { offence, galaxy, now, systemSeed, carrier } = facts;
	const standingAt = (atS: number) =>
		carrierStanding(systemSeed, carrier.key, carrier.instanceOrdinal, atS);
	// Read off the world as it was handed over, before this event writes it.
	const heat = marginalOffenceHeat(
		standingAt(now),
		offence,
		chargedOffence(
			carrier.struckAt === null ? null : standingAt(carrier.struckAt),
			assaultCharged(world.galaxies[galaxy].legalStatus, carrier.key),
		),
	);
	let next = withOffence(
		world,
		galaxy,
		heat,
		now,
		stationsInEarshot(facts.stations, facts.victim),
	);
	if (offence === "assault")
		next = markAssaultCharged(next, galaxy, carrier.key, heat, now);
	return { world: next, heat };
};

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
 * Three rules. **A shipyard refuses on standing alone** — `combat-model.md`
 * §4's "thresholds determine … shipyard hostility" — while a trade station and
 * a refinery refuse only what they saw. Both need Wanted heat, so both read as
 * the exit it gives them: decay.
 *
 * **The raider outpost is the witness rule inverted (#490 D5): it refuses a
 * pilot *below* Wanted and admits one at or above it.** It is available because
 * of what the other two are written to protect — no save can be locked out of
 * its only station — and an outpost is never a system's only station: every
 * system has a trade station on its primary (#51). Its exit is the other
 * direction, so standing is a key there rather than only a penalty. It
 * witnesses nothing (D10), so the witness half never reaches it.
 *
 * **Today this arm is behind a closed berth.** The outpost has no market yet
 * (#490 D6), so `STATION_BERTHS_OPEN.outpost` refuses every pilot before the
 * law is asked; this is the rule that governs the berth the day that opens.
 *
 * It takes the station as key **and** type because the halves ask different
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
		: station.type === "outpost"
			? heatAt(status, gameTime) < WANTED_HEAT
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
