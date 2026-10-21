/**
 * Node #814: the shipped Bollard O4 is the approved study (#798, 26d6958).
 *
 * `spikes/bollard-hull/prepare-flight-asset.mjs` writes it losslessly —
 * Meshopt with the NONE filter and lossless WebP, no quantization — so every
 * geometry row here is exact. Node #909 permits only #887's shared paint lift;
 * every other material property stays the study's. Both files decode through the browser's loader
 * (`decodeShippedGlb`). What the game makes of the model (its frame, envelope
 * and berths) is the hull's to hold, not this file's.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
	AUTHORED_HULL_PAINT_LIFT,
	appliedTintScale,
	appliedMetalness,
	ceilingedMetalness,
	rosterPaintedDiffuse,
	MAX_DIFFUSE_OF_ROSTER,
} from "../scripts/lib/authored-hull-paint.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import type { HullEnvelope } from "../src/hull";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";

const SHIPPED = "src/models/bollard-tug.glb";
const STUDY = "spikes/bollard-hull/bollard-hull.glb";

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

describe("the shipped file is the approved study", () => {
	test("only the shared lift's colour and metallic factors change", () => {
		const study = materials(STUDY);
		const shipped = materials(SHIPPED);
		expect(shipped.map((m: { name: string }) => m.name).sort()).toEqual(
			study.map((m: { name: string }) => m.name).sort(),
		);
		let moved = 0;
		for (const material of study) {
			const want = structuredClone(material);
			const rule = AUTHORED_HULL_PAINT_LIFT[material.name];
			if (rule) {
				const pbr = want.pbrMetallicRoughness;
				const from = {
					tint: pbr.baseColorFactor,
					metalness: pbr.metallicFactor,
				};
				const scale = appliedTintScale(from, rule);
				pbr.baseColorFactor = from.tint.map((v: number, i: number) =>
					i === 3 ? v : Math.min(1, v * scale),
				);
				pbr.metallicFactor = ceilingedMetalness(
					pbr.baseColorFactor,
					appliedMetalness(from, rule),
					0.4755434471582678,
					rosterPaintedDiffuse() * MAX_DIFFUSE_OF_ROSTER,
					from.metalness,
				);
				moved++;
			}
			expect(
				shipped.find((m: { name: string }) => m.name === material.name),
			).toEqual(want);
		}
		expect(moved).toBe(6);
	});

	test("the encoding is lossless: Meshopt required, no quantization, WebP texture", () => {
		const json = glbJson(SHIPPED);
		expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
		expect(json.extensionsUsed).not.toContain("KHR_mesh_quantization");
		expect(json.images.map((i: { mimeType: string }) => i.mimeType)).toEqual([
			"image/webp",
		]);
	});

	test("every triangle of every mesh is the study's, every attribute exact", async () => {
		const study = triangleSets(await decodeShippedGlb(STUDY));
		const shipped = triangleSets(await decodeShippedGlb(SHIPPED));
		expect([...shipped.keys()].sort()).toEqual([...study.keys()].sort());
		let total = 0;
		for (const [name, triangles] of study) {
			expect([name, shipped.get(name)]).toEqual([name, triangles]);
			total += triangles.length;
		}
		expect([study.size, total]).toEqual([15, 444_600]);
	}, 120_000);
});

describe("the study's frame", () => {
	const box = async () => {
		const scene = await decodeShippedGlb(SHIPPED);
		scene.updateMatrixWorld(true);
		return new THREE.Box3().setFromObject(scene);
	};

	test("metres, Y up, the length on z: 56.6 x 48.4 x 21.2 m", async () => {
		const size = (await box()).getSize(new THREE.Vector3());
		expect([size.z, size.x, size.y].map((m) => Math.ceil(m * 10) / 10)).toEqual(
			[56.6, 48.4, 21.2],
		);
	});

	// Against the berths themselves, not `HULL_SPECS.tug.env`: once the row
	// takes this box, comparing with it would compare the box with itself. The
	// procedural tug (58.5 x 45.7 x 25.7 m) fitted every berth too.
	test("the model's box fits every berth of every role", async () => {
		const size = (await box()).getSize(new THREE.Vector3());
		const model: HullEnvelope = {
			lengthKm: size.z / 1000,
			beamKm: size.x / 1000,
			heightKm: size.y / 1000,
		};
		for (const type of STATION_TYPES) {
			const { berths } = stationInterior(
				type,
				STATION_GEOMETRY[type].aperturePlaneKm,
				1,
			);
			expect([type, berths.filter((b) => berthFits(b, model)).length]).toEqual([
				type,
				berths.length,
			]);
		}
	});
});
