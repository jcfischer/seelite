import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { fixtureOffers, requestAction } from "../src/requests-prototype";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { newWorld, fnv1a } from "../src/world-state";
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

test("normal catalog refuses trial imports atomically in either record", async () => {
	const backend = memorySaveBackend();
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	const trial = serializeSave(paidTrial());
	const normal = serializeSave({
		world: newWorld(42),
		commander: newCommanderRecord("courier"),
	});
	for (const records of [
		{ live: trial, lastDocked: normal },
		{ live: normal, lastDocked: trial },
	]) {
		await expect(
			catalog.importSlot("trial", JSON.stringify(records)),
		).rejects.toThrow("Requests prototype");
		expect(await catalog.slots()).toEqual([]);
		expect(backend.writes).toBe(0);
	}
});

test("normal store refuses trial reads and writes without changing stored data", async () => {
	const backend = memorySaveBackend();
	const normal = serializeSave({
		world: newWorld(42),
		commander: newCommanderRecord("courier"),
	});
	await backend.write("normal", "live", normal);
	await backend.write("trial", "live", serializeSave(paidTrial()));
	const store = new SaveStore({
		backend,
		locks: memorySlotLocks(),
		slot: "normal",
		schedule: () => () => {},
		current: paidTrial,
	});
	await expect(store.load("trial")).rejects.toThrow("Requests prototype");
	await expect(store.flush("quit")).rejects.toThrow("Requests prototype");
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	expect(() => catalog.parseRecord(serializeSave(paidTrial()))).toThrow(
		"Requests prototype",
	);
	const docked = serializeSave(paidTrial());
	await backend.write("normal", "lastDocked", docked);
	await expect(store.revertToLastDocked({ permadeath: false })).rejects.toThrow(
		"Requests prototype",
	);
	expect(await backend.read("normal", "live")).toEqual(normal);
});

test("explicit trial catalog and store retain paid experiment imports and persistence", async () => {
	const backend = memorySaveBackend();
	const locks = memorySlotLocks();
	const catalog = new CommanderCatalog({
		backend,
		locks,
		allowRequestsPrototype: true,
	});
	const save = paidTrial();
	await catalog.importSlot(
		"trial",
		JSON.stringify({ live: serializeSave(save) }),
	);
	const store = new SaveStore({
		backend,
		locks,
		slot: "trial",
		allowRequestsPrototype: true,
		schedule: () => () => {},
		current: () => save,
	});
	await store.flush("quit");
	expect(await store.load("trial")).toEqual(save);
	expect(catalog.parseRecord(await backend.read("trial", "live"))).toEqual(
		save,
	);
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
	expect(SAVE_SCHEMA_VERSION).toBe(2);
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

test("normal Commander writes keep schema 2 and its journal-free wire shape", () => {
	const save = {
		world: newWorld(42),
		commander: newCommanderRecord("courier"),
	};
	const raw = serializeSave(save) as {
		saveSchemaVersion: number;
		commander: Record<string, unknown>;
	};
	expect(raw.saveSchemaVersion).toBe(2);
	expect(raw.commander.requests).toBeUndefined();
	expect(parseSave(raw)).toEqual(save);
});
