/** The hull language is display geometry, so its identity and bounds are cheap
 * to prove without a browser. Browser probes own the camera/HUD experience. */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	HULL_IDS,
	HULL_SPECS,
	HULL_VARIANT_IDS,
	type HullVariantId,
} from "../src/hull";
import {
	HULL_REACH_KM,
	HULL_VARIANTS,
	NAV_LIGHTS,
	NAV_LIGHT_PROUD,
	SHIP_DESIGN_ROUND,
	buildShipMesh,
	fleetLayout,
} from "../src/ship-mesh";
import {
	ENEMY_COLLISION_RADIUS_KM,
	ENEMY_VISUAL_SCALE,
	STRIKER_HULL_ID,
} from "../src/combat-enemy";
import { useProceduralCourier } from "./helpers/install-courier-hull";

// These rows hold the procedural hull language over every hull and variant,
// so the courier is the procedural Kestrel here; the authored courier the
// game draws (node #812) is `courier-hull.test.ts`'s.
useProceduralCourier();

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
				expect(reach).toBeLessThanOrEqual(HULL_REACH_KM[id] * 1.00001);
				expect(reach).toBeGreaterThan(HULL_REACH_KM[id] * 0.5);
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
			// All three, not two of three: the thesis text being different is a
			// claim about prose, and the spec's claim is about geometry.
			const shapes = HULL_VARIANT_IDS.map((variant) =>
				bounds(id, variant).getSize(new THREE.Vector3()),
			);
			for (const a of shapes)
				for (const b of shapes) {
					if (a === b) continue;
					const apart =
						Math.abs(a.x / a.z - b.x / b.z) > 0.02 ||
						Math.abs(a.y / a.z - b.y / b.z) > 0.02;
					expect(`${id} variants differ: ${apart}`).toBe(
						`${id} variants differ: true`,
					);
				}
		}
	});

	test("hulls of comparable size have visibly different proportions", () => {
		// Every hull, not just variant "a". Review pointed out that comparing one
		// variant per role left twenty-two of thirty-three never compared with
		// anything, while the spec insists variants name distinct ship models.
		//
		// Two guards keep the comparison meaningful. Variants of one role are
		// meant to read as the same class, so only cross-role pairs are checked.
		// And only pairs of comparable size: a capital hull and an interceptor
		// can share a ratio exactly and never be confused, because one of them
		// fills the canopy.
		//
		// The bar is a normalised distance rather than two independent
		// thresholds, and 1.0 is measured rather than chosen. Across the 333
		// pairs this compares, the closest is 1.21; the next tier down was a
		// single pair at 0.90, which was fixed rather than tolerated. What this
		// does *not* prove is that two hulls look different — a bounding box
		// cannot see an offset keel or a boarding tube. It catches the failure
		// that prompted it: a raider that read as a patrol hull at range.
		const hulls = HULL_IDS.flatMap((id) =>
			HULL_VARIANT_IDS.map((variant) => {
				const size = bounds(id, variant).getSize(new THREE.Vector3());
				return {
					id: `${id}/${variant}`,
					role: id,
					slenderness: size.z / size.x,
					depth: size.y / size.z,
				};
			}),
		);
		let compared = 0;
		for (const a of hulls)
			for (const b of hulls) {
				if (a.id >= b.id || a.role === b.role) continue;
				const sizeRatio = HULL_REACH_KM[a.role] / HULL_REACH_KM[b.role];
				if (sizeRatio > 2 || sizeRatio < 0.5) continue;
				compared += 1;
				const separation = Math.hypot(
					(a.slenderness - b.slenderness) / 0.08,
					(a.depth - b.depth) / 0.04,
				);
				expect(`${a.id} vs ${b.id}: ${separation >= 1}`).toBe(
					`${a.id} vs ${b.id}: true`,
				);
			}
		expect(compared).toBeGreaterThan(300);
	});

	test("each hull has stable identity and motion-direction exhaust cues", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				expect(root.name).toBe(`hull-${id}`);
				expect(root.userData.role).toBe(HULL_SPECS[id].role);
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
					// From the geometry, not from the vertex layout: the cap centres
					// were the last two vertices until the caps gained their own
					// rings for planar UVs, and an assumption about layout goes
					// quietly wrong rather than loudly.
					const caps = object.geometry.userData.caps as {
						front: number;
						rear: number;
					};
					expect(caps).toBeDefined();
					const front = caps.front;
					const rear = caps.rear;
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
				// Every drive, paired with its own exhaust by name. Taking the
				// first of each happened to pair correctly, but nothing made it
				// so — a reordering would have compared a trim drive against an
				// oversized bell and passed or failed for an unrelated reason.
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
				const span = (object: THREE.Object3D) =>
					Math.max(
						...new THREE.Box3()
							.setFromObject(object)
							.getSize(new THREE.Vector3())
							.toArray(),
					);
				let pairs = 0;
				for (const drive of root.children) {
					if (!drive.name.endsWith("-nacelle")) continue;
					const stem = drive.name.slice(0, -"-nacelle".length);
					const bell = root.children.find(
						(child) => child.name === `${stem}-exhaust`,
					);
					if (!bell) continue;
					pairs += 1;
					expect(`${drive.name}: ${span(bell) < span(drive) * 0.5}`).toBe(
						`${drive.name}: true`,
					);
				}
				expect(pairs).toBeGreaterThanOrEqual(2);
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
				// a bridge tower. `canopy()` and `bridge()` each emit their pair,
				// so which of the two names exists is a contract rather than the
				// coincidence this fallback used to rest on.
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
		// This was first written as an allowlist of part names, which is the
		// wrong shape: it passed anything nobody had thought to add, and review
		// named four such parts that slipped through. Everything is checked now
		// but two exemptions, both decided by construction rather than by
		// matching words that go stale the moment a part is renamed.
		//
		// A torus is open, and an axis-aligned box cannot see the hole in the
		// middle of one. A strut is thin — `strut()` stamps `userData.thin` —
		// and a pylon or a stay is something the pilot sees past rather than
		// through.
		//
		// The hull the glass is set into is named, because no property tells it
		// apart: the pilot looks over their own nose.
		const OWN_HULL = /fuselage|cockpit|bridge|dorsal-hull/;
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				root.updateMatrixWorld(true);
				const canopy = root.getObjectByName(id + "-cockpit") as THREE.Mesh;
				const glass = new THREE.Box3().setFromObject(canopy);
				const eye = glass.getCenter(new THREE.Vector3());
				// The sightline is as wide as the glass, not an infinitely thin
				// line — the pilot sees a cone, and a hull parked just beside the
				// axis blocks as much of it as one parked on the axis. Spread
				// sideways only: sampling below the eye finds the structure the
				// canopy stands on, which is not a blocked view on any ship.
				const halfWidth = (glass.max.x - glass.min.x) / 2;
				const reach = HULL_REACH_KM[id];
				let checked = 0;
				for (const child of root.children) {
					if (!(child instanceof THREE.Mesh)) continue;
					// A ring's box is full and its middle is empty, so the box test
					// would read a hoop round a nacelle as a wall across the view.
					// Marked by the builder rather than matched on `TorusGeometry`,
					// because #203's collar is a loft and a ring all the same.
					if (
						child.geometry.userData.ring === true ||
						child.geometry.userData.thin === true ||
						OWN_HULL.test(child.name)
					)
						continue;
					checked += 1;
					const box = new THREE.Box3().setFromObject(child);
					let blocked = false;
					for (let step = 0; step <= 60; step += 1) {
						const ahead = eye.z - (step / 60) * (reach + Math.abs(eye.z));
						for (const dx of [0, halfWidth, -halfWidth])
							if (
								box.containsPoint(new THREE.Vector3(eye.x + dx, eye.y, ahead))
							)
								blocked = true;
					}
					expect(`${id}/${variant} ${child.name} blocks view: ${blocked}`).toBe(
						`${id}/${variant} ${child.name} blocks view: false`,
					);
				}
				expect(checked).toBeGreaterThan(0);
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

	test("the fleet review parks every model clear of its neighbours", () => {
		const slots = fleetLayout();
		expect(slots.length).toBe(HULL_IDS.length * HULL_VARIANT_IDS.length);
		// Every hull exactly once, so a role added later cannot be silently left
		// out of the avenue.
		expect(
			new Set(slots.map((slot) => `${slot.id}/${slot.variant}`)).size,
		).toBe(slots.length);
		for (const a of slots)
			for (const b of slots) {
				if (a === b) continue;
				const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
				// Reach is a radius, so touching is the sum of the two. The margin
				// on top is the room to fly between them, which is the whole point
				// of parking them in a line rather than listing them in a viewer.
				const clear = HULL_REACH_KM[a.id] + HULL_REACH_KM[b.id];
				expect(
					`${a.id}/${a.variant} to ${b.id}/${b.variant}: ${gap > clear * 1.8}`,
				).toBe(`${a.id}/${a.variant} to ${b.id}/${b.variant}: true`);
			}
		// The lane down the middle has to stay open. Nothing in the scaffold
		// collides, so a hull parked on the flight line is one the player passes
		// straight through, which reads as a rendering fault rather than a fleet.
		for (const slot of slots) {
			const offAxis = Math.hypot(slot.x, slot.y);
			expect(
				`${slot.id}/${slot.variant} clears the lane: ${offAxis > HULL_REACH_KM[slot.id] * 1.8}`,
			).toBe(`${slot.id}/${slot.variant} clears the lane: true`);
		}
		// Smallest first: the size range only reads as deliberate if it grows.
		const rows = [...new Set(slots.map((slot) => slot.z))];
		expect(rows).toEqual([...rows].sort((a, b) => b - a));
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
	/**
	 * The lights are a legibility fixture, and the two things that would make
	 * them a lie are both checked here: a convention flipped end for end, and a
	 * fixture that grows the silhouette every other test in this file measures.
	 */
	test("every hull carries nav lights on its own metal, in the port/starboard convention", () => {
		for (const id of HULL_IDS) {
			for (const variant of HULL_VARIANT_IDS) {
				const root = buildShipMesh(id, variant).root;
				root.updateMatrixWorld(true);
				const lights = root.children.find(
					(child) => child.name === "nav-lights",
				) as THREE.Points | undefined;
				expect(`${id}-${variant}: ${lights !== undefined}`).toBe(
					`${id}-${variant}: true`,
				);
				if (!lights) continue;
				const roles = lights.userData.navLightRoles as string[];
				expect(roles).toEqual(["port", "starboard", "dorsal", "tail"]);
				const at = lights.geometry.getAttribute("position");
				const rgb = lights.geometry.getAttribute("lightColor");
				expect(at.count).toBe(roles.length);
				const of = (role: string) => {
					const i = roles.indexOf(role);
					return {
						pos: new THREE.Vector3(at.getX(i), at.getY(i), at.getZ(i)),
						color: new THREE.Color(rgb.getX(i), rgb.getY(i), rgb.getZ(i)),
					};
				};
				const port = of("port");
				const starboard = of("starboard");
				const tail = of("tail");
				// Decoded from sRGB once (#300's review): three's `setHex` already
				// converts, so a second `convertSRGBToLinear` crushed every
				// channel that is not 0 or 255 — port's green 0x2f to a tenth.
				const decode = (c: number) => {
					const s = c / 255;
					return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
				};
				for (const light of NAV_LIGHTS) {
					const { color } = of(light.role);
					expect([
						light.role,
						Math.abs(color.g - decode((light.color >> 8) & 255)) < 1e-6,
					]).toEqual([light.role, true]);
				}

				// Red to port, green to starboard. Flipped, the lights would still
				// be visible and would tell the player the wrong way round, which
				// is worse than no lights at all.
				expect(
					`${id}-${variant} port red: ${port.color.r > port.color.g}`,
				).toBe(`${id}-${variant} port red: true`);
				expect(
					`${id}-${variant} starboard green: ${starboard.color.g > starboard.color.r}`,
				).toBe(`${id}-${variant} starboard green: true`);
				expect(port.pos.x).toBeLessThan(starboard.pos.x);

				// The hull's nose is -Z, so the tail light is aft of its centre.
				const metal = new THREE.Box3();
				root.traverse((object) => {
					if (object instanceof THREE.Mesh)
						metal.union(new THREE.Box3().setFromObject(object));
				});
				expect(tail.pos.z).toBeGreaterThan(
					metal.getCenter(new THREE.Vector3()).z,
				);
				// And no light stands further off the metal than it is meant to.
				// A light *is* proud of the surface — buried in the fuselage it
				// draws nothing — but only by `NAV_LIGHT_PROUD` of the hull's
				// longest axis.
				const span = metal.getSize(new THREE.Vector3());
				const slack = Math.max(span.x, span.y, span.z) * NAV_LIGHT_PROUD;
				const envelope = metal.clone().expandByScalar(slack * 1.01);
				for (const role of roles)
					expect(
						`${id}-${variant} ${role} on the metal: ${envelope.containsPoint(of(role).pos)}`,
					).toBe(`${id}-${variant} ${role} on the metal: true`);

				// **And no light grows the box at all**, which is a stricter claim
				// than the one above and was asserted only in prose until #181
				// measured it: `hull.test.ts` compares `HULL_SPECS[id].env` with
				// `setFromObject(root)`, and the lights are in `root`. Five hulls
				// — patrol, explorer, raider, carrier, dreadnought — present
				// their aft metal *at* `box.max.z`, so a tail light proud of it
				// moved the declared length by 0.38 m on the raider. `berthFits`
				// reads that box, so a lamp was sizing berths. `addNavLights`
				// clamps back into the hull's own box; this is that clamp.
				//
				// Measured against everything in `root` *except* the fixture, so
				// it does not restate the clamp's own arithmetic: whatever else
				// the builder drew is the silhouette, and the lights may not
				// exceed it on any axis.
				//
				// The band is 1 mm and it is not a fudge. Geometry positions are
				// `Float32Array`, so a box unioned per child and the same box
				// taken over the whole root round differently — 0.4 µm apart on
				// `freighter/a` — and an exact comparison would be measuring
				// that. What this has to catch is 0.38 m, which is 380 times the
				// band and 1,000 times the noise.
				const BOX_NOISE_KM = 1e-6;
				const structure = new THREE.Box3();
				for (const child of root.children)
					if (child !== lights)
						structure.union(new THREE.Box3().setFromObject(child));
				// `root` above, not a second `bounds(id, variant)`: rebuilding every
				// hull a second time lofted all 33 pairs twice for a box already in
				// hand, and `bounds` is exactly this call.
				const withLights = new THREE.Box3().setFromObject(root);
				for (const axis of ["x", "y", "z"] as const) {
					expect(
						`${id}-${variant} lights inside the silhouette on ${axis}: ${
							withLights.min[axis] >= structure.min[axis] - BOX_NOISE_KM &&
							withLights.max[axis] <= structure.max[axis] + BOX_NOISE_KM
						}`,
					).toBe(
						`${id}-${variant} lights inside the silhouette on ${axis}: true`,
					);
				}

				// And no light is *behind* the metal, which is the failure that
				// shipped first: a bounding-box extreme taken at the centre of the
				// other two axes is inside the fuselage, and three of the four drew
				// nothing at all. Seen from outside along its own axis, a light must
				// not sit further away than the first surface the hull presents.
				const centreOf = metal.getCenter(new THREE.Vector3());
				const standoff = Math.max(span.x, span.y, span.z);
				const views: [string, THREE.Vector3, THREE.Vector3][] = [
					[
						"port",
						new THREE.Vector3(metal.min.x - standoff, centreOf.y, centreOf.z),
						new THREE.Vector3(1, 0, 0),
					],
					[
						"starboard",
						new THREE.Vector3(metal.max.x + standoff, centreOf.y, centreOf.z),
						new THREE.Vector3(-1, 0, 0),
					],
					[
						"dorsal",
						new THREE.Vector3(centreOf.x, metal.max.y + standoff, centreOf.z),
						new THREE.Vector3(0, -1, 0),
					],
					[
						"tail",
						new THREE.Vector3(centreOf.x, centreOf.y, metal.max.z + standoff),
						new THREE.Vector3(0, 0, -1),
					],
				];
				const caster = new THREE.Raycaster();
				for (const [role, from, direction] of views) {
					caster.set(from, direction);
					const first = caster
						.intersectObject(root, true)
						.find((candidate) => candidate.face);
					// Nothing in the way is a light nothing can hide.
					if (!first) continue;
					expect(
						`${id}-${variant} ${role} in front of the hull: ${
							of(role).pos.distanceTo(from) <= first.distance + slack * 1.01
						}`,
					).toBe(`${id}-${variant} ${role} in front of the hull: true`);
				}
			}
		}
	});
	/**
	 * The hit sphere and the drawn ship are two numbers that have to agree, and
	 * nothing in the renderer makes them. It lives here rather than beside the
	 * controller because this is the file that can **build the mesh**: a raider
	 * that changes length fails this rather than quietly making the beam score
	 * on shots that miss, which is what it did at 0.28.
	 *
	 * Measured against the rebuilt hull rather than against `HULL_SPECS`, and
	 * that is the point of the rebase onto #181. `ENEMY_COLLISION_RADIUS_KM` is
	 * now *derived* from the roster, so restating its own formula here would be
	 * a tautology that passes whatever either side says. The mesh is the
	 * independent witness, and it is what "the drawn raider" means.
	 *
	 * The name says *half-length* rather than *contains*, because the sphere
	 * does not contain the hull and the docstring beside the constant says why:
	 * the drawn nose reaches 0.1035 km against a radius of 0.09525. A check
	 * named for containment that measured only `size.z / 2` would be a test
	 * whose name a reader could not have falsified.
	 */
	test("the prototype striker's hit sphere is its drawn raider's half-length", () => {
		const box = bounds(STRIKER_HULL_ID, HULL_SPECS[STRIKER_HULL_ID].variant);
		const size = box.getSize(new THREE.Vector3());
		// And the sphere is not sold as containment. The mesh is off-centre, so
		// the drawn nose is further from the origin than the radius: this pins
		// the shortfall rather than leaving the name to imply it away.
		const drawnNoseKm = Math.abs(box.min.z) * ENEMY_VISUAL_SCALE;
		expect(drawnNoseKm).toBeGreaterThan(ENEMY_COLLISION_RADIUS_KM);
		expect(drawnNoseKm - ENEMY_COLLISION_RADIUS_KM).toBeLessThan(0.02);
		// The roster rounds its envelope **up** to 0.1 m, so the built box is up
		// to 0.1 m under it; the drawn radius is half of that, scaled.
		const slackKm = (0.0001 / 2) * ENEMY_VISUAL_SCALE;
		expect(ENEMY_COLLISION_RADIUS_KM).toBeGreaterThanOrEqual(
			(size.z / 2) * ENEMY_VISUAL_SCALE,
		);
		expect(ENEMY_COLLISION_RADIUS_KM).toBeLessThanOrEqual(
			(size.z / 2) * ENEMY_VISUAL_SCALE + slackKm,
		);
		// The long axis, so the sphere contains the hull along the axis it is
		// aimed down: the raider is longer than it is wide or tall.
		expect(size.z).toBeGreaterThan(size.x);
		expect(size.z).toBeGreaterThan(size.y);
	});
});
