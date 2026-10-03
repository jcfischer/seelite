/**
 * How far outside its collision proxy a solved station form's drawn vertices
 * stand, over a wide spread of assembly seeds (`collision.md` §2.2, §9.1.11).
 *
 * `tests/station-proxy.test.ts` gates every row on `ASSEMBLY_SEEDS` — twelve
 * plans. A running game builds a refinery at whatever assembly seed its system
 * draws, so a proxy fitted to those twelve can let a lump of another plan
 * through. This is the hand-run half: it builds `count` plans of each seeded
 * selected form and prints how many stand a vertex past the test's tolerance,
 * and the worst overshoot with the part and seed it came from. A vertex inside
 * the corridor is the opening's, not the proxy's, and is skipped as the test
 * skips it.
 *
 *   bun scripts/measure-station-proxy.ts [count]   (default 800)
 */

import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../src/station";
import { corridorRadiusKm } from "../src/station-interior";
import { SELECTED_FORM, buildStationForm } from "../src/station-mesh";
import {
	PROXY_VERTEX_TOLERANCE_KM,
	proxyDistanceKm,
	stationProxy,
} from "../src/station-proxy";

const TOLERANCE_KM = PROXY_VERTEX_TOLERANCE_KM;

function finite(label: string, value: number): number {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
}

function sweep(type: StationType, count: number): void {
	const form = SELECTED_FORM[type];
	const g = STATION_GEOMETRY[type];
	const corridor = corridorRadiusKm(g.aperture);
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	let over = 0;
	let worst = -Infinity;
	let worstAt = "";
	for (let seed = 0; seed < count; seed++) {
		const proxy = stationProxy(type, form, 0, seed);
		if (!proxy) throw new Error(`${type} ${form} has no proxy`);
		const primitives = [...proxy.spinning, ...proxy.static];
		const { root } = buildStationForm(type, form, 0x9aa6b2, 0, seed);
		root.updateMatrixWorld(true);
		let seedWorst = -Infinity;
		root.traverse((object) => {
			const mesh = object as THREE.Mesh;
			const position = mesh.geometry?.getAttribute?.("position");
			if (!position) return;
			const instanced = object as THREE.InstancedMesh;
			const n = instanced.isInstancedMesh ? instanced.count : 1;
			for (let k = 0; k < n; k++) {
				if (instanced.isInstancedMesh) instanced.getMatrixAt(k, instance);
				else instance.identity();
				for (let i = 0; i < position.count; i++) {
					v.fromBufferAttribute(position as THREE.BufferAttribute, i);
					v.applyMatrix4(instance);
					mesh.localToWorld(v);
					v.multiplyScalar(g.coreRadiusKm);
					if (Math.hypot(v.x, v.y) < corridor && v.z > g.aperturePlaneKm)
						continue;
					let d = Infinity;
					for (const p of primitives)
						d = Math.min(d, proxyDistanceKm(p, v.x, v.y, v.z));
					seedWorst = Math.max(seedWorst, d);
					if (d > worst) {
						worst = d;
						worstAt = `${object.name || object.type} at seed ${seed}`;
					}
				}
			}
		});
		if (finite(`${type} seed ${seed}`, seedWorst) > TOLERANCE_KM) over++;
	}
	console.log(
		`${type} ${form}: N ${count}, ${over} plans past ${TOLERANCE_KM * 1000} m, ` +
			`worst ${(finite(type, worst) * 1000).toFixed(1)} m (${worstAt})`,
	);
}

const count = Number(process.argv[2] ?? 800);
if (!Number.isInteger(count) || count < 1)
	throw new Error(`count must be a positive integer, got ${process.argv[2]}`);
for (const type of ["refinery", "outpost"] as const) sweep(type, count);
