/**
 * The firing vents on every hull that is not the player's (node #637).
 *
 * #621 drew plumes on the player's hull alone. Raiders, engaged Traffic and
 * the combat rig's striker step through the same `stepHull`, and each now
 * keeps its last firing table in its own flight state
 * (`CombatEnemyState.firing`); this module draws that table on the hull's
 * mesh. **One `buildVentPlumes` per drawn hull**, a sibling of its mesh in the
 * scene that mesh is in — the hull's layer under #15's distance rule — and
 * moved with it each frame from the mesh's own transform, which the renderer
 * just wrote from the sim. Nothing here reads a position or a level back out
 * of an `Object3D` into the sim.
 *
 * **Built on the first frame a hull fires, not when it is drawn.** Measuring
 * a hull's throats raycasts against its mesh, and most hulls in the band are
 * projected Traffic with no firing table at all. A hull that never fires costs
 * nothing; one that has fired keeps its set until it stops being drawn.
 */

import * as THREE from "three";
import type { HullId } from "./hull";
import type { VentLevels } from "./sim";
import { type VentPlumes, buildVentPlumes } from "./vent-plumes";

const anyFiring = (firing: VentLevels): boolean => {
	for (const level of Object.values(firing)) if ((level ?? 0) > 0) return true;
	return false;
};

/**
 * `buildVentPlumes` for a root that may already be placed. The throats are
 * measured in the root's **own** frame (`ventThroats`), so the transform and
 * the parent are set aside for the measurement and put back after it.
 */
function buildUnplaced(root: THREE.Object3D, hull: HullId): VentPlumes {
	const parent = root.parent;
	const position = root.position.clone();
	const quaternion = root.quaternion.clone();
	const scale = root.scale.clone();
	parent?.remove(root);
	root.position.set(0, 0, 0);
	root.quaternion.identity();
	root.scale.set(1, 1, 1);
	try {
		return buildVentPlumes(root, hull);
	} finally {
		root.position.copy(position);
		root.quaternion.copy(quaternion);
		root.scale.copy(scale);
		parent?.add(root);
		root.updateMatrixWorld(true);
	}
}

export class NpcPlumes {
	private readonly sets = new Map<THREE.Object3D, VentPlumes>();
	private readonly drawn = new Set<THREE.Object3D>();

	/**
	 * Draw `firing` on `root` at game time `t`. Call after the root is placed
	 * for this frame. A root with no parent, or hidden, draws nothing.
	 * Returns how many throats are lit.
	 */
	draw(
		root: THREE.Object3D,
		hull: HullId,
		firing: VentLevels,
		t: number,
	): number {
		let set = this.sets.get(root);
		if (!set) {
			if (!root.parent || !root.visible || !anyFiring(firing)) return 0;
			set = buildUnplaced(root, hull);
			this.sets.set(root, set);
		}
		const object = set.object;
		if (!root.parent || !root.visible) {
			object.removeFromParent();
			return 0;
		}
		if (object.parent !== root.parent) root.parent.add(object);
		object.position.copy(root.position);
		object.quaternion.copy(root.quaternion);
		object.scale.copy(root.scale);
		object.visible = true;
		this.drawn.add(root);
		return set.update(firing, t);
	}

	/** The set drawn on `root`, if it has fired since it was last forgotten. */
	of(root: THREE.Object3D): VentPlumes | undefined {
		return this.sets.get(root);
	}

	/** Drop `root`'s set: its mesh was rebuilt, or it is gone. */
	forget(root: THREE.Object3D): void {
		const set = this.sets.get(root);
		if (!set) return;
		set.object.removeFromParent();
		set.object.geometry.dispose();
		this.sets.delete(root);
	}

	/** End of a frame: every set whose hull was not drawn this frame goes. */
	endFrame(): void {
		for (const root of [...this.sets.keys()])
			if (!this.drawn.has(root)) this.forget(root);
		this.drawn.clear();
	}

	/** How many sets exist now. */
	get size(): number {
		return this.sets.size;
	}
}
