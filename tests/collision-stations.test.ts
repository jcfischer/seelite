/**
 * `docs/specs/collision.md` §9.1, the rows node #663 owes: stations are solid.
 *
 * - **9.1.2 row 3** — a ship at rest beside a spinning station is struck by
 *   its turning surface at `ω × r`, and only on the face turning into it.
 * - **9.1.4's moving-surface row** — the same with the ship already touching:
 *   a resting pair is billed for a surface that moves in.
 * - **9.1.6** — the earliest event owns the tick, on the trade station's own
 *   rim: a clip before the plane is an impact, a crossing before structure is
 *   the plane's, and a tie is the impact's.
 * - **9.1.7 and 9.1.8** — arrival, parked interval and launch on every role,
 *   for every hull its berths admit: exempt throughout, and what removing the
 *   exemption would do, red build by red build.
 * - **9.1.9's asserted half** — every hull clears every aperture at zero angle,
 *   rolled and unrolled. The table is `scripts/measure-aperture-fit.ts`'s.
 * - **9.1.12's rest** — no cruise exit inside a proxy, and the legs that cross
 *   a non-target station counted with their N.
 * - The wiring: `stepWorld` meets a real station and hands back the plane.
 *
 * The proxy is posed by `stationMotions`, the one posing `stepWorld` uses, so
 * a sign error there fails here rather than in a copy (#25).
 */

import { describe, expect, test } from "bun:test";
import { LAUNCH_CLEAR_HULL_LENGTHS } from "../src/arrival";
import {
	type Impact,
	type Primitive,
	SEPARATION_KM,
	type SolidMotion,
	V_SCRAPE_KMS,
	impactDamage,
	mayMeet,
	pairSeparation,
	reachKm,
	shipPose,
	sweepShip,
} from "../src/collision";
import { DEFAULT_CRUISE, advanceCruise } from "../src/cruise";
import {
	type DockSession,
	berthOf,
	collisionExempt,
	enterArrival,
	interiorOfStation,
	requestLaunch,
	stepDockedWorld,
} from "../src/dock-session";
import {
	type ApertureFrame,
	type EntryPose,
	apertureCrossing,
	apertureFrame,
	slotBasis,
} from "../src/docking";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import {
	type HullAttitude,
	type World,
	advanceWorldClock,
	bodyVelocity,
	flightPerformance,
	jumpWorldTo,
	makeWorld,
	restoreWorld,
	speedDemand,
	stationApertureFrame,
	stationEndAt,
	stationHostIdOf,
	stationOf,
	stationStarts,
	stepWorld,
} from "../src/sim";
import {
	OUTPOST_FORM,
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
	slotPhaseRad,
} from "../src/station";
import {
	BERTH_CELL,
	type StationInterior,
	admittedHulls,
	berthFits,
	interiorAxialSpanKm,
	stationInterior,
} from "../src/station-interior";
import {
	type StationEnd,
	type StationProxy,
	proxyPoses,
	proxyReachKm,
	proxySolids,
	selectedStationProxy,
	stationMotions,
} from "../src/station-proxy";
import { MAX_DT } from "../src/units";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
} from "../src/vec3";
import { hullSolid } from "./helpers/hull-solid";
import { clearsAperture } from "./helpers/aperture-physical-fit";
import {
	FIXTURE_AXIS,
	FIXTURE_REFERENCE,
	flyTheComputer,
} from "./helpers/fly-the-computer";
import { planLabel, stationPlansFor } from "./helpers/station-plan-corpus";

// ---------------------------------------------------------------------------
// A station at rest at the origin, on a deliberately awkward axis
// ---------------------------------------------------------------------------

const frameAt = (type: StationType, rpm: number, t: number): ApertureFrame =>
	apertureFrame(type, FIXTURE_AXIS, slotPhaseRad(rpm, t), FIXTURE_REFERENCE);

const still = (frame: ApertureFrame): StationEnd => ({
	frame,
	origin: v3(),
	vel: v3(),
});

/** A point in the station's spinning frame at phase zero, in the world. */
function local(type: StationType, x: number, y: number, z: number): Vec3 {
	const frame = frameAt(type, 0, 0);
	const { across, up } = slotBasis(frame);
	return add(add(scale(across, x), scale(up, y)), scale(frame.axis, z));
}

/** A ship at rest at `pos`, across one step. */
function atRest(hull: HullId, pos: Vec3, nose: Vec3, up: Vec3): SolidMotion {
	const pose = shipPose(pos, nose, up);
	return {
		primitives: hullSolid(hull),
		start: pose,
		end: pose,
		velStart: v3(),
		velEnd: v3(),
	};
}

// ---------------------------------------------------------------------------
// 9.1.2 row 3 and 9.1.4's moving surface: the turning face
// ---------------------------------------------------------------------------

/**
 * The trade Coriolis's fourth arm — the box out to 0.5 km along the spinning
 * frame's `x` that carries the dishes — has a face at `y = ±0.25` beyond the
 * jack's own arms. Turning positively about the axis (the phase grows with
 * time), a point on the `+y` face at `x` moves along `+y` at `ω · x`, toward a
 * ship holding above it; the `−y` face moves away. The ship lies flat on the
 * face — up along `y`, nose along the axis — at `x = 0.45`, so its box spans
 * the face from 0.424 to 0.476 km out.
 */
const TURN_RPM = 3;
const OMEGA = (2 * Math.PI * TURN_RPM) / 60;
const FACE_Y = 0.25;
const SHIP_X = 0.45;
const TURN_HULL: HullId = "courier";

/** The ship's centre above the `side` face of the arm, its box `gapKm` clear. */
function overArm(side: 1 | -1, gapKm: number) {
	const { env, envCentre } = HULL_SPECS[TURN_HULL];
	// The box's extent along the face normal, from the ship's origin.
	const under = env.heightKm / 2 - side * envCentre.upKm;
	const frame = frameAt("trade", 0, 0);
	const { up } = slotBasis(frame);
	return {
		pos: local("trade", SHIP_X, side * (FACE_Y + under + gapKm), 0),
		nose: frame.axis,
		up: scale(up, side),
		normal: scale(up, side),
	};
}

/** `ω · x` over the span of the ship's box: the closing speeds a point of the
 *  face under it can have. */
const closingBand = (): [number, number] => {
	const half = HULL_SPECS[TURN_HULL].env.beamKm / 2;
	return [OMEGA * (SHIP_X - half), OMEGA * (SHIP_X + half)];
};

function turnInto(side: 1 | -1, gapKm: number, rpm = TURN_RPM) {
	const at = overArm(side, gapKm);
	const proxy = selectedStationProxy({
		type: "trade",
		formId: "a",
		berthSeed: 0,
		assemblySeed: 0,
	});
	return {
		at,
		swept: sweepShip(
			atRest(TURN_HULL, at.pos, at.nose, at.up),
			stationMotions(
				proxy,
				still(frameAt("trade", rpm, 0)),
				still(frameAt("trade", rpm, MAX_DT)),
			),
			MAX_DT,
		),
	};
}

describe("collision.md §9.1.2 row 3: a spinning station's surface meets a ship at ω × r", () => {
	test("a ship at rest above the face turning into it is struck at ω · x", () => {
		const { at, swept } = turnInto(1, 0.003);
		const [lo, hi] = closingBand();
		expect(swept.impacts).toHaveLength(1);
		const [impact] = swept.impacts;
		expect(impact.resting).toBe(false);
		expect(impact.closingKms).toBeGreaterThan(lo * 0.98);
		expect(impact.closingKms).toBeLessThan(hi * 1.02);
		// Above the scrape, so the turn costs something: 0.13–0.15 km/s
		// against V_SCRAPE's 0.05.
		expect(impact.closingKms).toBeGreaterThan(V_SCRAPE_KMS);
		expect(impact.damage).toBe(impactDamage(impact.closingKms));
		expect(dot(impact.normal, at.normal)).toBeGreaterThan(0.99);
	});

	test("the face turning away from a ship never meets it: the sign is the spin's", () => {
		// A posing with the phase mis-signed turns the `−y` face into this ship
		// and the `+y` face away from the last one, so it fails both rows.
		const { swept } = turnInto(-1, 0.003);
		expect(swept.impacts).toEqual([]);
	});

	test("the control: with the spin stopped, the same ship is never met", () => {
		const { swept } = turnInto(1, 0.003, 0);
		expect(swept.impacts).toEqual([]);
		expect(swept.ghosts).toEqual([]);
	});

	test("the shipyard's keel does not turn with its drum: a ship beside a boom is never met", () => {
		// The boom stands outboard of the bay at y 0.37–0.58 km in the static
		// frame. A ship holds beside each of its x faces for two seconds while
		// the drum turns at 3 rpm. A keel posed in the spinning frame sweeps a
		// boom 0.15 km in that time — the arm below builds exactly that.
		const proxy = selectedStationProxy({
			type: "shipyard",
			formId: "a",
			berthSeed: 0,
			assemblySeed: 0,
		});
		const { env, envCentre } = HULL_SPECS[TURN_HULL];
		const frame = frameAt("shipyard", 0, 0);
		const { up } = slotBasis(frame);
		const ships = [1, -1].map((side) => {
			const out = 0.24 + env.beamKm / 2 + Math.abs(envCentre.rightKm) + 0.002;
			return {
				pos: local("shipyard", side * out, 0.47, 0.2),
				nose: frame.axis,
				up,
			};
		});
		const steps = Math.round(2 / MAX_DT);
		const run = (wrongFrame: boolean) => {
			let met = 0;
			for (const ship of ships) {
				for (let i = 0; i < steps; i++) {
					const start = still(frameAt("shipyard", TURN_RPM, i * MAX_DT));
					const end = still(frameAt("shipyard", TURN_RPM, (i + 1) * MAX_DT));
					const solids = stationMotions(proxy, start, end);
					if (wrongFrame) {
						// The red build: the keel posed as if it spun.
						const from = proxyPoses(start.frame, start.origin);
						const to = proxyPoses(end.frame, end.origin);
						solids[1] = {
							...solids[1],
							start: from.spinning,
							end: to.spinning,
						};
					}
					const swept = sweepShip(
						atRest(TURN_HULL, ship.pos, ship.nose, ship.up),
						solids,
						MAX_DT,
					);
					met += swept.impacts.length + swept.ghosts.length;
				}
			}
			return met;
		};
		expect(proxySolids(proxy).static.length).toBeGreaterThan(0);
		expect(run(false)).toBe(0);
		expect(run(true)).toBeGreaterThan(0);
	});
});

describe("collision.md §9.1.4: a moving surface is billed against a resting ship", () => {
	test("a ship touching a station face while it turns in takes §3's damage at ω × r, and ends outside", () => {
		const { at, swept } = turnInto(1, SEPARATION_KM);
		const [lo, hi] = closingBand();
		expect(swept.impacts.length).toBeGreaterThan(0);
		const [impact] = swept.impacts;
		expect(impact.resting).toBe(true);
		expect(impact.closingKms).toBeGreaterThan(lo * 0.98);
		expect(impact.closingKms).toBeLessThan(hi * 1.02);
		expect(impact.damage).toBeGreaterThan(0);
		expect(impact.damage).toBe(impactDamage(impact.closingKms));
		// Outside every primitive at the end of the step, where the station
		// has turned to.
		const proxy = selectedStationProxy({
			type: "trade",
			formId: "a",
			berthSeed: 0,
			assemblySeed: 0,
		});
		const end = proxyPoses(frameAt("trade", TURN_RPM, MAX_DT), v3());
		const ship = shipPose(swept.pos, at.nose, at.up);
		for (const primitive of proxySolids(proxy).spinning)
			expect(
				pairSeparation(hullSolid(TURN_HULL)[0], ship, primitive, end.spinning)
					.overlap,
			).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 9.1.6: the earliest event owns the tick, on the trade station's own rim
// ---------------------------------------------------------------------------

describe("collision.md §9.1.6: the earliest impact owns the tick (C3)", () => {
	const type: StationType = "trade";
	const hull: HullId = "courier";
	const frame = frameAt(type, 0, 0);
	const { up } = slotBasis(frame);
	const nose = scale(frame.axis, -1);
	// The Coriolis by name, not `formsInPlay(type)[0]`: the wing below is
	// placed over this form's coaming, so a row that followed the pool would
	// fly these offsets past another form's rim the day the pool's first
	// member changed. Its proxy exists whether or not a pool holds it
	// (node #717).
	const proxy = selectedStationProxy({
		type,
		formId: "a",
		berthSeed: 0,
		assemblySeed: 0,
	});
	const solids = stationMotions(proxy, still(frame), still(frame));

	/** One tick from `z0` to `z1` along the axis at lateral `x`, with the
	 *  plane's time found by the game's predicate. */
	function tick(x: number, z0: number, z1: number, planeS?: number | null) {
		const from = local(type, x, 0, z0);
		const to = local(type, x, 0, z1);
		const vel = scale(sub(to, from), 1 / MAX_DT);
		const pose = (rel: Vec3): EntryPose => ({ rel, vRel: vel, nose, up });
		const found = apertureCrossing(
			frame,
			pose(from),
			pose(to),
			STATION_GEOMETRY[type].coreRadiusKm,
		);
		const swept = sweepShip(
			{
				primitives: hullSolid(hull),
				start: shipPose(from, nose, up),
				end: shipPose(to, nose, up),
				velStart: vel,
				velEnd: vel,
			},
			solids,
			MAX_DT,
			{
				planeS:
					planeS !== undefined
						? planeS
						: found
							? found.fraction * MAX_DT
							: null,
			},
		);
		return { found, swept };
	}

	// The wing: the centre 50 m off the axis, inside the slot's 60 m half // glossary-ignore: slot
	// width, so the courier's 25.6 m half beam stands over the coaming.
	const WING_X = 0.05;
	const plane = frame.planeKm;

	test("a hull that clips the rim and would then cross the plane inside the rectangle is an impact", () => {
		const { found, swept } = tick(WING_X, plane + 0.12, plane - 0.03);
		// The crossing is real and inside the rectangle: check 5 would pass it.
		expect(found).not.toBeNull();
		expect(swept.planeOwns).toBe(false);
		expect(swept.impacts).toHaveLength(1);
		expect((swept.impacts[0] as Impact).timeS).toBeLessThan(
			(found?.fraction ?? 0) * MAX_DT,
		);
	});

	test("a hull that crosses the plane first and would meet the bay's back wall later runs the checks", () => {
		const interior = stationInterior(type, plane, 0);
		const [back] = interiorAxialSpanKm(interior);
		const z1 = back + 0.01;
		// The control: unwatched, the same tick meets the back wall.
		const blind = tick(0, plane + 0.01, z1, null);
		expect(blind.swept.impacts.length).toBeGreaterThan(0);
		const { found, swept } = tick(0, plane + 0.01, z1);
		expect(found).not.toBeNull();
		expect(swept.planeOwns).toBe(true);
		expect(swept.impacts).toEqual([]);
	});

	test("an exact tie is the impact's", () => {
		const blind = tick(WING_X, plane + 0.12, plane - 0.03, null);
		const at = (blind.swept.impacts[0] as Impact).timeS;
		const tie = tick(WING_X, plane + 0.12, plane - 0.03, at);
		expect(tie.swept.planeOwns).toBe(false);
		expect(tie.swept.impacts).toHaveLength(1);
		// And a hair earlier, the plane's.
		const before = tick(WING_X, plane + 0.12, plane - 0.03, at - 1e-9);
		expect(before.swept.planeOwns).toBe(true);
		expect(before.swept.impacts).toEqual([]);
	});

	test("thrust into a resting rim cannot hand an unreachable crossing to the plane", () => {
		const box: Primitive = {
			kind: "box",
			centre: v3(),
			axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
			half: [0.01, 0.01, 0.01],
		};
		const start = shipPose(
			v3(0, 0, 0.02 + SEPARATION_KM),
			v3(0, 0, -1),
			v3(0, 1, 0),
		);
		const rim: SolidMotion = {
			primitives: [{ ...box, half: [1, 1, 0.01] }],
			start: shipPose(v3(), v3(0, 0, 1), v3(0, 1, 0)),
			end: shipPose(v3(), v3(0, 0, 1), v3(0, 1, 0)),
			velStart: v3(),
			velEnd: v3(),
		};
		const thrust = sweepShip(
			{
				primitives: [box],
				start,
				end: shipPose(v3(0, 0, -0.02), start.z, start.y),
				velStart: v3(),
				velEnd: v3(0, 0, -0.4),
			},
			[rim],
			MAX_DT,
			{ planeS: MAX_DT / 2 },
		);
		expect(thrust.planeOwns).toBe(false);
		expect(thrust.pos.z).toBeGreaterThanOrEqual(start.origin.z - 1e-9);
		expect(thrust.impacts.every((impact) => impact.damage === 0)).toBe(true);
		const away = sweepShip(
			{
				primitives: [box],
				start,
				end: shipPose(v3(0, 0, 0.1), start.z, start.y),
				velStart: v3(0, 0, 0.4),
				velEnd: v3(0, 0, 0.4),
			},
			[rim],
			MAX_DT,
			{ planeS: MAX_DT / 2 },
		);
		expect(away.planeOwns).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 9.1.7 and 9.1.8: arrival, parked and launch, flown on every role
// ---------------------------------------------------------------------------

/** A start system holding a station of `type`. The outpost stands only in a
 *  lawless system and its berth is closed until it has a market (node #491,
 *  `station-types.md` §5.5), so it is a refinery re-typed: the two share their
 *  axis rule (`outward`) and neither spins, so the traversal is the outpost's
 *  own. */
function worldWith(type: StationType): { world: World; id: string } {
	const want = type === "outpost" ? "refinery" : type;
	for (let seed = 1; seed < 400; seed++) {
		const world = makeWorld(seed);
		const station = world.system.contents.stations.find(
			(s) =>
				s.type === want && (s.spinRpm > 0 || !STATION_GEOMETRY[want].spins),
		);
		if (!station || !world.system.byId.has(station.id)) continue;
		// Re-typed whole: an outpost is built in its own form (node #717), and a
		// refinery's form kept under the outpost's type has no proxy.
		if (type === "outpost") {
			station.type = "outpost";
			station.formId = OUTPOST_FORM;
		}
		return { world, id: station.id };
	}
	throw new Error(`no start system with a ${type} in 400 seeds`);
}

/** One tick of a session that is not flying, as the sweep needs it. */
interface DockTick {
	phase: DockSession["phase"];
	ship: SolidMotion;
	station: [StationEnd, StationEnd];
}

const DOCK_DT = 1 / 30;
const PARK_S = 3;
const AFTER_RELEASE_S = 3;

/** Coast with no pilot demand in the station's accelerating frame. */
function handsOff(world: World, id: string, t: number, assist: boolean) {
	return {
		stick: { pitch: 0, yaw: 0, roll: 0 },
		turnAssist: true,
		translation: {
			demand: speedDemand(0),
			assist,
			frame: {
				start: bodyVelocity(world.system, id, t),
				end: bodyVelocity(world.system, id, t + DOCK_DT),
			},
		},
	};
}

interface Traversal {
	ticks: DockTick[];
	released: boolean;
	/** After the release, flown by `stepWorld` with collision live. */
	afterRelease: { impacts: number; ghostSteps: number; steps: number };
}

/**
 * Arrive at `berthId` from a centred crossing, park, launch and fly clear:
 * the game's own `enterArrival`, `stepDockedWorld` and `requestLaunch`, and
 * after the release `stepWorld` with the hull's solid — the path a launch
 * hands back to.
 */
function traverse(type: StationType, hull: HullId, berthId: string): Traversal {
	const { world, id } = worldWith(type);
	const station = stationOf(world.system, id);
	const interior: StationInterior = interiorOfStation(station);
	const berth = berthOf(interior, berthId);
	const frame = stationApertureFrame(world.system, id, world.gameTime);
	const { up } = slotBasis(frame);
	const nose = scale(frame.axis, -1);
	const body = world.system.byId.get(id);
	if (!body) throw new Error(`no body ${id}`);
	let session = enterArrival(
		id,
		frame,
		interior,
		berth,
		scale(frame.axis, frame.planeKm),
		{ nose, up },
		world.gameTime,
	);
	let ship = {
		pos: add(body.pos, scale(frame.axis, frame.planeKm)),
		vel: bodyVelocity(world.system, id, world.gameTime),
		nose,
		up,
	};
	const ticks: DockTick[] = [];
	let parkedFor = 0;
	let released = false;
	for (let i = 0; i < 4000 && !released; i++) {
		const start = stationEndAt(world.system, id, world.gameTime);
		const phase = session.phase;
		const out = stepDockedWorld(world, session, DOCK_DT, interior);
		if (!out.ship) throw new Error(`no placement in ${phase}`);
		ticks.push({
			phase,
			ship: {
				primitives: hullSolid(hull),
				start: shipPose(ship.pos, ship.nose, ship.up),
				end: shipPose(out.ship.pos, out.ship.nose, out.ship.up),
				velStart: ship.vel,
				velEnd: out.ship.vel,
			},
			station: [start, stationEndAt(world.system, id, world.gameTime)],
		});
		ship = out.ship;
		session = out.session;
		if (session.phase === "docked") {
			parkedFor += DOCK_DT;
			if (parkedFor >= PARK_S)
				session = requestLaunch(
					session,
					stationApertureFrame(world.system, id, world.gameTime),
					interior,
					world.gameTime,
					LAUNCH_CLEAR_HULL_LENGTHS * HULL_SPECS[hull].env.lengthKm,
				);
		}
		released = phase === "launching" && session.phase === "flying";
	}
	// Released: the ship flies again, collidable, and holds the station's
	// frame with its hands off — the launch's §4.3 case.
	world.ship.pos = ship.pos;
	world.ship.vel = ship.vel;
	let at: HullAttitude = {
		nose: ship.nose,
		up: ship.up,
		rates: { pitch: 0, yaw: 0, roll: 0 },
	};
	const after = { impacts: 0, ghostSteps: 0, steps: 0 };
	for (let i = 0; released && i < AFTER_RELEASE_S / DOCK_DT; i++) {
		const t = world.gameTime;
		const step = stepWorld(
			world,
			at,
			handsOff(world, id, t, true),
			DOCK_DT,
			flightPerformance(hull),
			hullSolid(hull),
		);
		at = { nose: step.nose, up: step.up, rates: step.rates };
		after.impacts += step.impacts.length;
		if (step.ghosts.length > 0) after.ghostSteps++;
		after.steps++;
	}
	return { ticks, released, afterRelease: after };
}

/** What the ticks meet with no exemption: each swept on its own against
 *  `proxy`, nothing applied — the measurement, not a flight. */
function withoutExemption(t: Traversal, proxy: StationProxy) {
	let impacts = 0;
	let ghosts = 0;
	const impactPhases = new Set<string>();
	for (const tick of t.ticks) {
		const swept = sweepShip(
			tick.ship,
			stationMotions(proxy, tick.station[0], tick.station[1]),
			DOCK_DT,
		);
		impacts += swept.impacts.length;
		if (swept.ghosts.length > 0) ghosts++;
		if (swept.impacts.length > 0) impactPhases.add(tick.phase);
	}
	return { impacts, ghosts, impactPhases: [...impactPhases].sort() };
}

/**
 * The slot's red build: the bay closed by a bulkhead across it, halfway from // glossary-ignore: slot
 * the mouth to the staging point every route passes — a thin box in the // glossary-ignore: Staging point
 * spinning frame, added to the shipped proxy rather than edited into it.
 */
function closedBay(type: StationType, proxy: StationProxy): StationProxy {
	const interior = stationInterior(
		type,
		STATION_GEOMETRY[type].aperturePlaneKm,
		0,
	);
	const z = (interior.mouthAxialKm + interior.stagingAxialKm) / 2;
	return {
		...proxy,
		spinning: [
			...proxy.spinning,
			{
				kind: "box",
				cx: 0,
				cy: 0,
				cz: z,
				hx: interior.halfAcrossKm,
				hy: interior.halfUpKm,
				hz: 0.0025,
			},
		],
	};
}

/** Each admitted hull flies one berth, the catalogue walked round the roster
 *  so every berth of the role is flown by some hull. */
function cases(type: StationType): { hull: HullId; berthId: string }[] {
	const interior = stationInterior(
		type,
		STATION_GEOMETRY[type].aperturePlaneKm,
		0,
	);
	return admittedHulls(type).map((hull, i) => {
		const fits = interior.berths.filter((b) =>
			berthFits(b, HULL_SPECS[hull].env),
		);
		return { hull, berthId: fits[i % fits.length].id };
	});
}

const TRAVERSAL_MS = 60_000;

/**
 * How far a hull's box, carried about its measured centre (`envCentre`,
 * §9.1.10), stands outside the berth cell it parks in, km — the worst axis.
 * `berthFits` compares the envelope's size with the cell's and places the
 * ship's **origin** at the cell's centre (`berthCentre`), so a box offset
 * from its origin can fit by size and still overhang the cell by the offset.
 */
function berthOvershootKm(hull: HullId, type: StationType): number {
	const { env, envCentre } = HULL_SPECS[hull];
	const cell = BERTH_CELL[type];
	return Math.max(
		env.lengthKm / 2 + Math.abs(envCentre.foreKm) - cell.lengthKm / 2,
		env.beamKm / 2 + Math.abs(envCentre.rightKm) - cell.beamKm / 2,
		env.heightKm / 2 + Math.abs(envCentre.upKm) - cell.heightKm / 2,
	);
}

describe("collision.md §9.1.7, §9.1.8: arrival, parked and launch on every role", () => {
	for (const type of STATION_TYPES) {
		const kind = STATION_GEOMETRY[type].aperture.kind;
		test(
			`${type} (${kind}): exempt throughout, and a launch flies out with no impact`,
			() => {
				const rows: string[] = [];
				for (const { hull, berthId } of cases(type)) {
					const t = traverse(type, hull, berthId);
					const phases = new Set(t.ticks.map((tick) => tick.phase));
					expect({ hull, released: t.released }).toEqual({
						hull,
						released: true,
					});
					// All three of §12.3's states were flown, and every tick of
					// them was exempt — so the game hands `stepWorld` no solid.
					expect([...phases].sort()).toEqual([
						"arriving",
						"docked",
						"launching",
					]);
					expect(
						t.ticks.filter((tick) => !collisionExempt(tick.phase)),
					).toEqual([]);
					// §9.1.7: the launch ends flying, collidable, and meets nothing.
					expect({ hull, impacts: t.afterRelease.impacts }).toEqual({
						hull,
						impacts: 0,
					});
					expect({ hull, ghostSteps: t.afterRelease.ghostSteps }).toEqual({
						hull,
						ghostSteps: 0,
					});
					expect({ hull, steps: t.afterRelease.steps }).toEqual({
						hull,
						steps: 90,
					});
					rows.push(
						`${type.padEnd(8)} ${hull.padEnd(11)} ${berthId.padEnd(16)} ` +
							`launch end: ${t.afterRelease.ghostSteps} ghost steps of ${t.afterRelease.steps}`,
					);
				}
				for (const row of rows) console.log(row);
			},
			TRAVERSAL_MS,
		);

		test(
			`${type} (${kind}): what removing the exemption does — and its red build`,
			() => {
				const { world, id } = worldWith(type);
				const shipped = selectedStationProxy(stationOf(world.system, id));
				for (const { hull, berthId } of cases(type)) {
					const t = traverse(type, hull, berthId);
					const bare = withoutExemption(t, shipped);
					if (kind === "pad") {
						// glossary-ignore: pad
						// The deck and its berths are solid: unexempt, the settle
						// onto the berth and the lift off it meet them — swept
						// impacts, not only a parked ship's overlap.
						expect({ hull, met: bare.impacts > 0 }).toEqual({
							hull,
							met: true,
						});
						continue;
					}
					// A slot's bay is open in the proxy, so the traversal's swept // glossary-ignore: slot
					// box stays inside the open volume: nothing met, nothing
					// overlapped. Not a pass of the exemption — a check that the
					// exemption is defence in depth here, as check 5 is.
					//
					// **Except a hull whose box overhangs its berth cell**, which
					// parks with its box through the wall the cell stands on — the
					// row below pins which hulls those are.
					if (berthOvershootKm(hull, type) > 0) {
						expect({ hull, met: bare.impacts + bare.ghosts > 0 }).toEqual({
							hull,
							met: true,
						});
					} else {
						expect({ hull, ...bare }).toEqual({
							hull,
							impacts: 0,
							ghosts: 0,
							impactPhases: [],
						});
					}
					// The red build: close the bay, and the same traversal meets it.
					const red = withoutExemption(t, closedBay(type, shipped));
					expect({ hull, met: red.impacts > 0 }).toEqual({
						hull,
						met: true,
					});
				}
			},
			TRAVERSAL_MS,
		);
	}
});

describe("collision.md §9.1.8: what the open bay does not cover — a box that overhangs its berth", () => {
	test("two hulls' boxes overhang a slot's berth cell: the miner by 2.8 m, the explorer by 0.6 m", () => {
		// glossary-ignore: slot
		// A finding, handed on (`collision.md` §11): the berth places the
		// ship's origin, not its box, so the miner — 33.2 m tall about a centre
		// 6.2 m below its origin, in a 40 m cell — parks 2.8 m into the wall its
		// berth stands on, and the explorer, 39.7 m tall about a centre 0.8 m
		// off, 0.6 m. Arrival, parking and launch are exempt, so nothing is met;
		// unexempt, the traversal above meets the wall. The fix is the berth
		// placement's (carry `envCentre`), not the proxy's. This row is the
		// tripwire: another hull, or the fix, changes it.
		const over: string[] = [];
		for (const type of STATION_TYPES) {
			if (STATION_GEOMETRY[type].aperture.kind !== "slot") continue; // glossary-ignore: slot
			for (const hull of admittedHulls(type)) {
				const km = berthOvershootKm(hull, type);
				if (km > 0) over.push(`${type}:${hull}:${(km * 1000).toFixed(1)} m`);
			}
		}
		console.log(`overhanging a slot's berth cell: ${over.join(", ")}`); // glossary-ignore: slot
		expect(over).toEqual([
			"trade:miner:2.8 m",
			"trade:explorer:0.6 m",
			"shipyard:miner:2.8 m",
			"shipyard:explorer:0.6 m",
		]);
	});
});

// ---------------------------------------------------------------------------
// 9.1.9's asserted half: every hull clears every aperture at zero angle
// ---------------------------------------------------------------------------

describe("collision.md §9.1.9: the aperture is a physical fit (P1)", () => {
	for (const type of STATION_TYPES) {
		test(`every hull ${type} admits clears it centred, square and at check 4's 50° roll`, () => {
			const misses: string[] = [];
			for (const hull of admittedHulls(type))
				for (const seeds of stationPlansFor(type))
					for (const rollDeg of [0, 50])
						if (
							!clearsAperture(
								type,
								hull,
								{ pitchDeg: 0, yawDeg: 0, rollDeg },
								seeds,
							)
						)
							misses.push(`${hull} at ${rollDeg}°: ${planLabel(seeds)}`);
			expect(misses).toEqual([]);
		});
	}

	test("the fit can go red: a hull flown in off the axis meets the rim", () => {
		// Pitched past what the miner clears at the roll limit, its box meets
		// the coaming. The table (`scripts/measure-aperture-fit.ts`) is where
		// each hull's margin is printed for the principal.
		expect(
			clearsAperture(
				"trade",
				"miner",
				{
					pitchDeg: 35,
					yawDeg: 0,
					rollDeg: 50,
				},
				{ formId: "a", berthSeed: 1, assemblySeed: 0 },
			),
		).toBe(false);
	});
});

describe("collision.md §9.1.9 and §9.1.15: seeded pad plans", () => {
	for (const type of ["refinery", "outpost"] as const) {
		const plans = stationPlansFor(type);
		test(`${type}: every admitted hull clears and docks across ${plans.length} plans`, () => {
			const misses: string[] = [];
			for (const seeds of plans) {
				for (const hull of admittedHulls(type)) {
					const label = `${type}:${hull}:${planLabel(seeds)}`;
					for (const rollDeg of [0, 50])
						for (const [pitchDeg, yawDeg] of [
							[0, 0],
							[35, 0],
							[-35, 0],
							[0, 35],
							[0, -35],
						])
							if (
								!clearsAperture(
									type,
									hull,
									{ pitchDeg, yawDeg, rollDeg },
									seeds,
								)
							)
								misses.push(
									`${label}: pitch ${pitchDeg}, yaw ${yawDeg}, roll ${rollDeg}`,
								);
					const run = flyTheComputer({
						type,
						hull,
						spinRpm: 0,
						axis: FIXTURE_AXIS,
						reference: FIXTURE_REFERENCE,
						stationSeeds: seeds,
					});
					if (
						!run.docked ||
						run.violations ||
						run.refused ||
						run.impacts.length ||
						run.ghostSteps ||
						run.steps <= 50
					)
						misses.push(`${label}: ${JSON.stringify(run)}`);
				}
			}
			console.log(
				`seeded ${type}: ${plans.length} plans × ${admittedHulls(type).length} admitted hulls; ${misses.length} failures`,
			);
			expect(misses).toEqual([]);
		}, 60_000);
	}
});

// ---------------------------------------------------------------------------
// 9.1.12's rest: cruise never leaves a ship inside a proxy
// ---------------------------------------------------------------------------

/** `scripts/measure-cruise-arrival.ts`'s full default corpus: the arrival point
 *  to every station in the start systems of seeds 1–200. */
const CRUISE_SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const PLACEMENT_SEEDS = CRUISE_SEEDS.slice(0, 40);
const CRUISE_TIMEOUT_S = 600;

/** Count placements against the actual proxy, including the static keel. */
function overlapsStation(
	world: World,
	hull: HullId,
	nose: Vec3,
	up: Vec3,
): boolean {
	const box = hullSolid(hull)[0];
	const ship = shipPose(world.ship.pos, nose, up);
	return world.system.contents.stations.some((station) => {
		const body = world.system.byId.get(station.id);
		if (!body) return false;
		const proxy = selectedStationProxy(station);
		if (
			length(sub(world.ship.pos, body.pos)) >
			proxyReachKm(proxy) + reachKm([box])
		)
			return false;
		const end = stationEndAt(world.system, station.id, world.gameTime);
		return stationMotions(proxy, end, end).some((solid) =>
			solid.primitives.some(
				(p) => pairSeparation(box, ship, p, solid.start).overlap,
			),
		);
	});
}

describe("collision.md §9.1.7: placement paths are counted", () => {
	test("spawn, hyperspace arrival and restore fallback start outside station proxies", () => {
		// glossary-ignore: Spawn
		const counts = {
			spawn: { N: 0, inside: 0 }, // glossary-ignore: Spawn
			hyperspace: { N: 0, inside: 0 },
			restoreFallback: { N: 0, inside: 0 },
		};
		const count = (world: World, row: { N: number; inside: number }) => {
			// World stores position, not attitude. Reconstruct Game.faceTheStar
			// and face's +Y-up lookAt; fresh, jumped and fallback-restore Games
			// use this pose. Saved flight attitudes are covered separately below.
			const nose = scale(world.ship.pos, -1 / length(world.ship.pos));
			const right = cross(nose, v3(0, 1, 0));
			const up = cross(scale(right, 1 / length(right)), nose);
			for (const hull of HULL_IDS) {
				row.N++;
				if (overlapsStation(world, hull, nose, up)) row.inside++;
				// A second, conservative check bounds the box at ANY attitude,
				// including the capitals: every primitive is inside proxyReachKm,
				// and the ship's measured offset is inside its hull reach.
				for (const station of world.system.contents.stations) {
					const body = world.system.byId.get(station.id);
					if (!body) throw new Error(`unplaced ${station.id}`);
					expect(length(sub(world.ship.pos, body.pos))).toBeGreaterThan(
						proxyReachKm(selectedStationProxy(station)) +
							reachKm(hullSolid(hull)),
					);
				}
			}
		};
		for (const seed of PLACEMENT_SEEDS) {
			const world = makeWorld(seed);
			count(world, counts.spawn);
			// Exercise the real inbound-bearing path at a nonzero clock.
			advanceWorldClock(world, 120);
			const target = world.galaxy.systems.find(
				(s) => s.index !== world.system.record.index,
			);
			if (!target) throw new Error("no hyperspace target");
			jumpWorldTo(world, target);
			count(world, counts.hyperspace);
			const restored = restoreWorld(
				seed,
				world.galaxy.index,
				target.index,
				world.gameTime,
			);
			count(restored, counts.restoreFallback);
		}
		console.log(
			`station placement census: ${JSON.stringify(counts)}; launch counted per hull above; cruise counted below`,
		);
		expect(counts).toEqual({
			spawn: { N: 40 * HULL_IDS.length, inside: 0 }, // glossary-ignore: Spawn
			hyperspace: { N: 40 * HULL_IDS.length, inside: 0 },
			restoreFallback: { N: 40 * HULL_IDS.length, inside: 0 },
		});
	});

	test("a saved flight can restore inside a proxy on every role and ghosts out without a push or charge", () => {
		let placedInside = 0;
		for (const type of STATION_TYPES) {
			const { world, id } = worldWith(type);
			const end = stationEndAt(world.system, id, world.gameTime);
			const solids = stationMotions(
				selectedStationProxy(stationOf(world.system, id)),
				end,
				end,
			);
			const primitive = solids[0].primitives[0];
			const c =
				primitive.kind === "capsule"
					? scale(add(primitive.a, primitive.b), 0.5)
					: primitive.centre;
			const pose = solids[0].start;
			// Game's saved-flight arm copies the saved position after restoreWorld;
			// unlike the fallback placement, it can be anywhere, including metal.
			const pos = add(
				pose.origin,
				add(add(scale(pose.x, c.x), scale(pose.y, c.y)), scale(pose.z, c.z)),
			);
			const motion = atRest("courier", pos, pose.z, pose.y);
			const swept = sweepShip(motion, solids, MAX_DT);
			expect(swept.ghosts.length).toBeGreaterThan(0);
			expect(swept.impacts).toEqual([]);
			expect(swept.pos).toEqual(pos);
			expect(swept.vel).toEqual(v3());
			// §4.3 is per overlapping pair: once that primitive is left,
			// it is solid on a return. Isolate the pair so another primitive
			// along the escape route cannot mask the ghost being tested.
			const pair = [{ ...solids[0], primitives: [primitive] }];
			const outside = add(pos, scale(pose.z, 4));
			const away: SolidMotion = {
				...motion,
				end: shipPose(outside, pose.z, pose.y),
				velStart: scale(pose.z, 4 / MAX_DT),
				velEnd: scale(pose.z, 4 / MAX_DT),
			};
			const escaped = sweepShip(away, pair, MAX_DT);
			expect(escaped.impacts).toEqual([]);
			expect(escaped.pos).toEqual(outside);
			const returned = sweepShip(
				{
					...away,
					start: away.end,
					end: away.start,
					velStart: scale(away.velStart, -1),
					velEnd: scale(away.velEnd, -1),
				},
				pair,
				MAX_DT,
			);
			expect(returned.ghosts).toEqual([]);
			expect(returned.impacts).toHaveLength(1);
			placedInside++;
		}
		console.log(
			`saved flight deliberately placed inside: ${placedInside}/${STATION_TYPES.length} roles ghost, no damage or push`,
		);
	});
});

/** An orthogonal, unit up-vector for the cruise chord's ship pose. */
function uprightFor(nose: Vec3): Vec3 {
	const up = cross(nose, Math.abs(nose.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0));
	return scale(up, 1 / length(up));
}

/** A cruise chord meets the proxy, rather than merely its bounding reach. */
function crossesStation(
	ship: SolidMotion,
	solids: SolidMotion[],
	dt: number,
): boolean {
	if (
		!solids.some((solid) =>
			mayMeet(
				{
					start: ship.start.origin,
					end: ship.end.origin,
					reachKm: reachKm(ship.primitives),
				},
				{
					start: solid.start.origin,
					end: solid.end.origin,
					reachKm: reachKm(solid.primitives),
				},
			),
		)
	)
		return false;
	const swept = sweepShip(ship, solids, dt);
	return swept.impacts.length > 0 || swept.ghosts.length > 0;
}

describe("collision.md §9.1.12: cruise and the station proxies (C5)", () => {
	test("the crossing count excludes empty space inside a sparse station's reach", () => {
		const frame = frameAt("shipyard", 0, 0);
		const { up } = slotBasis(frame);
		const proxy = selectedStationProxy({
			type: "shipyard",
			formId: "a",
			berthSeed: 0,
			assemblySeed: 0,
		});
		const solids = stationMotions(proxy, still(frame), still(frame));
		const chord = (x: number, y: number): SolidMotion => ({
			...atRest(
				"courier",
				local("shipyard", x, y, 2),
				scale(frame.axis, -1),
				up,
			),
			end: shipPose(local("shipyard", x, y, -2), scale(frame.axis, -1), up),
		});
		// Both chords enter the Gantry's bounding sphere. Only the second
		// crosses metal: its dorsal boom at y = 0.37–0.58 km.
		expect(crossesStation(chord(1.5, 0), solids, MAX_DT)).toBe(false);
		expect(crossesStation(chord(0, 0.47), solids, MAX_DT)).toBe(true);
	});
	test("no cruise exit places a ship inside a proxy, and the legs through a non-target station are counted", () => {
		const shipBox = hullSolid("miner")[0];
		let legs = 0;
		let exits = 0;
		let insideAtExit = 0;
		let nearestExitKm = Number.POSITIVE_INFINITY;
		const throughOther: string[] = [];
		for (const seed of CRUISE_SEEDS) {
			const probe = makeWorld(seed);
			for (const target of probe.system.contents.stations) {
				if (!probe.system.byId.has(target.id)) continue;
				const world = makeWorld(seed);
				legs++;
				let pos = world.ship.pos;
				let crossedOther = false;
				const parentId = stationHostIdOf(world.system, target.id);
				for (let t = 0; t < CRUISE_TIMEOUT_S; t += MAX_DT) {
					const starts = new Map(
						world.system.contents.stations
							.filter(
								(station) =>
									station.id !== target.id && world.system.byId.has(station.id),
							)
							.map((station) => [
								station.id,
								stationEndAt(world.system, station.id, world.gameTime),
							]),
					);
					advanceWorldClock(world, MAX_DT);
					const body = world.system.byId.get(target.id);
					if (!body) throw new Error(`no ${target.id}`);
					const to = sub(body.pos, pos);
					const nose = scale(to, 1 / length(to));
					const step = advanceCruise({
						pos,
						nose,
						throttle: 1,
						dt: MAX_DT,
						masses: world.system.bodies
							.filter((b) => b.kind === "star" || b.kind === "planet")
							.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm })),
						target: {
							pos: body.pos,
							radiusKm: body.radiusKm,
							vel: bodyVelocity(world.system, target.id, world.gameTime),
						},
						params: DEFAULT_CRUISE,
						targetParentId: parentId,
					});
					// C5 accepts pass-throughs. Count the swept hull against the
					// actual moving proxy; reach is only the broad-phase rejection.
					const attitudeUp = uprightFor(nose);
					const chord: SolidMotion = {
						primitives: [shipBox],
						start: shipPose(pos, nose, attitudeUp),
						end: shipPose(step.pos, nose, attitudeUp),
						velStart: scale(sub(step.pos, pos), 1 / MAX_DT),
						velEnd: scale(sub(step.pos, pos), 1 / MAX_DT),
					};
					for (const other of world.system.contents.stations) {
						if (other.id === target.id) continue;
						const start = starts.get(other.id);
						if (!start) continue;
						if (
							crossesStation(
								chord,
								stationMotions(
									selectedStationProxy(other),
									start,
									stationEndAt(world.system, other.id, world.gameTime),
								),
								MAX_DT,
							)
						)
							crossedOther = true;
					}
					pos = step.pos;
					if (step.dropped || step.starved) {
						exits++;
						for (const station of world.system.contents.stations) {
							const sb = world.system.byId.get(station.id);
							if (!sb) continue;
							const range = length(sub(pos, sb.pos));
							nearestExitKm = Math.min(nearestExitKm, range);
						}
						world.ship.pos = pos;
						if (overlapsStation(world, "miner", nose, attitudeUp))
							insideAtExit++;
						break;
					}
				}
				if (crossedOther) throughOther.push(`${seed}:${target.id}`);
			}
		}
		console.log(
			`cruise corpus: start systems of seeds 1–${CRUISE_SEEDS.length}, ${legs} legs, ` +
				`${exits} exits (${legs - exits} ran out of time); nearest exit to any station ${nearestExitKm.toFixed(1)} km; ` +
				`${throughOther.length} of ${legs} legs cross a non-target station's proxy` +
				(throughOther.length ? ` (${throughOther.join(", ")})` : ""),
		);
		// A leg that runs out of time was stopped by nothing and is not an
		// exit; the corpus's own instrument reports those separately.
		// Pin the measured corpus, not the literal used to generate its seeds.
		// A truncated corpus or a timed-out leg must invalidate the reported N.
		expect(legs).toBe(416);
		expect(exits).toBe(416);
		expect(throughOther).toEqual([]);
		expect(insideAtExit).toBe(0);
	}, 120_000);
});

// ---------------------------------------------------------------------------
// The wiring: stepWorld meets a real station, and hands back the plane
// ---------------------------------------------------------------------------

describe("stepWorld: a real station is solid, and the plane it watches is handed back", () => {
	const { world: base, id } = worldWith("trade");
	const seed = base.seed;

	/** A fresh world at the fixture's clock, the ship on the axis line at
	 *  `axialKm`, `lateralKm` along `across`, flying inward at `speedKms`
	 *  relative to the station. */
	function approach(axialKm: number, lateralKm: number, speedKms: number) {
		const world = makeWorld(seed);
		const body = world.system.byId.get(id);
		if (!body) throw new Error(`no ${id}`);
		const frame = stationApertureFrame(world.system, id, world.gameTime);
		const { across, up } = slotBasis(frame);
		const rel = add(scale(frame.axis, axialKm), scale(across, lateralKm));
		world.ship.pos = add(body.pos, rel);
		world.ship.vel = add(
			bodyVelocity(world.system, id, world.gameTime),
			scale(frame.axis, -speedKms),
		);
		return {
			world,
			frame,
			at: {
				nose: scale(frame.axis, -1),
				up,
				rates: { pitch: 0, yaw: 0, roll: 0 },
			} as HullAttitude,
		};
	}

	function flyIn(
		world: World,
		at: HullAttitude,
		seconds: number,
		watch: boolean,
	) {
		const impacts: { bodyId: string; damage: number }[] = [];
		let plane: string | null = null;
		let att = at;
		for (let i = 0; i < seconds / DOCK_DT && plane === null; i++) {
			const t = world.gameTime;
			const body = world.system.byId.get(id);
			if (!body) throw new Error(`no ${id}`);
			const before: EntryPose = {
				rel: sub(world.ship.pos, body.pos),
				vRel: sub(world.ship.vel, bodyVelocity(world.system, id, t)),
				nose: att.nose,
				up: att.up,
			};
			const step = stepWorld(
				world,
				att,
				handsOff(world, id, t, false),
				DOCK_DT,
				flightPerformance("courier"),
				hullSolid("courier"),
				watch
					? [
							{
								stationId: id,
								frame: stationApertureFrame(world.system, id, t),
								before,
							},
						]
					: [],
			);
			att = { nose: step.nose, up: step.up, rates: step.rates };
			impacts.push(
				...step.impacts.map((m) => ({ bodyId: m.bodyId, damage: m.damage })),
			);
			plane = step.plane?.stationId ?? null;
		}
		return { impacts, plane };
	}

	test("station start collection ignores unplaced stations and preserves placed poses", () => {
		const { world, at } = approach(0.7, 0.2, V_SCRAPE_KMS * 2);
		const placed = stationStarts(world.system, world.gameTime);
		const station = stationOf(world.system, id);
		const unplacedId = `${id}-unplaced`;
		world.system.contents.stations.push({ ...station, id: unplacedId });
		expect(world.system.byId.has(unplacedId)).toBe(false);
		expect(stationStarts(world.system, world.gameTime)).toEqual(placed);
		// advanceSystem independently requires the complete placed-body set.
		// Restore that invariant before flying the retained, placed station.
		world.system.contents.stations.pop();
		const run = flyIn(world, at, 10, true);
		expect(run.plane).toBeNull();
		expect(run.impacts.length).toBeGreaterThan(0);
		expect(run.impacts[0]?.bodyId).toBe(id);
	});

	test("a hull flown at the station's face beside the slot stops at the proxy, billed against the station", () => {
		// glossary-ignore: slot
		// 0.2 km off the axis, inside check 2's cone, outside the 60 m slot. // glossary-ignore: slot
		const { world, at } = approach(0.7, 0.2, V_SCRAPE_KMS * 2);
		const run = flyIn(world, at, 10, true);
		expect(run.plane).toBeNull();
		expect(run.impacts.length).toBeGreaterThan(0);
		expect(run.impacts[0]?.bodyId).toBe(id);
		expect(run.impacts[0]?.damage).toBeGreaterThan(0);
	});

	test("a centred approach through the slot hands back the plane, with no impact", () => {
		// glossary-ignore: slot
		const { world, at } = approach(0.6, 0, V_SCRAPE_KMS);
		const run = flyIn(world, at, 10, true);
		expect(run.impacts).toEqual([]);
		expect(run.plane).toBe(id);
	});
});
