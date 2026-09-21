/**
 * The lighting environment: what a reflection is a reflection *of*.
 *
 * #99 replaced a flat `AmbientLight` with a hemisphere term and an image-based
 * one, because Elite Dangerous hulls are mostly reading reflections and this
 * game reflected nothing — `scene.environment` was unset repo-wide, so every
 * `metalness` above zero was subtracting diffuse and adding nothing back.
 *
 * What is checked here is the half a browser cannot see cheaply: that the
 * radiance model is deterministic, finite, and shaped like a star — brightest
 * toward the star direction, falling monotonically away from it, never
 * negative. The equirectangular buffer is generated from that model, so the
 * same claims carry to it.
 *
 * **What this file cannot check, said plainly.** It cannot check that the
 * buffer is *oriented* the way `three` samples it. The mapping from a pixel to
 * a direction is stated once, in `light-rig.ts`, and any test here that
 * restated it would agree with it by construction — including a flipped one.
 * What it *can* check, since #99's first review round, is the **rotation**. It
 * lived in `main.ts` as `setFromUnitVectors(BAKE_STAR_UNIT, STAR_DIR)`, where
 * swapping the two arguments — the inverse rotation — left every check in the
 * repo green: the inverse lands the lobe 2θ from the star, and θ was small for
 * the seed the probe flies. Moved into `envRotation` it has a property that a
 * swap breaks and this file sweeps, below.
 *
 * A bake handed to the renderer back-to-front puts the reflection on the side
 * away from the star, which looks wrong and measures fine. That is
 * `probe-light-rig.mjs`'s job: it renders one station front-lit and once more
 * backlit, differences each against the same frame with the environment
 * dropped, and requires the front-lit difference to be the larger. Both halves
 * of that were watched go red on a build with the defect — reversed on a
 * flipped bake, zero on both arms with no bake at all.
 */
import { describe, expect, test } from "bun:test";
import {
	floorUnder,
	HULL_LUMA_BAND,
	HULL_LUMA_CALIBRATION,
	HULL_LUMA_FLOORS,
	HULL_LUMA_MARGINS,
	SHIPPED_BAND_FLOOR,
	SHIPPED_FLOORS,
	SUBJECT_CHANGE_OTHER_ROWS,
	SUBJECT_CHANGE_QUARTILE_DROP,
} from "../scripts/lib/hull-luma.mjs";
import { COCKPIT_EMISSIVE_INTENSITIES } from "../src/cockpit-surface";
import {
	BAKE_STAR_DIR,
	EMISSIVE_CEILING,
	ENV_HEIGHT,
	ENV_WIDTH,
	EXPOSURE,
	envRadiance,
	envRotation,
	equirectEnvironment,
	LIGHT_RIG,
} from "../src/light-rig";
import { DEFAULT_SETTINGS, settingSpec } from "../src/settings";
import { SHIP_EMISSIVE_INTENSITIES } from "../src/ship-mesh";
import { DEFAULT_HULL_FINISH } from "../src/ship-surface";
import { STATION_INTERIOR_EMISSIVE_INTENSITIES } from "../src/station-interior-mesh";
import { STATION_EMISSIVE_INTENSITIES } from "../src/station-mesh";

/** A warm G-type tint, and a neutral one. #59's finding is that the neutral end
 *  is where an emissive tint stops carrying detail; the same palette is used
 *  here so the two ends are both exercised. */
const WARM = 0xfff0d8;
const NEUTRAL = 0xf8f7ff;

const unit = (x: number, y: number, z: number): [number, number, number] => {
	const l = Math.hypot(x, y, z);
	return [x / l, y / l, z / l];
};

/** Directions at a given angle from the star, sampled around the cone so a
 *  result is not an accident of one azimuth. */
function atAngle(deg: number, samples = 8): [number, number, number][] {
	const a = (deg * Math.PI) / 180;
	const out: [number, number, number][] = [];
	for (let i = 0; i < samples; i++) {
		const phi = (i / samples) * Math.PI * 2;
		// BAKE_STAR_DIR is +X, so the cone spans the YZ plane around it.
		out.push(
			unit(
				Math.cos(a),
				Math.sin(a) * Math.cos(phi),
				Math.sin(a) * Math.sin(phi),
			),
		);
	}
	return out;
}

const luma = ([r, g, b]: [number, number, number]) =>
	0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("the radiance model is a star and a floor", () => {
	test("the star direction is the brightest direction there is", () => {
		const at = envRadiance(BAKE_STAR_DIR, WARM);
		for (const d of [10, 45, 90, 135, 180].flatMap((deg) => atAngle(deg)))
			expect(luma(envRadiance(d, WARM))).toBeLessThan(luma(at));
	});

	test("brightness falls off the star, step by step, and never rises again", () => {
		// Every step, not just the ends: a lobe with a bump in it would pass a
		// first-versus-last comparison and read as a second light source.
		//
		// Strict below 90° and flat at or beyond it, which is the model rather
		// than a tolerance: the star terms are clamped at the horizon, so the
		// whole far hemisphere is the floor exactly. Asserting a strict fall
		// there would be asserting a gradient the rig does not have — and the
		// hemisphere light is what supplies one on that side.
		let previous = luma(envRadiance(BAKE_STAR_DIR, WARM));
		for (const deg of [1, 2, 5, 10, 20, 40, 60, 89, 90, 120, 150, 180]) {
			const here = atAngle(deg).map((d) => luma(envRadiance(d, WARM)));
			// The cone is symmetric about the star axis, so every azimuth on it
			// must agree — an asymmetry here is a second term leaking in.
			for (const v of here) expect(v).toBeCloseTo(here[0], 10);
			if (deg < 90) expect(here[0]).toBeLessThan(previous);
			else expect(here[0]).toBeLessThanOrEqual(previous);
			previous = here[0];
		}
	});

	test("the far side is lit, but barely", () => {
		// Space has no ambient light; a screen with no detail in the shadows has
		// no information in it either — the same argument the flat ambient this
		// replaces was added for. The floor is what carries that, so it must be
		// above zero and far below the star.
		const away = luma(envRadiance(atAngle(180)[0], WARM));
		const at = luma(envRadiance(BAKE_STAR_DIR, WARM));
		expect(away).toBeGreaterThan(0);
		expect(away).toBeLessThan(at / 100);
	});

	test("nothing is negative or non-finite, at any tint", () => {
		for (const tint of [WARM, NEUTRAL, 0x000000, 0xffffff])
			for (const deg of [0, 30, 90, 150, 180])
				for (const d of atAngle(deg))
					for (const c of envRadiance(d, tint)) {
						expect(Number.isFinite(c)).toBe(true);
						expect(c).toBeGreaterThanOrEqual(0);
					}
	});

	test("the tint carries hue, and the floor does not follow it", () => {
		// The star half is the tint's; the floor is a fixed cool cast, because a
		// red star does not make the empty sky red.
		const warmAt = envRadiance(BAKE_STAR_DIR, 0xff4400);
		expect(warmAt[0]).toBeGreaterThan(warmAt[2]);
		const away = atAngle(180)[0];
		expect(envRadiance(away, 0xff4400)).toEqual(envRadiance(away, 0x0044ff));
	});
});

describe("the equirectangular buffer", () => {
	test("is the size the constants promise, RGBA", () => {
		const env = equirectEnvironment(WARM);
		expect(env.width).toBe(ENV_WIDTH);
		expect(env.height).toBe(ENV_HEIGHT);
		expect(env.data.length).toBe(ENV_WIDTH * ENV_HEIGHT * 4);
	});

	test("the same tint gives the same bake", () => {
		// It is baked once at load and never regenerated, so this is less about
		// determinism across runs than about the model holding no state — a
		// closure counter in it would make the second system in a session light
		// differently from the first.
		expect(Array.from(equirectEnvironment(WARM).data)).toEqual(
			Array.from(equirectEnvironment(WARM).data),
		);
	});

	test("a different tint gives a different bake", () => {
		expect(Array.from(equirectEnvironment(WARM).data)).not.toEqual(
			Array.from(equirectEnvironment(NEUTRAL).data),
		);
	});

	test("alpha is opaque everywhere and no channel is negative", () => {
		const { data } = equirectEnvironment(WARM);
		for (let i = 0; i < data.length; i += 4) {
			expect(data[i + 3]).toBe(1);
			for (let c = 0; c < 3; c++) expect(data[i + c]).toBeGreaterThanOrEqual(0);
		}
	});

	test("the buffer's brightest texel is the one the model puts the star at", () => {
		// Not a claim about `three`'s sampling — see the header. It is the
		// weaker claim that the writer and the model agree, which is what fails
		// if the row/column loop is transposed.
		const { data, width, height } = equirectEnvironment(WARM);
		let best = -1;
		let bestAt = -1;
		for (let i = 0; i < width * height; i++) {
			const v = luma([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
			if (v > best) {
				best = v;
				bestAt = i;
			}
		}
		const x = bestAt % width;
		const y = Math.floor(bestAt / width);
		// `atan2(0, 1) / 2π + 0.5` is u = 0.5 and `asin(0) / π + 0.5` is v = 0.5,
		// and texels are sampled at their centres — so u = 0.5 falls exactly
		// between columns 127 and 128, which carry the same value. Naming both
		// rather than picking one: an even resolution has no centre texel, and a
		// test that asserted one would be asserting the tie-break in this scan.
		expect([width / 2 - 1, width / 2]).toContain(x);
		expect([height / 2 - 1, height / 2]).toContain(y);
	});
});

describe("the rig's constants", () => {
	test("the four #199 emissive modules stay inside the shared ceiling", () => {
		// Tone-mapped MeshBasicMaterial lights have no emissive intensity; the bay
		// traversal test covers that separate path. This is deliberately the four
		// live-scene authoring modules named by #199, not gallery/viewer tooling.
		const modules = {
			station: STATION_EMISSIVE_INTENSITIES,
			stationInterior: STATION_INTERIOR_EMISSIVE_INTENSITIES,
			ship: SHIP_EMISSIVE_INTENSITIES,
			cockpit: COCKPIT_EMISSIVE_INTENSITIES,
		};
		for (const [module, intensities] of Object.entries(modules))
			for (const [name, intensity] of Object.entries(intensities)) {
				expect([module, name, Number.isFinite(intensity)]).toEqual([
					module,
					name,
					true,
				]);
				expect([module, name, intensity >= 0]).toEqual([module, name, true]);
				expect([module, name, intensity <= EMISSIVE_CEILING]).toEqual([
					module,
					name,
					true,
				]);
			}
	});

	test("bloom starts at the emissive ceiling rather than below white", () => {
		expect(EXPOSURE.bloom.threshold).toBeGreaterThanOrEqual(EMISSIVE_CEILING);
		expect(EXPOSURE.bloom.strength).toBeGreaterThan(0);
		expect(EXPOSURE.bloom.strength).toBeLessThan(1);
		expect(EXPOSURE.bloom.radius).toBeGreaterThanOrEqual(0);
		expect(EXPOSURE.bloom.radius).toBeLessThanOrEqual(1);
	});

	test("the fill is dimmer than the sun it fills for", () => {
		// The fill exists because a backlit hull rendered as a black cutout, and
		// it is off-axis on purpose. A fill that reached the sun's intensity
		// would be a second star the player can fly around.
		expect(LIGHT_RIG.fill.intensity).toBeLessThan(LIGHT_RIG.sun.intensity);
	});

	test("the hemisphere's ground is darker than its sky", () => {
		// The whole reason it replaces a flat ambient: a flat lift has no
		// gradient, so a flat-lit hull has no edges.
		const l = (hex: number) =>
			luma([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
		expect(l(LIGHT_RIG.hemisphere.ground)).toBeLessThan(
			l(LIGHT_RIG.hemisphere.sky),
		);
	});

	test("the low quality setting drops the environment and the occlusion", () => {
		// #98: this node must ship a low setting and say what it drops. The
		// hemisphere is the same cost as the flat ambient it replaced, so there
		// is nothing to gain by dropping it; the image-based term is the one
		// with a per-fragment cost.
		expect(LIGHT_RIG.quality.low.environment).toBe(false);
		expect(LIGHT_RIG.quality.high.environment).toBe(true);
		expect(LIGHT_RIG.quality.low.hemisphere).toBe(
			LIGHT_RIG.quality.high.hemisphere,
		);
		expect(LIGHT_RIG.quality.low.exposure).toBe(
			LIGHT_RIG.quality.high.exposure,
		);
	});

	test("the shadow stays on the lighting key, in both directions", () => {
		// It stays because a shadow is what the star does to a surface another
		// surface stands in front of — the light model — while ambient occlusion
		// is a post pass. Not because of what either costs.
		//
		// Gating it off to stop paying 0.59 ms for a term that darkens 0.003% of
		// an exterior frame was tried and reverted: `fitShadowCamera` idles while
		// the sun is not casting, so a shadow off during an approach is unfitted
		// when anything turns it on, and `probe-occlusion.mjs` then reads 0.9%
		// where it should read 6.3%. #231 owns that with the rig.
		expect(LIGHT_RIG.quality.high.shadows).toBe(true);
		expect(LIGHT_RIG.quality.low.shadows).toBe(false);
	});

	test("the ambient occlusion is not this key's to gate", () => {
		// It is the player's own `ao` row since the principal's ruling. The
		// assertion is that the term has exactly one owner: two owners of one
		// switch is the arrangement that once let the perf panel and the
		// settings screen multiply their two halves of `renderScale` together,
		// and the panel's readout reported only its own half.
		for (const mode of Object.values(LIGHT_RIG.quality))
			expect(Object.keys(mode)).not.toContain("ao");
		expect(settingSpec("ao").allowed).toEqual(["on", "off"]);
		expect(DEFAULT_SETTINGS.ao).toBe("on");
	});

	test("every quality mode answers for every term", () => {
		// The check the two tests above cannot make, and the one that catches
		// the real failure: a term added to `high` and forgotten in `low` reads
		// as `undefined`, which is falsy, so the gate silently works and the
		// settings note silently stops describing the game. Asserted over the
		// key sets rather than over a list written here, which would be the
		// third copy.
		const modes = Object.values(LIGHT_RIG.quality);
		const keys = modes.map((m) => Object.keys(m).sort().join(","));
		expect(new Set(keys).size).toBe(1);
	});
});

describe("the rotation onto the star", () => {
	/** Apply a quaternion to a vector, the standard `v + 2q_v × (q_v × v + w v)`.
	 *  Written here rather than imported because `light-rig.ts` returns a plain
	 *  tuple on purpose — a `THREE.Quaternion` in the leaf would be the Three.js
	 *  import the module exists without. */
	const apply = (
		[x, y, z, w]: [number, number, number, number],
		v: readonly [number, number, number],
	): [number, number, number] => {
		const cx = y * v[2] - z * v[1] + w * v[0];
		const cy = z * v[0] - x * v[2] + w * v[1];
		const cz = x * v[1] - y * v[0] + w * v[2];
		return [
			v[0] + 2 * (y * cz - z * cy),
			v[1] + 2 * (z * cx - x * cz),
			v[2] + 2 * (x * cy - y * cx),
		];
	};

	/** A spread of directions that does not favour any axis, plus the two
	 *  degenerate ones by name. A grid over latitude and longitude would put
	 *  most of its samples near the poles and test the easy cases hardest. */
	function directions(count = 200): [number, number, number][] {
		const out: [number, number, number][] = [
			BAKE_STAR_DIR as [number, number, number],
			[-1, 0, 0],
		];
		const golden = Math.PI * (3 - Math.sqrt(5));
		for (let i = 0; i < count; i++) {
			const y = 1 - (2 * (i + 0.5)) / count;
			const ring = Math.sqrt(Math.max(0, 1 - y * y));
			const theta = golden * i;
			out.push([Math.cos(theta) * ring, y, Math.sin(theta) * ring]);
		}
		return out;
	}

	test("takes the bake's star direction onto the real one, everywhere", () => {
		// The property the renderer's line asserted and nothing checked. It is
		// false for the inverse rotation at every direction except the two poles,
		// which is exactly the defect that shipped green.
		for (const dir of directions()) {
			const landed = apply(envRotation(dir), BAKE_STAR_DIR);
			for (let i = 0; i < 3; i++) expect(landed[i]).toBeCloseTo(dir[i], 9);
		}
	});

	test("the inverse rotation fails that, so the check is not free", () => {
		// Building the defect rather than trusting the assertion above to be
		// about something. `q⁻¹` is the conjugate.
		// The whole vector, not one component. The inverse rotates by −θ about the
		// same axis, which leaves the component *along* the bake's own star
		// direction unchanged — so an assertion on `landed[0]` alone passes on the
		// defect it was written to catch. Found by watching this test go green.
		const dir: [number, number, number] = [
			0.3,
			0.5,
			Math.sqrt(1 - 0.09 - 0.25),
		];
		const [x, y, z, w] = envRotation(dir);
		const landed = apply([-x, -y, -z, w], BAKE_STAR_DIR);
		const apart = Math.hypot(
			landed[0] - dir[0],
			landed[1] - dir[1],
			landed[2] - dir[2],
		);
		expect(apart).toBeGreaterThan(0.5);
	});

	test("every rotation is a unit quaternion, including the antiparallel one", () => {
		// A non-unit quaternion scales as well as rotates, so the environment
		// would be sampled from a stretched direction — which shows up as a
		// gradient that is subtly wrong rather than as an error.
		for (const dir of directions())
			expect(Math.hypot(...envRotation(dir))).toBeCloseTo(1, 12);
	});

	test("an unnormalised direction gives the same rotation as its unit", () => {
		// The renderer already has a normalised vector, so this is about the
		// function being safe to call from anywhere rather than about a caller
		// that exists.
		const dir: [number, number, number] = [0.6, -0.48, 0.64];
		const big = dir.map((v) => v * 1e6) as [number, number, number];
		const a = envRotation(dir);
		const b = envRotation(big);
		for (let i = 0; i < 4; i++) expect(b[i]).toBeCloseTo(a[i], 9);
	});
});

/**
 * The painted-hull calibration, and why it is derived rather than typed.
 *
 * Why those rows are a property of the hull finish rather than of the lighting,
 * and every figure behind it, is `scripts/lib/hull-luma.mjs`'s to state. Nothing
 * of it is restated here: two hand-kept copies of one measurement is the shape
 * that drifted last time.
 *
 * What is checked here is the part of it that can be executed:
 *
 * - **The calibration names the finish the game ships.** When the default moves,
 *   this goes red naming it, instead of three browser rows going red and reading
 *   as a lighting regression.
 * - **The floors are the module's own derivation**, not literals re-typed beside
 *   it — which is how the old constants came to sit 37% under a reading their
 *   docstring described as 10% under.
 * - **Every margin is inside its bounds**, and there are three of them: above
 *   the lane spread, inside the drop it must still catch, and never tighter than
 *   the band floor that shipped before this module existed.
 */
describe("the painted-hull luma calibration", () => {
	/** The floor each metric's reading feeds, in one place so the assertions and
	 *  the bounds below iterate the same three. */
	const FLOOR_OF = {
		peak: HULL_LUMA_BAND.min,
		lowerQuartile: HULL_LUMA_FLOORS.lowerQuartile,
		median: HULL_LUMA_FLOORS.median,
	} as const;
	const METRICS = ["peak", "lowerQuartile", "median"] as const;

	test("is recorded against the finish the game actually ships", () => {
		// The limit of this, said plainly: it matches a *name*. A change to what
		// `worn` renders leaves this green and lands as two numeric reds, exactly
		// as in #294 — that case is what the quartile margin's upper bound is
		// for, and no assertion on an id can cover it.
		expect<string>(HULL_LUMA_CALIBRATION.finish).toBe(DEFAULT_HULL_FINISH);
	});

	test("every floor is the module's own derivation from its reading", () => {
		// Through the module's own `floorUnder`, rounding included: re-implementing
		// the arithmetic here compares against a number the module never produced.
		//
		// What this catches is a floor typed in as a literal beside the derivation,
		// once a reading moves under it. It cannot catch a literal that still
		// equals the derivation, which is not drift.
		for (const metric of METRICS)
			expect(FLOOR_OF[metric]).toBe(
				floorUnder(HULL_LUMA_CALIBRATION[metric], HULL_LUMA_MARGINS[metric]),
			);
	});

	test("the band is an ordered band and the calibrated peak is inside it", () => {
		// Why it is a band and not a floor, and why only one end is derived, is
		// `HULL_LUMA_BAND`'s docstring to say.
		expect(HULL_LUMA_BAND.min).toBeLessThan(HULL_LUMA_BAND.max);
		expect(HULL_LUMA_CALIBRATION.peak).toBeGreaterThan(HULL_LUMA_BAND.min);
		expect(HULL_LUMA_CALIBRATION.peak).toBeLessThan(HULL_LUMA_BAND.max);
	});

	test("no margin is tighter than the spread between the two rasterisers", () => {
		// The lower bound on every margin, in display codes rather than fractions —
		// the module's docstring has the conversion and the reason.
		for (const metric of METRICS)
			expect(
				HULL_LUMA_CALIBRATION[metric] * HULL_LUMA_MARGINS[metric],
			).toBeGreaterThan(HULL_LUMA_CALIBRATION.laneSpread[metric]);
	});

	test("no derived floor tightens past the one that shipped", () => {
		// The bound that is not about this machine. Every reading here is one M1
		// Pro on two rasterisers, so a floor derived from its peak spends headroom
		// the previous band reserved for backends nobody here can measure. Loosen
		// freely; tightening needs evidence this repo does not have.
		expect(HULL_LUMA_BAND.min).toBeLessThanOrEqual(SHIPPED_BAND_FLOOR);
		expect(HULL_LUMA_FLOORS.median).toBeLessThanOrEqual(SHIPPED_FLOORS.median);
		// The quartile is deliberately absent: it is the one row with an upper
		// bound to satisfy, and the module says why the rule cannot reach it.
	});

	test("the calibration's shape is the one the floors are derived from", () => {
		// Cheap, and it guards the boundary between a typechecked tier and a
		// plain-JS module: a key renamed or dropped in `hull-luma.mjs` would
		// otherwise reach the arithmetic as `undefined` and derive `NaN`.
		for (const metric of METRICS) {
			expect(Number.isFinite(HULL_LUMA_CALIBRATION[metric])).toBe(true);
			expect(Number.isFinite(HULL_LUMA_CALIBRATION.laneSpread[metric])).toBe(
				true,
			);
			expect(Number.isFinite(HULL_LUMA_MARGINS[metric])).toBe(true);
			expect(Number.isFinite(FLOOR_OF[metric])).toBe(true);
		}
	});

	test("the other two rows could not have caught that change, which is why they carry no bound", () => {
		// The sentence in the module that explains why only the quartile gets an
		// upper bound, made executable. If either of these ever grows past its
		// margin, the claim that the quartile is the discriminating row stops
		// being true and the bound below belongs somewhere else too.
		for (const metric of ["peak", "median"] as const) {
			const { before, after } = SUBJECT_CHANGE_OTHER_ROWS[metric];
			expect((before - after) / before).toBeLessThan(HULL_LUMA_MARGINS[metric]);
		}
	});

	test("the quartile's margin is still tighter than the change it exists to catch", () => {
		// The upper bound, and it is only meaningful on the quartile: of the three
		// rows, that is the one `ab47a33` actually tripped. The peak and the median
		// moved by less than any workable margin, so the quartile is the
		// discriminating row and its margin has to stay well inside that drop.
		expect(HULL_LUMA_MARGINS.lowerQuartile).toBeLessThan(
			SUBJECT_CHANGE_QUARTILE_DROP,
		);
		// Not merely inside it: a margin at 30% against a 31% drop would pass this
		// and catch nothing in practice.
		expect(HULL_LUMA_MARGINS.lowerQuartile).toBeLessThan(
			SUBJECT_CHANGE_QUARTILE_DROP / 2,
		);
	});
});
