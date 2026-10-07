/**
 * The three ladders (#183), their credit, their gates and their saved record.
 *
 * #183 ruled the shape — three commander-global ladders, credit banked on
 * dock and never falling, each ladder gating its own hulls and equipment — and
 * #562 ruled every figure: rungs 0 to 8 at exactly twice the one below, the
 * three tops, the Elo-like price of a kill and the gate catalogue. This module
 * is where those rulings live in the game, and
 * `scripts/measure-ladder-rates.ts` imports the formulas from here and reprints
 * the tops beside what a fresh run derives, so the instrument and the game read
 * one copy.
 *
 * **Pending and banked are two things, and only one is saved.** Credit earned
 * in flight — a kill, a first arrival — is pending until the next dock banks it
 * (#183 D7). A pending figure is session state on the renderer: it is lost with
 * the ship because a death restores `lastDocked` (#324), and it is lost across
 * a mid-flight save because `serializeLadders` has nowhere to put it (#183 D9).
 * A first arrival joins the visited set only when it banks, so a lost arrival
 * is one the pilot can earn again rather than a kind burned forever.
 *
 * Trade credit is earned docked — a sale and a job settlement both happen at a
 * console — so it banks at once and never passes through pending.
 *
 * A kill's price is `kill-credit.ts`'s, which reads the roster and the combat
 * model; this module imports neither, so the console's gate can read it
 * without pulling combat into commerce.
 *
 * No DOM and no Three.js.
 */

import { type CarrierKey, isCarrierKey } from "./carrier-key";
// Type-only: `station-commerce.ts` imports this module's `Rungs` the same way,
// and an erased import cannot close a cycle.
import type { SoldLot, StationAction } from "./station-commerce";
import { GALAXY_COUNT, isSystemIndex } from "./world-state";

// ---------------------------------------------------------------------------
// The ladders and their thresholds (#562 D1, D2, D8)
// ---------------------------------------------------------------------------

export const LADDERS = ["combat", "trade", "exploration"] as const;
export type Ladder = (typeof LADDERS)[number];

/** Rungs run 0 (the start, every pilot has it) to 8 (#562 D1). */
export const TOP_RUNG = 8;
/** Each rung costs exactly this multiple of the one below (#562 D1). */
export const RUNG_RATIO = 2;
/** Hours of focused play from rung 0 to the top, on one ladder (#562 D2). */
export const FOCUSED_HOURS_TO_TOP = 40;
/** A declared guess, not a measurement (#562 D2): a person earns this share of
 *  the greedy model pilot's rate. `LadderRecord.playedS` is the play log that
 *  replaces it. */
export const HUMAN_FACTOR = 0.5;
/** The rung the capstone reads on all three ladders (#183 D8). */
export const CAPSTONE_RUNG = TOP_RUNG;

/**
 * Each ladder's top-rung threshold, **as #562 published it**: rate × human
 * factor × 40 h, from the medians `scripts/measure-ladder-rates.ts` measures.
 *
 * Stored rather than derived at load for the reason `HULL_SPECS.priceCr` is: the
 * measurement runs the greedy trader over four galaxies for eight hours, and a
 * figure a player's rung depends on does not move because a generator did. The
 * script prints this beside its fresh derivation, so a drift is visible there.
 * Trade is realised margin in Cr, combat is kill credit, exploration is
 * first-time kinds.
 */
export const LADDER_TOP: Readonly<Record<Ladder, number>> = {
	combat: 141.5,
	trade: 438_276,
	exploration: 1_055,
};

/** What rung `n` costs on a ladder: the top over 2^(8 − n). Rung 0 is free. */
export const threshold = (ladder: Ladder, rung: number): number =>
	rung <= 0 ? 0 : LADDER_TOP[ladder] / RUNG_RATIO ** (TOP_RUNG - rung);

/** The highest rung a banked total reaches. */
export const rungOf = (ladder: Ladder, banked: number): number => {
	let rung = 0;
	for (let n = 1; n <= TOP_RUNG; n++)
		if (banked >= threshold(ladder, n)) rung = n;
	return rung;
};

export type Rungs = Readonly<Record<Ladder, number>>;

/** Every ladder at the top: every gate open. What a caller that is not about
 *  gates passes — a test of the hold, a gallery state — so it names the
 *  choice rather than inheriting one. */
export const TOP_RUNGS: Rungs = {
	combat: TOP_RUNG,
	trade: TOP_RUNG,
	exploration: TOP_RUNG,
};

/** The three rungs a record stands on. */
export const rungsOf = (record: LadderRecord): Rungs =>
	Object.fromEntries(
		LADDERS.map((l) => [l, rungOf(l, record.banked[l])]),
	) as Record<Ladder, number>;

/**
 * Each ladder's nine rung names, rung 0 first (#183 D5).
 *
 * **Original names.** The map's Constraints forbid Elite's, which corrects
 * #8's "retains Elite's named ladder". Drafted with `/write-story` and
 * approved by the principal on 2026-09-29, over an alternative set.
 */
export const RUNG_NAMES: Readonly<Record<Ladder, readonly string[]>> = {
	combat: [
		"Unblooded",
		"Green",
		"Scrapper",
		"Gunhand",
		"Veteran",
		"Hardened",
		"Ace",
		"Nemesis",
		"Legend",
	],
	trade: [
		"Hawker",
		"Carter",
		"Packman",
		"Chandler",
		"Factor",
		"Shipper",
		"Magnate",
		"Baron",
		"Mogul",
	],
	exploration: [
		"Homebound",
		"Drifter",
		"Wayfarer",
		"Charter",
		"Wanderer",
		"Navigator",
		"Farfarer",
		"Cartographer",
		"Starwright",
	],
};

// ---------------------------------------------------------------------------
// The gate catalogue (#562 D7)
// ---------------------------------------------------------------------------

export interface Gate {
	ladder: Ladder;
	rung: number;
}

/**
 * Every gated hull and item, by the name a shipyard or the Equipment tab sells
 * it under. **Absent means rung 0**: the courier, the Docking Computer and the
 * Long-Range Scanner (#408 and #481 depend on them), the Identity Scanner and
 * the Escape Pod, which has behaviour since node #704 (#660's manual eject).
 * Rung 8 gates nothing; it counts toward the capstone.
 *
 * Eleven of these items have no behaviour yet, and are gated anyway (#562 D6):
 * the node that builds an item inherits its gate. `patrol` and `raider` carry a
 * rung and are still not sold — `PURCHASABLE_HULL_IDS` leaves them out until
 * #565 and #566 close, because a rung does not supply the legal rules their
 * sale needs. A tier hull (#26) has no row yet; it will sit on its base role's
 * ladder above the base hull's rung.
 */
export const GATES: Readonly<Record<string, Gate>> = {
	"Extra Pulse Laser": { ladder: "combat", rung: 1 },
	Missile: { ladder: "combat", rung: 1 },
	"E.C.M. System": { ladder: "combat", rung: 2 },
	interceptor: { ladder: "combat", rung: 3 },
	"Extra Beam Laser": { ladder: "combat", rung: 3 },
	"Extra Energy Unit": { ladder: "combat", rung: 4 },
	"Energy Bomb": { ladder: "combat", rung: 5 },
	patrol: { ladder: "combat", rung: 6 },
	"Military Laser": { ladder: "combat", rung: 6 },
	raider: { ladder: "combat", rung: 7 },
	"Large Cargo Bay": { ladder: "trade", rung: 1 },
	prospector: { ladder: "trade", rung: 2 },
	"Mining Laser": { ladder: "trade", rung: 2 },
	tug: { ladder: "trade", rung: 3 },
	miner: { ladder: "trade", rung: 4 },
	freighter: { ladder: "trade", rung: 5 },
	"Fuel Scoops": { ladder: "exploration", rung: 1 },
	explorer: { ladder: "exploration", rung: 3 },
	"Galactic Hyperdrive": { ladder: "exploration", rung: 5 },
};

export const gateOf = (name: string): Gate | null =>
	Object.hasOwn(GATES, name) ? GATES[name] : null;

/** Why a purchase is locked: the ladder, the rung, and that rung's name. */
export interface GateRefusal extends Gate {
	name: string;
}

/**
 * The gate a purchase fails, or `null` when the pilot stands on its rung.
 *
 * **One rung on one ladder** (the map's Constraint from #183): nothing here
 * reads two ladders or a price. A gate blocks new purchases only — an owned
 * item stays owned whatever the rung (#183 D9).
 */
export const gateRefusal = (name: string, rungs: Rungs): GateRefusal | null => {
	const gate = gateOf(name);
	if (!gate || rungs[gate.ladder] >= gate.rung) return null;
	return { ...gate, name: RUNG_NAMES[gate.ladder][gate.rung] };
};

// ---------------------------------------------------------------------------
// The saved record (#183 D9)
// ---------------------------------------------------------------------------

/** One galaxy's first-time places: the ones banked and the ones a migration or
 *  a new game seeded. Seeded entries earn nothing; they only stop a kind being
 *  earned for a place the pilot already had. */
export interface VisitedPlaces {
	/** System indices, ascending. */
	systems: number[];
	/** Carrier keys, sorted. */
	stations: CarrierKey[];
}

/** What a held good cost: `cr` for `units` of it. Units the hold carries past
 *  `units` have no basis and pay no margin — a v6 hold, on the principal's
 *  ruling on #564. */
export interface BasisLine {
	units: number;
	cr: number;
}
export type CargoBasis = Readonly<Record<string, BasisLine>>;

export interface LadderRecord {
	/** Commander-wide first-time verbs, banked on dock. Absent in older saves. */
	kinds?: readonly ExplorationKind[];
	/** Banked credit per ladder. Never falls (#183 D7). Exploration's is not
	 *  the size of `visited`: seeded places are in the sets and earned nothing. */
	banked: Record<Ladder, number>;
	/** Per galaxy, keyed by galaxy index; a galaxy with nothing is absent. The
	 *  totals are commander-global and these name places in one galaxy (D1). */
	visited: Readonly<Partial<Record<number, VisitedPlaces>>>;
	/** What the hold's goods cost, per good (D3's purchase basis). */
	basis: CargoBasis;
	/** Seconds of real play with the clock running — #562 D2's play log, which
	 *  turns banked credit into a rate per hour. */
	playedS: number;
	/** Game time of the dock on which all three ladders stood at the top (#183
	 *  D8), or `null`. A recorded fact only; what it opens is fog. */
	capstoneAt: number | null;
}

/**
 * The record a death restores (#654): the last dock's, so credit and rungs
 * go back with the credits that bought them — except the play log, which is
 * the dying record's (#581, closed into #654). `playedS` measures real hours
 * to a rung, and the seconds flown before a death were played.
 */
export const ladderAfterDeath = (
	dock: LadderRecord,
	dying: LadderRecord,
): LadderRecord => ({ ...dock, playedS: dying.playedS });

export const emptyLadderRecord = (): LadderRecord => ({
	banked: { combat: 0, trade: 0, exploration: 0 },
	visited: {},
	basis: {},
	playedS: 0,
	capstoneAt: null,
});

/**
 * The record a new game or a v6 migration starts with: zero on every ladder,
 * the current system and docked station already seen (#183 D9). A pilot is not
 * paid for where they started.
 *
 * **A migration also seeds every system the old world marks visited** (the
 * principal's ruling on #564's review): a v6 world keeps §7's visited flags per
 * galaxy, and without them a veteran would be paid again for places flown
 * before the ladders existed. Stations have no such record, so only the one
 * docked at is seeded.
 */
export const seededLadderRecord = (
	galaxyIndex: number,
	systemIndex: number,
	dockedAt: CarrierKey | null,
	visitedSystems: Readonly<Record<number, readonly number[]>> = {},
): LadderRecord => {
	const visited: Record<number, VisitedPlaces> = {};
	for (const [g, systems] of Object.entries(visitedSystems))
		if (systems.length > 0)
			visited[Number(g)] = { systems: [...systems], stations: [] };
	const here = visitedIn(visited, galaxyIndex);
	visited[galaxyIndex] = {
		systems: [...new Set([...here.systems, systemIndex])].sort((a, b) => a - b),
		stations: dockedAt ? [dockedAt] : [],
	};
	return { ...emptyLadderRecord(), visited };
};

// ---------------------------------------------------------------------------
// Pending credit and banking (#183 D7)
// ---------------------------------------------------------------------------

/** Credit earned since the last dock. Session state: never serialised. */
export interface PendingCredit {
	kinds?: readonly ExplorationKind[];
	combat: number;
	systems: readonly { galaxyIndex: number; systemIndex: number }[];
}

export const emptyPending = (): PendingCredit => ({ combat: 0, systems: [] });

export const EXPLORATION_KINDS = ["wreck"] as const;
export type ExplorationKind = (typeof EXPLORATION_KINDS)[number];

export const pendingKind = (
	record: LadderRecord,
	pending: PendingCredit,
	kind: ExplorationKind,
): PendingCredit =>
	(record.kinds ?? []).includes(kind) || (pending.kinds ?? []).includes(kind)
		? pending
		: { ...pending, kinds: [...(pending.kinds ?? []), kind] };

export const pendingKill = (
	pending: PendingCredit,
	credit: number,
): PendingCredit =>
	credit > 0 ? { ...pending, combat: pending.combat + credit } : pending;

const visitedIn = (
	visited: LadderRecord["visited"],
	galaxyIndex: number,
): VisitedPlaces => visited[galaxyIndex] ?? { systems: [], stations: [] };

/** An arrival: a first-time kind, pending, unless the system is already in the
 *  set or already pending. */
export const pendingArrival = (
	record: LadderRecord,
	pending: PendingCredit,
	galaxyIndex: number,
	systemIndex: number,
): PendingCredit => {
	if (visitedIn(record.visited, galaxyIndex).systems.includes(systemIndex))
		return pending;
	if (
		pending.systems.some(
			(s) => s.galaxyIndex === galaxyIndex && s.systemIndex === systemIndex,
		)
	)
		return pending;
	return {
		...pending,
		systems: [...pending.systems, { galaxyIndex, systemIndex }],
	};
};

const withPlace = (
	visited: LadderRecord["visited"],
	galaxyIndex: number,
	add: { system?: number; station?: CarrierKey },
): LadderRecord["visited"] => {
	const here = visitedIn(visited, galaxyIndex);
	return {
		...visited,
		[galaxyIndex]: {
			systems:
				add.system === undefined
					? here.systems
					: [...here.systems, add.system].sort((a, b) => a - b),
			stations:
				add.station === undefined
					? here.stations
					: [...here.stations, add.station].sort(),
		},
	};
};

/**
 * A dock: the station's first-dock kind, then everything pending, then the
 * capstone check — in that order, so the capstone reads the dock's own credit.
 *
 * **The caller banks before the dock flush.** `lastDocked` is the record a
 * death restores; banked after the flush, a dock's credit would ride only on
 * the next write, and a death before it would lose credit the pilot docked
 * with.
 */
export const bankOnDock = (
	record: LadderRecord,
	pending: PendingCredit,
	at: { galaxyIndex: number; station: CarrierKey; gameTime: number },
): LadderRecord => {
	let visited = record.visited;
	let kinds = 0;
	const firstKinds = [...(record.kinds ?? [])];
	for (const kind of pending.kinds ?? []) {
		if (firstKinds.includes(kind)) continue;
		firstKinds.push(kind);
		kinds += 1;
	}
	for (const { galaxyIndex, systemIndex } of pending.systems) {
		if (visitedIn(visited, galaxyIndex).systems.includes(systemIndex)) continue;
		visited = withPlace(visited, galaxyIndex, { system: systemIndex });
		kinds += 1;
	}
	if (!visitedIn(visited, at.galaxyIndex).stations.includes(at.station)) {
		visited = withPlace(visited, at.galaxyIndex, { station: at.station });
		kinds += 1;
	}
	const banked = {
		...record.banked,
		combat: record.banked.combat + pending.combat,
		exploration: record.banked.exploration + kinds,
	};
	return withCapstone(
		{
			...record,
			banked,
			visited,
			...(firstKinds.length ? { kinds: firstKinds } : {}),
		},
		at.gameTime,
	);
};

/**
 * The capstone, recorded the first time all three ladders stand at the top
 * (#183 D8), and never moved after. Read wherever banked credit rises while
 * docked — a dock, and a sale or a settlement at that dock's console — so a
 * sale that completes the tops is not stamped with the next dock's time.
 */
export const withCapstone = (
	record: LadderRecord,
	gameTime: number,
): LadderRecord =>
	record.capstoneAt === null &&
	LADDERS.every((l) => rungOf(l, record.banked[l]) >= CAPSTONE_RUNG)
		? { ...record, capstoneAt: gameTime }
		: record;

/** Trade credit, banked at once: a sale or a settlement happens docked. */
export const bankTrade = (record: LadderRecord, cr: number): LadderRecord =>
	cr > 0
		? {
				...record,
				banked: { ...record.banked, trade: record.banked.trade + cr },
			}
		: record;

// ---------------------------------------------------------------------------
// The purchase basis (#183 D3)
// ---------------------------------------------------------------------------

const lineOf = (basis: CargoBasis, good: string): BasisLine =>
	Object.hasOwn(basis, good) ? basis[good] : { units: 0, cr: 0 };

const withLine = (
	basis: CargoBasis,
	good: string,
	line: BasisLine,
): CargoBasis => {
	const next = { ...basis };
	if (line.units <= 0) delete next[good];
	else next[good] = line;
	return next;
};

/** A market purchase: `units` at a total of `cr`. */
export const basisAfterBuy = (
	basis: CargoBasis,
	good: string,
	units: number,
	cr: number,
): CargoBasis => {
	const line = lineOf(basis, good);
	return withLine(basis, good, { units: line.units + units, cr: line.cr + cr });
};

/** A scooped canister: its units cost nothing, so their sale is all margin
 *  (the principal's ruling on #564; D3 counts contraband). */
export const basisAfterScoop = (
	basis: CargoBasis,
	good: string,
	units: number,
): CargoBasis => basisAfterBuy(basis, good, units, 0);

/**
 * A market sale of `units` for `proceedsCr`, against the hold as it stood
 * before the sale.
 *
 * Units with no basis are sold first and pay no margin — the ruling that keeps
 * a v6 migration at zero. The rest are sold at the line's average cost. **A
 * loss does not subtract** (D3): a sale below cost pays 0, never less.
 */
export const saleMargin = (
	basis: CargoBasis,
	heldBefore: Readonly<Record<string, number>>,
	good: string,
	units: number,
	proceedsCr: number,
): { marginCr: number; basis: CargoBasis } => {
	const line = lineOf(basis, good);
	const held = heldBefore[good] ?? 0;
	const unbased = Math.max(0, held - line.units);
	const fromBased = Math.max(0, Math.min(line.units, units - unbased));
	if (fromBased === 0) return { marginCr: 0, basis };
	const costCr = (line.cr * fromBased) / line.units;
	const proceedsBased = (proceedsCr * fromBased) / units;
	return {
		marginCr: Math.max(0, proceedsBased - costCr),
		basis: withLine(basis, good, {
			units: line.units - fromBased,
			cr: line.cr - costCr,
		}),
	};
};

/**
 * The basis brought into line with a hold that lost goods some other way — a
 * job commitment, a delivery. A line never covers more units than are aboard;
 * it shrinks at its own average cost. Goods that *arrive* some other way get no
 * line, so they pay no margin, which is the safe side.
 */
export const reconcileBasis = (
	basis: CargoBasis,
	held: Readonly<Record<string, number>>,
): CargoBasis => {
	let next = basis;
	for (const [good, line] of Object.entries(basis)) {
		const aboard = held[good] ?? 0;
		if (aboard >= line.units) continue;
		next = withLine(next, good, {
			units: aboard,
			cr: line.units > 0 ? (line.cr * aboard) / line.units : 0,
		});
	}
	return next;
};

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const fail = (message: string): never => {
	throw new Error(`save: commander.ladders: ${message}`);
};

/** Canonical form: fixed key order, sorted galaxies, goods and places, so two
 *  equal records hash the same. No pending field exists to write. */
export const serializeLadders = (record: LadderRecord): unknown => {
	const visited: Record<string, unknown> = {};
	for (const g of Object.keys(record.visited)
		.map(Number)
		.sort((a, b) => a - b)) {
		const places = record.visited[g] as VisitedPlaces;
		visited[String(g)] = {
			systems: [...places.systems].sort((a, b) => a - b),
			stations: [...places.stations].sort(),
		};
	}
	const basis: Record<string, unknown> = {};
	for (const good of Object.keys(record.basis).sort())
		basis[good] = {
			units: record.basis[good].units,
			cr: record.basis[good].cr,
		};
	return {
		banked: {
			combat: record.banked.combat,
			trade: record.banked.trade,
			exploration: record.banked.exploration,
		},
		visited,
		basis,
		playedS: record.playedS,
		capstoneAt: record.capstoneAt,
		...(record.kinds?.length ? { kinds: [...record.kinds].sort() } : {}),
	};
};

const obj = (raw: unknown, what: string): Record<string, unknown> => {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		fail(`${what} is not an object`);
	return raw as Record<string, unknown>;
};

const nonNegative = (raw: unknown, what: string): number => {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)
		fail(`${what} is not a non-negative number`);
	return raw as number;
};

/** Reads a saved record back, or throws with a named reason. Copies every
 *  value out; never edits what it was handed (#89 D8). */
export const parseLadders = (raw: unknown): LadderRecord => {
	const o = obj(raw, "record");
	if (
		o.kinds !== undefined &&
		(!Array.isArray(o.kinds) ||
			o.kinds.some(
				(k) => !(EXPLORATION_KINDS as readonly unknown[]).includes(k),
			) ||
			new Set(o.kinds).size !== o.kinds.length)
	)
		fail("kinds is not a unique list of exploration kinds");
	const b = obj(o.banked, "banked");
	const banked = {
		combat: nonNegative(b.combat, "banked.combat"),
		trade: nonNegative(b.trade, "banked.trade"),
		exploration: nonNegative(b.exploration, "banked.exploration"),
	};
	const visited: Record<number, VisitedPlaces> = {};
	for (const [k, v] of Object.entries(obj(o.visited, "visited"))) {
		const g = Number(k);
		if (!Number.isInteger(g) || g < 0 || g >= GALAXY_COUNT || String(g) !== k)
			fail(`visited: ${k} is not a galaxy index`);
		const places = obj(v, `visited.${k}`);
		const systems = places.systems;
		if (!Array.isArray(systems) || !systems.every(isSystemIndex))
			fail(`visited.${k}.systems is not a list of system indices`);
		const stations = places.stations;
		if (
			!Array.isArray(stations) ||
			!stations.every((s) => typeof s === "string" && isCarrierKey(s))
		)
			fail(`visited.${k}.stations is not a list of carrier keys`);
		visited[g] = {
			systems: [...(systems as number[])],
			stations: [...(stations as CarrierKey[])],
		};
	}
	const basis: Record<string, BasisLine> = Object.create(null);
	for (const [good, v] of Object.entries(obj(o.basis, "basis"))) {
		const line = obj(v, `basis.${good}`);
		basis[good] = {
			units: nonNegative(line.units, `basis.${good}.units`),
			cr: nonNegative(line.cr, `basis.${good}.cr`),
		};
	}
	const capstoneAt =
		o.capstoneAt === null ? null : nonNegative(o.capstoneAt, "capstoneAt");
	return {
		banked,
		visited,
		basis: { ...basis },
		playedS: nonNegative(o.playedS, "playedS"),
		capstoneAt,
		...(o.kinds === undefined
			? {}
			: { kinds: [...(o.kinds as ExplorationKind[])] }),
	};
};

/**
 * #562 D2's play log, one running frame of it: a new record, and the very
 * record back when no time passed.
 *
 * **A new record, not an edit** (#631). It was `playedS += dt` on the live
 * record, which moved a value under every reference an outcome had been
 * compared against — a refused event hands back the objects it was given, so
 * the edit reached those too. It is still no save trigger: the store's dirty
 * mark reschedules its debounce, so a mark per frame would hold the write off
 * for as long as the clock runs. The log rides on the next write.
 */
export const ladderAfterPlay = (
	record: LadderRecord,
	dt: number,
): LadderRecord =>
	dt === 0 ? record : { ...record, playedS: record.playedS + dt };

// ---------------------------------------------------------------------------
// What a console transaction does to the record
// ---------------------------------------------------------------------------

/** The two commander fields a market transaction moves. */
interface Purse {
	credits: number;
	cargo: Readonly<Record<string, number>>;
}

/**
 * A till's accepted transaction, read off the commander before and after it.
 *
 * **Before and after, not the price.** The till owns the price — the bid cut,
 * the stock response — and a second computation of it here would be a second
 * place to get it wrong. What the till charged is the credit delta; what it
 * moved is the cargo delta. A buy records a basis and banks nothing; a sale
 * banks its margin at once, because it happens docked.
 */
export const ladderAfterMarket = (
	record: LadderRecord,
	action: StationAction,
	before: Purse,
	after: Purse,
): LadderRecord => {
	if (action.type === "sell-recovered")
		return bankTrade(record, after.credits - before.credits);
	if (action.type !== "buy-commodity" && action.type !== "sell-commodity")
		return record;
	// Brought into line with the hold first. A guard: a job hand-over reconciles
	// as it settles, and it is today's only non-sale removal, but a later one
	// that forgot would price this transaction against units that are gone.
	record = { ...record, basis: reconcileBasis(record.basis, before.cargo) };
	const good = action.commodity;
	if (action.type === "buy-commodity") {
		const units = (after.cargo[good] ?? 0) - (before.cargo[good] ?? 0);
		return {
			...record,
			basis: basisAfterBuy(
				record.basis,
				good,
				units,
				before.credits - after.credits,
			),
		};
	}
	const sale = saleMargin(
		record.basis,
		before.cargo,
		good,
		(before.cargo[good] ?? 0) - (after.cargo[good] ?? 0),
		after.credits - before.credits,
	);
	return bankTrade({ ...record, basis: sale.basis }, sale.marginCr);
};

/**
 * A job settled at a console: its pay banks at once (D3 counts it at its pay),
 * and any goods it took from the hold take their basis with them.
 */
export const ladderAfterSettlement = (
	record: LadderRecord,
	rewardCr: number,
	heldAfter: Readonly<Record<string, number>>,
): LadderRecord =>
	bankTrade(
		{ ...record, basis: reconcileBasis(record.basis, heldAfter) },
		rewardCr,
	);

/**
 * A hull purchase's auto-sale (#556 D6), banked lot by lot as the same sales
 * pressed by hand would bank: "the same till" includes the ladder. Each lot's
 * margin reads the hold as it stood before that lot, as `ladderAfterMarket`
 * reads it before a press.
 */
export const ladderAfterHullSale = (
	record: LadderRecord,
	cargoBefore: Readonly<Record<string, number>>,
	sold: readonly SoldLot[],
): LadderRecord => {
	let next = { ...record, basis: reconcileBasis(record.basis, cargoBefore) };
	let held = cargoBefore;
	for (const lot of sold) {
		const sale = saleMargin(
			next.basis,
			held,
			lot.good,
			lot.units,
			lot.proceedsCr,
		);
		next = bankTrade({ ...next, basis: sale.basis }, sale.marginCr);
		held = { ...held, [lot.good]: (held[lot.good] ?? 0) - lot.units };
	}
	return next;
};
