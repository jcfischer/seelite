import { expect, test } from "bun:test";
import { rememberFlightFixture } from "../scripts/lib/probe-flight-fixture.mjs";

test("a reused fixture restores its commander and clears the old dock before any reset frame", async () => {
	const frames: unknown[] = [];
	const g = {
		commander: { credits: 100, cargo: { Food: 0 } },
		commerceWorld: { galaxies: new Map([[0, "clean"]]) },
		view: "cockpit",
		dock: "flying",
		world: { gameTime: 0, ship: { pos: { x: 100, y: 200, z: 300 } } },
		occlusionState: { open: false, pending: 0 },
		trafficSystemIndex: 1,
		traffic: "fresh",
		resetDock() {
			this.dock = "flying";
		},
		clearSystemScopedState() {
			this.traffic = "cleared";
		},
		resetFlightToStart() {
			expect(this.dock).toBe("flying");
			this.world.gameTime = 0;
			this.world.ship.pos = { x: 100, y: 200, z: 300 };
		},
		ensureTrafficActors() {
			if (this.trafficSystemIndex === 1) return;
			this.traffic = "fresh";
			this.trafficSystemIndex = 1;
		},
		setHeadLook() {},
	};
	const win = {
		__seelite: g,
		__rememberBootPosition() {},
		__returnToBootPosition() {},
		__startClockAt(t: number) {
			g.world.gameTime = t;
			frames.push({
				dock: g.dock,
				pos: g.world.ship.pos,
				credits: g.commander.credits,
			});
		},
	};
	const evaluate = async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
		const hadWindow = Object.hasOwn(globalThis, "window");
		const previous = globalThis.window;
		Object.assign(globalThis, { window: win });
		try {
			return await fn(arg);
		} finally {
			if (hadWindow) Object.assign(globalThis, { window: previous });
			else Reflect.deleteProperty(globalThis, "window");
		}
	};
	const page = { evaluate, evaluateHandle: evaluate };
	const reset = await rememberFlightFixture(page);
	for (let i = 0; i < 2; i++) {
		g.commander.credits = 9999;
		g.commander.cargo.Food = 20;
		g.commerceWorld = { galaxies: new Map([[0, "wanted"]]) };
		g.dock = "launching";
		g.world.gameTime = 900;
		g.world.ship.pos = { x: 0, y: 0, z: 0 };
		await reset();
		expect(g.commander).toEqual({ credits: 100, cargo: { Food: 0 } });
		expect(g.commerceWorld.galaxies.get(0)).toBe("clean");
		expect(g.traffic).toBe("fresh");
	}
	expect(frames).toEqual(
		Array(2).fill({
			dock: "flying",
			pos: { x: 100, y: 200, z: 300 },
			credits: 100,
		}),
	);
});
