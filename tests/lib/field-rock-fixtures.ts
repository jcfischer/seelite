import {
	type FieldPlan,
	fieldRocks,
	type Rock,
	rockPose,
	systemFields,
} from "../../src/asteroid-field";
import { shipPrimitives, reachKm as shipReachKm } from "../../src/collision";
import { archetypePieces, rockFrameAt } from "../../src/field-collision";
import { rockArchetype } from "../../src/field-lod";
import { HULL_SPECS } from "../../src/hull";
import { envelopeAt } from "../../src/rock-pieces";
import {
	flightPerformance,
	makeWorldAtSystem,
	speedDemand,
	stepWorld,
	type World,
} from "../../src/sim";
import { add, scale, sub, v3 } from "../../src/vec3";

export const DT = 0.1;
export const hull = shipPrimitives(HULL_SPECS.miner, false);
export const perf = flightPerformance("miner");
export const HULL_REACH_KM = shipReachKm(hull);
export const attitude = { nose: v3(1, 0, 0), up: v3(0, 0, 1) };

export function fieldWorld() {
	const world = makeWorldAtSystem(47, 0);
	const [plan] = systemFields(world.system.record, world.system.contents);
	const rocks = fieldRocks(world.system.record, plan);
	return { world, plan, rocks };
}

export const biggest = (rocks: Rock[]): Rock =>
	rocks.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));

export function fly(world: World) {
	return stepWorld(
		world,
		{ ...attitude, rates: { pitch: 0, yaw: 0, roll: 0 } },
		{
			stick: { pitch: 0, yaw: 0, roll: 0 },
			turnAssist: false,
			translation: { demand: speedDemand(0), assist: false },
		},
		DT,
		perf,
		hull,
	);
}

export function placeOnFace(
	world: World,
	plan: FieldPlan,
	rock: Rock,
	gapKm: number,
	closingKms: number,
) {
	const pose = rockFrameAt(plan, rock, world.gameTime);
	const e = envelopeAt(archetypePieces(rockArchetype(rock)), v3(0, 0, 1));
	const out = pose.z;
	world.ship.pos = add(pose.origin, scale(out, e * rock.radiusKm + gapKm));
	world.ship.vel = sub(
		rockPose(plan, rock, world.gameTime).vel,
		scale(out, closingKms),
	);
	return { out, pose };
}
