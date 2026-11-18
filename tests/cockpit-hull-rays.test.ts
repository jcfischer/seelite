import { expect, test } from "bun:test";
import * as THREE from "three";
import { cockpitHullBlocker, cockpitHullRays } from "../src/cockpit-hull-rays";

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

test("cockpit hull rays stay in ship coordinates, ignore glazing and refresh on model replacement", () => {
	const root = new THREE.Group();
	const exterior = new THREE.Group();
	exterior.name = "longwall-exterior";
	const hull = new THREE.Group();
	hull.name = "hull";
	const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.006));
	panel.position.z = -0.005;
	const glass = panel.clone();
	glass.name = "glazing";
	glass.position.x = 0.01;
	hull.add(panel, glass);
	exterior.add(hull);
	root.add(exterior);
	root.position.set(1234, 5678, 9000);
	root.rotation.set(0.3, 0.5, 0.7);
	const hit = cockpitHullBlocker(root);
	if (!hit) throw new Error("the hull must supply its rays");
	const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
	expect(hit(ray, 0.1)).toBeCloseTo(0.005, 10);
	expect(hit(ray, 0.004)).toBeNull();
	ray.origin.x = 0.01;
	expect(hit(ray, 0.1)).toBeNull();
	root.position.set(-9000, 5000, 1200);
	root.rotation.set(1.2, 0.6, 0.2);
	expect(cockpitHullBlocker(root)).toBe(hit);
	ray.origin.x = 0;
	expect(hit(ray, 0.1)).toBeCloseTo(0.005, 10);
	exterior.remove(hull);
	expect(cockpitHullBlocker(root)).toBeNull();
	const replacement = hull.clone();
	replacement.position.z = -0.01;
	exterior.add(replacement);
	const replaced = cockpitHullBlocker(root);
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
