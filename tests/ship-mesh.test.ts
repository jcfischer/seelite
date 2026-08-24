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
		const size = (id: (typeof HULL_IDS)[number]) =>
			bounds(id).getSize(new THREE.Vector3());
		const courier = size("courier");
		const interceptor = size("interceptor");
		const freighter = size("freighter");
		expect(courier.z / courier.x).not.toBeCloseTo(
			interceptor.z / interceptor.x,
			2,
		);
		expect(courier.y).not.toBeCloseTo(freighter.y, 3);
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

	test("lofted command and fuselage volumes have both end caps", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				root.traverse((object) => {
					if (
						!(object instanceof THREE.Mesh) ||
						!object.geometry.index ||
						object.geometry.type !== "BufferGeometry"
					)
						return;
					if (
						!object.name.includes("fuselage") &&
						!object.name.includes("cockpit") &&
						!object.name.includes("bridge") &&
						!object.name.includes("nacelle")
					)
						return;
					const vertexCount = object.geometry.getAttribute("position").count;
					const indices = [...object.geometry.index.array];
					for (const capCenter of [vertexCount - 2, vertexCount - 1])
						expect(indices.filter((index) => index === capCenter).length).toBe(
							8,
						);
				});
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
				const nacelle = root.children.find((child) =>
					child.name.includes("nacelle"),
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
		const geometryTypes = new Set<string>();
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const fuselage = buildShipMesh(id, variant).root.getObjectByName(
					id + "-fuselage",
				) as THREE.Mesh;
				geometryTypes.add(fuselage.geometry.type);
				expect([
					"BoxGeometry",
					"ConeGeometry",
					"CylinderGeometry",
				]).not.toContain(fuselage.geometry.type);
				expect(
					fuselage.geometry.getAttribute("position").count,
				).toBeGreaterThan(30);
			}
		}
		expect(geometryTypes.size).toBeGreaterThanOrEqual(2);
	});

	test("canopies intersect painted fairings instead of floating above them", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				const fairing = root.getObjectByName(
					id === "freighter" ? "freighter-bridge" : id + "-cockpit-fairing",
				) as THREE.Mesh;
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

	test("every nacelle intersects a named structural mount", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				for (const side of ["port", "starboard"]) {
					const mount = root.getObjectByName(
						id + "-nacelle-mount-" + side,
					) as THREE.Mesh;
					const nacelle = root.getObjectByName(
						id + "-" + side + "-nacelle",
					) as THREE.Mesh;
					expect(
						new THREE.Box3()
							.setFromObject(mount)
							.intersectsBox(new THREE.Box3().setFromObject(nacelle)),
					).toBe(true);
				}
			}
		}
	});
});
