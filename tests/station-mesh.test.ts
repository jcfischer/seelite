/**
 * What the built silhouettes actually measure.
 *
 * Geometry is arithmetic even when it ends up on a GPU, so it belongs in the
 * headless tier: `station-mesh.ts` builds `BufferGeometry` and nothing here
 * needs a canvas, a context or a frame. What the browser probe owns is the half
 * this cannot see — whether the three read *apart* on screen, and whether the
 * slot turns.
 *
 * The claim being guarded is `STATION_SILHOUETTE_KM` (`station-mesh.ts`), which
 * was a number nothing checked until sage's review of #28 measured it: the
 * drydock frame reached 2.0 km against §5's declared 1.5, and the refinery's
 * stacks 0.85 against a then-declared 0.75. A budget with no test is a comment.
 *
 * The two rows are different kinds of claim and the assertions below cannot tell
 * them apart, so it is said here instead: the shipyard's 1.5 km comes from
 * `docking.md` §5, and its overrun was fixed by **resizing the frame**. The
 * refinery has no spec figure, so its 0.9 was set from the mesh's own 0.837 —
 * the overrun there was fixed by **raising the number**, and on the day it was
 * written that row could not have failed. It is a ratchet against future growth,
 * not a design constraint.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import { stationInterior } from "../src/station-interior";
import {
	NAMEPLATE_NAME,
	SELECTED_FORM,
	STATION_FORMS,
	type StationFormId,
	STATION_SILHOUETTE_KM,
	buildStationForm,
	buildStationMesh,
	setStationDetail,
} from "../src/station-mesh";
import { berthCentre } from "../src/arrival";
import {
	collarSurfaces,
	crossings,
	crossingsLine,
	cutSurfaces,
} from "./helpers/aperture-opening";

// From `station.ts`, not a literal: a fourth station type must reach every
// loop in this file, and a hand-written list is exactly the place it would not.
const TYPES: StationType[] = STATION_TYPES;

/** Any colour: these tests are about geometry. The two that are about the
 *  colour cue pass their own and say so. */
const GREY = 0x9aa6b2;

/**
 * The farthest vertex from the station's centre, in kilometres.
 *
 * Vertices rather than `Box3.setFromObject`, and the difference is not
 * pedantry: a box around the trade station's octahedron has corners at
 * √3 × 0.6 = 1.04 km where the object's farthest actual point is 0.6, so a box
 * would fail a correct mesh and be "fixed" by inflating the budget.
 *
 * The root is normalised to core radii (`station-mesh.ts`), so the result is
 * multiplied back by the core radius to land in kilometres — the units the
 * table is written in.
 */
function reachKm(type: StationType): number {
	return reachOf(buildStationMesh(type, GREY, 0).root, type);
}

/** The farthest drawn vertex of an already-built station, kilometres. */
function reachOf(root: THREE.Object3D, type: StationType): number {
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		// An `InstancedMesh` carries its copies in `instanceMatrix`, not in the
		// scene graph, so walking children alone would measure the window grid at
		// the origin and report a station smaller than it is drawn.
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				maxSq = Math.max(maxSq, v.lengthSq());
			}
		}
	});
	return Math.sqrt(maxSq) * STATION_GEOMETRY[type].coreRadiusKm;
}

describe("the silhouette budget is a budget", () => {
	test("no vertex of any station lies outside silhouetteRadiusKm", () => {
		for (const type of TYPES) {
			const reach = reachKm(type);
			console.log(
				`${type}: reaches ${reach.toFixed(3)} km, budget ` +
					`${STATION_SILHOUETTE_KM[type]} km`,
			);
			// A hair of slack for float32: `BufferAttribute` positions are single
			// precision, so a vertex authored at exactly the budget reads back a few
			// parts in 10⁸ outside it. The budget is a kilometre-scale claim and this
			// is a 24-nanometre one.
			expect(reach).toBeLessThanOrEqual(
				STATION_SILHOUETTE_KM[type] * (1 + 1e-6),
			);
		}
	});

	test("every form is inside its own declared reach", () => {
		// Per *form*, not per role. The selected forms are what the two
		// assertions around this one measure, and a form nobody has ranked yet is
		// exactly where an overrun hides: the previewer draws it, nothing else
		// does, and its number would drift until the day it was chosen.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				const reach = reachOf(root, type);
				console.log(
					`${type} ${form.id} ${form.name}: reaches ${reach.toFixed(3)} km, ` +
						`declared ${form.reachKm} km`,
				);
				expect(reach).toBeLessThanOrEqual(form.reachKm * (1 + 1e-6));
				// And not slack: a declaration nothing approaches catches nothing.
				expect(reach).toBeGreaterThan(form.reachKm * 0.6);
			}
		}
	});

	test("the budget is not slack enough to hide a doubling", () => {
		// A ceiling nothing approaches is a ceiling that catches nothing: the
		// shipyard's frame could grow by half again inside a 3 km budget and no
		// test would see it. Half the budget is the floor, which every type clears
		// comfortably today.
		for (const type of TYPES) {
			expect(reachKm(type)).toBeGreaterThan(STATION_SILHOUETTE_KM[type] * 0.5);
		}
	});

	test("every silhouette contains its own dockable core", () => {
		for (const type of TYPES) {
			expect(STATION_SILHOUETTE_KM[type]).toBeGreaterThanOrEqual(
				STATION_GEOMETRY[type].coreRadiusKm,
			);
			// And the mesh really is at least core-sized — a station drawn smaller
			// than what the docking checks aim at is a slot you cannot see.
			expect(reachKm(type)).toBeGreaterThanOrEqual(
				STATION_GEOMETRY[type].coreRadiusKm * 0.95,
			);
		}
	});
});

describe("the parts the probe and the renderer look up by name", () => {
	test("every form of every role has a core and an aperture", () => {
		// `probe-station.mjs` and `probe-station-visuals.mjs` find these by name;
		// a rename that only broke a probe would show up as a browser-tier
		// failure with no headless signal. Asserted over every *form*, not only
		// the selected one, because the previewer builds them all and a form that
		// cannot be probed is a form that cannot be ranked honestly.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				expect(root.getObjectByName("core")).toBeDefined();
				expect(root.getObjectByName("aperture")).toBeDefined();
				expect(root.getObjectByName("station-interior")).toBeDefined();
			}
		}
	});

	test("a shipyard's outboard frame is never inside its spinner", () => {
		// §7's frame does not rotate. Inside the spinner it would, and the only
		// symptoms are a fairground ride and — measurably — `probe-station.mjs`'s
		// far-range width check becoming a function of the clock, because the
		// outboard structure swings through the view.
		for (const form of STATION_FORMS.shipyard) {
			const { root, spinner } = buildStationForm("shipyard", form.id, GREY, 0);
			expect(root.getObjectByName("frame")).toBeDefined();
			expect(spinner.getObjectByName("frame")).toBeUndefined();
			// And the bay *is* inside it, or the phase drives nothing — a berth is
			// off the axis, so a bay outside the spinner would leave a parked ship
			// behind as the station turned.
			expect(spinner.getObjectByName("station-interior")).toBeDefined();
		}
	});

	test("only a role that spins hands back a spinner with anything in it", () => {
		// `docking.md` §4: the refinery's pad does not turn, and a station that
		// rotated whole would sweep its own pad away from the ship lined up on it.
		for (const type of TYPES) {
			const { spinner } = buildStationMesh(type, GREY, 0);
			expect(spinner.children.length > 0).toBe(STATION_GEOMETRY[type].spins);
		}
	});
});

describe("the meshes are built in the table's units", () => {
	test("the aperture is drawn at the size the docking checks use", () => {
		// The one dimension a headless test can hold the renderer to: a slot drawn
		// wider than `STATION_GEOMETRY` says is a gap between what the player aims
		// at and what #9's checks measure, and it is invisible on screen.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY, 0);
			const opening = apertureOpening(root);
			const core = STATION_GEOMETRY[type].coreRadiusKm;
			// Six digits, not nine: the vertices are float32 by the time they are
			// read back, so nine would be asserting the storage format rather than
			// the dimension. A slot 1% wrong fails this by four orders of magnitude.
			expect(opening.widthKm * core).toBeCloseTo(
				STATION_GEOMETRY[type].aperture.widthKm,
				6,
			);
			expect(opening.heightKm * core).toBeCloseTo(
				STATION_GEOMETRY[type].aperture.heightKm,
				6,
			);
		}
	});

	test("the aperture sits on the +Z face, which is the axis the caller aims", () => {
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY, 0);
			const opening = apertureOpening(root);
			expect(opening.planeZ).toBeGreaterThan(0);
			// On the axis, not off it: an off-axis slot turns the roll match into a
			// lateral intercept at above-gate speed (`docking.md` §4.2).
			expect(Math.hypot(opening.centreX, opening.centreY)).toBeLessThan(1e-6);
		}
	});
});

describe("§7's secondary cue, and the detail that is not the identity", () => {
	test("the hull is painted the colour the caller passes", () => {
		// The blocker sage's HonestOracle lens caught: the first version built both
		// Coriolis cores from one literal, so a trade station and a shipyard were
		// the same colour — a per-type cue silently removed while two docstrings
		// still claimed it was live.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, 0x123456, 0);
			const core = root.getObjectByName("core") as THREE.Mesh;
			expect(core).toBeDefined();
			expect((core.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
				0x123456,
			);
		}
	});

	test("two colours give two different stations", () => {
		const a = buildStationMesh("trade", 0x111111, 0);
		const b = buildStationMesh("trade", 0x222222, 0);
		const hex = (m: THREE.Object3D) =>
			(
				(m.getObjectByName("core") as THREE.Mesh)
					.material as THREE.MeshStandardMaterial
			).color.getHex();
		// A shared material would make the second build recolour the first, which
		// is the failure the shared-parts comment warns about from the other side.
		expect(hex(a.root)).toBe(0x111111);
		expect(hex(b.root)).toBe(0x222222);
	});

	test("window panes sit out near the shell they belong to", () => {
		// **Renamed, because the old name was a claim this cannot make.** It was
		// "panes lie on the hull, not buried inside it", which #28 could assert
		// exactly: its hull was an octahedron and "on the hull" was the equation
		// |x| + |y| + |z| = r. Twelve forms share no such equation, and the
		// generalisation that replaced it — a floor at a quarter of the core
		// radius — passes the very defect the name promises to catch, a pane on a
		// circle of 0.62·r sitting tens of metres inside an opaque face.
		//
		// What is left is a bound, honestly named: a pane is out near the shell
		// and inside the declared reach. It catches a grid placed at the centre
		// or outside the silhouette; it cannot see one buried by a few metres,
		// and nothing headless can without a per-form surface equation. The
		// island check and the browser's own "the windows do not show" are what
		// cover the rest.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				root.updateMatrixWorld(true);
				const panes = root.getObjectByName("windows") as THREE.InstancedMesh;
				expect(panes?.isInstancedMesh).toBe(true);
				// Against the **core radius**, not the form's reach: a shipyard's
				// ports are on its bridge, and its reach is a 1.4 km frame the
				// crew does not live in. The dockable core is the inhabited part
				// and the only per-form scale that means the same thing on all
				// twelve.
				const core = STATION_GEOMETRY[type].coreRadiusKm;
				const m = new THREE.Matrix4();
				const p = new THREE.Vector3();
				for (let i = 0; i < panes.count; i++) {
					panes.getMatrixAt(i, m);
					p.setFromMatrixPosition(m);
					// Authored in kilometres — the normalisation happens at the root,
					// above this group — so these are kilometres already.
					expect([type, form.id, p.length() > core * 0.4]).toEqual([
						type,
						form.id,
						true,
					]);
					expect(p.length()).toBeLessThanOrEqual(form.reachKm);
				}
			}
		}
	});

	test("the bay's mouth bulkhead is not coplanar with the bars in front of it", () => {
		// Coplanar faces z-fight, and the symptom is a slot that flickers as the
		// station turns — which reads as the aperture not being there.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY, 0);
			const opening = apertureOpening(root);
			const [panel] = interiorOf(root, "interior-bulkhead");
			const box = new THREE.Box3().setFromObject(panel);
			// Behind the bars, and by a real span rather than a rounding.
			expect(box.max.z).toBeLessThan(opening.planeZ);
			expect(box.max.z).not.toBeCloseTo(opening.planeZ, 9);
		}
	});
});

describe("a station is one object, not a scatter of parts", () => {
	/**
	 * The parts of a built station, grouped into islands by bounding-box
	 * contact.
	 *
	 * Boxes rather than geometry, and it is worth being plain that this is a
	 * **proxy**: two boxes can overlap while the meshes inside them miss each
	 * other, so a pass here is not proof that everything touches. What it does
	 * catch is the failure that actually happens — a fixture placed at a radius
	 * chosen by eye, hanging in space beside the hull it is meant to be mounted
	 * on. Four of those were in the pool when this was first run: two of the
	 * Gantry's floods, one of the Hangar's strobes, the Derrick's whole flare,
	 * and the Rig's window run.
	 */
	function islands(root: THREE.Object3D): string[][] {
		root.updateMatrixWorld(true);
		const parts: { name: string; box: THREE.Box3 }[] = [];
		root.traverse((object) => {
			if (!(object as THREE.Mesh).geometry) return;
			parts.push({
				name: object.name || object.type,
				box: new THREE.Box3().setFromObject(object),
			});
		});
		// **Shrunk before testing.** A bare `intersectsBox` counts a boundary
		// graze as contact: the Rig's drill head overlapped its body by 1 m on a
		// single axis and passed this check while hanging visibly detached on
		// screen. Requiring a real overlap on every axis is what makes the proxy
		// worth anything.
		// Per axis, and never more than a quarter of the part's own extent on
		// that axis: a flat 4 m would shrink a 12 m aperture bar into nothing and
		// report the frame as detached from the hull it is bolted to.
		const OVERLAP_KM = 0.004;
		const shrunk = parts.map(({ box }) => {
			const size = box.getSize(new THREE.Vector3());
			return box
				.clone()
				.expandByVector(
					new THREE.Vector3(
						-Math.min(OVERLAP_KM, size.x * 0.25),
						-Math.min(OVERLAP_KM, size.y * 0.25),
						-Math.min(OVERLAP_KM, size.z * 0.25),
					),
				);
		});
		const parent = parts.map((_, i) => i);
		const find = (i: number): number =>
			parent[i] === i ? i : (parent[i] = find(parent[i]));
		for (let i = 0; i < parts.length; i++)
			for (let j = i + 1; j < parts.length; j++)
				if (shrunk[i].intersectsBox(shrunk[j])) parent[find(i)] = find(j);
		const grouped = new Map<number, string[]>();
		for (let i = 0; i < parts.length; i++) {
			const root = find(i);
			if (!grouped.has(root)) grouped.set(root, []);
			(grouped.get(root) as string[]).push(parts[i].name);
		}
		return [...grouped.values()];
	}

	test("every form of every role is a single connected assembly", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				const found = islands(root);
				// The message carries the names, because "2 islands" tells you
				// nothing about which part came loose and the parts are named.
				const detached = found
					.slice(1)
					.map((names) => names.join("+"))
					.join(" | ");
				expect([`${type} ${form.id}`, detached]).toEqual([
					`${type} ${form.id}`,
					"",
				]);
			}
		}
	});
});

describe("nothing stands in the way of the thing you fly through", () => {
	/**
	 * The docking corridor: the aperture's own footprint, extended outward along
	 * +Z from the front of its mouth.
	 *
	 * A ship arrives down this axis — it is the one approach every type shares
	 * (`docking.md` §4) — so anything of the station sitting in it is something
	 * the pilot has to fly through. The failure that produced this check was the
	 * refinery's asteroid: **noise does not know where the dock is**, and a rock
	 * is the one body in the pool whose surface is not authored. Measured, the
	 * Warren's rock rose 131 m past its own pad mouth and the Collar's 74 m.
	 *
	 * Written generally rather than against the rock, because the same failure
	 * has other shapes — a flare boom swung across the approach, a gantry rib
	 * carried too far forward — and none of them would be caught by a check that
	 * only knew about asteroids.
	 *
	 * The radius is the aperture's half-*diagonal*, so the corridor contains the
	 * whole opening rather than an inscribed circle of it.
	 */
	/** See the vertex test below: the wall the aperture is cut into is not an
	 *  intrusion into the corridor in front of it. */
	const WALL_EPSILON_KM = 1e-4;

	function intrusions(root: THREE.Object3D, type: StationType) {
		root.updateMatrixWorld(true);
		const core = STATION_GEOMETRY[type].coreRadiusKm;
		const { widthKm, heightKm } = STATION_GEOMETRY[type].aperture;
		const radius = Math.hypot(widthKm, heightKm) / 2;
		// The aperture plane, read off the bars' own centre — they straddle it.
		const front = apertureOpening(root).planeZ * core;
		const found = new Map<string, number>();
		const v = new THREE.Vector3();
		const instance = new THREE.Matrix4();
		root.traverse((object) => {
			const mesh = object as THREE.Mesh;
			const position = mesh.geometry?.getAttribute?.("position");
			if (!position) return;
			// The aperture's own frame lives in the corridor by construction —
			// it *is* the opening.
			if (object.name.startsWith("aperture")) return;
			const instanced = object as THREE.InstancedMesh;
			const count = instanced.isInstancedMesh ? instanced.count : 1;
			for (let n = 0; n < count; n++) {
				if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
				else instance.identity();
				for (let i = 0; i < position.count; i++) {
					v.fromBufferAttribute(position as THREE.BufferAttribute, i);
					v.applyMatrix4(instance);
					mesh.localToWorld(v);
					v.multiplyScalar(core);
					// **Strictly past the plane, by more than float32 can move a
					// vertex.** Since #128 the aperture plane *is* the surface the
					// slot is cut into, so the hull's own face and `front` are the
					// same number reached by different paths — a float64 constant
					// against a `Float32Array` position — and the wall the aperture
					// is cut into lands a hair either side of it. A hundred
					// millimetres is four orders under anything `docking.md` talks
					// about and four orders over the noise (~3e-5 m at 0.4 km).
					if (v.z <= front + WALL_EPSILON_KM) continue;
					if (Math.hypot(v.x, v.y) > radius) continue;
					const name = object.name || object.type;
					found.set(name, Math.max(found.get(name) ?? 0, v.z - front));
				}
			}
		});
		return found;
	}

	test("the approach corridor is clear on every form of every role", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				const blocked = [...intrusions(root, type)]
					.map(([name, depth]) => `${name} +${(depth * 1000).toFixed(0)}m`)
					.join(", ");
				expect([`${type} ${form.id}`, blocked]).toEqual([
					`${type} ${form.id}`,
					"",
				]);
			}
		}
	});
});

/**
 * §13.1's opening, as a hole rather than as a picture of one (#155).
 *
 * **This is a different question from the corridor row above, and the epsilon
 * there says so.** That row measures what stands *in front of* the aperture
 * plane and skips every vertex at or behind it by construction — *"the wall the
 * aperture is cut into is not an intrusion into the corridor in front of it"*.
 * The defect #155 found lives exactly in the space that skip creates: the wall
 * itself was never cut, so all twelve forms drew a lit frame on a solid surface
 * and a docking ship crossed the station's own face. Every headless row in this
 * file was green throughout, and none of them could have gone red.
 *
 * So this measures what is *in* the band a ship traverses: from the bay's mouth
 * to its back wall, inside the aperture rectangle, nothing may be crossed that
 * is not the bay.
 *
 * **The bounds come off the drawn bay, not off the table.** An alternate form
 * cuts its aperture where its own silhouette wants — `buildTradeRing` puts one
 * at `r * 0.34` against a table figure of 0.428 — so a band derived from
 * `STATION_GEOMETRY` would be measuring somewhere the workbench's forms do not
 * have an opening at all.
 */
describe("§13.1 — the opening is a hole, not a lit frame on a solid face", () => {
	/**
	 * **This is a different question from the corridor row above, and that
	 * row's epsilon says so.** It measures what stands *in front of* the
	 * aperture plane and skips every vertex at or behind it by construction —
	 * *"the wall the aperture is cut into is not an intrusion into the corridor
	 * in front of it"*. #155's defect lived exactly in the space that skip
	 * creates: the wall was never cut, so all twelve forms drew a lit frame on a
	 * solid surface and a docking ship crossed the station's own face. Every
	 * headless row in this file was green throughout and none of them could
	 * have gone red.
	 *
	 * **It asserts the cut, not the lane.** `scripts/measure-aperture-cut.ts`
	 * prints both, and on eight forms the lane behind the mouth is still
	 * blocked — a keel through a hub, a rock ceiling 207 m in, four tower legs.
	 * That is #147's bay placed inside solid station rather than #155's uncut
	 * face, it needs three different fixes and none of them is a cut, and it
	 * carries its own node. The two cannot be separated by a depth band, which
	 * is why this reads the record `hullLoft` and `buildCuboctahedron` write on
	 * the geometry they cut: the Coriolis's frame stands 25 m proud of its own
	 * face and an outpost's tower leg crosses the lane at 30 m.
	 */
	test("every form cuts its aperture into a surface", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				expect([`${type} ${form.id}`, cutSurfaces(root).length > 0]).toEqual([
					`${type} ${form.id}`,
					true,
				]);
			}
		}
	});

	/**
	 * **And it is the surface that surrounds the opening.** The row below can
	 * only see what still stands *in* the rectangle, and a cut surface leaves
	 * nothing there — so a form that cut some other surface and left the right
	 * one solid would satisfy both of the other rows. Point
	 * `buildRefineryWarren`'s cut at `i === 0` and this goes red with
	 * `terrace-2 uncut` while they stay green.
	 */
	test("the surface surrounding each opening is the one that was cut", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				const uncut = collarSurfaces(root, type)
					.filter((surface) => !surface.cut)
					.map((surface) => `${surface.name} uncut`)
					.join(", ");
				expect([`${type} ${form.id}`, uncut]).toEqual([
					`${type} ${form.id}`,
					"",
				]);
			}
		}
	});

	test("no surface a form cut still stands across its opening", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				const blocked = crossingsLine(
					crossings(root, type).filter((crossing) => crossing.cut),
				);
				expect([`${type} ${form.id}`, blocked]).toEqual([
					`${type} ${form.id}`,
					"",
				]);
			}
		}
	});
});

/**
 * `docs/specs/docking.md` §13's interior and §12.5's **E10** — the parts of the
 * arrival that are geometry.
 *
 * The *pixels* are §13.5's browser rows: whether the bay reads as enclosed and
 * whether the shield is legible are things only a rendered frame answers. What
 * is arithmetic, and therefore belongs here, is that every form has the parts at
 * all and that they are sized from the sim's own catalogue rather than authored.
 */
/**
 * The opening the four aperture bars frame, in mesh units.
 *
 * **Measured off the drawn bars rather than off a marker.** The dark mouth box
 * this replaces was a solid rectangle sized from the table, so every row that
 * looked it up was reading the table back; §13.1 removed it, because a solid
 * rectangle at the aperture stands in front of the bay behind it. The bars are
 * what is actually drawn around the hole, and their *inner* edges are the hole.
 *
 * The two uprights are taller than they are wide and the two rails the reverse,
 * which is how they are told apart without a fifth name.
 */
function apertureOpening(root: THREE.Object3D) {
	root.updateMatrixWorld(true);
	const boxes = interiorOf(root, "aperture-light").map((bar) =>
		new THREE.Box3().setFromObject(bar),
	);
	if (boxes.length !== 4) throw new Error(`${boxes.length} aperture bars`);
	const size = (b: THREE.Box3) => b.getSize(new THREE.Vector3());
	const uprights = boxes.filter((b) => size(b).y > size(b).x);
	const rails = boxes.filter((b) => size(b).y <= size(b).x);
	const right = Math.min(...uprights.map((b) => b.min.x).filter((x) => x > 0));
	const left = Math.max(...uprights.map((b) => b.max.x).filter((x) => x < 0));
	const top = Math.min(...rails.map((b) => b.min.y).filter((y) => y > 0));
	const bottom = Math.max(...rails.map((b) => b.max.y).filter((y) => y < 0));
	const z =
		boxes.reduce((a, b) => a + b.getCenter(new THREE.Vector3()).z, 0) / 4;
	return {
		widthKm: right - left,
		heightKm: top - bottom,
		centreX: (right + left) / 2,
		centreY: (top + bottom) / 2,
		planeZ: z,
	};
}

/** Every mesh in a form carrying one name. */
const interiorOf = (root: THREE.Object3D, name: string) => {
	const found: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o.name === name && o instanceof THREE.Mesh) found.push(o);
	});
	return found;
};

describe("§13.1 — every form gets a bay", () => {
	test("every form gets one bay, whatever its aperture kind", () => {
		// **§13.1 replaced E7/E8's split.** A slot used to get a throat and a pad
		// a touchdown deck, decided by `aperture.kind`; the interior is shared by
		// *role* now, so the shell is unconditional and the row that asserted the
		// split would go red on the thing it was written to protect.
		for (const type of TYPES)
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				expect([
					`${type} ${form.id}`,
					interiorOf(root, "interior-shell").length,
				]).toEqual([`${type} ${form.id}`, 4]);
			}
	});

	test("the drawn bay spans exactly the volume the sim declares", () => {
		// **Read from `station-interior.ts`, not restated.** The drawn shell and
		// the law that flies down it must be the same box, or the ship parks in a
		// wall — and a test with its own copy of the numbers would not notice.
		//
		// **Close, not equal.** A geometry's positions are `Float32Array`, so a
		// 0.256 km depth comes back a few ULPs off — the buffer's precision
		// rather than a discrepancy. Six decimal places on a kilometre is a
		// millimetre, four orders under anything §13 talks about.
		for (const type of TYPES) {
			const interior = stationInterior(
				type,
				STATION_GEOMETRY[type].aperturePlaneKm,
			);
			const { root } = buildStationForm(type, SELECTED_FORM[type], GREY, 0);
			root.updateMatrixWorld(true);
			const core = STATION_GEOMETRY[type].coreRadiusKm;
			// The union of the bay's five walls: the shell stopped being one
			// closed box when its sixth face turned out to be a lid on the mouth.
			const box = new THREE.Box3();
			for (const part of interiorOf(root, "interior-shell"))
				box.union(new THREE.Box3().setFromObject(part));
			for (const part of interiorOf(root, "interior-shell-back"))
				box.union(new THREE.Box3().setFromObject(part));
			expect([type, (box.max.z * core).toFixed(6)]).toEqual([
				type,
				interior.mouthAxialKm.toFixed(6),
			]);
			expect([type, (box.min.z * core).toFixed(6)]).toEqual([
				type,
				interior.endAxialKm.toFixed(6),
			]);
			expect(box.max.x * core).toBeCloseTo(interior.halfAcrossKm, 6);
			expect(box.max.y * core).toBeCloseTo(interior.halfUpKm, 6);
		}
	});

	test("every berth the sim hands out has a drawn pad under it", () => {
		// The seam nothing else can see: the catalogue is arithmetic and the bay
		// is geometry, and a berth with no pad is a ship settling onto nothing.
		for (const type of TYPES) {
			const interior = stationInterior(
				type,
				STATION_GEOMETRY[type].aperturePlaneKm,
			);
			const { root } = buildStationForm(type, SELECTED_FORM[type], GREY, 0);
			for (const berth of interior.berths)
				expect([
					type,
					berth.id,
					!!root.getObjectByName(`berth-${berth.id}`),
				]).toEqual([type, berth.id, true]);
		}
	});

	test("no station has an inner gate, at any detail level", () => {
		// **§13.1's negative, as a row.** #138 closed a door behind a docked ship
		// and the ratified interior is unpressurized: the aperture frame and the
		// name shield stay visible from every berth, which a door makes false.
		//
		// **The levels are driven, not implied.** The title said "at any detail
		// level" while the body only looped forms — and since the bay's furniture
		// is now tagged `minDetail`, a level *does* change which of its parts are
		// visible. A door hidden at `full` and shown at `low` would have passed a
		// name scan taken once.
		for (const type of TYPES)
			for (const form of STATION_FORMS[type]) {
				const mesh = buildStationForm(type, form.id, GREY, 0);
				for (const level of ["outline", "reduced", "full"] as const) {
					setStationDetail(mesh, level);
					const gates: string[] = [];
					mesh.root.traverse((object) => {
						if (object.visible && /gate|door|curtain/i.test(object.name))
							gates.push(object.name);
					});
					expect([`${type} ${form.id} ${level}`, gates]).toEqual([
						`${type} ${form.id} ${level}`,
						[],
					]);
				}
			}
	});
});

describe("§12.5 E10/E11 — the shields are geometry here and pixels elsewhere", () => {
	test("every station carries two shields, mouth and bulkhead", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const mesh = buildStationForm(type, form.id, GREY, 0);
				// **E11 as §13.1 re-sited it: at the mouth *and* on the bulkhead
				// inside.** A pad used to carry the mouth plate alone, because it
				// had no inside; every role has one now.
				expect([`${type} ${form.id}`, mesh.nameplates.length]).toEqual([
					`${type} ${form.id}`,
					2,
				]);
				for (const plate of mesh.nameplates)
					expect(plate.name).toBe(NAMEPLATE_NAME);
			}
		}
	});

	test("this module supplies no pixels", () => {
		// E10's whole point: a `CanvasTexture` here would force the
		// `typeof document !== "undefined"` branch that `station-visuals.ts`
		// names as the failure mode — the branch that ships to players would be
		// the one no test ever takes. The plate leaves this module untextured and
		// invisible, and the renderer lights it.
		const mesh = buildStationMesh("trade", GREY, 0);
		for (const plate of mesh.nameplates) {
			const material = plate.material as THREE.MeshBasicMaterial;
			expect(material.map).toBe(null);
			expect(material.opacity).toBe(0);
		}
	});

	test("each plate has its own material", () => {
		// Every other shared material in the module is documented as never being
		// mutated; this one is written to. A shared one would give every station
		// in the galaxy the name of whichever was textured last.
		const a = buildStationMesh("trade", GREY, 0);
		const b = buildStationMesh("trade", GREY, 0);
		expect(a.nameplates[0].material).not.toBe(b.nameplates[0].material);
		expect(a.nameplates[0].material).not.toBe(a.nameplates[1].material);
	});
});

/**
 * The seam between the two tiers: the sim parks the ship at `dockedAxialKm`
 * from the station's centre, and the mesh draws a recess somewhere. Nothing
 * had ever asserted that the first is inside the second.
 *
 * It is not a restatement of either. `dockedAxialKm` is measured from the
 * **docking plane**, which is `coreRadiusKm`; the recess is cut at the form's
 * own aperture face, which each builder places where its geometry has a
 * surface. The two are different quantities and a form is free to move one
 * without the other — so a form whose face sits well inside the core can park
 * the ship in solid hull, and no test in either tier would have said so.
 */
describe("§128 — the hull comes up to the plane the checks read", () => {
	test("a slot form's hull reaches its declared aperture plane", () => {
		// **The hull, not the aperture.** An earlier version of this row measured
		// the *aperture* against `aperturePlaneKm` — and `buildAperture` places
		// the aperture at that very number, so it only exercised the box's own
		// offset. The drift it claims to catch is the surface moving out from
		// under the slot, which that could not see.
		//
		// The `core` mesh is built through a different path — the form's own
		// radius through `buildCuboctahedron` or a lathe — than the number it is
		// compared against, and **that is the whole point**. Deriving the hull
		// from `aperturePlaneKm` was tried and withdrawn: it makes the trade row
		// a tautology (`reach === plane / 1.06` for any plane), on the one form
		// the reported defect was found on. Two paths to one number is an
		// assertion; one path is a restatement.
		//
		// **Slot forms only**, and the pads are excluded for a reason rather than
		// for convenience: a pad's docking surface is its `aperture-deck`, a
		// separate mesh, and its `core` is the rock or drum underneath — the
		// refinery's reaches 0.312 km under a 0.396 km plane and the outpost's
		// does not face that way at all. What holds a pad's deck to its station
		// is the connectivity check above, and what keeps anything from standing
		// in front of it is the approach-corridor check.
		const rows: string[] = [];
		for (const type of TYPES) {
			if (STATION_GEOMETRY[type].aperture.kind !== "slot") continue;
			const { root } = buildStationForm(type, SELECTED_FORM[type], GREY, 0);
			root.updateMatrixWorld(true);
			const core = STATION_GEOMETRY[type].coreRadiusKm;
			const hull = root.getObjectByName("core") as THREE.Object3D;
			const reach = new THREE.Box3().setFromObject(hull).max.z * core;
			const plane = STATION_GEOMETRY[type].aperturePlaneKm;
			// Up to the plane and not past it: the aperture frame stands proud of
			// the surface it is bolted to, so the surface may sit a frame's depth
			// inside the plane and no further. That depth is 24 m on the trade
			// station (`APERTURE_PROUD`), and the shipyard's hub is flush — which
			// is a signed zero once it goes through a subtraction, hence the
			// metre-scale slack on the near side rather than a `>= 0`.
			const insideM = (plane - reach) * 1000;
			rows.push(`${type}: hull ${insideM.toFixed(1)} m inside its plane`);
			// Twenty-six metres of band: 24.9 m is where the trade Coriolis sits
			// (its frame stands 6% proud of the face) and the shipyard's hub is
			// flush. A form whose surface drifts a metre out from under its slot
			// leaves it; the negative slack is a signed zero surviving a
			// subtraction, not a tolerance.
			expect([type, insideM > -0.1 && insideM < 26]).toEqual([type, true]);
		}
		console.log(rows.join("\n"));
	});
});

describe("§13.5 row 3 — every berth is inside the drawn bay", () => {
	/** The drawn shell's span, in km from the station's centre. */
	const shellKm = (type: StationType, formId: StationFormId) => {
		const { root } = buildStationForm(type, formId, GREY, 0);
		root.updateMatrixWorld(true);
		const core = STATION_GEOMETRY[type].coreRadiusKm;
		const box = new THREE.Box3();
		root.traverse((object) => {
			if (
				object.name === "interior-shell" ||
				object.name === "interior-shell-back"
			)
				box.union(new THREE.Box3().setFromObject(object));
		});
		return {
			nearKm: box.max.z * core,
			farKm: box.min.z * core,
			halfAcrossKm: box.max.x * core,
			halfUpKm: box.max.y * core,
		};
	};

	test("the form the game ships parks every ship inside its own bay", () => {
		// **The seam between the two tiers, which nothing had asserted before
		// #128 and which a berth makes three-dimensional.** The catalogue is
		// measured from the declared plane; the bay is drawn at the form's own
		// aperture face, wherever its geometry has a surface. They are different
		// quantities and a form may move one without the other.
		for (const type of TYPES) {
			const interior = stationInterior(
				type,
				STATION_GEOMETRY[type].aperturePlaneKm,
			);
			const shell = shellKm(type, SELECTED_FORM[type]);
			for (const berth of interior.berths) {
				const parked = berthCentre(berth);
				const inside =
					parked.axial <= shell.nearKm + 1e-6 &&
					parked.axial >= shell.farKm - 1e-6 &&
					Math.abs(parked.across) <= shell.halfAcrossKm + 1e-6 &&
					Math.abs(parked.up) <= shell.halfUpKm + 1e-6;
				expect([type, berth.id, inside]).toEqual([type, berth.id, true]);
			}
		}
	});

	test("a selected form's drawn bay is the sim's catalogue, berth for berth", () => {
		// **The two-authors seam, asserted rather than argued.** The mesh builds
		// its catalogue from the face *its own form* cuts and the sim builds one
		// from `aperturePlaneKm`; for a selected form those are the same number,
		// and this is the row that says so — with the berths compared, not just
		// the plane, so a divergence anywhere in the sizing chain shows up here.
		for (const type of TYPES) {
			const drawn = stationInterior(
				type,
				apertureOpening(
					buildStationForm(type, SELECTED_FORM[type], GREY, 0).root,
				).planeZ * STATION_GEOMETRY[type].coreRadiusKm,
			);
			const sim = stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm);
			// The drawn plane is read back through `Float32Array`, so the two
			// agree to a millimetre rather than exactly.
			expect([type, drawn.berths.length]).toEqual([type, sim.berths.length]);
			for (let i = 0; i < sim.berths.length; i++) {
				const label = `${type} ${sim.berths[i].id}`;
				expect([label, drawn.berths[i].id]).toEqual([label, sim.berths[i].id]);
				expect(drawn.berths[i].centre.axial).toBeCloseTo(
					sim.berths[i].centre.axial,
					5,
				);
				expect(drawn.berths[i].centre.across).toBeCloseTo(
					sim.berths[i].centre.across,
					5,
				);
				expect(drawn.berths[i].centre.up).toBeCloseTo(
					sim.berths[i].centre.up,
					5,
				);
			}
		}
	});

	test("an alternate form's bay meets its own aperture, not the table's", () => {
		// **Why the builder takes a face rather than reading the table.** The
		// workbench's alternates cut their aperture wherever their silhouette
		// wants — the Ring on a hub at a third of the core radius — and a bay
		// built against `aperturePlaneKm` would hang in space in front of them.
		// Selecting one of these forms is still a change that has to answer for
		// the sim's own catalogue; what this row asserts is that the *drawn* bay
		// is never detached from the *drawn* opening.
		for (const type of TYPES)
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0);
				root.updateMatrixWorld(true);
				const core = STATION_GEOMETRY[type].coreRadiusKm;
				const [aperture] = interiorOf(root, "aperture-light");
				const mouth = new THREE.Box3().setFromObject(aperture).max.z * core;
				const shell = shellKm(type, form.id);
				const label = `${type} ${form.id}`;
				// The bay's mouth is the aperture's own plane, to within the bar's
				// half-thickness — they are built from one number.
				expect([label, Math.abs(shell.nearKm - mouth) < 0.02]).toEqual([
					label,
					true,
				]);
			}
	});
});
