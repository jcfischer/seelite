/**
 * The shared surface generator (#101).
 *
 * `src/surface.ts` is what #36's station plating became when #101 gave it a
 * second and a third consumer. The tests here are in three groups, and the
 * grouping is the argument:
 *
 * 1. **The station's output has not moved since the pins were taken.** An
 *    absolute checksum of every buffer, captured by running the shipped
 *    generators at `01427e4`. What it cannot do is prove its own provenance —
 *    pins taken from the new code and labelled as old would satisfy every
 *    assertion here identically — so this is a guard against later drift and a
 *    claim in the commit message, not a proof of behaviour preservation. A
 *    structural assertion that the wrapper calls the generator would be weaker
 *    still: it passes on a generator that had been retuned.
 * 2. **The new normal map is in register with the albedo it is derived from.**
 *    #36 recorded the failure this prevents — a shine that misses its own seam —
 *    and an embossed seam that misses its own painted one is the same defect
 *    one channel over.
 * 3. **The crease term separates a hull that has edges from one that does not.**
 *    Per the map: a check that could pass on a build ignoring the thing it
 *    checks is not a check. Both directions are asserted, so neither a
 *    constant 0 nor a constant 1 survives.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_IDS } from "../src/hull";
import { hullLoft, RING_SEGMENTS } from "../src/loft";
import { buildShipMesh } from "../src/ship-mesh";
import {
	cleanPlateFactors,
	plateUVs,
	SHIP_MAP_SIZE,
	SHIP_PANEL_KM,
	SHIP_PLATING,
} from "../src/ship-surface";
import { STATION_TYPES } from "../src/station";
import { STATION_PANEL_KM } from "../src/station-mesh";
import {
	DEFAULT_STATION_FINISH,
	platingTexels,
	STATION_VISUALS,
	setStationFinish,
	surfaceTexels,
} from "../src/station-visuals";
import {
	type MacroOctave,
	PLATE_TEXTURE_SIZE,
	type PlatingProfile,
	plateLayout,
	plateTexels,
	seamNormalTexels,
	wearTexels,
} from "../src/surface";
import { codeOf } from "./lib/source-scan";

/** FNV-1a over a buffer. The same hash the module uses for its own texels,
 *  reimplemented here on purpose: a test that imports the function it is
 *  checksumming with agrees with itself when that function changes. */
const fnv = (bytes: Uint8Array) => {
	let h = 0x811c9dc5;
	for (const v of bytes) {
		h ^= v;
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
};

describe("the station's surface did not move", () => {
	// The pins are `stock`'s, by name: the default is `worn` since the
	// principal's choice on #202's second sheet, and `stock` stays a preset
	// that these hold byte-for-byte.
	beforeAll(() => setStationFinish("stock"));
	afterAll(() => setStationFinish(DEFAULT_STATION_FINISH));
	/**
	 * Captured from `01427e4` — the commit before this node — by running the
	 * shipped `platingTexels`/`surfaceTexels` over every role.
	 *
	 * These are **absolute pins, not thresholds**: the map's own finding is that
	 * a `>` is not a measurement, and the whole claim being made here is that
	 * four buffers are byte-for-byte what they were. A retune of a station
	 * profile is meant to fail this and to be re-pinned deliberately.
	 */
	const PINS: Record<string, { albedo: string; wear: string }> = {
		trade: { albedo: "b0f25b9b", wear: "68e6a41" },
		shipyard: { albedo: "8d71b5ab", wear: "6a260be6" },
		refinery: { albedo: "8831ed6c", wear: "c7193777" },
		outpost: { albedo: "7598c090", wear: "862ea19d" },
	};

	for (const type of STATION_TYPES) {
		test(`${type} plating and wear are unchanged`, () => {
			const albedo = platingTexels(type);
			expect(fnv(albedo)).toBe(PINS[type].albedo);
			expect(fnv(surfaceTexels(type, PLATE_TEXTURE_SIZE, albedo))).toBe(
				PINS[type].wear,
			);
		});
	}

	test("the station wrapper agrees with the shared generator, tagged by role", () => {
		// What this proves is that the wrapper passes the role's own profile and
		// uses the role as the hash tag — get either wrong and the buffers
		// diverge. What it does **not** prove is that the old copy is gone: a
		// byte-identical private implementation satisfies both this and the pins
		// above, because both compare outputs. The next test is the half that
		// looks at the source.
		for (const type of STATION_TYPES) {
			expect(platingTexels(type)).toEqual(
				plateTexels(STATION_VISUALS[type].plating, type),
			);
		}
	});

	test("and there is only one implementation of it", () => {
		// The structural half, because no comparison of outputs can find a
		// duplicate that agrees. A texel generator allocates its buffer; nothing
		// left in `station-visuals.ts` should, now that both generators live in
		// `surface.ts` and this module only wraps them.
		expect(codeOf("src/station-visuals.ts")).not.toContain("new Uint8Array");
		expect(codeOf("src/surface.ts")).toContain("new Uint8Array");
	});

	test("no station role embosses its seams", () => {
		// #101 gave ships a normal map and deliberately left the stations'
		// painted seams alone: changing how a station looks is a judgement
		// somebody has to make in front of a frame, and nobody made it here.
		for (const type of STATION_TYPES)
			expect(STATION_VISUALS[type].plating.seamDepth).toBe(0);
	});
});

describe("a second, coarser octave of plating (#202, #203)", () => {
	/*
	 * A hull has one detail scale — a 1 m plate — and a station one 19 m
	 * plate, and #199's review read both as a single uniform grid. The macro
	 * octave is a coarser layout of *panel groups* laid over the same map: a
	 * wider, darker groove and a group-to-group tone spread, so a surface
	 * carries two rulers rather than one.
	 *
	 * The octave is **optional and off by default**, which is what the pins
	 * above rest on: every station profile leaves it undefined and its buffers
	 * are byte for byte what they were.
	 */
	const size = 256;
	const fine: PlatingProfile = { ...SHIP_PLATING, seamDepth: 0.5 };
	// 64 px on a 256 map is four groups across and two rows: eight groups,
	// which is enough draws for a tone *spread* to be a property of the term
	// rather than of two hashes. At 128 px it was two groups, and the range
	// assertion below was a coin toss that came up 10.3 against a bar of 12.
	const macro: MacroOctave = {
		pitchPx: 64,
		aspect: 2,
		stagger: 0.5,
		seamHalfWidthPx: 3,
		seam: 0.35,
		variation: 14,
		seamDepth: 0.6,
	};
	const twoOctave: PlatingProfile = { ...fine, macro };
	const at = (buffer: Uint8Array, x: number, y: number, channel = 0) =>
		buffer[(y * size + x) * 4 + channel];

	test("an undefined octave is the same buffer as no octave at all", () => {
		// Spelled out rather than trusted to the pins: the pins cover the four
		// station profiles, and this covers the field itself.
		const bare = plateTexels(fine, "octave", size);
		const explicit = plateTexels({ ...fine, macro: undefined }, "octave", size);
		expect(explicit).toEqual(bare);
		expect(seamNormalTexels({ ...fine, macro: undefined }, size)).toEqual(
			seamNormalTexels(fine, size),
		);
	});

	test("the macro groove darkens a band wider than the fine seam, on the macro boundaries only", () => {
		const bare = plateTexels(fine, "octave", size);
		const layered = plateTexels(twoOctave, "octave", size);
		const coarse = plateLayout({ ...fine, ...macro }, size);
		const fineLayout = plateLayout(fine, size);
		// A row through the middle of a fine strake and of a macro group, so
		// the only along-seams in reach are none at all.
		const y = Math.floor(size / fineLayout.rows / 2);
		let darkenedOnMacro = 0;
		let darkenedOffMacro = 0;
		let onMacro = 0;
		for (let x = 0; x < size; x++) {
			const { across, along } = coarse.distanceTo(x, y);
			const inGroove =
				Math.min(Math.abs(across), Math.abs(along)) < macro.seamHalfWidthPx;
			// The group tone moves every texel; the *groove* is a darkening on
			// top of that, so compare against the same group's own level rather
			// than against the single-octave map.
			const darker = at(layered, x, y) < at(bare, x, y) * (1 - macro.seam / 2);
			if (inGroove) {
				onMacro += 1;
				if (darker) darkenedOnMacro += 1;
			} else if (darker && !fineLayout.onSeam(x, y)) darkenedOffMacro += 1;
		}
		// Two boundaries on the row, each `2 × seamHalfWidthPx` texels wide.
		expect(onMacro).toBe(coarse.cols * macro.seamHalfWidthPx * 2);
		expect(darkenedOnMacro).toBe(onMacro);
		expect(darkenedOffMacro).toBe(0);
	});

	test("groups differ from each other in tone by more than plates do", () => {
		// The point of the octave: a 16-tone patchwork at the group scale where
		// the fine plating spreads only ±6. Read the group means off the map.
		const layered = plateTexels(twoOctave, "octave", size);
		const coarse = plateLayout({ ...fine, ...macro }, size);
		const means = new Map<string, { sum: number; n: number }>();
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const { across, along } = coarse.distanceTo(x, y);
				if (Math.min(Math.abs(across), Math.abs(along)) < macro.seamHalfWidthPx)
					continue;
				const row = coarse.rowOf(y);
				const key = `${coarse.colOf(x, row)}:${row}`;
				const entry = means.get(key) ?? { sum: 0, n: 0 };
				entry.sum += at(layered, x, y);
				entry.n += 1;
				means.set(key, entry);
			}
		const levels = [...means.values()].map((m) => m.sum / m.n);
		expect(levels.length).toBe(coarse.cols * coarse.rows);
		expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(
			fine.variation * 2,
		);
	});

	test("the macro groove is cut into the normal map, and the fine one still is", () => {
		const bare = seamNormalTexels(fine, size);
		const layered = seamNormalTexels(twoOctave, size);
		const coarse = plateLayout({ ...fine, ...macro }, size);
		const fineLayout = plateLayout(fine, size);
		const y = Math.floor(size / fineLayout.rows / 2);
		let tiltedOnMacro = 0;
		let onMacro = 0;
		let changedOffMacro = 0;
		for (let x = 0; x < size; x++) {
			const { across } = coarse.distanceTo(x, y);
			const { across: fineAcross } = fineLayout.distanceTo(x, y);
			const inMacro = Math.abs(across) < macro.seamHalfWidthPx;
			const inFine = Math.abs(fineAcross) < fine.seamHalfWidthPx;
			if (inMacro && !inFine) {
				onMacro += 1;
				if (Math.abs(at(layered, x, y) - 128) > 4) tiltedOnMacro += 1;
			}
			if (!inMacro && at(layered, x, y) !== at(bare, x, y))
				changedOffMacro += 1;
		}
		expect(onMacro).toBeGreaterThan(0);
		expect(tiltedOnMacro).toBe(onMacro);
		expect(changedOffMacro).toBe(0);
	});

	test("the memoised seam distances agree with the definition", () => {
		// `distanceTo` is memoised per row now, because a 512 map with two
		// octaves ran the boundary scan a quarter of a billion times. The
		// memo has to be the same function, so it is checked against the
		// scan written out.
		const layout = plateLayout(fine, size);
		const scan = (n: number, boundary: (m: number) => boolean) => {
			let best = size;
			for (let m = 0; m < size; m++) {
				if (!boundary(m)) continue;
				const raw = n - (m + 0.5);
				const wrapped =
					raw > size / 2 ? raw - size : raw < -size / 2 ? raw + size : raw;
				if (Math.abs(wrapped) < Math.abs(best)) best = wrapped;
			}
			return best;
		};
		for (const [x, y] of [
			[0, 0],
			[17, 3],
			[255, 255],
			[128, 64],
			[31, 200],
		]) {
			const row = layout.rowOf(y);
			const { across, along } = layout.distanceTo(x, y);
			expect(across).toBe(
				scan(
					x,
					(m) => layout.colOf(m, row) !== layout.colOf((m + 1) % size, row),
				),
			);
			expect(along).toBe(
				scan(y, (m) => layout.rowOf(m) !== layout.rowOf((m + 1) % size)),
			);
		}
	});
});

describe("every generated buffer is the length a DataTexture needs", () => {
	// A short buffer does not throw: `DataTexture` samples past its end and
	// draws garbage from some row down. The length is asserted on the generator
	// because that is the only place it can be caught by a machine.
	const expected = 4 * PLATE_TEXTURE_SIZE * PLATE_TEXTURE_SIZE;
	test("plate, wear and seam normals are all 4 x w x h", () => {
		const albedo = plateTexels(SHIP_PLATING, "ship");
		expect(albedo.length).toBe(expected);
		expect(wearTexels(SHIP_PLATING, albedo).length).toBe(expected);
		expect(seamNormalTexels(SHIP_PLATING).length).toBe(expected);
	});
});

describe("the seam normal map is in register with the painted seam", () => {
	const size = SHIP_MAP_SIZE;
	const albedo = plateTexels(SHIP_PLATING, "ship", size);
	const normals = seamNormalTexels(SHIP_PLATING, size);
	const layout = plateLayout(SHIP_PLATING, size);
	/** The seam columns on one row. Per row and not per map, because the
	 *  stagger moves them: that is the whole point of the bond. */
	const seamsOn = (row: number) => {
		const at: number[] = [];
		for (let x = 0; x < size; x++)
			if (layout.colOf(x, row) !== layout.colOf((x + 1) % size, row))
				at.push(x);
		return at;
	};
	/**
	 * A row through the **middle** of a strake, so every dark column on it is an
	 * across-seam and no texel on it is inside the along-groove.
	 *
	 * The first version took the first row that was not itself a boundary, which
	 * was y = 0 — half a texel past the boundary at 255.5, and therefore inside
	 * a groove one texel wide. "Not on a seam" and "not in the groove either
	 * side of one" are different questions once the groove has a width.
	 */
	const cleanRow = Math.floor(size / layout.rows / 2);

	test("the albedo darkens exactly the columns the normal map grooves", () => {
		/*
		 * The assertion this `describe` was named for and did not make. It
		 * computed the albedo and never read it: the only thing checked was that
		 * the two boundary lists had the same length, which says nothing about
		 * where either map put its seam.
		 *
		 * `plateTexels` recomputed `Math.floor((n * panels) / size)` inline
		 * rather than reading `seamOffsets`, so "the emboss cannot land anywhere
		 * but on a painted seam" was a claim about two copies of one expression
		 * agreeing. Both halves are fixed: the generator reads the shared
		 * definition, and this compares the two maps to each other on a row.
		 */
		const at = (buffer: Uint8Array, x: number, y: number, channel: number) =>
			buffer[(y * size + x) * 4 + channel];
		const row = cleanRow;
		const expected = seamsOn(layout.rowOf(row));
		const dark: number[] = [];
		const grooved: number[] = [];
		/*
		 * The cut between "plate" and "seam", derived rather than guessed.
		 *
		 * A plate's value is 196 ± `variation`, and the grime then multiplies it
		 * by at worst `1 - weathering × 0.55`. A seam multiplies the *lightest*
		 * plate by `1 - seam`. The two bands have to be disjoint for a threshold
		 * to mean anything, so that is asserted before one is used: the first
		 * version cut at a fixed offset from 196 and picked up four grime texels
		 * as seams.
		 */
		const darkestPlate =
			(196 - SHIP_PLATING.variation) * (1 - SHIP_PLATING.weathering * 0.55);
		const lightestSeam =
			(196 + SHIP_PLATING.variation) * (1 - SHIP_PLATING.seam);
		expect(lightestSeam).toBeLessThan(darkestPlate);
		const cut = (darkestPlate + lightestSeam) / 2;
		for (let x = 0; x < size; x++) {
			if (at(albedo, x, row, 0) < cut) dark.push(x);
			// The centre of a groove is the one column pair where the encoded
			// tilt flips sign, so a grooved column is any with a tilt at all.
			if (Math.abs(at(normals, x, row, 0) - 128) > 4) grooved.push(x);
		}
		expect(dark).toEqual(expected);
		// The groove is `seamHalfWidthPx` wide either side, so it covers more
		// columns than the one the albedo darkens — but every darkened column
		// must be inside it, which is what "in register" means.
		expect(grooved.length).toBeGreaterThan(dark.length);
		for (const x of dark) expect(grooved).toContain(x);
	});

	test("the stagger actually moves the seams between rows", () => {
		// Without this, `aspect` and `stagger` could both be ignored and every
		// assertion above would still pass on the aligned grid they replaced —
		// which is the layout the principal called scales.
		const rows = new Set<string>();
		for (let row = 0; row < layout.rows; row++)
			rows.add(seamsOn(row).join(","));
		expect(layout.rows).toBeGreaterThan(1);
		expect(rows.size).toBe(2);
		// And a plate is longer than it is wide, which is the other half.
		expect(layout.cols / layout.rows).toBeGreaterThanOrEqual(2);
	});

	test("a plate interior is flat and a seam is not", () => {
		const decode = (x: number, y: number) => {
			const i = (y * size + x) * 4;
			return [
				normals[i] / 255 - 0.5,
				normals[i + 1] / 255 - 0.5,
				normals[i + 2] / 255 - 0.5,
			];
		};
		// The texel furthest from any boundary in both axes.
		const seamX = seamsOn(layout.rowOf(cleanRow));
		const flatX = Math.floor((seamX[0] + seamX[1]) / 2);
		const flatY = cleanRow;
		const [fx, fy] = decode(flatX, flatY);
		expect(Math.abs(fx)).toBeLessThan(0.01);
		expect(Math.abs(fy)).toBeLessThan(0.01);

		/*
		 * The two texels **straddling** a groove centre tilt opposite ways — a
		 * groove, not a step. A map that emitted the same tilt on both sides
		 * would read as a ramp across the whole hull and would pass a
		 * magnitude-only assertion.
		 *
		 * The centre sits between `seamX[1]` and the texel after it, so those are
		 * the two. An earlier version took one texel *outside* the boundary on
		 * each side, which was inside a two-texel groove and is outside a
		 * one-texel one — the assertion silently depended on the groove being
		 * wide, and narrowing it to stop the surface reading as scales is exactly
		 * what broke it.
		 */
		const before = decode(seamX[1], flatY)[0];
		const after = decode((seamX[1] + 1) % size, flatY)[0];
		expect(Math.abs(before)).toBeGreaterThan(0.02);
		expect(Math.abs(after)).toBeGreaterThan(0.02);
		expect(Math.sign(before)).toBe(-Math.sign(after));
	});

	test("every texel decodes to a unit vector", () => {
		// Reduced to one assertion rather than 16,384: the fact is "the worst
		// texel is still unit length", and asserting it per texel spends 16k
		// expect() calls to say it while naming no offender when it fails.
		let worst = 0;
		let at = -1;
		for (let i = 0; i < size * size; i++) {
			const x = normals[i * 4] / 255 - 0.5;
			const y = normals[i * 4 + 1] / 255 - 0.5;
			const z = normals[i * 4 + 2] / 255 - 0.5;
			const off = Math.abs(Math.hypot(x, y, z) * 2 - 1);
			if (off > worst) {
				worst = off;
				at = i;
			}
		}
		expect({ worst: worst < 0.05, at }).toEqual({ worst: true, at });
	});

	test("a profile with no seam depth is flat everywhere", () => {
		// The station case, and the control for the assertions above: the same
		// generator over the same boundaries, with the one term that makes it a
		// surface set to zero.
		const flat = seamNormalTexels({ ...SHIP_PLATING, seamDepth: 0 }, size);
		// One assertion, and the *first* offending texel rather than a count, so
		// a failure names where the map stopped being flat.
		let offender = -1;
		for (let i = 0; i < size * size && offender < 0; i++)
			if (
				flat[i * 4] !== 128 ||
				flat[i * 4 + 1] !== 128 ||
				flat[i * 4 + 2] !== 255
			)
				offender = i;
		expect(offender).toBe(-1);
	});
});

describe("a plate is the same ruler on a ship and on a station", () => {
	test("the ship plate is about a metre and the station plate about nineteen", () => {
		// `hullLoft` writes its UVs in kilometres, so a panel *size* is
		// `panelKm / panels across the map` and the two consumers differ by one
		// constant rather than by a system. Written as arithmetic on the shipped
		// figures so a change to either profile moves this line.
		const plateM = (panelKm: number, mapPx: number, pitchPx: number) =>
			(panelKm / Math.round(mapPx / pitchPx)) * 1000;
		const ship = plateLayout(SHIP_PLATING, SHIP_MAP_SIZE);
		// One metre across and four along: a hull is planked lengthwise, and a
		// square plate is what read as scales.
		expect(
			plateM(SHIP_PANEL_KM, SHIP_MAP_SIZE, SHIP_PLATING.pitchPx),
		).toBeCloseTo(1, 1);
		expect((SHIP_PANEL_KM / ship.rows) * 1000).toBeCloseTo(4, 1);
		// `STATION_PANEL_KM` is **imported**, not restated. It was written as the
		// literal 0.15 under a comment claiming a change to either profile would
		// move this line — which was false in exactly the direction that matters:
		// doubling the station's panel size would have doubled every station
		// plate while this test, and the "~19 m" in `ship-visuals.md` and
		// `CLAUDE.md`, stayed green.
		expect(
			plateM(
				STATION_PANEL_KM,
				PLATE_TEXTURE_SIZE,
				STATION_VISUALS.trade.plating.pitchPx,
			),
		).toBeCloseTo(18.75, 1);
	});
});

describe("plate UVs are divided exactly once", () => {
	const ring = () => {
		const g = hullLoft([
			{ z: -0.01, w: 0.004, h: 0.003 },
			{ z: 0.01, w: 0.004, h: 0.003 },
		]);
		return g;
	};

	test("a second call leaves the UVs where the first put them", () => {
		const geometry = ring();
		const before = (geometry.getAttribute("uv") as THREE.BufferAttribute).getX(
			3,
		);
		plateUVs(geometry);
		const once = (geometry.getAttribute("uv") as THREE.BufferAttribute).getX(3);
		plateUVs(geometry);
		const twice = (geometry.getAttribute("uv") as THREE.BufferAttribute).getX(
			3,
		);
		expect(once).not.toBe(before);
		expect(twice).toBe(once);
	});

	test("and a clone taken before its source was plated gets its own division", () => {
		/*
		 * The guard used to be a boolean in `userData`, and three's
		 * `BufferGeometry.copy` assigns `userData` **by reference** — so a clone
		 * and its source share one object while owning separate UV buffers.
		 * Plating the source flipped the clone's flag too, and the clone kept
		 * kilometre UVs: plates 125 times too large on one side of the ship only.
		 * `mirrorX` is exactly that clone.
		 *
		 * The comment claimed the guard prevented this and nothing exercised it.
		 */
		const source = ring();
		// A bare `clone()`, deliberately: `mirrorX` happens to spread `userData`
		// into a fresh object, so testing through it would test that spread
		// rather than this guard. The hazard is the raw copy, and the fix is
		// that plating replaces the *source's* bag instead of mutating the one
		// they share.
		const clone = source.clone();
		expect(clone.userData).toBe(source.userData);
		plateUVs(source);
		const beforeClone = (
			clone.getAttribute("uv") as THREE.BufferAttribute
		).getX(3);
		plateUVs(clone);
		const afterClone = (clone.getAttribute("uv") as THREE.BufferAttribute).getX(
			3,
		);
		expect(afterClone).not.toBe(beforeClone);
		expect(afterClone).toBeCloseTo(
			(source.getAttribute("uv") as THREE.BufferAttribute).getX(3),
			6,
		);
	});
});

describe("the crease term reads a hull's own edges", () => {
	/** A constant section: no `hard` station, no taper. Whatever this reads on
	 *  its swept surface is the floor the measurement has to clear. */
	const cylinder = hullLoft([
		{ z: -0.02, w: 0.006, h: 0.005 },
		{ z: 0, w: 0.006, h: 0.005 },
		{ z: 0.02, w: 0.006, h: 0.005 },
	]);
	/** The same tube with a shoulder marked hard and a step behind it, which is
	 *  what `ship-visuals.md` §2 says stops a hull reading as inflated. */
	const stepped = hullLoft([
		{ z: -0.02, w: 0.006, h: 0.005 },
		{ z: 0, w: 0.006, h: 0.005, hard: true },
		{ z: 0.0008, w: 0.0015, h: 0.0012 },
		{ z: 0.02, w: 0.0015, h: 0.0012 },
	]);

	/**
	 * The peak crease on the **swept surface only**.
	 *
	 * Whole-geometry peak cannot tell these two apart and would have shipped as
	 * a check: both hulls have end caps, a cap meets the tube at a right angle,
	 * and that is a real edge reading 1.0 on either. What separates them is the
	 * crease along the sweep — which is also the only part a plated surface
	 * shows the player. Cap vertices are appended after the tube, so the tube is
	 * everything before the first cap's own ring.
	 */
	const tubePeak = (geometry: THREE.BufferGeometry) => {
		const crease = geometry.getAttribute("crease");
		const caps = geometry.userData.caps as { front: number; rear: number };
		const end = Math.min(caps.front, caps.rear) - (RING_SEGMENTS + 1);
		// Unguarded, an early cap gives `end <= 0`, an empty loop and a peak of
		// 0 — which satisfies the "constant section does not crease" assertion
		// without reading a single vertex.
		expect(end).toBeGreaterThan(0);
		let max = 0;
		for (let i = 0; i < end; i++) max = Math.max(max, crease.getX(i));
		return max;
	};

	test("every lofted geometry carries the attribute", () => {
		const crease = cylinder.getAttribute("crease");
		expect(crease).toBeTruthy();
		expect(crease.itemSize).toBe(1);
		expect(crease.count).toBe(cylinder.getAttribute("position").count);
	});

	test("a hard shoulder creases and a constant section does not", () => {
		// Both directions, because either alone passes on a constant: a term
		// wired to 0 fails the first line and one wired to 1 fails the second.
		expect(tubePeak(stepped)).toBeGreaterThan(0.6);
		expect(tubePeak(cylinder)).toBeLessThan(0.2);
	});

	test("every shipped hull's edges are a minority of it", () => {
		/*
		 * The synthetic pair above says the term *can* discriminate. This says it
		 * discriminates on the geometry the game draws — and it sweeps the whole
		 * roster rather than one hull, because the first version of this test
		 * measured the courier and the spec then quoted its reading as a property
		 * of the term. It was not one: the courier saturates on 2.40% of its
		 * vertices and the **dreadnought on none at all**, which is a fact about
		 * how sharp a hull's creases are and not about whether the term works.
		 *
		 * Both ends are asserted, because each alone passes on a constant. A term
		 * wired to 0 reads 100% zero and fails the upper bound; one wired to 1
		 * reads 0% zero and fails the lower. The hard-edge share is the "there
		 * are edges at all" half, and its floor is well under the quietest hull.
		 *
		 * Measured across the eleven archetypes under `stock`: zero
		 * 70.8%-81.4%, hard edges 1.58%-7.15%. Under `worn`, the default since
		 * #202's second sheet, zero 59.7%-79.7% and hard 8.4%-25.6%: the
		 * flanged collar is a loft of hard rings on every station and the open
		 * bell folds twice, so a hull whose hoops are much of its vertex count
		 * — the dreadnought, the miner — is a quarter hard edge. Still a
		 * minority, which is what the bounds say; they were widened once, for
		 * that, and the reason is here rather than in a wider number alone.
		 */
		for (const id of HULL_IDS) {
			const values: number[] = [];
			buildShipMesh(id).root.traverse((object) => {
				const attribute = (object as THREE.Mesh).geometry?.getAttribute?.(
					"crease",
				);
				if (!attribute) return;
				for (let i = 0; i < attribute.count; i++)
					values.push(attribute.getX(i));
			});
			expect(values.length).toBeGreaterThan(1000);
			const share = (of: (v: number) => boolean) =>
				values.filter(of).length / values.length;
			const zero = share((v) => v === 0);
			const hard = share((v) => v > 0.6);
			expect({ id, zero: zero > 0.5 && zero < 0.9 }).toEqual({
				id,
				zero: true,
			});
			expect({ id, hard: hard > 0.005 && hard < 0.35 }).toEqual({
				id,
				hard: true,
			});
		}
	});
});

describe("one wear map, four paints", () => {
	test("every plated material renders a clean plate at its own #35 finish", () => {
		/*
		 * The check the contact sheet could not make, and the one round two
		 * caught by reading the diff.
		 *
		 * `MeshStandardMaterial` multiplies `roughness` by the wear map's green
		 * channel and `metalness` by its blue, so the scalar is a per-material
		 * dial over one shared curve. Two builds got it wrong in opposite
		 * directions and both were green everywhere:
		 *
		 *  - #35's 0.50/0.30 written into the *profile* read a ceiling as a
		 *    value: a clean plate came out at 0.35, the hull was 30% smoother
		 *    than it had ever been, and the star-facing nacelle clipped to white.
		 *  - Ceilings that fixed the hull, with `material.roughness` forced to 1,
		 *    silently repainted the other three — `panel`, `trim` and `accent`
		 *    all rendered at the hull's finish, halving `trim`'s metalness.
		 *
		 * So the assertion is over **all four**, not the hull alone, and it is
		 * the product the shader actually forms rather than either factor.
		 */
		const { roughness: cleanG, metalness: cleanB } = cleanPlateFactors();
		const seen: string[] = [];
		buildShipMesh("courier").root.traverse((object) => {
			const material = (object as THREE.Mesh)
				.material as THREE.MeshStandardMaterial;
			const finish = material?.userData?.finish as
				| { roughness: number; metalness: number }
				| undefined;
			if (!finish || seen.includes(material.uuid)) return;
			seen.push(material.uuid);
			// Banded at 0.02, and the basis is the same as the ruler's: one
			// 8-bit step is 0.0039 and the plate's own variation is ±13 of 255
			// before the wear curve compresses it, so a tighter band asserts the
			// quantisation. The repaint this catches moved `trim`'s metalness by
			// 0.25 — twelve bands.
			expect(
				Math.abs(material.roughness * cleanG - finish.roughness),
			).toBeLessThan(0.02);
			expect(
				Math.abs(material.metalness * cleanB - finish.metalness),
			).toBeLessThan(0.02);
		});
		// The control: an empty traverse would satisfy every assertion above.
		// Four paints — hull, panel, trim, accent — and no more.
		expect(seen.length).toBe(4);
		// **And the clamp must not be doing any work.** `plate` writes
		// `Math.min(1, finish / clean)`, so a finish above the clean-plate
		// reading — 0.70 for roughness today — would render below what was asked
		// for with no signal, which is the same silent-repaint class as the
		// round-two blocker. Asserted here so the clamp is a bound that never
		// binds rather than a default nobody notices.
		expect(cleanG).toBeGreaterThan(0.6);
		expect(cleanB).toBeGreaterThan(0.6);
	});

	test("and the four finishes are actually different from each other", () => {
		// Without this, a build that flattened all four to one value would pass
		// the test above by also flattening what it compares against.
		const finishes: string[] = [];
		buildShipMesh("courier").root.traverse((object) => {
			const material = (object as THREE.Mesh)
				.material as THREE.MeshStandardMaterial;
			const finish = material?.userData?.finish as
				| { roughness: number; metalness: number }
				| undefined;
			if (finish) finishes.push(`${finish.roughness}/${finish.metalness}`);
		});
		expect(new Set(finishes).size).toBe(4);
	});

	test("and a seam is rougher and less metallic than the plate it sits on", () => {
		// The other direction, so the assertion above cannot be satisfied by a
		// map that is one flat value: the whole reason for a wear map is that the
		// seams differ from the plate.
		const albedo = plateTexels(SHIP_PLATING, "ship");
		const wear = wearTexels(SHIP_PLATING, albedo);
		const size = SHIP_MAP_SIZE;
		const layout = plateLayout(SHIP_PLATING, size);
		const at = (x: number, y: number, channel: number) =>
			wear[(y * size + x) * 4 + channel] / 255;
		// A row and a seam column on it, plus a column in the middle of the
		// plate beside it.
		const y = 1;
		const row = layout.rowOf(y);
		const seams: number[] = [];
		for (let x = 0; x < size; x++)
			if (layout.colOf(x, row) !== layout.colOf((x + 1) % size, row))
				seams.push(x);
		const plateX = Math.floor((seams[0] + seams[1]) / 2);
		expect(at(seams[1], y, 1)).toBeGreaterThan(at(plateX, y, 1));
		expect(at(seams[1], y, 2)).toBeLessThan(at(plateX, y, 2));
	});
});
