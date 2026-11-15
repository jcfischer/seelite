import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
	FLOOR_FRACTION_OF_READING,
	floorUnder,
	HULL_LUMA_BAND,
	HULL_LUMA_CALIBRATION,
	HULL_LUMA_FLOOR_OF,
	HULL_LUMA_FLOORS,
	HULL_LUMA_MARGINS,
	isCalibratedHullSubject,
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
	equirectEnvironment,
	gasRadiance,
	hazeRadiance,
	skyRadiance,
	LIGHT_RIG,
	type GasParams,
	type HazeParams,
	type SkyBakeParams,
} from "../src/light-rig";
import { DEFAULT_SETTINGS, settingSpec } from "../src/settings";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { buildShipMesh, SHIP_EMISSIVE_INTENSITIES } from "../src/ship-mesh";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISH_IDS,
	setHullFinish,
} from "../src/ship-surface";
import { STATION_INTERIOR_EMISSIVE_INTENSITIES } from "../src/station-interior-mesh";
import { STATION_EMISSIVE_INTENSITIES } from "../src/station-mesh";

const WARM = 0xfff0d8;
const NEUTRAL = 0xf8f7ff;

const unit = (x: number, y: number, z: number): [number, number, number] => {
	const l = Math.hypot(x, y, z);
	return [x / l, y / l, z / l];
};

function atAngle(deg: number, azimuths = 8): [number, number, number][] {
	const a = (deg * Math.PI) / 180;
	const out: [number, number, number][] = [];
	for (let i = 0; i < azimuths; i++) {
		const phi = (i / azimuths) * Math.PI * 2;
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

const texelsStraddlingCentre = (texels: number) => [texels / 2 - 1, texels / 2];

const luma = ([r, g, b]: [number, number, number]) =>
	0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("the radiance model is a star and a floor", () => {
	test("the star direction is the brightest direction there is", () => {
		const at = envRadiance(BAKE_STAR_DIR, WARM);
		for (const d of [10, 45, 90, 135, 180].flatMap((deg) => atAngle(deg)))
			expect(luma(envRadiance(d, WARM))).toBeLessThan(luma(at));
	});

	test("brightness falls off the star, step by step, and never rises again", () => {
		let previous = luma(envRadiance(BAKE_STAR_DIR, WARM));
		for (const deg of [1, 2, 5, 10, 20, 40, 60, 89, 90, 120, 150, 180]) {
			const here = atAngle(deg).map((d) => luma(envRadiance(d, WARM)));
			for (const v of here) expect(v).toBeCloseTo(here[0], 10);
			if (deg < 90) expect(here[0]).toBeLessThan(previous);
			else expect(here[0]).toBeLessThanOrEqual(previous);
			previous = here[0];
		}
	});

	test("the far side is lit, but barely", () => {
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
		expect(texelsStraddlingCentre(width)).toContain(x);
		expect(texelsStraddlingCentre(height)).toContain(y);
	});
});

describe("the rig's constants", () => {
	test("the four #199 emissive modules stay inside the shared ceiling", () => {
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
		expect(LIGHT_RIG.fill.intensity).toBeLessThan(LIGHT_RIG.sun.intensity);
	});

	test("the hemisphere's ground is darker than its sky", () => {
		const l = (hex: number) =>
			luma([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
		expect(l(LIGHT_RIG.hemisphere.ground)).toBeLessThan(
			l(LIGHT_RIG.hemisphere.sky),
		);
	});

	test("the low quality setting drops the environment and the occlusion", () => {
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
		expect(LIGHT_RIG.quality.high.shadows).toBe(true);
		expect(LIGHT_RIG.quality.low.shadows).toBe(false);
	});

	test("the ambient occlusion is not this key's to gate", () => {
		for (const mode of Object.values(LIGHT_RIG.quality))
			expect(Object.keys(mode)).not.toContain("ao");
		expect(settingSpec("ao").allowed).toEqual(["on", "off"]);
		expect(DEFAULT_SETTINGS.ao).toBe("on");
	});

	test("every quality mode answers for every term", () => {
		const modes = Object.values(LIGHT_RIG.quality);
		const keys = modes.map((m) => Object.keys(m).sort().join(","));
		expect(new Set(keys).size).toBe(1);
	});
});

describe("the painted-hull luma calibration", () => {
	const METRICS = Object.keys(HULL_LUMA_MARGINS) as Array<
		keyof typeof HULL_LUMA_MARGINS
	>;

	test("is recorded against the hull and the model the game actually ships", () => {
		const { subject } = HULL_LUMA_CALIBRATION;
		expect<string>(subject.hull).toBe(PLAYER_BASELINE_HULL);
		expect(
			createHash("sha256")
				.update(readFileSync("src/models/courier-hull.glb"))
				.digest("hex"),
		).toBe(subject.modelSha256);
		const root = buildShipMesh(
			PLAYER_BASELINE_HULL,
			HULL_SPECS[PLAYER_BASELINE_HULL].variant,
		).root;
		expect(root.userData.authored === true).toBe(subject.authored);
	});

	test("no finish preset paints the authored courier, which is why the finish is not in the key", () => {
		const paint = (finish: (typeof HULL_FINISH_IDS)[number]) => {
			setHullFinish(finish);
			const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
			const out: string[] = [];
			root.traverse((o) => {
				const mesh = o as THREE.Mesh;
				if (!mesh.isMesh) return;
				const materials = Array.isArray(mesh.material)
					? mesh.material
					: [mesh.material];
				for (const m of materials as THREE.MeshStandardMaterial[]) {
					const painted =
						m.isMeshStandardMaterial &&
						((m.emissive?.getHex() ?? 0) === 0 ||
							(m.emissiveIntensity ?? 0) === 0);
					if (!painted) continue;
					out.push(
						[
							mesh.name,
							mesh.geometry.uuid,
							m.color.getHexString(),
							m.roughness,
							m.metalness,
							m.envMapIntensity,
							m.map?.uuid,
							m.roughnessMap?.uuid,
							m.metalnessMap?.uuid,
							m.normalMap?.uuid,
							m.aoMap?.uuid,
						].join("|"),
					);
				}
			});
			return out;
		};
		try {
			const shipped = paint(DEFAULT_HULL_FINISH);
			expect(shipped.length).toBeGreaterThan(0);
			for (const finish of HULL_FINISH_IDS)
				expect([finish, paint(finish)]).toEqual([finish, shipped]);
		} finally {
			setHullFinish(DEFAULT_HULL_FINISH);
		}
	});

	test("a page drawing any other subject is not the calibrated one", () => {
		const { subject } = HULL_LUMA_CALIBRATION;
		expect(isCalibratedHullSubject({ ...subject })).toBe(true);
		expect(isCalibratedHullSubject({ ...subject, hull: "miner" })).toBe(false);
		expect(isCalibratedHullSubject({ ...subject, authored: false })).toBe(
			false,
		);
		expect(
			isCalibratedHullSubject({ ...subject, modelSha256: "0".repeat(64) }),
		).toBe(false);
		expect(isCalibratedHullSubject(null)).toBe(false);
	});

	test("every floor is the module's own derivation from its reading", () => {
		for (const metric of METRICS)
			expect(HULL_LUMA_FLOOR_OF[metric]).toBe(
				floorUnder(HULL_LUMA_CALIBRATION[metric], HULL_LUMA_MARGINS[metric]),
			);
	});

	test("the band is an ordered band and the calibrated peak is inside it", () => {
		expect(HULL_LUMA_BAND.min).toBeLessThan(HULL_LUMA_BAND.max);
		expect(HULL_LUMA_CALIBRATION.peak).toBeGreaterThan(HULL_LUMA_BAND.min);
		expect(HULL_LUMA_CALIBRATION.peak).toBeLessThan(HULL_LUMA_BAND.max);
	});

	test("the ceiling is the principal's 255: no ceiling", () => {
		expect(HULL_LUMA_BAND.max).toBe(255);
		expect(HULL_LUMA_CALIBRATION.peak).toBeLessThanOrEqual(HULL_LUMA_BAND.max);
	});

	test("no margin is small enough to be decided by which rasteriser ran", () => {
		for (const metric of METRICS)
			expect(
				HULL_LUMA_CALIBRATION[metric] * HULL_LUMA_MARGINS[metric],
			).toBeGreaterThan(HULL_LUMA_CALIBRATION.laneSpread[metric]);
	});

	test("every floor with a shipped counterpart stays at or under it", () => {
		expect(Object.keys(SHIPPED_FLOORS).sort()).toEqual([...METRICS].sort());
		for (const [metric, shipped] of Object.entries(SHIPPED_FLOORS))
			expect(HULL_LUMA_FLOOR_OF[metric]).toBeLessThanOrEqual(shipped);
	});

	test("what the probe reads is what these bounds were asserted over", () => {
		expect(HULL_LUMA_BAND.min).toBe(HULL_LUMA_FLOOR_OF.peak);
		expect(HULL_LUMA_FLOORS).toEqual(
			Object.fromEntries(
				Object.entries(HULL_LUMA_FLOOR_OF).filter(([m]) => m !== "peak"),
			),
		);
	});

	test("the calibration's shape is the one the floors are derived from", () => {
		expect(METRICS.length).toBeGreaterThan(0);
		for (const metric of METRICS) {
			expect(Number.isFinite(HULL_LUMA_CALIBRATION[metric])).toBe(true);
			expect(Number.isFinite(HULL_LUMA_CALIBRATION.laneSpread[metric])).toBe(
				true,
			);
			expect(Number.isFinite(HULL_LUMA_MARGINS[metric])).toBe(true);
			expect(Number.isFinite(HULL_LUMA_FLOOR_OF[metric])).toBe(true);
		}
		expect(floorUnder).toHaveLength(2);
		for (const shipped of Object.values(SHIPPED_FLOORS))
			expect(Number.isFinite(shipped)).toBe(true);
		expect(Number.isFinite(SUBJECT_CHANGE_QUARTILE_DROP)).toBe(true);
		for (const row of ["peak", "median"] as const) {
			expect(Number.isFinite(SUBJECT_CHANGE_OTHER_ROWS[row].before)).toBe(true);
			expect(Number.isFinite(SUBJECT_CHANGE_OTHER_ROWS[row].after)).toBe(true);
		}
	});

	test("no floor loosens far enough to stop rejecting a hull gone dark", () => {
		for (const metric of METRICS)
			expect(HULL_LUMA_FLOOR_OF[metric]).toBeGreaterThan(
				HULL_LUMA_CALIBRATION[metric] * FLOOR_FRACTION_OF_READING,
			);
	});

	test("the other two rows could not have caught that change, which is why they carry no bound", () => {
		for (const metric of ["peak", "median"] as const) {
			const { before, after } = SUBJECT_CHANGE_OTHER_ROWS[metric];
			expect((before - after) / before).toBeLessThan(HULL_LUMA_MARGINS[metric]);
		}
	});

	test("the quartile's margin is still tighter than the change it exists to catch", () => {
		expect(HULL_LUMA_MARGINS.lowerQuartile).toBeLessThan(
			SUBJECT_CHANGE_QUARTILE_DROP,
		);
		expect(HULL_LUMA_MARGINS.lowerQuartile).toBeLessThan(
			SUBJECT_CHANGE_QUARTILE_DROP / 2,
		);
	});
});

describe("the haze model (node #433)", () => {
	const core: [number, number, number] = [0, 0, 1];
	const haze: HazeParams = { coreBearing: core, strength: 1.0 };

	test("brightest toward the core bearing", () => {
		const toward = luma(hazeRadiance(core, haze));
		const away = luma(hazeRadiance([0, 0, -1], haze));
		const side = luma(hazeRadiance([1, 0, 0], haze));
		expect(toward).toBeGreaterThan(away);
		expect(toward).toBeGreaterThan(side);
	});

	test("never negative or non-finite", () => {
		for (const dir of [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
			[0, 0, -1],
			[-1, -1, -1],
		] as const)
			for (const c of hazeRadiance(dir, haze)) {
				expect(Number.isFinite(c)).toBe(true);
				expect(c).toBeGreaterThanOrEqual(0);
			}
	});

	test("strength zero gives a minimal uniform glow", () => {
		const weak: HazeParams = { coreBearing: core, strength: 0 };
		const toward = luma(hazeRadiance(core, weak));
		const away = luma(hazeRadiance([0, 0, -1], weak));
		expect(toward).toBeGreaterThan(0);
		expect(toward).toBeCloseTo(away, 5);
	});

	test("null coreBearing gives a uniform glow, no crash", () => {
		const noCore: HazeParams = { coreBearing: null, strength: 1.0 };
		const a = hazeRadiance([1, 0, 0], noCore);
		const b = hazeRadiance([0, 0, -1], noCore);
		expect(a).toEqual(b);
		for (const c of a) expect(c).toBeGreaterThan(0);
	});
});

describe("the gas model (node #433)", () => {
	const gas: GasParams = { color: [1, 0.8, 0.6], density: 0.5, seed: 42 };

	test("deterministic: same seed gives same result", () => {
		const a = gasRadiance([1, 0, 0], gas);
		const b = gasRadiance([1, 0, 0], gas);
		expect(a).toEqual(b);
	});

	test("different seeds give different results", () => {
		const a = gasRadiance([1, 0, 0], gas);
		const b = gasRadiance([1, 0, 0], { ...gas, seed: 99 });
		const anyChannelDiffers = a.some((v, i) => v !== b[i]);
		expect(anyChannelDiffers).toBe(true);
	});

	test("zero density gives zero", () => {
		const zero = gasRadiance([1, 0, 0], { ...gas, density: 0 });
		expect(zero).toEqual([0, 0, 0]);
	});

	test("never negative", () => {
		for (const dir of [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
			[-1, -1, -1],
		] as const)
			for (const c of gasRadiance(dir, gas))
				expect(c).toBeGreaterThanOrEqual(0);
	});
});

describe("the world-frame bake carries no star (node #433, decision 2026-10-04)", () => {
	const haze: HazeParams = { coreBearing: [1, 0, 0], strength: 0.8 };
	const gas: GasParams = { color: [0.8, 0.7, 1.0], density: 0.5, seed: 42 };

	test("the sky is the floor plus the haze plus the gas, and nothing else", () => {
		for (const dir of [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, -1],
			[-0.3, 0.5, 0.8],
		] as const) {
			const sky = skyRadiance(dir, { haze, gas });
			const floor = skyRadiance(dir, { haze: null, gas: null });
			const h = hazeRadiance(dir, haze);
			const g = gasRadiance(dir, gas);
			for (let c = 0; c < 3; c++)
				expect(sky[c]).toBeCloseTo(floor[c] + h[c] + g[c], 12);
		}
	});

	test("the floor is the same floor the star-lit bake stands on", () => {
		const away = envRadiance([-1, 0, 0], WARM);
		expect(skyRadiance([0, 1, 0], { haze: null, gas: null })).toEqual(away);
	});

	test("with no haze and no gas the bake is uniform — no lobe anywhere", () => {
		const { data } = equirectEnvironment({ haze: null, gas: null });
		const [r, g, b] = [data[0], data[1], data[2]];
		expect(r).toBeGreaterThan(0);
		for (let i = 0; i < data.length; i += 4)
			expect([data[i], data[i + 1], data[i + 2], data[i + 3]]).toEqual([
				r,
				g,
				b,
				1,
			]);
	});

	test("its brightest texel is the haze and gas peak, not a star", () => {
		const { data } = equirectEnvironment({ haze, gas });
		let peak = 0;
		for (let i = 0; i < data.length; i += 4)
			peak = Math.max(peak, data[i], data[i + 1], data[i + 2]);
		expect(peak).toBeLessThan(1);
	});

	test("the parameters cannot carry a star", () => {
		type CarriesStar = "starDir" extends keyof SkyBakeParams ? true : false;
		const carriesStar: CarriesStar = false;
		expect(carriesStar).toBe(false);
	});

	test("the bake is the sky model at the texel the mapping names", () => {
		const { data, width, height } = equirectEnvironment({ haze, gas });
		const i = ((height / 2) * width + width / 2) * 4;
		const mid = skyRadiance(
			[
				Math.cos(Math.PI / width) * Math.cos(Math.PI / (2 * height)),
				Math.sin(Math.PI / (2 * height)),
				Math.sin(Math.PI / width) * Math.cos(Math.PI / (2 * height)),
			],
			{ haze, gas },
		);
		for (let c = 0; c < 3; c++) expect(data[i + c]).toBeCloseTo(mid[c], 6);
	});
});
