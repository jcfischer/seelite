/**
 * #89's D5: a save is `{ world, commander }` under **one** integrity hash.
 *
 * The obligations here are that node's, numbered as it numbered them: the
 * round trip across the commander boundary (1), the hash spanning both halves
 * so a graft fails (2), version refusal that leaves the record readable (4),
 * and truncation/graft failing distinguishably rather than reading as absent
 * rows (5).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { carrierKey } from "../src/carrier-key";
import { recordTrade } from "../src/deficits";
import { HOLD_REFERENCE_T } from "../src/market";
import {
	type CommanderRecord,
	newCommanderRecord,
	parseSave,
	SAVE_SCHEMA_VERSION,
	serializeSave,
} from "../src/save-envelope";
import { LOCAL_CARRIER_ID } from "../src/station";
import { restoreWorld } from "../src/sim";
import {
	enumerateCarriers,
	newWorld,
	setDeficits,
	visit,
	WORLD_GENERATOR_VERSION,
} from "../src/world-state";

const SEED = 0x5ee11e;
const KEY = carrierKey(3, LOCAL_CARRIER_ID.trade);

/** A world with something in it, so an absent row and a dropped row differ. */
const world = () => {
	const w = visit(newWorld(SEED), 0, 3);
	return setDeficits(
		w,
		0,
		recordTrade({}, KEY, {
			goodName: "Food",
			units: 20,
			gameTimeMin: 100,
			holdT: HOLD_REFERENCE_T,
		}),
		6000,
	);
};

/** A commander who has been somewhere and bought something. */
const commander = (): CommanderRecord => {
	const base = newCommanderRecord("courier", { permadeath: true });
	return {
		...base,
		state: { ...base.state, credits: 742, cargo: { Food: 11 } },
		galaxyIndex: 0,
		systemIndex: 3,
		dockedAt: KEY,
		chargeAu: 7.5,
		flight: {
			pos: [1, 2, 3],
			vel: [-0.5, 0, 0.25],
			orientation: [0, 0, 0, 1],
			regime: "cruise",
			throttle: 1,
			rates: [0.1, -0.2, 0.3],
		},
	};
};

describe("#89 D5 — the save envelope", () => {
	test("a version-7 docked save retains its shipyard key and deficit after host relocation", () => {
		// Serialized by the unmodified version-7 code from a dock-consistent
		// state before #590. System 92's
		// shipyard orbited planet-4 then; the new host is planet-2. The saved
		// deficit and dockedAt both name the carrier key, never its old position.
		// This checks parse/migration and the regenerated host, not Game's
		// load-time ship placement.
		const raw = JSON.parse(
			readFileSync(
				new URL(
					"./fixtures/save-generator-v7-relocated-shipyard.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		expect(raw.world.worldGeneratorVersion).toBe(7);
		const loaded = parseSave(raw);
		const key = carrierKey(92, LOCAL_CARRIER_ID.shipyard);
		expect(raw.commander.ladders.visited[0].systems).toContain(92);
		expect(raw.commander.ladders.visited[0].stations).toContain(key);
		expect(loaded.world.worldGeneratorVersion).toBe(WORLD_GENERATOR_VERSION);
		expect(loaded.commander.dockedAt).toBe(key);
		expect(loaded.commander.ladders.visited[0]?.stations).toContain(key);
		expect(loaded.world.galaxies[0].deficits[key]).toBeDefined();
		const restored = restoreWorld(47, 0, 92, loaded.world.gameTime);
		const shipyard = restored.system.contents.stations.find(
			(station) => station.localCarrierId === LOCAL_CARRIER_ID.shipyard,
		);
		expect(shipyard?.id).toBe(LOCAL_CARRIER_ID.shipyard);
		expect(shipyard?.parentId).toBe("planet-2");
	});

	test("obligation 1: every field of both halves survives a round trip", () => {
		const save = { world: world(), commander: commander() };
		const back = parseSave(serializeSave(save));
		expect(back.commander).toEqual(save.commander);
		expect(back.world.gameTime).toBe(6000);
		expect(back.world.galaxies[0].visited).toEqual([3]);
		expect(back.world.galaxies[0].deficits[KEY]?.goods.Food).toBeCloseTo(
			20,
			10,
		);
	});

	test("obligation 2: the hash spans both halves, so a graft fails", () => {
		const a = serializeSave({ world: world(), commander: commander() }) as {
			world: unknown;
			commander: unknown;
		};
		const other = { ...commander(), credits: 1, chargeAu: 0.5 };
		const b = serializeSave({ world: world(), commander: other }) as {
			commander: unknown;
		};
		// Each half loads on its own. It is the *pair* that is refused — which
		// is the only thing that makes D5's one-hash-over-two-halves mean
		// anything, and a per-half hash would permit exactly this.
		expect(() => parseSave({ ...a, commander: b.commander })).toThrow(
			/integrity/i,
		);
		expect(() => parseSave(a)).not.toThrow();
	});

	test("obligation 4: a version mismatch refuses, and the record is untouched", () => {
		const raw = serializeSave({
			world: world(),
			commander: commander(),
		}) as Record<string, unknown>;
		const before = structuredClone(raw);
		const stale = { ...raw, saveSchemaVersion: 999 };
		expect(() => parseSave(stale)).toThrow(/saveSchemaVersion/);
		// **Proven non-destructive, not merely proven to throw** (#89's wording).
		// The refusal is the only path by which a player can still export the
		// save, so a parser that normalised in place would destroy it.
		expect(raw).toEqual(before);
		expect(() => parseSave(raw)).not.toThrow();
	});

	test("a save holding a version-6 world loads, and the record is untouched (#351)", () => {
		// The player's path to the generator migration: the envelope's hash is
		// over the version-6 body as stored, and the relabel happens on a copy.
		const w = world();
		w.worldGeneratorVersion = 6;
		const raw = serializeSave({ world: w, commander: commander() }) as {
			world: { worldGeneratorVersion: number };
		};
		const before = structuredClone(raw);
		const loaded = parseSave(raw);
		expect(loaded.world.worldGeneratorVersion).toBe(WORLD_GENERATOR_VERSION);
		expect(loaded.world.galaxies).toEqual(w.galaxies);
		expect(raw).toEqual(before);
		expect(raw.world.worldGeneratorVersion).toBe(6);
	});

	test("obligation 5: truncation and graft fail distinguishably — at the top level", () => {
		// **Named for what it shows.** A *missing half* is caught before the
		// hash and reports which half; a truncation *inside* a half is caught by
		// the hash and reports the checksum, because a 32-bit FNV-1a knows the
		// bytes changed and nothing about how. The message says so rather than
		// naming a graft it cannot establish, which is what it did for a round.
		const raw = serializeSave({
			world: world(),
			commander: commander(),
		}) as Record<string, unknown>;
		const truncated: Record<string, unknown> = { ...raw };
		delete truncated.commander;
		expect(() => parseSave(truncated)).toThrow(/commander/);
		// Not "reads as absent rows": a missing commander is an error, never a
		// fresh one.
		expect(() => parseSave({ ...raw, world: undefined })).toThrow(/world/);
	});

	test("the commander record refuses a hull the roster does not have", () => {
		const raw = serializeSave({
			world: world(),
			commander: commander(),
		}) as Record<string, unknown>;
		const bad = structuredClone(raw) as {
			commander: { state: { hull: string } };
		};
		bad.commander.state.hull = "battlecruiser";
		// The integrity hash catches the edit first; that is the point — but a
		// hand-built record with no hash must still be refused on the field.
		expect(() => parseSave(bad)).toThrow(/integrity|hull/i);
		expect(() =>
			parseSave(
				serializeSave({
					world: world(),
					commander: {
						...commander(),
						state: { ...commander().state, hull: "battlecruiser" as never },
					},
				}),
			),
		).toThrow(/hull/);
	});

	test("the commander record refuses a cargo key that is not a commodity", () => {
		// #443. The quantity was validated and the name was not, so a good the
		// table does not have survived the load and threw the first time
		// anything asked what unit it was in — which since the hold projection
		// is every console update while docked. Refused at the boundary, the
		// way the hull two rows above is.
		expect(() =>
			parseSave(
				serializeSave({
					world: world(),
					commander: {
						...commander(),
						state: { ...commander().state, cargo: { Unobtainium: 3 } },
					},
				}),
			),
		).toThrow(/is not a commodity/);
		// The control: the same shape with a real good loads.
		expect(() =>
			parseSave(
				serializeSave({
					world: world(),
					commander: {
						...commander(),
						state: { ...commander().state, cargo: { Textiles: 3 } },
					},
				}),
			),
		).not.toThrow();
	});

	test("obligation 3: the save's size is bounded by the carrier count", () => {
		// #89's obligation 3, and **the count is the load-bearing half**: a
		// generator change that collided two carrier keys would shrink the store
		// while every byte figure still looked healthy, and `parseWorld` cannot
		// see it — a collided row is a perfectly well-formed row that happens to
		// have overwritten another.
		//
		// **This is the one-galaxy tier, not T1.** Saturating all eight takes
		// about a minute, which is not a thing to put on every push; the
		// saturated ceiling is `scripts/measure-save-size.ts`'s and is run by
		// hand. Which half is gated and which is an instrument is stated here
		// rather than left for a reader to infer (the map's constraint from
		// #28).
		let w = newWorld(SEED);
		const keys = [...enumerateCarriers(SEED, 0)].map((c) => c.key);
		const env = w.galaxies[0];
		for (const key of keys)
			env.deficits[key] = { goods: { Food: -63.4 }, updatedAt: 0 };
		w = { ...w, galaxies: w.galaxies.map((e, i) => (i === 0 ? env : e)) };
		expect(Object.keys(env.deficits).length).toBe(keys.length);
		const sizeOf = (rows: number) => {
			const cut = { ...env, deficits: {} as typeof env.deficits };
			for (const key of keys.slice(0, rows))
				cut.deficits[key] = { goods: { Food: -63.4 }, updatedAt: 0 };
			return JSON.stringify(
				serializeSave({
					world: {
						...w,
						galaxies: w.galaxies.map((e, i) => (i === 0 ? cut : e)),
					},
					commander: commander(),
				}),
			).length;
		};
		// **The size is linear in the row count, which is the claim #89's tiers
		// rest on.** A byte ceiling asserted here would be this test predicting
		// the instrument's answer, and a prediction stated as a measurement is
		// what `economy-trade.md` already got wrong once; the saturated figure
		// belongs to the script and nowhere else. What is checkable without
		// re-running it is the shape: halve the rows, halve the growth.
		const empty = sizeOf(0);
		const half = sizeOf(Math.floor(keys.length / 2)) - empty;
		const full = sizeOf(keys.length) - empty;
		expect(full / half).toBeGreaterThan(1.9);
		expect(full / half).toBeLessThan(2.1);
		const json = JSON.stringify(
			serializeSave({ world: w, commander: commander() }),
		);
		expect(
			parseSave(JSON.parse(json)).world.galaxies[0].deficits[keys[0]],
		).toBeTruthy();
	});

	test("an index that parses but cannot be restored is refused here", () => {
		// `restoreWorld` throws on a galaxy outside 0..7 or a system the galaxy
		// does not have, and the boot builds the game from what `parseSave`
		// returns — so a record that parses and then will not restore is one
		// that kills every boot at that origin. `importSlot` validates a file
		// with `parseSave` and nothing else, which makes an imported file the
		// way in. Finite is not enough.
		const bad = (patch: Record<string, unknown>) =>
			serializeSave({
				world: world(),
				commander: { ...commander(), ...patch } as CommanderRecord,
			});
		expect(() => parseSave(bad({ galaxyIndex: 8 }))).toThrow(/galaxy index/);
		expect(() => parseSave(bad({ galaxyIndex: -1 }))).toThrow(/galaxy index/);
		expect(() => parseSave(bad({ galaxyIndex: 1.5 }))).toThrow(/galaxy index/);
		expect(() => parseSave(bad({ systemIndex: -1 }))).toThrow(/system index/);
		expect(() => parseSave(bad({ systemIndex: 2.5 }))).toThrow(/system index/);
	});

	test("permadeath round-trips, and a new commander defaults to off", () => {
		expect(newCommanderRecord("courier").permadeath).toBe(false);
		const save = {
			world: world(),
			commander: { ...commander(), permadeath: true },
		};
		expect(parseSave(serializeSave(save)).commander.permadeath).toBe(true);
	});

	test("a docked-at that is not a carrier key is refused", () => {
		expect(() =>
			parseSave(
				serializeSave({
					world: world(),
					commander: { ...commander(), dockedAt: carrierKey(3, "") },
				}),
			),
		).toThrow(/carrier key/);
	});
});
