/**
 * The player's legal heat (`civilian-combat.md` H4).
 *
 * **The semantics are `combat-model.md` §4's and the figures are this node's.**
 * §4 rules legal status per galaxy, bounded, read as Clean, Wanted or
 * Fugitive, decaying lazily on a 30-minute half-life. It named no offence cost
 * and no threshold, and #362 set them with the principal: a Clean kill is 40,
 * a strike 15, Wanted at 10, Fugitive at 60, capped at 100. The scale is Elite's
 * legal value in shape — an offender band, and a fugitive band that one incident
 * does not reach. **One incident is the unit**, and that is `marginalOffenceHeat`
 * (H9): the two figures are what an offence costs on its own, not what it adds
 * to an episode that already carries one.
 *
 * **What is saved is `LegalStatus`'s pair and nothing else.** A standing label
 * is a §8 projection, derived here on read (`persistent-world-state.md` §7),
 * and decay is never written back: a read at a later clock decays the stored
 * figure from its stamp, and a write stores the decayed figure plus the
 * offence, stamped then.
 *
 * **An offence is judged on the target's true standing** (`carrier-identity.md`
 * F7), whether or not the pilot scanned it. So `offenceHeat` takes a standing,
 * not what the pilot knew.
 */
import { type LegalStatus, type WorldState, setLegalHeat } from "./world-state";

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
 * H9: what one offence **adds** when the same carrier's episode already
 * carries a bigger one.
 *
 * A kill supersedes the strike that preceded it, so strike-then-kill costs 40
 * and not 55 — one incident, one charge, read as the worst thing done in it.
 * Summing is what the naive write does, and it is not a rounding difference: it
 * puts the pilot 15 heat and fifteen-odd minutes deeper into Wanted than the
 * ruling chose.
 *
 * `already` is read off the world (`traffic-engagement.ts`'s `chargedOffence`),
 * never off a counter — an episode outlives a session, and the ledger is the
 * only copy that survives the reload.
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
 * Add `heat` to a galaxy's legal status at `gameTime`: the stored figure
 * decayed to now, plus the offence, capped. A lawful act (`heat` 0) returns the
 * world unchanged, so it neither restamps nor marks the save dirty.
 */
export const withOffence = (
	world: WorldState,
	galaxyIndex: number,
	heat: number,
	gameTime: number,
): WorldState => {
	if (!(heat > 0)) return world;
	const now = heatAt(world.galaxies[galaxyIndex].legalStatus, gameTime);
	return setLegalHeat(
		world,
		galaxyIndex,
		Math.min(HEAT_CAP, now + heat),
		gameTime,
	);
};
