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

// **A few ulps is the wrong unit for this, and the history says why.** Two platforms
// have run this comparison: macOS worst at 4.2·10⁻¹⁶ (1.9 ulps) and GitHub's Linux
// runner at 9.2·10⁻¹⁶ (4.1). `acos` and then `sin(a/2)`, `cos(a/2)` is not the same
// sequence of roundings as the half-angle construction, so two correct forms of a
// shortest arc land a few ulps apart, and *which* few is a property of the libm. The
// bound here was `2 ** -51` — two ulps — for three rounds, and the row was **red on CI
// at two of this PR's pushes while green locally**: the machine that wrote the row had
// the luckier `sqrt`. That is this file's own warned-about failure mode, reached.
//
// `1e-14` is the same claim told in units the row is about, which no platform has to
// agree about: twelve orders below the smallest difference this file treats as real
// (the band's tightest aim error, 1.4·10⁻⁶) and fifteen below a wrong rotation (order
// 1), so no refactor hides under it and no libm's rounding reaches it. Two assumptions
// the first fix got wrong, both corrected by something rather than by luck: the
// runner's 4.1 ulps is a *first* violation and not a maximum, because a row that
// throws on the first exceedance reports only what it saw before quitting; and the
// antiparallel decade is not part of this margin at all, since there the disagreement
// is the cancellation the closing arm documents (2.4·10⁻¹² at ε = 1.1·10⁻⁹) and not
// rounding.
const REFACTOR_TOLERANCE = 1e-14;

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

	/** The arithmetic this function carried until #430 delegated it to
	 *  `quat.ts`, transcribed rather than imported so the row below has a second
	 *  implementation to compare against and not its own subject. */
	function legacyEnvRotation(
		starDir: readonly [number, number, number],
	): [number, number, number, number] {
		const l = Math.hypot(starDir[0], starDir[1], starDir[2]);
		const to: [number, number, number] = [
			starDir[0] / l,
			starDir[1] / l,
			starDir[2] / l,
		];
		const from = BAKE_STAR_DIR;
		const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
		if (d < -1 + 1e-9) {
			const away: [number, number, number] =
				Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
			const ax = from[1] * away[2] - from[2] * away[1];
			const ay = from[2] * away[0] - from[0] * away[2];
			const az = from[0] * away[1] - from[1] * away[0];
			const al = Math.hypot(ax, ay, az);
			return [ax / al, ay / al, az / al, 0];
		}
		const x = from[1] * to[2] - from[2] * to[1];
		const y = from[2] * to[0] - from[0] * to[2];
		const z = from[0] * to[1] - from[1] * to[0];
		const w = 1 + d;
		const n = Math.hypot(x, y, z, w);
		return [x / n, y / n, z / n, w / n];
	}

	test("a star direction with no direction in it is refused, not rotated", () => {
		// The one behaviour change in this refactor that is not an aim correction:
		// where the deleted inline form divided by a length of zero and handed back a
		// quaternion of NaNs, `envRotation` throws.
		//
		// Both halves are asserted, because the throw is only worth having if the
		// thing it replaced really was unseeable. The old arithmetic on a zero
		// direction is right here — `0 / 0` into all four components — and a NaN
		// quaternion is not an error anywhere in the pipeline: `main.ts` reads this
		// function's answer into `ENV_EULER` and then into
		// `scene.environmentRotation`, so the NaN becomes a rotation applied to every
		// direction the environment is sampled along. Chrome plating reading a
		// direction that does not exist is not an error anything downstream can see;
		// it is a picture with nothing in it and nothing printed.
		//
		// The case is geometric, not a fuzz artifact: a camera standing exactly on its
		// own star has no direction *to* it. #430 found the render path's caller
		// dividing by a clamped length, which turned that into a zero vector and let
		// the NaNs through, and the fix went to the caller — it keeps the previous
		// frame's rotation when there is no direction to ask about. This row is the
		// other half: what the function itself owes a caller that does ask, which is a
		// named refusal and not four NaNs wearing a quaternion's shape.
		expect(() => envRotation([0, 0, 0])).toThrow(
			"envRotation: the star direction carries no direction",
		);
		const stale = legacyEnvRotation([0, 0, 0]);
		for (const component of stale) expect(Number.isNaN(component)).toBe(true);
	});

	test("the shared primitive returns the rotation this function computed itself", () => {
		// The claim "#430 changed the shipped rotation for no direction" is worth
		// nothing as prose, so the deleted body is here as a second implementation
		// and compared against what ships, over the spread the rows above sweep.
		//
		// **All 202 of them, including both degenerates, because the bound — not the
		// sweep — is where the platform belongs.** This row compared components at
		// `2 ** -51`, two ulps, for three rounds, and was red on the Linux runner and
		// green on macOS: `acos` then `sin(a/2)`, `cos(a/2)` is not the same sequence of
		// roundings as the half-angle construction, and two correct forms of a shortest
		// arc differ by a few ulps that no platform is obliged to share. The first
		// version of this fix filtered the near-antiparallel directions out of the sweep;
		// the row's own count assertion reddened, because this spread holds exactly one
		// such direction by name and the exceedance was never there — it sits at ordinary
		// directions, where `acos` amplifies a unit in the last place by up to 1/sin θ.
		// So the sweep stays whole and the bound is told in the units the claim is about.
		for (const dir of directions()) {
			const got = envRotation(dir);
			const want = legacyEnvRotation(dir);
			for (let i = 0; i < 4; i++)
				expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(
					REFACTOR_TOLERANCE,
				);
		}
		// And exactly equal at the one direction where both branches agree by
		// construction: the fallback axis for a star sitting behind the bake's own
		// is the world axis `from` is least parallel to, which both pick as +Z.
		expect(envRotation([-1, 0, 0])).toEqual([0, 0, 1, 0]);
	});

	test("near exact antiparallel the old arm misses the star and the new one does not", () => {
		// Where this refactor *does* change something, so it is sized rather than
		// waved at. The branch deleted from `envRotation` fired at
		// `dot < −1 + 1e-9`; `shortestArc`'s fires at `−1 + 1e-12`. Between those
		// three decades the old code answered with a half turn about a fixed world
		// axis, and a half turn about a fixed axis is **not** a shortest arc to a
		// direction that is merely nearly antiparallel: it leaves the environment's
		// star off the requested direction by the perpendicular part, √(2ε).
		//
		// **The figures live here, as assertions.** A measured number copied into a
		// comment goes stale the first time the measurement is repeated, and this
		// one has been wrong twice for exactly that reason. Each row of `BAND` is
		// checked two ways — against the closed form the geometry predicts, and
		// against the number a run produced — so the literals are not the authority,
		// the arithmetic is, and anything that moves them reddens this row instead of
		// quietly invalidating a paragraph somewhere else.
		// A direction `eps` short of straight behind the bake's own star.
		const antiparallelDir = (eps: number): [number, number, number] => [
			-(1 - eps),
			Math.sqrt(Math.max(0, 1 - (1 - eps) * (1 - eps))),
			0,
		];
		// How far the two rotations make the sampled environment disagree, with each
		// turned back through its own inverse first — which is how the renderer's map
		// is read — over the 202 directions this file already sweeps. One copy,
		// because the band arm and the closing arm have to be the same measurement or
		// their comparison means nothing.
		const worstRadianceDelta = (
			a: [number, number, number, number],
			b: [number, number, number, number],
		): number => {
			const aInv: [number, number, number, number] = [
				-a[0],
				-a[1],
				-a[2],
				a[3],
			];
			const bInv: [number, number, number, number] = [
				-b[0],
				-b[1],
				-b[2],
				b[3],
			];
			let worst = 0;
			for (const w of directions(200)) {
				const x = envRadiance(apply(aInv, w), WARM);
				const y = envRadiance(apply(bInv, w), WARM);
				for (let i = 0; i < 3; i++)
					worst = Math.max(worst, Math.abs(x[i] - y[i]));
			}
			return worst;
		};
		const aimError = (
			q: [number, number, number, number],
			want: readonly [number, number, number],
		): number => {
			const landed = apply(q, BAKE_STAR_DIR);
			return Math.hypot(
				landed[0] - want[0],
				landed[1] - want[1],
				landed[2] - want[2],
			);
		};
		const BAND = [
			{ eps: 1e-12, oldAim: 1.4142e-6, radiance: 9.4709e-6 },
			{ eps: 1e-11, oldAim: 4.4721e-6, radiance: 2.9947e-5 },
			{ eps: 1e-10, oldAim: 1.4142e-5, radiance: 9.4673e-5 },
			{ eps: 5e-10, oldAim: 3.1623e-5, radiance: 2.1158e-4 },
			{ eps: 9e-10, oldAim: 4.2426e-5, radiance: 2.8377e-4 },
		];
		const within = (got: number, want: number, rel = 0.02) =>
			expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.abs(want));
		for (const { eps, oldAim: pinned, radiance: pinnedRadiance } of BAND) {
			const dir = antiparallelDir(eps);
			const fresh = envRotation(dir);
			const stale = legacyEnvRotation(dir);
			// Aim: how far each arm leaves the environment's star from the direction
			// it was handed, read off where the rotation actually puts it.
			const old = aimError(stale, dir);
			const fresh_ = aimError(fresh, dir);
			within(old, Math.sqrt(2 * eps), 0.001);
			within(old, pinned);
			// The new arm hits it to machine precision, and orders of magnitude
			// better than the arm this refactor replaced — which is the whole
			// argument for the narrower threshold, stated as a measurement.
			expect(fresh_).toBeLessThan(1e-13);
			expect(fresh_).toBeLessThan(old / 100);
			// And what the difference costs on the thing the rotation is for.
			const worst = worstRadianceDelta(fresh, stale);
			within(worst, pinnedRadiance);
			// Under one eight-bit code of a unit-scale field, so under every pixel
			// threshold in the browser tier — and nonzero, because the arms genuinely
			// differ and this row is not going to be the one that says they don't.
			expect(worst).toBeGreaterThan(0);
			expect(worst).toBeLessThan(1 / 255);
		}
		// **The band closes, and "closes" is a smaller claim than it sounds.** Past the old threshold the two arms are the same
		// computation, and this is the row that says "the refactor changed nothing
		// else" rather than merely asserting it: one ε outside, the quaternions agree
		// agree to a bound set by the conditioning above — one ulp divided by ε,
		// measured at 2.4·10⁻¹² on the runner and 10⁻¹⁶ here, so an ulp-level claim
		// about components at this ε is a claim about a platform — and the sampled
		// environment cannot tell them apart at the scale this row is about.
		const closedDir = antiparallelDir(1.1e-9);
		const closedFresh = envRotation(closedDir);
		const closedStale = legacyEnvRotation(closedDir);
		// `1 + d` is 1.1·10⁻⁹ here, so the scalar carries relative error ~10⁻⁷ and
		// the components ~10⁻¹¹. Four orders of magnitude below the smallest thing the
		// band row measures as a real difference — a wrong rotation is order 1.
		for (let i = 0; i < 4; i++)
			expect(Math.abs(closedFresh[i] - closedStale[i])).toBeLessThanOrEqual(
				1e-11,
			);
		// And the reading that decides whether the band has finished: the environment
		// these two rotations bake. A 2.4·10⁻¹² difference in a quaternion moves the
		// sampled radiance ~7× that (the gain the band's own rows print), so 10⁻⁹ is
		// four decades under the smallest radiance figure this file calls a difference.
		const closedWorst = worstRadianceDelta(closedFresh, closedStale);
		expect(closedWorst).toBeLessThanOrEqual(1e-9);
	});
});
