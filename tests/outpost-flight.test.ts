/**
 * Node #1031: the authored outpost Salvage as the game builds it.
 *
 * `installShippedOutposts` installs `src/models/outpost-salvage.glb` through
 * the browser's loader and `createOutpostBuilder`, as the game does after
 * boot. These rows hold what a built station must be, in the station's own
 * frame: drawn from the model, its aperture plane on the sim's, its authored
 * pad as the `station-interior` group with exactly the berths its seed draws,
 * nothing turning, and inside the form's declared reach.
 *
 * And the written collision proxy (`src/outpost-proxies.ts`) against the
 * model the game draws, as `tests/refinery-flight.test.ts` holds the
 * refineries': fitted to the file that ships; the hull under the shipyards'
 * rule (at most 10 m of empty space collides); every drawn vertex held.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	installShippedOutposts,
	outpostModelHash,
	uninstallOutposts,
} from "../scripts/lib/shipped-outposts";
import {
	type Obb,
	outpostTriangles,
	overreaches,
	TriangleGrid,
} from "../scripts/lib/shipyard-proxies";
import { OUTPOST_GLB_URLS } from "../src/model-urls";
import {
	DECK_PLATE_COLOR,
	OUTPOST_FORMS,
	OUTPOST_MODEL_NAMES,
} from "../src/outpost-flight";
import { OUTPOST_PROXY_SOURCES } from "../src/outpost-proxies";
import {
	type ProxyBox,
	type ProxyPrimitive,
	outpostProxyBoxes,
	proxyContains,
	stationProxy,
} from "../src/station-proxy";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import {
	INTERIOR_GROUP_NAME,
	STATION_INTERIOR_EMISSIVE_INTENSITIES,
} from "../src/station-interior-mesh";
import { buildStationForm, stationSilhouetteKm } from "../src/station-mesh";
import {
	AUTHORED_EXTERIOR_NAME,
	isAuthoredStation,
} from "../src/station-visuals";

const PLANE_KM = STATION_GEOMETRY.outpost.aperturePlaneKm;
const CORE_KM = STATION_GEOMETRY.outpost.coreRadiusKm;
/** Both sides of the seeded berth: port on an even seed, starboard on odd. */
const BERTH_SEEDS = [6, 7];

beforeAll(installShippedOutposts);
afterAll(uninstallOutposts);

describe("authored outpost Salvage (#1031)", () => {
	for (const form of OUTPOST_FORMS) {
		describe(`form ${form}`, () => {
			const build = (berthSeed = 7) =>
				buildStationForm("outpost", form, 0x888888, berthSeed, 7);

			test("is drawn from its model, and does not turn", () => {
				const mesh = build();
				expect(isAuthoredStation(mesh.root)).toBe(true);
				expect(mesh.type).toBe("outpost");
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
				const pad = mesh.root.getObjectByName(INTERIOR_GROUP_NAME);
				expect(pad).toBeDefined();
				for (const part of ["interior-deck", "interior-lane-edge"])
					expect([part, pad!.getObjectByName(part) !== undefined]).toEqual([
						part,
						true,
					]);
				mesh.dispose();
			});

			test("draws the berths its seed draws, each its own part, and no other", () => {
				// What `probe-dock-arrival` reads: a `berth-<id>` object with a
				// mesh for each berth `stationInterior` declares. The model carries
				// both sides of the seeded berth; a station keeps its own.
				for (const seed of BERTH_SEEDS) {
					const mesh = build(seed);
					const ids = stationInterior("outpost", PLANE_KM, seed).berths.map(
						(b) => b.id,
					);
					const drawn: string[] = [];
					// A berth's group, not the meshes inside it.
					mesh.root.traverse((o) => {
						if (
							o.name.startsWith("berth-") &&
							!o.parent?.name.startsWith("berth-")
						)
							drawn.push(o.name);
					});
					expect([seed, drawn.sort()]).toEqual([
						seed,
						ids.map((id) => `berth-${id}`).sort(),
					]);
					for (const id of ids) {
						let meshes = 0;
						mesh.root.getObjectByName(`berth-${id}`)?.traverse((o) => {
							if (o instanceof THREE.Mesh) meshes++;
						});
						expect([seed, id, meshes > 0]).toEqual([seed, id, true]);
					}
					mesh.dispose();
				}
			});

			test("lights its deck as the procedural pad, and leaves the hull's materials alone", () => {
				// Principal, 2026-10-19: the authored deck read black on its night
				// side, where the procedural pad keeps its own dim glow.
				const mesh = build();
				const deck = mesh.root.getObjectByName("interior-deck") as THREE.Mesh;
				const glow = deck.material as THREE.MeshStandardMaterial;
				expect(glow.emissiveIntensity).toBe(
					STATION_INTERIOR_EMISSIVE_INTENSITIES.padShell,
				);
				const hull = new Set<THREE.Material>();
				mesh.root.getObjectByName(AUTHORED_EXTERIOR_NAME)!.traverse((o) => {
					if (o instanceof THREE.Mesh) hull.add(o.material as THREE.Material);
				});
				expect(hull.has(glow)).toBe(false);
				// Option 3: the deck plates' middle grey, on the pad alone.
				const plates = new Set<THREE.MeshStandardMaterial>();
				deck.parent!.traverse((o) => {
					if (
						o instanceof THREE.Mesh &&
						(o.material as THREE.Material).name === "landing-grey"
					)
						plates.add(o.material as THREE.MeshStandardMaterial);
				});
				expect(plates.size).toBeGreaterThan(0);
				for (const p of plates)
					expect(p.color.getHex()).toBe(
						new THREE.Color(DECK_PLATE_COLOR).getHex(),
					);
				for (const m of hull)
					if (m.name === "landing-grey")
						expect((m as THREE.MeshStandardMaterial).color.getHex()).not.toBe(
							new THREE.Color(DECK_PLATE_COLOR).getHex(),
						);
				for (const m of hull)
					if (m.name === glow.name)
						expect((m as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
				mesh.dispose();
			});

			test("names its study lamps as the role's windows", () => {
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
				expect(reach).toBeLessThanOrEqual(stationSilhouetteKm("outpost", form));
				mesh.dispose();
			});
		});
	}
});

const ROW_MS = 120_000;
/** How far outside its proxy a drawn vertex of the hull may lie, as the
 *  shipyards' (`tests/shipyard-flight.test.ts`). */
const HULL_COVER_M = 1.5;

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

test("one name a form: the model-URL literals agree with OUTPOST_MODEL_NAMES", () => {
	for (const form of OUTPOST_FORMS)
		expect(OUTPOST_GLB_URLS[form].split("/").pop()).toBe(
			`outpost-${OUTPOST_MODEL_NAMES[form]}.glb`,
		);
});

describe("node #1031: the outpost Salvage's collision proxy", () => {
	afterAll(uninstallOutposts);

	test("was fitted to the model that ships", () => {
		for (const form of OUTPOST_FORMS)
			expect(outpostModelHash(form)).toBe(OUTPOST_PROXY_SOURCES[form]);
	});

	test("is what the sim collides with whatever is drawn, the stand-in included", async () => {
		// The sim's proxy does not read the install: an outpost whose model is
		// still loading, or failed to, draws its procedural stand-in and is
		// solid as the authored Salvage (as the refineries, #819). The stand-in
		// is not solid; that is the ruling, not a gap.
		uninstallOutposts();
		const before = OUTPOST_FORMS.map((form) => {
			const mesh = buildStationForm("outpost", form, 0x888888, 7, 7);
			const authored = isAuthoredStation(mesh.root);
			mesh.dispose();
			return [authored, stationProxy("outpost", form, 7, 7)];
		});
		await installShippedOutposts();
		OUTPOST_FORMS.forEach((form, i) => {
			const [standIn, proxy] = before[i] as [boolean, unknown];
			expect(standIn).toBe(false);
			expect(proxy).toBe(stationProxy("outpost", form, 7, 7));
			const p = proxy as { spinning: readonly unknown[] };
			expect(p.spinning.length).toBeGreaterThan(outpostProxyBoxes(form).length);
		});
	});

	for (const form of OUTPOST_FORMS) {
		test(
			`form ${form}: no hull box stands more than 10 m off the drawn model`,
			async () => {
				const grid = new TriangleGrid(await outpostTriangles(form));
				const far = outpostProxyBoxes(form)
					.map(metres)
					.filter((o) => overreaches(o, grid));
				expect(far.length).toBe(0);
			},
			ROW_MS,
		);

		test(
			`form ${form}: every drawn vertex of the hull is held within 1.5 m`,
			async () => {
				const tris = await outpostTriangles(form);
				const proxy = stationProxy("outpost", form, 0, 0)!;
				expect(
					uncovered(tris, [...proxy.spinning, ...proxy.static], HULL_COVER_M),
				).toEqual([]);
			},
			ROW_MS,
		);
	}
});
