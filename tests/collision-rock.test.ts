import { beforeAll, describe, expect, test } from "bun:test";
import {
	bodySphere,
	IDENTITY_AXES,
	RESTING_KM,
	SEPARATION_KM,
	spinBetween,
	sweepShip,
	type Impact,
	type Pose,
	type SolidMotion,
} from "../src/collision";
import { dirOf, radiusAt } from "../src/rock-heightfields";
import { buildRockPieces, type RockPieces } from "../src/rock-pieces";
import {
	add,
	cross,
	length,
	rotateAbout,
	scale,
	sub,
	v3,
	type Vec3,
} from "../src/vec3";
import { envelopeAt as spikeEnvelope } from "./fixtures/rock-sweep-956/pieces";
import { placeBox, separation } from "./fixtures/rock-sweep-956/gjk";
import {
	firstOverlap,
	shipPoseAt,
	type ShipStep,
} from "./fixtures/rock-sweep-956/rock-sweep";
import {
	DT,
	archetypes,
	clearLift,
	motion,
	prims,
	solid,
	spikePieces,
	step,
	sweep,
	synthetic,
	tangentPath,
	unit,
	upFor,
} from "./fixtures/rock-sweep";

function contactGap(
	s: ShipStep,
	oracle: ReturnType<typeof spikePieces>,
	hit: Impact,
	R: number,
	at = shipPoseAt(s.start, s.end, spinBetween(s.start, s.end), hit.timeS / DT),
): number {
	const primitive = s.prims.find((p) => (p.part ?? "hull") === hit.part);
	expect(primitive).toBeDefined();
	expect(hit.piece).toBeDefined();
	const gap = separation(placeBox(primitive!, at), oracle.pieces[hit.piece!]);
	return gap.overlap ? 0 : gap.distanceKm * R;
}

describe("sweepShip against rock solids (node #958)", () => {
	test("R1 crosses the spike ridge at 2 and 10 km/s no later than the 20,000-sub-step reference", () => {
		const R = 0.4,
			rock = synthetic(false),
			oracle = spikePieces(rock);
		for (const kms of [2, 10])
			for (const z of [0.6, 0.7, 0.8]) {
				const half = (kms * DT) / R / 2;
				const s = step(
					R,
					v3(-half, 0.011, z),
					v3(half, 0.011, z),
					v3(1, 0, 0),
					v3(0, 0, 1),
					false,
				);
				const ref = firstOverlap(s, oracle, 20_000);
				const { hit, diagnostics } = sweep(s, rock, R);
				expect(ref).not.toBeNull();
				expect(hit).toBeDefined();
				expect(hit.part).toBe("hull");
				expect(hit.timeS / DT).toBeLessThanOrEqual(ref! + 1 / 20_000);
				expect(contactGap(s, oracle, hit, R)).toBeLessThanOrEqual(
					SEPARATION_KM / 2 + 1e-9,
				);
				expect(diagnostics.cappedPairs).toBe(0);
			}
	}, 120_000);

	test("R2 meets the spike needle between the hull's face-lattice samples", () => {
		const R = 0.4,
			rock = synthetic(true),
			oracle = spikePieces(rock);
		const d = v3(...dirOf(4, 1 / 64, 1 / 64));
		const top = Math.max(...oracle.pieces.flatMap((p) => p.v.map((v) => v.z)));
		const tip = scale(d, top / d.z);
		const p = prims(R, false)[0];
		const off = v3(p.half[0] / 4, p.half[2] / 8, 0);
		const at = (dz: number) => add(sub(tip, off), v3(0, 0, p.half[1] + dz));
		const s = step(
			R,
			at(0.005 / R),
			at(-0.005 / R),
			v3(0, 1, 0),
			v3(0, 0, 1),
			false,
		);
		const ref = firstOverlap(s, oracle, 4000);
		const { hit } = sweep(s, rock, R);
		let sampleGap = Infinity;
		for (let i = -2; i <= 2; i++)
			for (let j = -1; j <= 1; j++)
				for (let k = -4; k <= 4; k++) {
					if (Math.abs(i) !== 2 && Math.abs(j) !== 1 && Math.abs(k) !== 4)
						continue;
					const q = add(
						p.centre,
						v3((i / 2) * p.half[0], j * p.half[1], (k / 4) * p.half[2]),
					);
					const point = add(
						s.end.origin,
						add(
							add(scale(s.end.x, q.x), scale(s.end.y, q.y)),
							scale(s.end.z, q.z),
						),
					);
					sampleGap = Math.min(
						sampleGap,
						length(point) -
							spikeEnvelope(
								oracle,
								{ res: 64, r: new Float32Array() },
								unit(point),
							),
					);
				}
		expect(ref).not.toBeNull();
		expect(sampleGap).toBeGreaterThan(0);
		expect(hit).toBeDefined();
		expect(hit.timeS / DT).toBeLessThanOrEqual(ref! + 1 / 4000);
		expect(contactGap(s, oracle, hit, R)).toBeLessThanOrEqual(
			SEPARATION_KM / 2 + 1e-9,
		);
	});

	test("a translated and turned rock reports world witnesses and body-relative closing speed", () => {
		const rp = buildRockPieces({
			res: 64,
			r: new Float32Array(6 * 64 * 64).fill(0.8),
		});
		const R = 0.4;
		const s = step(R, v3(0, 0, 1.2), v3(0, 0, 0.7), v3(0, 0, -1), v3(0, 1, 0));
		const base = sweep(s, rp, R).hit;
		const ship = motion(s, R),
			rock = solid(rp, R);
		const axis = unit(v3(1, 2, 3)),
			angle = 1.3;
		const turn = (v: Vec3) => rotateAbout(v, axis, angle);
		const origin = v3(1e8, -2e8, 3e7),
			velocity = v3(28, 4, -3);
		const pose = (p: Pose, end: boolean): Pose => ({
			origin: add(
				add(origin, end ? scale(velocity, DT) : v3()),
				turn(p.origin),
			),
			x: turn(p.x),
			y: turn(p.y),
			z: turn(p.z),
		});
		ship.start = pose(ship.start, false);
		ship.end = pose(ship.end, true);
		ship.velStart = ship.velEnd = add(turn(ship.velStart), velocity);
		rock.start = pose(rock.start, false);
		rock.end = pose(rock.end, true);
		rock.velStart = rock.velEnd = velocity;
		const hit = sweepShip(ship, [rock], DT).impacts[0];
		expect(hit.piece).toBe(base.piece);
		expect(hit.part).toBe("cutter");
		expect(Math.abs(hit.timeS - base.timeS)).toBeLessThan(1e-7);
		expect(Math.abs(hit.closingKms - base.closingKms)).toBeLessThan(1e-6);
		expect(length(sub(hit.normal, turn(base.normal)))).toBeLessThan(1e-5);
		expect(
			length(
				sub(
					hit.point,
					add(add(origin, scale(velocity, hit.timeS)), turn(base.point)),
				),
			),
		).toBeLessThan(1e-6);
	});

	test("reusing one rock geometry at different radii preserves each sweep", () => {
		const rp = synthetic(false);
		const run = (R: number) =>
			sweep(
				step(R, v3(0, 0, 1.3), v3(0, 0, 0.4), v3(0, 0, -1), v3(0, 1, 0)),
				rp,
				R,
			).result;
		const small = run(0.04);
		const large = run(0.4);
		expect(small.impacts[0]).toBeDefined();
		expect(large.impacts[0]).toBeDefined();
		expect(run(0.04)).toEqual(small);
		expect(run(0.4)).toEqual(large);
		expect(small.impacts[0].timeS).not.toBe(large.impacts[0].timeS);
	});

	test("initial rock overlap and resting contact retain world-frame classification", () => {
		const R = 0.4,
			rp = synthetic(false);
		const s = step(R, v3(0, 0, 1.3), v3(0, 0, 0.4), v3(0, 0, -1), v3(0, 1, 0));
		const first = sweep(s, rp, R).hit;
		expect(first).toBeDefined();
		const ship = motion(s, R),
			rock = solid(rp, R);
		ship.start.origin = add(
			ship.start.origin,
			scale(sub(ship.end.origin, ship.start.origin), first.timeS / DT),
		);
		ship.end = ship.start;
		const resting = sweepShip(ship, [rock], DT);
		expect(resting.impacts[0]).toBeDefined();
		expect(resting.impacts[0].resting).toBe(true);
		expect(resting.impacts[0].timeS).toBe(0);
		expect(resting.impacts[0].closingKms).toBeGreaterThan(0);
		const axis = unit(v3(1, 2, 3)),
			angle = 1.3,
			origin = v3(30, -20, 40);
		const pose = (p: Pose): Pose => ({
			origin: add(origin, rotateAbout(p.origin, axis, angle)),
			x: rotateAbout(p.x, axis, angle),
			y: rotateAbout(p.y, axis, angle),
			z: rotateAbout(p.z, axis, angle),
		});
		ship.start = pose(ship.start);
		ship.end = pose(ship.end);
		ship.velStart = ship.velEnd = rotateAbout(ship.velStart, axis, angle);
		rock.start = pose(rock.start);
		rock.end = pose(rock.end);
		const turned = sweepShip(ship, [rock], DT);
		expect(turned.impacts[0]).toBeDefined();
		expect(turned.impacts[0].resting).toBe(true);
		expect(turned.impacts[0].closingKms).toBeCloseTo(
			resting.impacts[0].closingKms,
			8,
		);
		expect(
			length(
				sub(
					turned.impacts[0].normal,
					rotateAbout(resting.impacts[0].normal, axis, angle),
				),
			),
		).toBeLessThan(1e-8);
		expect(
			length(
				sub(
					turned.impacts[0].point,
					add(origin, rotateAbout(resting.impacts[0].point, axis, angle)),
				),
			),
		).toBeLessThan(1e-8);
		ship.start.origin = ship.end.origin = rock.start.origin;
		const ghost = sweepShip(ship, [rock], DT);
		expect(ghost.ghosts).toEqual([0]);
		expect(ghost.impacts).toEqual([]);
	});

	test("rock contact competes with ordinary solids and the aperture plane on one timeline", () => {
		const R = 0.4,
			rp = buildRockPieces({
				res: 64,
				r: new Float32Array(6 * 64 * 64).fill(0.8),
			});
		const ship = motion(
			step(R, v3(0, 0, 1.2), v3(0, 0, 0.2), v3(0, 0, -1), v3(0, 1, 0)),
			R,
		);
		const rock = solid(rp, R);
		const sphere: SolidMotion = {
			primitives: [bodySphere(0.05)],
			start: { ...IDENTITY_AXES, origin: v3(0, 0, 0.25) },
			end: { ...IDENTITY_AXES, origin: v3(0, 0, 0.25) },
			velStart: v3(),
			velEnd: v3(),
		};
		const hit = sweepShip(ship, [sphere, rock], DT).impacts[0];
		expect(hit.solid).toBe(1);
		expect(hit.piece).toBeDefined();
		expect(
			sweepShip(ship, [sphere, rock], DT, { planeS: hit.timeS / 2 }).planeOwns,
		).toBe(true);
		expect(
			sweepShip(ship, [sphere, rock], DT, { planeS: hit.timeS }).impacts[0]
				.solid,
		).toBe(1);
		sphere.start.origin = sphere.end.origin = v3(0, 0, 0.36);
		const earlier = sweepShip(ship, [rock, sphere], DT).impacts[0];
		expect(earlier.solid).toBe(1);
		expect(earlier.piece).toBeUndefined();
	});

	test("a spinning rock and turning hull meet no later than exact world-path sub-steps", () => {
		const R = 0.4,
			rp = synthetic(false),
			oracle = spikePieces(rp);
		const s = step(
			R,
			v3(-0.4, 0.011, 0.7),
			v3(0.4, 0.011, 0.7),
			v3(1, 0, 0),
			v3(0, 0, 1),
			false,
		);
		const ship = motion(s, R),
			rock = solid(rp, R);
		const axis = unit(v3(1, 2, -1)),
			angle = 0.025;
		rock.end = {
			...rock.end,
			x: rotateAbout(rock.start.x, axis, angle),
			y: rotateAbout(rock.start.y, axis, angle),
			z: rotateAbout(rock.start.z, axis, angle),
		};
		const shipAxis = unit(v3(-2, 1, 1)),
			shipAngle = 0.08;
		ship.end = {
			...ship.end,
			x: rotateAbout(ship.start.x, shipAxis, shipAngle),
			y: rotateAbout(ship.start.y, shipAxis, shipAngle),
			z: rotateAbout(ship.start.z, shipAxis, shipAngle),
		};
		const diagnostics = { advances: 0, maxPairAdvances: 0, cappedPairs: 0 };
		const hit = sweepShip(ship, [rock], DT, { diagnostics }).impacts[0];
		let ref: number | null = null;
		const exactPose = (f: number): Pose => ({
			origin: rotateAbout(
				add(s.start.origin, scale(sub(s.end.origin, s.start.origin), f)),
				axis,
				-angle * f,
			),
			x: rotateAbout(
				rotateAbout(s.start.x, shipAxis, shipAngle * f),
				axis,
				-angle * f,
			),
			y: rotateAbout(
				rotateAbout(s.start.y, shipAxis, shipAngle * f),
				axis,
				-angle * f,
			),
			z: rotateAbout(
				rotateAbout(s.start.z, shipAxis, shipAngle * f),
				axis,
				-angle * f,
			),
		});
		for (let i = 0; i <= 4000; i++) {
			const f = i / 4000;
			const at = exactPose(f);
			if (
				firstOverlap({ prims: s.prims, start: at, end: at }, oracle, 1) !== null
			) {
				ref = f;
				break;
			}
		}
		expect(ref).not.toBeNull();
		expect(hit).toBeDefined();
		expect(hit.timeS / DT).toBeLessThanOrEqual(ref! + 1 / 4000);
		const sagitta =
			R *
			Math.max(length(s.start.origin), length(s.end.origin)) *
			(1 - Math.cos(angle / 2));
		expect(
			contactGap(s, oracle, hit, R, exactPose(hit.timeS / DT)),
		).toBeLessThanOrEqual(SEPARATION_KM / 2 + 2 * sagitta + 1e-9);
		expect(diagnostics.cappedPairs).toBe(0);
	});

	test("the rock spin's arc sagitta is added to the contact gap", () => {
		const R = 0.4,
			rp = buildRockPieces({
				res: 64,
				r: new Float32Array(6 * 64 * 64).fill(0.8),
			});
		const s = step(R, v3(0, 0, 1.2), v3(0, 0, 0.7), v3(0, 0, -1), v3(0, 1, 0));
		const staticHit = sweep(s, rp, R).hit;
		const ship = motion(s, R),
			rock = solid(rp, R);
		const axis = v3(0, 1, 0),
			angle = 0.1;
		const turnPose = (p: Pose): Pose => ({
			origin: rotateAbout(p.origin, axis, angle),
			x: rotateAbout(p.x, axis, angle),
			y: rotateAbout(p.y, axis, angle),
			z: rotateAbout(p.z, axis, angle),
		});
		ship.end = turnPose(ship.end);
		rock.end = turnPose(rock.end);
		const spunHit = sweepShip(ship, [rock], DT).impacts[0];
		const sagitta = R * 1.2 * (1 - Math.cos(angle / 2));
		const speed = (R * 0.5) / DT;
		expect(spunHit.timeS).toBeLessThan(staticHit.timeS);
		expect(
			Math.abs(staticHit.timeS - spunHit.timeS - sagitta / speed),
		).toBeLessThan(1e-9);
	});

	describe("authored archetype corpus", () => {
		let corpus: ReturnType<typeof archetypes>;
		let oracles: ReturnType<typeof spikePieces>[];
		beforeAll(() => {
			corpus = archetypes();
			oracles = corpus.rocks.map(spikePieces);
		}, 120_000);
		test("A1 192 seeded random steps at 0.2–10 km/s meet every reference hit without a capped pair", () => {
			let seed = 956,
				cases = 0,
				hits = 0,
				ghosts = 0,
				maxPairAdvances = 0;
			const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
			for (const R of [0.025, 0.4])
				corpus.rocks.forEach((rp, k) => {
					for (let c = 0; c < 6; c++) {
						const d = unit(v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5));
						const r = radiusAt(corpus.fields[k], [d.x, d.y, d.z]);
						const travel = ([0.2, 2, 10][c % 3] * DT) / R;
						const t = unit(cross(d, upFor(d))),
							inward = rnd();
						const dir = unit(add(scale(d, -inward), scale(t, 1 - inward)));
						const a = add(
							scale(d, r + (0.02 + rnd() * 0.03) / R),
							scale(dir, -travel / 2),
						);
						const nose = unit(add(dir, scale(d, -0.3)));
						const s = step(R, a, add(a, scale(dir, travel)), nose, upFor(nose));
						const { result, hit, diagnostics } = sweep(s, rp, R);
						cases++;
						expect(diagnostics.cappedPairs, `case ${cases}`).toBe(0);
						expect(diagnostics.maxPairAdvances, `case ${cases}`).toBeLessThan(
							64,
						);
						maxPairAdvances = Math.max(
							maxPairAdvances,
							diagnostics.maxPairAdvances,
						);
						if (result.ghosts.length) {
							ghosts++;
							continue;
						}
						const n = Math.max(500, Math.ceil(travel / (0.5e-3 / R)));
						const ref = firstOverlap(s, oracles[k], n);
						if (ref !== null) {
							hits++;
							expect(hit, `case ${cases}`).toBeDefined();
							expect(hit.timeS / DT).toBeLessThanOrEqual(ref + 1 / n);
							expect(
								contactGap(s, oracles[k], hit, R),
								`case ${cases}`,
							).toBeLessThanOrEqual(
								(hit.resting ? RESTING_KM : SEPARATION_KM / 2) + 1e-9,
							);
						}
					}
				});
			console.log(
				`A1: ${cases} steps, ${hits} reference hits, ${ghosts} initial ghosts, max ${maxPairAdvances} advances per pair, no capped pair`,
			);
			expect(cases).toBe(192);
			expect(hits).toBeGreaterThan(20);
		}, 600_000);

		test("A2 tree and every-piece flat sweeps agree on piece, time and ship primitive", () => {
			const R = 0.1;
			corpus.rocks.forEach((rp, k) => {
				const d = unit(v3(Math.sin(k), Math.cos(k * 1.3), 0.4));
				const r = radiusAt(corpus.fields[k], [d.x, d.y, d.z]);
				const s = step(
					R,
					scale(d, r + 0.8),
					scale(d, r - 0.2),
					scale(d, -1),
					upFor(scale(d, -1)),
				);
				const flat: RockPieces = {
					...rp,
					roots: rp.pieces.map((hull, piece) => ({
						hull,
						piece,
						children: [],
					})),
				};
				const tree = sweep(s, rp, R),
					all = sweep(s, flat, R);
				expect(tree.result.ghosts).toEqual([]);
				expect(tree.hit).toBeDefined();
				expect(all.hit).toBeDefined();
				expect(tree.hit.resting).toBe(false);
				expect(tree.hit.piece).toBe(all.hit.piece);
				expect(tree.hit.part).toBe(all.hit.part);
				expect(Math.abs(tree.hit.timeS - all.hit.timeS)).toBeLessThan(1e-9);
			});
		}, 120_000);

		test("A3 64 grazes 2 m clear at 2 and 10 km/s report no impact", () => {
			let cases = 0;
			for (const R of [0.04, 0.4])
				corpus.rocks.forEach((rp, k) => {
					for (const kms of [2, 10]) {
						const path = tangentPath(R, k, kms);
						const coarse = Math.max(200, Math.ceil((kms * DT) / 0.002));
						const lift = clearLift(path, oracles[k], coarse, 30);
						const s = path(lift + 0.002 / R);
						const ref = firstOverlap(
							s,
							oracles[k],
							Math.max(500, Math.ceil((kms * DT) / 0.00025)),
						);
						const { hit, diagnostics } = sweep(s, rp, R);
						expect(ref).toBeNull();
						expect(hit).toBeUndefined();
						expect(diagnostics.cappedPairs).toBe(0);
						cases++;
					}
				});
			expect(cases).toBe(64);
		}, 900_000);
	});
});
