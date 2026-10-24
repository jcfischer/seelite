import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { type HullEnvelope, HULL_SPECS } from "../src/hull";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";

const SHIPPED = "src/models/lance-interceptor.glb";
const STUDY = "spikes/seven-ships/interceptor/model.glb";
const SHIPPED_BYTES = 13_116_788;
const SHIPPED_SHA256 =
	"cff8d0393e276fcfaca1851ba4da1723a16c6e54bc9d6723f8a03b3367ec7923";

const glbJson = (path: string) => {
	const file = readFileSync(path);
	return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
};

const meshesOf = (scene: THREE.Object3D) => {
	const out: THREE.Mesh[] = [];
	scene.traverse((o) => {
		if (o instanceof THREE.Mesh) out.push(o);
	});
	return out;
};

describe("the shipped file", () => {
	test("is under the host's per-asset limit, and is the recorded file", () => {
		expect(statSync(SHIPPED).size).toBe(SHIPPED_BYTES);
		expect(SHIPPED_BYTES).toBeLessThan(25_000_000);
		expect(statSync(STUDY).size).toBeGreaterThan(25_000_000);
		expect(
			createHash("sha256").update(readFileSync(SHIPPED)).digest("hex"),
		).toBe(SHIPPED_SHA256);
	});

	test("is Meshopt with quantised normals and lossless WebP textures", () => {
		const json = glbJson(SHIPPED);
		expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
		expect(json.extensionsRequired).toContain("KHR_mesh_quantization");
		for (const image of json.images) expect(image.mimeType).toBe("image/webp");
		for (const mesh of json.meshes)
			for (const primitive of mesh.primitives) {
				expect(
					json.accessors[primitive.attributes.POSITION].componentType,
				).toBe(5126);
				expect(json.accessors[primitive.attributes.NORMAL].componentType).toBe(
					5122,
				);
				expect(
					json.accessors[primitive.attributes.TEXCOORD_0].componentType,
				).toBe(5126);
			}
	});

	test("every material is the study's: the look the principal accepted", () => {
		const names = (path: string) =>
			glbJson(path)
				.materials.map(
					(m: {
						name: string;
						pbrMetallicRoughness: {
							baseColorFactor?: number[];
							metallicFactor?: number;
							roughnessFactor?: number;
						};
						emissiveFactor?: number[];
					}) =>
						JSON.stringify([
							m.name,
							m.pbrMetallicRoughness.baseColorFactor,
							m.pbrMetallicRoughness.metallicFactor,
							m.pbrMetallicRoughness.roughnessFactor,
							m.emissiveFactor,
						]),
				)
				.sort();
		expect(names(SHIPPED)).toEqual(names(STUDY));
	});

	test("every triangle and position is the study's, exact; normals and UVs differ by one quantisation step", async () => {
		const shape = (scene: THREE.Object3D) =>
			meshesOf(scene)
				.map((m) => {
					const position = m.geometry.getAttribute("position");
					const normal = m.geometry.getAttribute("normal");
					const uv = m.geometry.getAttribute("uv");
					const index = m.geometry.getIndex();
					const triangles = [];
					const count = index ? index.count : position.count;
					for (let i = 0; i < count; i += 3) {
						const corners = [0, 1, 2].map((k) => {
							const v = index ? index.getX(i + k) : i + k;
							return {
								key: [
									position.getX(v),
									position.getY(v),
									position.getZ(v),
								].join(","),
								attributes: [
									normal.getX(v),
									normal.getY(v),
									normal.getZ(v),
									uv ? uv.getX(v) : 0,
									uv ? uv.getY(v) : 0,
								],
							};
						});
						const rotations = [0, 1, 2].map((r) => [
							corners[r],
							corners[(r + 1) % 3],
							corners[(r + 2) % 3],
						]);
						const keyOf = (c: typeof corners) => c.map((x) => x.key).join("|");
						const ordered = rotations.sort((x, y) =>
							keyOf(x).localeCompare(keyOf(y)),
						)[0];
						triangles.push({
							key: ordered.map((c) => c.key).join("|"),
							attributes: ordered.flatMap((c) => c.attributes),
						});
					}
					return {
						name: m.name,
						triangles: triangles.sort((a, b) => a.key.localeCompare(b.key)),
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name));
		const a = shape(await decodeShippedGlb(STUDY));
		const b = shape(await decodeShippedGlb(SHIPPED));
		expect(b.map((m) => m.name)).toEqual(a.map((m) => m.name));
		expect(b.length).toBe(15);
		expect(b.reduce((n, m) => n + m.triangles.length, 0)).toBe(587_810);
		for (let i = 0; i < a.length; i++) {
			expect(b[i].triangles.map((t) => t.key)).toEqual(
				a[i].triangles.map((t) => t.key),
			);
			let normalError = 0;
			let uvError = 0;
			for (let j = 0; j < a[i].triangles.length; j++) {
				const expected = a[i].triangles[j].attributes;
				b[i].triangles[j].attributes.forEach((value, k) => {
					const error = Math.abs(value - expected[k]);
					if (k % 5 < 3) normalError = Math.max(normalError, error);
					else uvError = Math.max(uvError, error);
				});
			}
			expect([a[i].name, normalError <= 1 / 32767 + 1e-6]).toEqual([
				a[i].name,
				true,
			]);
			expect([a[i].name, uvError <= 1 / 65535]).toEqual([a[i].name, true]);
		}
	}, 120_000);
});

describe("the study's frame", () => {
	const box = async () => {
		const scene = await decodeShippedGlb(SHIPPED);
		scene.updateMatrixWorld(true);
		return new THREE.Box3().setFromObject(scene);
	};

	test("metres, Y up, the nose on +z: 62.31 x 25.02 x 25.02 m", async () => {
		const b = await box();
		const size = b.getSize(new THREE.Vector3());
		expect(size.z).toBeCloseTo(62.3085, 3);
		expect(size.x).toBeCloseTo(25.022, 3);
		expect(size.y).toBeCloseTo(25.0198, 3);
		const scene = await decodeShippedGlb(SHIPPED);
		scene.updateMatrixWorld(true);
		const canopy = new THREE.Box3()
			.setFromObject(scene.getObjectByName("canopy-glass") as THREE.Object3D)
			.getCenter(new THREE.Vector3());
		expect(canopy.z).toBeGreaterThan(b.getCenter(new THREE.Vector3()).z);
	});

	test("fits the interceptor's declared envelope, and admits every berth the loft's box did", async () => {
		const size = (await box()).getSize(new THREE.Vector3());
		const model: HullEnvelope = {
			lengthKm: size.z / 1000,
			beamKm: size.x / 1000,
			heightKm: size.y / 1000,
		};
		const loft: HullEnvelope = {
			lengthKm: 0.0624,
			beamKm: 0.0253,
			heightKm: 0.0252,
		};
		expect(HULL_SPECS.interceptor.env).toEqual(loft);
		expect(model.lengthKm).toBeLessThanOrEqual(loft.lengthKm);
		expect(model.beamKm).toBeLessThanOrEqual(loft.beamKm);
		expect(model.heightKm).toBeLessThanOrEqual(loft.heightKm);
		expect(model.lengthKm).toBeLessThanOrEqual(
			HULL_SPECS.interceptor.env.lengthKm,
		);
		expect(model.beamKm).toBeLessThanOrEqual(HULL_SPECS.interceptor.env.beamKm);
		expect(model.heightKm).toBeLessThanOrEqual(
			HULL_SPECS.interceptor.env.heightKm,
		);
		let admitted = 0;
		for (const type of STATION_TYPES) {
			const { berths } = stationInterior(
				type,
				STATION_GEOMETRY[type].aperturePlaneKm,
				1,
			);
			for (const berth of berths) {
				if (berthFits(berth, loft)) {
					expect([type, berthFits(berth, model)]).toEqual([type, true]);
					admitted++;
				}
				expect([type, berthFits(berth, model)]).toEqual([
					type,
					berthFits(berth, HULL_SPECS.interceptor.env),
				]);
			}
		}
		expect(admitted).toBeGreaterThan(0);
	});
});
