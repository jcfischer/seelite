/**
 * The checkpoint a death restores when there is no `lastDocked` record to
 * restore (#660 D10, built by node #702), and the record-borne witness that
 * says whether that absence is a first life or a lost write.
 *
 * Its own module rather than `holdings.ts`'s: Holdings owns what a pilot's
 * act does to them, and neither of these is an act. `commanderAfterDeath`
 * stays there and still owns which fields a death restores; `save-store.ts`
 * hands it either a written dock record or this one.
 *
 * Pure: no Three.js, no DOM, no store.
 */

import { carrierKey } from "./carrier-key";
import { generateGalaxy, startSystem } from "./galaxy";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "./hull";
import { type CommanderRecord, newCommanderRecord } from "./save-envelope";
import { START_GALAXY } from "./sim";
import { generateContents } from "./system";

/**
 * The checkpoint of a pilot who has never docked: a **new commander docked at
 * the start system's trade station** — the stock hull, `STARTING_CREDITS`, an
 * empty hold, a full tank and charge, no requests. It stands in for the
 * `lastDocked` record such a pilot does not have, and goes through
 * `commanderAfterDeath` like any dock record.
 *
 * **Derived at the death, not written at new game.** A start lays down no
 * record: a pilot with no `lastDocked` is the one the opening still owes a
 * dock to (`openingOwedOnLoad`), and a save from before this node has none
 * either. The start system is `startSystem` of the world's own seed — a boot
 * that pins another system writes nothing (§11.6), so every stored world
 * started there — and its trade station is the first `trade` row of the
 * system's contents, which is the station a guided start docks at
 * (`startDockedAtHome`).
 *
 * Two fields come from the dying record because neither is a dock's to set:
 * `permadeath` and `firstDay` are written once at creation and never edited,
 * and the ladders are never touched by a death (#183, §9) — their basis is
 * emptied with the hold, because the parser refuses a basis covering more than
 * is aboard.
 */
export const firstCheckpoint = (
	worldSeed: number,
	dying: CommanderRecord,
): CommanderRecord => {
	const galaxy = generateGalaxy(worldSeed, START_GALAXY);
	const start = startSystem(galaxy);
	const trade = generateContents(start).stations.find(
		(s) => s.type === "trade",
	);
	if (!trade)
		throw new Error(
			`save: start system ${start.index} has no trade station to wake at`,
		);
	const base = newCommanderRecord(PLAYER_BASELINE_HULL, {
		permadeath: dying.permadeath,
		firstDay: dying.firstDay,
		galaxyIndex: START_GALAXY,
		systemIndex: start.index,
		chargeAu: HULL_SPECS[PLAYER_BASELINE_HULL].chargeAu,
	});
	return {
		...base,
		dockedAt: carrierKey(start.index, trade.localCarrierId),
		ladders: { ...dying.ladders, basis: {} },
	};
};

/**
 * Whether this commander has ever docked, read off the record rather than off
 * a store's memory, so it survives a reload that a failed `lastDocked` write
 * does not. A commander still naming a station has docked; so has one whose
 * ladders record a visited station, and a new game seeds none.
 *
 * Two things make the visited set a witness, and each is held by a row
 * rather than by this comment: the dock's hold event banks the station into
 * `ladders.visited` (`bankOnDock`, which the reload row in
 * `tests/save-store.test.ts` drives through `applyHoldEvent`), and `Game`
 * banks **before** the dock flush (`tests/world-state-wiring.test.ts`, "the
 * jump keeps its flush and the dock its flush, after the adopt"), so the
 * flush that may fail to write `lastDocked` carries the set to `live`.
 *
 * It is what keeps `firstCheckpoint` for the pilot it is for: an absent
 * `lastDocked` beside a commander that docked is a lost record, and waking
 * them as a new commander would be the silent substitution #89 D9 rules out
 * (sage round 2 on node #702).
 */
export const hasDocked = (commander: CommanderRecord): boolean =>
	commander.dockedAt !== null ||
	Object.values(commander.ladders.visited).some(
		(places) => (places?.stations.length ?? 0) > 0,
	);
