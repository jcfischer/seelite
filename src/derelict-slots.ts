/**
 * Derelict slots: where a seeded wreck comes from, when it is lost, when other
 * salvagers take it, and what it holds (`salvage.md` S1, S2, S6, S16, S18's
 * draw and S21; built by node #731).
 *
 * **A derelict is a named carrier slot, as a raider is** (`raider-slots.ts`).
 * Each system holds a fixed, government-keyed set of them, enumerated in the
 * carrier set beside the stations, Traffic, raiders and the relay, so §6's
 * bound — one row per carrier key — bounds the wrecks too.
 *
 * **The schedule is derived from the clock, never ticked** (S16). A slot is
 * empty until its first loss, seeded over the first `DERELICT_FIRST_LOSS_S`.
 * An instance lost at `L` is taken by other salvagers at `L +
 * DERELICT_SALVAGER_S` unless the pilot strips it first, and the next loss
 * follows the strip, whoever made it, by a seeded gap. A saved row anchors
 * the walk at the instance it records (`derelictTimeline`); without one the
 * walk starts at the slot's first loss.
 *
 * **The contents are drawn once and stored** (S6). `derelictContents` is the
 * draw, keyed on (slot key, `instanceOrdinal`) under its own `DOMAIN` tag; the
 * world-state writers put its answer on the slot's row, and nothing reads the
 * draw again for an instance that has a row. That is what keeps a generator
 * change, or a module appended to `DERELICT_FITTINGS`, from reaching a wreck
 * a pilot has already met.
 *
 * Imports only leaves, the market's commodity table and the raider wreck's
 * cargo weighting, so `world-state.ts` can enumerate and read these slots
 * without a cycle.
 */
import { type CarrierKey, carrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { DOMAIN } from "./domains";
import { cargoWeights, pickWeightedIndex } from "./raider-wreck";
import { seededRand } from "./rng";

const HOUR_S = 3600;

// ---------------------------------------------------------------------------
// §5's starting figures. Starting values, not measurements: the principal's
// flight tunes them, as #660 D8b's share is tuned by #705.
// ---------------------------------------------------------------------------

/** S21: derelict slots by government — 3 for 0–2, 2 for 3–5, 1 for 6–7. */
export const DERELICT_SLOTS_BY_GOVERNMENT = [3, 3, 3, 2, 2, 2, 1, 1] as const;
/** S16: a slot's first loss falls somewhere in this much game time. */
export const DERELICT_FIRST_LOSS_S = 48 * HOUR_S;
/** S16: the seeded gap from a strip to the next loss. */
export const DERELICT_GAP_S = [6 * HOUR_S, 24 * HOUR_S] as const;
/** S16: how long an unstripped derelict lasts before other salvagers take it,
 *  counted from its loss. */
export const DERELICT_SALVAGER_S = 72 * HOUR_S;
/** S6: the share of instances that carry one fitting container. */
export const DERELICT_FITTING_CHANCE = 0.25;
/** S6: one to four manifest lines. */
export const DERELICT_LINES = { min: 1, max: 4 } as const;
/** S6: four lines and a fitting — the most containers one row can hold. */
export const DERELICT_MAX_CONTAINERS = 5;

/**
 * The hold a derelict's manifest fills, and the share of it a loss leaves.
 * **Not in §5's table**: S6 says a line holds "that line's tonnes" and names no
 * figure, so these are this build's starting values, stated beside the ones
 * §5 does name so the flight that tunes those finds these too. The hold is the
 * baseline courier's 20 t, and the fill is `carrier-manifest.ts`'s range.
 */
export const DERELICT_HOLD_T = 20;
export const DERELICT_FILL = { min: 0.4, max: 1 } as const;
/** S7: a fitting goes into the hold as an item and takes its tonnage. One
 *  tonne, a canister's, as the starting figure. */
export const DERELICT_FITTING_T = 1;

/**
 * The modules a derelict's fitting is drawn from, by `EQUIPMENT` name.
 *
 * **Append-only** (S18). An id here is what a stored container and a Salvage
 * job's snapshot name, so reordering or removing one would make a saved id
 * name a second module. Appending reaches new instances only, because an
 * instance's contents are stored at its loss.
 *
 * Every name is in `market.ts`'s `EQUIPMENT`, which `tests/derelict.test.ts`
 * asserts rather than this file importing the list: the Missile is a round
 * rather than a fitting, the Large Cargo Bay is the hull itself, and the
 * Galactic Hyperdrive is spent by the jump it makes.
 */
export const DERELICT_FITTINGS: readonly string[] = [
	"Extra Pulse Laser",
	"E.C.M. System",
	"Extra Beam Laser",
	"Escape Pod",
	"Energy Bomb",
	"Docking Computer",
	"Fuel Scoops",
	"Mining Laser",
	"Extra Energy Unit",
	"Military Laser",
	"Identity Scanner",
	"Long-Range Scanner",
];

// ---------------------------------------------------------------------------
// S21 — the slots
// ---------------------------------------------------------------------------

/** How many derelict slots a system holds: more where the law is weaker. */
export const derelictSlotCount = (government: number): number =>
	DERELICT_SLOTS_BY_GOVERNMENT[
		Math.max(0, Math.min(7, Math.round(government)))
	];

/** The persistence id of a system's `ordinal`th derelict slot. Renaming it is
 *  a save migration. */
export const derelictLocalCarrierId = (ordinal: number): string =>
	`derelict-${String(ordinal).padStart(2, "0")}`;

const DERELICT_ID = /^derelict-(\d{2})$/;

/** The slot ordinal a local carrier id names, or `null` when it names no
 *  derelict slot. Which ordinals a system actually holds is its government's. */
export const derelictOrdinalOf = (localCarrierId: string): number | null => {
	const m = DERELICT_ID.exec(localCarrierId);
	return m ? Number(m[1]) : null;
};

export interface DerelictSlot {
	localCarrierId: string;
	key: CarrierKey;
}

/** A system's derelict slots, in ordinal order. No parent: a derelict belongs
 *  to its system, and its losing station (S14) is the Salvage family's draw. */
export const derelictSlots = (
	systemIndex: number,
	government: number,
): DerelictSlot[] =>
	Array.from({ length: derelictSlotCount(government) }, (_, ordinal) => {
		const localCarrierId = derelictLocalCarrierId(ordinal);
		return { localCarrierId, key: carrierKey(systemIndex, localCarrierId) };
	});

// ---------------------------------------------------------------------------
// S16 — the schedule
// ---------------------------------------------------------------------------

/** One draw per (slot, instance) on the schedule's own tag, so retuning a
 *  gap moves no contents and a drawn manifest moves no loss. */
const scheduleUnit = (
	systemSeed: number,
	key: CarrierKey,
	instanceOrdinal: number,
): number =>
	seededRand(
		carrierInstanceSeed(
			systemSeed,
			key,
			instanceOrdinal,
			DOMAIN.DERELICT_SCHEDULE,
		),
	)();

/** When a slot's first instance is lost: somewhere in the first 48 h. */
export const derelictFirstLossAt = (
	systemSeed: number,
	key: CarrierKey,
): number => scheduleUnit(systemSeed, key, 0) * DERELICT_FIRST_LOSS_S;

/** The seeded gap after instance `instanceOrdinal` is stripped, by anyone,
 *  before the next one is lost. */
export const derelictGapS = (
	systemSeed: number,
	key: CarrierKey,
	instanceOrdinal: number,
): number => {
	// Instance 0's unit already placed the first loss; the gap after instance
	// k reads instance k + 1's, so no unit is read for two answers.
	const u = scheduleUnit(systemSeed, key, instanceOrdinal + 1);
	return DERELICT_GAP_S[0] + (DERELICT_GAP_S[1] - DERELICT_GAP_S[0]) * u;
};

/**
 * Where a walk starts: the instance a saved row records, when its loss
 * happened, and, once it is stripped, when that was and whether the pilot did
 * it. A row whose instance is still adrift has no `strippedAt`, and other
 * salvagers take it on the schedule.
 */
export interface DerelictAnchor {
	instanceOrdinal: number;
	lostAt: number;
	stripped?: { at: number; byPlayer: boolean };
}

/** The slot's state at one game time. */
export type DerelictPhase =
	/** Before the first loss: the slot holds no instance. */
	| { condition: "empty"; firstLossAt: number }
	/** An instance is adrift: §3.2's `destroyed`, the instance is wreckage. */
	| {
			condition: "destroyed";
			instanceOrdinal: number;
			lostAt: number;
			/** When other salvagers take it if the pilot does not. */
			salvagerAt: number;
	  }
	/** The instance is stripped, and the next one has not been lost yet. */
	| {
			condition: "salvaged";
			instanceOrdinal: number;
			lostAt: number;
			salvagedAt: number;
			byPlayer: boolean;
			nextLossAt: number;
	  };

/**
 * A slot's phase at `gameTime`, derived from the clock and at most one anchor.
 *
 * Each step of the walk is one instance's life — 72 h adrift at most and a gap
 * of at least 6 h after it — so a walk over any length of play is finite and a
 * saved row shortens it to the instances since that row's.
 *
 * `anchor` is the saved row's instance. A time before the anchor's loss is
 * refused: a row is written at the clock, so nothing can ask about the slot
 * before it.
 */
export function derelictTimeline(
	systemSeed: number,
	key: CarrierKey,
	gameTime: number,
	anchor?: DerelictAnchor,
): DerelictPhase {
	let instanceOrdinal: number;
	let lostAt: number;
	let stripped: { at: number; byPlayer: boolean } | undefined;
	if (anchor) {
		if (gameTime < anchor.lostAt)
			throw new Error(
				`derelict ${key}: ${gameTime} is before its saved instance's loss at ${anchor.lostAt}`,
			);
		instanceOrdinal = anchor.instanceOrdinal;
		lostAt = anchor.lostAt;
		stripped = anchor.stripped;
	} else {
		const firstLossAt = derelictFirstLossAt(systemSeed, key);
		if (gameTime < firstLossAt) return { condition: "empty", firstLossAt };
		instanceOrdinal = 0;
		lostAt = firstLossAt;
		stripped = undefined;
	}
	for (;;) {
		const salvagerAt = lostAt + DERELICT_SALVAGER_S;
		const end = stripped ?? { at: salvagerAt, byPlayer: false };
		if (gameTime < end.at)
			return { condition: "destroyed", instanceOrdinal, lostAt, salvagerAt };
		const nextLossAt = end.at + derelictGapS(systemSeed, key, instanceOrdinal);
		if (gameTime < nextLossAt)
			return {
				condition: "salvaged",
				instanceOrdinal,
				lostAt,
				salvagedAt: end.at,
				byPlayer: end.byPlayer,
				nextLossAt,
			};
		instanceOrdinal += 1;
		lostAt = nextLossAt;
		stripped = undefined;
	}
}

// ---------------------------------------------------------------------------
// S6 — the contents
// ---------------------------------------------------------------------------

/** What one container holds: a good by its commodity name, or a fitting by
 *  its `EQUIPMENT` name. */
export type DerelictContainerKind = "good" | "fitting";

export interface DrawnContainer {
	kind: DerelictContainerKind;
	id: string;
	tonnes: number;
}

/**
 * An instance's containers, drawn at its loss: one per manifest line, then a
 * fitting in `DERELICT_FITTING_CHANCE` of instances. Container index is the
 * position in this list, which is what a Salvage job's operand names (S18).
 *
 * `fittings` is the append-only list and is a parameter only so a test can
 * show that appending to it moves no stored instance.
 */
export function derelictContents(
	systemSeed: number,
	government: number,
	key: CarrierKey,
	instanceOrdinal: number,
	fittings: readonly string[] = DERELICT_FITTINGS,
): DrawnContainer[] {
	const rand = seededRand(
		carrierInstanceSeed(
			systemSeed,
			key,
			instanceOrdinal,
			DOMAIN.DERELICT_CONTENTS,
		),
	);
	const fill =
		DERELICT_FILL.min + rand() * (DERELICT_FILL.max - DERELICT_FILL.min);
	const tonnes = Math.max(
		1,
		Math.min(DERELICT_HOLD_T, Math.round(DERELICT_HOLD_T * fill)),
	);
	const span = DERELICT_LINES.max - DERELICT_LINES.min + 1;
	const count = Math.min(
		tonnes,
		DERELICT_LINES.min + Math.min(span - 1, Math.floor(rand() * span)),
	);

	// Distinct goods, weighted as a raider's hold is, without replacement.
	const pool = cargoWeights(government).filter((w) => w.weight > 0);
	const goods: string[] = [];
	for (let i = 0; i < count && pool.length > 0; i++) {
		const at = pickWeightedIndex(pool, rand);
		goods.push(pool[at].good.name);
		pool.splice(at, 1);
	}

	// A tonne each, the rest by drawn shares.
	const shares = goods.map(() => rand() + 0.05);
	const shareTotal = shares.reduce((sum, s) => sum + s, 0);
	const spare = tonnes - goods.length;
	const split = shares.map((s) => 1 + Math.floor((spare * s) / shareTotal));
	split[0] += tonnes - split.reduce((sum, t) => sum + t, 0);
	const containers: DrawnContainer[] = goods.map((id, i) => ({
		kind: "good",
		id,
		tonnes: split[i],
	}));

	// The fitting's two draws come last, so the manifest above is the same
	// whether or not this instance carries one.
	const carriesFitting = rand() < DERELICT_FITTING_CHANCE;
	const pick = rand();
	if (carriesFitting && fittings.length > 0)
		containers.push({
			kind: "fitting",
			id: fittings[
				Math.min(fittings.length - 1, Math.floor(pick * fittings.length))
			],
			tonnes: DERELICT_FITTING_T,
		});
	return containers;
}
