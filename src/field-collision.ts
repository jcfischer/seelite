import {
	type FieldPlan,
	type Rock,
	fieldCells,
	fieldCentre,
	fieldCentreVelocity,
	FIELD_PROFILE,
	fieldRocks,
	rockPose,
	rotateByQuat,
	systemFields,
} from "./asteroid-field";
import {
	IDENTITY_AXES,
	type Pose,
	RESTING_KM,
	type Reach,
	type RockSolid,
	mayMeet,
	solidReach,
} from "./collision";
import { ROCK_ARCHETYPES, rockArchetype } from "./field-lod";
import type { RockHeightfield, RockHeightfields } from "./rock-heightfields";
import { type RockPieces, buildRockPieces } from "./rock-pieces";
import type { System } from "./sim";
import { type Vec3, length, rotateAbout, sub } from "./vec3";

let shapeSource: (() => RockHeightfields) | null = null;
let generation = 0;

/** Register where the authored heightfields come from: the game's `getRockHeightfields`, or a headless reader of the same file. */
export function setRockShapeSource(source: () => RockHeightfields): void {
	shapeSource = source;
	generation++;
	piecesByArchetype.clear();
}

const piecesByArchetype = new Map<number, RockPieces>();

/** A rock archetype's cone pieces and bound tree, built on first use. */
export function archetypePieces(archetype: number): RockPieces {
	let pieces = piecesByArchetype.get(archetype);
	if (!pieces) {
		if (!shapeSource)
			throw new Error(
				"a rock is in reach and no rock shape source is registered (setRockShapeSource)",
			);
		const field = shapeSource().fields[archetype];
		if (!field) throw new Error(`no rock archetype ${archetype}`);
		pieces = buildRockPieces(field, { label: `archetype ${archetype}` });
		piecesByArchetype.set(archetype, pieces);
	}
	return pieces;
}

/**
 * Build every archetype's pieces ahead of flight with `build` (the game's is a
 * Worker, `rockPiecesThread`), one archetype at a time, so the first rock of a
 * kind in reach does not stall its tick and no frame runs a build: a build
 * takes 160–230 ms (sage rounds 1–2 on PR #1110). An archetype a tick needed
 * first is skipped, and a result that lands after `setRockShapeSource` swapped
 * the shapes is dropped.
 */
export async function prebuildRockPieces(
	build: (archetype: number, field: RockHeightfield) => Promise<RockPieces>,
): Promise<void> {
	const source = shapeSource;
	const issued = generation;
	if (!source) throw new Error("no rock shape source is registered");
	for (let archetype = 0; archetype < ROCK_ARCHETYPES; archetype++) {
		if (piecesByArchetype.has(archetype)) continue;
		const field = source().fields[archetype];
		if (!field) throw new Error(`no rock archetype ${archetype}`);
		const pieces = await build(archetype, field);
		if (issued !== generation) return;
		if (!piecesByArchetype.has(archetype))
			piecesByArchetype.set(archetype, pieces);
	}
}

const KEY_OFFSET = 128;
const KEY_WIDTH = 256;
const latticeKey = (i: number, j: number, k: number): number =>
	((i + KEY_OFFSET) * KEY_WIDTH + (j + KEY_OFFSET)) * KEY_WIDTH +
	(k + KEY_OFFSET);

interface FieldLattice {
	readonly plan: FieldPlan;
	readonly cellKm: number;
	readonly extent: readonly [number, number, number];
	readonly byCell: ReadonlyMap<number, Rock>;
}

function buildLattice(system: System, plan: FieldPlan): FieldLattice {
	const profile = FIELD_PROFILE[plan.profile];
	const cells = fieldCells(profile);
	const byCell = new Map<number, Rock>();
	for (const rock of fieldRocks(system.record, plan)) {
		const c = cells[rock.slot];
		byCell.set(
			latticeKey(
				Math.round(c.x / profile.cellKm),
				Math.round(c.y / profile.cellKm),
				Math.round(c.z / profile.cellKm),
			),
			rock,
		);
	}
	const n = (s: number): number => Math.ceil(s / profile.cellKm);
	return {
		plan,
		cellKm: profile.cellKm,
		extent: [n(profile.semiKm[0]), n(profile.semiKm[1]), n(profile.semiKm[2])],
		byCell,
	};
}

function latticeRange(
	lattice: FieldLattice,
	a: Vec3,
	b: Vec3,
	grow: number,
): [number, number][] {
	const half = lattice.cellKm / 2;
	return (["x", "y", "z"] as const).map((axis, n) => [
		Math.max(
			-lattice.extent[n],
			Math.ceil((Math.min(a[axis], b[axis]) - grow - half) / lattice.cellKm),
		),
		Math.min(
			lattice.extent[n],
			Math.floor((Math.max(a[axis], b[axis]) + grow + half) / lattice.cellKm),
		),
	]);
}

interface SystemFields {
	readonly plans: FieldPlan[];
	readonly lattices: Map<string, FieldLattice>;
}

const systems = new WeakMap<System, SystemFields>();

function fieldsOf(system: System): SystemFields {
	let row = systems.get(system);
	if (!row) {
		row = {
			plans: systemFields(system.record, system.contents),
			lattices: new Map(),
		};
		systems.set(system, row);
	}
	return row;
}

const conjugate = (q: FieldPlan["rotation"]): FieldPlan["rotation"] => ({
	x: -q.x,
	y: -q.y,
	z: -q.z,
	w: q.w,
});

function fieldLocal(plan: FieldPlan, p: Vec3, gameTime: number): Vec3 {
	return rotateByQuat(
		conjugate(plan.rotation),
		sub(p, fieldCentre(plan, gameTime)),
	);
}

function rockMotionAt(plan: FieldPlan, rock: Rock, gameTime: number) {
	const pose = rockPose(plan, rock, gameTime);
	const axes = [IDENTITY_AXES.x, IDENTITY_AXES.y, IDENTITY_AXES.z].map((e) =>
		rotateAbout(rotateByQuat(plan.rotation, e), pose.spinAxis, pose.spinAngle),
	);
	return {
		pose: { origin: pose.pos, x: axes[0], y: axes[1], z: axes[2] },
		vel: pose.vel,
	};
}

/** A rock's frame at one instant: the pose `rockSolid` gives either end of a step. */
export const rockFrameAt = (
	plan: FieldPlan,
	rock: Rock,
	gameTime: number,
): Pose => rockMotionAt(plan, rock, gameTime).pose;

/** A rock as a solid across the step: posed from the clock at both ends. */
export function rockSolid(
	plan: FieldPlan,
	rock: Rock,
	clock: { fromTime: number; toTime: number },
): RockSolid {
	const from = rockMotionAt(plan, rock, clock.fromTime);
	const to = rockMotionAt(plan, rock, clock.toTime);
	return {
		kind: "rock",
		pieces: archetypePieces(rockArchetype(rock)),
		radiusKm: rock.radiusKm,
		start: from.pose,
		end: to.pose,
		velStart: from.vel,
		velEnd: to.vel,
	};
}

/**
 * The rocks one ship's step can reach (node #969; #949 D4–D5, #956): their ids
 * (`field-00:rock-17`) and solids, in field and slot order, for `worldSolids`
 * to hand `sweepShip` beside every other solid. `ship` is the ship's bounding
 * sphere at both ends of the step.
 *
 * **Posed from the clock, in the rock's frame.** Each rock is a `RockSolid`
 * posed at both ends of the step by `rockPose` (#43), its velocity the pose's
 * exact derivative, so the closing speed `sweepShip` reads is relative to the
 * rock, spin included (#75).
 *
 * **The reach set is a lattice query.** A rock never leaves its cell
 * (`fieldRocks`: anchor offset plus drift plus half the margin stay inside the
 * cell's inscribed sphere), so the rocks a step can touch are those whose cell
 * lies within the ship's reach of its path. The path is taken into the field
 * frame at both ends, grown by the ship's reach and the field centre's own
 * bend over the step, and turned into a range of lattice indexes; no rock is
 * posed that the range does not name.
 *
 * **The shapes are injected** (`setRockShapeSource`): the authored heightfields
 * arrive through a Vite-only inline import a headless module cannot take. A
 * rock in reach with none registered throws, because a step that skipped the
 * rock would read exactly like a step that missed it.
 */
export function fieldRockSolids(
	system: System,
	ship: Reach,
	clock: { fromTime: number; toTime: number },
): { owner: string[]; motions: RockSolid[] } {
	const owner: string[] = [];
	const motions: RockSolid[] = [];
	const { plans, lattices } = fieldsOf(system);
	const dt = clock.toTime - clock.fromTime;
	for (const plan of plans) {
		const bend =
			(length(
				sub(
					fieldCentreVelocity(plan, clock.toTime),
					fieldCentreVelocity(plan, clock.fromTime),
				),
			) *
				dt) /
			8;
		const grow = ship.reachKm + 2 * RESTING_KM + bend;
		const a = fieldLocal(plan, ship.start, clock.fromTime);
		const b = fieldLocal(plan, ship.end, clock.toTime);
		const bound = FIELD_PROFILE[plan.profile];
		const reach = Math.max(...bound.semiKm) + bound.cellKm + grow;
		if (Math.min(length(a), length(b)) > reach + length(sub(a, b))) continue;
		let lattice = lattices.get(plan.id);
		if (!lattice) {
			lattice = buildLattice(system, plan);
			lattices.set(plan.id, lattice);
		}
		const [[i0, i1], [j0, j1], [k0, k1]] = latticeRange(lattice, a, b, grow);
		for (let i = i0; i <= i1; i++)
			for (let j = j0; j <= j1; j++)
				for (let k = k0; k <= k1; k++) {
					const rock = lattice.byCell.get(latticeKey(i, j, k));
					if (!rock) continue;
					const solid = rockSolid(plan, rock, clock);
					if (
						!mayMeet(ship, {
							start: solid.start.origin,
							end: solid.end.origin,
							reachKm: solidReach(solid),
						})
					)
						continue;
					owner.push(rockId(plan, rock));
					motions.push(solid);
				}
	}
	return { owner, motions };
}

/** A rock's id in a step's impacts and ghosts: its field and its slot. */
export const rockId = (
	plan: Pick<FieldPlan, "id">,
	rock: Pick<Rock, "slot">,
): string => `${plan.id}:rock-${rock.slot}`;
