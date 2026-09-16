/**
 * What a destroyed raider leaves behind (node #324 part d): the lifecycle on
 * the game clock, and the cargo canisters the player can scoop.
 */
import { describe, expect, test } from "bun:test";
import { raiderSlots } from "../src/raider-slots";
import { ASSIST_CAP_KMS } from "../src/sim";
import {
	CANISTER_COUNT,
	CANISTER_EJECT_KMS,
	CANISTER_FADE_S,
	CANISTER_KEEP_FRACTION,
	CANISTER_LIFETIME_S,
	CANISTER_SCOOP_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
	type Canister,
	PLAYER_KILL,
	RAIDER_REPAIR_S,
	RAIDER_WRECK_S,
	cargoWeights,
	dropCanisters,
	raiderDestruction,
	scoops,
	stepCanisters,
} from "../src/raider-wreck";
import { newCommander, scoopCargo } from "../src/station-commerce";
import { add, dot, length, scale, sub, v3 } from "../src/vec3";
import {
	applyTransition,
	effectiveCarrier,
	newWorld,
} from "../src/world-state";
import { commodity } from "../src/market";

const SLOT = raiderSlots(9, 0)[1];

describe("the lifecycle", () => {
	test("is combat-model §4's thirty minutes, split ten and twenty", () => {
		expect(RAIDER_WRECK_S + RAIDER_REPAIR_S).toBe(30 * 60);
		expect(RAIDER_WRECK_S).toBe(10 * 60);
	});

	test("a kill is the player's destroy, scheduling the replacement", () => {
		const event = raiderDestruction(9, 500);
		expect(event.kind).toBe("destroy");
		expect(event.cause).toEqual(PLAYER_KILL);
		if (event.kind !== "destroy" || !event.schedule)
			throw new Error("no schedule");
		expect(event.schedule.startsAt).toBe(500 + RAIDER_WRECK_S);
		expect(event.schedule.completesAt).toBe(
			500 + RAIDER_WRECK_S + RAIDER_REPAIR_S,
		);
		expect(event.schedule.cause.playerRole).toBe("none");
	});

	test("applied to the slot, it reads destroyed, repairing, then replaced", () => {
		const w = applyTransition(
			newWorld(0x5ee11e),
			0,
			SLOT.key,
			raiderDestruction(9, 500),
		);
		const at = (t: number) => effectiveCarrier(w.galaxies[0], SLOT.key, t);
		expect(at(500).condition).toBe("destroyed");
		expect(at(500 + RAIDER_WRECK_S - 0.001).condition).toBe("destroyed");
		expect(at(500 + RAIDER_WRECK_S).condition).toBe("repairing");
		const done = at(500 + RAIDER_WRECK_S + RAIDER_REPAIR_S);
		expect(done.condition).toBe("operational");
		expect(done.instanceOrdinal).toBe(1);
	});
});

const kill = (overrides: Partial<Parameters<typeof dropCanisters>[0]> = {}) =>
	dropCanisters({
		systemSeed: 0x1234,
		government: 3,
		key: SLOT.key,
		killedAt: 812.4,
		pos: v3(100, 0, 0),
		vel: v3(0, 0, -1),
		frameVel: v3(0, 0, 0),
		...overrides,
		frameBodyId: overrides.frameBodyId ?? null,
	});

describe("the cargo drop", () => {
	/** A ship far enough away to scoop nothing, for rows about the drift. */
	const far = { pos: v3(1e6, 0, 0), vel: v3() };
	/** A frame that turns, as an orbit does. One copy: two rows had their own
	 *  and a change to one would have left them measuring different orbits. */
	const frameAt = (t: number) =>
		v3(30 * Math.cos(t / 100), 30 * Math.sin(t / 100), 0);

	test("the same kill drops the same canisters", () => {
		expect(kill()).toEqual(kill());
	});

	test("one to three one-tonne canisters, expiring five minutes after the kill", () => {
		const counts = new Set<number>();
		for (let s = 0; s < 400; s++) {
			const drop = kill({ killedAt: s });
			counts.add(drop.length);
			for (const c of drop) {
				expect(c.tonnes).toBe(1);
				expect(c.expiresAt).toBe(s + CANISTER_LIFETIME_S);
				const good = commodity(c.commodity);
				expect(good.unit).toBe("t");
				expect(good.sellOnly).toBe(false);
			}
		}
		expect([...counts].sort()).toEqual(
			Array.from(
				{ length: CANISTER_COUNT.max - CANISTER_COUNT.min + 1 },
				(_, i) => CANISTER_COUNT.min + i,
			),
		);
	});

	test("a Corporate State's raiders carry no contraband, and an Anarchy's do", () => {
		const illegalIn = (government: number) => {
			let n = 0;
			for (let s = 0; s < 600; s++)
				for (const c of kill({ government, killedAt: s }))
					if (commodity(c.commodity).illegal) n++;
			return n;
		};
		expect(illegalIn(7)).toBe(0);
		expect(illegalIn(0)).toBeGreaterThan(0);
		expect(
			cargoWeights(7).every((w) => !w.good.illegal || w.weight === 0),
		).toBe(true);
	});

	test("canisters keep a fifth of the wreck's frame velocity and leave it in different directions", () => {
		// The wreck flies 1 km/s along -z in a frame moving 30 km/s along +x.
		const frameVel = v3(30, 0, 0);
		const drift = v3(30, 0, -0.2);
		expect(CANISTER_KEEP_FRACTION).toBe(0.2);
		let pairs = 0;
		let threes = 0;
		for (let s = 0; s < 200; s++) {
			const drop = kill({ frameVel, vel: v3(30, 0, -1), killedAt: s });
			if (drop.length === 3) threes++;
			const ejections = drop.map((c) => sub(c.vel, drift));
			for (const [i, e] of ejections.entries()) {
				expect(length(e)).toBeCloseTo(CANISTER_EJECT_KMS, 9);
				expect(drop[i].pos).toEqual(v3(100, 0, 0));
				// **At least 120° from every other canister of the drop**, the
				// principal's "spread in different directions from the wreck".
				for (const other of ejections.slice(i + 1)) {
					pairs++;
					const cos = dot(e, other) / CANISTER_EJECT_KMS ** 2;
					expect(cos).toBeLessThanOrEqual(
						Math.cos((120 * Math.PI) / 180) + 1e-9,
					);
				}
			}
		}
		// Drops of three were drawn, or the 120° spacing asserted nothing: two
		// hundred drops of two alone would give two hundred pairs (sage #346).
		expect(threes).toBeGreaterThan(20);
		expect(pairs).toBeGreaterThan(100);
	});

	test("a canister comes to rest in its frame CANISTER_FADE_S after the kill, slowing linearly", () => {
		const frameVel = v3(30, 0, 0);
		const [c0] = kill({ frameVel, vel: v3(30, 0, -2), killedAt: 500 });
		expect(CANISTER_FADE_S).toBe(10);
		expect(c0.restsAt).toBe(500 + CANISTER_FADE_S);
		const relative = (c: Canister) => length(sub(c.vel, frameVel));
		const start = relative(c0);
		const dt = 1 / 60;
		/** The dropped canister stepped from the kill for `seconds`. */
		const at = (seconds: number) => {
			let c = c0;
			for (let t = 0; t < seconds - 1e-9; t += dt)
				c = stepCanisters(
					[c],
					far,
					dt,
					500 + t,
					() => true,
					() => frameVel,
				).kept[0];
			return c;
		};
		expect(relative(at(5)) / start).toBeCloseTo(0.5, 6);
		const rested = at(10);
		expect(relative(rested)).toBeLessThan(1e-9);
		// The distance it covered in its frame is the area under a straight
		// line: half its starting speed for the whole fade.
		const covered = length(
			sub(sub(rested.pos, c0.pos), scale(frameVel, CANISTER_FADE_S)),
		);
		expect(covered).toBeCloseTo((start * CANISTER_FADE_S) / 2, 6);
		expect(relative(at(15))).toBe(0);
	});

	test("a canister comes to rest in the frame as it stands, not the frame at the kill", () => {
		// The sixth playtest: "it felt like they were on trajectories much longer
		// than 10s". `scripts/measure-canister-drift.mjs` parked beside a station
		// read the canister 55 km out and still opening at 0.94 km/s two minutes
		// after it had come to rest — because a station's frame keeps turning
		// while a frozen velocity does not, and the pilot's assist flies the
		// frame as it stands. Deep space hid it: that frame is the star's and
		// never moves, and every flown duel lands there.
		const atKill = v3(30, 0, 0);
		const [c0] = kill({ frameVel: atKill, vel: v3(30, 0, -2), killedAt: 500 });
		const dt = 1 / 60;
		let c = c0;
		let last = atKill;
		for (let t = 0; t < 15 - 1e-9; t += dt) {
			last = frameAt(t);
			c = stepCanisters(
				[c],
				far,
				dt,
				500 + t,
				() => true,
				() => last,
			).kept[0];
		}
		expect(length(sub(c.vel, last))).toBeLessThan(1e-9);
		// And it is not the kill's frame: that is the drift the playtest flew.
		expect(length(sub(c.vel, atKill))).toBeGreaterThan(0.1);
	});

	test("a canister keeps station with a turning frame, which is what the playtest saw", () => {
		// The velocity row above holds by construction once `share` is 0. The
		// symptom was **range** — 55 km and opening — so this one integrates a
		// point carried by the frame and asks how far the canister is from it
		// (sage #355).
		const dt = 1 / 60;
		const [c0] = kill({
			frameVel: frameAt(0),
			vel: v3(30, 0, -2),
			killedAt: 500,
		});
		let c = c0;
		// A mark dropped at the canister's position, carried by the frame.
		let mark = c0.pos;
		for (let t = 0; t < 120 - 1e-9; t += dt) {
			const frame = frameAt(t);
			c = stepCanisters(
				[c],
				far,
				dt,
				500 + t,
				() => true,
				() => frame,
			).kept[0];
			mark = add(mark, scale(frame, dt));
		}
		// The same run, against a canister that froze the kill's frame — the
		// build this replaced. **A comparative claim, measured here**: the first
		// version of this row asserted an absolute bound derived from the fade's
		// geometry, which the tracked canister misses by 5x. What the playtest
		// reported is one of these staying and the other leaving.
		let frozen = c0;
		for (let t = 0; t < 120 - 1e-9; t += dt)
			frozen = stepCanisters(
				[frozen],
				far,
				dt,
				500 + t,
				() => true,
				() => frameAt(0),
			).kept[0];
		const tracked = length(sub(c.pos, mark));
		const stranded = length(sub(frozen.pos, mark));
		expect(stranded).toBeGreaterThan(20);
		expect(tracked).toBeLessThan(stranded / 10);
	});

	test("a canister rests in its own body's frame, not the observer's", () => {
		// `localFrame()` follows the *ship*: a pilot who kills beside a station
		// and flies past NEAR_FAR_KM would drop every canister there to star
		// rest and lose them inside their five minutes (sage #355). The stepper
		// resolves a frame per canister, from the body the kill happened beside.
		const station = v3(0, 29, 0);
		const [near] = kill({ frameVel: station, frameBodyId: "58:station-0" });
		const [away] = kill({ frameVel: v3(), frameBodyId: null, killedAt: 900 });
		const frames: Record<string, ReturnType<typeof v3>> = {
			"58:station-0": station,
		};
		const frameFor = (c: Canister) =>
			c.frameBodyId ? frames[c.frameBodyId] : v3();
		let pair = [near, away];
		for (let t = 0; t < 12; t += 1 / 60)
			pair = stepCanisters(
				pair,
				far,
				1 / 60,
				950 + t,
				() => true,
				frameFor,
			).kept;
		// One rests with its station, the other in star coordinates — from one
		// step, with the observer nowhere near either.
		expect(length(sub(pair[0].vel, station))).toBeLessThan(1e-9);
		expect(length(pair[1].vel)).toBeLessThan(1e-9);
	});

	test("a canister from a wreck at the assist cap is closable at the cap", () => {
		// The playtest's case: a fleeing raider dies at the cap, and a canister
		// that kept its velocity held its range against a ship at the cap.
		const frameVel = v3(0, 0, 0);
		for (let s = 0; s < 200; s++)
			for (const c of kill({
				killedAt: s,
				frameVel,
				vel: v3(ASSIST_CAP_KMS, 0, 0),
			}))
				expect(length(sub(c.vel, frameVel))).toBeLessThanOrEqual(
					ASSIST_CAP_KMS / 2,
				);
	});
});

describe("drift, expiry and the scoop", () => {
	const canister: Canister = {
		id: "c",
		commodity: "Food",
		tonnes: 1,
		pos: v3(0, 0, 0),
		vel: v3(0.01, 0, 0),
		frameBodyId: null,
		restsAt: 100,
		expiresAt: 100,
	};

	const farShip = { pos: v3(10, 0, 0), vel: v3() };
	const takeAll = () => true;
	// The frame these rows step in, as the resolver the stepper takes. At rest
	// in it, so they see a constant velocity; the fade is the drop rows'
	// question.
	const carried = () => v3(0.01, 0, 0);
	const still = () => v3();

	test("a canister drifts on its velocity and is gone at `expiresAt`", () => {
		const [moved] = stepCanisters(
			[canister],
			farShip,
			2,
			50,
			takeAll,
			carried,
		).kept;
		expect(moved.pos.x).toBeCloseTo(0.02, 12);
		expect(
			stepCanisters([canister], farShip, 0.1, 99.999, takeAll, carried).kept,
		).toHaveLength(1);
		expect(
			stepCanisters([canister], farShip, 0.1, 100, takeAll, carried).kept,
		).toHaveLength(0);
	});

	test("the scoop is tested before the drift", () => {
		// Drifted first, this canister is 0.2 km off the ship and out of reach.
		const moving = { ...canister, vel: v3(0.2, 0, 0) };
		const ship = { pos: v3(0, 0, 0), vel: v3() };
		const step = stepCanisters([moving], ship, 1, 50, takeAll, still);
		expect(step.kept).toHaveLength(0);
		expect(step.scoops).toEqual([{ canister: moving, accepted: true }]);
	});

	test("a canister the hold refuses stays in space and drifts on", () => {
		const ship = { pos: v3(0, 0, 0), vel: v3() };
		const step = stepCanisters([canister], ship, 2, 50, () => false, carried);
		expect(step.scoops).toEqual([{ canister, accepted: false }]);
		expect(step.kept).toHaveLength(1);
		expect(step.kept[0].pos.x).toBeCloseTo(0.02, 12);
	});

	test("the step that reaches rest moves the fading part only until rest", () => {
		// 0.2 km/s in a still frame, at rest 0.1 s into a 0.25 s step: it covers
		// the area of the triangle up to rest and nothing after (sage #346).
		const fading = {
			...canister,
			vel: v3(0.2, 0, 0),
			restsAt: 50.1,
		};
		const [moved] = stepCanisters(
			[fading],
			farShip,
			0.25,
			50,
			takeAll,
			still,
		).kept;
		expect(moved.pos.x).toBeCloseTo((0.2 * 0.1) / 2, 12);
		expect(moved.vel).toEqual(v3(0, 0, 0));
	});

	test("a close, slow pass scoops it; a far or a fast one does not", () => {
		const slow = { pos: v3(CANISTER_SCOOP_RADIUS_KM * 0.5, 0, 0), vel: v3() };
		expect(scoops(canister, slow)).toBe(true);
		expect(
			scoops(canister, {
				...slow,
				pos: v3(CANISTER_SCOOP_RADIUS_KM * 2, 0, 0),
			}),
		).toBe(false);
		expect(
			scoops(canister, {
				...slow,
				vel: v3(CANISTER_SCOOP_SPEED_KMS * 2, 0, 0),
			}),
		).toBe(false);
	});

	test("a scooped tonne goes into the hold, and a full hold refuses it", () => {
		const commander = newCommander("courier");
		const took = scoopCargo(commander, "Food", 1);
		expect(took.accepted).toBe(true);
		expect(took.commander.cargo.Food).toBe(1);
		const full = { ...commander, cargo: { Food: 10_000 } };
		const refused = scoopCargo(full, "Food", 1);
		expect(refused.accepted).toBe(false);
		expect(refused.commander).toBe(full);
	});
});
