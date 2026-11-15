import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { LAUNCH_CLEAR_HULL_LENGTHS } from "../src/arrival";
import {
	type Impact,
	impactDamage,
	mayMeet,
	type Primitive,
	pairSeparation,
	reachKm,
	SEPARATION_KM,
	type SolidMotion,
	shipPose,
	sweepShip,
	V_SCRAPE_KMS,
} from "../src/collision";
import { advanceCruise, DEFAULT_CRUISE } from "../src/cruise";
import {
	berthOf,
	collisionExempt,
	type DockSession,
	enterArrival,
	interiorOfStation,
	requestLaunch,
	stepDockedWorld,
} from "../src/dock-session";
import {
	type ApertureFrame,
	apertureCrossing,
	apertureFrame,
	type EntryPose,
	slotBasis,
} from "../src/docking";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import {
	advanceWorldClock,
	bodyVelocity,
	flightPerformance,
	type HullAttitude,
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
	type World,
} from "../src/sim";
import {
	formsInPlay,
	OUTPOST_FORM,
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationFormId,
	type StationType,
	slotPhaseRad,
} from "../src/station";
import {
	admittedHulls,
	BERTH_CELL,
	berthFits,
	interiorAxialSpanKm,
	type StationInterior,
	stationInterior,
} from "../src/station-interior";
import {
	type ProxyBox,
	proxyPoses,
	proxyListDistanceKm,
	proxyReachKm,
	proxySolids,
	type StationEnd,
	type StationProxy,
	stationMotions,
	stationProxy,
	stationProxyOf,
} from "../src/station-proxy";
import { MAX_DT } from "../src/units";
import {
	installShippedShipyards,
	uninstallShipyards,
} from "../scripts/lib/shipped-shipyards";
import {
	EMPTY_LIMIT_M,
	shipyardTriangles,
	TriangleGrid,
} from "../scripts/lib/shipyard-proxies";
import {
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	type Vec3,
	v3,
} from "../src/vec3";
import { clearsAperture } from "./helpers/aperture-physical-fit";
import {
	FIXTURE_AXIS,
	FIXTURE_REFERENCE,
	type FlightRun,
	flightStation,
	flyTheComputer,
} from "./helpers/fly-the-computer";
import { stationInForm } from "./helpers/forms-in-play";
import { hullSolid } from "./helpers/hull-solid";
import {
	planLabel,
	type StationPlanOfType,
	stationPlansFor,
} from "./helpers/station-plan-corpus";

const frameAt = (type: StationType, rpm: number, t: number): ApertureFrame =>
	apertureFrame(type, FIXTURE_AXIS, slotPhaseRad(rpm, t), FIXTURE_REFERENCE);

const still = (frame: ApertureFrame): StationEnd => ({
	frame,
	origin: v3(),
	vel: v3(),
});

function spinFramePoint(
	type: StationType,
	x: number,
	y: number,
	z: number,
): Vec3 {
	const frame = frameAt(type, 0, 0);
	const { across, up } = slotBasis(frame);
	return add(add(scale(across, x), scale(up, y)), scale(frame.axis, z));
}

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

const TURN_RPM = 3;
const OMEGA = (2 * Math.PI * TURN_RPM) / 60;
const ARM_FACE_Y = 0.25;
const SHIP_X_ALONG_ARM = 0.45;
const TURN_HULL: HullId = "courier";

function overArm(side: 1 | -1, gapKm: number) {
	const { env, envCentre } = HULL_SPECS[TURN_HULL];
	const boxExtentTowardFace = env.heightKm / 2 - side * envCentre.upKm;
	const frame = frameAt("trade", 0, 0);
	const { up } = slotBasis(frame);
	return {
		pos: spinFramePoint(
			"trade",
			SHIP_X_ALONG_ARM,
			side * (ARM_FACE_Y + boxExtentTowardFace + gapKm),
			0,
		),
		nose: frame.axis,
		up: scale(up, side),
		normal: scale(up, side),
	};
}

const closingBand = (): [number, number] => {
	const half = HULL_SPECS[TURN_HULL].env.beamKm / 2;
	return [OMEGA * (SHIP_X_ALONG_ARM - half), OMEGA * (SHIP_X_ALONG_ARM + half)];
};

function turnInto(side: 1 | -1, gapKm: number, rpm = TURN_RPM) {
	const at = overArm(side, gapKm);
	const proxy = stationProxyOf(stationInForm("trade", "a"));
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
		expect(impact.closingKms).toBeGreaterThan(V_SCRAPE_KMS);
		expect(impact.damage).toBe(impactDamage(impact.closingKms));
		expect(dot(impact.normal, at.normal)).toBeGreaterThan(0.99);
	});

	test("the face turning away from a ship never meets it: the sign is the spin's", () => {
		const { swept } = turnInto(-1, 0.003);
		expect(swept.impacts).toEqual([]);
	});

	test("the control: with the spin stopped, the same ship is never met", () => {
		const { swept } = turnInto(1, 0.003, 0);
		expect(swept.impacts).toEqual([]);
		expect(swept.ghosts).toEqual([]);
	});

	test("the shipyard's yard does not turn with its drum: a ship beside a yard beam is never met", () => {
		const proxy = stationProxyOf(stationInForm("shipyard", "a"));
		const { env, envCentre } = HULL_SPECS[TURN_HULL];
		const frame = frameAt("shipyard", 0, 0);
		const { up } = slotBasis(frame);
		const clearOfFaceAcrossAxisKm =
			env.beamKm / 2 +
			Math.abs(envCentre.rightKm) +
			env.heightKm / 2 +
			Math.abs(envCentre.upKm) +
			0.002;
		const sampleStepKm = 0.002;
		const beyondSampleHalfDiagonalKm = 0.0015;
		const yardBoxOffTheAxisKm = 0.2;
		const shipReach = reachKm(hullSolid(TURN_HULL));
		const [shipBox] = hullSolid(TURN_HULL);
		const { across } = slotBasis(frame);
		const shipBoxSurfaceInProxyFrame = (pos: Vec3): Vec3[] => {
			if (shipBox.kind !== "box") throw new Error("the hull is a box");
			const pose = shipPose(pos, frame.axis, up);
			const steps = shipBox.half.map((h) =>
				Math.max(1, Math.ceil((2 * h) / sampleStepKm)),
			);
			const out: Vec3[] = [];
			for (let i = 0; i <= steps[0]; i++)
				for (let j = 0; j <= steps[1]; j++)
					for (let k = 0; k <= steps[2]; k++) {
						if (
							i > 0 &&
							j > 0 &&
							k > 0 &&
							i < steps[0] &&
							j < steps[1] &&
							k < steps[2]
						)
							continue;
						const t = [i / steps[0], j / steps[1], k / steps[2]].map(
							(f, n) => (2 * f - 1) * shipBox.half[n],
						);
						const b = add(
							add(
								add(shipBox.centre, scale(shipBox.axes[0], t[0])),
								scale(shipBox.axes[1], t[1]),
							),
							scale(shipBox.axes[2], t[2]),
						);
						const w = add(
							add(add(pose.origin, scale(pose.x, b.x)), scale(pose.y, b.y)),
							scale(pose.z, b.z),
						);
						out.push(v3(dot(w, across), dot(w, up), dot(w, frame.axis)));
					}
			return out;
		};
		const drumReach = proxyReachKm({
			spinning: proxy.spinning,
			static: [],
			thinnestKm: proxy.thinnestKm,
		});
		const alongTurn = (b: ProxyBox) => {
			const r = Math.hypot(b.cx, b.cy);
			const t = v3(-b.cy / r, b.cx / r, 0);
			const axes = b.axes ?? [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
			const k = [0, 1, 2].find((n) => Math.abs(dot(axes[n], t)) > 0.95);
			return k === undefined
				? null
				: { axis: axes[k], half: [b.hx, b.hy, b.hz][k] };
		};
		const beams = proxy.static
			.filter(
				(p): p is ProxyBox =>
					p.kind === "box" &&
					Math.hypot(p.cx, p.cy) > yardBoxOffTheAxisKm &&
					alongTurn(p) !== null,
			)
			.sort((a, b) => b.hx * b.hy * b.hz - a.hx * a.hy * a.hz);
		const centresBeside = (b: ProxyBox) => {
			const { axis, half } = alongTurn(b)!;
			return [1, -1].map((side) => {
				const off = side * (half + clearOfFaceAcrossAxisKm);
				return v3(
					b.cx + axis.x * off,
					b.cy + axis.y * off,
					b.cz + axis.z * off,
				);
			});
		};
		const shipsBeside = (b: ProxyBox) =>
			centresBeside(b).map((c) => ({
				pos: spinFramePoint("shipyard", c.x, c.y, c.z),
				nose: frame.axis,
				up,
			}));
		const clear = (b: ProxyBox) => {
			const others = proxy.static.filter((p) => p !== b);
			return centresBeside(b).every(
				(c) =>
					length(c) > drumReach + shipReach &&
					shipBoxSurfaceInProxyFrame(
						spinFramePoint("shipyard", c.x, c.y, c.z),
					).every(
						(q) =>
							proxyListDistanceKm(others, q.x, q.y, q.z) >
							beyondSampleHalfDiagonalKm,
					),
			);
		};
		const steps = Math.round(2 / MAX_DT);
		const run = (
			ships: ReturnType<typeof shipsBeside>,
			keelPosedAsSpinning: boolean,
		) => {
			let met = 0;
			for (const ship of ships) {
				for (let i = 0; i < steps; i++) {
					const start = still(frameAt("shipyard", TURN_RPM, i * MAX_DT));
					const end = still(frameAt("shipyard", TURN_RPM, (i + 1) * MAX_DT));
					const solids = stationMotions(proxy, start, end);
					if (keelPosedAsSpinning) {
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
		const subject = beams.find(clear);
		expect(subject).toBeDefined();
		expect(run(shipsBeside(subject!), false)).toBe(0);
		expect(run(shipsBeside(subject!), true)).toBeGreaterThan(0);
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
		const proxy = stationProxyOf(stationInForm("trade", "a"));
		const end = proxyPoses(frameAt("trade", TURN_RPM, MAX_DT), v3());
		const ship = shipPose(swept.pos, at.nose, at.up);
		for (const primitive of proxySolids(proxy).spinning)
			expect(
				pairSeparation(hullSolid(TURN_HULL)[0], ship, primitive, end.spinning)
					.overlap,
			).toBe(false);
	});
});

describe("collision.md §9.1.6: the earliest impact owns the tick (C3)", () => {
	const type: StationType = "trade";
	const hull: HullId = "courier";
	const frame = frameAt(type, 0, 0);
	const { up } = slotBasis(frame);
	const nose = scale(frame.axis, -1);
	const formUnderTheWing: StationFormId = "a";
	const proxy = stationProxyOf(stationInForm(type, formUnderTheWing));
	const solids = stationMotions(proxy, still(frame), still(frame));

	function tick(x: number, z0: number, z1: number, planeS?: number | null) {
		const from = spinFramePoint(type, x, 0, z0);
		const to = spinFramePoint(type, x, 0, z1);
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

	const WING_X_OVER_COAMING = 0.05;
	const plane = frame.planeKm;

	test("a hull that clips the rim and would then cross the plane inside the rectangle is an impact", () => {
		const { found, swept } = tick(
			WING_X_OVER_COAMING,
			plane + 0.12,
			plane - 0.03,
		);
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
		const blind = tick(0, plane + 0.01, z1, null);
		expect(blind.swept.impacts.length).toBeGreaterThan(0);
		const { found, swept } = tick(0, plane + 0.01, z1);
		expect(found).not.toBeNull();
		expect(swept.planeOwns).toBe(true);
		expect(swept.impacts).toEqual([]);
	});

	test("an exact tie is the impact's", () => {
		const blind = tick(WING_X_OVER_COAMING, plane + 0.12, plane - 0.03, null);
		const at = (blind.swept.impacts[0] as Impact).timeS;
		const tie = tick(WING_X_OVER_COAMING, plane + 0.12, plane - 0.03, at);
		expect(tie.swept.planeOwns).toBe(false);
		expect(tie.swept.impacts).toHaveLength(1);
		const before = tick(
			WING_X_OVER_COAMING,
			plane + 0.12,
			plane - 0.03,
			at - 1e-9,
		);
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

function worldWith(
	type: StationType,
	formId?: StationFormId,
): { world: World; id: string } {
	const generatedAs = type === "outpost" ? "refinery" : type;
	for (let seed = 1; seed < 400; seed++) {
		const world = makeWorld(seed);
		const station = world.system.contents.stations.find(
			(s) =>
				s.type === generatedAs &&
				(s.spinRpm > 0 || !STATION_GEOMETRY[generatedAs].spins),
		);
		if (!station || !world.system.byId.has(station.id)) continue;
		if (type === "outpost") {
			station.type = "outpost";
			station.formId = OUTPOST_FORM;
		}
		if (formId !== undefined) station.formId = formId;
		return { world, id: station.id };
	}
	throw new Error(`no start system with a ${type} in 400 seeds`);
}

interface DockTick {
	phase: DockSession["phase"];
	ship: SolidMotion;
	station: [StationEnd, StationEnd];
}

const DOCK_DT = 1 / 30;
const PARK_S = 3;
const AFTER_RELEASE_S = 3;

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
	afterRelease: { impacts: number; ghostSteps: number; steps: number };
}

function traverse(
	type: StationType,
	hull: HullId,
	berthId: string,
	formId?: StationFormId,
): Traversal {
	const { world, id } = worldWith(type, formId);
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

function overhangWithOriginAtCellCentreKm(
	hull: HullId,
	type: StationType,
): number {
	const { env, envCentre } = HULL_SPECS[hull];
	const cell = BERTH_CELL[type];
	return Math.max(
		env.lengthKm / 2 + Math.abs(envCentre.foreKm) - cell.lengthKm / 2,
		env.beamKm / 2 + Math.abs(envCentre.rightKm) - cell.beamKm / 2,
		env.heightKm / 2 + Math.abs(envCentre.upKm) - cell.heightKm / 2,
	);
}

function expectOpenBayAndRedBuild(
	t: Traversal,
	type: StationType,
	hull: HullId,
	shipped: StationProxy,
): void {
	const bare = withoutExemption(t, shipped);
	const boxOverhangsItsCell = overhangWithOriginAtCellCentreKm(hull, type) > 0;
	if (boxOverhangsItsCell) {
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
	const red = withoutExemption(t, closedBay(type, shipped));
	expect({ hull, met: red.impacts > 0 }).toEqual({ hull, met: true });
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
					expect([...phases].sort()).toEqual([
						"arriving",
						"docked",
						"launching",
					]);
					expect(
						t.ticks.filter((tick) => !collisionExempt(tick.phase)),
					).toEqual([]);
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
				const shipped = stationProxyOf(stationOf(world.system, id));
				for (const { hull, berthId } of cases(type)) {
					const t = traverse(type, hull, berthId);
					if (kind === "pad") {
						const bare = withoutExemption(t, shipped);
						expect({ hull, struck: bare.impacts > 0 }).toEqual({
							hull,
							struck: true,
						});
						continue;
					}
					expectOpenBayAndRedBuild(t, type, hull, shipped);
				}
			},
			TRAVERSAL_MS,
		);
	}
});

describe("collision.md §9.1.7, §9.1.8: arrival, parked and launch in every pooled slot form", () => {
	for (const type of STATION_TYPES) {
		if (STATION_GEOMETRY[type].aperture.kind !== "slot") continue;
		for (const formId of formsInPlay(type)) {
			test(
				`${type}/${formId}: exempt throughout, a launch meets nothing, and the open bay is open`,
				() => {
					const { world, id } = worldWith(type, formId);
					const station = stationOf(world.system, id);
					expect(station.formId).toBe(formId);
					const shipped = stationProxyOf(station);
					for (const { hull, berthId } of cases(type)) {
						const t = traverse(type, hull, berthId, formId);
						expect({ hull, released: t.released }).toEqual({
							hull,
							released: true,
						});
						expect(
							t.ticks.filter((tick) => !collisionExempt(tick.phase)),
						).toEqual([]);
						expect({
							hull,
							impacts: t.afterRelease.impacts,
							ghostSteps: t.afterRelease.ghostSteps,
						}).toEqual({ hull, impacts: 0, ghostSteps: 0 });
						expectOpenBayAndRedBuild(t, type, hull, shipped);
					}
				},
				TRAVERSAL_MS,
			);
		}
	}
});

describe("collision.md §9.1.8: what the open bay does not cover — a box that overhangs its berth", () => {
	test("one hull's box overhangs a slot's berth cell: the explorer by 0.6 m", () => {
		const over: string[] = [];
		for (const type of STATION_TYPES) {
			if (STATION_GEOMETRY[type].aperture.kind !== "slot") continue;
			for (const hull of admittedHulls(type)) {
				const km = overhangWithOriginAtCellCentreKm(hull, type);
				if (km > 0) over.push(`${type}:${hull}:${(km * 1000).toFixed(1)} m`);
			}
		}
		console.log(`overhanging a slot's berth cell: ${over.join(", ")}`);
		expect(over).toEqual(["trade:explorer:0.6 m", "shipyard:explorer:0.6 m"]);
	});
});

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
		const pitched = (pitchDeg: number) =>
			clearsAperture(
				"trade",
				"miner",
				{ pitchDeg, yawDeg: 0, rollDeg: 50 },
				{ formId: "a", berthSeed: 1, assemblySeed: 0 },
			);
		expect(pitched(35)).toBe(true);
		expect(pitched(45)).toBe(false);
	});
});

describe("collision.md §9.1.9 and §9.1.15: seeded pad plans", () => {
	for (const type of ["refinery", "outpost"] as const) {
		const plans = stationPlansFor(type);
		test(`${type}: every admitted hull clears and docks across ${plans.length} plans`, () => {
			const misses: string[] = [];
			const flown = new Map<string, { angles: string[]; run: FlightRun }>();
			let visited = 0;
			for (const seeds of plans) {
				for (const hull of admittedHulls(type)) {
					visited++;
					const label = `${type}:${hull}:${planLabel(seeds)}`;
					const key = exactKey({
						hull,
						...flightStation({ type, stationPlan: seeds }),
					});
					let outcome = flown.get(key);
					if (!outcome) {
						outcome = flyPlan(type, hull, seeds);
						flown.set(key, outcome);
					}
					for (const angle of outcome.angles) misses.push(`${label}: ${angle}`);
					const run = outcome.run;
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
				`seeded ${type}: ${plans.length} plans × ${admittedHulls(type).length} admitted hulls; ${misses.length} failures; ${flown.size} distinct flights`,
			);
			expect(visited).toBe(plans.length * admittedHulls(type).length);
			expect(misses).toEqual([]);
		}, 60_000);
	}

	test("two refinery plans with one flight key measure identically", () => {
		const [hull] = admittedHulls("refinery");
		const byKey = new Map<string, StationPlanOfType[]>();
		for (const seeds of stationPlansFor("refinery")) {
			const key = exactKey({
				hull,
				...flightStation({ type: "refinery", stationPlan: seeds }),
			});
			byKey.set(key, [...(byKey.get(key) ?? []), seeds]);
		}
		const shared = [...byKey.values()].find((group) => group.length > 1);
		if (!shared) throw new Error("no two refinery plans share a flight");
		const [first, second] = shared;
		expect(planLabel(first)).not.toBe(planLabel(second));
		expect(exactKey(flyPlan("refinery", hull, second))).toBe(
			exactKey(flyPlan("refinery", hull, first)),
		);
	}, 60_000);
});

function flyPlan(
	type: StationType,
	hull: HullId,
	seeds: StationPlanOfType,
): { angles: string[]; run: FlightRun } {
	const angles: string[] = [];
	for (const rollDeg of [0, 50])
		for (const [pitchDeg, yawDeg] of [
			[0, 0],
			[35, 0],
			[-35, 0],
			[0, 35],
			[0, -35],
		])
			if (!clearsAperture(type, hull, { pitchDeg, yawDeg, rollDeg }, seeds))
				angles.push(`pitch ${pitchDeg}, yaw ${yawDeg}, roll ${rollDeg}`);
	const run = flyTheComputer({
		type,
		hull,
		spinRpm: 0,
		axis: FIXTURE_AXIS,
		reference: FIXTURE_REFERENCE,
		stationPlan: seeds,
	});
	return { angles, run };
}

function exactKey(value: unknown): string {
	return JSON.stringify(value, (_, v) =>
		typeof v === "number" && (Object.is(v, -0) || !Number.isFinite(v))
			? `number:${Object.is(v, -0) ? "-0" : String(v)}`
			: v,
	);
}

const MEASURE_CRUISE_ARRIVAL_SEEDS = Array.from(
	{ length: 200 },
	(_, i) => i + 1,
);
const PLACEMENT_SEEDS = MEASURE_CRUISE_ARRIVAL_SEEDS.slice(0, 40);
const CRUISE_TIMEOUT_S = 600;

function faceTheStarAttitude(pos: Vec3): { nose: Vec3; up: Vec3 } {
	const nose = scale(pos, -1 / length(pos));
	const right = cross(nose, v3(0, 1, 0));
	const up = cross(scale(right, 1 / length(right)), nose);
	return { nose, up };
}

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
		const proxy = stationProxyOf(station);
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
		const nonzeroClockBeforeJumpS = 120;
		const counts = {
			spawn: { N: 0, inside: 0 },
			hyperspace: { N: 0, inside: 0 },
			restoreFallback: { N: 0, inside: 0 },
		};
		const count = (world: World, row: { N: number; inside: number }) => {
			const { nose, up } = faceTheStarAttitude(world.ship.pos);
			for (const hull of HULL_IDS) {
				row.N++;
				if (overlapsStation(world, hull, nose, up)) row.inside++;
				for (const station of world.system.contents.stations) {
					const body = world.system.byId.get(station.id);
					if (!body) throw new Error(`unplaced ${station.id}`);
					const reachAtAnyAttitudeKm =
						proxyReachKm(stationProxyOf(station)) + reachKm(hullSolid(hull));
					expect(length(sub(world.ship.pos, body.pos))).toBeGreaterThan(
						reachAtAnyAttitudeKm,
					);
				}
			}
		};
		for (const seed of PLACEMENT_SEEDS) {
			const world = makeWorld(seed);
			count(world, counts.spawn);
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
			spawn: { N: 40 * HULL_IDS.length, inside: 0 },
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
				stationProxyOf(stationOf(world.system, id)),
				end,
				end,
			);
			const primitive = solids[0].primitives[0];
			const c =
				primitive.kind === "capsule"
					? scale(add(primitive.a, primitive.b), 0.5)
					: primitive.centre;
			const pose = solids[0].start;
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
			const onlyThatPrimitive = [{ ...solids[0], primitives: [primitive] }];
			const outside = add(pos, scale(pose.z, 4));
			const away: SolidMotion = {
				...motion,
				end: shipPose(outside, pose.z, pose.y),
				velStart: scale(pose.z, 4 / MAX_DT),
				velEnd: scale(pose.z, 4 / MAX_DT),
			};
			const escaped = sweepShip(away, onlyThatPrimitive, MAX_DT);
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
				onlyThatPrimitive,
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

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function restoreDirection(random: () => number): Vec3 {
	for (;;) {
		const p = v3(2 * random() - 1, 2 * random() - 1, 2 * random() - 1);
		const size = length(p);
		if (size > 0.1 && size <= 1) return scale(p, 1 / size);
	}
}

const PREFILTER_SLACK_KM = 1e-9;

function boxGapKm(
	box: { centre: Vec3; axes: Vec3[]; primitive: { half: readonly number[] } },
	pos: Vec3,
): number {
	const d = sub(pos, box.centre);
	let sq = 0;
	for (let i = 0; i < 3; i++) {
		const out = Math.abs(dot(d, box.axes[i])) - box.primitive.half[i];
		if (out > 0) sq += out * out;
	}
	return Math.sqrt(sq);
}

function segmentGapKm(
	point: Vec3,
	from: Vec3,
	dir: Vec3,
	lengthKm: number,
): number {
	const d = sub(point, from);
	const t = Math.max(0, Math.min(lengthKm, dot(d, dir)));
	return length(sub(d, scale(dir, t)));
}

describe("collision.md §4.3, §11.7: a shallow restore reverses out with every neighbour present", () => {
	const forms: { type: StationType; form: StationFormId }[] = [
		{ type: "shipyard", form: "a" },
		{ type: "shipyard", form: "b" },
		{ type: "shipyard", form: "c" },
		{ type: "refinery", form: "a" },
		{ type: "refinery", form: "b" },
		{ type: "refinery", form: "c" },
		{ type: "refinery", form: "d" },
	];
	const rays = 40;
	const depthsM = [0.1, 0.5, 2];
	const marchKm = 0.0005;
	const speedKms = 0.1;
	const maxTicks = 5;

	for (const { type, form } of forms) {
		test(
			`${type}/${form}: reverse escapes unbilled in at most five ticks; inward can strike from inside`,
			() => {
				const proxy = stationProxy(type, form, 0, 0);
				if (!proxy) throw new Error(`no authored proxy ${type}/${form}`);
				const spikeStillFrame = still(
					apertureFrame(type, v3(0, 0, 1), 0, v3(0, 1, 0)),
				);
				const solids = stationMotions(proxy, spikeStillFrame, spikeStillFrame);
				let formOverlaps = 0;
				let formStrikes = 0;
				for (const hull of ["courier", "freighter"] as const) {
					const primitives = hullSolid(hull);
					const [ship] = primitives;
					const shipReach = reachKm(primitives);
					const far = Math.max(...solids.map((s) => reachKm(s.primitives)));
					const prefilterBoxes = solids.flatMap((solid) =>
						solid.primitives.map((primitive) => {
							if (primitive.kind !== "box")
								throw new Error("authored station proxies must be boxes");
							const p = solid.start;
							const c = primitive.centre;
							return {
								primitive,
								pose: p,
								centre: add(
									p.origin,
									add(add(scale(p.x, c.x), scale(p.y, c.y)), scale(p.z, c.z)),
								),
								reach: Math.hypot(...primitive.half) + shipReach,
								axes: primitive.axes.map((a) =>
									add(add(scale(p.x, a.x), scale(p.y, a.y)), scale(p.z, a.z)),
								),
							};
						}),
					);
					const random = mulberry32(962 + 31 * form.charCodeAt(0));
					let overlaps = 0;
					let held = 0;
					let inwardStruck = 0;
					let inwardN = 0;
					let hitRays = 0;
					let mostTicks = 0;
					for (let ray = 0; ray < rays; ray++) {
						const out = restoreDirection(random);
						const aim = scale(restoreDirection(random), 0.1 * random());
						const span = far + shipReach + 0.01;
						const from = add(aim, scale(out, span));
						const inward = scale(out, -1);
						const nose = restoreDirection(random);
						let up: Vec3;
						do {
							const candidate = restoreDirection(random);
							up = sub(candidate, scale(nose, dot(candidate, nose)));
						} while (length(up) < 1e-6);
						up = scale(up, 1 / length(up));
						const insideOf = (list: typeof prefilterBoxes) => (pos: Vec3) => {
							const pose = shipPose(pos, nose, up);
							return list.some(
								(b) =>
									length(sub(b.centre, pos)) <= b.reach &&
									boxGapKm(b, pos) <= shipReach + PREFILTER_SLACK_KM &&
									pairSeparation(ship, pose, b.primitive, b.pose).overlap,
							);
						};
						const inside = insideOf(prefilterBoxes);
						const insideRay = insideOf(
							prefilterBoxes.filter(
								(b) =>
									segmentGapKm(b.centre, from, inward, 2 * span) <=
									b.reach + PREFILTER_SLACK_KM,
							),
						);
						const along = (s: number) => add(from, scale(inward, s));
						expect(inside(from)).toBe(false);
						let clear = 0;
						let hit: number | null = null;
						for (let s = marchKm; s < 2 * span; s += marchKm) {
							if (insideRay(along(s))) {
								hit = s;
								break;
							}
							clear = s;
						}
						if (hit === null) continue;
						let boundary: number = hit;
						while (boundary - clear > 0.00001) {
							const middle = (clear + boundary) / 2;
							if (insideRay(along(middle))) boundary = middle;
							else clear = middle;
						}
						hitRays++;
						for (const depthM of depthsM) {
							const placed = along(clear + depthM / 1000);
							if (!inside(placed)) continue;
							overlaps++;
							const label = { type, form, hull, ray, depthM };
							const tick = (pos: Vec3, dir: Vec3) => {
								const vel = scale(dir, speedKms);
								const wanted = add(pos, scale(vel, MAX_DT));
								return {
									wanted,
									swept: sweepShip(
										{
											primitives,
											start: shipPose(pos, nose, up),
											end: shipPose(wanted, nose, up),
											velStart: vel,
											velEnd: vel,
										},
										solids,
										MAX_DT,
									),
								};
							};
							let pos = placed;
							let holds = 0;
							let ticks = 0;
							while (inside(pos) && ticks < maxTicks) {
								const { wanted, swept } = tick(pos, out);
								expect({
									...label,
									billed: swept.impacts.some((i) => i.damage !== 0),
								}).toEqual({ ...label, billed: false });
								if (length(sub(swept.pos, wanted)) > 1e-9) holds++;
								pos = swept.pos;
								ticks++;
							}
							expect({
								...label,
								inside: inside(pos),
								holds: holds <= 1,
							}).toEqual({ ...label, inside: false, holds: true });
							if (holds > 0) held++;
							mostTicks = Math.max(mostTicks, ticks);
							for (const dir of [nose, restoreDirection(random)]) {
								if (dot(dir, out) > 0) continue;
								inwardN++;
								pos = placed;
								for (let t = 0; t < maxTicks && inside(pos); t++) {
									const { swept } = tick(pos, dir);
									if (swept.impacts.some((i) => i.damage > 0)) {
										inwardStruck++;
										break;
									}
									pos = swept.pos;
								}
							}
						}
					}
					console.log(
						`restore ${type}/${form} ${hull}: ${hitRays}/${rays} rays hit, ` +
							`${overlaps}/${rays * depthsM.length} placements overlapped, ` +
							`${held} held one step unbilled, escape <= ${mostTicks} ticks; ` +
							`${inwardStruck}/${inwardN} inward headings billed from inside`,
					);
					expect(overlaps).toBeGreaterThan(0);
					const grazingPlacementLeftThinBox =
						type === "refinery" &&
						((form === "a" && hull === "freighter") ||
							(form === "c" && hull === "courier"));
					expect({ overlaps, held }).toEqual({
						overlaps:
							rays * depthsM.length - (grazingPlacementLeftThinBox ? 1 : 0),
						held:
							type === "refinery" && form === "a" && hull === "courier" ? 2 : 0,
					});
					formOverlaps += overlaps;
					formStrikes += inwardStruck;
				}
				expect(formOverlaps).toBeGreaterThan(0);
				expect(formStrikes).toBeGreaterThan(0);
			},
			TRAVERSAL_MS,
		);
	}
});

function uprightFor(nose: Vec3): Vec3 {
	const up = cross(nose, Math.abs(nose.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0));
	return scale(up, 1 / length(up));
}

const solidReaches = new WeakMap<
	readonly Primitive[],
	{ count: number; reach: number }
>();

function solidReachKm(primitives: readonly Primitive[]): number {
	const known = solidReaches.get(primitives);
	if (known && known.count === primitives.length) return known.reach;
	const reach = reachKm(primitives);
	solidReaches.set(primitives, { count: primitives.length, reach });
	return reach;
}

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
					reachKm: solidReachKm(solid.primitives),
				},
			),
		)
	)
		return false;
	const swept = sweepShip(ship, solids, dt);
	return swept.impacts.length > 0 || swept.ghosts.length > 0;
}

describe("collision.md §9.1.12: cruise and the station proxies (C5)", () => {
	test("a station's solids keep their primitive lists, so a cached reach is the measured one", () => {
		let lists = 0;
		for (const seed of MEASURE_CRUISE_ARRIVAL_SEEDS.slice(0, 12)) {
			const world = makeWorld(seed);
			for (const station of world.system.contents.stations) {
				if (!world.system.byId.has(station.id)) continue;
				const end = stationEndAt(world.system, station.id, world.gameTime);
				const first = stationMotions(stationProxyOf(station), end, end);
				const again = stationMotions(stationProxyOf(station), end, end);
				for (const [i, solid] of first.entries()) {
					expect(again[i].primitives).toBe(solid.primitives);
					expect(solidReachKm(solid.primitives)).toBe(
						reachKm(solid.primitives),
					);
					expect(solidReachKm(again[i].primitives)).toBe(
						reachKm(solid.primitives),
					);
					lists++;
				}
			}
		}
		const grown: Primitive[] = [...hullSolid("miner")];
		const before = solidReachKm(grown);
		grown.push({ kind: "sphere", centre: v3(before + 1, 0, 0), radiusKm: 1 });
		expect(solidReachKm(grown)).toBe(reachKm(grown));
		expect(solidReachKm(grown)).not.toBe(before);
		expect(lists).toBeGreaterThan(0);
	});

	test("the crossing count excludes empty space inside a sparse station's reach", async () => {
		const frame = frameAt("shipyard", 0, 0);
		const { up } = slotBasis(frame);
		const proxy = stationProxyOf(stationInForm("shipyard", "a"));
		const solids = stationMotions(proxy, still(frame), still(frame));
		const chord = (x: number, y: number): SolidMotion => ({
			...atRest(
				"courier",
				spinFramePoint("shipyard", x, y, 2),
				scale(frame.axis, -1),
				up,
			),
			end: shipPose(
				spinFramePoint("shipyard", x, y, -2),
				scale(frame.axis, -1),
				up,
			),
		});
		await installShippedShipyards();
		let tris: Awaited<ReturnType<typeof shipyardTriangles>>;
		try {
			tris = await shipyardTriangles("a");
		} finally {
			uninstallShipyards();
		}
		const [spinning, fixed] = solids;
		const grids = [
			{ pose: spinning.start, grid: new TriangleGrid(tris.drum, 50) },
			{ pose: fixed.start, grid: new TriangleGrid(tris.yard, 50) },
		];
		const clearM = EMPTY_LIMIT_M + reachKm(hullSolid("courier")) * 1000 + 5;
		const at = new THREE.Vector3();
		const clearOfModel = (motion: SolidMotion) => {
			const from = motion.start.origin;
			const to = motion.end.origin;
			const steps = Math.ceil((length(sub(to, from)) * 1000) / 5);
			for (let n = 0; n <= steps; n++) {
				const p = add(from, scale(sub(to, from), n / steps));
				for (const { pose, grid } of grids) {
					const d = sub(p, pose.origin);
					at.set(dot(d, pose.x), dot(d, pose.y), dot(d, pose.z));
					if (grid.within(at.multiplyScalar(1000), clearM)) return false;
				}
			}
			return true;
		};
		const reach = proxyReachKm(proxy);
		const emptyByTheModel = [0.9, 0.75, 0.6]
			.flatMap((share) =>
				Array.from({ length: 12 }, (_, k) => {
					const angle = (k * Math.PI) / 6;
					return [
						share * reach * Math.cos(angle),
						share * reach * Math.sin(angle),
					] as const;
				}),
			)
			.find(([x, y]) => clearOfModel(chord(x, y)));
		const [largest] = [...proxy.static]
			.filter((p): p is ProxyBox => p.kind === "box")
			.sort((a, b) => b.hx * b.hy * b.hz - a.hx * a.hy * a.hz);
		expect(emptyByTheModel).toBeDefined();
		expect(Math.hypot(...emptyByTheModel!)).toBeLessThan(reach);
		expect(crossesStation(chord(...emptyByTheModel!), solids, MAX_DT)).toBe(
			false,
		);
		expect(crossesStation(chord(largest.cx, largest.cy), solids, MAX_DT)).toBe(
			true,
		);
	}, 60_000);
	test("no cruise exit places a ship inside a proxy, and the legs through a non-target station are counted", () => {
		const shipBox = hullSolid("miner")[0];
		const measuredCorpusLegs = 416;
		let legs = 0;
		let exits = 0;
		let insideAtExit = 0;
		let nearestExitKm = Number.POSITIVE_INFINITY;
		const throughOther: string[] = [];
		for (const seed of MEASURE_CRUISE_ARRIVAL_SEEDS) {
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
									stationProxyOf(other),
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
			`cruise corpus: start systems of seeds 1–${MEASURE_CRUISE_ARRIVAL_SEEDS.length}, ${legs} legs, ` +
				`${exits} exits (${legs - exits} ran out of time); nearest exit to any station ${nearestExitKm.toFixed(1)} km; ` +
				`${throughOther.length} of ${legs} legs cross a non-target station's proxy` +
				(throughOther.length ? ` (${throughOther.join(", ")})` : ""),
		);
		expect(legs).toBe(measuredCorpusLegs);
		expect(exits).toBe(measuredCorpusLegs);
		expect(throughOther).toEqual([]);
		expect(insideAtExit).toBe(0);
	}, 120_000);
});

describe("stepWorld: a real station is solid, and the plane it watches is handed back", () => {
	const { world: base, id } = worldWith("trade");
	const seed = base.seed;

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
		world.system.contents.stations.pop();
		const run = flyIn(world, at, 10, true);
		expect(run.plane).toBeNull();
		expect(run.impacts.length).toBeGreaterThan(0);
		expect(run.impacts[0]?.bodyId).toBe(id);
	});

	test("a hull flown at the station's face beside the slot stops at the proxy, billed against the station", () => {
		const outsideApertureInsideConeKm = 0.2;
		const { world, at } = approach(
			0.7,
			outsideApertureInsideConeKm,
			V_SCRAPE_KMS * 2,
		);
		const run = flyIn(world, at, 10, true);
		expect(run.plane).toBeNull();
		expect(run.impacts.length).toBeGreaterThan(0);
		expect(run.impacts[0]?.bodyId).toBe(id);
		expect(run.impacts[0]?.damage).toBeGreaterThan(0);
	});

	test("a centred approach through the slot hands back the plane, with no impact", () => {
		const { world, at } = approach(0.6, 0, V_SCRAPE_KMS);
		const run = flyIn(world, at, 10, true);
		expect(run.impacts).toEqual([]);
		expect(run.plane).toBe(id);
	});
});
