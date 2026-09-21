/**
 * #333 — Rama, drawn and reviewable, with no role in the simulation.
 *
 * The rows are the novel's description in checkable form, plus the two
 * boundaries the node sets: a declared reach the workbench frames from, and
 * a module that cannot become a body, a contact, a station or a hull by
 * accident because it imports none of them.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import {
	buildRamaMesh,
	RAMA_DIMENSIONS,
	RAMA_REACH_KM,
	RAMA_VARIANTS,
} from "../src/rama-mesh";

const build = () => {
	const { root } = buildRamaMesh("a");
	root.updateMatrixWorld(true);
	return root;
};

function verticesOf(object: THREE.Object3D) {
	const out: THREE.Vector3[] = [];
	object.updateMatrixWorld(true);
	object.traverse((node) => {
		const position = (node as THREE.Mesh).geometry?.getAttribute("position");
		if (!position) return;
		for (let i = 0; i < position.count; i++)
			out.push(
				new THREE.Vector3()
					.fromBufferAttribute(position as THREE.BufferAttribute, i)
					.applyMatrix4(node.matrixWorld),
			);
	});
	return out;
}

const boxOf = (object: THREE.Object3D) =>
	new THREE.Box3().setFromPoints(verticesOf(object));

function named(root: THREE.Object3D, name: string) {
	const found = root.getObjectByName(name);
	if (!found) throw new Error(`Rama has no part named ${name}`);
	return found;
}

describe("Rama is drawn to the novel's measure", () => {
	test("one concept, named, and a deterministic build inside its declared reach", () => {
		expect(RAMA_VARIANTS.map((v) => [v.id, v.name])).toEqual([["a", "Rama"]]);
		const first = boxOf(build());
		const second = boxOf(build());
		expect(first.min.toArray()).toEqual(second.min.toArray());
		expect(first.max.toArray()).toEqual(second.max.toArray());
		// Distance from the centre, not the largest single coordinate: the
		// workbench orbits at a radius, and a vertex at (10, 10, 26) is 29.6 km
		// out while no coordinate of it passes 26 (#336's review).
		const reach = Math.max(...verticesOf(build()).map((v) => v.length()));
		expect(reach).toBeLessThanOrEqual(RAMA_REACH_KM * (1 + 1e-6));
		// Not slack: the workbench frames its orbit from this figure, and one
		// nothing approaches puts the camera far out in empty space.
		expect(reach).toBeGreaterThan(RAMA_REACH_KM * 0.9);
	});

	test("about fifty kilometres long and twenty across", () => {
		const size = boxOf(named(build(), "rama-hull")).getSize(
			new THREE.Vector3(),
		);
		expect(size.z).toBeGreaterThan(48);
		expect(size.z).toBeLessThan(52);
		expect(size.x).toBeGreaterThan(19);
		expect(size.x).toBeLessThan(21);
		expect(Math.abs(size.x - size.y)).toBeLessThan(0.05);
		expect(RAMA_DIMENSIONS.lengthKm).toBe(50);
		expect(RAMA_DIMENSIONS.radiusKm).toBe(10);
	});

	test("the body is a true cylinder, not a cigar", () => {
		// Over the middle four fifths of its length every hull vertex stands at
		// the one radius. An ellipsoid or a tapered hull fails this at the ends
		// of the band, where it is already narrowing.
		const { lengthKm, radiusKm } = RAMA_DIMENSIONS;
		const middle = verticesOf(named(build(), "rama-hull")).filter(
			(v) => Math.abs(v.z) < lengthKm * 0.4,
		);
		expect(middle.length).toBeGreaterThan(100);
		for (const v of middle) {
			const r = Math.hypot(v.x, v.y);
			expect(r).toBeGreaterThan(radiusKm * 0.98);
			expect(r).toBeLessThan(radiusKm * 1.005);
		}
	});

	test("the north cap carries an axial hub with three airlocks a third of a turn apart", () => {
		const root = build();
		const half = RAMA_DIMENSIONS.lengthKm / 2;
		const hub = boxOf(named(root, "rama-north-hub"));
		const centre = hub.getCenter(new THREE.Vector3());
		expect(Math.hypot(centre.x, centre.y)).toBeLessThan(0.05);
		expect(hub.max.z).toBeLessThan(-half * 0.8);
		const angles: number[] = [];
		for (let i = 0; i < 3; i++) {
			const lock = boxOf(named(root, `rama-airlock-${i}`));
			// Seated on the hub, not beside it.
			expect(lock.intersectsBox(hub)).toBe(true);
			const c = lock.getCenter(new THREE.Vector3());
			angles.push(((Math.atan2(c.y, c.x) * 180) / Math.PI + 360) % 360);
		}
		expect(root.getObjectByName("rama-airlock-3")).toBeUndefined();
		angles.sort((a, b) => a - b);
		const gaps = [
			angles[1] - angles[0],
			angles[2] - angles[1],
			360 - angles[2] + angles[0],
		];
		for (const gap of gaps) expect(Math.abs(gap - 120)).toBeLessThan(2);
	});

	test("the south cap carries the drive: an axial spike, the longest, ringed by smaller ones", () => {
		const root = build();
		const half = RAMA_DIMENSIONS.lengthKm / 2;
		const hull = boxOf(named(root, "rama-hull"));
		const spikes: THREE.Box3[] = [];
		root.traverse((node) => {
			if (node.name.startsWith("rama-south-spike-")) spikes.push(boxOf(node));
		});
		expect(spikes.length).toBeGreaterThanOrEqual(7);
		const axial = boxOf(named(root, "rama-south-spike-0"));
		const c = axial.getCenter(new THREE.Vector3());
		expect(Math.hypot(c.x, c.y)).toBeLessThan(0.05);
		for (const spike of spikes) {
			// On the south cap, rooted in it, and never longer than the axial one.
			expect(spike.min.z).toBeGreaterThan(half * 0.8);
			expect(spike.min.z).toBeLessThan(hull.max.z);
			expect(spike.max.z).toBeLessThanOrEqual(axial.max.z + 1e-6);
		}
	});

	test("nothing on it is lit: no emissive material, no port, lamp or nav light", () => {
		build().traverse((node) => {
			expect(/window|port|strobe|lamp|nav/.test(node.name)).toBe(false);
			const material = (node as THREE.Mesh).material as
				| THREE.MeshStandardMaterial
				| undefined;
			if (material?.emissive)
				expect([node.name, material.emissive.getHex()]).toEqual([node.name, 0]);
		});
	});
	test("a faint grid gives the hull a scale, and never changes its outline", () => {
		// The principal's call on the first sheet: featureless read as a plain
		// canister with nothing to judge its size by. Girdles at one pitch round
		// it and seams along it, all standing within 1% of the radius — so the
		// silhouette is still the cylinder's and nothing on it is lit.
		const root = build();
		const { lengthKm, radiusKm } = RAMA_DIMENSIONS;
		const girdles: THREE.Object3D[] = [];
		const seams: THREE.Object3D[] = [];
		root.traverse((node) => {
			if (node.name.startsWith("rama-girdle-")) girdles.push(node);
			if (node.name.startsWith("rama-seam-")) seams.push(node);
		});
		expect(girdles.length).toBeGreaterThanOrEqual(5);
		expect(seams.length).toBeGreaterThanOrEqual(12);
		for (const part of [...girdles, ...seams])
			for (const v of verticesOf(part))
				expect([part.name, Math.hypot(v.x, v.y) <= radiusKm * 1.01]).toEqual([
					part.name,
					true,
				]);
		// One pitch: a ruler with uneven marks is not a ruler.
		const zs = girdles
			.map((g) => boxOf(g).getCenter(new THREE.Vector3()).z)
			.sort((a, b) => a - b);
		const pitches = zs.slice(1).map((z, i) => z - zs[i]);
		for (const pitch of pitches)
			expect(Math.abs(pitch - pitches[0])).toBeLessThan(1e-6);
		// Seams run most of the body, not a stub.
		for (const seam of seams) {
			const size = boxOf(seam).getSize(new THREE.Vector3());
			expect([seam.name, size.z > lengthKm * 0.8]).toEqual([seam.name, true]);
		}
	});
});

describe("Rama has no role in the simulation yet", () => {
	test("its module imports three and the loft, and nothing that could make it a body, contact, station or hull", () => {
		const source = readFileSync(
			join(import.meta.dir, "..", "src", "rama-mesh.ts"),
			"utf8",
		);
		// `from "x"`, a bare `import "x"` and a dynamic `import("x")` alike: a
		// guard that saw only the first form could not fail on the other two.
		const imports = [
			...source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g),
		].map((m) => m[1]);
		expect(imports.sort()).toEqual(["./loft", "three"]);
	});
});
