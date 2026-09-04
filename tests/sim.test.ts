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
	REFERENCE_ANGULAR_MAX,
	ASSIST_CAP_KMS,
	START_GALAXY,
	REFERENCE_THRUST_KMS2,
	advanceSystem,
	bodyAccelerationBound,
	bodyVelocity,
	makeSystem,
	makeWorld,
	stepAngular,
	stepFlight,
	stepWorld,
	flightPerformance,
} from "../src/sim";
import { generateGalaxy, startSystem } from "../src/galaxy";
import {
	ARRIVAL_CLEARANCE_AU,
	MAX_ORBIT_AU,
	arrivalPoint,
} from "../src/system";
import { AU_KM, FAR_SCALE } from "../src/units";
import { add, length, scale, sub, v3 } from "../src/vec3";
import { codeOf } from "./lib/source-scan";
import { PLAYER_BASELINE_HULL } from "../src/hull";

/**
 * The baseline hull's handling.
 *
 * #181 made `stepFlight` and `stepAngular` take a hull's performance rather than
 * read module constants, and every row in this file was written against the
 * courier's tuning — which `flightPerformance` reproduces exactly, so nothing
 * here changed its subject. This file owns the model's own laws;
 * `tests/hull.test.ts` owns the claim that the roster *varies*, and
 * `tests/hull-docking.test.ts` owns what the variation costs a docking approach.
 */
const BASELINE = flightPerformance(PLAYER_BASELINE_HULL);

const SEED = 20260818;

/** A world whose start system has several station types **and** a gas giant with
 *  moons — the two branches `SEED`'s system does not reach. Named once, because
 *  two tests below both need it and a galaxy reshape invalidates such a pick
 *  silently: re-find it with a scan over `makeWorld`, not by guessing. */
const MULTI_STATION_SEED = 2;

/** Hands off the controls: no throttle, assist on. What `stepWorld`'s clock
 *  tests want, since none of them is about the ship. */
const coasting = { nose: v3(0, 0, -1), throttle: 0, assist: true };

/** How many of a galaxy's 256 systems the geometry sweeps sample. */
const SAMPLED_SYSTEMS = 50;

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
		// A named seed, for the reason the moon test below carries: `SEED`'s start
		// system has one station and so reduces the assertion to `1 === 1`. It had
		// two until #118 reshaped the galaxy and every system moved — which is the
		// hazard, since a coverage loss like that is silent by construction.
		const world = makeWorld(MULTI_STATION_SEED);
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
		// types would prove nothing.
		expect(byType.size).toBeGreaterThan(1);
		expect(new Set(byType.values()).size).toBe(byType.size);
	});

	test("moons are carried through as their own bodies", () => {
		// A named seed, because `SEED`'s start system happens to have no gas giant
		// with moons and so exercises none of this. Leaving the moon path to
		// whichever system a default seed produced is how a branch goes untested
		// while the suite reads as covering it — the placeholder had no moons at
		// all, so nothing downstream had ever seen one. (It was seed 1 until #118;
		// the reshape moved every system, and seed 1's no longer has a moon. The
		// re-pick is the same act as the original one, for the same reason.)
		const world = makeWorld(MULTI_STATION_SEED);
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
		// `advanceSystem` writes by id and throws on a mismatch, so ordering is no
		// longer load-bearing *there*. It is still load-bearing here: the sibling
		// tests compare `bodies[i]` against a `before[i]` snapshot, and a
		// `placeBodies` whose output order varied with `gameTime` would make those
		// comparisons meaningless while every assertion still passed.
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
		stepWorld(world, coasting, 0.5, BASELINE);
		stepWorld(world, coasting, 0.25, BASELINE);
		expect(world.gameTime).toBeCloseTo(0.75, 12);
	});

	test("stepWorld moves the ship and the bodies together", () => {
		const world = makeWorld(SEED);
		const bodyBefore = { ...world.system.bodies[1].pos };
		// Frame-sized steps rather than one 60-second one, which is what the game
		// takes: `MAX_DT` caps a frame at 0.1 s, and the assist's damping is an
		// exponential in `dt` that only means anything at that scale.
		for (let i = 0; i < 100; i++) {
			stepWorld(
				world,
				{ nose: v3(0, 0, -1), throttle: 1, assist: true },
				0.1,
				BASELINE,
			);
		}
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

		// One galaxy, many systems — rather than one `makeWorld` call per sample,
		// each of which lays out a fresh 256-system galaxy through an O(n²)
		// connectivity scan to reach a single system. The assertion is per-body
		// geometry, so the galaxy is incidental and one layout serves every sample.
		//
		// Fifty of them: the worst case over 50 and over 200 is the same figure
		// (9,785 far-units at 6.54 AU), measured, so the larger sweep was buying
		// `generateContents` + `placeBodies` for 150 more systems on every CI run
		// and finding nothing further.
		const galaxy = generateGalaxy(SEED, START_GALAXY);
		let worst = 0;
		for (const record of galaxy.systems.slice(0, SAMPLED_SYSTEMS)) {
			const system = makeSystem(record, 0);
			const ship = arrivalPoint(record, system.contents, null, 0);
			for (const body of system.bodies) {
				const units = length(scale(sub(body.pos, ship), FAR_SCALE));
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

describe("stepFlight — #5's model, both regimes", () => {
	const NOSE = v3(0, 0, -1);
	const assisted = (throttle: number) => ({
		nose: NOSE,
		throttle,
		assist: true,
	});

	test("a zero delta changes nothing", () => {
		// A paused tab hands the loop a dt of 0, and an integrator that moved
		// anything on that would drift while nobody was looking.
		const ship = { pos: v3(1, 2, 3), vel: v3(4, 5, 6) };
		stepFlight(ship, assisted(1), 0, BASELINE);
		expect(ship.pos).toEqual(v3(1, 2, 3));
		expect(ship.vel).toEqual(v3(4, 5, 6));
	});

	test("the throttle commands a speed under assist, and it settles there", () => {
		// This is what makes it read as a modern space sim rather than as 1984:
		// half throttle means half the cap, held, not a thrust that accumulates.
		const ship = { pos: v3(), vel: v3() };
		for (let i = 0; i < 400; i++)
			stepFlight(ship, assisted(0.5), 0.05, BASELINE);
		expect(length(ship.vel)).toBeCloseTo(ASSIST_CAP_KMS * 0.5, 6);
		// And it is *along the nose*, not merely of that magnitude.
		expect(ship.vel.z).toBeCloseTo(-ASSIST_CAP_KMS * 0.5, 6);
	});

	test("assisted flight never exceeds #5's cap", () => {
		// The cap cruise's exit clamp is stated against (#10 §1), so it is not a
		// number to be approximately right about.
		const ship = { pos: v3(), vel: v3(0, 0, -50) };
		for (let i = 0; i < 200; i++) stepFlight(ship, assisted(1), 0.1, BASELINE);
		expect(length(ship.vel)).toBeLessThanOrEqual(ASSIST_CAP_KMS + 1e-9);
	});

	test("the assist kills sideways drift; without it the drift is forever", () => {
		// The one behaviour that separates the two regimes, and the reason the map
		// makes a velocity-vector marker load-bearing: with the assist off, the
		// nose and the velocity disagree permanently.
		const drifting = { pos: v3(), vel: v3(1, 0, 0) };
		for (let i = 0; i < 100; i++)
			stepFlight(drifting, assisted(0), 0.1, BASELINE);
		expect(Math.abs(drifting.vel.x)).toBeLessThan(0.01);

		const newtonian = { pos: v3(), vel: v3(1, 0, 0) };
		for (let i = 0; i < 100; i++) {
			stepFlight(
				newtonian,
				{ nose: NOSE, throttle: 0, assist: false },
				0.1,
				BASELINE,
			);
		}
		expect(newtonian.vel.x).toBeCloseTo(1, 12);
	});

	test("assist off is Newtonian: thrust accumulates past the cap", () => {
		const ship = { pos: v3(), vel: v3() };
		for (let i = 0; i < 100; i++) {
			stepFlight(
				ship,
				{ nose: NOSE, throttle: 1, assist: false },
				0.1,
				BASELINE,
			);
		}
		// Ten seconds at REFERENCE_THRUST_KMS2 with nothing taking it away.
		expect(-ship.vel.z).toBeCloseTo(REFERENCE_THRUST_KMS2 * 10, 6);
		expect(-ship.vel.z).toBeGreaterThan(ASSIST_CAP_KMS);
	});

	test("it is semi-implicit — position uses the new velocity", () => {
		// One line's difference from the explicit form, and the reason it is worth
		// pinning: under a varying frame delta the explicit version drifts, and the
		// symptom is a ship that ends up somewhere slightly different depending on
		// frame rate.
		const ship = { pos: v3(), vel: v3() };
		stepFlight(ship, { nose: NOSE, throttle: 1, assist: false }, 1, BASELINE);
		expect(ship.pos.z).toBeLessThan(0);
		expect(ship.pos.z).toBeCloseTo(ship.vel.z * 1, 9);
	});

	test("releasing the throttle under assist brings the ship to rest", () => {
		const ship = { pos: v3(), vel: v3(0, 0, -ASSIST_CAP_KMS) };
		for (let i = 0; i < 300; i++) stepFlight(ship, assisted(0), 0.1, BASELINE);
		expect(length(ship.vel)).toBeLessThan(1e-6);
	});

	test("at rest means at rest in the local frame, not the star's", () => {
		// #14's second frame finding, and the one that decides whether a station
		// can be arrived at *and stayed at*. Sim space is star-centred, so a
		// station on a 1 AU orbit is doing ~30 km/s; an assist that damps toward
		// the star's zero pushes the ship off the station at orbital speed the
		// moment the throttle is released.
		const frameVel = v3(0, 30, 0);
		const ship = { pos: v3(), vel: frameVel };
		for (let i = 0; i < 300; i++) {
			stepFlight(
				ship,
				{ nose: NOSE, throttle: 0, assist: true, frameVel },
				0.1,
				BASELINE,
			);
		}
		expect(length(sub(ship.vel, frameVel))).toBeLessThan(1e-6);
		// Thirty seconds of that, and the ship has kept pace rather than drifting
		// nearly a thousand kilometres behind.
		expect(ship.pos.y).toBeCloseTo(30 * 30, 0);

		// The cap is on the *relative* speed too: full throttle in the local frame
		// is the assist cap over the frame, not over the star.
		const running = { pos: v3(), vel: frameVel };
		for (let i = 0; i < 300; i++) {
			stepFlight(
				running,
				{ nose: NOSE, throttle: 1, assist: true, frameVel },
				0.1,
				BASELINE,
			);
		}
		expect(length(sub(running.vel, frameVel))).toBeCloseTo(ASSIST_CAP_KMS, 6);
	});

	test("assist off ignores the local frame — that is what unassisted means", () => {
		const frameVel = v3(0, 30, 0);
		const ship = { pos: v3(), vel: v3() };
		for (let i = 0; i < 10; i++) {
			stepFlight(
				ship,
				{ nose: NOSE, throttle: 0, assist: false, frameVel },
				0.1,
				BASELINE,
			);
		}
		expect(length(ship.vel)).toBe(0);
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
		// Every spelling, and the star form is the one that matters: the first
		// version of this guard matched only the named forms, so
		// `export * from "./vec3"` — the most idiomatic way to reinstate exactly
		// what it forbids — passed it. A guard that fails open on the natural
		// spelling of its subject is worse than no guard, because it is also a
		// claim that the subject is covered.
		const REEXPORT_FORMS = [
			/export\s*\*\s*(as\s+\w+\s*)?from\s*["']\.\/vec3["']/,
			/export\s*\{[^}]*\}\s*from\s*["']\.\/vec3["']/,
			/export\s+type\s*\{[^}]*\}\s*from\s*["']\.\/vec3["']/,
		];
		const code = codeOf("src/sim.ts");
		for (const form of REEXPORT_FORMS) expect(code).not.toMatch(form);

		// And the patterns are exercised against the text they are meant to catch.
		// A regex asserted only in the negative passes just as well when it matches
		// nothing at all, which is how the star-form hole survived being written.
		const samples = [
			'export * from "./vec3";',
			'export { add, sub } from "./vec3";',
			'export type { Vec3 } from "./vec3";',
		];
		for (const sample of samples) {
			expect(
				REEXPORT_FORMS.some((f) => f.test(sample)),
				sample,
			).toBe(true);
		}
	});
});

describe("stepAngular — rotation with momentum", () => {
	const still = { pitch: 0, yaw: 0, roll: 0 };
	const none = { pitch: 0, yaw: 0, roll: 0 };

	test("a turn eases in rather than snapping to its rate", () => {
		// One frame at full stick must not already be at the peak rate: the ship
		// answers the stick over a third of a second, and that ramp is the feel.
		const first = stepAngular(
			still,
			{ ...still, yaw: 1 },
			none,
			true,
			0.016,
			BASELINE,
		);
		expect(first.yaw).toBeGreaterThan(0);
		expect(first.yaw).toBeLessThan(REFERENCE_ANGULAR_MAX.yaw * 0.2);

		let rates = still;
		for (let i = 0; i < 60; i++) {
			rates = stepAngular(
				rates,
				{ ...still, yaw: 1 },
				none,
				true,
				0.016,
				BASELINE,
			);
		}
		expect(rates.yaw).toBeCloseTo(REFERENCE_ANGULAR_MAX.yaw, 6);
	});

	test("and eases out when the stick is released, with the assist on", () => {
		// The half that was missing, in the principal's words: "leaving a key stops
		// any motion immediately, not a gentle way of easing out".
		const spinning = { pitch: 0, yaw: REFERENCE_ANGULAR_MAX.yaw, roll: 0 };
		const oneFrame = stepAngular(spinning, none, none, true, 0.016, BASELINE);
		expect(oneFrame.yaw).toBeGreaterThan(REFERENCE_ANGULAR_MAX.yaw * 0.8);
		expect(oneFrame.yaw).toBeLessThan(REFERENCE_ANGULAR_MAX.yaw);

		let rates = spinning;
		for (let i = 0; i < 120; i++)
			rates = stepAngular(rates, none, none, true, 0.016, BASELINE);
		expect(rates.yaw).toBeLessThan(0.01);
	});

	test("with the assist off the ship keeps tumbling", () => {
		// Newtonian rotation, and the second place the two regimes visibly part.
		let rates = { pitch: 0.4, yaw: -0.2, roll: 0.1 };
		for (let i = 0; i < 200; i++)
			rates = stepAngular(rates, none, none, false, 0.016, BASELINE);
		expect(rates.pitch).toBeCloseTo(0.4, 12);
		expect(rates.yaw).toBeCloseTo(-0.2, 12);
	});

	test("the mouse enters as an impulse and is capped like everything else", () => {
		const kicked = stepAngular(
			still,
			none,
			{ ...still, yaw: 0.05 },
			true,
			0.016,
			BASELINE,
		);
		expect(kicked.yaw).toBeGreaterThan(0);
		// A flicked pointer cannot exceed the axis's peak rate.
		const flicked = stepAngular(
			still,
			none,
			{ ...still, yaw: 99 },
			true,
			0.016,
			BASELINE,
		);
		expect(flicked.yaw).toBe(REFERENCE_ANGULAR_MAX.yaw);
	});

	test("a zero delta changes nothing", () => {
		const rates = { pitch: 0.3, yaw: 0.2, roll: 0.1 };
		expect(
			stepAngular(
				rates,
				{ pitch: 1, yaw: 1, roll: 1 },
				none,
				true,
				0,
				BASELINE,
			),
		).toBe(rates);
	});
});

describe("body velocities, which arrival turned out to depend on", () => {
	// #14 flew the cruise regime and found that arriving is a *relative* problem:
	// a station on a 1 AU orbit is carried around the star at ~30 km/s, fifteen
	// times #5's 2 km/s assist cap. Everything about the drop-out and the exit
	// clamp is stated in the target's frame because of it, and that frame
	// comes from here.
	const world = makeWorld(SEED);

	test("a body's velocity is the derivative of its position", () => {
		// The claim that makes the analytic form worth having: it must agree with
		// what the positions actually do. Compared against a *central* difference
		// over a second of game time, which for a circular orbit of period hours
		// or longer is accurate to parts in 10⁻¹⁰.
		const dt = 1;
		for (const body of world.system.bodies) {
			if (body.kind === "star") continue;
			const before = makeSystem(
				world.system.record,
				world.gameTime - dt,
			).byId.get(body.id);
			const after = makeSystem(
				world.system.record,
				world.gameTime + dt,
			).byId.get(body.id);
			if (!before || !after) throw new Error(`no ${body.id}`);
			const numeric = scale(sub(after.pos, before.pos), 1 / (2 * dt));
			const analytic = bodyVelocity(world.system, body.id, world.gameTime);
			const error = length(sub(numeric, analytic));
			expect(error, body.id).toBeLessThan(1e-6 * Math.max(1, length(analytic)));
		}
	});

	test("the star does not move, and a station inherits its planet's motion", () => {
		expect(
			length(bodyVelocity(world.system, world.system.contents.star.id, 0)),
		).toBe(0);
		const station = world.system.contents.stations.find((s) => s.parentId);
		// Asserted rather than skipped: `if (!station?.parentId) return` made this
		// test pass on a system that happened to generate no parented station,
		// which is the shape of a test that reports green for having found
		// nothing to check.
		expect(station?.parentId).toBeTruthy();
		if (!station?.parentId) return;
		const planetKms = length(
			bodyVelocity(world.system, station.parentId, world.gameTime),
		);
		const stationKms = length(
			bodyVelocity(world.system, station.id, world.gameTime),
		);
		// Its own orbit around the planet is small beside the planet's around the
		// star, so the two are close — and both are far above the 2 km/s assist
		// cap, which is the whole finding.
		expect(planetKms).toBeGreaterThan(2);
		expect(Math.abs(stationKms - planetKms)).toBeLessThan(planetKms);
	});

	test("the acceleration bound contains frame-tangent orbital error", () => {
		const dt = 0.1;
		const after = makeSystem(world.system.record, world.gameTime + dt);
		for (const body of world.system.bodies) {
			const acceleration = bodyAccelerationBound(world.system, body.id);
			const predicted = add(
				body.pos,
				scale(bodyVelocity(world.system, body.id, world.gameTime), dt),
			);
			const exact = after.byId.get(body.id);
			if (!exact) throw new Error(`no ${body.id}`);
			const error = length(sub(exact.pos, predicted));
			expect(error, body.id).toBeLessThanOrEqual(
				0.5 * acceleration * dt * dt + 1e-7,
			);
		}
	});

	test("an unknown body is an error rather than a zero velocity", () => {
		// A zero would be a silent claim that the target is stationary, which
		// is exactly the assumption that made the first cruise approach unarrivable.
		expect(() => bodyVelocity(world.system, "no-such-body", 0)).toThrow();
		expect(() => bodyAccelerationBound(world.system, "no-such-body")).toThrow();
	});
});
