/**
 * The mechanical clutter on a station's plated surfaces — #129, the station
 * half of #102.
 *
 * **What a greeble is for.** The reference frames read as machinery because the
 * small stuff is *where machinery would be*: tanks on a flank, pipe runs along a
 * keel, boxes crowded round a bay mouth. It is not detail for its own sake — it
 * is the only thing at that scale that tells the eye how large the thing behind
 * it is, which is the same argument `shell()` makes for a plate you can judge
 * the size of.
 *
 * **A zone is authored, the fill is generated** (#102 §2). A form declares a
 * patch of its own surface, in its own kilometres, exactly the way it already
 * declares a window run: how many, how big, how far they may stand off, and
 * where the i-th one sits. Everything after that — which primitive, what size,
 * what roll, how deep it sinks — comes from `displayRand`. A generated scatter
 * over the whole hull was the cheaper answer and was declined in #102 for the
 * reason it names: a scatter has no way to know that a station has a *back*.
 *
 * **Three rules bind every zone, and two of them are already tested elsewhere.**
 *
 * 1. **No greeble may be a station's farthest vertex** (#102 §2). Greebles tag
 *    `full`, and `tests/station-visuals.test.ts` asserts the reach is identical
 *    at all three detail levels — so a greeble that carried the outline turns
 *    that equality red. `tests/station-greebles.test.ts` states the same rule
 *    per form, where a failure can name one.
 * 2. **Nothing may stand in the docking corridor.** `station-mesh.test.ts`
 *    already sweeps every vertex of every form, instanced copies included, so a
 *    zone placed across the approach is caught there rather than here.
 * 3. **A greeble is mounted, not floating.** It is sunk into the surface it sits
 *    on by a third of its own height, so a piece reads as bolted to the hull
 *    rather than as debris beside it.
 *
 *    **`station-mesh.test.ts`'s island check does not see this, and an earlier
 *    version of this comment claimed it did.** That check takes one `Box3` per
 *    *object*, and `setFromObject` on an `InstancedMesh` unions every instance —
 *    so one box already spans the hull and it would pass with every individual
 *    piece floating free. The claim was worth exactly as much as the measurement
 *    behind it, which was none. `tests/station-greebles.test.ts` asserts the
 *    thing instead, per instance.
 *
 * **No glass, by construction.** #102 §1's exclusion: a station has no canopy,
 * and every zone here is declared on a plated shell by the builder that made it.
 * There is no scatter to go wrong.
 *
 * One `InstancedMesh` per primitive per station, never one per zone — a station
 * is three draw calls of clutter whatever it declares. That is the whole reason
 * the zones are collected and filled in one pass instead of built where they are
 * written.
 */

import * as THREE from "three";
import { STATION_TYPES, type StationType } from "./station";
import { displayRand } from "./station-surface";
import { STATION_VISUALS } from "./station-visuals";

/**
 * A patch of one form's surface, and how much machinery it wants on it.
 *
 * `count` is the figure the *form* asks for; the role's `greebleDensity`
 * multiplies it. So a form says "this flank is busier than that one" and the
 * profile says how busy the role is overall, and the two questions stay
 * separate — which is what lets the density be settled on a contact sheet by
 * editing one number per role.
 */
export interface GreebleZone {
	/** How many pieces this patch wants, before the role's density figure. */
	count: number;
	/** Typical footprint across the surface, kilometres. */
	sizeKm: number;
	/**
	 * How far a piece may stand off the surface, kilometres.
	 *
	 * The outline budget, in the only units the rule is about. A zone near a
	 * form's outermost structure declares a small one; a zone in a recess can
	 * afford more.
	 */
	reliefKm: number;
	/**
	 * Where the i-th piece sits on the patch, and which way the surface faces
	 * there.
	 *
	 * The same shape as `portRun`'s callback — deliberately, because a builder
	 * writing one has just written the other, and a second convention for "place
	 * the i-th thing on this surface" is a second thing to get wrong. `count` is
	 * passed in rather than closed over so a layout is written against the count
	 * that was actually built, not the one the form asked for.
	 */
	place: (
		i: number,
		count: number,
		position: THREE.Vector3,
		normal: THREE.Vector3,
	) => void;
}

/**
 * The primitive vocabulary: a crate, a tank, a fin.
 *
 * Three rather than #102's "five or six", and the reason is that the shapes are
 * scaled per instance on all three axes. A crate stretched to four times its
 * width is a duct; a tank flattened is a drum; a fin turned is a bracket. What a
 * fourth geometry would add over that is a silhouette the other three cannot
 * make, and none of the obvious candidates — a sphere, a cone — is one a station
 * wants.
 *
 * Built once at module load and shared by every station in the game, so **never
 * mutated** — the same discipline `PANE_GEOMETRY` is under, for the same reason.
 * The tank is built along +Y by three.js and rotated onto +Z here, so every
 * primitive's height is its local z and one orientation serves all three.
 */
const tank = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
tank.rotateX(Math.PI / 2);

export const GREEBLE_PRIMITIVES: readonly THREE.BufferGeometry[] = [
	/** A crate: the plain box, and the one that reads as a housing. */
	new THREE.BoxGeometry(1, 1, 1),
	/** A tank: eight sides, which at these sizes is a cylinder and costs a
	 *  third of the vertices a smooth one would. */
	tank,
	/** A fin: a plate on edge. The one primitive with a thin axis, so a run of
	 *  them reads as ribs rather than as more boxes. */
	new THREE.BoxGeometry(1, 0.16, 1),
];

/**
 * One material per role, from the role's own plating figures.
 *
 * Grey rather than the hull's colour: `station-types.md` §7's colour cue is the
 * *hull*, and clutter painted in it would dilute the one signal a pilot reads a
 * role by at range. Machinery bolted to a painted hull is unpainted, which is
 * both what the reference frames show and what keeps the cue intact.
 *
 * `MeshStandardMaterial`, so the pieces take #99's baked star environment like
 * every other plated thing on the station. Shared per role and never mutated.
 */
const MATERIALS: Record<StationType, THREE.MeshStandardMaterial> =
	// From `STATION_TYPES` and not a list written out here, for the reason every
	// other per-role table in this pass gives: a fifth station type must stop the
	// build rather than reach an `undefined` material and draw nothing. A
	// restated list behind a cast compiles clean and fails at the first station
	// of the new role.
	Object.fromEntries(
		STATION_TYPES.map((type) => [
			type,
			new THREE.MeshStandardMaterial({
				color: 0x6d7681,
				roughness: Math.min(1, STATION_VISUALS[type].plating.roughness + 0.1),
				metalness: STATION_VISUALS[type].plating.metalness,
			}),
		]),
	) as Record<StationType, THREE.MeshStandardMaterial>;

/**
 * How deep a piece sits in the surface it is mounted on, as a fraction of its
 * own height.
 *
 * A third, which does two things at once: it puts the piece's bounding box
 * inside the hull's on every axis, so `station-mesh.test.ts`'s island check sees
 * it as attached rather than as a detached part; and it leaves two thirds
 * standing proud, so the relief a zone declares is the relief the eye reads
 * within a factor the zone can allow for.
 */
const SINK = 1 / 3;

/**
 * Fill a form's zones with clutter — one `InstancedMesh` per primitive.
 *
 * `tag` keys the generator, so it must be unique per form and stable across
 * loads. `displayRand` and not one of `rng.ts`'s streams for the reason that
 * function carries: this is a shape on screen and nothing in the simulation, and
 * drawing it from a world stream would couple a station's clutter to that
 * system's draw counts. The map's per-stream rule is honoured by the tag being
 * its own rather than borrowed — a form that reused another's would silently
 * draw the other's clutter.
 *
 * The returned group is **not** tagged for the detail band here: `detail()` is
 * `station-mesh.ts`'s, and tagging is the caller's act for the same reason the
 * window grid's is.
 */
export function buildGreebles(
	type: StationType,
	tag: string,
	zones: readonly GreebleZone[],
): THREE.Group {
	const random = displayRand(`station-greebles-${tag}`);
	const density = STATION_VISUALS[type].greebleDensity;
	const matrices: THREE.Matrix4[][] = GREEBLE_PRIMITIVES.map(() => []);
	const position = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const roll = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const unitZ = new THREE.Vector3(0, 0, 1);
	for (const zone of zones) {
		// At least one: a zone the density figure rounded to nothing is a zone
		// the form declared and did not get, which reads on the sheet as a
		// generator that stopped working rather than as a dial turned down.
		const count = Math.max(1, Math.round(zone.count * density));
		for (let i = 0; i < count; i++) {
			zone.place(i, count, position, normal);
			normal.normalize();
			// The primitive is drawn from the stream rather than from `i` so a
			// zone does not repeat crate-tank-fin in visible order; a run of ribs
			// is something a zone asks for with a fin-shaped `sizeKm`, not
			// something the index imposes.
			const kind = Math.min(
				GREEBLE_PRIMITIVES.length - 1,
				Math.floor(random() * GREEBLE_PRIMITIVES.length),
			);
			const height = zone.reliefKm * (0.35 + random() * 0.65);
			scale.set(
				zone.sizeKm * (0.5 + random() * 1.1),
				zone.sizeKm * (0.5 + random() * 1.1),
				height,
			);
			quaternion.setFromUnitVectors(unitZ, normal);
			// A roll about the surface normal, so a zone of crates does not read
			// as a grid. Quantised to eighths: machinery is bolted to something,
			// and a free angle reads as debris.
			roll.setFromAxisAngle(
				unitZ,
				(Math.floor(random() * 8) / 8) * Math.PI * 2,
			);
			quaternion.multiply(roll);
			matrices[kind].push(
				new THREE.Matrix4().compose(
					// Sunk by `SINK` of its height, so a third of the piece is
					// inside the surface and the box overlaps the hull's.
					position.clone().addScaledVector(normal, height * (0.5 - SINK)),
					quaternion.clone(),
					scale.clone(),
				),
			);
		}
	}
	const group = new THREE.Group();
	group.name = "greebles";
	GREEBLE_PRIMITIVES.forEach((geometry, kind) => {
		const list = matrices[kind];
		// Built even when empty, so the mesh set is the same shape on every form
		// and a consumer counting them is counting primitives rather than
		// discovering which ones a form happened to draw.
		const mesh = new THREE.InstancedMesh(
			geometry,
			MATERIALS[type],
			list.length,
		);
		mesh.name = `greebles-${kind}`;
		for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i]);
		mesh.instanceMatrix.needsUpdate = true;
		group.add(mesh);
	});
	return group;
}
