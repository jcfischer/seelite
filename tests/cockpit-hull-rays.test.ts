import { expect, test } from "bun:test";
import * as THREE from "three";
import {
	cockpitHullBlocker,
	cockpitHullMeshes,
	cockpitHullRays,
} from "../src/cockpit-hull-rays";

test("hull rays agree with double-sided raycasting across indexed, transformed and partitioned surfaces", () => {
	const meshes = Array.from({ length: 40 }, (_, n) => {
		let geometry: THREE.BufferGeometry = new THREE.BoxGeometry(
			0.002,
			0.002,
			0.002,
		);
		if (n % 2) geometry = geometry.toNonIndexed();
		const mesh = new THREE.Mesh(
			geometry,
			new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
		);
		mesh.position.set((n % 5) * 0.003, Math.floor(n / 5) * 0.003, 0.002);
		mesh.rotation.set(n * 0.1, n * 0.2, n * 0.3);
		mesh.updateMatrixWorld(true);
		return mesh;
	});
	const hit = cockpitHullRays(meshes);
	const caster = new THREE.Raycaster();
	for (const origin of [new THREE.Vector3(), meshes[12].position.clone()])
		for (const mesh of meshes) {
			const direction = mesh.position.clone().sub(origin).normalize();
			if (!direction.lengthSq()) continue;
			caster.set(origin, direction);
			const expected =
				caster.intersectObjects(meshes, false)[0]?.distance ?? null;
			const actual = hit(caster.ray);
			if (expected === null) expect(actual).toBeNull();
			else {
				expect(actual).toBeCloseTo(expected, 10);
				expect(hit(caster.ray, expected * 0.5)).toBeNull();
				expect(hit(caster.ray, expected * 1.5)).toBeCloseTo(expected, 10);
			}
		}
});

test("an empty hull leaves every ray unobstructed", () => {
	expect(cockpitHullRays([])(new THREE.Ray())).toBeNull();
});

test("streak clipping preserves both clear portions around even a narrow hull frame", () => {
	for (const width of [0.004, 0.000001]) {
		const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.006));
		panel.position.z = -0.005;
		panel.updateMatrixWorld(true);
		const hit = cockpitHullRays([panel]);
		const visible = hit.visibleSegments(
			new THREE.Vector3(),
			new THREE.Vector3(-0.01, 0, -0.01),
			new THREE.Vector3(0.01, 0, -0.01),
		);
		expect(visible).toHaveLength(2);
		expect(visible[0][0]).toBe(0);
		expect(visible[0][1]).toBeCloseTo(0.5 - width / 0.02, 7);
		expect(visible[1][0]).toBeCloseTo(0.5 + width / 0.02, 7);
		expect(visible[1][1]).toBe(1);
	}
});

test("streak clipping respects finite depth and fully hidden and stationary sparks", () => {
	const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.006));
	panel.position.z = -0.005;
	panel.updateMatrixWorld(true);
	const hit = cockpitHullRays([panel]);
	const eye = new THREE.Vector3();
	const a = new THREE.Vector3(-0.001, 0, -0.01);
	const b = new THREE.Vector3(0.001, 0, -0.01);
	expect(hit.visibleSegments(eye, a, b)).toEqual([]);
	expect(hit.visibleSegments(eye, a, a)).toEqual([]);
	a.z = b.z = -0.004;
	expect(hit.visibleSegments(eye, a, b)).toEqual([[0, 1]]);
	expect(hit.visibleSegments(eye, a, a)).toEqual([[0, 1]]);
	a.set(0, 0, -0.005);
	expect(hit.visibleSegments(eye, a, a)).toEqual([]);
	a.z = -0.01;
	b.set(0, 0, 0);
	expect(hit.visibleSegments(eye, a, b)).toEqual([[0.5, 1]]);
	b.z = 0.01;
	expect(hit.visibleSegments(eye, a, b)).toEqual([[0.25, 1]]);
});

test("streak clipping finds a clear slit even when both endpoints are hidden", () => {
	const meshes = [-1, 1].map((side) => {
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.006));
		mesh.position.set(side * 0.003, 0, -0.005);
		mesh.updateMatrixWorld(true);
		return mesh;
	});
	const visible = cockpitHullRays(meshes).visibleSegments(
		new THREE.Vector3(),
		new THREE.Vector3(-0.008, 0, -0.01),
		new THREE.Vector3(0.008, 0, -0.01),
	);
	expect(visible).toHaveLength(1);
	expect(visible[0][0]).toBeCloseTo(0.375, 7);
	expect(visible[0][1]).toBeCloseTo(0.625, 7);
});

test("visible streak intervals agree with independent rays through rotated and coplanar panels", () => {
	const meshes = Array.from({ length: 8 }, (_, n) => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(0.003, 0.007, 0.001),
			new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
		);
		mesh.position.set((n % 4) * 0.003 - 0.005, 0, -0.004 - n * 0.001);
		mesh.rotation.set(n * 0.2, n * 0.3, n * 0.1);
		mesh.updateMatrixWorld(true);
		return mesh;
	});
	const hit = cockpitHullRays(meshes);
	const caster = new THREE.Raycaster();
	const eye = new THREE.Vector3();
	for (let n = 0; n < 20; n++) {
		const tail = new THREE.Vector3(-0.02, (n - 10) * 0.001, -0.015);
		const head = new THREE.Vector3(0.02, (10 - n) * 0.0005, -0.025);
		const intervals = hit.visibleSegments(eye, tail, head);
		for (let i = 0; i <= 100; i++) {
			const t = i / 100;
			const point = tail.clone().lerp(head, t);
			caster.set(eye, point.clone().normalize());
			caster.far = point.length();
			const seen = caster.intersectObjects(meshes, false).length === 0;
			expect(intervals.some(([a, b]) => t >= a && t <= b)).toBe(seen);
		}
	}
	const coplanar = new THREE.Mesh(new THREE.PlaneGeometry(0.002, 0.006));
	coplanar.rotation.x = Math.PI / 2;
	coplanar.position.z = -0.005;
	coplanar.updateMatrixWorld(true);
	const intervals = cockpitHullRays([coplanar]).visibleSegments(
		eye,
		new THREE.Vector3(-0.01, 0, -0.01),
		new THREE.Vector3(0.01, 0, -0.01),
	);
	expect(intervals).toHaveLength(2);
	expect(intervals[0][1]).toBeCloseTo(0.25, 7);
	expect(intervals[1][0]).toBeCloseTo(0.75, 7);
});

test("cockpit hull rays stay in ship coordinates, ignore glazing and refresh on model replacement", () => {
	const root = new THREE.Group();
	const exterior = new THREE.Group();
	exterior.name = "some-other-ship";
	const hull = new THREE.Group();
	hull.name = "hull";
	const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.006));
	panel.position.z = -0.005;
	const glass = panel.clone();
	glass.name = "glazing";
	glass.position.x = 0.01;
	hull.add(panel, glass);
	const source = { node: hull, transparentNames: /glazing|display/ };
	expect(cockpitHullMeshes(source)).toEqual([panel]);
	exterior.add(hull);
	root.add(exterior);
	root.position.set(1234, 5678, 9000);
	root.rotation.set(0.3, 0.5, 0.7);
	const hit = cockpitHullBlocker(root, source);
	if (!hit) throw new Error("the hull must supply its rays");
	const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
	expect(hit(ray, 0.1)).toBeCloseTo(0.005, 10);
	expect(hit(ray, 0.004)).toBeNull();
	ray.origin.x = 0.01;
	expect(hit(ray, 0.1)).toBeNull();
	root.position.set(-9000, 5000, 1200);
	root.rotation.set(1.2, 0.6, 0.2);
	expect(cockpitHullBlocker(root, source)).toBe(hit);
	ray.origin.x = 0;
	expect(hit(ray, 0.1)).toBeCloseTo(0.005, 10);
	exterior.remove(hull);
	const replacement = hull.clone();
	replacement.position.z = -0.01;
	exterior.add(replacement);
	const replaced = cockpitHullBlocker(root, { ...source, node: replacement });
	expect(replaced).not.toBe(hit);
	expect(replaced?.(ray, 0.1)).toBeCloseTo(0.015, 10);
});

test("flat hull panels block both directions, including the finite endpoint", () => {
	const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.006));
	panel.position.z = -0.005;
	panel.updateMatrixWorld(true);
	const hit = cockpitHullRays([panel]);
	const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
	expect(hit(ray)).toBeCloseTo(0.005, 10);
	expect(hit(ray, 0.004)).toBeNull();
	expect(hit(ray, 0.005)).toBeCloseTo(0.005, 10);
	ray.origin.set(0, 0, -0.01);
	ray.direction.set(0, 0, 1);
	expect(hit(ray)).toBeCloseTo(0.005, 10);
	ray.origin.x = 0.0021;
	expect(hit(ray)).toBeNull();
});
