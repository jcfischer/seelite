import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import type { JobOffer } from "../src/jobs";
import { requestAction } from "../src/requests";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	SAVE_SCHEMA_VERSION,
	serializeSave,
} from "../src/save-envelope";
import {
	CommanderCatalog,
	memorySaveBackend,
	memorySlotLocks,
	SaveStore,
} from "../src/save-store";
import { generateContents } from "../src/system";
import { newWorld } from "../src/world-state";
import { firstOffer } from "./helpers/job-board";

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
		(await store.revertToLastDocked({ permadeath: false }))?.commander.requests,
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
	expect(SAVE_SCHEMA_VERSION).toBe(4);
	const { integrity, ...body } = current;
	body.saveSchemaVersion = 2;
	delete body.commander.requests;
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

test("every Commander write is schema 4 and carries its journal", () => {
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
