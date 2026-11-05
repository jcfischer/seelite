import { expect, test } from "bun:test";
import { FINE } from "../src/rock-drill";
import { v3 } from "../src/vec3";
import { gameMethods } from "./lib/game-methods";

test("a stowed idle drill silences audio without inspecting rocks", () => {
	const voices: number[][] = [];
	const subject = Object.assign(
		Object.create(
			gameMethods(["stepDrill"], {
				flightLive: () => true,
				collisionExempt: () => false,
			}),
		),
		{
			world: { gameTime: 1, ship: {} },
			dock: { phase: "flight" },
			drillCutter: () => ({}),
			drillArmed: () => false,
			drill: { extension: 0, spin: 0, held: null },
			audio: { drill: (...voice: number[]) => voices.push(voice) },
		},
	);
	subject.stepDrill(1 / 60);
	expect(voices).toEqual([[0, 0]]);
});

test("rock candidates are shared for a tick and refreshed after time or placement changes", () => {
	let scans = 0;
	const rocks = [{}];
	const subject = Object.assign(
		Object.create(
			gameMethods(["nearDrillRocks"], {
				FINE,
				nearRocks: () => {
					scans++;
					return rocks;
				},
			}),
		),
		{ world: { gameTime: 1, ship: { pos: v3() } }, fieldRockSets: () => [] },
	);
	expect(subject.nearDrillRocks()).toBe(rocks);
	expect(subject.nearDrillRocks()).toBe(rocks);
	expect(scans).toBe(1);
	subject.world.gameTime++;
	subject.nearDrillRocks();
	expect(scans).toBe(2);
	subject.world.ship.pos.x++;
	subject.nearDrillRocks();
	expect(scans).toBe(3);
});
