/**
 * What a pilot's act does to their **Holdings** (#626, #627): the commander,
 * the Requests journal, the ladder record and its pending credit — and the
 * world writes the act causes.
 *
 * The reducers this applies were already pure: `requestAction`,
 * `transactAtStation`, `scoopCargo`. Applying their results was not. `Game`
 * credited the job's pay, folded the cargo delta, moved the purchase basis and
 * wrote the deficit mark by hand at three sites, and the rule that **the basis
 * follows the cargo** was written once per site. This is the one copy.
 *
 * #627 brought the other three: a carrier transition, a jump arrival and a
 * dock. A kill paid its bounty in one place and its combat ladder in another,
 * called by hand at four sites that nothing checked; one event now pays both.
 *
 * Pure: no Three.js, no DOM. The world is an input and comes back as an
 * output; nothing here reads a clock or a renderer. `Game` keeps the fields
 * (#437: one save schema, state on the Commander record) and adopts what this
 * returns, and derives its save and repaint from a change in reference — so
 * **a refusal returns the very objects it was given**, and an event that moves
 * nothing a pilot owns returns the `Holdings` it was given. A carrier
 * transition other than the player's kill is that case and still changes the
 * world, so `Game` adopts the world whatever the holdings say.
 *
 * The board (`requestsView`, its cache) is `Game`'s: a settlement carries the
 * acted-on offer rather than the board.
 */

import { scoopWreckContainer } from "./derelict";
import type { Vec3 } from "./vec3";
import type { CarrierKey } from "./carrier-key";
import type { DeathCause } from "./death-cost";
import type { CommanderRecord } from "./save-envelope";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "./hull";
import { killCredit } from "./kill-credit";
import {
	type LadderRecord,
	type PendingCredit,
	bankOnDock,
	basisAfterScoop,
	emptyPending,
	ladderAfterDeath,
	ladderAfterHullSale,
	ladderAfterMarket,
	ladderAfterSettlement,
	pendingArrival,
	pendingKill,
	withCapstone,
} from "./ladder";
import { recordTrade } from "./deficits";
import { ESCAPE_POD } from "./market";
import type { Standing } from "./legal";
import { PLAYER_KILL } from "./raider-wreck";
import {
	type RequestOffer,
	type RequestStation,
	type RequestsState,
	entrustedTonnesAboard,
	readiedBy,
	recordKill,
	requestAction,
	requestsAfterLostHold,
} from "./requests";
import {
	type CommanderState,
	type StationAction,
	type StationCommerceResult,
	commanderHold,
	newCommander,
	scoopCargo,
} from "./station-commerce";
import {
	type TransitionEvent,
	type WorldState,
	applyTransition,
	effectiveDerelict,
	scoopDerelict,
	setDeficits,
	visit,
} from "./world-state";

/**
 * The commander record a death restores (#654, the principal's Q2 ruling on
 * #238): the checkpoint's — the commander as it launched, since #660 D1 —
 * with the ladder record's own exception (`ladderAfterDeath`), and then what
 * the death costs (#660, node #704). The world is not an input: a death keeps
 * it whole, and only the store pairs the two.
 *
 * **Both causes lose the hold** (D2, D6): the pilot's cargo, its purchase
 * basis — the parser refuses a basis covering more than is aboard — and every
 * entrusted lot, whose running job fails with no debt (D3,
 * `requestsAfterLostHold`).
 *
 * - **`eject`** (D2): the launch hull and every fitting are kept, and the pod
 *   is consumed. Tank and charge are the launch's.
 * - **`destroyed`** (D6): the hull and every fitting go too. The pilot wakes
 *   in a stock courier with a full tank and a full charge, and keeps the
 *   launch credits — which is what leaves no save stranded: a courier, and
 *   #356's courier floor entrusting its goods to a pilot with nothing.
 *
 * Rungs and banked ladder credit are never touched (#183); unbanked credit was
 * never on the checkpoint.
 */
export const commanderAfterDeath = (
	dock: CommanderRecord,
	dying: CommanderRecord,
	cause: DeathCause,
): CommanderRecord => {
	const requests = requestsAfterLostHold(dock.requests).state;
	const ladders = {
		...ladderAfterDeath(dock.ladders, dying.ladders),
		basis: {},
	};
	if (cause === "eject")
		return {
			...dock,
			requests,
			ladders,
			state: {
				...dock.state,
				cargo: {},
				recoveredFittings: undefined,
				ownedEquipment: dock.state.ownedEquipment.filter(
					(item) => item !== ESCAPE_POD,
				),
			},
		};
	return {
		...dock,
		requests,
		ladders,
		state: {
			...newCommander(PLAYER_BASELINE_HULL),
			credits: dock.state.credits,
		},
		chargeAu: HULL_SPECS[PLAYER_BASELINE_HULL].chargeAu,
	};
};

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
	| { kind: "scoop"; commodity: string; tonnes: number }
	| {
			kind: "wreck-scoop";
			key: CarrierKey;
			galaxyIndex: number;
			instanceOrdinal: number;
			containerIndex: number;
			at: number;
			container: { pos: Vec3; vel: Vec3 };
			ship: { pos: Vec3; vel: Vec3 };
	  }
	/** Any carrier transition (#627 D3). A destroy with the player's
	 *  provenance is a kill: it pays every accepted Bounty naming the carrier
	 *  and prices the kill on the combat ladder. Anything else is only the
	 *  world write. */
	| {
			kind: "carrier";
			galaxyIndex: number;
			key: CarrierKey;
			transition: TransitionEvent;
			/** The struck carrier's hull row, or null for a target with none —
			 *  the relay — which pays nothing on the ladder. **Required** on
			 *  every transition, because `CarrierKey` does not carry it and a
			 *  default would let a kill site that forgot it pay nothing, which
			 *  reads exactly like an unarmed kill. Read only on a player's
			 *  destroy. */
			hull: HullId | null;
	  }
	/** A jump that arrived: what the plan left in the **Hyperspace tank**,
	 *  the visit, and a first arrival's exploration kind, pending until the
	 *  next dock (#183 D4). */
	| {
			kind: "arrival";
			galaxyIndex: number;
			systemIndex: number;
			/** What the jump plan left in the tank. */
			fuelLy: number;
	  }
	/** A dock: the pending credit banks and the station's first dock is a
	 *  kind (#183 D7), and the capstone is checked (D8). */
	| { kind: "dock"; galaxyIndex: number; station: CarrierKey; at: number };

/** What `Game` has to act on beyond adopting the state. A closed set. */
export interface HoldSignals {
	/** The hull a purchase delivered, for the berth and the mesh. */
	hullChanged: HullId | null;
	/** The sentence a Requests press prints, accepted or refused. */
	message: string | null;
	/** A request became ready to report (#546). Not every change to the
	 *  journal: a kill can advance a stage without readying one. */
	readied: boolean;
}

export interface HoldOutcome {
	/** The event this answers, which the adopt point reads (#631). */
	kind: HoldEvent["kind"];
	holdings: Holdings;
	world: WorldState;
	signals: HoldSignals;
}

/** An outcome before the event names it: what each event's law returns. */
type Applied = Omit<HoldOutcome, "kind">;

/**
 * The hold as both owners of it see it: ordinary cargo on the commander and
 * entrusted lots in the journal. `capacityT` is the **flown** hull's, bay
 * included (#182) — the figure every mark is written with.
 */
export const holdOf = (h: Pick<Holdings, "commander" | "requests">) =>
	commanderHold(h.commander, entrustedTonnesAboard(h.requests));

const QUIET: HoldSignals = { hullChanged: null, message: null, readied: false };

const unchanged = (
	holdings: Holdings,
	world: WorldState,
	signals: HoldSignals = QUIET,
): Applied => ({ holdings, world, signals });

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
): Applied {
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
): Applied {
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
): Applied {
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

function transition(
	holdings: Holdings,
	world: WorldState,
	event: Extract<HoldEvent, { kind: "carrier" }>,
): Applied {
	const { galaxyIndex, key, transition: change } = event;
	// The world first, then the credit: the order every kill site had.
	const next = applyTransition(world, galaxyIndex, key, change);
	// H8: only the player's own gun is a kill. Not gated on the world having
	// accepted the change, which the sites never were either.
	if (change.kind !== "destroy" || change.cause.actorId !== PLAYER_KILL.actorId)
		return unchanged(holdings, next);
	// Every accepted Bounty naming this carrier hears the kill (#508 D1).
	const requests = recordKill(
		holdings.requests,
		{ galaxyIndex, carrierKey: key },
		change.occurredAt,
	);
	// Priced on the combat ladder (#562 D3), pending until the next dock. A
	// target with no hull row pays nothing, as an unarmed hull does (D4).
	const ladderPending =
		event.hull === null
			? holdings.ladderPending
			: pendingKill(
					holdings.ladderPending,
					killCredit(
						{
							hull: holdings.commander.hull,
							equipment: holdings.commander.ownedEquipment,
						},
						event.hull,
					),
				);
	if (
		requests === holdings.requests &&
		ladderPending === holdings.ladderPending
	)
		return unchanged(holdings, next);
	return {
		holdings: { ...holdings, requests, ladderPending },
		world: next,
		signals: { ...QUIET, readied: readiedBy(holdings.requests, requests) },
	};
}

function arrive(
	holdings: Holdings,
	world: WorldState,
	event: Extract<HoldEvent, { kind: "arrival" }>,
): Applied {
	const { galaxyIndex, systemIndex } = event;
	return {
		holdings: {
			...holdings,
			commander: { ...holdings.commander, fuelLy: event.fuelLy },
			ladderPending: pendingArrival(
				holdings.ladders,
				holdings.ladderPending,
				galaxyIndex,
				systemIndex,
			),
		},
		// §7's visited flag, per galaxy (`persistent-world-state.md` §7).
		world: visit(world, galaxyIndex, systemIndex),
		signals: QUIET,
	};
}

function dock(
	holdings: Holdings,
	world: WorldState,
	event: Extract<HoldEvent, { kind: "dock" }>,
): Applied {
	return {
		holdings: {
			...holdings,
			ladders: bankOnDock(holdings.ladders, holdings.ladderPending, {
				galaxyIndex: event.galaxyIndex,
				station: event.station,
				gameTime: event.at,
			}),
			ladderPending: emptyPending(),
		},
		world,
		signals: QUIET,
	};
}

function applied(
	holdings: Holdings,
	world: WorldState,
	event: HoldEvent,
): Applied {
	switch (event.kind) {
		case "settlement":
			return settle(holdings, world, event);
		case "market":
			return trade(holdings, world, event);
		case "wreck-scoop": {
			const e = effectiveDerelict(
				world,
				event.galaxyIndex,
				event.key,
				event.at,
			);
			if (
				e.condition !== "destroyed" ||
				e.instanceOrdinal !== event.instanceOrdinal
			)
				return unchanged(holdings, world);
			const took = scoopWreckContainer(
				e,
				event.containerIndex,
				holdings.commander,
				entrustedTonnesAboard(holdings.requests),
				event.container,
				event.ship,
				event.at,
			);
			if (!took.tonnes) return unchanged(holdings, world);
			const item = e.containers[event.containerIndex];
			return {
				holdings: {
					...holdings,
					commander: took.commander,
					ladders:
						item.kind === "good"
							? {
									...holdings.ladders,
									basis: basisAfterScoop(
										holdings.ladders.basis,
										item.id,
										took.tonnes,
									),
								}
							: holdings.ladders,
				},
				world: scoopDerelict(
					world,
					event.galaxyIndex,
					event.key,
					event.containerIndex,
					took.tonnes,
					event.at,
				),
				signals: QUIET,
			};
		}
		case "scoop":
			return scoop(holdings, world, event);
		case "carrier":
			return transition(holdings, world, event);
		case "arrival":
			return arrive(holdings, world, event);
		case "dock":
			return dock(holdings, world, event);
	}
}

/** One hold event, applied whole or not at all. */
export function applyHoldEvent(
	holdings: Holdings,
	world: WorldState,
	event: HoldEvent,
): HoldOutcome {
	return { kind: event.kind, ...applied(holdings, world, event) };
}

/**
 * What adopting a state did to the pilot, as `Game` acts on it (#626 D4,
 * #631). A closed set: `Game` applies each one once and pairs nothing by hand.
 */
export interface AdoptEffects {
	/** Mark the save dirty (#89 D4): a saved field moved. */
	save: boolean;
	/** Bump the station console's revision, which its cache key and the
	 *  Requests board's both read. */
	consoleRevision: boolean;
	/** Bump the Requests board's revision. */
	requestRevision: boolean;
	/** Repaint the cockpit now, in the frame of the press, rather than on the
	 *  next frame's update. */
	redraw: boolean;
}

/** What an adoption came from: a hold event, or `"world"` — a world write
 *  made outside Holdings, which the law owns (an offence, its lazy clear). */
export type AdoptCause = HoldEvent["kind"] | "world";

/** The state an adoption compares: the four Holdings fields and the world. */
export interface Adopted {
	holdings: Holdings;
	world: WorldState;
}

/**
 * The effects of moving from `before` to `after`, derived from which
 * references changed — never from a site remembering them.
 *
 * - **save** is any reference: every module here returns the very objects it
 *   was given when nothing moved, so a refusal saves nothing.
 * - **requestRevision** is the journal, and every press on the Requests
 *   board, accepted or refused: its sentence is on the board.
 * - **consoleRevision** is an accepted press at a console — a settlement or a
 *   till trade. It is not every change while docked: the board's cache key
 *   reads it and the clock deliberately does not, so a bump is a re-roll of
 *   the board on the next dock (#321). A scoop, a kill, an arrival and a dock
 *   happen with no console up and have never bumped it.
 * - **redraw** is any press at a console, so the press is answered in its
 *   own frame. Everything else repaints on the frame loop's update.
 *
 * Pure, and the one copy of the rule: `tests/holdings.test.ts` holds it
 * against every event.
 */
export function adoptEffects(
	cause: AdoptCause,
	before: Adopted,
	after: Adopted,
): AdoptEffects {
	const was = before.holdings;
	const now = after.holdings;
	const requests = now.requests !== was.requests;
	// Every Holdings field, read off the type's own keys: a field added later
	// saves without anybody adding it here.
	const moved =
		(Object.keys(now) as (keyof Holdings)[]).some((k) => now[k] !== was[k]) ||
		after.world !== before.world;
	const press = cause === "settlement" || cause === "market";
	return {
		save: moved,
		consoleRevision: press && moved,
		requestRevision: requests || cause === "settlement",
		redraw: press,
	};
}
