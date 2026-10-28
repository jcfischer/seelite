import { expect, test } from "bun:test";
import { migrateEquipment } from "../src/loadout";
import { carrierKey } from "../src/carrier-key";
import type { JobOffer } from "../src/jobs";
import { firstOffer } from "./helpers/job-board";
import { requestAction } from "../src/requests";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";
import { fnv1a } from "../src/rng";
import {
	CommanderCatalog,
	memorySaveBackend,
	memorySlotLocks,
	SaveStore,
} from "../src/save-store";

/**
 * A live courier offer, bound at a real station of world 42's first galaxy.
 *
 * The save validates that a requester exists in the generated galaxy, so a
 * journal built on an invented station is refused — which is a row below
 * rather than an obstacle here.
 */
const SAVE_SYSTEMS = generateGalaxy(42, 0).systems;
const liveCourier = () => {
	const found = firstOffer(SAVE_SYSTEMS, "courier");
	return { offers: found.offers, courier: found.offer };
};
const LIVE = liveCourier();
const requestCtx = (docked: JobOffer["requester"]) => ({
	now: 20,
	docked,
	cargo: {} as Readonly<Record<string, number>>,
	holdRoomT: 35,
	standing: "clean" as const,
	equipment: [] as readonly string[],
});

/** Accept, fly, deliver and report one courier run — a settled journal. */
const flyCourier = (requests: Parameters<typeof requestAction>[0]) => {
	let state = requests;
	let paidCr = 0;
	for (const [action, where] of [
		["accept", LIVE.courier.requester],
		["deliver", LIVE.courier.reportAt],
		["report", LIVE.courier.reportAt],
	] as const) {
		const result = requestAction(
			state,
			LIVE.offers,
			action,
			LIVE.courier.id,
			requestCtx(where),
		);
		if (!result.ok) throw new Error(`${action}: ${result.message}`);
		state = result.state;
		paidCr += result.rewardCr;
	}
	return { state, paidCr };
};

const paidTrial = () => {
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	const flown = flyCourier(commander.requests);
	commander.requests = flown.state;
	commander.state.credits += flown.paidCr;
	return { world, commander };
};

test("the one catalog imports a journal-bearing record in either slot", async () => {
	const backend = memorySaveBackend();
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	const paid = serializeSave(paidTrial());
	const fresh = serializeSave({
		world: newWorld(42),
		commander: newCommanderRecord("courier"),
	});
	// Either record may carry the journal: #437 retired the encoding refusal,
	// so neither arrangement is a reason to reject the import.
	for (const [slot, kind, records] of [
		["live-journal", "live", { live: paid, lastDocked: fresh }],
		["docked-journal", "lastDocked", { live: fresh, lastDocked: paid }],
	] as const) {
		await catalog.importSlot(slot, JSON.stringify(records));
		expect(await catalog.slots()).toContain(slot);
		// Read back the record that carries the journal, not always `live`:
		// the docked arm is named for a journal it would never have looked at.
		expect(catalog.parseRecord(await backend.read(slot, kind))).toEqual(
			parseSave(paid),
		);
		expect(
			catalog.parseRecord(await backend.read(slot, kind)).commander.requests
				.byId,
		).not.toEqual({});
	}
});

test("a refused import writes nothing and leaves the catalog empty", async () => {
	const backend = memorySaveBackend();
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	const fresh = serializeSave({
		world: newWorld(42),
		commander: newCommanderRecord("courier"),
	});
	// #437 retired the encoding refusal, and the rows it retired also carried
	// D6's import atomicity — that a rejected record leaves no partial slot
	// behind. The reason a record is refused changed; the atomicity did not.
	const unsupported = { ...(fresh as object), saveSchemaVersion: 99 };
	for (const records of [
		{ live: unsupported, lastDocked: fresh },
		{ live: fresh, lastDocked: unsupported },
	]) {
		await expect(
			catalog.importSlot("refused", JSON.stringify(records)),
		).rejects.toThrow("saveSchemaVersion");
		expect(await catalog.slots()).toEqual([]);
		expect(backend.writes).toBe(0);
	}
});

test("the one store loads and flushes a journal-bearing record", async () => {
	const backend = memorySaveBackend();
	const save = paidTrial();
	const store = new SaveStore({
		backend,
		locks: memorySlotLocks(),
		slot: "normal",
		schedule: () => () => {},
		current: () => save,
	});
	await store.flush("quit");
	expect(await store.load("normal")).toEqual(save);
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	expect(catalog.parseRecord(await backend.read("normal", "live"))).toEqual(
		save,
	);
	// The reverted record carries its journal back too.
	await backend.write("normal", "lastDocked", serializeSave(save));
	expect(
		(await store.revertToLastDocked({ permadeath: false }, "destroyed"))
			?.commander.requests,
	).toEqual(save.commander.requests);
});

test("Requests and credits round-trip under one hash at every stage", () => {
	const commander = newCommanderRecord("courier");
	const world = newWorld(42);
	world.gameTime = 20;
	for (const [action, where] of [
		["accept", LIVE.courier.requester],
		["track", LIVE.courier.requester],
		["deliver", LIVE.courier.reportAt],
		["report", LIVE.courier.reportAt],
	] as const) {
		const result = requestAction(
			commander.requests,
			LIVE.offers,
			action,
			LIVE.courier.id,
			requestCtx(where),
		);
		expect(result.ok).toBe(true);
		commander.requests = result.state;
		commander.state.credits += result.rewardCr;
		expect(parseSave(serializeSave({ world, commander }))).toEqual({
			world,
			commander,
		});
	}
	const graft = JSON.parse(JSON.stringify(serializeSave({ world, commander })));
	graft.commander.state.credits += 250;
	expect(() => parseSave(graft)).toThrow("integrity");
});

test("verified schema 2 migrates a copy to empty journal; corrupt and unsupported originals stay untouched", () => {
	const current = JSON.parse(
		JSON.stringify(
			serializeSave({
				world: newWorld(42),
				commander: newCommanderRecord("courier"),
			}),
		),
	);
	// **A literal, so a bump has to come through here.** This row grafts a
	// version 2 body out of a current one; if the two ever met, it would be
	// asserting the migration path against no migration at all. It went red on
	// #453's bump, which is the tripwire working.
	expect(SAVE_SCHEMA_VERSION).toBe(16);
	const { integrity, ...body } = current;
	body.saveSchemaVersion = 2;
	body.commander.state.ownedEquipment = [];
	delete body.commander.state.loadout;
	delete body.commander.sweepReadings;
	delete body.commander.firstDay;
	delete body.commander.ladders;
	delete body.commander.flight.rates;
	delete body.commander.requests;
	delete body.commander.txSeq;
	const old = { ...body, integrity: fnv1a(JSON.stringify(body)) };
	const before = JSON.stringify(old);
	expect(parseSave(old).commander.requests.byId).toEqual({});
	expect(JSON.stringify(old)).toBe(before);
	old.commander.state.credits += 1;
	const corrupt = JSON.stringify(old);
	expect(() => parseSave(old)).toThrow("integrity");
	expect(JSON.stringify(old)).toBe(corrupt);
	expect(() => parseSave({ ...current, saveSchemaVersion: 999 })).toThrow(
		"saveSchemaVersion",
	);
});

test("request journal cannot reference a nonexistent generated requester", () => {
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	// A bound offer with its requester swapped for a station the generator
	// never made: identity is validated against the galaxy, not the journal.
	const invented = {
		...structuredClone(LIVE.courier),
		requester: {
			galaxyIndex: 0,
			carrierKey: carrierKey(0, "station-invented"),
		},
	};
	commander.requests = requestAction(
		commander.requests,
		[invented],
		"accept",
		invented.id,
		requestCtx(invented.requester),
	).state;
	expect(() => parseSave(serializeSave({ world, commander }))).toThrow(
		"requester",
	);
});

test("requester labels refresh by CarrierKey without rejecting or changing the stored input", () => {
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	const renamed = {
		...structuredClone(LIVE.courier),
		requesterName: "Made up",
	};
	commander.requests = requestAction(
		commander.requests,
		[renamed],
		"accept",
		renamed.id,
		requestCtx(renamed.requester),
	).state;
	const raw = serializeSave({ world, commander });
	const before = JSON.stringify(raw);
	const loaded = parseSave(raw);
	const restored = loaded.commander.requests.byId[renamed.id].terms;
	// The name comes back from the generator; the pinned terms do not move.
	expect(restored.requesterName).toBe(LIVE.courier.requesterName);
	expect(restored.requester).toEqual(LIVE.courier.requester);
	expect(restored.rewardCr).toBe(LIVE.courier.rewardCr);
	expect(JSON.stringify(raw)).toBe(before);
});

test("every Commander write is the current schema and carries its journal", () => {
	const save = {
		world: newWorld(42),
		commander: newCommanderRecord("courier"),
	};
	const raw = serializeSave(save) as {
		saveSchemaVersion: number;
		commander: Record<string, unknown>;
	};
	expect(raw.saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
	// An empty journal is written rather than omitted. The omission was what
	// made the wire shape depend on whether the player had accepted anything,
	// and that dependency is what needed two schema versions.
	expect(raw.commander.requests).toEqual({
		byId: {},
		leadsById: {},
		entrustedByLotId: {},
		trackedRequestId: null,
	});
	expect(parseSave(raw)).toEqual(save);
});

test("a schema 3 journal migrates when empty and is refused when it is not", () => {
	// 3 is a shipped version whose journal never left the DEV flag, so the
	// shipped case is empty and migrates. A populated one was written by the
	// retired fixture trial and cannot be read as #411's shape.
	const v3 = (requests: unknown) => {
		const current = JSON.parse(
			JSON.stringify(
				serializeSave({
					world: newWorld(42),
					commander: newCommanderRecord("courier"),
				}),
			),
		);
		const { integrity, ...body } = current;
		body.saveSchemaVersion = 3;
		body.commander.state.ownedEquipment = [];
		delete body.commander.state.loadout;
		delete body.commander.sweepReadings;
		delete body.commander.firstDay;
		delete body.commander.ladders;
		delete body.commander.flight.rates;
		delete body.commander.txSeq;
		body.commander.requests = requests;
		return { ...body, integrity: fnv1a(JSON.stringify(body)) };
	};
	expect(
		parseSave(v3({ byId: {}, leadsById: {}, trackedRequestId: null })).commander
			.requests.byId,
	).toEqual({});
	expect(() =>
		parseSave(
			v3({
				byId: { "request-v1/0/0/station-trade/relay": { offerId: "x" } },
				leadsById: {},
				trackedRequestId: null,
			}),
		),
	).toThrow("retired fixture trial");
});

test("a journal of retired fixture evidence is refused by name, not dropped", () => {
	// #437 let a flagged DEV session write `ui-fixture` stages into an ordinary
	// Commander. The refusal has to name that, rather than the generic shape
	// message a re-derived validator would produce.
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	commander.requests = flyCourier(commander.requests).state;
	const raw = JSON.parse(JSON.stringify(serializeSave({ world, commander })));
	const row = raw.commander.requests.byId[LIVE.courier.id];
	row.evidence = [{ ...row.evidence[0], source: "ui-fixture" }];
	const { integrity, ...body } = raw;
	expect(() =>
		parseSave({ ...body, integrity: fnv1a(JSON.stringify(body)) }),
	).toThrow("ui-fixture");
});

test("a schema 2 record carrying a requests key is refused, empty or not", () => {
	// Both arms, because the guard is on the key's presence and a fresh record
	// now carries an empty container. Naming only the populated case would
	// describe a stricter check than the one that exists; running only the
	// empty case would leave the case a player could actually have uncovered.
	for (const save of [
		{ world: newWorld(42), commander: newCommanderRecord("courier") },
		paidTrial(),
	]) {
		const raw = JSON.parse(JSON.stringify(serializeSave(save)));
		const { integrity, ...body } = raw;
		body.saveSchemaVersion = 2;
		body.commander.state.ownedEquipment = [];
		delete body.commander.state.loadout;
		delete body.commander.sweepReadings;
		const grafted = { ...body, integrity: fnv1a(JSON.stringify(body)) };
		expect(() => parseSave(grafted)).toThrow(
			'saveSchemaVersion 2 cannot contain "requests"',
		);
	}
});

test("a journal survives the save, the reload and a galaxy switch", async () => {
	const backend = memorySaveBackend();
	const save = paidTrial();
	const store = new SaveStore({
		backend,
		locks: memorySlotLocks(),
		slot: "normal",
		schedule: () => () => {},
		current: () => save,
	});
	await store.flush("quit");
	const reloaded = await store.load("normal");
	expect(Object.keys(reloaded.commander.requests.byId)).toEqual(
		Object.keys(save.commander.requests.byId),
	);
	// **One `WorldState` holds all eight galaxies** (`world-state.ts`'s
	// `galaxies: GalaxyEnvelope[]`, and the map's constraint that a galaxy is a
	// namespace rather than a regeneration), so a switch is exactly this: the
	// same world, a different `galaxyIndex`. The record below is one the game
	// can produce.
	expect(reloaded.world.galaxies.length).toBeGreaterThan(1);
	const moved = {
		world: reloaded.world,
		commander: { ...reloaded.commander, galaxyIndex: 1 },
	};
	const after = parseSave(serializeSave(moved));
	expect(after.commander.galaxyIndex).toBe(1);
	expect(after.commander.requests).toEqual(save.commander.requests);
	// And the requester is still galaxy 0's, which is the property that makes
	// the journal the Commander's rather than the galaxy's: a key carries its
	// own galaxyIndex and the parser validates against that, not against where
	// the ship now is.
	for (const request of Object.values(after.commander.requests.byId))
		expect(request.terms.requester.galaxyIndex).toBe(0);
});

/**
 * A settled courier run **and** a retained lead, so a migration row reaches
 * both arrays the journal holds.
 *
 * The lead is the same station's *next* episode rather than another station's
 * offer: `offerId` is keyed on the episode, so `settled: { courier: 1 }` binds
 * a distinct offer without walking the galaxy a second time and without the
 * two sharing an id.
 */
const paidTrialWithLead = () => {
	const trial = paidTrial();
	const next = firstOffer(SAVE_SYSTEMS, "courier", {
		settled: { courier: 1 },
	});
	const retained = requestAction(
		trial.commander.requests,
		next.offers,
		"retain",
		next.offer.id,
		requestCtx(next.offer.requester),
	);
	if (!retained.ok) throw new Error(`retain: ${retained.message}`);
	trial.commander.requests = retained.state;
	trial.commander.state = {
		...trial.commander.state,
		loadout: migrateEquipment(trial.commander.state.hull, []).loadout,
	};
	return trial;
};

/** A body's integrity, recomputed the way `serializeSave` computes it. */
const sealed = (body: Record<string, unknown>) => ({
	...body,
	integrity: fnv1a(JSON.stringify(body)),
});

/**
 * Today's record written back as version 4: the operand flattened onto the
 * offer, which is the shape every shipped v4 save carries.
 *
 * **Read what this is and is not, because the first version of this comment
 * overclaimed it.** Every field but three comes from `serializeSave`, so the
 * envelope, the journal's containers and the rest of an offer cannot drift
 * from what the game writes. The **v4-ness** — flattening the operand back
 * onto the offer — is authored here, and it is the exact inverse of `lift`.
 * So the row below proves those two agree; it is not an archaeological v4
 * save, and nothing in this repo is. A genuine drift in what v4 *was* is
 * therefore outside what it can catch.
 *
 * What makes the inverse the right shape is not this helper's word for it:
 * version 5 changed these three fields and nothing else, which is what the
 * re-serialize row pins — a lifted v4 record and a native v5 one are the same
 * structure, so no fourth key is invented or dropped on the way through. Read
 * that as *structure* and not as bytes: it is a `toEqual`, which is blind to
 * key order, and `integrity` — the one field that is order-sensitive — is
 * destructured away on both sides before the comparison. An earlier version of
 * this sentence said "every byte", which the row does not check.
 */
const asV4 = (
	save: ReturnType<typeof paidTrialWithLead>,
	{ keepOperand = false } = {},
) => {
	const raw = JSON.parse(JSON.stringify(serializeSave(save)));
	const { integrity: _, ...body } = raw;
	body.saveSchemaVersion = 4;
	body.commander.state.ownedEquipment = [];
	delete body.commander.state.loadout;
	delete body.commander.sweepReadings;
	delete body.commander.firstDay;
	delete body.commander.ladders;
	delete body.commander.flight.rates;
	delete body.commander.txSeq;
	const offers = [
		...Object.values(
			body.commander.requests.byId as Record<string, { terms: JobOffer }>,
		).map((r) => r.terms),
		...Object.values(
			body.commander.requests.leadsById as Record<string, JobOffer>,
		),
	] as unknown as Record<string, unknown>[];
	if (offers.length < 2) throw new Error("the v4 fixture reaches one array");
	for (const offer of offers) {
		const operand = offer.operand as Record<string, unknown>;
		offer.goodName = operand.goodName;
		offer.tonnes = operand.tonnes;
		offer.entrusted = operand.entrusted;
		if (!keepOperand) delete offer.operand;
	}
	return sealed(body);
};

test("a schema 4 journal lifts its flat cargo fields into an operand", () => {
	const save = paidTrialWithLead();
	// The lift reaches every well-formed v4 offer, because every v4 family is
	// a courier or a procurement job and both move cargo. It is not a claim
	// that a v4 load cannot throw — the row two below is the one thing it
	// refuses, and it is asserted there. A row that
	// sampled one offer would not say that — this one reads the settled
	// request and the retained lead.
	expect(parseSave(asV4(save))).toEqual(save);
});

test("a lifted schema 4 record re-serializes as a native current version", () => {
	// **The flat keys have to be removed, not merely superseded.** `offerOf`
	// copies the validated offer by spread, so a `goodName` left beside the
	// operand rides through the load and out into the next write — a v5 record
	// carrying v4's fields, which no version identifies.
	const save = paidTrialWithLead();
	const { integrity: _native, ...native } = JSON.parse(
		JSON.stringify(serializeSave(save)),
	);
	const { integrity: _lifted, ...lifted } = JSON.parse(
		JSON.stringify(serializeSave(parseSave(asV4(save)))),
	);
	expect(lifted).toEqual(native);
});

test("a schema 4 offer carrying an operand is refused by name", () => {
	// The mirror of the schema 2 rule above: a version is readable *and* has a
	// shape, so a v4 record holding v5's field was assembled rather than
	// saved. The refusal names the version and the key, because a generic
	// shape message would send a reader looking at the journal's content.
	expect(() =>
		parseSave(asV4(paidTrialWithLead(), { keepOperand: true })),
	).toThrow('saveSchemaVersion 4 cannot contain "operand"');
});

test("a v4 offer keyed __proto__ is refused, not silently dropped", () => {
	// **The guard on the lift's row containers, given something to catch.**
	// `JSON.parse` makes `__proto__` an own key, so `Object.entries` yields it
	// and assigning it on an ordinary object reaches `Object.prototype`'s
	// setter: the offer would leave the migration having never been stored,
	// and the journal would load one request short with nothing said. With a
	// null prototype it is stored, reaches `parseRequests`, and is refused for
	// what is actually wrong with it — its id does not match its key.
	//
	// Swap `Object.create(null)` for `{}` in `migrateV4Requests` and this row
	// goes red while every other row in the file stays green, which is the
	// only way to tell the two apart.
	const save = paidTrialWithLead();
	const v4 = asV4(save) as unknown as {
		commander: { requests: { byId: Record<string, unknown> } };
	};
	const [only] = Object.values(v4.commander.requests.byId);
	// **Built as text, because an object literal cannot express this.**
	// `{ __proto__: x }` sets the prototype rather than an own key — it is the
	// one spelling JavaScript treats specially — so the key has to arrive the
	// way a save's does, through `JSON.parse`.
	const rows = JSON.stringify(v4.commander.requests.byId);
	v4.commander.requests.byId = JSON.parse(
		`{"__proto__":${JSON.stringify(only)}${rows === "{}" ? "" : `,${rows.slice(1, -1)}`}}`,
	);
	expect(Object.hasOwn(v4.commander.requests.byId, "__proto__")).toBe(true);
	const { integrity: _, ...body } = v4 as Record<string, unknown>;
	expect(() => parseSave(sealed(body))).toThrow("invalid Requests journal");
});
