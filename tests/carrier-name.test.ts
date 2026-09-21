/**
 * The two halves of a carrier's name (`carrier-identity.md` §1, F3; `H1` of
 * `civilian-combat.md`), and the rows §9 owes for them.
 *
 * **The goldens are the point of this file, not a byproduct.** A name, a
 * registry and the hash under both are the three things a later refactor can
 * move without noticing: they are display, so nothing else reads them, and a
 * silent change is a whole galaxy re-named. They are pinned as literals, and
 * `fnv1a`'s own value is pinned beside them because the roster is built from
 * it and the hash arrived here from two separate private copies.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	carrierName,
	HULL_MODEL_NAME,
	raiderRegistry,
	trafficRegistry,
} from "../src/carrier-name";
import { DOMAIN } from "../src/domains";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { SYSTEM_NAME_MAX_CHARS } from "../src/names";
import { raiderSlots } from "../src/raider-slots";
import { fnv1a } from "../src/rng";
import { stationTrafficRoster } from "../src/station-traffic";
import { generateContents } from "../src/system";
import { codeOf } from "./lib/source-scan";

const SEED = 0x5ee11e;
const lane = (n: number) =>
	`station-trade/traffic-${String(n).padStart(2, "0")}`;

describe("the drawn name", () => {
	test("is deterministic across a process boundary", () => {
		// Literal expectations, because a value computed here and compared to
		// itself proves only that the function is a function. These are what
		// this seed draws; a change to the seed terms, the domain tag or the
		// digram table is a change to every carrier's name in the game, and it
		// has to be a deliberate one.
		expect(carrierName(SEED, carrierKey(5, lane(0)), 0)).toBe("DISOLA");
		expect(carrierName(SEED, carrierKey(5, lane(1)), 0)).toBe("CEBELEQU");
		expect(carrierName(SEED, carrierKey(5, lane(7)), 0)).toBe("ORINEDED");
		// And the same call twice, which is the half a golden cannot see: no
		// hidden counter, no draw order, no cached stream.
		const key = carrierKey(5, lane(3));
		expect(carrierName(SEED, key, 0)).toBe(carrierName(SEED, key, 0));
	});

	test("is pinned to the hash it is drawn from", () => {
		// `fnv1a` was copied twice — once private in `station-traffic.ts`, once
		// exported from the save model — and is now a single leaf function. A
		// byte for byte it is the same hash, which is what lets a carrier keep
		// its name through the move; these are its inputs, not a reimplementation.
		expect(fnv1a("")).toBe(2166136261);
		expect(fnv1a("5:station-trade/traffic-00")).toBe(999319262);
	});

	test("is drawn independently, so a conditional carrier moves no other name", () => {
		// §1's hazard: roster size is conditional on the berth catalogue, on
		// government and on which station types generated, so a name drawn from
		// a stream consumed in roster order shifts for every carrier after the
		// one that is absent — `domains.ts`'s recorded hazard, and the reason
		// `STATION_NAME` has per-slot sub-streams.
		//
		// Two arms are the draw run in another order and one carrier at a time;
		// the third is what the ordered pass this draw exists to escape *would*
		// have produced, so the row cannot go green for the wrong reason.
		const keys = Array.from({ length: 24 }, (_, i) => carrierKey(3, lane(i)));
		const name = (key: (typeof keys)[number]) => carrierName(SEED, key, 0);
		const forward = keys.map(name);
		expect([...keys].reverse().map(name).reverse()).toEqual(forward);
		expect(keys.map((key) => carrierName(SEED, key, 0))).toEqual(forward);
		// Seeding on the position rather than the identity, which is the defect:
		// every name after the first moves when the first carrier is absent.
		const ordered = keys.map((key, i) => carrierName(SEED + i, key, 0));
		expect(ordered.slice(1)).not.toEqual(forward.slice(1));
	});

	test("is a different name in a different galaxy", () => {
		// The key is envelope-relative, so the system seed is the only term that
		// carries the galaxy. Same key, two systems: this row is what proves the
		// seed was not bypassed.
		const key = carrierKey(5, lane(0));
		expect(carrierName(0x1a2b, key, 0)).not.toBe(carrierName(0x3c4d, key, 0));
	});

	test("belongs to the instance, so a replacement is a new ship", () => {
		// H1: a killed Porter does not come back wearing its own name.
		const key = carrierKey(5, lane(0));
		expect(carrierName(SEED, key, 1)).not.toBe(carrierName(SEED, key, 0));
		expect(carrierName(SEED, key, 1)).toBe("ISEREN");
	});

	test("is a name the display can lay out", () => {
		// The draw is the system-name digram draw, so the bound the instruments
		// are laid out against is this module's bound too — a carrier name is on
		// the Target panel, which has no room for a long word.
		for (let i = 0; i < 400; i++) {
			const name = carrierName(SEED, carrierKey(1, lane(i)), 0);
			expect(name.length).toBeGreaterThanOrEqual(2);
			expect(name.length).toBeLessThanOrEqual(SYSTEM_NAME_MAX_CHARS);
			expect(name).toMatch(/^[A-Z]+$/);
		}
	});

	test("has a stream of its own, apart from the standing's", () => {
		// A name read from the standing's stream would move every time the
		// standing's rotation was retuned, and a name a pilot remembers cannot
		// move under them. The tag is the guarantee, so it is pinned.
		expect(DOMAIN.CARRIER_NAME).not.toBe(DOMAIN.CARRIER_STANDING);
		expect(DOMAIN.CARRIER_NAME).not.toBe(DOMAIN.CARRIER_MANIFEST);
	});
});

describe("the registry", () => {
	test("composes model, role code and one-based ordinal", () => {
		// Byte-identical to what `station-traffic.ts` built inline before this
		// moved here — which is the whole claim of the move.
		expect(trafficRegistry("freighter", "TR", 2)).toBe("Porter TR-03");
		expect(trafficRegistry("courier", "OP", 0)).toBe("Kestrel OP-01");
		expect(trafficRegistry("tug", "RF", 9)).toBe("Towline RF-10");
	});

	test("names a raider slot by its ordinal", () => {
		expect(raiderRegistry(0)).toBe("Raider 01");
		expect(raiderRegistry(11)).toBe("Raider 12");
	});

	test("every hull has a model name", () => {
		// A missing row would print `undefined TR-01` on the panel, and the
		// roster is the only thing that reaches every hull in the game.
		expect(Object.keys(HULL_MODEL_NAME).sort()).toEqual(
			Object.keys(HULL_SPECS).sort(),
		);
	});

	test("is what the shipped roster still registers as", () => {
		// The roster is the real thing, generated: this pins the callsigns a
		// player has already seen, across every station of the first systems.
		const galaxy = generateGalaxy(SEED, 0);
		const rows: [string, string][] = [];
		for (const record of galaxy.systems.slice(0, 3))
			for (const station of generateContents(record).stations)
				for (const actor of stationTrafficRoster(record.index, station).slice(
					0,
					3,
				))
					rows.push([actor.callsign, carrierName(record.seed, actor.key, 0)]);
		expect(rows.slice(0, 7)).toEqual([
			["Porter TR-01", "RIEDBIRA"],
			["Porter TR-02", "EDBIOR"],
			["Towline TR-03", "QUALA"],
			["Longwall RF-01", "XEORZAZA"],
			["Prospector RF-02", "CEERARTI"],
			["Prospector RF-03", "MADI"],
			["Porter TR-01", "CEMAXERA"],
		]);
	});

	test("a raider slot keys into the same draw", () => {
		// The scheme is one scheme: a raider's registry is composed here and its
		// drawn name comes from the same function, over the slot's own key.
		const [slot] = raiderSlots(5, 0);
		const name = carrierName(SEED, slot.key, 0);
		expect(name).toMatch(/^[A-Z]{2,8}$/);
		expect(name).toBe(carrierName(SEED, carrierKey(5, "raider-00"), 0));
	});
});

describe("identity is not a name", () => {
	test("nothing that persists reads either string", () => {
		// F3, on #109's rule. The roster's `localCarrierId` and `key` are built
		// from the station's id and the ordinal, and the registry is derived
		// beside them — so a rename orphans no market memory. Checked at the
		// source, because a save that stored a name would look exactly like this.
		expect(codeOf("src/world-state.ts")).not.toContain("carrier-name");
		expect(codeOf("src/save-envelope.ts")).not.toContain("carrier-name");
		const record = generateGalaxy(SEED, 0).systems[0];
		const [actor] = stationTrafficRoster(
			record.index,
			generateContents(record).stations[0],
		);
		expect(actor.localCarrierId).toBe("station-trade/traffic-00");
		expect(actor.key).toBe(carrierKey(record.index, actor.localCarrierId));
	});
});
