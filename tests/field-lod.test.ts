import { expect, test } from "bun:test";
import {
	chartedField,
	fieldCentre,
	fieldRocks,
	rockPose,
	rockLocal,
	rockSpinAngle,
	rotateByQuat,
	systemFields,
} from "../src/asteroid-field";
import {
	HYSTERESIS,
	LEVEL_PX,
	POINT_LEVEL,
	fieldCameraLocal,
	fieldOffsetFromCamera,
	levelFor,
	pxPerRadianFor,
	rockArchetype,
	selectFieldLevels,
	spinQuat,
} from "../src/field-lod";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";

// #952's fixed fields on world 0x5ee11e, galaxy 0.
const WORLD = 0x5ee11e;
const FIELD_SYSTEMS = [173, 221, 84] as const;
const PX_PER_RADIAN = pxPerRadianFor(1800, 60);

function fieldOf(systemIndex: number) {
	const record = generateGalaxy(WORLD, 0).systems[systemIndex];
	const contents = generateContents(record);
	const plan = systemFields(record, contents)[0];
	return { record, plan, rocks: fieldRocks(record, plan) };
}

test("the thresholds are #950 D3's, and low doubles high", () => {
	expect(LEVEL_PX.high).toEqual([40, 10, 1.5]);
	expect(LEVEL_PX.low).toEqual([80, 20, 3]);
	expect(HYSTERESIS).toBe(0.15);
});

test("a level steps down at the bare edge and up only past edge × 1.15, on both sides", () => {
	for (const quality of ["high", "low"] as const) {
		const edges = LEVEL_PX[quality];
		for (let l = 0; l < 3; l++) {
			const edge = edges[l];
			// A rock already at level l (or finer) holds it down to the bare edge.
			expect(levelFor(edge * 1.001, l, quality)).toBeLessThanOrEqual(l);
			expect(levelFor(edge * 0.999, l, quality)).toBeGreaterThan(l);
			// A coarser rock needs the widened edge to step up to l.
			expect(levelFor(edge * 1.1, l + 1, quality)).toBeGreaterThan(l);
			expect(levelFor(edge * 1.151, l + 1, quality)).toBeLessThanOrEqual(l);
		}
		expect(levelFor(0, 3, quality)).toBe(POINT_LEVEL);
		expect(levelFor(1e6, 3, quality)).toBe(0);
	}
});

test("a rock on a boundary does not change level frame to frame", () => {
	let level = 2;
	const seen = new Set<number>();
	for (let i = 0; i < 200; i++) {
		// Wobble ±5 % around level 1's high edge.
		const px = LEVEL_PX.high[1] * (1 + 0.05 * Math.sin(i));
		level = levelFor(px, level, "high");
		seen.add(level);
	}
	expect(seen.size).toBe(1);
});

test("rows put each rock where rockPose does, against the camera's own sim position", () => {
	for (const index of FIELD_SYSTEMS) {
		const { plan, rocks } = fieldOf(index);
		for (const t of [0, 123.4, 40000.9]) {
			const centre = fieldCentre(plan, t);
			// A camera 40 km off the centre, star-centric f64.
			const camera = { x: centre.x + 31, y: centre.y - 17, z: centre.z + 9 };
			const local = fieldCameraLocal(plan, t, camera);
			const offset = fieldOffsetFromCamera(plan, t, camera);
			const back = rotateByQuat(plan.rotation, local);
			// camera = centre + R · local
			expect(back.x).toBeCloseTo(camera.x - centre.x, 6);
			expect(back.y).toBeCloseTo(camera.y - centre.y, 6);
			expect(back.z).toBeCloseTo(camera.z - centre.z, 6);
			for (const rock of rocks.slice(0, 25)) {
				const pose = rockPose(plan, rock, t);
				// root offset + R · rockLocal  ==  rock − camera, the frame's own placement.
				const r = rotateByQuat(plan.rotation, rockLocal(rock, t));
				expect(offset.x + r.x).toBeCloseTo(pose.pos.x - camera.x, 5);
				expect(offset.y + r.y).toBeCloseTo(pose.pos.y - camera.y, 5);
				expect(offset.z + r.z).toBeCloseTo(pose.pos.z - camera.z, 5);
			}
		}
	}
});

test("every rock's drift and spin follow the clock", () => {
	const { rocks } = fieldOf(173);
	const buffers = () => ({
		levels: new Int8Array(rocks.length).fill(POINT_LEVEL),
		pos: new Float32Array(rocks.length * 3),
		points: new Float32Array(rocks.length * 3),
	});
	const a = buffers();
	const b = buffers();
	const cam = { x: 0, y: 0, z: 0 };
	selectFieldLevels(
		rocks,
		0,
		cam,
		PX_PER_RADIAN,
		"high",
		a.levels,
		a.pos,
		a.points,
	);
	selectFieldLevels(
		rocks,
		1800,
		cam,
		PX_PER_RADIAN,
		"high",
		b.levels,
		b.pos,
		b.points,
	);
	let moved = 0;
	for (let i = 0; i < rocks.length; i++) {
		const p0 = rockLocal(rocks[i], 0);
		expect(a.pos[i * 3]).toBeCloseTo(p0.x, 3);
		expect(a.pos[i * 3 + 1]).toBeCloseTo(p0.y, 3);
		expect(a.pos[i * 3 + 2]).toBeCloseTo(p0.z, 3);
		if (Math.abs(a.pos[i * 3] - b.pos[i * 3]) > 1e-4) moved++;
		// Spin angle advances at the rock's own period.
		const turn = rockSpinAngle(rocks[i], 1800) - rockSpinAngle(rocks[i], 0);
		expect(turn).toBeCloseTo((2 * Math.PI * 1800) / rocks[i].spinPeriodS, 9);
	}
	expect(moved).toBeGreaterThan(rocks.length * 0.9);
});

test("spin is a rotation about the rock's own axis by its angle at the clock", () => {
	const { rocks } = fieldOf(173);
	for (const rock of rocks.slice(0, 20)) {
		for (const t of [0, 77.7, 5000]) {
			const angle = rockSpinAngle(rock, t);
			const q = spinQuat(rock, angle);
			expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
			// The axis is a fixed point; a perpendicular vector turns by `angle`.
			const onAxis = rotateByQuat(q, rock.spinAxis);
			expect(onAxis.x).toBeCloseTo(rock.spinAxis.x, 9);
			expect(onAxis.y).toBeCloseTo(rock.spinAxis.y, 9);
			expect(onAxis.z).toBeCloseTo(rock.spinAxis.z, 9);
			const a = rock.spinAxis;
			const seed =
				Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
			const d = seed.x * a.x + seed.y * a.y + seed.z * a.z;
			const u = {
				x: seed.x - d * a.x,
				y: seed.y - d * a.y,
				z: seed.z - d * a.z,
			};
			const un = Math.hypot(u.x, u.y, u.z);
			const v = rotateByQuat(q, { x: u.x / un, y: u.y / un, z: u.z / un });
			const cos = (v.x * u.x + v.y * u.y + v.z * u.z) / un;
			expect(cos).toBeCloseTo(Math.cos(angle), 9);
		}
	}
});

// `close` is left out on purpose: it stands beside the biggest rock and puts 6
// at level 0 on high (receipt, "D2 re-measure"). Calls stay in budget there
// because a batch is one call whatever it holds; the principal ruled on its cost.
test("level counts at #950's inside, edge and far stands hold ≤ 5 rocks at level 0", () => {
	for (const index of FIELD_SYSTEMS) {
		const { rocks } = fieldOf(index);
		for (const quality of ["high", "low"] as const) {
			for (const cam of [
				{ x: 1.2, y: 1.2, z: 1.2 },
				{ x: -26, y: 0, z: 0 },
				{ x: -224, y: 0, z: 0 },
			]) {
				const levels = new Int8Array(rocks.length).fill(POINT_LEVEL);
				const pos = new Float32Array(rocks.length * 3);
				const points = new Float32Array(rocks.length * 3);
				for (const t of [0, 1 / 60, 2 / 60])
					selectFieldLevels(
						rocks,
						t,
						cam,
						PX_PER_RADIAN,
						quality,
						levels,
						pos,
						points,
					);
				expect(levels.filter((l) => l === 0).length).toBeLessThanOrEqual(5);
			}
		}
	}
});

test("with no shapes installed every rock is a point, packed first", () => {
	const { rocks } = fieldOf(173);
	const levels = new Int8Array(rocks.length).fill(0);
	const pos = new Float32Array(rocks.length * 3);
	const points = new Float32Array(rocks.length * 3);
	const n = selectFieldLevels(
		rocks,
		0,
		{ x: 1.2, y: 1.2, z: 1.2 },
		PX_PER_RADIAN,
		"high",
		levels,
		pos,
		points,
		false,
	);
	expect(n).toBe(rocks.length);
	expect(levels.every((l) => l === POINT_LEVEL)).toBe(true);
	for (let i = 0; i < rocks.length; i++) {
		expect(points[i * 3]).toBe(pos[i * 3]);
		expect(points[i * 3 + 2]).toBe(pos[i * 3 + 2]);
	}
});

test("a rock's archetype is one of sixteen and spreads across them", () => {
	const seen = new Set<number>();
	for (const index of FIELD_SYSTEMS)
		for (const rock of fieldOf(index).rocks) seen.add(rockArchetype(rock));
	expect([...seen].every((a) => a >= 0 && a < 16)).toBe(true);
	expect(seen.size).toBe(16);
});

test("the three fixed fields exist and the charted one is on the refinery's orbit", () => {
	for (const index of FIELD_SYSTEMS) {
		const { record } = fieldOf(index);
		expect(
			systemFields(record, generateContents(record)).length,
		).toBeGreaterThan(0);
	}
	const record = generateGalaxy(WORLD, 0).systems[173];
	expect(chartedField(record, generateContents(record))).not.toBeNull();
});
