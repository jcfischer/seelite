/**
 * What a pilot's act does to their **Holdings** (#626): the commander, the
 * Requests journal, the ladder record and its pending credit — and the world
 * writes the act causes.
 *
 * The reducers this applies were already pure: `requestAction`,
 * `transactAtStation`, `scoopCargo`. Applying their results was not. `Game`
 * credited the reward, folded the cargo delta, moved the purchase basis and
 * wrote the deficit mark by hand at three sites, and the rule that **the basis
 * follows the cargo** was written once per site. This is the one copy.
 *
 * Pure: no Three.js, no DOM. The world is an input and comes back as an
 * output; nothing here reads a clock or a renderer. `Game` keeps the fields
 * (#437: one save schema, state on the Commander record) and adopts what this
 * returns, and derives its save and repaint from a change in reference — so
 * **a refusal returns the very objects it was given**, and an accepted event
 * always returns a new `Holdings`.
 *
 * The board (`requestsView`, its cache) is `Game`'s: a settlement carries the
 * acted-on offer rather than the board.
 */

import type { HullId } from "./hull";
import {
	type LadderRecord,
	type PendingCredit,
	basisAfterScoop,
	ladderAfterHullSale,
	ladderAfterMarket,
	ladderAfterSettlement,
	withCapstone,
} from "./ladder";
import { recordTrade } from "./deficits";
import type { Standing } from "./legal";
import {
	type RequestOffer,
	type RequestStation,
	type RequestsState,
	entrustedTonnesAboard,
	requestAction,
} from "./requests";
import {
	type CommanderState,
	type StationAction,
	type StationCommerceResult,
	commanderHold,
	scoopCargo,
} from "./station-commerce";
import { type WorldState, setDeficits } from "./world-state";

/** Everything a pilot owns that an act at a console or in space can move. */
export interface Holdings {
	readonly commander: CommanderState;
	readonly requests: RequestsState;
	readonly ladders: LadderRecord;
	readonly ladderPending: PendingCredit;
}

/** A till result the till accepted. A refusal is not a hold event: it moves
 *  nothing, and its sentence is the console's to word. */
export type AcceptedTrade = Extract<StationCommerceResult, { accepted: true }>;

export type HoldEvent =
	/** A press on the Requests board other than `details`, which is the
	 *  board's own state. */
	| {
			kind: "settlement";
			action: string;
			id: string;
			/** The acted-on offer as the board shows it, or null when the
			 *  board does not — an accepted job or a kept lead is read off the
			 *  journal instead. */
			offer: RequestOffer | null;
			docked: RequestStation | null;
			standing: Standing;
			/** The galaxy the ship is in, which is where a mark is filed. */
			galaxyIndex: number;
			/** The world clock, seconds. */
			at: number;
	  }
	/** An accepted till transaction, hull sale included. `Game` prices it
	 *  through `consoleInput`, the one builder the Shipyard rows share (#583). */
	| {
			kind: "market";
			action: StationAction;
			result: AcceptedTrade;
			galaxyIndex: number;
			at: number;
	  }
	/** A canister the ship passed close and slow. */
	| { kind: "scoop"; commodity: string; tonnes: number };

/** What `Game` has to act on beyond adopting the state. A closed set. */
export interface HoldSignals {
	/** The hull a purchase delivered, for the berth and the mesh. */
	hullChanged: HullId | null;
	/** The sentence a Requests press prints, accepted or refused. */
	message: string | null;
}

export interface HoldOutcome {
	holdings: Holdings;
	world: WorldState;
	signals: HoldSignals;
}

/**
 * The hold as both owners of it see it: ordinary cargo on the commander and
 * entrusted lots in the journal. `capacityT` is the **flown** hull's, bay
 * included (#182) — the figure every mark is written with.
 */
export const holdOf = (h: Pick<Holdings, "commander" | "requests">) =>
	commanderHold(h.commander, entrustedTonnesAboard(h.requests));

const QUIET: HoldSignals = { hullChanged: null, message: null };

const unchanged = (
	holdings: Holdings,
	world: WorldState,
	signals: HoldSignals = QUIET,
): HoldOutcome => ({ holdings, world, signals });

const withCargoDelta = (
	commander: CommanderState,
	delta: Readonly<Record<string, number>>,
): CommanderState => {
	if (Object.keys(delta).length === 0) return commander;
	const cargo = { ...commander.cargo };
	for (const [good, change] of Object.entries(delta)) {
		const amount = (cargo[good] ?? 0) + change;
		if (amount <= 0) delete cargo[good];
		else cargo[good] = amount;
	}
	return { ...commander, cargo };
};

function settle(
	holdings: Holdings,
	world: WorldState,
	event: Extract<HoldEvent, { kind: "settlement" }>,
): HoldOutcome {
	const hold = holdOf(holdings);
	const result = requestAction(
		holdings.requests,
		event.offer ? [event.offer] : [],
		event.action,
		event.id,
		{
			now: event.at,
			docked: event.docked,
			cargo: holdings.commander.cargo,
			holdRoomT: Math.max(0, hold.capacityT - hold.usedT),
			standing: event.standing,
			equipment: holdings.commander.ownedEquipment,
		},
	);
	const signals = { ...QUIET, message: result.message };
	if (!result.ok) return unchanged(holdings, world, signals);
	const commander = withCargoDelta(
		result.rewardCr
			? {
					...holdings.commander,
					credits: holdings.commander.credits + result.rewardCr,
				}
			: holdings.commander,
		result.cargoDelta,
	);
	// #183 D3: a settlement's pay banks at once — a report happens docked —
	// and goods a job took take their basis with them.
	const ladders = withCapstone(
		ladderAfterSettlement(
			holdings.ladders,
			result.rewardCr ?? 0,
			commander.cargo,
		),
		event.at,
	);
	const next: Holdings = {
		...holdings,
		commander,
		requests: result.state,
		ladders,
	};
	if (!result.mark) return { holdings: next, world, signals };
	// §4's mark, through the module's own writer and with the **flown** hull's
	// hold (#182) — the same figure the till uses. The row is stamped in game
	// minutes and the envelope in seconds; this is the one conversion.
	const { galaxyIndex, at } = event;
	return {
		holdings: next,
		world: setDeficits(
			world,
			galaxyIndex,
			recordTrade(world.galaxies[galaxyIndex].deficits, result.mark.key, {
				...result.mark.trade,
				gameTimeMin: at / 60,
				holdT: holdOf(next).capacityT,
			}),
			at,
		),
		signals,
	};
}

function trade(
	holdings: Holdings,
	world: WorldState,
	event: Extract<HoldEvent, { kind: "market" }>,
): HoldOutcome {
	const { action, result } = event;
	// #183 D3: a buy records its basis, a sale banks its margin at once. Both
	// read the hold as it stood before the press.
	const ladders = withCapstone(
		action.type === "buy-hull"
			? ladderAfterHullSale(
					holdings.ladders,
					holdings.commander.cargo,
					result.sold ?? [],
				)
			: ladderAfterMarket(
					holdings.ladders,
					action,
					holdings.commander,
					result.commander,
				),
		event.at,
	);
	return {
		holdings: { ...holdings, commander: result.commander, ladders },
		// Through the module's own writer: `setDeficits` carries the galaxy
		// bound, the "no write before the clock" refusal and `materializeDue`.
		world: setDeficits(world, event.galaxyIndex, result.deficits, event.at),
		signals: {
			...QUIET,
			hullChanged: action.type === "buy-hull" ? result.commander.hull : null,
		},
	};
}

function scoop(
	holdings: Holdings,
	world: WorldState,
	event: Extract<HoldEvent, { kind: "scoop" }>,
): HoldOutcome {
	const took = scoopCargo(
		holdings.commander,
		event.commodity,
		event.tonnes,
		entrustedTonnesAboard(holdings.requests),
	);
	if (!took.accepted) return unchanged(holdings, world);
	return {
		holdings: {
			...holdings,
			commander: took.commander,
			// Scooped goods cost nothing, so their sale is all margin (the
			// principal's ruling on #564).
			ladders: {
				...holdings.ladders,
				basis: basisAfterScoop(
					holdings.ladders.basis,
					event.commodity,
					took.tonnes,
				),
			},
		},
		world,
		signals: QUIET,
	};
}

/** One hold event, applied whole or not at all. */
export function applyHoldEvent(
	holdings: Holdings,
	world: WorldState,
	event: HoldEvent,
): HoldOutcome {
	switch (event.kind) {
		case "settlement":
			return settle(holdings, world, event);
		case "market":
			return trade(holdings, world, event);
		case "scoop":
			return scoop(holdings, world, event);
	}
}
