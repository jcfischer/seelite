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
import { newWorld, setDeficits, visit } from "../src/world-state";

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
		},
	};
};

describe("#89 D5 — the save envelope", () => {
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
		const stale = { ...raw, saveSchemaVersion: SAVE_SCHEMA_VERSION - 1 };
		expect(() => parseSave(stale)).toThrow(/saveSchemaVersion/);
		// **Proven non-destructive, not merely proven to throw** (#89's wording).
		// The refusal is the only path by which a player can still export the
		// save, so a parser that normalised in place would destroy it.
		expect(raw).toEqual(before);
		expect(() => parseSave(raw)).not.toThrow();
	});

	test("obligation 5: truncation and graft fail distinguishably", () => {
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
