/**
 * The scan verb and the reading it leaves (`carrier-identity.md` §4, §5, F4,
 * F5, F8, F9, F10, F12).
 *
 * **What this file cannot check.** That the hold *feels* like a cost. §9 gives
 * that row to the principal flying it and to `scripts/measure-carrier-scan.ts`,
 * which prints the cone, the range and the charge beside what they mean in play.
 * Every row here is about the verb's shape: what it refuses, what resets it, and
 * what a completed one means afterwards.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey, type CarrierKey } from "../src/carrier-key";
import { carrierManifest } from "../src/carrier-manifest";
import type { ScanSubject } from "../src/carrier-scan";
import {
	CARRIER_SCAN_FIGURES,
	SCAN_CHARGE_S,
	SCAN_CONE_DEG,
	SCAN_RANGE_KM,
	beginScanHold,
	scanFitted,
	carrierReading,
	scanCompleted,
	scanConeHeld,
	scanInRange,
	scanProgress,
	scanRefusal,
	scanStandoff,
	stepScanHold,
} from "../src/carrier-scan";
import { SCAN_REFUSAL_LABELS } from "../src/display-contact";
import { CarrierStanding, carrierStanding } from "../src/carrier-standing";
import { SCAN_MODULE } from "../src/market";
import { SCAN_SOURCE, type KnowledgeRow } from "../src/world-state";
import { v3 } from "../src/vec3";
import { codeOf } from "./lib/source-scan";

const AHEAD = v3(0, 0, -1);
/** A bearing `deg` off the nose, in the horizontal plane. */
const offNose = (deg: number) => {
	const r = (deg * Math.PI) / 180;
	return v3(Math.sin(r), 0, -Math.cos(r));
};

const scanRow = (at: number, instance = 0, voyage = 4): KnowledgeRow => ({
	observedAt: at,
	source: SCAN_SOURCE,
	scan: {
		observedAt: at,
		source: SCAN_SOURCE,
		observedInstanceOrdinal: instance,
		observedVoyageOrdinal: voyage,
	},
});

describe("the gate", () => {
	test("an unequipped pilot is refused, and told why", () => {
		expect(scanRefusal(false, true)).toBe("no-module");
		expect(scanRefusal(true, true)).toBeNull();
	});

	test("only the missing module is a refusal", () => {
		// A raider, a station or a canister is not a scannable subject, and
		// saying so on every selection would train the pilot to ignore the one
		// word they can act on.
		expect(scanRefusal(false, false)).toBeNull();
		expect(scanRefusal(true, false)).toBeNull();
	});

	test("the refusal names an absent thing, not a broken one", () => {
		// `hud-and-scanner.md` §4 owns red for refusal; the word has to read as
		// "buy this", not as "this failed".
		expect(SCAN_REFUSAL_LABELS["no-module"]).toBe("NO SCANNER");
		expect(SCAN_REFUSAL_LABELS["no-module"].toLowerCase()).not.toContain(
			"fail",
		);
	});

	test("the module the gate reads is the module the shipyard sells", () => {
		// A name in the purchase list, not a flag beside it: buying the thing is
		// the only way to have it.
		expect(scanFitted([SCAN_MODULE])).toBe(true);
		expect(scanFitted(["Fuel Scoops", SCAN_MODULE])).toBe(true);
		expect(scanFitted([])).toBe(false);
		expect(scanFitted(["identity scanner"])).toBe(false);
		expect(SCAN_MODULE).toBe("Identity Scanner");
	});
});

describe("the hold", () => {
	test("the figures are pinned, and the instrument prints these", () => {
		// Literal, as #362 pinned the standing shares: these three are what the
		// probe and the instrument are both read against, and a silent move
		// makes every quoted figure about the verb wrong.
		expect(CARRIER_SCAN_FIGURES).toEqual({
			rangeKm: SCAN_RANGE_KM,
			coneDeg: SCAN_CONE_DEG,
			chargeS: SCAN_CHARGE_S,
		});
		expect(SCAN_RANGE_KM).toBeLessThan(10_000);
		expect(SCAN_CONE_DEG).toBeGreaterThan(0);
		expect(SCAN_CHARGE_S).toBeGreaterThan(0);
	});

	test("the cone is a sightline from the nose, not a heading match", () => {
		expect(scanConeHeld(AHEAD, AHEAD)).toBe(true);
		expect(scanConeHeld(AHEAD, offNose(SCAN_CONE_DEG / 2))).toBe(true);
		expect(scanConeHeld(AHEAD, offNose(SCAN_CONE_DEG * 2))).toBe(false);
		// The cone is a half-angle: the boundary is inclusive, and 90° is the far
		// side of the ship, which is no one's sightline.
		expect(scanConeHeld(AHEAD, offNose(SCAN_CONE_DEG))).toBe(true);
		expect(scanConeHeld(AHEAD, v3(0, 0, 1))).toBe(false);
	});

	/** Two carriers, because a hold that does not name one cannot be tested
	 *  against a second. */
	const A: ScanSubject = { key: carrierKey(3, "station-trade/traffic-000") };
	const B: ScanSubject = { key: carrierKey(3, "station-trade/traffic-001") };

	test("the charge belongs to one ship, and a second target starts from nothing", () => {
		// §4's "unbroken attention" is attention to *one* carrier. The first
		// version of the hold was a number with nobody attached to it, so four
		// seconds on one ship and one second on another completed a scan of the
		// second — which is exactly what sweeping the nose across a traffic queue
		// does (sage #384 round 1, the PR's blocker).
		let hold = beginScanHold();
		for (let i = 0; i < 4; i++) hold = stepScanHold(hold, A, 1);
		expect(scanProgress(hold)).toBeCloseTo(4 / SCAN_CHARGE_S);
		const swung = stepScanHold(hold, B, 1);
		expect(swung.key).toBe(B.key);
		expect(swung.chargeS).toBe(1);
		expect(scanCompleted(hold, swung)).toBe(false);
		// And it does not come back: returning to A pays its own five seconds.
		const back = stepScanHold(swung, A, SCAN_CHARGE_S - 1);
		expect(back.chargeS).toBe(SCAN_CHARGE_S - 1);
	});

	test("range is a ceiling, and it is read every frame", () => {
		expect(scanInRange(0)).toBe(true);
		expect(scanInRange(SCAN_RANGE_KM)).toBe(true);
		expect(scanInRange(SCAN_RANGE_KM * 1.5)).toBe(false);
		// Interdiction checks range once because a contest runs in cruise on a
		// pinned offset; a scan is flown, so driving out breaks it.
		let hold = beginScanHold();
		hold = stepScanHold(hold, A, 2);
		hold = stepScanHold(hold, scanInRange(SCAN_RANGE_KM * 2) ? A : null, 1);
		expect(hold.chargeS).toBe(0);
	});

	test("a break resets the charge rather than pausing it", () => {
		// §4's own words. Five seconds of *attention* completes a scan; five
		// seconds spread across a broken hold does not.
		let hold = beginScanHold();
		hold = stepScanHold(hold, A, SCAN_CHARGE_S - 1);
		expect(scanProgress(hold)).toBeCloseTo((SCAN_CHARGE_S - 1) / SCAN_CHARGE_S);
		const broken = stepScanHold(hold, null, 0.1);
		expect(broken.chargeS).toBe(0);
		expect(broken.key).toBeNull();
		const again = stepScanHold(broken, A, SCAN_CHARGE_S - 1);
		expect(scanCompleted(broken, again)).toBe(false);
	});

	test("nothing is rolled", () => {
		// §4: a scan fails only through the hold being lost. No RNG in the module
		// is the property; the row is what keeps it one.
		expect(codeOf("src/carrier-scan.ts")).not.toMatch(
			/Math\.random|seededRand|from "\.\/rng"/,
		);
		const run = () => {
			let hold = beginScanHold();
			for (let i = 0; i < 40; i++)
				hold = stepScanHold(hold, i % 7 !== 3 ? A : null, 1 / 60);
			return hold.chargeS;
		};
		expect(run()).toBe(run());
	});

	test("one completed scan per hold, and the age survives a long lock", () => {
		let hold = stepScanHold(beginScanHold(), A, SCAN_CHARGE_S);
		expect(scanCompleted(beginScanHold(), hold)).toBe(true);
		expect(scanProgress(hold)).toBe(1);
		// Holding it longer writes nothing further, so `observedAt` stays where
		// it was and the reading keeps ageing on the glass.
		const later = stepScanHold(hold, A, 600);
		expect(later.chargeS).toBe(SCAN_CHARGE_S);
		expect(scanCompleted(hold, later)).toBe(false);
		// Breaking and re-acquiring is the deliberate refresh.
		const broken = stepScanHold(later, null, 0.5);
		const refilled = stepScanHold(broken, A, SCAN_CHARGE_S);
		expect(scanCompleted(broken, refilled)).toBe(true);
	});
});

describe("the reading", () => {
	const SEED = 0x5ee11e;
	/** A carrier whose standing really does rotate, found rather than asserted:
	 *  §9's ageing rows are worthless on a carrier that never changes. */
	const rotating = (): {
		key: CarrierKey;
		then: CarrierStanding;
		now: CarrierStanding;
	} => {
		for (let i = 0; i < 400; i++) {
			const key = carrierKey(
				3,
				`station-trade/traffic-${String(i).padStart(3, "0")}`,
			);
			const then = carrierStanding(SEED, key, 0, 100);
			const now = carrierStanding(SEED, key, 0, 100 + 40 * 3600);
			if (then !== now) return { key, then, now };
		}
		throw new Error("no rotating carrier in the corpus");
	};

	test("a reading belongs to the instance it was taken on", () => {
		// The sharper case than a stale clock: the carrier has been replaced, so a
		// different instance is flying and the reading on the glass is the one
		// taken of the ship it succeeded. That is last-known state working as
		// designed, not a leak — the pilot is shown what they recorded, and the
		// age beside it is the warning — and what makes it provable rather than
		// argued is that `carrierReading` is handed no live instance to consult:
		// the only instance in its input is the scan's own recorded ordinal.
		// Sage #384 round 1 asked which ship a replaced carrier is wearing; this
		// is the answer, pinned, not a comment claiming it.
		const { key } = rotating();
		const reading = carrierReading({
			systemSeed: SEED,
			key,
			row: scanRow(100, 1),
			holdT: 20,
			government: 4,
			gameTime: 100 + 40 * 3600,
		});
		expect(reading?.standing).toBe(carrierStanding(SEED, key, 1, 100));
		expect(reading?.ageS).toBe(40 * 3600);
	});

	test("the standing is the one at the recorded clock, not the live one", () => {
		const { key, then, now } = rotating();
		const row = scanRow(100);
		const reading = carrierReading({
			systemSeed: SEED,
			key,
			row,
			holdT: 20,
			government: 4,
			gameTime: 100 + 40 * 3600,
		});
		expect(reading?.standing).toBe(then);
		expect(carrierStanding(SEED, key, 0, 100 + 40 * 3600)).toBe(now);
		expect(reading?.ageS).toBe(40 * 3600);
	});

	test("the hold is the recorded voyage's, after the carrier has flown another", () => {
		// §5's amendment by #362: the flown voyage depends on the route as it
		// stood, so the row stores which voyage was read. The hold the pilot was
		// shown stays the hold they were shown.
		const key = carrierKey(3, "station-trade/traffic-000");
		const args = { systemSeed: SEED, holdT: 20, government: 4 };
		const read = carrierReading({
			...args,
			key,
			row: scanRow(100, 0, 4),
			gameTime: 100,
		});
		expect(read?.manifest).toEqual(
			carrierManifest(SEED, key, 0, 4, { holdT: 20, government: 4 }),
		);
		expect(read?.manifest).not.toEqual(
			carrierManifest(SEED, key, 0, 5, { holdT: 20, government: 4 }),
		);
	});

	test("an unscanned carrier has no reading, which is UNKNOWN", () => {
		const key = carrierKey(3, "station-trade/traffic-000");
		expect(
			carrierReading({
				systemSeed: SEED,
				key,
				row: undefined,
				holdT: 20,
				government: 4,
				gameTime: 100,
			}),
		).toBeNull();
		// A row from a docking report knows the condition and nothing else; that
		// is not a scan and must not print a standing.
		expect(
			carrierReading({
				systemSeed: SEED,
				key,
				row: {
					observedAt: 50,
					source: "docking",
					observedCondition: "operational",
					observedInstanceOrdinal: 0,
				},
				holdT: 20,
				government: 4,
				gameTime: 100,
			}),
		).toBeNull();
	});

	test("the age is measured against the world clock and never goes negative", () => {
		const key = carrierKey(3, "station-trade/traffic-000");
		const read = (gameTime: number) =>
			carrierReading({
				systemSeed: SEED,
				key,
				row: scanRow(500),
				holdT: 20,
				government: 4,
				gameTime,
			})?.ageS;
		expect(read(560)).toBe(60);
		expect(read(400)).toBe(0);
	});
});

test("the reason a hold is not satisfied names the one fact to act on", () => {
	const ahead = { x: 0, y: 0, z: -1 };
	const on = { x: 0, y: 0, z: -1 };
	// 17° to one side of the sightline — outside a cone whose half-angle is 12°,
	// at a distance that is perfectly fine.
	const side = { x: 0.3, y: 0, z: -0.95 };
	expect(scanStandoff(120, ahead, on)).toBeNull();
	expect(scanStandoff(120, ahead, side)).toBe("off-axis");
	expect(scanStandoff(900, ahead, on)).toBe("too-far");
	// Range is answered first, deliberately: a carrier 900 km out is off axis at
	// most angles too, and the fact with a verb attached to it is distance.
	expect(scanStandoff(900, ahead, side)).toBe("too-far");
	// The ceiling is inclusive, and the frame past it is already refused.
	expect(scanStandoff(400, ahead, on)).toBeNull();
	expect(scanStandoff(401, ahead, on)).toBe("too-far");
});
