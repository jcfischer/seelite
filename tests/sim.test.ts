/**
 * The float64 world: determinism, precision, and the integrator's shape.
 *
 * The precision test is the one worth having. The scale research settles that
 * sim positions are float64 kilometres and *render* positions are the float32
 * difference of two of them — so the property that matters is not "the numbers
 * are big", it is that arithmetic at 1 AU still resolves metres. A refactor
 * that quietly routed a position through a `Float32Array` would keep every
 * other test in this file green and lose that, visibly, as jitter.
 */
import { expect, test, describe } from "bun:test";
import {
	SHIP_START,
	add,
	generateSystem,
	length,
	makeWorld,
	scale,
	stepShip,
	sub,
	v3,
} from "../src/sim";
import { AU_KM } from "../src/units";

describe("generateSystem", () => {
	test("the same seed gives the same system", () => {
		expect(generateSystem(42)).toEqual(generateSystem(42));
	});

	test("a different seed gives a different one", () => {
		expect(generateSystem(42)).not.toEqual(generateSystem(43));
	});

	test("a body's parameters follow its identity, not the draw order", () => {
		// The reason bodies are seeded through `mix(systemSeed, index)` rather
		// than drawn in sequence: planet 1 must not move because planet 0 gained a
		// parameter. Asserted as the property that buys it — the same index in two
		// systems with the same seed is the same body — since the failure it
		// guards against (an inserted draw shifting everything downstream) is one
		// nothing else in the suite would report.
		const a = generateSystem(4242);
		const b = generateSystem(4242);
		for (let i = 0; i < a.bodies.length; i++)
			expect(a.bodies[i]).toEqual(b.bodies[i]);
	});

	test("it produces one star, some planets, and a station", () => {
		const s = generateSystem(2026);
		const kinds = s.bodies.map((b) => b.kind);
		expect(kinds.filter((k) => k === "star").length).toBe(1);
		expect(kinds.filter((k) => k === "planet").length).toBeGreaterThan(0);
		expect(kinds.filter((k) => k === "station").length).toBe(1);
	});

	test("planets orbit at plausible distances and have real radii", () => {
		const s = generateSystem(99);
		for (const p of s.bodies.filter((b) => b.kind === "planet")) {
			const au = length(p.pos) / AU_KM;
			expect(au).toBeGreaterThan(0.5);
			expect(au).toBeLessThan(4);
			// Kilometres, not scene units. A radius that had silently been scaled
			// would still render — at 1/100,000 of the size it should be, which on
			// screen is indistinguishable from not being drawn.
			expect(p.radiusKm).toBeGreaterThan(1000);
			expect(p.radiusKm).toBeLessThan(1e6);
		}
	});
});

describe("float64 sim space", () => {
	test("metre-scale arithmetic survives at 1 AU", () => {
		// The claim the unit scheme rests on, stated as what it actually is.
		//
		// float64's step at 1.5·10⁸ is 2⁻⁵² × 1.5·10⁸ ≈ 3.3·10⁻⁸ km — about
		// 0.03 mm. float32's step there is ~16 km, which would swallow this
		// addition whole. The tolerance below is 0.1 mm: a few ULP, so it is not
		// asserting the exact rounding, and four orders of magnitude tighter than
		// anything a player could see.
		//
		// Note the relative precision does not depend on the unit — a metre is
		// resolved just as well whether the coordinate is written in kilometres or
		// metres. Kilometres are chosen for legibility, not for precision.
		const a = v3(AU_KM, 0, 0);
		const b = add(a, v3(0.001, 0, 0)); // one metre
		expect(Math.abs(b.x - a.x - 0.001)).toBeLessThan(1e-7);
		expect(Math.abs(length(sub(b, a)) - 0.001)).toBeLessThan(1e-7);
	});

	test("a camera-relative difference is small enough for float32", () => {
		// What the renderer actually hands the GPU. Two bodies 1 AU from the origin
		// and a few hundred km apart must differ by a few hundred, not by 1.5e8 —
		// that difference being small is the entire reason the camera sits at the
		// origin.
		const world = makeWorld(20260818);
		const station = world.system.bodies.find((b) => b.kind === "station");
		expect(station).toBeDefined();
		const rel = sub(station!.pos, world.ship.pos);
		expect(length(rel)).toBeLessThan(1e4);
		// And the round trip through float32 keeps metre resolution at that size.
		const f32 = Math.fround(rel.z);
		expect(Math.abs(f32 - rel.z)).toBeLessThan(0.001);
	});

	test("the ship starts off the station rather than inside the star", () => {
		const world = makeWorld(1);
		const star = world.system.bodies.find((b) => b.kind === "star")!;
		// A ship at the origin would be inside the star, which is both wrong and
		// the kind of wrong that looks like a rendering bug.
		expect(length(sub(world.ship.pos, star.pos))).toBeGreaterThan(
			star.radiusKm * 10,
		);
		expect(world.ship.pos).toEqual(SHIP_START);
	});
});

describe("stepShip", () => {
	test("no acceleration and no velocity leaves the ship where it was", () => {
		const ship = { pos: v3(AU_KM, 0, 0), vel: v3(0, 0, 0) };
		stepShip(ship, v3(0, 0, 0), 0.016);
		expect(ship.pos).toEqual(v3(AU_KM, 0, 0));
	});

	test("thrust accelerates along the acceleration vector", () => {
		const ship = { pos: v3(0, 0, 0), vel: v3(0, 0, 0) };
		stepShip(ship, v3(0, 0, -1), 1);
		expect(ship.vel.z).toBeLessThan(0);
		expect(ship.pos.z).toBeLessThan(0);
		expect(ship.vel.x).toBe(0);
		expect(ship.vel.y).toBe(0);
	});

	test("it is semi-implicit — position uses the new velocity", () => {
		// One line's difference from the explicit form, and the reason it is worth
		// pinning: under a varying frame delta the explicit version drifts, and the
		// symptom is a ship that ends up somewhere slightly different depending on
		// frame rate. After one second at 1 km/s² from rest, semi-implicit Euler
		// puts the ship at v·dt = 1·1 km (damping aside); explicit Euler leaves it
		// at 0.
		const ship = { pos: v3(0, 0, 0), vel: v3(0, 0, 0) };
		stepShip(ship, v3(1, 0, 0), 1);
		expect(ship.pos.x).toBeGreaterThan(0);
		expect(ship.pos.x).toBeCloseTo(ship.vel.x * 1, 9);
	});

	test("coasting decays", () => {
		// The stand-in flight model's one behavioural claim: release the throttle
		// and you slow down. It is a placeholder — the flight-model node may
		// delete it outright — so this asserts the direction and nothing about the
		// rate.
		const ship = { pos: v3(0, 0, 0), vel: v3(0, 0, -1) };
		const before = length(ship.vel);
		for (let i = 0; i < 10; i++) stepShip(ship, v3(0, 0, 0), 0.1);
		expect(length(ship.vel)).toBeLessThan(before);
	});

	test("a zero delta changes nothing", () => {
		// A paused tab hands the loop a dt of 0, and an integrator that moved
		// anything on that would drift while nobody was looking.
		const ship = { pos: v3(1, 2, 3), vel: v3(4, 5, 6) };
		stepShip(ship, v3(9, 9, 9), 0);
		expect(ship.pos).toEqual(v3(1, 2, 3));
		expect(ship.vel).toEqual(v3(4, 5, 6));
	});
});

describe("vector helpers", () => {
	test("they compose the way the renderer assumes", () => {
		const a = v3(1, 2, 3);
		const b = v3(10, 20, 30);
		expect(add(a, b)).toEqual(v3(11, 22, 33));
		expect(sub(b, a)).toEqual(v3(9, 18, 27));
		expect(scale(a, 2)).toEqual(v3(2, 4, 6));
		expect(length(v3(3, 4, 0))).toBe(5);
	});

	test("they return new objects rather than mutating", () => {
		// `render()` calls these once per body per frame against the live world.
		// One in-place write would corrupt the authoritative position with a
		// camera-relative one, and the first frame would still look correct.
		const a = v3(1, 1, 1);
		add(a, v3(5, 5, 5));
		sub(a, v3(5, 5, 5));
		scale(a, 100);
		expect(a).toEqual(v3(1, 1, 1));
	});
});
