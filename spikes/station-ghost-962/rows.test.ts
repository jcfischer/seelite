/**
 * Spike #962: does per-primitive ghosting (`collision.md` §4.3,
 * `classifyPairs`) trap a ship placed inside an authored station proxy, as
 * #956's G1 trapped a ship placed inside a rock's pieces?
 *
 * A ship is placed overlapping a random box of an authored form (shipyards
 * a–c, #818; refineries a–d, #819) and flown out in a straight line at
 * `SPEED_KMS`, `MAX_DT` a tick, by the shipped `sweepShip`, until it overlaps
 * nothing of the station. Three arms, the same placements and paths:
 *
 * - **per box** — the shipped rule: every primitive overlapping at a tick's
 *   start is a ghost, every other one is swept.
 * - **per solid** — a solid (drum, yard, or a refinery's one solid) any of
 *   whose primitives the ship overlapped at the placement is left out of the
 *   sweep until the ship overlaps none of its primitives at a tick's start.
 * - **per station** — the same, for every solid of the station at once.
 *
 * The control arms are #956 O-c for stations. A trap in **per box** that
 * **per station** flies out of is the G1 class: the ship meets metal it is
 * already inside the union of. An impact in both arms is metal the ship
 * reaches after it leaves the structure it was placed in, and is correct.
 */
import { describe, expect, test } from "bun:test";
import {
	type Primitive,
	pairSeparation,
	type SolidMotion,
	shipPose,
	sweepShip,
} from "../../src/collision";
import { apertureFrame } from "../../src/docking";
import type { HullId } from "../../src/hull";
import {
	SPIN_RPM_RANGE,
	type StationFormId,
	type StationType,
	slotPhaseRad,
} from "../../src/station";
import {
	type StationEnd,
	stationMotions,
	stationProxy,
} from "../../src/station-proxy";
import { MAX_DT } from "../../src/units";
import { add, dot, length, scale, sub, type Vec3, v3 } from "../../src/vec3";
import { hullSolid } from "../../tests/helpers/hull-solid";

const FORMS: { type: StationType; form: StationFormId }[] = [
	{ type: "shipyard", form: "a" },
	{ type: "shipyard", form: "b" },
	{ type: "shipyard", form: "c" },
	{ type: "refinery", form: "a" },
	{ type: "refinery", form: "b" },
	{ type: "refinery", form: "c" },
	{ type: "refinery", form: "d" },
];
const HULLS: HullId[] = ["courier", "freighter"];
const PLACEMENTS = Number(process.env.GHOST_PLACEMENTS ?? 120);
const SEED = Number(process.env.GHOST_SEED ?? 962);
const SPEED_KMS = 0.1;
const MAX_TICKS = 400;
/** A neighbour: a primitive the placed ship does not overlap, this close. */
const NEIGHBOUR_KM = SPEED_KMS * MAX_DT;
const AXIS = v3(0, 0, 1);
const REFERENCE = v3(0, 1, 0);

/** mulberry32: a fixed, seedable stream. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function unit(r: () => number): Vec3 {
	for (;;) {
		const p = v3(2 * r() - 1, 2 * r() - 1, 2 * r() - 1);
		const l = length(p);
		if (l > 0.1 && l <= 1) return scale(p, 1 / l);
	}
}

function orthoUp(nose: Vec3, r: () => number): Vec3 {
	const a = unit(r);
	const u = sub(a, scale(nose, dot(a, nose)));
	const l = length(u);
	return l < 1e-6 ? orthoUp(nose, r) : scale(u, 1 / l);
}

type Box = Extract<Primitive, { kind: "box" }>;

/** A solid-local point to world, at a pose. */
const toWorld = (p: SolidMotion["start"], v: Vec3): Vec3 =>
	add(p.origin, add(add(scale(p.x, v.x), scale(p.y, v.y)), scale(p.z, v.z)));
const dirToWorld = (p: SolidMotion["start"], v: Vec3): Vec3 =>
	add(add(scale(p.x, v.x), scale(p.y, v.y)), scale(p.z, v.z));

const halfDiag = (b: Box) => Math.hypot(b.half[0], b.half[1], b.half[2]);

/** Each solid's primitive indices the ship overlaps, and the nearest gap of the rest. */
function contact(
	ship: Primitive,
	pos: Vec3,
	nose: Vec3,
	up: Vec3,
	solids: readonly SolidMotion[],
	shipReach: number,
): { overlap: number[][]; nearestKm: number } {
	const pose = shipPose(pos, nose, up);
	let nearestKm = Number.POSITIVE_INFINITY;
	const overlap = solids.map((solid) => {
		const hits: number[] = [];
		solid.primitives.forEach((p, i) => {
			if (p.kind !== "box") return;
			const c = toWorld(solid.start, p.centre);
			if (length(sub(c, pos)) > halfDiag(p) + shipReach + 0.05) return;
			const gap = pairSeparation(ship, pose, p, solid.start);
			if (gap.overlap) hits.push(i);
			else nearestKm = Math.min(nearestKm, gap.distanceKm);
		});
		return hits;
	});
	return { overlap, nearestKm };
}

type Arm = "box" | "solid" | "station";
type Outcome =
	| { kind: "escaped"; ticks: number }
	| { kind: "trapped"; tick: number; damage: number; joined: boolean }
	| { kind: "metAfter"; tick: number }
	| { kind: "stuck" };

interface Trial {
	type: StationType;
	form: StationFormId;
	hull: HullId;
	rpm: number;
	pos: Vec3;
	nose: Vec3;
	up: Vec3;
	dir: Vec3;
}

function stationEnd(type: StationType, rpm: number, t: number): StationEnd {
	return {
		frame: apertureFrame(type, AXIS, slotPhaseRad(rpm, t), REFERENCE),
		origin: v3(),
		vel: v3(),
	};
}

/** A solid's box at its world pose, as a ship box, so `pairSeparation`
 *  can measure box against box. */
function boxAsShip(
	solid: SolidMotion,
	b: Box,
): { prim: Primitive; pose: SolidMotion["start"] } {
	return {
		prim: {
			kind: "box",
			centre: v3(),
			axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
			half: b.half,
		},
		pose: {
			origin: toWorld(solid.start, b.centre),
			x: dirToWorld(solid.start, b.axes[0]),
			y: dirToWorld(solid.start, b.axes[1]),
			z: dirToWorld(solid.start, b.axes[2]),
		},
	};
}

const JOIN_KM = 0.001;

/**
 * Whether a box the ship was stopped against overlaps or touches (within
 * `JOIN_KM`) a box the ship was inside at the tick's start: the G1 class,
 * metal joined to the metal it was placed in. Otherwise it is metal across a
 * gap, reached while the ship was still partly inside.
 */
function joinedMetal(
	ship: Primitive,
	stopped: Vec3,
	trial: Trial,
	solids: readonly SolidMotion[],
	overlap: number[][],
	shipReach: number,
): boolean {
	const pose = shipPose(stopped, trial.nose, trial.up);
	const inside: { solid: SolidMotion; b: Box }[] = [];
	overlap.forEach((idx, si) => {
		for (const i of idx)
			inside.push({ solid: solids[si], b: solids[si].primitives[i] as Box });
	});
	for (const [si, solid] of solids.entries()) {
		for (const [i, p] of solid.primitives.entries()) {
			if (p.kind !== "box" || overlap[si].includes(i)) continue;
			const c = toWorld(solid.start, p.centre);
			if (length(sub(c, stopped)) > halfDiag(p) + shipReach + 0.05) continue;
			const gap = pairSeparation(ship, pose, p, solid.start);
			if (gap.overlap || gap.distanceKm > JOIN_KM) continue;
			const met = boxAsShip(solid, p);
			for (const a of inside) {
				const g = pairSeparation(met.prim, met.pose, a.b, a.solid.start);
				if (g.overlap || g.distanceKm <= JOIN_KM) return true;
			}
		}
	}
	return false;
}

function fly(trial: Trial, arm: Arm): Outcome {
	const proxy = stationProxy(trial.type, trial.form, 0, 0);
	if (!proxy) throw new Error(`no proxy ${trial.type}/${trial.form}`);
	const [box] = hullSolid(trial.hull);
	const shipReach = length(
		add(
			box.kind === "box" ? box.centre : v3(),
			v3(
				box.kind === "box" ? box.half[0] : 0,
				box.kind === "box" ? box.half[1] : 0,
				box.kind === "box" ? box.half[2] : 0,
			),
		),
	);
	let pos = trial.pos;
	const vel = scale(trial.dir, SPEED_KMS);
	let flagged: boolean[] | null = null;
	for (let tick = 0; tick < MAX_TICKS; tick++) {
		const t = tick * MAX_DT;
		const solids = stationMotions(
			proxy,
			stationEnd(trial.type, trial.rpm, t),
			stationEnd(trial.type, trial.rpm, t + MAX_DT),
		);
		const { overlap } = contact(
			box,
			pos,
			trial.nose,
			trial.up,
			solids,
			shipReach,
		);
		const inside = overlap.map((o) => o.length > 0);
		if (!inside.some(Boolean)) return { kind: "escaped", ticks: tick };
		if (flagged === null)
			flagged =
				arm === "station"
					? inside.map(() => true)
					: arm === "solid"
						? inside
						: inside.map(() => false);
		else if (arm === "solid") flagged = flagged.map((f, i) => f && inside[i]);
		// per station: flagged until the ship is clear of every solid, which
		// is the loop's exit above.
		const live = solids.filter((_, i) => !flagged![i]);
		const ship: SolidMotion = {
			primitives: [box],
			start: shipPose(pos, trial.nose, trial.up),
			end: shipPose(add(pos, scale(vel, MAX_DT)), trial.nose, trial.up),
			velStart: vel,
			velEnd: vel,
		};
		const swept = sweepShip(ship, live, MAX_DT);
		if (swept.impacts.length > 0)
			return {
				kind: "trapped",
				tick,
				damage: swept.impacts.reduce((s, i) => s + i.damage, 0),
				joined: joinedMetal(box, swept.pos, trial, solids, overlap, shipReach),
			};
		pos = swept.pos;
	}
	return { kind: "stuck" };
}

/** The trap class only when the ship was still inside at the impact's tick:
 *  `fly` returns at the first impact, and the loop leaves on the first clear
 *  tick, so every impact it reports is met from inside. An impact after the
 *  first clear tick cannot be reached here — it would be fresh metal. */
function placements(
	type: StationType,
	form: StationFormId,
	hull: HullId,
	rpm: number,
	seed: number,
): {
	trials: (Trial & { label: string; neighbour: boolean })[];
	tried: number;
} {
	const proxy = stationProxy(type, form, 0, 0);
	if (!proxy) throw new Error(`no proxy ${type}/${form}`);
	const solids = stationMotions(
		proxy,
		stationEnd(type, rpm, 0),
		stationEnd(type, rpm, MAX_DT),
	);
	const r = rng(seed);
	const [ship] = hullSolid(hull);
	if (ship.kind !== "box") throw new Error("hull box");
	const reach = length(ship.centre) + halfDiag(ship);
	const out: (Trial & { label: string; neighbour: boolean })[] = [];
	let tried = 0;
	while (out.length < PLACEMENTS * 3 && tried < PLACEMENTS * 40) {
		tried++;
		const si = Math.floor(r() * solids.length);
		const solid = solids[si];
		const boxes = solid.primitives.filter((p): p is Box => p.kind === "box");
		const b = boxes[Math.floor(r() * boxes.length)];
		// A face of the box, and a point within one hull half-length inside it.
		const axis = Math.floor(r() * 3);
		const sign = r() < 0.5 ? -1 : 1;
		const depth = r() * Math.min(b.half[axis], ship.half[2]);
		let local = b.centre;
		for (let k = 0; k < 3; k++) {
			const along =
				k === axis ? sign * (b.half[k] - depth) : (2 * r() - 1) * b.half[k];
			local = add(local, scale(b.axes[k], along));
		}
		const pos = toWorld(solid.start, local);
		const nose = unit(r);
		const up = orthoUp(nose, r);
		const c = contact(ship, pos, nose, up, solids, reach);
		if (!c.overlap.some((o) => o.length > 0)) continue;
		const neighbour = c.nearestKm <= NEIGHBOUR_KM;
		const face = dirToWorld(solid.start, scale(b.axes[axis], sign));
		const base = { type, form, hull, rpm, pos, nose, up };
		out.push({ ...base, dir: face, label: "face", neighbour });
		out.push({ ...base, dir: nose, label: "nose", neighbour });
		out.push({ ...base, dir: unit(r), label: "random", neighbour });
	}
	return { trials: out, tried };
}

const ROW_MS = 1_800_000;

describe("spike #962: a ship placed inside an authored station proxy", () => {
	for (const { type, form } of FORMS)
		for (const spin of [false, true]) {
			if (spin && type !== "shipyard") continue;
			test(
				`${type}/${form} ${spin ? `at ${SPIN_RPM_RANGE.maxRpm} rpm` : "still"}`,
				() => {
					const rpm = spin ? SPIN_RPM_RANGE.maxRpm : 0;
					const lines: string[] = [];
					for (const hull of HULLS) {
						const { trials, tried } = placements(
							type,
							form,
							hull,
							rpm,
							SEED + form.charCodeAt(0) * 7 + (spin ? 1 : 0),
						);
						const by: Record<string, Record<Arm, Outcome>[]> = {};
						for (const trial of trials) {
							const row = {
								box: fly(trial, "box"),
								solid: fly(trial, "solid"),
								station: fly(trial, "station"),
							};
							const key = `${trial.label}${trial.neighbour ? "+n" : ""}`;
							(by[key] ??= []).push(row);
							(by.all ??= []).push(row);
						}
						for (const [key, rows] of Object.entries(by).sort()) {
							const n = rows.length;
							const count = (arm: Arm, kind: Outcome["kind"]) =>
								rows.filter((r) => r[arm].kind === kind).length;
							const g1 = rows.filter(
								(r) => r.box.kind === "trapped" && r.station.kind === "escaped",
							).length;
							const joined = rows.filter(
								(r) => r.box.kind === "trapped" && r.box.joined,
							).length;
							const firstTick = rows.filter(
								(r) => r.box.kind === "trapped" && r.box.tick === 0,
							).length;
							const dmg = rows
								.map((r) => (r.box.kind === "trapped" ? r.box.damage : 0))
								.filter((d) => d > 0).length;
							lines.push(
								`${type}/${form} rpm ${rpm.toFixed(2)} ${hull.padEnd(9)} ${key.padEnd(9)} N ${String(n).padStart(4)}  ` +
									`trapped box ${count("box", "trapped")} solid ${count("solid", "trapped")} station ${count("station", "trapped")}  ` +
									`G1 ${g1} (joined metal ${joined}, at tick 0 ${firstTick})  billed ${dmg}  stuck box ${count("box", "stuck")} station ${count("station", "stuck")}`,
							);
						}
						lines.push(
							`${type}/${form} ${hull}: ${trials.length / 3} placements from ${tried} draws`,
						);
						expect(trials.length).toBeGreaterThan(0);
					}
					for (const l of lines) console.log(l);
				},
				ROW_MS,
			);
		}
});
