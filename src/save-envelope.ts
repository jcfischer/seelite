/**
 * #89's D5: a save is `{ world, commander }` in one envelope under one hash.
 *
 * `WorldState` keeps the world-only scope `persistent-world-state.md` §1
 * ratified for it. Everything the *player* is — credits, cargo, equipment,
 * tank, hull, where they are, what they are docked at, the drive charge, and
 * the permadeath flag — sits beside it rather than inside it, because folding
 * it in would widen a ratified model for a structural reason and cost a
 * `WORLD_SCHEMA_VERSION` bump that says nothing about the domain.
 *
 * **The hash spans both halves.** §9.9 forbids one snapshot's clock beside
 * another's state; the same graft across the commander boundary — this world,
 * that commander's credits — is forbidden by the same mechanism rather than by
 * a second rule. A hash per half would permit exactly it.
 *
 * ## What the commander record carries that #89 did not list
 *
 * #89 named four fields with no typed home: the galaxy index, the system
 * index, the docked-at carrier key and the drive charge. Writing the loader
 * turns up a fifth category it could not have seen, because #89 decided a
 * cadence rather than a load path: **a `live` record is written mid-flight,
 * and a ship in flight has a position, a velocity, an attitude and a regime.**
 * Restoring at a fixed place instead would silently teleport a player who saved
 * on a cruise leg. So `flight` is carried, and it is the same category as the
 * four: renderer session state with nowhere typed to live.
 *
 * The attitude is four bare numbers rather than a quaternion type. This module
 * is in the sim tier and imports no Three.js — `src/main.ts` is the one place
 * that knows a `THREE.Quaternion`, and it converts at the boundary.
 */

import { type CarrierKey, isCarrierKey } from "./carrier-key";
import { HULL_IDS, type HullId } from "./hull";
import {
	type CommanderState,
	newCommander,
	STARTING_CREDITS,
} from "./station-commerce";
import {
	fnv1a,
	parseWorld,
	serializeWorld,
	type WorldState,
} from "./world-state";

/**
 * The envelope's own version, separate from `WORLD_SCHEMA_VERSION`.
 *
 * The world's shape and the commander's change for different reasons, and a
 * save that had to bump the world's version to add a commander field would put
 * a migration obligation on eight galaxy envelopes that did not move.
 */
export const SAVE_SCHEMA_VERSION = 1;

/** The two flight regimes a save can be taken in (#10). Declared here rather
 *  than imported from the renderer: the save's vocabulary is the save's. */
export type SavedRegime = "normal" | "cruise";

/** Where the ship is and what it is doing, at the instant of the write. */
export interface SavedFlight {
	/** Sim-space kilometres, float64 — `sim.ts`'s `Ship.pos`. */
	pos: readonly [number, number, number];
	/** Kilometres per second. */
	vel: readonly [number, number, number];
	/** Attitude as `[x, y, z, w]`. Not a `THREE.Quaternion`: see the header. */
	orientation: readonly [number, number, number, number];
	regime: SavedRegime;
}

/** The player half of a save. */
export interface CommanderRecord {
	/** Credits, cargo, equipment, tank and hull — `station-commerce.ts`'s own
	 *  struct, unchanged, because commerce is what writes it. */
	state: CommanderState;
	galaxyIndex: number;
	systemIndex: number;
	/** The station the ship is parked in, or `null` in flight. A carrier key,
	 *  never a `Station.id`: an id is system-local and names one station in
	 *  every system in the galaxy. */
	dockedAt: CarrierKey | null;
	/** The cruise reserve, AU (#10's second consumable). */
	chargeAu: number;
	/**
	 * #89's D7 flag, written at creation and never edited afterwards.
	 *
	 * **Stated and not enforced.** A permadeath commander can be exported,
	 * copied to another slot, or kept alive by closing the tab inside the
	 * debounce window. Anyone determined can edit an exported JSON anyway, so
	 * enforcement would buy the appearance of rigour rather than rigour.
	 */
	permadeath: boolean;
	flight: SavedFlight;
}

/** The pair, as the store holds it. */
export interface SaveEnvelope {
	world: WorldState;
	commander: CommanderRecord;
}

const fail = (message: string): never => {
	throw new Error(`save: ${message}`);
};

/** A new game's commander: #26's baseline hull, at rest, undocked, full
 *  charge. `chargeAu` is the caller's because `CHARGE_CAPACITY_AU` belongs to
 *  the travel model and this module is not it. */
export const newCommanderRecord = (
	hull: HullId,
	options: {
		permadeath?: boolean;
		galaxyIndex?: number;
		systemIndex?: number;
		chargeAu?: number;
	} = {},
): CommanderRecord => ({
	state: newCommander(hull),
	galaxyIndex: options.galaxyIndex ?? 0,
	systemIndex: options.systemIndex ?? 0,
	dockedAt: null,
	chargeAu: options.chargeAu ?? 0,
	permadeath: options.permadeath ?? false,
	flight: {
		pos: [0, 0, 0],
		vel: [0, 0, 0],
		orientation: [0, 0, 0, 1],
		regime: "normal",
	},
});

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

/** Key order is the hash's input, so it is written out rather than spread:
 *  a spread carries whatever order the producer happened to build, and two
 *  equal saves would then hash differently. This is `world-state.ts`'s
 *  `canonicalEnvelope` rule applied across the boundary. */
const canonicalCommander = (record: CommanderRecord) => {
	const cargo: Record<string, number> = {};
	for (const name of Object.keys(record.state.cargo).sort())
		cargo[name] = record.state.cargo[name];
	return {
		state: {
			credits: record.state.credits,
			cargo,
			ownedEquipment: [...record.state.ownedEquipment].sort(),
			fuelLy: record.state.fuelLy,
			hull: record.state.hull,
		},
		galaxyIndex: record.galaxyIndex,
		systemIndex: record.systemIndex,
		dockedAt: record.dockedAt,
		chargeAu: record.chargeAu,
		permadeath: record.permadeath,
		flight: {
			pos: [...record.flight.pos],
			vel: [...record.flight.vel],
			orientation: [...record.flight.orientation],
			regime: record.flight.regime,
		},
	};
};

/**
 * The envelope, ready to hand to a store.
 *
 * Plain JSON — no compression. #89 rejected it: the chosen store does not need
 * the headroom, and an opaque exported file is one neither the player nor a bug
 * report can read.
 */
export const serializeSave = (save: SaveEnvelope): unknown => {
	const body = {
		saveSchemaVersion: SAVE_SCHEMA_VERSION,
		world: serializeWorld(save.world),
		commander: canonicalCommander(save.commander),
	};
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const asObject = (raw: unknown, what: string): Record<string, unknown> => {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		fail(`${what} is not an object`);
	return raw as Record<string, unknown>;
};

const num = (
	raw: Record<string, unknown>,
	field: string,
	what: string,
): number => {
	const value = raw[field];
	if (typeof value !== "number" || !Number.isFinite(value))
		fail(`${what}: ${field} is not a finite number`);
	return value as number;
};

const tuple = <N extends number>(
	raw: Record<string, unknown>,
	field: string,
	length: N,
	what: string,
): number[] => {
	const value = raw[field];
	if (!Array.isArray(value) || value.length !== length)
		fail(`${what}: ${field} is not ${length} numbers`);
	for (const n of value as unknown[])
		if (typeof n !== "number" || !Number.isFinite(n))
			fail(`${what}: ${field} holds a non-finite value`);
	return value as number[];
};

const parseFlight = (raw: unknown): SavedFlight => {
	const o = asObject(raw, "commander.flight");
	const regime = o.regime;
	if (regime !== "normal" && regime !== "cruise")
		fail(`commander.flight: ${String(regime)} is not a regime`);
	const [px, py, pz] = tuple(o, "pos", 3, "commander.flight");
	const [vx, vy, vz] = tuple(o, "vel", 3, "commander.flight");
	const [ox, oy, oz, ow] = tuple(o, "orientation", 4, "commander.flight");
	return {
		pos: [px, py, pz],
		vel: [vx, vy, vz],
		orientation: [ox, oy, oz, ow],
		regime: regime as SavedRegime,
	};
};

const parseCommander = (raw: unknown): CommanderRecord => {
	const o = asObject(raw, "commander");
	const state = asObject(o.state, "commander.state");
	const hull = state.hull;
	if (
		typeof hull !== "string" ||
		!(HULL_IDS as readonly string[]).includes(hull)
	)
		fail(`commander.state: ${String(hull)} is not a hull in the roster`);
	const cargoRaw = asObject(state.cargo, "commander.state.cargo");
	const cargo: Record<string, number> = {};
	for (const name of Object.keys(cargoRaw).sort()) {
		const amount = cargoRaw[name];
		if (typeof amount !== "number" || !Number.isFinite(amount))
			fail(`commander.state.cargo: ${name} is not a finite quantity`);
		cargo[name] = amount as number;
	}
	const equipment = state.ownedEquipment;
	if (!Array.isArray(equipment) || equipment.some((e) => typeof e !== "string"))
		fail("commander.state: ownedEquipment is not a list of names");
	const dockedAt = o.dockedAt;
	// `undefined` is refused alongside a malformed key rather than read as
	// "in flight": an absent field is a truncated record, and #89's obligation
	// 5 says a truncation must not read as an absent row.
	if (
		dockedAt !== null &&
		!(typeof dockedAt === "string" && isCarrierKey(dockedAt))
	)
		fail(`commander: ${String(dockedAt)} is not a carrier key`);
	if (typeof o.permadeath !== "boolean")
		fail("commander: permadeath is not a boolean");
	return {
		state: {
			credits: num(state, "credits", "commander.state"),
			cargo,
			ownedEquipment: [...(equipment as string[])].sort(),
			fuelLy: num(state, "fuelLy", "commander.state"),
			hull: hull as HullId,
		},
		galaxyIndex: num(o, "galaxyIndex", "commander"),
		systemIndex: num(o, "systemIndex", "commander"),
		dockedAt: (dockedAt as CarrierKey | null) ?? null,
		chargeAu: num(o, "chargeAu", "commander"),
		permadeath: o.permadeath as boolean,
		flight: parseFlight(o.flight),
	};
};

/**
 * Reads a stored envelope back, or throws with a named reason.
 *
 * **It never edits what it was handed.** #89's D8 leaves a refused save
 * untouched on disk so the player can still export it, and a parser that
 * normalised in place would be the one thing able to destroy the record it
 * refused. Every value above is copied out; nothing is written back.
 */
export function parseSave(raw: unknown): SaveEnvelope {
	const o = asObject(raw, "envelope");
	const version = o.saveSchemaVersion;
	if (version !== SAVE_SCHEMA_VERSION)
		fail(
			`saveSchemaVersion ${String(version)} is not ${SAVE_SCHEMA_VERSION} — ` +
				"this save is left as it is; export it rather than loading it",
		);
	if (o.world === undefined || o.world === null) fail("world is missing");
	if (o.commander === undefined || o.commander === null)
		fail("commander is missing");
	const integrity = o.integrity;
	if (typeof integrity !== "number") fail("integrity is not a number");
	const body = {
		saveSchemaVersion: version,
		world: o.world,
		commander: o.commander,
	};
	// Hashed before either half is parsed, so a graft is reported as a graft
	// rather than as whichever field the splice happened to break first.
	if (integrity !== fnv1a(JSON.stringify(body)))
		fail("integrity check failed — this envelope was assembled from two saves");
	return { world: parseWorld(o.world), commander: parseCommander(o.commander) };
}

/** The opening credits figure, re-exported so a new-game caller does not have
 *  to import commerce for one constant. */
export { STARTING_CREDITS };
