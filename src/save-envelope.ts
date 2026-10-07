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
import { type FirstDayChoice, isFirstDayChoice } from "./first-day-choice";
import { HULL_IDS, HULL_SPECS, type HullId } from "./hull";
import { generateGalaxy } from "./galaxy";
import { generateContents } from "./system";
import { emptyRequests, parseRequests, type RequestsState } from "./requests";
import {
	type CommanderState,
	newCommander,
	STARTING_CREDITS,
} from "./station-commerce";
import {
	type LadderRecord,
	parseLadders,
	seededLadderRecord,
	serializeLadders,
} from "./ladder";
import { COMMODITIES, EQUIPMENT } from "./market";
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
 * (the trial's two-value row key became a family, a row id, a delivery station, a
 * commodity and a tonnage) and added the entrusted cargo lots. A version
 * identifies a shape, so a reader that told a 3 from a 4 by which fields
 * happened to be present would be guessing. A version 3 record still loads —
 * with an **empty** journal, which is what every shipped one has, because its
 * content never left the DEV flag — and one carrying accepted work is refused
 * by name rather than reinterpreted.
 *
 * **5 is #440's discriminated operand (#453).** A v4 offer carried `goodName`,
 * `tonnes` and `entrusted` flat, because both shipped families move cargo;
 * Bounty's operand is a target carrier and Salvage's is a wreck, so the field
 * a job is *about* became a tagged union before either was written. The bump
 * is taken **alone and early** on purpose: a migration is the expensive part
 * of a persisted change, and paying it in a change with no content in it means
 * the family that needs it later adds a union member rather than a save
 * version. Every well-formed v4 offer lifts, because every v4 family was a
 * cargo family. It is not a promise that a v4 load cannot throw:
 * `migrateV4Requests` below refuses one thing — an offer already carrying
 * `operand` — and `parseRequests` refuses the rest of the shape as always.
 *
 * **6 adds `commander.firstDay` (#408 D4)**, New game's guided or free choice.
 * Every older record loads as `free`: a pilot who already has a save is not a
 * new pilot, and the guided day's push would otherwise start talking to them
 * about launching.
 *
 * **7 adds `commander.ladders` (#564, #183 D9)**: the three banked totals,
 * the per-galaxy visited-system and docked-station sets, the purchase basis a
 * sale's margin is read against, and the play log. Every older record migrates
 * at zero on every ladder, its sets seeded with every system its own world
 * marks visited (§7's flags, per galaxy) and the station it is docked at, and
 * keeps everything it owns. Credit earned since
 * the last dock is not here at all: it is lost with the ship (#183 D7).
 *
 * **8 adds `commander.flight.rates` (#619)**, the ship's pitch, yaw and roll
 * rates. Under the vent substrate rotation carries momentum that no held key
 * implies, so a save taken tumbling resumes tumbling (`flight-model.md`
 * §3.9). Every older record loads at rest: before #619 a released axis eased
 * to a stop with the assist on, and nothing recorded a spin to resume.
 *
 * **9 adds the world's derelict rows (node #731, `salvage.md`)**: per galaxy, // glossary-ignore: slot
 * one row per derelict slot the pilot has touched, holding the instance and
 * the tonnes left in each container. The rows live in the world's envelopes,
 * absent when empty — so `WORLD_SCHEMA_VERSION` does not move and a version 8
 * world's bytes still match its own hash — and this version is what says a
 * record may carry them. Every older record loads with every slot unvisited,
 * on its derived schedule; one that carries a row was assembled rather than
 * saved, and `parseSave` refuses it.
 *
 * **10 adds unfitted salvage items to the commander hold (node #732).** Each
 * names a fitting and its carried tonnes; older records load with none.
 */
export const SAVE_SCHEMA_VERSION = 10;
/**
 * Versions this parser still reads but no longer writes.
 *
 * **2 is a shipped version, which is why it is here rather than deleted.** The
 * header above says a bump was free while nothing had shipped a version 1
 * record; that stopped being true for 2 the moment the site offered *Play now*
 * (`public-site.ts`), so a player's record predates the journal and must still
 * load. `parseCommander` gives it an empty one.
 *
 * **4 is shipped too, and with content**: it is the version every save written
 * between #411 and #453 carries, journal and all. That is not in tension with
 * what the header above says about 3 — the DEV flag left *3*'s journals empty,
 * and #411 both retired the flag and made the content live, which is what made
 * it a new version. So 4 is the first entry in this list whose migration moves
 * data rather than emptying it, and the first with a real population behind
 * it.
 *
 * **5 is every save written between #453 and #408.**
 *
 * **6 is every save written between #408 and #564.**
 *
 * **7 is every save written between #564 and #619.**
 *
 * **8 is every save written between #619 and node #731**, so it is the
 * population a player most likely holds.
 *
 * **9 is every save written between nodes #731 and #732.** Its derelict
 * remainder rows stay intact; it predates recovered fitting hold items.
 */
export const LEGACY_SAVE_SCHEMA_VERSIONS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * What a legacy version may not contain.
 *
 * **Membership above is not the whole rule.** A version is readable *and* has
 * a shape; 2 predates the journal, so a record claiming 2 and carrying a
 * `requests` key was assembled rather than saved, and `parseCommander` refuses
 * it. Keeping the two beside each other means a later entry in the list has to
 * answer the same question rather than inheriting readability alone.
 *
 * **This table reaches the commander's own keys and nothing deeper.** A field
 * a legacy version may not carry *inside* the journal is banned where that
 * journal is reshaped — `migrateV4Requests` below is the worked example, and
 * #453 specified an entry here that could never have fired.
 */
export const LEGACY_SCHEMA_FORBIDS: Readonly<
	Partial<Record<number, readonly string[]>>
> = {
	2: ["requests", "firstDay", "ladders"],
	3: ["firstDay", "ladders"],
	4: ["firstDay", "ladders"],
	5: ["firstDay", "ladders"],
	6: ["ladders"],
};

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

/**
 * A version 4 journal's offers, lifted onto #440's operand.
 *
 * **The refusal is here rather than in `LEGACY_SCHEMA_FORBIDS`, and that is a
 * correction to #453's own text.** That table is read against the *commander*
 * object (`parseCommander` below), and `operand` lives three levels down on an
 * offer — an entry of `{ 4: ["operand"] }` would never fire, and a green row
 * beside it would be a check that cannot fail. The rule the table states for
 * `2` is the right rule; this is the only place that can apply it to a field
 * inside the journal.
 *
 * **The three flat keys are deleted, not merely superseded.** `offerOf` copies
 * a validated offer by spread, so a `goodName` left beside the operand rides
 * through the load and out into the next write — a version 5 record carrying
 * version 4's fields, which no version identifies.
 *
 * **It reshapes, and it refuses exactly one thing** — an offer that already
 * carries `operand`, the paragraph above's rule. Everything else about the
 * shape is `parseRequests`'s, so a reader looking for where a v4 record is
 * rejected finds one case here and the rest there. An earlier version of this
 * paragraph said it "does not validate" three lines below a `fail`, which is
 * the claim a caller would have read as *this cannot throw*.
 *
 * Total over **well-formed** v4 offers: every v4 family is `courier` or
 * `procurement` and both move cargo, so no genuine v4 record loses its
 * operand here.
 */
const migrateV4Requests = (raw: unknown): unknown => {
	if (raw === null || typeof raw !== "object") return raw;
	const journal = raw as Record<string, unknown>;
	const lift = (offer: unknown): unknown => {
		if (offer === null || typeof offer !== "object") return offer;
		const { goodName, tonnes, entrusted, ...rest } = offer as Record<
			string,
			unknown
		>;
		if (rest.operand !== undefined)
			fail('saveSchemaVersion 4 cannot contain "operand"');
		return { ...rest, operand: { kind: "cargo", goodName, tonnes, entrusted } };
	};
	const map = (
		container: unknown,
		each: (row: Record<string, unknown>) => unknown,
	): unknown => {
		if (container === null || typeof container !== "object") return container;
		// **A null prototype, because the keys are a save's.** `JSON.parse`
		// makes `__proto__` an own key, and assigning it on an ordinary object
		// reaches `Object.prototype`'s setter instead of storing a row — the
		// offer would vanish here rather than be refused by `parseRequests`.
		const out: Record<string, unknown> = Object.create(null);
		for (const [id, row] of Object.entries(
			container as Record<string, unknown>,
		))
			out[id] =
				row !== null && typeof row === "object"
					? each(row as Record<string, unknown>)
					: row;
		return out;
	};
	return {
		...journal,
		byId: map(journal.byId, (row) => ({ ...row, terms: lift(row.terms) })),
		leadsById: map(journal.leadsById, (row) => lift(row)),
	};
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
	/** Pitch, yaw and roll rates, radians per second, in the hull's own axes
	 *  (`sim.ts`'s `Angular`). Since version 8 (#619). */
	rates: readonly [number, number, number];
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
	/** #408 D4: New game's choice, written at creation and never edited. */
	firstDay: FirstDayChoice;
	/** The three ladders' banked record (#183 D9). Beside `state` in the one
	 *  record, so a death's revert to `lastDocked` moves the credits and the
	 *  rungs together. */
	ladders: LadderRecord;
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

/** A new game's commander: at rest, undocked, and a charge the caller names —
 *  the renderer owns the drive charge's session, and a full one is the hull's
 *  `chargeAu` (#554).
 *
 *  **The boundary moved in one direction and on purpose.** The charge of a
 *  *new* record is still the caller's. What this module now owns is the
 *  *ceiling on load*: `parseCommander` clamps a stored tank and charge to the
 *  record's own hull, because a record written before #554 filled every hull
 *  to the courier's figures, and the parser is the one place every restore
 *  passes through. It reads the roster (`hull.ts`, a leaf) and nothing of
 *  the travel model. */
export const newCommanderRecord = (
	hull: HullId,
	options: {
		permadeath?: boolean;
		firstDay?: FirstDayChoice;
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
	firstDay: options.firstDay ?? "free",
	// A new game is paid for nothing it starts with: its own system is seeded
	// (#183 D9's migration rule, applied to the start). The start station is
	// not: its first dock, a guided start's included, earns one kind.
	ladders: seededLadderRecord(
		options.galaxyIndex ?? 0,
		options.systemIndex ?? 0,
		null,
	),
	flight: {
		pos: [0, 0, 0],
		vel: [0, 0, 0],
		orientation: [0, 0, 0, 1],
		regime: "normal",
		throttle: 0,
		rates: [0, 0, 0],
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
			...(record.state.recoveredFittings?.length
				? {
						recoveredFittings: record.state.recoveredFittings.map((item) => ({
							...item,
						})),
					}
				: {}),
			fuelLy: record.state.fuelLy,
			hull: record.state.hull,
		},
		galaxyIndex: record.galaxyIndex,
		systemIndex: record.systemIndex,
		dockedAt: record.dockedAt,
		chargeAu: record.chargeAu,
		permadeath: record.permadeath,
		firstDay: record.firstDay,
		ladders: serializeLadders(record.ladders),
		flight: {
			pos: [...record.flight.pos],
			vel: [...record.flight.vel],
			orientation: [...record.flight.orientation],
			regime: record.flight.regime,
			throttle: record.flight.throttle,
			rates: [...record.flight.rates],
		},
	};
};

/** A pre-9 world carrying a derelict domain was assembled, not saved. */
const refuseDerelicts = (world: unknown, version: number): void => {
	const galaxies = (world as { galaxies?: unknown } | null)?.galaxies;
	if (!Array.isArray(galaxies)) return;
	for (const g of galaxies)
		if (
			g !== null &&
			typeof g === "object" &&
			(g as Record<string, unknown>).derelicts !== undefined
		)
			fail(`world: derelicts is not a version ${version} field`);
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

const parseFlight = (raw: unknown, version: number): SavedFlight => {
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
	// Present from 8 and required there — an absent field is a truncated
	// record — and refused below it, where a record carrying it was assembled
	// rather than saved (`LEGACY_SCHEMA_FORBIDS`'s rule, one level down).
	if (version < 8 && o.rates !== undefined)
		fail(`commander.flight: rates is not a version ${version} field`);
	const [rp, ry, rr] =
		version >= 8 ? tuple(o, "rates", 3, "commander.flight") : [0, 0, 0];
	return {
		pos: [px, py, pz],
		vel: [vx, vy, vz],
		orientation: [ox, oy, oz, ow],
		regime: regime as SavedRegime,
		throttle,
		rates: [rp, ry, rr],
	};
};

const parseCommander = (
	raw: unknown,
	now: number,
	version: number,
	/** The loaded world's §7 visited flags per galaxy — what a pre-7 record's
	 *  ladders are seeded from, so a veteran is not paid for old places. */
	visitedSystems: Readonly<Record<number, readonly number[]>>,
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
	// **The name is checked here, not where it is read.** The quantity was
	// validated and the key was not, so an unrecognised good survived the load
	// and threw the first time something asked what unit it was in — which
	// since #443 is the hold projection, on every console update while docked.
	// A save boundary that admits a name nothing can price is the same class as
	// a hull that is not in the roster, two checks above.
	const goodNames = new Set(COMMODITIES.map((good) => good.name));
	for (const name of Object.keys(cargoRaw).sort()) {
		const amount = cargoRaw[name];
		if (typeof amount !== "number" || !Number.isFinite(amount))
			fail(`commander.state.cargo: ${name} is not a finite quantity`);
		if (!goodNames.has(name))
			fail(`commander.state.cargo: ${name} is not a commodity`);
		cargo[name] = amount as number;
	}
	const recovered = state.recoveredFittings;
	if (version < 10 && recovered !== undefined)
		fail(
			"commander.state: recoveredFittings is not a version " +
				version +
				" field",
		);
	if (
		recovered !== undefined &&
		(!Array.isArray(recovered) ||
			recovered.some(
				(item) =>
					!item ||
					typeof item !== "object" ||
					!EQUIPMENT.some((e) => e.name === item.id) ||
					!Number.isInteger(item.tonnes) ||
					item.tonnes <= 0,
			))
	)
		fail(
			"commander.state: recoveredFittings is not a list of fitting items with positive whole tonnes",
		);
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
	// A legacy record has no choice and loads as free — the forbids table above
	// has already refused one that carries the key. A current record without it
	// is truncated, and #89's obligation 5 says that must not read as free.
	// **Keyed on the version that added it, not on "current".** When 7 made 6
	// legacy, a `version !== SAVE_SCHEMA_VERSION` test here would have loaded
	// every guided v6 commander as free.
	const hasFirstDay = version >= 6;
	if (hasFirstDay && !isFirstDayChoice(o.firstDay))
		fail(`commander: firstDay ${String(o.firstDay)} is not guided or free`);
	const firstDay: FirstDayChoice = hasFirstDay
		? (o.firstDay as FirstDayChoice)
		: "free";
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
	// #183 D9: an older record migrates at zero, seeded with where it has been. A
	// current one without the key is truncated, and #89's obligation 5 says a
	// truncation must not read as zero.
	if (version >= 7 && o.ladders === undefined)
		fail("commander: ladders is missing");
	const ladders =
		version >= 7
			? parseLadders(o.ladders)
			: seededLadderRecord(
					galaxyIndex,
					systemIndex,
					(dockedAt as CarrierKey | null) ?? null,
					visitedSystems,
				);
	// **A basis names a good aboard, and no more of it than is aboard.** The
	// cargo check above is the model: a line for a good nothing can price, or
	// for tonnes the hold does not carry, is a margin the pilot could be paid
	// for goods that are not there.
	for (const [good, line] of Object.entries(ladders.basis)) {
		if (!goodNames.has(good))
			fail(`commander.ladders.basis: ${good} is not a commodity`);
		if (line.units > (cargo[good] ?? 0))
			fail(`commander.ladders.basis: ${good} covers more than is aboard`);
	}
	return {
		requests:
			version === 2
				? emptyRequests()
				: version === 3
					? migrateV3Requests(o.requests)
					: // The lift runs **before** the validator rather than inside
						// it: `parseRequests` knows one shape, the current one, and a
						// validator that also read retired shapes would have to be
						// re-read every time a version is added.
						parseRequests(
							version === 4 ? migrateV4Requests(o.requests) : o.requests,
							now,
						),
		state: {
			credits: num(state, "credits", "commander.state"),
			cargo,
			ownedEquipment: [...(equipment as string[])].sort(),
			...(Array.isArray(recovered) && recovered.length
				? {
						recoveredFittings: recovered.map((item) => ({
							id: item.id as string,
							tonnes: item.tonnes as number,
						})),
					}
				: {}),
			// **Clamped to the hull's tank, not refused** (#554). Every save
			// before it filled to the courier's 7 LY whatever the hull, so a
			// short-tank commander's record carries more fuel than the hull
			// holds; that is a figure a rule moved under, not a corrupt record.
			// A new record, so D8's untouched-on-disk rule is kept.
			fuelLy: Math.min(
				num(state, "fuelLy", "commander.state"),
				HULL_SPECS[hull as HullId].tankLy,
			),
			hull: hull as HullId,
		},
		galaxyIndex,
		systemIndex,
		dockedAt: (dockedAt as CarrierKey | null) ?? null,
		// Likewise the drive charge: every hull regenerated to the courier's
		// 12 AU before #554, which a 10 AU hull does not hold.
		chargeAu: Math.min(
			num(o, "chargeAu", "commander"),
			HULL_SPECS[hull as HullId].chargeAu,
		),
		permadeath: o.permadeath as boolean,
		firstDay,
		ladders,
		flight: parseFlight(o.flight, version),
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
	// **Below 9 a world holds no derelict row.** The world parser reads an
	// absent domain as empty whatever the version, because that is what keeps an
	// old world's bytes equal to its hash; this is where the version that may
	// carry one is enforced, as `flight.rates` is one level down.
	if ((version as number) < 9) refuseDerelicts(o.world, version as number);
	const world = parseWorld(o.world);
	// Schema 2 at 7f1cfd3 is the supported pre-journal envelope. Verify its
	// original hash above, then migrate a copy; the store retains its original
	// until the normal complete-envelope transaction succeeds.
	const commander = parseCommander(
		o.commander,
		world.gameTime,
		version as number,
		Object.fromEntries(world.galaxies.map((g, i) => [i, g.visited])),
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
