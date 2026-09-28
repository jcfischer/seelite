/**
 * #105's cockpit surface: the plating profile, the UV writer that reaches the
 * cabin's box primitives, the quality gate, and the trim's colour.
 *
 * The three claims worth a headless test are the three that were got wrong on
 * the hull. **A plate is a size, not a count** — `ship-surface.ts:437` — so a
 * bigger fitting must carry more plates, not larger ones. **Each material keeps
 * its own finish** — the round-two blocker on #101, where forcing `roughness`
 * to 1 repainted three paints as one under a docstring saying nothing was
 * repainted. And **the gate has to be able to put the map back**, which is a
 * behaviour rather than a constant.
 *
 * What is deliberately not here: whether the panel size, the seam depth or the
 * trim's brightness are *right*. Those are #104's class of number — a figure
 * that decides whether a frame is worth looking at cannot be verified by
 * anything that is not looking — and they are settled on the contact sheet.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	COCKPIT_MAP_SIZE,
	COCKPIT_PANEL_KM,
	COCKPIT_PLATING,
	COCKPIT_QUALITY,
	COCKPIT_FINISHES,
	COCKPIT_FINISH_IDS,
	COCKPIT_LAMP,
	COCKPIT_LAMP_POOL,
	applyCockpitQuality,
	calibratedProfile,
	cockpitCleanPlate,
	cockpitMaterial,
	dial,
	lampPoolAcross,
	lampPoolRamp,
	plateCockpitUVs,
	railLampPools,
	railLamps,
} from "../src/cockpit-surface";
import {
	CANOPY_RAIL_RADIUS_KM,
	CANOPY_SIDE_RAILS,
} from "../src/cockpit-canopy";
import { EMISSIVE_CEILING } from "../src/light-rig";
import { uvUnitsOf } from "../src/loft";

/** The UV extent of a geometry, in plate units, per axis. */
function uvSpan(geometry: THREE.BufferGeometry) {
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	let minU = Number.POSITIVE_INFINITY;
	let maxU = Number.NEGATIVE_INFINITY;
	let minV = Number.POSITIVE_INFINITY;
	let maxV = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < uv.count; i++) {
		minU = Math.min(minU, uv.getX(i));
		maxU = Math.max(maxU, uv.getX(i));
		minV = Math.min(minV, uv.getY(i));
		maxV = Math.max(maxV, uv.getY(i));
	}
	return { u: maxU - minU, v: maxV - minV };
}

/** How many plates a run of `km` carries, given the profile's own layout. */
const platesAcross = (km: number) =>
	(km / COCKPIT_PANEL_KM) * (COCKPIT_MAP_SIZE / COCKPIT_PLATING.pitchPx);

describe("the cabin's UVs are written in its own kilometres", () => {
	test("a fitting's UV span is its size divided by the panel", () => {
		// The scanner deck, `main.ts`'s own figures: 0.032 x 0.0016 x 0.022 km.
		const deck = plateCockpitUVs(new THREE.BoxGeometry(0.032, 0.0016, 0.022));
		const { u, v } = uvSpan(deck);
		// Box projection sends each face to the axis plane it most faces, so the
		// widest run in each axis is the largest of the box's own dimensions on
		// that axis — the deck's 0.032 across and 0.022 along.
		expect(u).toBeCloseTo(0.032 / COCKPIT_PANEL_KM, 6);
		expect(v).toBeCloseTo(0.022 / COCKPIT_PANEL_KM, 6);
		expect(uvUnitsOf(deck)).toBe("plate");
	});

	test("a fitting twice the size carries twice the plates, not larger ones", () => {
		// **The rule a count gets wrong.** Multiplying a normalised unwrap by a
		// fixed count gives a 32 m deck and a 100 m coaming the same number of
		// bands, so one is coarse and the other a smear — `ship-surface.ts:437`.
		// This is the assertion that separates the two implementations.
		const small = uvSpan(
			plateCockpitUVs(new THREE.BoxGeometry(0.02, 0.002, 0.02)),
		);
		const large = uvSpan(
			plateCockpitUVs(new THREE.BoxGeometry(0.04, 0.002, 0.04)),
		);
		expect(large.u).toBeCloseTo(small.u * 2, 6);
		expect(large.v).toBeCloseTo(small.v * 2, 6);
	});

	test("re-writing a geometry's UVs does not divide them twice", () => {
		// `plateCockpitUVs` writes UVs from the positions rather than scaling
		// what is there, so a second pass is a no-op by construction. Asserted
		// because `plateUVs` on the ship side *does* scale, and a reader moving
		// between the two would reasonably expect the same hazard.
		const once = plateCockpitUVs(new THREE.BoxGeometry(0.032, 0.0016, 0.022));
		const first = uvSpan(once);
		const twice = plateCockpitUVs(once);
		expect(uvSpan(twice)).toEqual(first);
	});

	test("the deck carries a few real seams, not a grid", () => {
		// **The band that records the principal's ruling.** The first pass put
		// about eleven plates across the deck and the cabin was rejected against
		// the reference: an Elite interior is a moulding with a rare join, not a
		// planked surface. Under 6 is what "sparse" means here; over 2 keeps at
		// least one genuine seam on the cabin's biggest form. It is not the claim
		// that 3.6 is *right* — that is the contact sheet's.
		const across = platesAcross(0.032);
		expect(across).toBeGreaterThan(2);
		expect(across).toBeLessThan(6);
	});
});

describe("the profile", () => {
	test("is a brick bond rather than a square grid", () => {
		// #101 shipped a square grid with a quarter-plate bevel and it was
		// rejected as *scales* by the principal on the first frame flown. The
		// three fields that caused it are these; nothing else in the repo stops
		// them going back.
		expect(COCKPIT_PLATING.aspect).toBeGreaterThan(1);
		expect(COCKPIT_PLATING.stagger).toBeGreaterThan(0);
		const plateWidthPx = COCKPIT_PLATING.pitchPx;
		expect(COCKPIT_PLATING.seamHalfWidthPx / plateWidthPx).toBeLessThan(0.1);
	});

	test("cuts its seams, which is what the low setting drops", () => {
		expect(COCKPIT_PLATING.seamDepth).toBeGreaterThan(0);
		expect(COCKPIT_QUALITY.high.seamNormals).toBe(true);
		expect(COCKPIT_QUALITY.low.seamNormals).toBe(false);
	});
});

describe("plating a cabin material", () => {
	test("each material still renders at the finish it arrived with", () => {
		// **#101's round-two blocker, one surface over.** Forcing `roughness` and
		// `metalness` to 1 rendered every paint at whatever the map's clean plate
		// happened to be — a repaint shipped under a docstring saying nothing was
		// repainted, green in both tiers. The cabin has four finishes and one
		// shared map, so the scalar has to stay a per-material dial.
		const clean = cockpitCleanPlate();
		for (const id of COCKPIT_FINISH_IDS) {
			const spec = COCKPIT_FINISHES[id];
			const material = cockpitMaterial(id);
			expect(material.userData.finish).toEqual({
				roughness: spec.roughness,
				metalness: spec.metalness,
			});
			// What a clean plate renders: the dial times the map's own reading.
			expect(material.roughness * clean.roughness).toBeCloseTo(
				spec.roughness,
				5,
			);
			expect(material.metalness * clean.metalness).toBeCloseTo(
				spec.metalness,
				5,
			);
		}
	});

	test("the finishes stay distinct from one another", () => {
		// The failure above was not that a number was wrong, it was that three
		// numbers became one. Stated as a difference so a scheme that preserved
		// the *ratio* but collapsed the spread would still fail.
		const rendered = COCKPIT_FINISH_IDS.map((id) => {
			const m = cockpitMaterial(id);
			return `${m.roughness.toFixed(4)}/${m.metalness.toFixed(4)}`;
		});
		expect(new Set(rendered).size).toBe(COCKPIT_FINISH_IDS.length);
	});

	test("the calibration lifts the curve just enough to express the cabin", () => {
		// The clamp this replaces: the cabin's roughest finish is 0.72 and a
		// clean plate at profile 1 reads 0.702, so `metal`'s dial wanted 1.026
		// and `Math.min(1, …)` would have rendered it at 0.702 — the repaint
		// above, arriving through the other door. Banded, because the figure is
		// a consequence of `variation`, `seam` and `weathering` rather than a
		// number anybody chose.
		const profile = calibratedProfile();
		expect(profile.roughness).toBeGreaterThan(1);
		expect(profile.roughness).toBeLessThan(1.15);
		// Metalness needed none: the cabin's most metallic finish is 0.72
		// against a clean plate of 0.726.
		expect(profile.metalness).toBe(1);
	});

	test("a finish the wear curve cannot express is refused, not clamped", () => {
		// Proof the guard can go red — #11's finding: build the defect it names
		// and watch it fail. `dial` rather than a material, because `plateCockpit`
		// is no longer exported: a public one was the call-site door that let a
		// finish reach the maps without the calibration having seen it.
		expect(() => dial("roughness", 0.9, 0.7)).toThrow(/dial/);
		expect(dial("roughness", 0.7, 0.7)).toBeCloseTo(1, 12);
	});

	test("every declared finish is expressible against the shipped clean plate", () => {
		// **The failure to boot that this replaces.** The calibration solved its lift
		// against the *unlifted* pass and shipped the result unchecked, but the
		// wear map is bytes and `cleanPlate` reads `median / 255` — so a lifted
		// pass landing one texel low leaves the dial at 1.003 and
		// `cockpitMaterial("metal")` throws inside `Game`'s constructor. The cabin
		// would not boot, off a quantisation of one part in 255.
		//
		// This is the invariant `calibrate`'s loop now guarantees, asserted
		// against the buffer that actually ships rather than against the target.
		const clean = cockpitCleanPlate();
		for (const id of COCKPIT_FINISH_IDS) {
			const spec = COCKPIT_FINISHES[id];
			expect(spec.roughness / clean.roughness).toBeLessThanOrEqual(1);
			expect(spec.metalness / clean.metalness).toBeLessThanOrEqual(1);
		}
	});
});

describe("the face finish (#204)", () => {
	/** Relative luminance of an sRGB hex, 0..1 — enough to rank paints. */
	const luma = (hex: number) => {
		const c = new THREE.Color(hex);
		return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
	};

	test("the cabin has four finishes, and face is one of them", () => {
		expect(COCKPIT_FINISH_IDS).toEqual(["metal", "trim", "inset", "face"]);
	});

	test("face is a mid-tone: brighter than every finish the cabin had", () => {
		// The node opened on 40% of the frame being a near-black slab with
		// nothing to catch a highlight. A fourth finish that was one more
		// near-black would pass every dial check and change nothing.
		for (const id of ["metal", "trim", "inset"] as const)
			expect(luma(COCKPIT_FINISHES.face.color)).toBeGreaterThan(
				2 * luma(COCKPIT_FINISHES[id].color),
			);
	});

	test("face sits under the roughest finish, so the calibration is unmoved", () => {
		// `CLAUDE.md`, "A material dial cannot exceed 1": a finish above 0.72
		// would lift the wear curve and repaint the other three.
		expect(COCKPIT_FINISHES.face.roughness).toBeLessThan(
			COCKPIT_FINISHES.metal.roughness,
		);
		expect(COCKPIT_FINISHES.face.metalness).toBeLessThan(
			COCKPIT_FINISHES.trim.metalness,
		);
	});
});

describe("the quality gate", () => {
	test("takes the seam map off and puts it back", () => {
		// A behaviour rather than a constant: the gate has to *restore*, which is
		// why `ship-surface.ts` holds the materials in a set rather than a count.
		const material = cockpitMaterial("metal");
		applyCockpitQuality("high");
		expect(material.normalMap).not.toBeNull();
		applyCockpitQuality("low");
		expect(material.normalMap).toBeNull();
		applyCockpitQuality("high");
		expect(material.normalMap).not.toBeNull();
	});

	test("a material plated while low is in force arrives without the map", () => {
		// Palettes are built lazily, so a material can first reach `plateCockpit`
		// long after the player moved the setting — `ship-surface.ts:256`. One
		// value, one writer, and the newcomer reads it.
		applyCockpitQuality("low");
		const late = cockpitMaterial("inset");
		expect(late.normalMap).toBeNull();
		applyCockpitQuality("high");
	});
});

describe("the canopy-frame lamps", () => {
	test("is not one of the HUD's reading colours", () => {
		// §4 of `hud-and-scanner.md` gives amber, cyan, green and red meanings as
		// *readings*. A lamp on the canopy frame glowing in one of them is a
		// reading the player cannot act on, so it is deliberately near-neutral:
		// warmth without a signal. **This is where the reference is knowingly
		// diverged from** — those cockpits' canopy lamps are red, and red is §4's
		// refusal colour in this game. A retune that saturates it fails here.
		const r = (COCKPIT_LAMP.color >> 16) & 255;
		const g = (COCKPIT_LAMP.color >> 8) & 255;
		const b = COCKPIT_LAMP.color & 255;
		const max = Math.max(r, g, b);
		const saturation = (max - Math.min(r, g, b)) / max;
		expect(saturation).toBeLessThan(0.45);
		// Warm rather than cool: the reference cabins are lit from inside, which
		// is the half of #105's first question the light alone does not answer.
		expect(r).toBeGreaterThan(b);
	});

	test("there are a few of them, not a strip", () => {
		// The first pass ran continuous lit bars, which is the thing the
		// reference does not do. Three stops a rail, and a stop is a fraction of
		// the rail's own run so a lamp cannot float beside the rail it is on.
		expect(COCKPIT_LAMP.stops.length).toBe(3);
		for (const t of COCKPIT_LAMP.stops) {
			expect(t).toBeGreaterThan(0);
			expect(t).toBeLessThan(1);
		}
	});
});

describe("the pools the lamps leave on the rail (#204)", () => {
	const rail = CANOPY_SIDE_RAILS[0];
	const pools = () => railLampPools(rail.from, rail.to, CANOPY_RAIL_RADIUS_KM);

	test("one pool under each lamp", () => {
		expect(pools()).toHaveLength(railLamps(rail.from, rail.to).length);
	});

	test("each pool starts at its lamp and runs down the rail toward the sill", () => {
		// `from` is the sill end. A pool running up the rail would be light
		// falling upward; one centred on the lamp would be a halo, not a pool.
		const from = new THREE.Vector3(...rail.from);
		const to = new THREE.Vector3(...rail.to);
		const run = to.clone().sub(from);
		pools().forEach((pool, i) => {
			const lamp = from.clone().addScaledVector(run, COCKPIT_LAMP.stops[i]);
			// In the rail's own plane: the strip also stands off it toward the
			// pilot, which the next test holds.
			const toward = pool.position.clone().sub(lamp).setZ(0);
			expect(toward.length()).toBeCloseTo(COCKPIT_LAMP_POOL.lengthKm / 2, 9);
			// Down the rail: opposite the run from sill to header.
			expect(toward.normalize().dot(run.clone().normalize())).toBeCloseTo(
				-1,
				6,
			);
		});
	});

	test("brightest at the lamp and dark at its far end, by the geometry's own UVs", () => {
		// The ramp is sampled along the sleeve's v; an orientation that flips
		// the sleeve puts the bright end away from the lamp, and only reading
		// the built vertices catches that.
		const from = new THREE.Vector3(...rail.from);
		const run = new THREE.Vector3(...rail.to).sub(from);
		const pool = pools()[1];
		pool.updateMatrixWorld(true);
		const lamp = from.clone().addScaledVector(run, COCKPIT_LAMP.stops[1]);
		const position = pool.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const uv = pool.geometry.getAttribute("uv") as THREE.BufferAttribute;
		let nearV = 0;
		let farV = 0;
		let nearest = Number.POSITIVE_INFINITY;
		let farthest = 0;
		for (let i = 0; i < position.count; i++) {
			const d = new THREE.Vector3()
				.fromBufferAttribute(position, i)
				.applyMatrix4(pool.matrixWorld)
				.distanceTo(lamp);
			if (d < nearest) [nearest, nearV] = [d, uv.getY(i)];
			if (d > farthest) [farthest, farV] = [d, uv.getY(i)];
		}
		expect(lampPoolRamp(nearV)).toBeCloseTo(1, 6);
		expect(lampPoolRamp(farV)).toBeCloseTo(0, 6);
	});

	test("the ramp falls monotonically", () => {
		for (let v = 0; v < 1; v += 0.05)
			expect(lampPoolRamp(v + 0.05)).toBeLessThanOrEqual(lampPoolRamp(v));
	});

	test("a strip on the rail's face toward the pilot, narrower than the rail", () => {
		// **Not a sleeve round the rail**, which was the first build: an
		// additive glow over the whole circumference drew a lit cylinder wider
		// than the dark rail inside it, and the sheet read it as a cream collar
		// rather than as light on metal.
		const pool = pools()[0];
		pool.updateMatrixWorld(true);
		const normal = new THREE.Vector3(0, 0, 1).transformDirection(
			pool.matrixWorld,
		);
		expect(normal.z).toBeCloseTo(1, 9);
		const standoff = pool.position.z - rail.from[2];
		expect(standoff).toBeGreaterThan(CANOPY_RAIL_RADIUS_KM);
		expect(standoff).toBeLessThan(CANOPY_RAIL_RADIUS_KM * 1.2);
		expect(COCKPIT_LAMP_POOL.widthKm).toBeLessThan(2 * CANOPY_RAIL_RADIUS_KM);
	});

	test("the strip fades to nothing at both of its long edges", () => {
		expect(lampPoolAcross(0)).toBeCloseTo(0, 9);
		expect(lampPoolAcross(1)).toBeCloseTo(0, 9);
		expect(lampPoolAcross(0.5)).toBeCloseTo(1, 9);
	});

	test("light added, never shaded, and under the emissive ceiling", () => {
		// A basic material with additive blending: free, lit by nothing, and
		// outside #201's occlusion walk. And the lamp's own warm white, so
		// `hud-and-scanner.md` §4's red-is-refusal is inherited, not re-argued.
		const material = pools()[0].material as THREE.MeshBasicMaterial;
		expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
		expect(material.blending).toBe(THREE.AdditiveBlending);
		expect(material.depthWrite).toBe(false);
		expect(COCKPIT_LAMP_POOL.intensity).toBeLessThanOrEqual(EMISSIVE_CEILING);
		const lamp = new THREE.Color(COCKPIT_LAMP.color).multiplyScalar(
			COCKPIT_LAMP_POOL.intensity,
		);
		expect(material.color.getHex()).toBe(lamp.getHex());
	});

	test("dimmer than the lamp that casts it", () => {
		expect(COCKPIT_LAMP_POOL.intensity).toBeLessThan(COCKPIT_LAMP.intensity);
	});
});
