import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { fixtureOffers, requestAction } from "../src/requests-prototype";
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

const paidTrial = () => {
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	const offers = fixtureOffers(
		0,
		carrierKey(0, "station-trade"),
		"USQULAVE",
		10,
	);
	for (const action of [
		"accept",
		"fixture-search",
		"fixture-identify",
		"fixture-disable",
		"report",
	]) {
		const result = requestAction(
			commander.requests,
			offers,
			action,
			offers[0].id,
			{ now: 20, docked: offers[0].requester, armed: true },
		);
		commander.requests = result.state;
		commander.state.credits += result.rewardCr;
	}
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
	for (const [slot, records] of [
		["live-journal", { live: paid, lastDocked: fresh }],
		["docked-journal", { live: fresh, lastDocked: paid }],
	] as const) {
		await catalog.importSlot(slot, JSON.stringify(records));
		expect(await catalog.slots()).toContain(slot);
		expect(catalog.parseRecord(await backend.read(slot, "live"))).toEqual(
			parseSave(records.live),
		);
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
	const offers = fixtureOffers(
		0,
		carrierKey(0, "station-trade"),
		"USQULAVE",
		10,
	);
	const ctx = { now: 20, docked: offers[0].requester, armed: true };
	for (const action of [
		"accept",
		"track",
		"fixture-search",
		"fixture-identify",
		"fixture-disable",
		"report",
	]) {
		const result = requestAction(
			commander.requests,
			offers,
			action,
			offers[0].id,
			ctx,
		);
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
	expect(SAVE_SCHEMA_VERSION).toBe(3);
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
	const offers = fixtureOffers(
		0,
		carrierKey(0, "station-invented"),
		"Made up",
		10,
	);
	commander.requests = requestAction(
		commander.requests,
		offers,
		"accept",
		offers[0].id,
		{ now: 20, armed: true, docked: offers[0].requester },
	).state;
	expect(() => parseSave(serializeSave({ world, commander }))).toThrow(
		"requester",
	);
});

test("requester labels refresh by CarrierKey without rejecting or changing the stored input", () => {
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	const offers = fixtureOffers(
		0,
		carrierKey(0, "station-trade"),
		"Made up",
		10,
	);
	commander.requests = requestAction(
		commander.requests,
		offers,
		"accept",
		offers[0].id,
		{
			now: 20,
			armed: true,
			docked: offers[0].requester,
		},
	).state;
	const raw = serializeSave({ world, commander });
	const before = JSON.stringify(raw);
	const loaded = parseSave(raw);
	expect(loaded.commander.requests.byId[offers[0].id].terms.requesterName).toBe(
		"USQULAVE",
	);
	expect(loaded.commander.requests.byId[offers[0].id].terms.requester).toEqual(
		offers[0].requester,
	);
	expect(loaded.commander.requests.byId[offers[0].id].terms.rewardCr).toBe(250);
	expect(JSON.stringify(raw)).toBe(before);
});

test("every Commander write is schema 3 and carries its journal", () => {
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
		trackedRequestId: null,
	});
	expect(parseSave(raw)).toEqual(save);
});

test("a schema 2 record carrying a journal is still refused by name", () => {
	const raw = JSON.parse(
		JSON.stringify(
			serializeSave({
				world: newWorld(42),
				commander: newCommanderRecord("courier"),
			}),
		),
	);
	const { integrity, ...body } = raw;
	body.saveSchemaVersion = 2;
	const grafted = { ...body, integrity: fnv1a(JSON.stringify(body)) };
	expect(() => parseSave(grafted)).toThrow(
		"saveSchemaVersion 2 cannot contain a Requests journal",
	);
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
	// The journal is the Commander's, not the galaxy's: a requester is keyed by
	// its own galaxyIndex, so moving the ship does not strand the record.
	const moved = {
		world: reloaded.world,
		commander: { ...reloaded.commander, galaxyIndex: 1 },
	};
	expect(parseSave(serializeSave(moved)).commander.requests).toEqual(
		save.commander.requests,
	);
});
