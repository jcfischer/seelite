import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fnv1a } from "../src/rng";
import {
	newWorld,
	serializeWorld,
	parseWorld,
	advanceTo,
} from "../src/world-state";
import {
	newCommanderRecord,
	serializeSave,
	parseSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";

function hash<T extends Record<string, unknown>>(
	raw: T,
): T & { integrity: number } {
	const { integrity, ...body } = raw;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) } as T & {
		integrity: number;
	};
}
function legacyWorld() {
	const raw = serializeWorld(advanceTo(newWorld(47), 6000)) as any;
	raw.worldSchemaVersion = 3;
	raw.worldGeneratorVersion = 10;
	for (const g of raw.galaxies) delete g.capabilityTime;
	return hash(raw);
}

test("legacy nested and outer hashes are checked before the explicit timing migration", () => {
	const oldWorld = legacyWorld();
	const commander = newCommanderRecord("courier", { permadeath: true });
	const raw = hash({
		...serializeSave({ world: parseWorld(oldWorld), commander }),
		saveSchemaVersion: 17,
		world: oldWorld,
	});
	const original = JSON.stringify(raw);
	const loaded = parseSave(raw);
	expect(SAVE_SCHEMA_VERSION).toBe(19);
	expect(loaded.world.worldSchemaVersion).toBe(4);
	expect(loaded.world.worldGeneratorVersion).toBe(11);
	expect(
		loaded.world.galaxies.every(
			(g) =>
				g.capabilityTime.genesisAt === 6000 &&
				Object.keys(g.capabilityTime.anchors).length === 0,
		),
	).toBe(true);
	expect(loaded.commander.state).toEqual(commander.state);
	expect(JSON.stringify(raw)).toBe(original);
	const rewritten = serializeSave(loaded);
	expect(parseSave(rewritten)).toEqual(loaded);
	const innerBad = hash({
		...raw,
		world: { ...oldWorld, integrity: oldWorld.integrity ^ 1 },
	});
	const badOriginal = JSON.stringify(innerBad);
	expect(() => parseSave(innerBad)).toThrow("snapshot: integrity");
	expect(JSON.stringify(innerBad)).toBe(badOriginal);
	expect(() =>
		parseWorld({ ...oldWorld, integrity: oldWorld.integrity ^ 1 }),
	).toThrow("snapshot: integrity");
	expect(() => parseSave({ ...raw, integrity: raw.integrity ^ 1 })).toThrow(
		"integrity",
	);
});

test("current timing cannot hide inside an old world or carry malformed anchors", () => {
	const old = legacyWorld() as any;
	old.galaxies[0].capabilityTime = { genesisAt: 0, anchors: {} };
	expect(() => parseWorld(hash(old))).toThrow("legacy world");
	const current = serializeWorld(newWorld(47)) as any;
	current.galaxies[0].capabilityTime.anchors[
		"0:station-trade/capability/market"
	] = { at: 0, cycle: 0, phase: "up", left: -1, repaired: false };
	expect(() => parseWorld(hash(current))).toThrow();
	const missing = serializeWorld(newWorld(47)) as any;
	delete missing.galaxies[0].capabilityTime;
	expect(() => parseWorld(hash(missing))).toThrow("missing");
});

test("partial version lifts cannot launder new timing into a legacy envelope", () => {
	const legacy = legacyWorld();
	expect(() =>
		parseWorld(hash({ ...legacy, worldGeneratorVersion: 11 })),
	).toThrow("incompatible");
	const current = serializeSave({
		world: newWorld(47),
		commander: newCommanderRecord("courier", { permadeath: true }),
	});
	expect(() => parseSave(hash({ ...current, saveSchemaVersion: 17 }))).toThrow(
		"incompatible",
	);
	expect(() => parseSave(hash({ ...current, world: legacy }))).toThrow(
		"incompatible",
	);
});

test("a saved repair suppression cannot appear without attributable restore history", async () => {
	const W = await import("../src/world-state");
	const w = W.newWorld(47);
	const c = [...W.enumerateCarriers(47, 0)].find(
		(c) =>
			c.kind === "capability" &&
			!W.capabilityAvailability(w, 0, c.key).operational,
	)!;
	const raw = W.serializeWorld(w) as any;
	raw.galaxies[0].capabilityTime.anchors[c.key] = {
		...W.capabilityAvailability(w, 0, c.key).state,
		repaired: true,
	};
	expect(() => W.parseWorld(hash(raw))).toThrow("restore");
});

test("zero-prefixed aliases cannot create a second anchor for one generated capability", async () => {
	const W = await import("../src/world-state");
	const C = await import("../src/capability-slots");
	const w = W.newWorld(47);
	const c = [...W.enumerateCarriers(47, 0)].find(
		(c) => c.kind === "capability",
	)!;
	const alias = `0${c.key}` as typeof c.key;
	expect(() => C.capabilityIdentity(47, 0, alias)).toThrow();
	const raw = W.serializeWorld(w) as any;
	const state = W.capabilityAvailability(w, 0, c.key).state;
	raw.galaxies[0].capabilityTime.anchors = { [c.key]: state, [alias]: state };
	expect(() => W.parseWorld(hash(raw))).toThrow();
});

test("retained raider causality requires complete current capability anchors", async () => {
	const W = await import("../src/world-state");
	const carriers = [...W.enumerateCarriers(47, 0)];
	const raider = carriers.find((c) => c.kind === "raider")!;
	const cap = carriers.find(
		(c) => c.kind === "capability" && c.systemIndex === raider.systemIndex,
	)!;
	const w = W.applyTransition(W.newWorld(47), 0, raider.key, {
		kind: "disable",
		occurredAt: 1000,
		cause: { causeKind: "test", actorId: "test", playerRole: "direct" },
	});
	expect(() => W.operationalDuration(w, 0, cap.key, 0, 1000)).toThrow();
	const missing = W.serializeWorld(w) as any;
	delete missing.galaxies[0].capabilityTime.anchors[cap.key];
	expect(() => W.parseWorld(hash(missing))).toThrow("retained");
	const stale = W.serializeWorld(w) as any;
	stale.galaxies[0].capabilityTime.anchors[cap.key] = W.capabilityAvailability(
		W.newWorld(47),
		0,
		cap.key,
	).state;
	expect(() => W.parseWorld(hash(stale))).toThrow("retained");
	const legacy = W.serializeWorld(w) as any;
	legacy.worldSchemaVersion = 3;
	legacy.worldGeneratorVersion = 10;
	for (const env of legacy.galaxies) delete env.capabilityTime;
	const lifted = W.parseWorld(hash(legacy));
	expect(lifted.galaxies[0].capabilityTime.genesisAt).toBe(1000);
	expect(lifted.galaxies[0].capabilityTime.anchors).toEqual({});
	expect(() => W.operationalDuration(lifted, 0, cap.key, 0, 1000)).toThrow();
	expect(W.parseWorld(W.serializeWorld(w))).toEqual(w);
});

test("an immutable actual a107a16 save preserves its ordinary state through migration", () => {
	const bytes = readFileSync(
		new URL("./fixtures/capability-legacy-save-a107a16.json", import.meta.url),
		"utf8",
	);
	expect(fnv1a(bytes)).toBe(4146703671);
	const raw = JSON.parse(bytes);
	const original = JSON.stringify(raw);
	expect([
		raw.saveSchemaVersion,
		raw.world.worldSchemaVersion,
		raw.world.worldGeneratorVersion,
	]).toEqual([17, 3, 10]);
	const loaded = parseSave(raw);
	expect(JSON.stringify(raw)).toBe(original);
	expect(loaded.commander.state.credits).toBe(4321);
	expect(loaded.commander.state.cargo).toEqual({ Food: 3 });
	expect(loaded.world.galaxies[0].objective).toEqual(
		raw.world.galaxies[0].objective,
	);
	expect(loaded.world.galaxies[0].episodes).toEqual(
		raw.world.galaxies[0].episodes,
	);
	expect(loaded.world.galaxies[0].knowledge).toEqual(
		raw.world.galaxies[0].knowledge,
	);
	expect(
		loaded.world.galaxies.every(
			(g) =>
				g.capabilityTime.genesisAt === 1000 &&
				Object.keys(g.capabilityTime.anchors).length === 0,
		),
	).toBe(true);
	expect(parseSave(serializeSave(loaded))).toEqual(loaded);
});
