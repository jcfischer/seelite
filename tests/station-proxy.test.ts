/**
 * The station proxy budget rows (collision.md §9.1.11).
 *
 * Two rows hold the proxy as a budget, the same way `STATION_SILHOUETTE_KM`
 * holds `reachKm` (#28):
 *
 * 1. **No drawn vertex outside the proxy.** Every vertex of the built station
 *    lies inside the proxy, or within a stated tolerance of its boundary.
 *    Vertices inside the open interior volume (the bay or the corridor
 *    cylinder) are excluded — they belong to the interior group and are
 *    allowed to not be covered.
 *
 * 2. **No proxy outside the reach.** Every primitive lies inside `reachKm`.
 *
 * For a solved form, both rows run over `ASSEMBLY_SEEDS`. A row on a solved
 * form at seed zero checks one plan.
 *
 * The thinnest-primitive figure is declared and asserted.
 *
 * A selected form with no proxy is red.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import {
	SELECTED_FORM,
	STATION_SILHOUETTE_KM,
	buildStationForm,
	type StationFormId,
} from "../src/station-mesh";
import {
	stationProxy,
	proxyReachKm,
	proxyContains,
	type StationProxy,
} from "../src/station-proxy";
import { ASSEMBLY_SEEDS, isSolvedForm } from "./helpers/solved-forms";

const TYPES: StationType[] = STATION_TYPES;
const GREY = 0x9aa6b2;

/**
 * Tolerance for the vertex-inside-proxy check, in kilometres. Generous
 * enough to cover float32 rounding and the fact that small detail (lamps,
 * greebles, torus geometry) may protrude slightly beyond the proxy boxes.
 * The proxy is a budget, not a shrinkwrap.
 */
const VERTEX_TOLERANCE_KM = 0.06;

/**
 * Extract all world-space vertices from a built station mesh, classifying
 * each as "interior" (inside the aperture group's interior fittings) or
 * "exterior" (everything else).
 *
 * Interior vertices are inside the bay / landing-deck volume and are excluded from // glossary-ignore: pad (aperture kind)
 * the proxy containment check — the proxy deliberately leaves that volume
 * open.
 */
function extractVertices(
	root: THREE.Object3D,
	type: StationType,
): { exterior: THREE.Vector3[]; interior: THREE.Vector3[] } {
	root.updateMatrixWorld(true);
	const exterior: THREE.Vector3[] = [];
	const interior: THREE.Vector3[] = [];
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();

	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;

		// Check if this object is inside an interior-fittings group
		let isInterior = false;
		let parent: THREE.Object3D | null = object;
		while (parent) {
			if (parent.name === "interior-fittings") {
				isInterior = true;
				break;
			}
			parent = parent.parent;
		}

		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				// The root is normalised to core radii — convert back to km
				const km = v
					.clone()
					.multiplyScalar(STATION_GEOMETRY[type].coreRadiusKm);
				if (isInterior) interior.push(km);
				else exterior.push(km);
			}
		}
	});
	return { exterior, interior };
}

/**
 * Check whether a vertex is inside any primitive of the proxy, considering
 * which frame it belongs to. For simplicity, the test always checks against
 * all primitives (spinning + static) since the mesh is built at phase 0
 * where the spinning frame is identity.
 */
function vertexInsideProxy(
	proxy: StationProxy,
	x: number,
	y: number,
	z: number,
	tolerance: number,
): boolean {
	const allPrimitives = [...proxy.spinning, ...proxy.static];
	return proxyContains(allPrimitives, x, y, z, tolerance);
}

describe("station proxy budget (collision.md §9.1.11)", () => {
	test("every selected form has a proxy", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const proxy = stationProxy(type, form, 0, 0);
			expect(proxy).not.toBeNull();
		}
	});

	test("no drawn vertex outside the proxy, within tolerance", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const seeds = isSolvedForm(type, form) ? ASSEMBLY_SEEDS : [0];
			for (const seed of seeds) {
				const proxy = stationProxy(type, form, seed, seed);
				expect(proxy).not.toBeNull();
				const mesh = buildStationForm(type, form, GREY, seed, seed);
				const { exterior } = extractVertices(mesh.root, type);
				let outside = 0;
				let worstDist = 0;
				for (const v of exterior) {
					if (!vertexInsideProxy(proxy!, v.x, v.y, v.z, VERTEX_TOLERANCE_KM)) {
						outside++;
						// Compute distance to nearest primitive for diagnostics
						const dist = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
						worstDist = Math.max(worstDist, dist);
					}
				}
				if (outside > 0) {
					console.log(
						`${type} form ${form} seed ${seed}: ${outside}/${exterior.length} ` +
							`vertices outside proxy (worst at ${worstDist.toFixed(3)} km)`,
					);
				}
				expect(outside).toBe(0);
			}
		}
	});

	test("no primitive outside reachKm", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const seeds = isSolvedForm(type, form) ? ASSEMBLY_SEEDS : [0];
			for (const seed of seeds) {
				const proxy = stationProxy(type, form, seed, seed);
				expect(proxy).not.toBeNull();
				const reach = proxyReachKm(proxy!);
				const budget = STATION_SILHOUETTE_KM[type];
				if (reach > budget * (1 + 1e-6)) {
					console.log(
						`${type} form ${form} seed ${seed}: proxy reaches ` +
							`${reach.toFixed(3)} km, budget ${budget} km`,
					);
				}
				expect(reach).toBeLessThanOrEqual(budget * (1 + 1e-6));
			}
		}
	});

	test("thinnest primitive figure matches the declared value", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const proxy = stationProxy(type, form, 0, 0);
			expect(proxy).not.toBeNull();
			// Recompute the thinnest from the primitives
			const allPrims = [...proxy!.spinning, ...proxy!.static];
			let min = Infinity;
			for (const p of allPrims) {
				switch (p.kind) {
					case "box":
						min = Math.min(min, p.hx * 2, p.hy * 2, p.hz * 2);
						break;
					case "sphere":
						min = Math.min(min, p.radiusKm * 2);
						break;
					case "capsule":
						min = Math.min(min, p.radiusKm * 2);
						break;
				}
			}
			expect(proxy!.thinnestKm).toBeCloseTo(min, 6);
		}
	});

	test("solved forms produce different proxies at different seeds", () => {
		// Verify that the proxy actually reads the assembly seed for solved forms
		// whose proxy is derived from the placement solve. The two seeds must
		// produce proxies that differ — either in primitive count or in position —
		// so a regression where the seed is ignored goes red.
		//
		// The Salvage (outpost/e) is excluded: its proxy bounds all debris
		// configurations with a fixed sphere, so it is intentionally
		// seed-independent.
		const GRID_SOLVED: [StationType, StationFormId][] = [
			["trade", "d"],
			["refinery", "d"],
			["outpost", "d"],
		];
		for (const [type, form] of GRID_SOLVED) {
			const p0 = stationProxy(type, form, 0, 0);
			const p1 = stationProxy(type, form, 0, 42);
			expect(p0).not.toBeNull();
			expect(p1).not.toBeNull();
			expect(p0!.spinning.length).toBeGreaterThan(0);
			expect(p1!.spinning.length).toBeGreaterThan(0);
			// The proxies must actually differ between seeds
			expect(JSON.stringify(p0!.spinning)).not.toEqual(
				JSON.stringify(p1!.spinning),
			);
		}
	});
});
