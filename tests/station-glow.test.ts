/**
 * The glow station lights are seen by at range (#300), headless.
 *
 * The principal's ruling on #300's first sheet was that every station light
 * was *"way too big"*. The fittings are real-sized now, which puts them under
 * a pixel at docking range, and `station-glow.ts` is what a pilot sees
 * instead. What a browser cannot hold cheaply is here: the size arithmetic, the
 * sizes of the fittings themselves, and the wiring — every §5 fixture carries a
 * glow, it is named like its fitting so the probe hides both together, it is
 * hidden wherever its fitting is, nothing can pick it, and the clock drives it
 * at exactly the fitting's own intensity.
 *
 * What it cannot hold is whether a glow *reads*. That is
 * `probe-station-visuals.mjs`'s per-fixture floor and the canonical view set.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { EMISSIVE_CEILING, EXPOSURE } from "../src/light-rig";
import { STATION_TYPES, type StationType } from "../src/station";
import { GLOW_CLASSES, glowPixelSize } from "../src/station-glow";
import {
	SELECTED_FORM,
	STATION_FORMS,
	buildStationForm,
	buildStationMesh,
	setStationDetail,
	updateStationVisuals,
} from "../src/station-mesh";
import { SPEC_FIXTURE_NAMES } from "../src/station-visuals";

const GREY = 0x9aa6b2;

describe("a glow's size is a floor and a cap round its fitting's projected size", () => {
	const point = GLOW_CLASSES.point;

	test("a fitting far below a pixel is drawn at the floor, not at zero", () => {
		// A 2 m strobe at 5 km, a 60° vertical field and a 900 px target: the
		// fitting itself projects to about a third of a pixel.
		const yy = 1 / Math.tan(Math.PI / 6);
		expect(glowPixelSize(0.002, 5, yy, 450, point)).toBe(point.minPx);
	});

	test("up close it is capped, so the housing is what you see", () => {
		expect(glowPixelSize(0.002, 0.01, 1.732, 450, point)).toBe(point.maxPx);
	});

	test("between the two it is the fitting's projected size times its spread", () => {
		const yy = 1.732;
		// Chosen to land between floor and cap for the point class.
		const size = glowPixelSize(0.002, 0.4, yy, 450, point);
		const projected = (0.002 / 0.4) * yy * 450;
		expect(size).toBeCloseTo(projected * point.spread, 9);
		expect(size).toBeGreaterThan(point.minPx);
		expect(size).toBeLessThan(point.maxPx);
	});

	test("it depends on size over distance only, so a layer's scale cannot move it", () => {
		// A station is drawn normalised to its core radius and in three layers
		// at three scales; the view-space units change and the ratio does not.
		for (const scale of [1, 1 / 0.6, 1e-3, 1e3])
			expect(glowPixelSize(0.002 * scale, 0.4 * scale, 1.732, 450, point)).toBe(
				glowPixelSize(0.002, 0.4, 1.732, 450, point),
			);
	});

	test("every class floors below its cap", () => {
		for (const [name, cls] of Object.entries(GLOW_CLASSES))
			expect([name, cls.minPx > 0 && cls.minPx < cls.maxPx]).toEqual([
				name,
				true,
			]);
	});
});

/** The largest dimension of an object's own geometry, in its parent's
 *  kilometres — instance scale included for an instanced run. */
const fittingKm = (object: THREE.Object3D) => {
	const mesh = object as THREE.Mesh;
	mesh.geometry.computeBoundingBox();
	const box = (mesh.geometry.boundingBox as THREE.Box3).clone();
	const size = box.getSize(new THREE.Vector3());
	const scale = new THREE.Vector3(1, 1, 1);
	if ((object as THREE.InstancedMesh).isInstancedMesh) {
		const m = new THREE.Matrix4();
		(object as THREE.InstancedMesh).getMatrixAt(0, m);
		scale.setFromMatrixScale(m);
	}
	scale.multiply(object.scale);
	return Math.max(size.x * scale.x, size.y * scale.y, size.z * scale.z);
};

/**
 * The largest a fitting may be, kilometres, by its name — what a real one on a
 * station of this size would be, with room to model it.
 *
 * The figures are the ruling rather than a measurement: a strobe lamp is a
 * metre or two, a window a few metres, a floodlight a few metres, a welding arc
 * under one. What the ruling replaced was 42 m, 30 m, 156 m and 60 m.
 */
const FITTING_CAP_KM: Readonly<Record<string, number>> = {
	windows: 0.004,
	"strobe-a": 0.003,
	"strobe-b": 0.003,
	"bay-flood": 0.005,
	"weld-arc": 0.0015,
	flare: 0.01,
	"mouth-strobe": 0.003,
	"obstruction-beacon": 0.003,
};

describe("the lights are station fittings, not ship-sized boxes", () => {
	test("no §5 fitting on any form exceeds its real-size cap", () => {
		for (const type of STATION_TYPES)
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0, 0);
				root.traverse((object) => {
					const cap = FITTING_CAP_KM[object.name];
					if (cap === undefined || object.userData.glow) return;
					const km = fittingKm(object);
					expect([type, form.id, object.name, km <= cap]).toEqual([
						type,
						form.id,
						object.name,
						true,
					]);
				});
			}
	});

	test("nor does a finish's beacon", () => {
		for (const type of STATION_TYPES) {
			const { root } = buildStationMesh(type, GREY, 0, 0);
			root.traverse((object) => {
				if (!object.name.startsWith("beacon-") || object.userData.glow) return;
				expect([type, object.name, fittingKm(object) <= 0.003]).toEqual([
					type,
					object.name,
					true,
				]);
			});
		}
	});
});

describe("every §5 fixture carries a glow, wired to its fitting", () => {
	/** Every object with a given name that is a fitting rather than a glow. */
	const fittingsNamed = (root: THREE.Object3D, name: string) => {
		const out: THREE.Object3D[] = [];
		root.traverse((object) => {
			if (object.name === name && !object.userData.glow) out.push(object);
		});
		return out;
	};

	for (const [type, names] of Object.entries(SPEC_FIXTURE_NAMES))
		test(`the ${type}'s fittings each have a glow child of the same name`, () => {
			const station = type as StationType;
			const { root } = buildStationForm(
				station,
				SELECTED_FORM[station],
				GREY,
				0,
				0,
			);
			const missing: string[] = [];
			for (const name of names) {
				// The heat ring is a lit ring a hundred metres across and reads
				// at range as itself; it is §5's light and needs no glare.
				if (name === "heat-glow") continue;
				const fittings = fittingsNamed(root, name);
				if (fittings.length === 0) missing.push(`${name} (no fitting)`);
				for (const fitting of fittings) {
					const glow = fitting.children.find((c) => c.userData.glow);
					if (!glow) missing.push(`${name} (no glow)`);
					else if (glow.name !== name)
						missing.push(`${name} (glow named ${glow.name})`);
				}
			}
			expect([type, missing]).toEqual([type, []]);
		});

	test("a glow is hidden wherever its fitting is: at outline range, none draws", () => {
		for (const type of STATION_TYPES) {
			const mesh = buildStationMesh(type, GREY, 0, 0);
			setStationDetail(mesh, "outline");
			mesh.root.updateMatrixWorld(true);
			const drawn: string[] = [];
			mesh.root.traverse((object) => {
				if (!object.userData.glow) return;
				let shown = true;
				for (let o: THREE.Object3D | null = object; o; o = o.parent)
					if (!o.visible) shown = false;
				if (shown) drawn.push(object.name);
			});
			expect([type, drawn]).toEqual([type, []]);
		}
	});

	test("nothing can pick a glow", () => {
		// `Points` answers within one world unit, and this root is in core radii:
		// a pickable glow would stand in front of every surface on the station.
		const { root } = buildStationMesh("trade", GREY, 0, 0);
		root.updateMatrixWorld(true);
		const raycaster = new THREE.Raycaster(
			new THREE.Vector3(0, 0, 10),
			new THREE.Vector3(0, 0, -1),
		);
		const glowHits = raycaster
			.intersectObject(root, true)
			.filter((hit) => hit.object.userData.glow);
		expect(glowHits).toEqual([]);
	});

	test("the clock drives a glow at exactly its fitting's own intensity", () => {
		for (const type of ["trade", "shipyard", "refinery"] as const) {
			const mesh = buildStationMesh(type, GREY, 0, 0);
			for (const t of [0.05, 0.75, 1.05, 1.75]) {
				updateStationVisuals(mesh, t, 1, "high");
				for (const fixture of mesh.fixtures) {
					if (!fixture.glow) continue;
					expect([
						type,
						fixture.kind,
						t,
						fixture.glow.uniforms.uIntensity.value,
					]).toEqual([
						type,
						fixture.kind,
						t,
						fixture.material.emissiveIntensity,
					]);
				}
			}
		}
	});

	test("every driven light that a §5 fixture names has a glow to drive", () => {
		// strobes, the arc and the flare; the heat ring is a lit structure.
		for (const type of ["trade", "shipyard", "refinery"] as const) {
			const mesh = buildStationMesh(type, GREY, 0, 0);
			const undriven = mesh.fixtures
				.filter((f) => !f.glow && f.base !== 0)
				.map((f) => f.kind)
				.filter((kind) => kind !== "work" || type === "shipyard");
			expect([type, undriven]).toEqual([type, []]);
		}
	});

	test("a glow's drive never exceeds the exposure ceiling", () => {
		for (const type of STATION_TYPES) {
			const mesh = buildStationMesh(type, GREY, 0, 0);
			for (const t of [0, 0.05, 0.75, 1.05, 1.75, 7.42]) {
				updateStationVisuals(mesh, t, 1, "high");
				mesh.root.traverse((object) => {
					if (!object.userData.glow) return;
					const material = (object as THREE.Points)
						.material as THREE.ShaderMaterial;
					expect(material.uniforms.uIntensity.value <= EMISSIVE_CEILING).toBe(
						true,
					);
				});
			}
		}
	});
});

/**
 * **A blinking point light carries a white-hot core above the ceiling** (#300).
 *
 * Measured on the principal's GPU, facing each station from the cockpit: the
 * docking-face strobes and the mouth ring sit on or beside the brightest
 * surfaces a station has — lit plating, the amber aperture frame, the
 * nameplate — which read 141–227 of 255 at the lamps' own screen positions from
 * 6 to 19 km. A glow capped at the emissive ceiling added onto that cannot
 * stand out (strobe-b at 18.6 km: 212 lit, 212 hidden), while the truss beacons
 * against black space read at peak 226. The principal's ruling amends #199's
 * exposure rule for **blinking point lights only**: their core crosses the
 * bloom threshold, as the ship's nav lights already do. Steady lights —
 * windows, floods, the flare throats, the welding arc — stay under it.
 */
describe("a blinking point light burns past the bloom threshold; a steady light does not", () => {
	const BLINKING = new Set(["strobe-a", "strobe-b", "chase", "beacon"]);

	test("every blinking fixture's glow has a core that crosses the threshold, every other glow has none", () => {
		for (const type of ["trade", "shipyard", "refinery"] as const) {
			const mesh = buildStationMesh(type, GREY, 0, 0);
			const kindOfGlow = new Map<THREE.Material, string>();
			for (const f of mesh.fixtures) if (f.glow) kindOfGlow.set(f.glow, f.kind);
			const wrong: string[] = [];
			mesh.root.traverse((object) => {
				if (!object.userData.glow) return;
				const material = (object as THREE.Points)
					.material as THREE.ShaderMaterial;
				const core = Number(material.uniforms.uCore?.value ?? Number.NaN);
				const kind = kindOfGlow.get(material) ?? "steady";
				const base = mesh.fixtures.find((f) => f.glow === material)?.base ?? 0;
				if (BLINKING.has(kind)) {
					// Peak radiance at the centre: the drive times (1 + core gain).
					if (!(core > 0 && base * (1 + core) > EXPOSURE.bloom.threshold))
						wrong.push(`${object.name}/${kind} core=${core} base=${base}`);
				} else if (core !== 0) {
					wrong.push(`${object.name}/${kind} steady light with core=${core}`);
				}
			});
			expect([type, wrong]).toEqual([type, []]);
		}
	});

	test("the core gain is in the shader, not only declared", () => {
		const mesh = buildStationMesh("trade", GREY, 0, 0);
		const strobe = mesh.fixtures.find((f) => f.kind === "strobe-a")?.glow;
		expect(strobe).toBeDefined();
		const source = (strobe as THREE.ShaderMaterial).fragmentShader;
		expect(source).toContain("uniform float uCore");
		// Read into the output, not just declared: a declared, unused uniform
		// compiles, links and draws exactly the old glow.
		expect(/uCore\s*\)|\*\s*uCore|uCore\s*\*/.test(source)).toBe(true);
	});
});
