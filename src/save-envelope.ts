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
import { generateGalaxy } from "./galaxy";
import { generateContents } from "./system";
import { emptyRequests, parseRequests, type RequestsState } from "./requests";
import {
	type CommanderState,
	newCommander,
	STARTING_CREDITS,
} from "./station-commerce";
import { fnv1a } from "./rng";
import {
	GALAXY_COUNT,
	isSystemIndex,
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
 *
 * **2 adds `flight.throttle`.** A cruise leg is flown at full throttle and the
 * engage sets it; a restore that put the regime back without it ran `stepCruise`
 * at the field default of zero, and the first frame overwrote the restored
 * velocity with a stop. The throttle is session state like everything else in
 * `flight`, so it is carried rather than reconstructed. Free to bump: nothing
 * has shipped a version 1 record, and D8's refusal is what a player would meet
 * if one had.
 *
 * **3 adds `commander.requests`, and adds it unconditionally (#437).** For a
 * round the journal was an isolated development trial with a schema version of
 * its own, chosen per write: a save carrying an accepted request encoded as 3
 * and one without it as 2, and the Commander catalog refused 3 outright. That
 * made the wire shape depend on whether the player had accepted anything,
 * which is the dependency that needed two versions in the first place. There
 * is one version now and an empty journal is written like any other empty
 * field.
 *
 * **4 is #411's wire shape for that journal.** The content was gated behind a
 * DEV flag for one node more; #411 replaced the fixtures with `jobs.ts`'s
 * bound offers, which changed every field of a saved offer
 * (`slot: "relay" | "survey"` became a family, a row id, a delivery station, a
 * commodity and a tonnage) and added the entrusted cargo lots. A version
 * identifies a shape, so a reader that told a 3 from a 4 by which fields
 * happened to be present would be guessing. A version 3 record still loads —
 * with an **empty** journal, which is what every shipped one has, because its
 * content never left the DEV flag — and one carrying accepted work is refused
 * by name rather than reinterpreted.
 */
export const SAVE_SCHEMA_VERSION = 4;
/**
 * Versions this parser still reads but no longer writes.
 *
 * **2 is a shipped version, which is why it is here rather than deleted.** The
 * header above says a bump was free while nothing had shipped a version 1
 * record; that stopped being true for 2 the moment the site offered *Play now*
 * (`public-site.ts`), so a player's record predates the journal and must still
 * load. `parseCommander` gives it an empty one.
 */
export const LEGACY_SAVE_SCHEMA_VERSIONS = [2, 3] as const;

/**
 * What a legacy version may not contain.
 *
 * **Membership above is not the whole rule.** A version is readable *and* has
 * a shape; 2 predates the journal, so a record claiming 2 and carrying a
 * `requests` key was assembled rather than saved, and `parseCommander` refuses
 * it. Keeping the two beside each other means a later entry in the list has to
 * answer the same question rather than inheriting readability alone.
 */
export const LEGACY_SCHEMA_FORBIDS: Readonly<
	Partial<Record<number, readonly string[]>>
> = { 2: ["requests"] };

/**
 * A version 3 record's journal, migrated or refused.
 *
 * Empty is the shipped case and migrates to an empty journal. Anything in it
 * was written by the retired DEV fixture trial, whose offers cannot be read as
 * #411's shape — so it is refused with its own sentence rather than being
 * silently dropped, which `missions-and-requests.md` §7 forbids.
 */
const migrateV3Requests = (raw: unknown): RequestsState => {
	const journal = raw as { byId?: unknown; leadsById?: unknown } | null;
	const populated = (x: unknown) =>
		x !== null && typeof x === "object" && Object.keys(x).length > 0;
	if (populated(journal?.byId) || populated(journal?.leadsById))
		fail(
			"saveSchemaVersion 3 carries requests from the retired fixture trial; that content was replaced by live jobs in #411 and cannot be migrated",
		);
	return emptyRequests();
};

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
	/**
	 * The commanded throttle, 0…1.
	 *
	 * **Load-bearing in cruise and not merely cosmetic.** The engage sets it to
	 * 1 beside the regime, and `stepCruise` reads it every frame: a restore that
	 * set `regime` alone flew the leg at zero and wrote the ship's velocity to a
	 * stop on the first frame, which reads as a save that lost the leg rather
	 * than as a missing field.
	 */
	throttle: number;
}

/** The player half of a save. */
export interface CommanderRecord {
	/** The live request journal (#411); stored atomically with credits, so a
	 *  reward and the commitment it settled cannot come back from different
	 *  snapshots. */
	requests: RequestsState;
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
	requests: emptyRequests(),
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
		throttle: 0,
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
		requests: {
			byId: Object.fromEntries(
				Object.entries(record.requests.byId).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			),
			leadsById: Object.fromEntries(
				Object.entries(record.requests.leadsById).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			),
			// The entrusted lots are the cargo obligation, and §4 forbids
			// settling one by losing it: a serializer that dropped them would
			// hand the pilot the requester's goods across a reload.
			entrustedByLotId: Object.fromEntries(
				Object.entries(record.requests.entrustedByLotId).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			),
			trackedRequestId: record.requests.trackedRequestId,
		},
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
			throttle: record.flight.throttle,
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
	const throttle = num(o, "throttle", "commander.flight");
	if (throttle < 0 || throttle > 1)
		fail(`commander.flight: ${throttle} is not a throttle`);
	return {
		pos: [px, py, pz],
		vel: [vx, vy, vz],
		orientation: [ox, oy, oz, ow],
		regime: regime as SavedRegime,
		throttle,
	};
};

const parseCommander = (
	raw: unknown,
	now: number,
	version: number,
): CommanderRecord => {
	const o = asObject(raw, "commander");
	// `Partial` is what makes the `undefined` arm real to the compiler: typed as
	// a total record it reads as dead code, and the next cleanup to trust the
	// type would refuse every current-version record.
	for (const key of LEGACY_SCHEMA_FORBIDS[version] ?? [])
		if (o[key] !== undefined)
			// The key is interpolated rather than named in prose: a second entry
			// in the table would otherwise print a sentence about the first.
			fail(`saveSchemaVersion ${version} cannot contain "${key}"`);
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
	// **Bounded, not merely finite — and bounded on both indices.** For a round
	// the system index was checked only for being a non-negative integer while
	// the comment claimed it covered "a system the galaxy does not have", so
	// `systemIndex: 999` parsed cleanly and `restoreWorld` threw on it later.
	// `isSystemIndex` is `world-state.ts`'s own range, exported rather than
	// restated here: §7's visited domain and this field are the same 0..255.
	//
	// The harm is bounded rather than fatal — `main.ts` catches a restore that
	// throws and starts fresh with a named fault — and that does not make the
	// check optional. A record refused at the parser is one the player can still
	// export under D9; one refused inside the constructor has already lost the
	// reason it was refused.
	const galaxyIndex = num(o, "galaxyIndex", "commander");
	if (
		!Number.isInteger(galaxyIndex) ||
		galaxyIndex < 0 ||
		galaxyIndex >= GALAXY_COUNT
	)
		fail(`commander: ${galaxyIndex} is not a galaxy index`);
	const systemIndex = num(o, "systemIndex", "commander");
	if (!isSystemIndex(systemIndex))
		fail(`commander: ${systemIndex} is not a system index`);
	return {
		requests:
			version === 2
				? emptyRequests()
				: version === 3
					? migrateV3Requests(o.requests)
					: parseRequests(o.requests, now),
		state: {
			credits: num(state, "credits", "commander.state"),
			cargo,
			ownedEquipment: [...(equipment as string[])].sort(),
			fuelLy: num(state, "fuelLy", "commander.state"),
			hull: hull as HullId,
		},
		galaxyIndex,
		systemIndex,
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
	if (
		typeof version !== "number" ||
		(version !== SAVE_SCHEMA_VERSION &&
			!(LEGACY_SAVE_SCHEMA_VERSIONS as readonly number[]).includes(version))
	)
		fail(
			// The reason alone: the player's sentence — left as it is, Export
			// takes a copy — is `loadFault`'s, which the overlay puts first.
			`saveSchemaVersion ${String(version)} is unsupported; expected ${[
				SAVE_SCHEMA_VERSION,
				...LEGACY_SAVE_SCHEMA_VERSIONS,
			].join(" or ")}`,
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
		fail(
			"integrity check failed — this save does not match its own checksum. " +
				"It was edited, corrupted, or assembled from two saves; the hash " +
				"cannot say which.",
		);
	const world = parseWorld(o.world);
	// Schema 2 at 7f1cfd3 is the supported pre-journal envelope. Verify its
	// original hash above, then migrate a copy; the store retains its original
	// until the normal complete-envelope transaction succeeds.
	const commander = parseCommander(
		o.commander,
		world.gameTime,
		version as number,
	);
	const offers = [
		...Object.values(commander.requests.byId).map((r) => r.terms),
		...Object.values(commander.requests.leadsById),
	];
	const stationsBySystem = new Map<string, Map<string, string>>();
	const galaxies = new Map<number, ReturnType<typeof generateGalaxy>>();
	/** The generated station a reference names, or a refusal. */
	const stationNameOf = (
		ref: { galaxyIndex: number; carrierKey: CarrierKey },
		what: string,
	): string => {
		const { galaxyIndex, carrierKey: key } = ref;
		const separator = key.indexOf(":");
		const systemIndex = Number(key.slice(0, separator));
		const localId = key.slice(separator + 1);
		const namespace = `${galaxyIndex}:${systemIndex}`;
		let stations = stationsBySystem.get(namespace);
		if (!stations) {
			let galaxy = galaxies.get(galaxyIndex);
			if (!galaxy) {
				galaxy = generateGalaxy(world.seed, galaxyIndex);
				galaxies.set(galaxyIndex, galaxy);
			}
			stations = new Map(
				generateContents(galaxy.systems[systemIndex]).stations.map((s) => [
					s.localCarrierId,
					s.name,
				]),
			);
			stationsBySystem.set(namespace, stations);
		}
		const name = stations.get(localId);
		if (name === undefined)
			fail(`Requests ${what} ${key} does not exist in galaxy ${galaxyIndex}`);
		return name as string;
	};
	for (const offer of offers) {
		// Labels are presentation, not identity. Refresh the requester's name
		// through the valid CarrierKey, so a naming-policy change cannot
		// invalidate a save. **The rest of the offer is not refreshed**: its
		// operands were bound from world state at offer time and pinned at
		// acceptance (`missions-and-requests.md` §1), so re-deriving them here
		// would rewrite the terms the pilot agreed to.
		offer.requesterName = stationNameOf(offer.requester, "requester");
		// **The report station is checked too, and for a sharper reason than
		// the requester's**: `report` writes the world mark to `reportAt`, so a
		// journal naming a station the generator never made would open a
		// deficit row against a carrier key that does not exist.
		offer.reportName = stationNameOf(offer.reportAt, "report station");
	}
	return { world, commander };
}

/** The opening credits figure, re-exported so a new-game caller does not have
 *  to import commerce for one constant. */
export { STARTING_CREDITS };
