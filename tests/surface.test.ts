/**
 * The shared surface generator (#101).
 *
 * `src/surface.ts` is what #36's station plating became when #101 gave it a
 * second and a third consumer. The tests here are in three groups, and the
 * grouping is the argument:
 *
 * 1. **The station's output did not move.** The refactor is only worth doing if
 *    it is provably behaviour-preserving, and "provably" here means an absolute
 *    checksum of every buffer, captured from the build before the change. A
 *    structural assertion that the wrapper calls the generator would pass on a
 *    generator that had been retuned.
 * 2. **The new normal map is in register with the albedo it is derived from.**
 *    #36 recorded the failure this prevents — a shine that misses its own seam —
 *    and an embossed seam that misses its own painted one is the same defect
 *    one channel over.
 * 3. **The crease term separates a hull that has edges from one that does not.**
 *    Per the map: a check that could pass on a build ignoring the thing it
 *    checks is not a check. Both directions are asserted, so neither a
 *    constant 0 nor a constant 1 survives.
 */

import { describe, expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";
import * as THREE from "three";
import { RING_SEGMENTS, hullLoft } from "../src/loft";
import { buildShipMesh } from "../src/ship-mesh";
import { STATION_PANEL_KM } from "../src/station-mesh";
import { SHIP_PANEL_KM, SHIP_PLATING } from "../src/ship-surface";
import {
	PLATE_TEXTURE_SIZE,
	plateTexels,
	seamNormalTexels,
	seamOffsets,
	wearTexels,
} from "../src/surface";
import {
	STATION_VISUALS,
	platingTexels,
	surfaceTexels,
} from "../src/station-visuals";
import { STATION_TYPES } from "../src/station";

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
	const size = PLATE_TEXTURE_SIZE;
	const albedo = plateTexels(SHIP_PLATING, "ship");
	const normals = seamNormalTexels(SHIP_PLATING);
	const { x: seamX, y: seamY } = seamOffsets(SHIP_PLATING, size);

	test("both channels derive their seams from one boundary set", () => {
		// The albedo darkens a texel when the next one belongs to another panel;
		// the normal map grooves the same boundaries. Asserted as set equality
		// rather than as a count, because two sets of the same size in different
		// places is exactly the defect.
		expect(seamX.length).toBeGreaterThan(1);
		expect(seamY.length).toBe(seamX.length);
		for (const x of seamX) expect(x).toBeLessThan(size);
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
		const mid = (a: number, b: number) => Math.floor((a + b) / 2);
		const flatX = mid(seamX[0], seamX[1]);
		const flatY = mid(seamY[0], seamY[1]);
		const [fx, fy] = decode(flatX, flatY);
		expect(Math.abs(fx)).toBeLessThan(0.01);
		expect(Math.abs(fy)).toBeLessThan(0.01);

		// One texel to either side of a boundary the surface tilts, and the two
		// sides tilt *opposite ways* — a groove, not a step. A map that emitted
		// the same tilt on both sides would read as a ramp across the whole
		// hull, and it would pass a magnitude-only assertion.
		const before = decode((seamX[1] - 1 + size) % size, flatY)[0];
		const after = decode((seamX[1] + 1) % size, flatY)[0];
		expect(Math.abs(before)).toBeGreaterThan(0.02);
		expect(Math.abs(after)).toBeGreaterThan(0.02);
		expect(Math.sign(before)).toBe(-Math.sign(after));
	});

	test("every texel decodes to a unit vector", () => {
		for (let i = 0; i < size * size; i++) {
			const x = normals[i * 4] / 255 - 0.5;
			const y = normals[i * 4 + 1] / 255 - 0.5;
			const z = normals[i * 4 + 2] / 255 - 0.5;
			expect(Math.hypot(x, y, z) * 2).toBeCloseTo(1, 1);
		}
	});

	test("a profile with no seam depth is flat everywhere", () => {
		// The station case, and the control for the assertions above: the same
		// generator over the same boundaries, with the one term that makes it a
		// surface set to zero.
		const flat = seamNormalTexels({ ...SHIP_PLATING, seamDepth: 0 });
		for (let i = 0; i < size * size; i++) {
			expect(flat[i * 4]).toBe(128);
			expect(flat[i * 4 + 1]).toBe(128);
			expect(flat[i * 4 + 2]).toBe(255);
		}
	});
});

describe("a plate is the same ruler on a ship and on a station", () => {
	test("the ship plate is about a metre and the station plate about nineteen", () => {
		// `hullLoft` writes its UVs in kilometres, so a panel *size* is
		// `panelKm / panels across the map` and the two consumers differ by one
		// constant rather than by a system. Written as arithmetic on the shipped
		// figures so a change to either profile moves this line.
		const plateM = (panelKm: number, pitchPx: number) =>
			(panelKm / Math.round(PLATE_TEXTURE_SIZE / pitchPx)) * 1000;
		expect(plateM(SHIP_PANEL_KM, SHIP_PLATING.pitchPx)).toBeCloseTo(1, 1);
		// `STATION_PANEL_KM` is **imported**, not restated. It was written as the
		// literal 0.15 under a comment claiming a change to either profile would
		// move this line — which was false in exactly the direction that matters:
		// doubling the station's panel size would have doubled every station
		// plate while this test, and the "~19 m" in `ship-visuals.md` and
		// `CLAUDE.md`, stayed green.
		expect(
			plateM(STATION_PANEL_KM, STATION_VISUALS.trade.plating.pitchPx),
		).toBeCloseTo(18.75, 1);
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

	test("a shipped hull's edges are a minority of it, and they saturate", () => {
		// The synthetic pair above says the term *can* discriminate. This says it
		// discriminates on the geometry the game actually draws — where the
		// failure that matters is not a wrong number but a term that reads high
		// everywhere, which would roughen and lighten the whole hull and read as
		// a flat wash rather than as wear.
		const values: number[] = [];
		buildShipMesh("courier").root.traverse((object) => {
			const attribute = (object as THREE.Mesh).geometry?.getAttribute?.(
				"crease",
			);
			if (!attribute) return;
			for (let i = 0; i < attribute.count; i++) values.push(attribute.getX(i));
		});
		expect(values.length).toBeGreaterThan(1000);
		const zero = values.filter((v) => v === 0).length / values.length;
		expect(zero).toBeGreaterThan(0.7);
		expect(Math.max(...values)).toBe(1);
	});
});

describe("a profile figure is a ceiling, not a value", () => {
	test("a clean ship plate lands on #35's painted finish", () => {
		/*
		 * The check the contact sheet had to stand in for.
		 *
		 * `wearTexels` writes `roughness × (0.55 + 0.45 × wear)`, so the profile
		 * figure is what the *seams* reach and never what the plate reads. The
		 * first `SHIP_PLATING` put `makePalette`'s 0.50 and 0.30 into those slots,
		 * which put a clean plate at roughness 0.35 — 30% smoother than the hull
		 * had ever been. A smoother metal mirrors the baked star into a tighter
		 * lobe, and the star-facing nacelle in `hull-chase` clipped to white and
		 * spilled bloom under the hull.
		 *
		 * Nothing could see it: both figures were exactly the numbers
		 * `ship-visuals.md` said the livery used, every buffer was the right
		 * length, and every probe was green. What separates the two builds is the
		 * value a clean plate actually carries, so that is what is asserted —
		 * against the livery finish it has to reproduce, not against itself.
		 */
		const albedo = plateTexels(SHIP_PLATING, "ship");
		const wear = wearTexels(SHIP_PLATING, albedo);
		// The modal plate texel: the map is mostly clean plate, so the median of
		// the roughness channel is the plate's own value rather than a seam's.
		const median = (channel: number) => {
			const values: number[] = [];
			for (let i = 0; i < PLATE_TEXTURE_SIZE ** 2; i++)
				values.push(wear[i * 4 + channel]);
			values.sort((a, b) => a - b);
			return values[Math.floor(values.length / 2)] / 255;
		};
		/*
		 * Banded at 0.02, and the basis matters more than the number. One 8-bit
		 * step is 0.0039, and the plate's own panel-to-panel variation is ±13 of
		 * 255 before the wear curve compresses it — so a tighter band would be
		 * asserting the quantisation and the noise rather than the finish.
		 * Measured: 0.510 and 0.294. The build this catches read 0.35 and 0.22,
		 * which is seven and four bands away.
		 */
		expect(Math.abs(median(1) - 0.5)).toBeLessThan(0.02);
		expect(Math.abs(median(2) - 0.3)).toBeLessThan(0.02);
	});

	test("and a seam is rougher and less metallic than the plate it sits on", () => {
		// The other direction, so the assertion above cannot be satisfied by a
		// map that is one flat value: the whole reason for a wear map is that the
		// seams differ from the plate.
		const albedo = plateTexels(SHIP_PLATING, "ship");
		const wear = wearTexels(SHIP_PLATING, albedo);
		const { x: seams } = seamOffsets(SHIP_PLATING, PLATE_TEXTURE_SIZE);
		const at = (x: number, y: number, channel: number) =>
			wear[(y * PLATE_TEXTURE_SIZE + x) * 4 + channel] / 255;
		const y = Math.floor((seams[0] + seams[1]) / 2);
		const plateX = Math.floor((seams[0] + seams[1]) / 2);
		expect(at(seams[1], y, 1)).toBeGreaterThan(at(plateX, y, 1));
		expect(at(seams[1], y, 2)).toBeLessThan(at(plateX, y, 2));
	});
});
