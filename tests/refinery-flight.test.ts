/**
 * Node #819: the four authored refineries as the game builds them.
 *
 * `installShippedRefineries` installs `src/models/refinery-*.glb` through the
 * browser's loader and `createRefineryBuilder`, as the game does after boot.
 * These rows hold what a built station must be, in the station's own frame:
 * drawn from the model, its aperture plane on the sim's, the sim's pad deck
 * drawn into it, nothing turning, and inside the form's declared reach.
 *
 * And the written collision proxies (`src/refinery-proxies.ts`) against the
 * models the game draws, as `tests/shipyard-flight.test.ts` holds the
 * shipyards': fitted to the files that ship; the plant and housing under the
 * shipyards' rule (at most 10 m of empty space collides); the rock within
 * 20 m (principal, 2026-10-13): every face of the filled rock that is not
 * against another of its boxes stands within 20 m of the rock's surface; and
 * every drawn vertex held.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	installShippedRefineries,
	refineryModelHash,
	uninstallRefineries,
} from "../scripts/lib/shipped-refineries";
import {
	type Obb,
	overreaches,
	ROCK_LIMIT_M,
	ROCK_PATCH_M,
	refineryTriangles,
	TriangleGrid,
} from "../scripts/lib/shipyard-proxies";
import { REFINERY_GLB_URLS } from "../src/model-urls";
import { REFINERY_FORMS, REFINERY_MODEL_NAMES } from "../src/refinery-flight";
import { REFINERY_PROXY_SOURCES } from "../src/refinery-proxies";
import {
	type ProxyBox,
	type ProxyPrimitive,
	proxyContains,
	refineryProxyBoxes,
	stationProxy,
} from "../src/station-proxy";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { INTERIOR_GROUP_NAME } from "../src/station-interior-mesh";
import { buildStationForm, stationSilhouetteKm } from "../src/station-mesh";
import { isAuthoredStation } from "../src/station-visuals";

const PLANE_KM = STATION_GEOMETRY.refinery.aperturePlaneKm;
const CORE_KM = STATION_GEOMETRY.refinery.coreRadiusKm;

beforeAll(installShippedRefineries);
afterAll(uninstallRefineries);

describe("authored refineries (#819)", () => {
	for (const form of REFINERY_FORMS) {
		describe(`form ${form}`, () => {
			const build = () => buildStationForm("refinery", form, 0x888888, 7, 7);

			test("is drawn from its model, and does not turn", () => {
				const mesh = build();
				expect(isAuthoredStation(mesh.root)).toBe(true);
				expect(mesh.type).toBe("refinery");
				expect(mesh.formId).toBe(form);
				expect(mesh.spinner.children).toEqual([]);
				mesh.dispose();
			});

			test("puts the model's aperture plane on the sim's", () => {
				const mesh = build();
				mesh.root.updateMatrixWorld(true);
				const mark = mesh.root.getObjectByName("aperture-plane");
				expect(mark).toBeDefined();
				// The root is one core radius across; the caller scales it.
				const p = mark!
					.getWorldPosition(new THREE.Vector3())
					.multiplyScalar(CORE_KM);
				expect(Math.abs(p.x)).toBeLessThan(1e-6);
				expect(Math.abs(p.y)).toBeLessThan(1e-6);
				expect(Math.abs(p.z - PLANE_KM)).toBeLessThan(1e-6);
				mesh.dispose();
			});

			test("carries its authored pad, as the station-interior group", () => {
				const mesh = build();
				expect(mesh.root.getObjectByName(INTERIOR_GROUP_NAME)).toBeDefined();
				mesh.dispose();
			});

			test("draws every berth in the sim's catalogue as its own part", () => {
				// What `probe-dock-arrival` reads: a `berth-<id>` object with a mesh
				// for each berth `stationInterior` declares.
				const mesh = build();
				for (const berth of stationInterior("refinery", PLANE_KM, 7).berths) {
					const part = mesh.root.getObjectByName(`berth-${berth.id}`);
					let meshes = 0;
					part?.traverse((o) => {
						if (o instanceof THREE.Mesh) meshes++;
					});
					expect([berth.id, meshes > 0]).toEqual([berth.id, true]);
				}
				mesh.dispose();
			});

			// The §5 fixture "obstruction-beacon". // glossary-ignore: beacon
			test("carries the role's heat glow, flare and obstruction lamps on its pad frame", () => {
				// The principal's ruling of 2026-10-13 ("add lights"): §5's names,
				// each an object with a mesh, and their lights among the fixtures.
				const mesh = build();
				for (const name of ["heat-glow", "flare", "obstruction-beacon"]) {
					const found = mesh.root.getObjectByName(name);
					expect([name, found !== undefined]).toEqual([name, true]);
				}
				const kinds = new Set(mesh.fixtures.map((f) => f.kind));
				for (const kind of ["work", "flare", "beacon"])
					expect([kind, kinds.has(kind as never)]).toEqual([kind, true]);
				mesh.dispose();
			});

			test("names its study lamps as the role's windows", () => {
				// `AUTHORED_FIXTURE_NAMES.refinery`; a name that missed would leave
				// the per-fixture probe an empty list to pass on.
				const mesh = build();
				const windows = mesh.root.getObjectByName("windows");
				expect(windows).toBeDefined();
				let lit = 0;
				windows!.traverse((o) => {
					if (o instanceof THREE.Mesh) lit++;
				});
				expect(lit).toBeGreaterThan(0);
				mesh.dispose();
			});

			test("stays inside its declared reach", () => {
				const mesh = build();
				mesh.root.updateMatrixWorld(true);
				let reach = 0;
				const v = new THREE.Vector3();
				mesh.root.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					const p = o.geometry.getAttribute("position");
					for (let i = 0; i < p.count; i++)
						reach = Math.max(
							reach,
							v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).length() *
								CORE_KM,
						);
				});
				expect(reach).toBeLessThanOrEqual(
					stationSilhouetteKm("refinery", form),
				);
				mesh.dispose();
			});
		});
	}
});

const ROW_MS = 120_000;
/** How far outside its proxy a drawn vertex of the plant may lie, as the
 *  shipyards' (`tests/shipyard-flight.test.ts`). */
const PLANT_COVER_M = 1.5;
/** A rock face is sampled this often; a face point lies within half a
 *  square's diagonal of its nearest sample. */
const ROCK_SPACING_M = 2;

/** A decoded box in metres, as the fitter's boxes are. */
function metres(b: ProxyBox): Obb {
	const axis = (i: number) =>
		b.axes
			? new THREE.Vector3(b.axes[i].x, b.axes[i].y, b.axes[i].z)
			: new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
	return {
		c: new THREE.Vector3(b.cx, b.cy, b.cz).multiplyScalar(1000),
		axes: [axis(0), axis(1), axis(2)],
		half: [b.hx * 1000, b.hy * 1000, b.hz * 1000],
	};
}

/** Vertices farther than `coverM` outside the primitives. */
function uncovered(
	tris: readonly (readonly THREE.Vector3[])[],
	primitives: readonly ProxyPrimitive[],
	coverM: number,
): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	for (const v of new Set(tris.flat()))
		if (
			!proxyContains(
				primitives,
				v.x / 1000,
				v.y / 1000,
				v.z / 1000,
				coverM / 1000,
			)
		)
			out.push(v);
	return out;
}

/**
 * The samples on the rock's outer faces farther than the rule from its
 * surface. The rock is filled with voxels (`ROCK_VOXEL_M`) and patch cubes
 * (`ROCK_PATCH_M`), so its boxes lie on one 10 m grid: rebuilt from them
 * (rounded, since packing grows a box by a few
 * centimetres), a voxel face is outer when the voxel beside it is empty, and
 * a face against another voxel is inside the filled rock and owes nothing.
 * Each outer face is sampled every `ROCK_SPACING_M`.
 */
function rockOverreach(
	boxes: ProxyBox[],
	grid: TriangleGrid,
	h: number,
): THREE.Vector3[] {
	const limit = ROCK_LIMIT_M - (ROCK_SPACING_M * Math.SQRT2) / 2;
	const m = boxes.map(metres);
	const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
	for (const b of m)
		lo.min(
			new THREE.Vector3(
				b.c.x - b.half[0],
				b.c.y - b.half[1],
				b.c.z - b.half[2],
			),
		);
	const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
	const solid = new Set<string>();
	for (const b of m) {
		const i0 = Math.round((b.c.x - b.half[0] - lo.x) / h);
		const i1 = Math.round((b.c.x + b.half[0] - lo.x) / h);
		const j0 = Math.round((b.c.y - b.half[1] - lo.y) / h);
		const j1 = Math.round((b.c.y + b.half[1] - lo.y) / h);
		const k0 = Math.round((b.c.z - b.half[2] - lo.z) / h);
		const k1 = Math.round((b.c.z + b.half[2] - lo.z) / h);
		for (let i = i0; i < i1; i++)
			for (let j = j0; j < j1; j++)
				for (let k = k0; k < k1; k++) solid.add(key(i, j, k));
	}
	const far: THREE.Vector3[] = [];
	const n = Math.ceil(h / ROCK_SPACING_M);
	const p = new THREE.Vector3();
	for (const cell of solid) {
		const [i, j, k] = cell.split(",").map(Number);
		for (let a = 0; a < 3; a++)
			for (const sign of [-1, 1]) {
				const next = [i, j, k];
				next[a] += sign;
				if (solid.has(key(next[0], next[1], next[2]))) continue;
				const [u, v] = [0, 1, 2].filter((q) => q !== a);
				for (let s = 0; s <= n; s++)
					for (let t = 0; t <= n; t++) {
						const at = [i + 0.5, j + 0.5, k + 0.5];
						at[a] += sign * 0.5;
						at[u] += s / n - 0.5;
						at[v] += t / n - 0.5;
						p.set(lo.x + at[0] * h, lo.y + at[1] * h, lo.z + at[2] * h);
						if (!grid.within(p, limit)) far.push(p.clone());
					}
			}
	}
	return far;
}

test("one name a form: the model-URL literals agree with REFINERY_MODEL_NAMES", () => {
	for (const form of REFINERY_FORMS)
		expect(REFINERY_GLB_URLS[form].split("/").pop()).toBe(
			`refinery-${REFINERY_MODEL_NAMES[form]}.glb`,
		);
});

describe("node #819: the refineries' collision proxies", () => {
	afterAll(uninstallRefineries);

	test("were fitted to the models that ship", () => {
		for (const form of REFINERY_FORMS)
			expect(refineryModelHash(form)).toBe(REFINERY_PROXY_SOURCES[form]);
	});

	test("are what the sim collides with whatever is drawn, the stand-in included", async () => {
		// The sim's proxy does not read the install: a refinery whose model is
		// still loading, or failed to, draws its procedural stand-in and is
		// solid as the authored refinery (as the shipyards, #818). The stand-in
		// is not solid; that is the ruling, not a gap.
		uninstallRefineries();
		const before = REFINERY_FORMS.map((form) => {
			const mesh = buildStationForm("refinery", form, 0x888888, 7, 7);
			const authored = isAuthoredStation(mesh.root);
			mesh.dispose();
			return [authored, stationProxy("refinery", form, 7, 7)];
		});
		await installShippedRefineries();
		REFINERY_FORMS.forEach((form, i) => {
			const [standIn, proxy] = before[i] as [boolean, unknown];
			expect(standIn).toBe(false);
			expect(proxy).toBe(stationProxy("refinery", form, 7, 7));
			const { rock, plant } = refineryProxyBoxes(form);
			const p = proxy as { spinning: readonly unknown[] };
			expect(p.spinning.length).toBeGreaterThan(rock.length + plant.length);
		});
	});

	for (const form of REFINERY_FORMS) {
		test(
			`form ${form}: no plant box stands more than 10 m off the drawn model`,
			async () => {
				const tris = await refineryTriangles(form);
				const grid = new TriangleGrid(tris.plant);
				const far = refineryProxyBoxes(form)
					.plant.map(metres)
					.filter((o) => overreaches(o, grid));
				expect(far.length).toBe(0);
			},
			ROW_MS,
		);

		test(
			`form ${form}: the rock's outer faces stand within 20 m of the rock`,
			async () => {
				const tris = await refineryTriangles(form);
				const far = rockOverreach(
					refineryProxyBoxes(form).rock,
					new TriangleGrid(tris.rock),
					// Every rock box lies on the 10 m sub-grid: the voxels, and the
					// patch cubes of vertices the voxels left out.
					ROCK_PATCH_M,
				);
				if (far.length)
					console.log(
						`form ${form}: ${far.length} rock face samples too far, e.g. ` +
							far
								.slice(0, 3)
								.map(
									(v) =>
										`(${v.x.toFixed(0)}, ${v.y.toFixed(0)}, ${v.z.toFixed(0)})`,
								)
								.join("; "),
					);
				expect(far.length).toBe(0);
			},
			ROW_MS,
		);

		test(
			`form ${form}: every drawn vertex is held: the plant within 1.5 m, the rock within 20 m`,
			async () => {
				const tris = await refineryTriangles(form);
				const proxy = stationProxy("refinery", form, 0, 0)!;
				const all = [...proxy.spinning, ...proxy.static];
				expect(uncovered(tris.plant, all, PLANT_COVER_M)).toEqual([]);
				expect(uncovered(tris.rock, all, ROCK_LIMIT_M)).toEqual([]);
			},
			ROW_MS,
		);
	}
});
