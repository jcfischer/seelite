/**
 * The float64 world: the clock, the adapter, and the integrator's shape.
 *
 * What this file used to guard was a placeholder generator that invented a star
 * and two planets. That is gone, and so are its tests — the generator's own
 * properties are `tests/galaxy.test.ts`'s business and duplicating them here
 * would mean two files to change when the spec moves. What is left is the part
 * `sim.ts` actually owns: that the clock drives the bodies, that the adapter
 * hands the renderer a stable set of them, and that arithmetic at 1 AU still
 * resolves metres.
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
	START_GALAXY,
	advanceSystem,
	makeSystem,
	makeWorld,
	stepShip,
	stepWorld,
} from "../src/sim";
import { generateGalaxy, startSystem } from "../src/galaxy";
import { ARRIVAL_CLEARANCE_AU, MAX_ORBIT_AU } from "../src/system";
import { AU_KM, FAR_SCALE } from "../src/units";
import { add, length, scale, sub, v3 } from "../src/vec3";
import { codeOf } from "./lib/source-scan";

const SEED = 20260818;

describe("makeWorld", () => {
	test("it starts in galaxy 0's start system, at t = 0", () => {
		const world = makeWorld(SEED);
		const expected = startSystem(generateGalaxy(SEED, START_GALAXY));
		expect(world.gameTime).toBe(0);
		expect(world.system.record.seed).toBe(expected.seed);
		expect(world.system.record.name).toBe(expected.name);
		// The start rule itself (spec §5.1) is galaxy.test.ts's; what is asserted
		// here is that the world is wired to it rather than to an index.
		expect(world.system.record.displayTL).toBeGreaterThanOrEqual(8);
		expect(world.system.record.government).toBeGreaterThanOrEqual(5);
	});

	test("the same seed gives the same world, a different seed does not", () => {
		const a = makeWorld(SEED);
		const b = makeWorld(SEED);
		const c = makeWorld(SEED + 1);
		expect(a.ship.pos).toEqual(b.ship.pos);
		expect(a.system.bodies).toEqual(b.system.bodies);
		expect(a.system.record.seed).not.toBe(c.system.record.seed);
	});

	test("the ship starts at the arrival point, clear of every body", () => {
		// §7.4's clearance, asserted through the world rather than through
		// `arrivalPoint` directly — the value only protects the player if the thing
		// that positions the ship is the thing that computed it.
		const world = makeWorld(SEED);
		const clearanceKm = ARRIVAL_CLEARANCE_AU * AU_KM;
		for (const body of world.system.bodies) {
			expect(length(sub(body.pos, world.ship.pos))).toBeGreaterThanOrEqual(
				clearanceKm,
			);
		}
		// And outside the star rather than merely clear of it, which is the failure
		// that looks like a rendering bug instead of a placement one.
		expect(length(world.ship.pos)).toBeGreaterThan(0.5 * AU_KM);
	});

	test("it produces a real system: one star, planets, at least one station", () => {
		const kinds = makeWorld(SEED).system.bodies.map((b) => b.kind);
		expect(kinds.filter((k) => k === "star").length).toBe(1);
		expect(kinds.filter((k) => k === "planet").length).toBeGreaterThanOrEqual(
			1,
		);
		// The trade station is unconditional (§6.4), so a system with none is a
		// dead end and this is not a soft expectation.
		expect(kinds.filter((k) => k === "station").length).toBeGreaterThanOrEqual(
			1,
		);
	});

	test("every body carries a colour the renderer can use", () => {
		// `PlacedBody` has no appearance; supplying one is this module's job, and a
		// body that arrived without it would render black rather than throw.
		for (const body of makeWorld(SEED).system.bodies) {
			expect(Number.isInteger(body.color)).toBe(true);
			expect(body.color).toBeGreaterThanOrEqual(0);
			expect(body.color).toBeLessThanOrEqual(0xffffff);
		}
	});

	test("each station type gets its own colour", () => {
		// The point of colouring a station at all is that its type is legible
		// before anything else about it. An earlier version keyed the lookup on the
		// body *id* with a grey fallback, so a renamed or new station id silently
		// returned the same grey as a trade post — with no type error, and passing
		// the only colour assertion there was (`Number.isInteger`). Keying on the
		// type makes an unhandled type a compile error; this asserts the
		// consequence that error exists to protect.
		const world = makeWorld(SEED);
		const stations = world.system.bodies.filter((b) => b.kind === "station");
		expect(stations.length).toBeGreaterThan(1);
		const byType = new Map<string, number>();
		for (const s of stations) {
			const type = world.system.contents.stations.find(
				(x) => x.id === s.id,
			)?.type;
			expect(type).toBeDefined();
			byType.set(type!, s.color);
		}
		// Without this the assertion below reduces to `1 === 1` whenever the seed's
		// stations happen to share a type, and a test named for distinguishing
		// types would prove nothing. SEED's system has a trade post and a refinery.
		expect(byType.size).toBeGreaterThan(1);
		expect(new Set(byType.values()).size).toBe(byType.size);
	});

	test("moons are carried through as their own bodies", () => {
		// A named seed, because `SEED`'s start system happens to have no gas giant
		// with moons and so exercises none of this. Leaving the moon path to
		// whichever system a default seed produced is how a branch goes untested
		// while the suite reads as covering it — the placeholder had no moons at
		// all, so nothing downstream had ever seen one.
		const world = makeWorld(1);
		const moons = world.system.bodies.filter((b) => b.kind === "moon");
		expect(moons.length).toBeGreaterThan(0);
		for (const moon of moons) {
			// `placeBodies` returns a moon's position already offset by its planet's,
			// so a moon must sit within its own orbit radius of that planet and not
			// at the system origin — the failure a forgotten offset produces.
			const planetId = moon.id.replace(/-moon-\d+$/, "");
			const planet = world.system.bodies.find((b) => b.id === planetId);
			expect(planet).toBeDefined();
			const gap = length(sub(moon.pos, planet!.pos));
			expect(gap).toBeGreaterThan(planet!.radiusKm);
			expect(gap).toBeLessThan(1e7);
			expect(Number.isInteger(moon.color)).toBe(true);
		}
	});
});

describe("the game clock", () => {
	const record = () => startSystem(generateGalaxy(SEED, START_GALAXY));

	test("the body order does not depend on the clock", () => {
		// The invariant `advanceSystem` rests on: it writes positions back by
		// index, so a `placeBodies` whose output order varied with `gameTime` would
		// silently swap two bodies' positions rather than fail.
		const at0 = makeSystem(record(), 0).bodies.map((b) => `${b.kind}:${b.id}`);
		const at1e7 = makeSystem(record(), 1e7).bodies.map(
			(b) => `${b.kind}:${b.id}`,
		);
		expect(at1e7).toEqual(at0);
	});

	test("advancing the clock moves the bodies", () => {
		const system = makeSystem(record(), 0);
		const before = system.bodies.map((b) => ({ ...b.pos }));
		// A quarter of a year: every orbit in the envelope (0.3–6 AU) has moved a
		// visible fraction of its period by then.
		advanceSystem(system, 86400 * 91);
		const moved = system.bodies.filter(
			(b, i) => length(sub(b.pos, before[i])) > 1,
		);
		// Everything but the star, which sits at the origin by construction (§7.4).
		expect(moved.length).toBe(system.bodies.length - 1);
		expect(system.bodies.find((b) => b.kind === "star")?.pos).toEqual(
			v3(0, 0, 0),
		);
	});

	test("a position is a function of the clock, not of how it got there", () => {
		// The property that makes the clock saveable: loading a save jumps straight
		// to a `gameTime` rather than replaying every frame that produced it.
		const stepped = makeSystem(record(), 0);
		for (let t = 0; t <= 5000; t += 250) advanceSystem(stepped, t);
		const direct = makeSystem(record(), 5000);
		expect(stepped.bodies.map((b) => b.pos)).toEqual(
			direct.bodies.map((b) => b.pos),
		);
	});

	test("stepWorld advances sim time by exactly dt", () => {
		// Never compressed (#10). Cruise is fictional FTL, not a time-scale hack,
		// so a multiplier appearing here is the thing the constraint forbids.
		const world = makeWorld(SEED);
		stepWorld(world, v3(0, 0, 0), 0.5);
		stepWorld(world, v3(0, 0, 0), 0.25);
		expect(world.gameTime).toBeCloseTo(0.75, 12);
	});

	test("stepWorld moves the ship and the bodies together", () => {
		const world = makeWorld(SEED);
		const bodyBefore = { ...world.system.bodies[1].pos };
		// Frame-sized steps rather than one 60-second one. `SHIP_DAMPING` is a
		// per-second linear factor, so a `dt` past 1/0.6 drives it negative and the
		// clamp zeroes the velocity outright — a step that large is outside what
		// the stand-in integrator means, and `MAX_DT` is why the game never takes
		// one.
		for (let i = 0; i < 100; i++) stepWorld(world, v3(0, 0, -1), 0.1);
		expect(world.gameTime).toBeCloseTo(10, 9);
		expect(length(world.ship.vel)).toBeGreaterThan(0);
		expect(length(sub(world.system.bodies[1].pos, bodyBefore))).toBeGreaterThan(
			0,
		);
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

	test("a far-layer coordinate stays inside the float32 budget", () => {
		// What the renderer actually hands the GPU, now that the world is real.
		//
		// The scaffold's version measured a station 40 km away and concluded the
		// near layer was fine — a claim about a placeholder's chosen constant, not
		// about the scheme. The claim worth pinning is the far layer's, because
		// that is the one with a bound to violate.
		//
		// **Over many seeds, and against the derived bound.** The first version of
		// this test checked one seed against a flat 10⁴ and passed. Measured over
		// 400 seeds, two of them exceed 10⁴ — worst 10,150 far-units at 6.78 AU on
		// seed 350 — so it passed by seed luck, not because the scheme guaranteed
		// it. Its stated derivation checked `MAX_ORBIT_AU` alone, which is the
		// distance from the *star*, while the loop measured distance from the
		// *ship*: a different quantity, and the larger one.
		//
		// The real bound is the two summed. Bodies sit inside `MAX_ORBIT_AU` of
		// the star; the arrival point starts at `ARRIVAL_DISTANCE_AU` and is pushed
		// outward only far enough to clear the outermost body, so the ship is
		// inside `MAX_ORBIT_AU + ARRIVAL_CLEARANCE_AU`. Worst case is a body
		// diametrically opposite.
		const boundAu = 2 * MAX_ORBIT_AU + ARRIVAL_CLEARANCE_AU;
		const boundUnits = boundAu * AU_KM * FAR_SCALE;
		// Still an order of magnitude below where `units.ts` says quantisation
		// becomes visible (10⁵), which is what makes 10⁴ a comfort target rather
		// than a limit — and why exceeding it by 1.5% is not a defect.
		expect(boundUnits).toBeLessThan(1e5);

		let worst = 0;
		for (let seed = 1; seed <= 120; seed++) {
			const world = makeWorld(seed);
			for (const body of world.system.bodies) {
				const units = length(scale(sub(body.pos, world.ship.pos), FAR_SCALE));
				worst = Math.max(worst, units);
				expect(units).toBeLessThan(boundUnits);
			}
		}
		// And the bound is not vacuous — a derivation nothing comes close to would
		// pass whatever the generator did.
		expect(worst).toBeGreaterThan(0.2 * boundUnits);
	});

	test("a camera-relative difference keeps metre resolution in float32", () => {
		// The near layer's half. Two points a few hundred metres apart at 1 AU must
		// still differ by a few hundred metres after the trip through float32 —
		// that difference being small is the entire reason the camera sits at the
		// origin.
		const a = v3(AU_KM, 0, 0);
		const b = add(a, v3(0, 0, 0.4));
		const rel = sub(b, a);
		expect(length(rel)).toBeCloseTo(0.4, 9);
		expect(Math.abs(Math.fround(rel.z) - rel.z)).toBeLessThan(0.001);
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
		// and you slow down. It is a placeholder — the flight-model implementation
		// may delete it outright — so this asserts the direction and nothing about
		// the rate.
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

	test("vec3.ts is the only path to the vectors", () => {
		// The vectors moved to `vec3.ts` to break an import cycle, and `sim.ts`
		// briefly re-exported them so its callers did not all have to change at
		// once. That left two public paths to the same symbols and the tree
		// promptly used both — `main.ts` importing from `./sim` while `system.ts`
		// imported from `./vec3` — which is the leaf boundary being undermined by
		// the shim meant to protect it.
		//
		// Asserted on the source rather than on the module object, because the
		// failure is a re-export line reappearing for convenience, and a
		// re-exported binding is *identical* to the original: no runtime check can
		// tell the two paths apart. That is exactly why the shim was cheap to add
		// and invisible once added.
		expect(codeOf("src/sim.ts")).not.toMatch(
			/export\s*\{[^}]*\}\s*from\s*["']\.\/vec3["']/,
		);
		expect(codeOf("src/sim.ts")).not.toMatch(
			/export\s+type\s*\{[^}]*\}\s*from\s*["']\.\/vec3["']/,
		);
	});
});
