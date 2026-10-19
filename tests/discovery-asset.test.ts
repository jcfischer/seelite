/**
 * Node #820: the shipped Discovery / Voyager A is the accepted study (#809,
 * accepted 2026-10-09), turned onto the game's axis.
 *
 * `spikes/discovery/prepare-flight-asset.mjs` turns the study's nose from +X
 * onto +Z — the rigid map (x, y, z) -> (-z, y, x), exact in floats — and
 * writes it losslessly: Meshopt with the NONE filter and lossless WebP, no
 * quantization, and no paint change (the #887 lift is not applied; the
 * principal accepted the look as authored). So every geometry row here is
 * exact. Both files decode through the browser's loader (`decodeShippedGlb`).
 * What the game makes of the model (its scale, frame and envelope) is the
 * hull's to hold (`tests/voyager-hull.test.ts`), not this file's.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { HULL_SPECS } from "../src/hull";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { stationInterior } from "../src/station-interior";

const SHIPPED = "src/models/discovery-voyager.glb";
const STUDY = "spikes/discovery/discovery.glb";

/** Each mesh's triangles, every corner's every attribute, winding kept: the
 *  smallest of a triangle's three rotations, sorted. Keyed by mesh name. */
function triangleSets(scene: THREE.Object3D): Map<string, string[]> {
	const out = new Map<string, string[]>();
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const g = o.geometry as THREE.BufferGeometry;
		const names = Object.keys(g.attributes).sort();
		const corner = (v: number) =>
			names
				.map((n) => {
					const a = g.getAttribute(n);
					return Array.from({ length: a.itemSize }, (_, k) =>
						a.getComponent(v, k),
					).join(",");
				})
				.join("|");
		const index = g.getIndex();
		const count = index ? index.count : g.getAttribute("position").count;
		const triangles: string[] = [];
		for (let i = 0; i < count; i += 3) {
			const c = [0, 1, 2].map((k) => corner(index ? index.getX(i + k) : i + k));
			triangles.push(
				[0, 1, 2]
					.map((s) => [c[s], c[(s + 1) % 3], c[(s + 2) % 3]].join(" / "))
					.sort()[0],
			);
		}
		out.set(o.name, triangles.sort());
	});
	return out;
}

/** The prepare step's turn, applied to a decoded study in place. */
function turnNoseOntoZ(scene: THREE.Object3D): void {
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const name of ["position", "normal"]) {
			const a = o.geometry.getAttribute(name);
			for (let i = 0; i < a.count; i++) {
				const [x, y, z] = [a.getX(i), a.getY(i), a.getZ(i)];
				a.setXYZ(i, -z, y, x);
			}
		}
	});
}

function glbJson(path: string) {
	const file = readFileSync(path);
	return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
}

/** Resolve texture identity across dedup and PNG-to-lossless-WebP encoding. */
function materials(path: string) {
	const json = glbJson(path);
	return json.materials.map(
		(material: {
			name: string;
			pbrMetallicRoughness: {
				baseColorFactor: number[];
				metallicFactor: number;
				baseColorTexture?: { index: number };
			};
		}) => {
			const map = material.pbrMetallicRoughness.baseColorTexture;
			if (!map) return material;
			const texture = json.textures[map.index];
			const source =
				texture.source ?? texture.extensions.EXT_texture_webp.source;
			const { index: _index, ...settings } = map;
			return {
				...material,
				pbrMetallicRoughness: {
					...material.pbrMetallicRoughness,
					baseColorTexture: {
						...settings,
						image: json.images[source].name,
						sampler: {
							wrapS: 10497,
							wrapT: 10497,
							...json.samplers[texture.sampler],
						},
					},
				},
			};
		},
	);
}

describe("the shipped file is the accepted study", () => {
	test("every material is the study's: the look the principal accepted", () => {
		const study = materials(STUDY);
		const shipped = materials(SHIPPED);
		expect(shipped.map((m: { name: string }) => m.name).sort()).toEqual(
			study.map((m: { name: string }) => m.name).sort(),
		);
		for (const material of study)
			expect(
				shipped.find((m: { name: string }) => m.name === material.name),
			).toEqual(material);
	});

	test("the encoding is lossless: Meshopt required, no quantization, WebP textures", () => {
		const json = glbJson(SHIPPED);
		expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
		expect(json.extensionsUsed).not.toContain("KHR_mesh_quantization");
		expect(json.images.length).toBe(3);
		for (const image of json.images) expect(image.mimeType).toBe("image/webp");
	});

	test("every triangle of every mesh is the study's, turned, every attribute exact", async () => {
		const study = await decodeShippedGlb(STUDY);
		turnNoseOntoZ(study);
		const turned = triangleSets(study);
		const shipped = triangleSets(await decodeShippedGlb(SHIPPED));
		expect([...shipped.keys()].sort()).toEqual([...turned.keys()].sort());
		let total = 0;
		for (const [name, triangles] of turned) {
			expect([name, shipped.get(name)]).toEqual([name, triangles]);
			total += triangles.length;
		}
		expect([turned.size, total]).toEqual([18, 541_843]);
	}, 240_000);
});

describe("the study's frame", () => {
	const box = async () => {
		const scene = await decodeShippedGlb(SHIPPED);
		scene.updateMatrixWorld(true);
		return new THREE.Box3().setFromObject(scene);
	};

	test("metres, Y up, the nose on +z: 141.7 x 24.4 x 26.8 m", async () => {
		const b = await box();
		const size = b.getSize(new THREE.Vector3());
		expect([size.z, size.x, size.y].map((m) => Math.ceil(m * 10) / 10)).toEqual(
			[141.7, 24.4, 26.8],
		);
		// The command sphere is the bow, the drive block the stern.
		expect(b.max.z).toBeCloseTo(62.57, 2);
		expect(b.min.z).toBeCloseTo(-79.06, 2);
	});

	// Why the scale is a roster decision and not a berth one: drawn at the
	// study's own size the model is still longer than the longest berth in the
	// game, so the capital refusal (`tests/hull.test.ts`) does not depend on
	// the ×1.35 that `voyager-hull.ts` applies. The row's 191 m is the film's.
	test("even at 1:1 the model is longer than every berth, so no scale above that admits it", async () => {
		const size = (await box()).getSize(new THREE.Vector3());
		for (const type of STATION_TYPES) {
			const { berths } = stationInterior(
				type,
				STATION_GEOMETRY[type].aperturePlaneKm,
				1,
			);
			for (const berth of berths)
				expect([type, size.z / 1000 > berth.clearLengthKm]).toEqual([
					type,
					true,
				]);
		}
		expect(HULL_SPECS.voyager.env.lengthKm).toBeGreaterThan(size.z / 1000);
	});
});
