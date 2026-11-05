import { expect, test } from "bun:test";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { SHIPPED_TRADE_FILES } from "../scripts/lib/shipped-trades";
import { forEachWorldTriangle } from "./helpers/world-triangles";

function firstSurfaces(root: THREE.Object3D, axis: number, backing: boolean) {
	const step = 2.5;
	const extent = 800;
	const n = (extent * 2) / step + 1;
	const near = new Float64Array(n * n).fill(-Infinity);
	const far = new Float64Array(n * n).fill(Infinity);
	const u = (axis + 1) % 3;
	const v = (axis + 2) % 3;
	root.traverse((mesh) => {
		if (
			!(mesh instanceof THREE.Mesh) ||
			(!backing && mesh.name.includes("plate-backing"))
		)
			return;
		forEachWorldTriangle(mesh, (triangle) => {
			const [a, b, c] = [
				triangle.a.toArray(),
				triangle.b.toArray(),
				triangle.c.toArray(),
			];
			const d = (b[v] - c[v]) * (a[u] - c[u]) + (c[u] - b[u]) * (a[v] - c[v]);
			if (Math.abs(d) < 1e-10) return;
			const loU = Math.max(
				0,
				Math.ceil((Math.min(a[u], b[u], c[u]) + extent) / step),
			);
			const hiU = Math.min(
				n - 1,
				Math.floor((Math.max(a[u], b[u], c[u]) + extent) / step),
			);
			const loV = Math.max(
				0,
				Math.ceil((Math.min(a[v], b[v], c[v]) + extent) / step),
			);
			const hiV = Math.min(
				n - 1,
				Math.floor((Math.max(a[v], b[v], c[v]) + extent) / step),
			);
			for (let j = loV; j <= hiV; j++)
				for (let i = loU; i <= hiU; i++) {
					const x = i * step - extent,
						y = j * step - extent;
					const s =
						((b[v] - c[v]) * (x - c[u]) + (c[u] - b[u]) * (y - c[v])) / d;
					const t =
						((c[v] - a[v]) * (x - c[u]) + (a[u] - c[u]) * (y - c[v])) / d;
					if (s < -1e-9 || t < -1e-9 || s + t > 1 + 1e-9) continue;
					const z = s * a[axis] + t * b[axis] + (1 - s - t) * c[axis];
					const index = j * n + i;
					near[index] = Math.max(near[index], z);
					far[index] = Math.min(far[index], z);
				}
		});
	});
	return { near, far, n, step, extent };
}

function barrelHoles(root: THREE.Object3D, backing: boolean) {
	const angles = 720,
		rows = 800,
		z0 = -570,
		dz = 940 / (rows - 1);
	const distances = new Float64Array(angles * rows).fill(Infinity);
	const ray = new THREE.Ray();
	const hit = new THREE.Vector3();
	root.traverse((mesh) => {
		if (
			!(mesh instanceof THREE.Mesh) ||
			(!backing && mesh.name.includes("plate-backing"))
		)
			return;
		forEachWorldTriangle(mesh, (t) => {
			const points = [t.a, t.b, t.c];
			if (Math.max(...points.map((p) => Math.hypot(p.x, p.y))) < 330) return;
			const low = Math.max(
				0,
				Math.ceil((Math.min(...points.map((p) => p.z)) - z0) / dz),
			);
			const high = Math.min(
				rows - 1,
				Math.floor((Math.max(...points.map((p) => p.z)) - z0) / dz),
			);
			const az = points.map((p) => Math.atan2(p.y, p.x));
			for (let k = 1; k < 3; k++) {
				while (az[k] - az[0] > Math.PI) az[k] -= Math.PI * 2;
				while (az[k] - az[0] < -Math.PI) az[k] += Math.PI * 2;
			}
			const first = Math.ceil((Math.min(...az) * angles) / (Math.PI * 2));
			const last = Math.floor((Math.max(...az) * angles) / (Math.PI * 2));
			for (let k = first; k <= last; k++) {
				const theta = (k * Math.PI * 2) / angles,
					x = Math.cos(theta),
					y = Math.sin(theta);
				ray.direction.set(-x, -y, 0);
				for (let j = low; j <= high; j++) {
					ray.origin.set(x * 800, y * 800, z0 + j * dz);
					if (!ray.intersectTriangle(t.a, t.b, t.c, false, hit)) continue;
					const index = j * angles + (((k % angles) + angles) % angles);
					distances[index] = Math.min(
						distances[index],
						ray.origin.distanceTo(hit),
					);
				}
			}
		});
	});
	return distances.filter((distance) => distance > 470).length;
}

for (const form of ["b", "c", "e"] as const)
	test(`trade/${form}: six-sided 2.5 m seam grid and unbacked control`, async () => {
		const root = await decodeShippedGlb(SHIPPED_TRADE_FILES[form]);
		let backingMeshes = 0;
		root.traverse((o) => {
			if (o instanceof THREE.Mesh && o.name.includes("plate-backing"))
				backingMeshes++;
		});
		expect(backingMeshes).toBe(1);
		let repaired = 0,
			deeper = 0;
		for (let axis = 0; axis < 3; axis++) {
			const full = firstSurfaces(root, axis, true);
			const before = firstSurfaces(root, axis, false);
			for (let i = 0; i < full.near.length; i++) {
				if (
					full.near[i] < before.near[i] - 2 ||
					full.far[i] > before.far[i] + 2
				)
					deeper++;
				if (
					full.near[i] > before.near[i] + 2 ||
					full.far[i] < before.far[i] - 2
				)
					repaired++;
			}
			if (form === "c" && axis === 2) {
				let holes = 0,
					controlHoles = 0,
					samples = 0;
				for (let j = 0; j < full.n; j++)
					for (let i = 0; i < full.n; i++) {
						const x = i * full.step - full.extent,
							y = j * full.step - full.extent;
						if (
							Math.hypot(x, y) > 275 ||
							(Math.abs(x) < 148 && Math.abs(y) < 122)
						)
							continue;
						samples++;
						if (full.near[j * full.n + i] < 380) holes++;
						if (before.near[j * full.n + i] < 380) controlHoles++;
					}
				expect(samples).toBeGreaterThan(20000);
				expect(holes).toBe(0);
				expect(controlHoles).toBeGreaterThan(0);
			}
		}
		expect(deeper).toBe(0);
		expect(repaired).toBeGreaterThan(100);
		if (form === "c") {
			expect(barrelHoles(root, true)).toBe(0);
			expect(barrelHoles(root, false)).toBeGreaterThan(0);
		}
	}, 60000);
