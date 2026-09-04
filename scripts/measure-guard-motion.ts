/**
 * Production moving-body cruise corpus.
 *
 * All ship, target and mass states are sampled at frame start. The exact
 * production segment hook supplies continuous linear relative clearance; exact
 * orbital endpoints are checked after the world advances once.
 *
 *   bun run scripts/measure-guard-motion.ts [seeds]
 */
import {
	DEFAULT_CRUISE,
	advanceCruise,
	relativeClosestApproachKm,
	sphereEntry,
	type Mass,
} from "../src/cruise";
import {
	advanceWorldClock,
	bodyAccelerationBound,
	bodyVelocity,
	makeWorld,
	stationHostIdOf,
	type World,
} from "../src/sim";
import { AU_KM, MAX_DT } from "../src/units";
import { add, dot, length, scale, sub, v3, type Vec3 } from "../src/vec3";

const DT = MAX_DT;
const SEEDS = Number(process.argv[2] ?? 200);
const LEG_LIMIT_S = 1200;
const ESCAPE_S = 5;
const ESCAPE_HEADINGS_DEG = [0, 45, 89, 95, 100, 110];

const finite = (label: string, value: number) => {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
};
const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const unit = (value: Vec3) => scale(value, 1 / length(value));

function massesAtFrameStart(world: World): Mass[] {
	return world.system.bodies
		.filter((body) => body.kind === "star" || body.kind === "planet")
		.map((body) => ({
			id: body.id,
			pos: { ...body.pos },
			radiusKm: body.radiusKm,
			vel: bodyVelocity(world.system, body.id, world.gameTime),
			accelerationBoundKms2: bodyAccelerationBound(world.system, body.id),
		}));
}

interface FlightResult {
	exit: "arrival" | "proximity" | "starved" | "timeout";
	bodyId?: string;
	pos: Vec3;
	gameTime: number;
	seconds: number;
	travelledKm: number;
	continuousClearanceKm: number;
}

function fly(
	world: World,
	targetId: string | null,
	fixedNose?: Vec3,
	limitS = LEG_LIMIT_S,
): FlightResult {
	let pos = { ...world.ship.pos };
	let travelledKm = 0;
	let continuousClearanceKm = Number.POSITIVE_INFINITY;
	const startedAt = world.gameTime;
	const farTarget = fixedNose ? add(pos, scale(fixedNose, AU_KM)) : null;
	for (let frame = 0; frame < Math.ceil(limitS / DT); frame++) {
		const masses = massesAtFrameStart(world);
		const target = targetId ? world.system.byId.get(targetId) : null;
		if (targetId && !target) throw new Error(`missing target ${targetId}`);
		const targetMotion = target
			? {
					pos: { ...target.pos },
					radiusKm: target.radiusKm,
					vel: bodyVelocity(world.system, target.id, world.gameTime),
					accelerationBoundKms2: bodyAccelerationBound(world.system, target.id),
				}
			: { pos: farTarget!, radiusKm: 1 };
		const nose = fixedNose ?? unit(sub(targetMotion.pos, pos));
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: DT,
			masses,
			target: targetMotion,
			params: DEFAULT_CRUISE,
			targetParentId: targetId ? stationHostIdOf(world.system, targetId) : null,
			onSegment: (segment) => {
				for (const mass of masses) {
					const centre = add(
						mass.pos,
						scale(mass.vel ?? v3(), segment.elapsed),
					);
					continuousClearanceKm = Math.min(
						continuousClearanceKm,
						relativeClosestApproachKm(
							segment.from,
							segment.velocity,
							segment.duration,
							centre,
							mass.vel ?? v3(),
						) - mass.radiusKm,
					);
				}
			},
		});
		pos = step.pos;
		travelledKm += step.travelledKm;
		advanceWorldClock(world, DT);
		for (const mass of world.system.bodies) {
			if (mass.kind !== "star" && mass.kind !== "planet") continue;
			continuousClearanceKm = Math.min(
				continuousClearanceKm,
				length(sub(pos, mass.pos)) - mass.radiusKm,
			);
		}
		if (step.dropped || step.starved)
			return {
				exit: step.starved ? "starved" : step.exit!,
				bodyId: step.exitBodyId,
				pos,
				gameTime: world.gameTime,
				seconds: world.gameTime - startedAt,
				travelledKm,
				continuousClearanceKm: finite(
					"continuous clearance",
					continuousClearanceKm,
				),
			};
	}
	return {
		exit: "timeout",
		pos,
		gameTime: world.gameTime,
		seconds: world.gameTime - startedAt,
		travelledKm,
		continuousClearanceKm: finite(
			"continuous clearance",
			continuousClearanceKm,
		),
	};
}

function reset(world: World, gameTime: number, pos: Vec3) {
	world.gameTime = gameTime;
	advanceWorldClock(world, 0);
	world.ship.pos = { ...pos };
}

const stats = {
	seeds: SEEDS,
	dt: DT,
	timeline:
		"frame-start ship, target and masses; one clock advance after cruise",
	legs: 0,
	arrivals: 0,
	clearOfHost: 0,
	clearOfHostArrivals: 0,
	occluded: 0,
	occludedArrivals: 0,
	stoppedLegs: 0,
	timeouts: 0,
	retries: 0,
	retryArrivals: 0,
	retryStops: 0,
	escapeSamples: 0,
	stopsWithNoEscape: 0,
	minimumContinuousClearanceKm: Number.POSITIVE_INFINITY,
	minimumRetryClearanceKm: Number.POSITIVE_INFINITY,
	minimumEscapeClearanceKm: Number.POSITIVE_INFINITY,
	medianFlyableEscapeHeadings: 0,
	medianBestEscapeKm: 0,
	medianArrivalSeconds: 0,
};
const flyableHeadingCounts: number[] = [];
const bestEscapeDistances: number[] = [];
const arrivalSeconds: number[] = [];

for (let seed = 1; seed <= SEEDS; seed++) {
	const world = makeWorld(seed);
	const initial = { ...world.ship.pos };
	for (const station of world.system.contents.stations) {
		reset(world, 0, initial);
		const target = world.system.byId.get(station.id)!;
		const hostId = stationHostIdOf(world.system, station.id);
		const host = hostId ? world.system.byId.get(hostId) : undefined;
		const targetLine = sub(target.pos, initial);
		const occluded = host
			? sphereEntry(
					initial,
					unit(targetLine),
					length(targetLine),
					host.pos,
					host.radiusKm,
				) !== null
			: false;
		if (host) {
			if (occluded) stats.occluded++;
			else stats.clearOfHost++;
		}
		const first = fly(world, station.id);
		stats.legs++;
		stats.minimumContinuousClearanceKm = Math.min(
			stats.minimumContinuousClearanceKm,
			first.continuousClearanceKm,
		);
		if (first.exit === "arrival") {
			stats.arrivals++;
			arrivalSeconds.push(first.seconds);
			if (host) {
				if (occluded) stats.occludedArrivals++;
				else stats.clearOfHostArrivals++;
			}
			continue;
		}
		if (first.exit === "timeout") {
			stats.timeouts++;
			continue;
		}
		stats.stoppedLegs++;

		reset(world, first.gameTime, first.pos);
		const retry = fly(world, station.id);
		stats.retries++;
		stats.minimumRetryClearanceKm = Math.min(
			stats.minimumRetryClearanceKm,
			retry.continuousClearanceKm,
		);
		if (retry.exit === "arrival") stats.retryArrivals++;
		if (retry.exit === "proximity") stats.retryStops++;

		reset(world, first.gameTime, first.pos);
		const blocker = first.bodyId
			? world.system.byId.get(first.bodyId)
			: undefined;
		if (!blocker) throw new Error("surface stop without blocker");
		const radial = unit(sub(first.pos, blocker.pos));
		const axis = Math.abs(radial.x) < 0.8 ? v3(1, 0, 0) : v3(0, 1, 0);
		const across = unit(sub(axis, scale(radial, dot(axis, radial))));
		let bestKm = 0;
		let flyable = 0;
		for (const degrees of ESCAPE_HEADINGS_DEG) {
			reset(world, first.gameTime, first.pos);
			const angle = (degrees * Math.PI) / 180;
			const nose = add(
				scale(radial, Math.cos(angle)),
				scale(across, Math.sin(angle)),
			);
			const escape = fly(world, null, nose, ESCAPE_S);
			stats.escapeSamples++;
			stats.minimumEscapeClearanceKm = Math.min(
				stats.minimumEscapeClearanceKm,
				escape.continuousClearanceKm,
			);
			bestKm = Math.max(bestKm, escape.travelledKm);
			if (escape.travelledKm > 100) flyable++;
		}
		if (flyable === 0) stats.stopsWithNoEscape++;
		flyableHeadingCounts.push(flyable);
		bestEscapeDistances.push(bestKm);
	}
}

stats.medianFlyableEscapeHeadings = median(flyableHeadingCounts);
stats.medianBestEscapeKm = median(bestEscapeDistances);
stats.medianArrivalSeconds = median(arrivalSeconds);
for (const [key, value] of Object.entries(stats)) {
	if (typeof value === "number") finite(key, value);
}
await Bun.write(
	new URL("./guard-motion-production-results.json", import.meta.url),
	`${JSON.stringify(stats, null, 2)}\n`,
);
console.log(JSON.stringify(stats));
