import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Vector3, Quaternion } from "three";

for (const id of ["o1", "o2", "o3"]) {
	test(`${id}: export has an independent coaxial capsule and embedded surface texture`, () => {
		const bytes = readFileSync(new URL(`./${id}.glb`, import.meta.url));
		expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
		const doc = JSON.parse(
			bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
		);
		const capsule = doc.nodes.find((n: any) => n.name === "life-capsule");
		const port = doc.nodes.find((n: any) => n.name === "docking-centre");
		const bearing = doc.nodes.find((n: any) => n.name === "bearing-centre");
		expect(capsule).toBeDefined();
		expect(port).toBeDefined();
		expect(bearing).toBeDefined();
		expect(capsule.children).toContain(doc.nodes.indexOf(port));
		expect(port.translation[0]).toBeCloseTo(0, 3);
		expect(port.translation[1]).toBeCloseTo(0, 3);
		expect(port.translation[2]).toBeGreaterThan(0);
		const axis = new Vector3(0, 0, 1).applyQuaternion(
			new Quaternion(...(capsule.rotation ?? [0, 0, 0, 1])),
		);
		const centre = new Vector3(...capsule.translation);
		expect(
			new Vector3(...bearing.translation).sub(centre).cross(axis).length(),
		).toBeLessThan(0.001);
		if (id === "o3") {
			expect(axis.y).toBeCloseTo(1, 5);
			expect(centre.x).toBe(0);
			expect(centre.z).toBe(-620);
		}

		const tools = doc.nodes.filter((n: any) => n.extras?.tool_motion);
		expect(tools.length).toBeGreaterThanOrEqual(8);
		for (const joint of tools) {
			expect(joint.extras.amplitude).toBeGreaterThan(0);
			if (joint.extras.tool_motion === "pivot") {
				expect(joint.extras.amplitude).toBeLessThanOrEqual(0.16);
				expect(
					doc.nodes.some(
						(n: any) =>
							n.extras?.tool_motion &&
							n.children?.includes(doc.nodes.indexOf(joint)),
					),
				).toBe(true);
			}
		}
		expect(doc.images.length).toBeGreaterThan(0);
		expect(
			doc.materials.some((m: any) => m.pbrMetallicRoughness?.baseColorTexture),
		).toBe(true);
		expect(doc.meshes.some((m: any) => m.name.includes("throat"))).toBe(true);
		expect(
			doc.meshes.some((m: any) => m.name.includes("pressurized-access-shell")),
		).toBe(true);
		expect(
			doc.meshes.some((m: any) => m.name.includes("pressurized-access-lining")),
		).toBe(true);
		const root = doc.nodes.find((n: any) => n.name === `shipyard-${id}`);
		const route = JSON.parse(root.extras.crew_route_author_units);
		const end = route.at(-1);
		expect(
			new Vector3(...end)
				.multiplyScalar(10)
				.distanceTo(centre.clone().addScaledVector(axis, -102)),
		).toBeLessThan(0.001);
		expect(root.extras.tooling).toBe(
			"rigid guided manipulators with positive clamps",
		);
		const tris = doc.meshes.reduce(
			(n: number, m: any) =>
				n +
				m.primitives.reduce(
					(s: number, p: any) => s + doc.accessors[p.indices].count / 3,
					0,
				),
			0,
		);
		expect(tris).toBeGreaterThan(10000);
		expect(tris).toBeLessThan(1500000);
	});
}
