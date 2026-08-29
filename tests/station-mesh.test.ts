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
import {
	HANGAR_GATE_NAME,
	NAMEPLATE_NAME,
	SELECTED_FORM,
	STATION_FORMS,
	type StationFormId,
	STATION_SILHOUETTE_KM,
	buildStationForm,
	buildStationMesh,
} from "../src/station-mesh";
import {
	dockedAxialKm,
	drawnThroatDepthKm,
	throatDepthKm,
} from "../src/arrival";

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
	return reachOf(buildStationMesh(type, GREY).root, type);
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
				const { root } = buildStationForm(type, form.id, GREY);
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
				const { root } = buildStationForm(type, form.id, GREY);
				expect(root.getObjectByName("core")).toBeDefined();
				expect(root.getObjectByName("aperture")).toBeDefined();
				expect(root.getObjectByName("aperture-mouth")).toBeDefined();
			}
		}
	});

	test("a shipyard's outboard frame is never inside its spinner", () => {
		// §7's frame does not rotate. Inside the spinner it would, and the only
		// symptoms are a fairground ride and — measurably — `probe-station.mjs`'s
		// far-range width check becoming a function of the clock, because the
		// outboard structure swings through the view.
		for (const form of STATION_FORMS.shipyard) {
			const { root, spinner } = buildStationForm("shipyard", form.id, GREY);
			expect(root.getObjectByName("frame")).toBeDefined();
			expect(spinner.getObjectByName("frame")).toBeUndefined();
			// And the slot *is* inside it, or the phase drives nothing.
			expect(spinner.getObjectByName("aperture-mouth")).toBeDefined();
		}
	});

	test("only a role that spins hands back a spinner with anything in it", () => {
		// `docking.md` §4: the refinery's pad does not turn, and a station that
		// rotated whole would sweep its own pad away from the ship lined up on it.
		for (const type of TYPES) {
			const { spinner } = buildStationMesh(type, GREY);
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
			const { root } = buildStationMesh(type, GREY);
			root.updateMatrixWorld(true);
			const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
			expect(mouth).toBeDefined();
			const box = new THREE.Box3().setFromObject(mouth);
			const size = box.getSize(new THREE.Vector3());
			const core = STATION_GEOMETRY[type].coreRadiusKm;
			// Six digits, not nine: the vertices are float32 by the time they are
			// read back, so nine would be asserting the storage format rather than
			// the dimension. A slot 1% wrong fails this by four orders of magnitude.
			expect(size.x * core).toBeCloseTo(
				STATION_GEOMETRY[type].aperture.widthKm,
				6,
			);
			expect(size.y * core).toBeCloseTo(
				STATION_GEOMETRY[type].aperture.heightKm,
				6,
			);
		}
	});

	test("the aperture sits on the +Z face, which is the axis the caller aims", () => {
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY);
			root.updateMatrixWorld(true);
			const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
			const centre = mouth.getWorldPosition(new THREE.Vector3());
			expect(centre.z).toBeGreaterThan(0);
			// On the axis, not off it: an off-axis slot turns the roll match into a
			// lateral intercept at above-gate speed (`docking.md` §4.2).
			expect(Math.hypot(centre.x, centre.y)).toBeLessThan(1e-6);
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
			const { root } = buildStationMesh(type, 0x123456);
			const core = root.getObjectByName("core") as THREE.Mesh;
			expect(core).toBeDefined();
			expect((core.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
				0x123456,
			);
		}
	});

	test("two colours give two different stations", () => {
		const a = buildStationMesh("trade", 0x111111);
		const b = buildStationMesh("trade", 0x222222);
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
				const { root } = buildStationForm(type, form.id, GREY);
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

	test("the aperture mouth is not coplanar with the face it is cut into", () => {
		// Coplanar faces z-fight, and the symptom is a slot that flickers as the
		// station turns — which reads as the aperture not being there.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY);
			root.updateMatrixWorld(true);
			const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
			const box = new THREE.Box3().setFromObject(mouth);
			const bars = root.getObjectByName("aperture") as THREE.Object3D;
			const barZ = Math.max(
				...bars.children
					.filter((c) => c.name !== "aperture-mouth")
					.map((c) => c.position.z),
			);
			expect(box.max.z).toBeGreaterThan(barZ - 0.5);
			expect(box.max.z).not.toBeCloseTo(barZ, 9);
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
				const { root } = buildStationForm(type, form.id, GREY);
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
		const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
		const front = new THREE.Box3().setFromObject(mouth).max.z * core;
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
				const { root } = buildStationForm(type, form.id, GREY);
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
 * `docs/specs/docking.md` §12.4's **E7/E8** and §12.5's **E10** — the parts of
 * the arrival that are geometry.
 *
 * The *pixels* are §12.6's browser rows: whether the throat reads as depth and
 * whether the shield is legible are things only a rendered frame answers. What
 * is arithmetic, and therefore belongs here, is that every form has the parts
 * at all and that they are sized from `STATION_GEOMETRY` rather than authored.
 */
describe("§12.4 E7/E8 — every form gets a throat or a deck", () => {
	const interiorOf = (root: THREE.Object3D, name: string) => {
		const found: THREE.Mesh[] = [];
		root.traverse((o) => {
			if (o.name === name && o instanceof THREE.Mesh) found.push(o);
		});
		return found;
	};

	test("a pad-bearing form has a deck and a slot-bearing one does not", () => {
		for (const type of TYPES) {
			const kind = STATION_GEOMETRY[type].aperture.kind;
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				const decks = interiorOf(root, "aperture-deck");
				// E7/E8: **which forms get what is decided by `aperture.kind`**,
				// not by a list — so this is asserted per type from the geometry
				// table rather than against names written out here. A slot's
				// throat is not a part of its own: it *is* the recess, which the
				// row below measures.
				expect([`${type} ${form.id}`, decks.length]).toEqual([
					`${type} ${form.id}`,
					kind === "pad" ? 1 : 0,
				]);
			}
		}
	});

	test("a slot's recess is the throat, at the law's depth", () => {
		for (const type of TYPES) {
			const aperture = STATION_GEOMETRY[type].aperture;
			if (aperture.kind !== "slot") continue;
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				root.updateMatrixWorld(true);
				// **The recess itself**, because §12.4's throat extends it rather
				// than standing behind it — a second box behind a solid mouth
				// draws nothing at all, which is what the first build did and
				// what `probe-dock-arrival.mjs`'s ink measurement caught.
				const [throat] = interiorOf(root, "aperture-mouth");
				const core = STATION_GEOMETRY[type].coreRadiusKm;
				const size = new THREE.Box3()
					.setFromObject(throat)
					.getSize(new THREE.Vector3())
					.multiplyScalar(core);
				// **Read from `arrival.ts`, not restated.** The drawn throat and the
				// sim law that flies down it must be the same depth, or the ship
				// parks in a wall — and a test with its own copy of the number
				// would not notice.
				// **Close, not equal.** A geometry's positions are `Float32Array`,
				// so a 0.28 km depth comes back as 0.2800000011920929 — the
				// buffer's precision rather than a discrepancy. Six decimal places
				// on a kilometre is a millimetre, which is four orders under
				// anything §12 talks about.
				const label = `${type} ${form.id}`;
				// **The drawn depth, which is the travelled depth plus the room a
				// parked ship needs.** `dockedAxialKm` is where the ship's *origin*
				// stops; a recess ending there puts its nose through the wall.
				expect([label, size.z.toFixed(6)]).toEqual([
					label,
					drawnThroatDepthKm(aperture).toFixed(6),
				]);
				expect(size.x).toBeCloseTo(aperture.widthKm, 6);
				expect(size.y).toBeCloseTo(aperture.heightKm, 6);
			}
		}
	});

	test("only a slot has a closed-dock hangar gate", () => {
		for (const type of TYPES) {
			const kind = STATION_GEOMETRY[type].aperture.kind;
			for (const form of STATION_FORMS[type]) {
				const mesh = buildStationForm(type, form.id, GREY);
				expect([`${type} ${form.id}`, mesh.hangarGate?.name ?? null]).toEqual([
					`${type} ${form.id}`,
					kind === "slot" ? HANGAR_GATE_NAME : null,
				]);
				if (mesh.hangarGate) expect(mesh.hangarGate.visible).toBe(false);
			}
		}
	});
});

describe("§12.5 E10/E11 — the shields are geometry here and pixels elsewhere", () => {
	test("a slot carries two shields and a pad one", () => {
		for (const type of TYPES) {
			const kind = STATION_GEOMETRY[type].aperture.kind;
			for (const form of STATION_FORMS[type]) {
				const mesh = buildStationForm(type, form.id, GREY);
				// **E11: at the mouth *and* inside the throat.** A pad has no
				// inside, so it carries the mouth plate alone.
				expect([`${type} ${form.id}`, mesh.nameplates.length]).toEqual([
					`${type} ${form.id}`,
					kind === "slot" ? 2 : 1,
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
		const mesh = buildStationMesh("trade", GREY);
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
		const a = buildStationMesh("trade", GREY);
		const b = buildStationMesh("trade", GREY);
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
			const { root } = buildStationForm(type, SELECTED_FORM[type], GREY);
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

describe("§12.2 — the docked position is inside the drawn recess", () => {
	/** Where the form cuts its aperture, and how far its recess reaches, in km
	 *  from the station's centre. */
	const recessKm = (type: StationType, formId: StationFormId) => {
		const { root } = buildStationForm(type, formId, GREY);
		root.updateMatrixWorld(true);
		const core = STATION_GEOMETRY[type].coreRadiusKm;
		const recess = root.getObjectByName(
			STATION_GEOMETRY[type].aperture.kind === "slot"
				? "aperture-mouth"
				: "aperture-deck",
		) as THREE.Mesh;
		const box = new THREE.Box3().setFromObject(recess);
		return { nearKm: box.max.z * core, farKm: box.min.z * core };
	};
	/**
	 * **Two rules, because E8 makes the presentation two.** A slot swallows the
	 * ship, so the docked position must lie *within* the recess. A pad is an
	 * exterior deck, so the ship sits **at** its face — within ten metres of it,
	 * either side.
	 *
	 * **Either side, and that is not sloppiness.** §12.2 sinks a pad's docked
	 * position "a hair inside the deck" deliberately, because the plane is §3's
	 * evaluation surface and a ship parked exactly on it rests on the boundary
	 * of the surface its own checks are read at. On the shipped refinery that
	 * hair is 3 m, inside a 12 m plate — so the docked position is *below* the
	 * deck's top face by construction, and a rule reading "never below it" would
	 * be a rule this geometry breaks on purpose. The band is what the check can
	 * honestly say: the ship is at the deck rather than somewhere else on the
	 * station.
	 */
	const PAD_MARGIN_KM = 0.01;
	const holdsTheShip = (type: StationType, formId: StationFormId) => {
		const { nearKm, farKm } = recessKm(type, formId);
		const parked = dockedAxialKm(STATION_GEOMETRY[type]);
		return STATION_GEOMETRY[type].aperture.kind === "slot"
			? parked <= nearKm && parked >= farKm
			: parked <= nearKm + PAD_MARGIN_KM && parked >= nearKm - PAD_MARGIN_KM;
	};

	test("the form the game ships parks the ship inside its own recess", () => {
		// **The seam between the two tiers, which nothing had asserted.**
		// `dockedAxialKm` is measured from the **docking plane**, which is
		// `coreRadiusKm`; the recess is cut at the form's own aperture face,
		// wherever its geometry has a surface. They are different quantities and
		// a form may move one without the other — so a form whose face sits well
		// inside the core parks the ship in solid hull, and no test in either
		// tier would have said so.
		// **Every type, the outpost included.** It was excluded until #128,
		// because its selected form cut its deck somewhere other than the plane
		// and the row would have failed on a form no system places. Declaring
		// the plane fixed that at the same time as everything else, so the
		// exclusion is gone rather than carried.
		for (const type of TYPES)
			expect([type, holdsTheShip(type, SELECTED_FORM[type])]).toEqual([
				type,
				true,
			]);
	});

	test("and the alternates that cannot are exactly the known one", () => {
		// **All of them are forms that cut their aperture somewhere other than
		// `aperturePlaneKm`.** Since #128 that is exactly what this row means:
		// the geometry table declares where the plane is, the *selected* form of
		// each role cuts there, and an alternate is free to put its own aperture
		// wherever its silhouette wants — the Ring on a hub at a third of the
		// core radius, the outposts on decks of their own. Those forms cannot
		// hold a ship the checks park by the plane, and selecting one is the
		// change that has to answer for it.
		//
		// The list grew when the plane moved, and one name left it: `outpost a`
		// was on it *and* was its role's selected form, which was only harmless
		// because §12.7's joint 5 records that no outpost is generated. It holds
		// the ship now.
		const cannot: string[] = [];
		for (const type of TYPES)
			for (const form of STATION_FORMS[type])
				if (!holdsTheShip(type, form.id)) cannot.push(`${type} ${form.id}`);
		expect(cannot).toEqual([
			"trade b",
			"trade c",
			"refinery c",
			"outpost b",
			"outpost c",
		]);
	});
});
