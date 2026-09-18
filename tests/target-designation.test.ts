import { expect, test } from "bun:test";
import {
	type DesignationScan,
	type DisplayContact,
	targetDesignation,
} from "../src/display-contact";
import type { Body } from "../src/sim";
import { v3 } from "../src/vec3";

const body: Body = {
	id: "target",
	name: "Same name",
	kind: "star",
	pos: v3(),
	radiusKm: 1,
	color: 0,
};
test("the Target panel distinguishes generated kinds and station roles", () => {
	expect(targetDesignation(null)).toBe("");
	for (const kind of ["star", "planet", "moon"] as const)
		expect(targetDesignation({ ...body, kind })).toBe(kind.toUpperCase());
	// A canister is a contact of its own kind (#324, the principal's ruling
	// after the fifth playtest), and the fall-through names it without a branch.
	expect(targetDesignation({ ...body, kind: "cargo" })).toBe("CARGO");
	for (const stationType of [
		"trade",
		"refinery",
		"shipyard",
		"outpost",
	] as const)
		expect(targetDesignation({ ...body, kind: "station", stationType })).toBe(
			`STATION · ${stationType.toUpperCase()}`,
		);
});
test("a ship shows its declared hull type and scanner status without inferring identity from its name", () => {
	const ship: DisplayContact = {
		...body,
		kind: "ship",
		shipType: "freighter",
		velocity: v3(),
		standing: null,
		scannerClass: "unknown",
	};
	expect(targetDesignation(ship)).toBe("SHIP · FREIGHTER · UNKNOWN");
	const hostile: DisplayContact = { ...ship, scannerClass: "hostile" };
	expect(targetDesignation(hostile)).toBe("SHIP · FREIGHTER · HOSTILE");
	expect(targetDesignation({ ...body, kind: "ship" })).toBe("SHIP · UNKNOWN");
});

/**
 * `carrier-identity.md` §6 — the cell §6 says the panel gains, and the two axes
 * that now share it.
 */
const carrier = (over: Partial<DisplayContact>): DisplayContact => ({
	...body,
	kind: "ship",
	shipType: "freighter",
	velocity: v3(),
	standing: null,
	scannerClass: "civilian",
	...over,
});

test("an ordinary ship is UNKNOWN until it is scanned, then reads its standing and the reading's age", () => {
	expect(targetDesignation(carrier({}))).toBe("SHIP · FREIGHTER · UNKNOWN");
	expect(targetDesignation(carrier({ standing: "wanted" }))).toBe(
		"SHIP · FREIGHTER · WANTED",
	);
	// §6's own row, down to the age suffix.
	expect(
		targetDesignation(carrier({ standing: "wanted" }), { ageS: 245 }),
	).toBe("SHIP · FREIGHTER · WANTED · 4m");
	expect(
		targetDesignation(carrier({ standing: "fugitive" }), { ageS: 3 * 86_400 }),
	).toBe("SHIP · FREIGHTER · FUGITIVE · 3d");
});

test("the age is coarse, because it is a staleness warning and not a stopwatch", () => {
	const at = (ageS: number) =>
		targetDesignation(carrier({ standing: "clean" }), { ageS });
	// One unit, never two: `hud-and-scanner.md` §3's discipline, and the record
	// card's two-unit `1M 08S AGO` is a different instrument's precision.
	expect(at(0)).toBe("SHIP · FREIGHTER · CLEAN · 0s");
	expect(at(59)).toBe("SHIP · FREIGHTER · CLEAN · 59s");
	expect(at(60)).toBe("SHIP · FREIGHTER · CLEAN · 1m");
	expect(at(3_599)).toBe("SHIP · FREIGHTER · CLEAN · 59m");
	expect(at(3_600)).toBe("SHIP · FREIGHTER · CLEAN · 1h");
	expect(at(86_399)).toBe("SHIP · FREIGHTER · CLEAN · 23h");
	expect(at(86_400)).toBe("SHIP · FREIGHTER · CLEAN · 1d");
	// Negative is a clock that has not caught up, not a future reading.
	expect(at(-30)).toBe("SHIP · FREIGHTER · CLEAN · 0s");
});

test("a charge in progress shows the charge, not the stale word beside it", () => {
	// Re-scanning a known ship: the live event is what the cell carries, and the
	// recorded standing comes back the moment the reading is refreshed.
	expect(
		targetDesignation(carrier({ standing: "clean" }), { progress: 0 }),
	).toBe("SHIP · FREIGHTER · SCANNING 0%");
	expect(
		targetDesignation(carrier({ standing: "clean" }), { progress: 0.62 }),
	).toBe("SHIP · FREIGHTER · SCANNING 62%");
	expect(
		targetDesignation(carrier({ standing: "clean" }), {
			progress: 1,
			ageS: 120,
		}),
	).toBe("SHIP · FREIGHTER · CLEAN · 2m");
});

test("the module gate reads as an absence the pilot can buy their way out of", () => {
	expect(targetDesignation(carrier({}), { refusal: "no-module" })).toBe(
		"SHIP · FREIGHTER · NO SCANNER",
	);
	// The gate is only ever offered for a scannable subject, and it outranks the
	// charge there is no charge to show.
	expect(
		targetDesignation(carrier({ standing: "wanted" }), {
			refusal: "no-module",
			progress: 0.5,
		}),
	).toBe("SHIP · FREIGHTER · NO SCANNER");
});

test("a pirate keeps its own word for what it is, whichever way the standing reads", () => {
	// F1 and F10: `scannerClass` still answers *is this a pirate*. A raider that
	// somehow carries a recorded standing is not the case that changes it.
	const pirate = carrier({
		scannerClass: "hostile",
		shipType: "raider",
		standing: "wanted",
	});
	expect(targetDesignation(pirate, { ageS: 245, progress: 0.5 })).toBe(
		"SHIP · RAIDER · HOSTILE",
	);
	expect(targetDesignation(carrier({ scannerClass: "unknown" }))).toBe(
		"SHIP · FREIGHTER · UNKNOWN",
	);
});

test("the cell a station and a relay show is not this cell", () => {
	// §6's table: stations are unchanged, and the standing axis does not reach
	// them. A station carrying a standing is a type error, not a display case —
	// what is checked is that nothing about the scan arguments moves these.
	const scan = { ageS: 60, progress: 0.5, refusal: "no-module" } as const;
	expect(
		targetDesignation({ ...body, kind: "station", stationType: "trade" }, scan),
	).toBe("STATION · TRADE");
	const relay: DisplayContact = {
		...body,
		kind: "relay",
		velocity: v3(),
		standing: null,
		scannerClass: "unknown",
	};
	expect(targetDesignation(relay, scan)).toBe("RELAY · UNKNOWN");
});

test("the field is called standing, and the old name is gone from every producer", async () => {
	// The rename rides the retype (§6): a field still called `legalStatus`
	// sitting beside the player's `LegalStatus` is the collision this paragraph
	// exists to prevent, and a leftover producer would keep compiling against
	// `null` forever.
	const { codeOf, srcFiles } = await import("./lib/source-scan");
	// The producer's signature, not the word: the Flight console legitimately
	// prints the *player's* `legalStatus` from `legalStanding()`, and that one is
	// staying. What must not survive is a contact declaring an empty legal
	// identity, which is the field this rename retired.
	const stillNamingIt = srcFiles().filter((f) =>
		codeOf(f).includes("legalStatus: null"),
	);
	expect(stillNamingIt).toEqual([]);
});

test("the progress cell never claims a completed scan", () => {
	// Under a rounding, the last frames of a five-second charge read 100% on a
	// record that has not been written yet — the one lie this cell can tell,
	// because it says the pilot has learned something they have not.
	expect(targetDesignation(carrier({}), { progress: 0.999 })).toBe(
		"SHIP · FREIGHTER · SCANNING 99%",
	);
	expect(targetDesignation(carrier({}), { progress: 0.625 })).toBe(
		"SHIP · FREIGHTER · SCANNING 62%",
	);
});

test("an unscanned carrier says why the scan is not holding it", () => {
	// #384's flight test: a pilot who cannot start a scan and is shown `UNKNOWN`
	// has no way to tell too-far from off-axis from broken, so they report broken.
	expect(targetDesignation(carrier({}), { standoff: "too-far" })).toBe(
		"SHIP · FREIGHTER · UNKNOWN · TOO FAR",
	);
	expect(targetDesignation(carrier({}), { standoff: "off-axis" })).toBe(
		"SHIP · FREIGHTER · UNKNOWN · OFF AXIS",
	);
	// `UNKNOWN` survives: that you have never read this ship and that you are not
	// holding it now are different facts, and the cell loses one if the second
	// overwrites the first.
	expect(targetDesignation(carrier({}), {})).toBe("SHIP · FREIGHTER · UNKNOWN");
	// Once there is a reading the cue is gone — the scan worked, and a standing
	// with an age is the answer.
	expect(
		targetDesignation(carrier({ standing: "clean" }), {
			ageS: 240,
			standoff: "off-axis",
		}),
	).toBe("SHIP · FREIGHTER · CLEAN · 4m");
	// Nor while a charge is running: the percentage is already the live answer.
	expect(
		targetDesignation(carrier({}), { progress: 0.4, standoff: "too-far" }),
	).toBe("SHIP · FREIGHTER · SCANNING 40%");
	// And never on a pirate's line, which is not this verb's cell.
	expect(
		targetDesignation(carrier({ scannerClass: "hostile" }), {
			standoff: "off-axis",
		}),
	).toBe("SHIP · FREIGHTER · HOSTILE");
});
