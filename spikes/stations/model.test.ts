import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Vector3, Raycaster, Mesh, DoubleSide } from "three";
import { decodeShippedGlb } from "../../tests/helpers/read-coriolis-glb";
const names = [
	"ring",
	"drum",
	"assembly",
	"wheel",
	"derrick",
	"buoy",
	"rig",
	"cluster",
	"salvage",
];
describe("authored station deliverables", () => {
	for (const name of names)
		test(name + " has real textured geometry and a docking datum", () => {
			const b = readFileSync(new URL("./" + name + ".glb", import.meta.url));
			expect(b.toString("utf8", 0, 4)).toBe("glTF");
			expect(b.readUInt32LE(8)).toBe(b.length);
			const d = JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)));
			expect(d.nodes.some((n: any) => n.name === "docking-centre")).toBe(true);
			expect(d.images.length).toBeGreaterThan(0);
			let vertices = 0;
			for (const mesh of d.meshes)
				for (const p of mesh.primitives) {
					const a = d.accessors[p.attributes.POSITION];
					vertices += a.count;
					expect(
						a.min.every(Number.isFinite) && a.max.every(Number.isFinite),
					).toBe(true);
					expect(a.min.every((v: number, i: number) => v <= a.max[i])).toBe(
						true,
					);
				}
			expect(vertices).toBeGreaterThan(10000);
			expect(
				readFileSync(new URL("./" + name + ".blend", import.meta.url)).length,
			).toBeGreaterThan(100000);
		});
});
describe("approach clearance in exported geometry", () => {
	for (const name of names)
		test(
			name + " leaves the approach to the declared docking surface clear",
			async () => {
				const root = await decodeShippedGlb("spikes/stations/" + name + ".glb");
				root.updateMatrixWorld(true);
				root.traverse((o) => {
					if (o instanceof Mesh)
						for (const m of Array.isArray(o.material)
							? o.material
							: [o.material])
							m.side = DoubleSide;
				});
				const datum = root.getObjectByName("docking-centre")!;
				const p = datum.getWorldPosition(new Vector3());
				const axis =
					datum.userData.axis === "y"
						? new Vector3(0, 1, 0)
						: new Vector3(0, 0, 1);
				const side = new Vector3(1, 0, 0),
					up = axis.y ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
				for (const x of [-40, 0, 40])
					for (const y of [-20, 0, 20]) {
						const origin = p
							.clone()
							.addScaledVector(axis, 500)
							.addScaledVector(side, x)
							.addScaledVector(up, y);
						const hits = new Raycaster(
							origin,
							axis.clone().negate(),
							0,
							names.indexOf(name) < 4 ? 600 : 500,
						).intersectObject(root, true);
						// Slot entry stays clear 100 m into the model, not only up to the lip.
						expect(
							hits.filter(
								(h) => h.distance < (names.indexOf(name) < 4 ? 599 : 495),
							).length,
						).toBe(0);
					}
			},
		);
});

// Short rays at the intended outer skin catch missing end faces without
// accidentally accepting a wall on the opposite side of the module.
describe("pressure hull end closures", () => {
	for (const [name, rear] of [
		["ring", -155],
		["wheel", -185],
	] as const)
		test(name + " has a continuous rear bulkhead", async () => {
			const root = await decodeShippedGlb("spikes/stations/" + name + ".glb");
			root.updateMatrixWorld(true);
			for (const x of [-120, -60, 0, 60, 120])
				for (const y of [-100, -50, 0, 50, 100]) {
					const hits = new Raycaster(
						new Vector3(x, y, rear - 20),
						new Vector3(0, 0, 1),
						0,
						30,
					).intersectObject(root, true);
					expect(hits.length).toBeGreaterThan(0);
				}
		});
	test("salvage nose and tower have end skins", async () => {
		const root = await decodeShippedGlb("spikes/stations/salvage.glb");
		root.updateMatrixWorld(true);
		for (const y of [54, 60, 66])
			for (const z of [-36, -30, -24])
				expect(
					new Raycaster(
						new Vector3(390, y, z),
						new Vector3(-1, 0, 0),
						0,
						25,
					).intersectObject(root, true).length,
				).toBeGreaterThan(0);
		for (const x of [-35, -10, 15])
			for (const z of [-95, -70, -45])
				expect(
					new Raycaster(
						new Vector3(x, 320, z),
						new Vector3(0, -1, 0),
						0,
						50,
					).intersectObject(root, true).length,
				).toBeGreaterThan(0);
	});
});
