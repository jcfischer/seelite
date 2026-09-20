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
