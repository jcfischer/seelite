/** The hull language is display geometry, so its identity and bounds are cheap
 * to prove without a browser. Browser probes own the camera/HUD experience. */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	HULL_IDS,
	HULL_VARIANTS,
	HULL_VARIANT_IDS,
	HULL_VISUALS,
	SHIP_DESIGN_ROUND,
	type HullVariantId,
	buildShipMesh,
} from "../src/ship-mesh";

function bounds(id: (typeof HULL_IDS)[number], variant: HullVariantId = "a") {
	const root = buildShipMesh(id, variant).root;
	root.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(root);
}

describe("procedural ship visual language", () => {
	test("each explicit visual archetype is deterministic and bounded", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const first = bounds(id, variant);
				const second = bounds(id, variant);
				expect(first.min.toArray()).toEqual(second.min.toArray());
				expect(first.max.toArray()).toEqual(second.max.toArray());
				const reach = Math.max(
					...first.min.toArray().map(Math.abs),
					...first.max.toArray().map(Math.abs),
				);
				expect(reach).toBeLessThanOrEqual(HULL_VISUALS[id].reachKm * 1.00001);
				expect(reach).toBeGreaterThan(HULL_VISUALS[id].reachKm * 0.5);
			}
		}
	});

	test("each role offers three named and genuinely distinct design theses", () => {
		for (const id of HULL_IDS) {
			expect(HULL_VARIANTS[id].map(({ id }) => id)).toEqual(["a", "b", "c"]);
			expect(new Set(HULL_VARIANTS[id].map(({ name }) => name)).size).toBe(3);
			expect(new Set(HULL_VARIANTS[id].map(({ thesis }) => thesis)).size).toBe(
				3,
			);
			const proportions = HULL_VARIANT_IDS.map((variant) => {
				const size = bounds(id, variant).getSize(new THREE.Vector3());
				return `${(size.x / size.z).toFixed(2)}:${(size.y / size.z).toFixed(2)}`;
			});
			expect(new Set(proportions).size).toBeGreaterThanOrEqual(2);
		}
	});

	test("roles have visibly different long-axis proportions before detail resolves", () => {
		// Every role, not just the first three: a new role that happens to share a
		// silhouette with an existing one gives the player two names for one ship.
		const ratios = HULL_IDS.map((id) => {
			const size = bounds(id).getSize(new THREE.Vector3());
			return { id, slenderness: size.z / size.x, depth: size.y / size.z };
		});
		for (const a of ratios)
			for (const b of ratios) {
				if (a.id >= b.id) continue;
				const apart =
					Math.abs(a.slenderness - b.slenderness) > 0.08 ||
					Math.abs(a.depth - b.depth) > 0.04;
				expect(`${a.id} vs ${b.id}: ${apart}`).toBe(`${a.id} vs ${b.id}: true`);
			}
	});

	test("each hull has stable identity and motion-direction exhaust cues", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				expect(root.name).toBe(`hull-${id}`);
				expect(root.userData.role).toBe(HULL_VISUALS[id].role);
				expect(root.userData.variant).toBe(variant);
				expect(root.userData.designRound).toBe(SHIP_DESIGN_ROUND);
				expect(
					root.children.some((child) => child.name.includes("exhaust")),
				).toBe(true);
			}
		}
	});

	test("lofted volumes are capped and every triangle faces outward", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				let inspected = 0;
				root.traverse((object) => {
					if (!(object instanceof THREE.Mesh) || !object.geometry.index) return;
					const axis = object.geometry.userData.axis as number[][] | undefined;
					const ringSize = object.geometry.userData.ringSize as
						| number
						| undefined;
					if (!axis || !ringSize) return;
					if (
						!object.name.includes("fuselage") &&
						!object.name.includes("cockpit") &&
						!object.name.includes("bridge") &&
						!object.name.includes("nacelle")
					)
						return;
					inspected += 1;
					const positions = object.geometry.getAttribute("position");
					const indices = [...object.geometry.index.array];
					const front = positions.count - 2;
					const rear = positions.count - 1;
					// A cap is a closed fan over the whole end ring, not a hole: one
					// triangle per ring segment, no more and no fewer.
					for (const capCenter of [front, rear])
						expect(indices.filter((index) => index === capCenter).length).toBe(
							ringSize,
						);
					const point = (index: number) =>
						new THREE.Vector3().fromBufferAttribute(positions, index);
					const centreline = axis.map(
						([x, y, z]) => new THREE.Vector3(x, y, z),
					);
					// A cap is perpendicular to its own station plane, and a swept
					// blade tilts that plane away from the centreline, so neither Z nor
					// the sweep direction is a fixed reference. What holds for every
					// part is that each cap faces away from the body it closes. The
					// failure this catches is an inverted cap, which scores near -1;
					// the bar is set low because an honest cap on a steeply raked
					// blade only reaches about 0.7.
					const middle = centreline
						.reduce((sum, point) => sum.add(point), new THREE.Vector3())
						.divideScalar(centreline.length);
					const noseOut = centreline[0].clone().sub(middle).normalize();
					const tailOut = centreline[centreline.length - 1]
						.clone()
						.sub(middle)
						.normalize();
					for (let index = 0; index < indices.length; index += 3) {
						const triangle = indices.slice(index, index + 3);
						const [a, b, c] = triangle.map(point);
						const normal = new THREE.Vector3()
							.crossVectors(b.clone().sub(a), c.clone().sub(a))
							.normalize();
						if (triangle.includes(front))
							expect(normal.dot(noseOut)).toBeGreaterThan(0.25);
						else if (triangle.includes(rear))
							expect(normal.dot(tailOut)).toBeGreaterThan(0.25);
						else {
							const centre = a.add(b).add(c).divideScalar(3);
							const nearest = centreline.reduce((best, candidate) =>
								candidate.distanceToSquared(centre) <
								best.distanceToSquared(centre)
									? candidate
									: best,
							);
							expect(
								normal.dot(centre.clone().sub(nearest).normalize()),
							).toBeGreaterThan(0);
						}
					}
				});
				expect(inspected).toBeGreaterThanOrEqual(4);
			}
		}
	});

	test("hulls carry visible mass before their compact exhaust cues", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				const fuselage = root.children.find((child) =>
					child.name.includes("fuselage"),
				);
				const bridge = root.children.find(
					(child) =>
						child.name.includes("cockpit") || child.name.includes("bridge"),
				);
				// A mount is named for the nacelle it carries, so match the drive
				// itself rather than the first child whose name mentions one.
				const nacelle = root.children.find((child) =>
					child.name.endsWith("-nacelle"),
				);
				const exhaust = root.children.find((child) =>
					child.name.includes("exhaust"),
				);
				expect(fuselage).toBeDefined();
				expect(bridge).toBeDefined();
				expect(nacelle).toBeDefined();
				expect(exhaust).toBeDefined();
				const nacelleSize = new THREE.Box3()
					.setFromObject(nacelle as THREE.Object3D)
					.getSize(new THREE.Vector3());
				const exhaustSize = new THREE.Box3()
					.setFromObject(exhaust as THREE.Object3D)
					.getSize(new THREE.Vector3());
				expect(Math.max(...exhaustSize.toArray())).toBeLessThan(
					Math.max(...nacelleSize.toArray()) * 0.5,
				);
			}
		}
	});

	test("primary masses are authored surfaces rather than stock primitive stacks", () => {
		const silhouettes = new Set<string>();
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const fuselage = buildShipMesh(id, variant).root.getObjectByName(
					id + "-fuselage",
				) as THREE.Mesh;
				expect([
					"BoxGeometry",
					"ConeGeometry",
					"CylinderGeometry",
				]).not.toContain(fuselage.geometry.type);
				expect(
					fuselage.geometry.getAttribute("position").count,
				).toBeGreaterThan(30);
				const size = new THREE.Box3()
					.setFromObject(fuselage)
					.getSize(new THREE.Vector3());
				silhouettes.add(
					`${(size.x / size.z).toFixed(2)}:${(size.y / size.z).toFixed(2)}`,
				);
			}
		}
		// Nine hulls sharing one primary mass would be one hull in nine paint jobs.
		expect(silhouettes.size).toBeGreaterThanOrEqual(HULL_IDS.length * 2);
	});

	test("primary surfaces are swept rather than extruded from a flat plate", () => {
		// A plate extrusion gives every part a vertical side wall, which is the
		// shape the round-three review rejected. Curvature shows up as the number
		// of distinct surface normals around the beam; a slab has four.
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const fuselage = buildShipMesh(id, variant).root.getObjectByName(
					id + "-fuselage",
				) as THREE.Mesh;
				const normals = fuselage.geometry.getAttribute("normal");
				const directions = new Set<string>();
				for (let index = 0; index < normals.count; index += 1)
					directions.add(
						`${normals.getX(index).toFixed(1)}:${normals.getY(index).toFixed(1)}`,
					);
				expect(directions.size).toBeGreaterThan(12);
			}
		}
	});

	test("canopies intersect painted fairings instead of floating above them", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				// Small hulls fair their glass into a cockpit blister, big ones into
				// a bridge. Either is the painted structure the canopy sets into.
				const fairing = (root.getObjectByName(id + "-cockpit-fairing") ??
					root.getObjectByName(id + "-bridge")) as THREE.Mesh;
				expect(fairing).toBeDefined();
				const canopy = root.getObjectByName(id + "-cockpit") as THREE.Mesh;
				const overlap = new THREE.Box3()
					.setFromObject(fairing)
					.intersect(new THREE.Box3().setFromObject(canopy))
					.getSize(new THREE.Vector3());
				expect(overlap.x).toBeGreaterThan(0.001);
				expect(overlap.y).toBeGreaterThan(0.0005);
				expect(overlap.z).toBeGreaterThan(0.003);
			}
		}
	});

	test("no solid module sits in the pilot's forward view", () => {
		// Two explorer hulls shipped with the survey dish parked directly ahead of
		// the canopy, which nothing caught because every other check measures a
		// part against the hull rather than against the view out of it.
		//
		// Rings and hoops are exempt: they are deliberately open, and an
		// axis-aligned box cannot see the hole in the middle of one. The rule is
		// about solid volumes — a dish, a drum, a tank, a cargo bank.
		const SOLID = /dish|drum|skip|hold|bin|habitat|refinery|tank|pannier|bank/;
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				root.updateMatrixWorld(true);
				const canopy = root.getObjectByName(id + "-cockpit") as THREE.Mesh;
				const eye = new THREE.Box3()
					.setFromObject(canopy)
					.getCenter(new THREE.Vector3());
				const reach = HULL_VISUALS[id].reachKm;
				for (const child of root.children) {
					if (!(child instanceof THREE.Mesh) || !SOLID.test(child.name))
						continue;
					const box = new THREE.Box3().setFromObject(child);
					let blocked = false;
					for (let step = 0; step <= 60; step += 1) {
						const ahead = eye.z - (step / 60) * (reach + Math.abs(eye.z));
						if (box.containsPoint(new THREE.Vector3(eye.x, eye.y, ahead)))
							blocked = true;
					}
					expect(`${id}/${variant} ${child.name} blocks view: ${blocked}`).toBe(
						`${id}/${variant} ${child.name} blocks view: false`,
					);
				}
				// A cutter head is exempt from the solid rule because it is a ring,
				// but a ring the pilot has to look through is still the wrong place
				// for it: its top arc must clear the eye line.
				for (const child of root.children) {
					if (!(child instanceof THREE.Mesh) || !/cutter-ring/.test(child.name))
						continue;
					const top = new THREE.Box3().setFromObject(child).max.y;
					expect(`${id}/${variant} cutter clears the eye: ${top < eye.y}`).toBe(
						`${id}/${variant} cutter clears the eye: true`,
					);
				}
			}
		}
	});

	test("every nacelle intersects a named structural mount", () => {
		// Named port and starboard, once. That spelling outlawed a drive layout
		// that is not laterally paired, which is the direction the rankings kept
		// choosing — so the contract now says what it always meant: a nacelle
		// hangs off structure rather than floating beside the hull.
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				const named = (test: (name: string) => boolean) =>
					root.children.filter(
						(child) => child instanceof THREE.Mesh && test(child.name),
					);
				const mounts = named((name) => name.includes("-mount-")).map((mount) =>
					new THREE.Box3().setFromObject(mount),
				);
				const nacelles = named(
					(name) => name.endsWith("-nacelle") && !name.includes("-mount-"),
				);
				expect(nacelles.length).toBeGreaterThanOrEqual(2);
				expect(mounts.length).toBeGreaterThanOrEqual(2);
				for (const nacelle of nacelles) {
					const box = new THREE.Box3().setFromObject(nacelle);
					expect(
						`${nacelle.name}: ${mounts.some((mount) => mount.intersectsBox(box))}`,
					).toBe(`${nacelle.name}: true`);
				}
			}
		}
	});
});
