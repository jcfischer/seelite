import {
	migrateEquipment,
	equipmentNames,
	stockLoadout,
	moduleRow,
} from "../src/loadout";

import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy, startSystem } from "../src/galaxy";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import {
	type CommanderRecord,
	newCommanderRecord,
	parseSave,
	type SaveEnvelope,
	serializeSave,
} from "../src/save-envelope";
import { START_GALAXY } from "../src/sim";
import { newCommander, STARTING_CREDITS } from "../src/station-commerce";
import { generateContents } from "../src/system";
import { hasDocked } from "../src/death-checkpoint";
import { applyHoldEvent } from "../src/holdings";
import { emptyPending } from "../src/ladder";
import {
	CommanderCatalog,
	DEFAULT_SLOT,
	memorySaveBackend,
	memorySlotLocks,
	webSlotLocks,
	type Scheduler,
	SAVE_DEBOUNCE_MS,
	SAVE_RETRY_LIMIT,
	SaveStore,
	type SlotLocks,
} from "../src/save-store";
import { heldSaveFault } from "../src/save-badge";
import { LOCAL_CARRIER_ID } from "../src/station";
import { newWorld, visit, withoutDeathWreck } from "../src/world-state";
import { deathWreckRow } from "../src/death-wreck";

const SEED = 0x5ee11e;
const KEY = carrierKey(3, LOCAL_CARRIER_ID.trade);

const manualScheduler = () => {
	let pending: (() => void) | null = null;
	let lastDelayMs = -1;
	const scheduler: Scheduler = (fn, ms) => {
		pending = fn;
		lastDelayMs = ms;
		return () => {
			if (pending === fn) pending = null;
		};
	};
	return {
		scheduler,
		get armed() {
			return pending !== null;
		},
		get lastDelayMs() {
			return lastDelayMs;
		},
		fire() {
			const fn = pending;
			pending = null;
			fn?.();
		},
	};
};

const envelope = (credits: number): SaveEnvelope => ({
	world: visit(newWorld(SEED), 0, 3),
	commander: {
		...newCommanderRecord("courier"),
		state: { ...newCommanderRecord("courier").state, credits },
	},
});

const harness = (
	options: {
		permadeath?: boolean;
		backend?: ReturnType<typeof memorySaveBackend>;
		locks?: SlotLocks;
		slot?: string;
	} = {},
) => {
	const clock = manualScheduler();
	const backend = options.backend ?? memorySaveBackend();
	const locks = options.locks ?? memorySlotLocks();
	let state = envelope(100);
	if (options.permadeath)
		state = {
			...state,
			commander: { ...state.commander, permadeath: true },
		};
	const store = new SaveStore({
		backend,
		locks,
		schedule: clock.scheduler,
		current: () => state,
		slot: options.slot,
	});
	return {
		clock,
		backend,
		locks,
		store,
		catalog: new CommanderCatalog({ backend, locks }),
		set(credits: number) {
			state = {
				...state,
				commander: {
					...state.commander,
					state: { ...state.commander.state, credits },
				},
			};
		},
		edit(change: (c: CommanderRecord) => CommanderRecord) {
			state = { ...state, commander: change(state.commander) };
		},
		leg(systemIndex: number, seconds: number) {
			const world = visit(state.world, 0, systemIndex);
			state = {
				world: { ...world, gameTime: world.gameTime + seconds },
				commander: {
					...state.commander,
					ladders: {
						...state.commander.ladders,
						playedS: state.commander.ladders.playedS + seconds,
					},
				},
			};
		},
		get world() {
			return state.world;
		},
		get commander(): CommanderRecord {
			return state.commander;
		},
	};
};

describe("#89 D4 — the write cadence", () => {
	test("N changes inside the window produce exactly one write", async () => {
		const h = harness();
		h.store.markDirty();
		h.set(200);
		h.store.markDirty();
		h.set(300);
		h.store.markDirty();
		expect(h.backend.writes).toBe(0);
		expect(h.clock.armed).toBe(true);
		expect(h.clock.lastDelayMs).toBe(SAVE_DEBOUNCE_MS);
		h.clock.fire();
		await h.store.settled();
		expect(h.backend.writes).toBe(1);
		const latest = await h.store.load("default");
		expect(latest.commander.state.credits).toBe(300);
	});

	test("a dock, undock, jump or quit flushes regardless of the window", async () => {
		for (const reason of ["dock", "undock", "jump", "quit"] as const) {
			const h = harness();
			h.store.markDirty();
			await h.store.flush(reason);
			expect(h.backend.writes).toBeGreaterThanOrEqual(1);
			expect(h.clock.armed).toBe(false);
		}
	});

	test("a flush with nothing dirty writes nothing — except quit and undock", async () => {
		const h = harness();
		for (const reason of ["dock", "jump"] as const) {
			await h.store.flush(reason);
			expect(h.backend.writes).toBe(0);
		}
		await h.store.flush("quit");
		expect(h.backend.writes).toBe(1);
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
		await h.store.flush("undock");
		expect(h.backend.writes).toBe(2);
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
	});

	test("a new game's first flush writes `live` with nothing dirty, and only `live`", async () => {
		const h = harness({ slot: "New" });
		await h.store.flush("new-game");
		expect(h.backend.writes).toBe(1);
		expect(await h.backend.has("New", "live")).toBe(true);
		expect(await h.backend.has("New", "lastDocked")).toBe(false);
	});

	test("a flush during a debounced write queues behind it rather than racing", async () => {
		const h = harness();
		h.backend.hold();
		h.store.markDirty();
		h.clock.fire();
		expect(h.backend.inFlight).toBe(1);
		h.set(900);
		h.store.markDirty();
		const flushed = h.store.flush("dock");
		h.backend.release();
		await flushed;
		await h.store.settled();
		expect(h.backend.maxInFlight).toBe(1);
		expect(
			(await h.store.load("default", "lastDocked")).commander.state.credits,
		).toBe(900);
	});

	test("dirt arriving during a write produces one more write, not an overlap", async () => {
		const h = harness();
		h.backend.hold();
		h.store.markDirty();
		h.clock.fire();
		h.set(900);
		h.store.markDirty();
		expect(h.backend.inFlight).toBe(1);
		h.backend.release();
		await h.store.settled();
		expect(h.clock.armed).toBe(true);
		h.clock.fire();
		await h.store.settled();
		expect(h.backend.maxInFlight).toBe(1);
		expect(h.backend.writes).toBe(2);
		expect((await h.store.load("default")).commander.state.credits).toBe(900);
	});
});

describe("#89's D7 correction — a slot holds two records", () => {
	test("a dock flush writes both records; anything else writes only live", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump");
		expect((await h.store.load("default")).commander.state.credits).toBe(555);
		expect(
			(await h.store.load("default", "lastDocked")).commander.state.credits,
		).toBe(100);
	});

	test("a non-permadeath death restores the last dock, losing the leg", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump");
		const restored = await h.store.restoreAfterDeath("default", h.commander);
		expect(restored?.commander.state.credits).toBe(100);
	});

	test("a permadeath commander cannot be restored", async () => {
		const h = harness({ permadeath: true });
		h.store.markDirty();
		await h.store.flush("dock");
		expect(await h.store.restoreAfterDeath("default", h.commander)).toBeNull();
	});

	test("death does not flush — the tab-close window is left open on purpose", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		const before = h.backend.writes;
		await h.store.restoreAfterDeath("default", h.commander);
		expect(h.backend.writes).toBe(before);
	});
});

describe("#324 O5 — a death reverts live to the last dock", () => {
	const dockThenJump = async (h: ReturnType<typeof harness>) => {
		h.store.markDirty();
		await h.store.flush("dock");
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump");
	};

	test("the commander becomes the last dock's commander", async () => {
		const h = harness();
		await dockThenJump(h);
		const dock = (await h.store.load("default", "lastDocked")).commander;
		const restored = await h.store.revertToLastDocked(h.commander, "eject");
		expect(restored?.commander.state.credits).toBe(100);
		const live = await h.store.load("default");
		expect(live.commander.state).toEqual(dock.state);
		expect(live.commander.dockedAt).toBe(dock.dockedAt);
		expect(live.commander.requests).toEqual(dock.requests);
	});

	test("a permadeath commander gets nothing back, and nothing is written", async () => {
		const h = harness({ permadeath: true });
		await dockThenJump(h);
		const before = h.backend.writes;
		expect(
			await h.store.revertToLastDocked(h.commander, "destroyed"),
		).toBeNull();
		expect(h.backend.writes).toBe(before);
		expect((await h.store.load("default")).commander.state.credits).toBe(555);
	});

	test("the store writes nothing after it, not even the quit flush", async () => {
		const h = harness();
		await dockThenJump(h);
		await h.store.revertToLastDocked(h.commander, "destroyed");
		const after = h.backend.writes;
		h.store.markDirty();
		if (h.clock.armed) h.clock.fire();
		await h.store.flush("quit");
		await h.store.settled();
		expect(h.backend.writes).toBe(after);
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
	});

	test("a debounce armed before the death does not fire after it", async () => {
		const h = harness();
		await dockThenJump(h);
		h.set(999);
		h.store.markDirty();
		await h.store.revertToLastDocked(h.commander, "destroyed");
		if (h.clock.armed) h.clock.fire();
		await h.store.settled();
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
	});

	const unparseableDock = async (h: ReturnType<typeof harness>) => {
		h.store.markDirty();
		await h.store.flush("jump");
		await h.backend.write("default", "lastDocked", { not: "a save" });
	};

	test("a last dock that will not parse is a named error, and live is left alone", async () => {
		const h = harness();
		await unparseableDock(h);
		const before = h.backend.writes;
		await expect(
			h.store.revertToLastDocked(h.commander, "destroyed"),
		).rejects.toThrow(/lastDocked record that will not parse/);
		expect(h.backend.writes).toBe(before);
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
	});

	test("a refused revert leaves the store saving and the lock held", async () => {
		const h = harness();
		await unparseableDock(h);
		expect(await h.store.hold()).toBe(true);
		await h.store.revertToLastDocked(h.commander, "destroyed").catch(() => {});
		const before = h.backend.writes;
		h.set(777);
		h.store.markDirty();
		await h.store.flush("jump");
		expect(h.backend.writes).toBe(before + 1);
		expect((await h.store.load("default")).commander.state.credits).toBe(777);
		await expect(h.catalog.chooseCommander("default")).rejects.toThrow();
	});

	test("a failed revert keeps the save it interrupted", async () => {
		const h = harness();
		await unparseableDock(h);
		h.set(888);
		h.store.markDirty();
		await h.store.revertToLastDocked(h.commander, "destroyed").catch(() => {});
		await h.store.flush("jump");
		expect((await h.store.load("default")).commander.state.credits).toBe(888);
	});

	test("it gives the tab's lock back, so the reload's one-shot can name the Commander", async () => {
		const h = harness();
		await dockThenJump(h);
		expect(await h.store.hold()).toBe(true);
		await h.store.revertToLastDocked(h.commander, "destroyed");
		await h.catalog.chooseCommander("default");
		expect(await h.catalog.takeOneShot()).toBe("default");
	});
});

describe("#654 — a death keeps the world and reverts only the commander", () => {
	const fatalLeg = async (h: ReturnType<typeof harness>) => {
		h.store.markDirty();
		await h.store.flush("dock");
		h.set(555);
		h.leg(9, 600);
		h.store.markDirty();
		await h.store.flush("jump");
	};

	test("every world change from the fatal leg stays", async () => {
		const h = harness();
		await fatalLeg(h);
		const dying = h.world;
		const restored = await h.store.revertToLastDocked(h.commander, "destroyed");
		const live = await h.store.load("default");
		for (const save of [restored, live]) {
			expect(save!.world).toEqual(dying);
			expect(save?.world.galaxies[0].visited).toContain(9);
		}
		expect(
			(await h.store.load("default", "lastDocked")).world.galaxies[0].visited,
		).not.toContain(9);
	});

	test("the world is the one current at the death, not the last write", async () => {
		const h = harness();
		await fatalLeg(h);
		h.leg(11, 30);
		const dying = h.world;
		await h.store.revertToLastDocked(h.commander, "destroyed");
		const savedWorld = (await h.store.load("default")).world;
		expect(savedWorld).toEqual(dying);
	});

	test("the time flown before the death stays in the play log (#581)", async () => {
		const h = harness();
		await fatalLeg(h);
		const flown = h.commander.ladders.playedS;
		expect(flown).toBe(600);
		const restored = await h.store.revertToLastDocked(h.commander, "destroyed");
		expect(restored?.commander.ladders.playedS).toBe(flown);
		expect((await h.store.load("default")).commander.ladders.playedS).toBe(
			flown,
		);
	});

	test("the last dock record itself is left alone", async () => {
		const h = harness();
		await fatalLeg(h);
		const before = await h.backend.raw("default", "lastDocked");
		await h.store.revertToLastDocked(h.commander, "destroyed");
		expect(await h.backend.raw("default", "lastDocked")).toEqual(before);
	});
});

describe("#660 D1, D10 — a death restores the launch, and a first death wakes at the start", () => {
	const buyDockingComputerAndPod = (h: ReturnType<typeof harness>) =>
		h.edit((c) => ({
			...c,
			state: {
				...c.state,
				credits: 40,
				loadout: migrateEquipment("courier", [
					...equipmentNames(c.state.loadout),
					"Docking Computer",
					"Escape Pod",
				]).loadout,
			},
		}));

	const dockAndBuy = async (
		h: ReturnType<typeof harness>,
		{ settle }: { settle: boolean },
	) => {
		h.set(1040);
		h.store.markDirty();
		await h.store.flush("dock");
		buyDockingComputerAndPod(h);
		if (!settle) return;
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
	};

	test("dock, buy, undock, death: the purchase is restored", async () => {
		const h = harness();
		await dockAndBuy(h, { settle: true });
		await h.store.flush("undock");
		h.set(9999);
		h.leg(9, 600);
		h.store.markDirty();
		await h.store.flush("jump");
		const restored = await h.store.revertToLastDocked(h.commander, "eject");
		for (const save of [restored, await h.store.load("default")]) {
			expect(save?.commander.state.credits).toBe(40);
			expect(equipmentNames(save?.commander.state.loadout ?? {})).toEqual([
				"Extra Pulse Laser",
				"Docking Computer",
			]);
			expect(save?.world.galaxies[0].visited).toContain(9);
		}
	});

	test("dock, buy, undock, death without ejecting: the launch credits, a stock courier", async () => {
		const h = harness();
		await dockAndBuy(h, { settle: true });
		await h.store.flush("undock");
		h.set(9999);
		h.store.markDirty();
		await h.store.flush("jump");
		const restored = await h.store.revertToLastDocked(h.commander, "destroyed");
		expect(restored?.commander.state).toMatchObject({
			...newCommander(PLAYER_BASELINE_HULL),
			credits: 40,
		});
	});

	test("the death leaves its wake for the next boot, taken once", async () => {
		const h = harness();
		await dockAndBuy(h, { settle: true });
		await h.store.flush("undock");
		await h.store.revertToLastDocked(h.commander, "eject");
		const wake = await h.catalog.takeWake();
		expect(wake?.saveSlot).toBe("default");
		expect(wake?.cause).toBe("eject");
		expect(wake?.fittingsLost).toBe(1);
		expect(wake?.firstLife).toBe(false);
		expect(await h.catalog.takeWake()).toBeNull();
	});

	test("a refused revert leaves no wake", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("jump");
		await h.backend.write("default", "lastDocked", { not: "a save" });
		await h.store.revertToLastDocked(h.commander, "eject").catch(() => {});
		expect(await h.catalog.takeWake()).toBeNull();
	});

	test("a launch checkpoint queued behind a slow write is the launch, not what followed it", async () => {
		const h = harness();
		await dockAndBuy(h, { settle: false });
		h.backend.hold();
		h.store.markDirty();
		h.clock.fire();
		expect(h.backend.inFlight).toBe(1);
		const launched = h.store.flush("undock");
		h.set(9999);
		h.leg(9, 600);
		h.store.markDirty();
		h.backend.release();
		await launched;
		await h.store.settled();
		const checkpoint = await h.store.load("default", "lastDocked");
		expect(checkpoint.commander.state.credits).toBe(40);
		expect(equipmentNames(checkpoint.commander.state.loadout)).toContain(
			"Escape Pod",
		);
		expect(checkpoint.world.galaxies[0].visited).not.toContain(9);
		expect(h.clock.armed).toBe(true);
		h.clock.fire();
		await h.store.settled();
		expect(h.backend.maxInFlight).toBe(1);
		const live = await h.store.load("default");
		expect(live.commander.state.credits).toBe(9999);
		expect(live.world.galaxies[0].visited).toContain(9);
		const restored = await h.store.revertToLastDocked(h.commander, "eject");
		expect(restored?.commander.state.credits).toBe(40);
		expect(equipmentNames(restored?.commander.state.loadout ?? {})).toEqual([
			"Extra Pulse Laser",
			"Docking Computer",
		]);
		expect(restored?.world.galaxies[0].visited).toContain(9);
	});

	test("a checkpoint with nothing moved behind it leaves the debounce alone", async () => {
		const h = harness();
		h.set(1040);
		h.store.markDirty();
		await h.store.flush("dock");
		await h.store.flush("undock");
		expect(h.clock.armed).toBe(false);
		expect(h.backend.writes).toBe(2);
	});

	test("dock, death without an undock: the arrival is restored", async () => {
		const h = harness();
		await dockAndBuy(h, { settle: true });
		const restored = await h.store.revertToLastDocked(h.commander, "destroyed");
		expect(restored?.commander.state.credits).toBe(1040);
		expect(
			equipmentNames(restored?.commander.state.loadout ?? {}),
		).not.toContain("Escape Pod");
	});

	test("a never-docked death wakes a new commander at the start system's trade station", async () => {
		const h = harness();
		h.edit((c) => ({
			...c,
			firstDay: "guided",
			state: {
				...c.state,
				hull: "freighter",
				credits: 5000,
				cargo: { Food: 4 },
				loadout: migrateEquipment("freighter", ["Escape Pod"]).loadout,
			},
			ladders: {
				...c.ladders,
				banked: { combat: 3, trade: 0, exploration: 2 },
				basis: { Food: { units: 4, cr: 40 } },
			},
		}));
		h.leg(9, 600);
		h.store.markDirty();
		await h.store.flush("jump");
		expect(await h.backend.has("default", "lastDocked")).toBe(false);
		const dying = h.commander;
		const restored = await h.store.revertToLastDocked(dying, "destroyed");
		const live = await h.store.load("default");
		const galaxy = generateGalaxy(SEED, START_GALAXY);
		const start = startSystem(galaxy);
		const trade = generateContents(start).stations.find(
			(s) => s.type === "trade",
		);
		expect(trade).toBeDefined();
		for (const save of [restored, live]) {
			const c = save?.commander;
			expect(c?.dockedAt).toBe(
				carrierKey(start.index, trade?.localCarrierId ?? ""),
			);
			expect(c?.galaxyIndex).toBe(START_GALAXY);
			expect(c?.systemIndex).toBe(start.index);
			expect(c?.state).toMatchObject(newCommander(PLAYER_BASELINE_HULL));
			expect(c?.state.credits).toBe(STARTING_CREDITS);
			expect(c?.requests).toEqual(newCommanderRecord("courier").requests);
			expect(c?.firstDay).toBe("guided");
			expect(c?.permadeath).toBe(false);
			expect(c?.ladders.banked).toEqual(dying.ladders.banked);
			expect(c?.ladders.playedS).toBe(600);
			expect(c?.ladders.basis).toEqual({});
			expect({
				...save?.world,
				galaxies: save?.world.galaxies.map(withoutDeathWreck),
			}).toEqual(h.world);
			expect(save?.world.galaxies[dying.galaxyIndex].deathWreck).toEqual(
				deathWreckRow(h.world, dying, "destroyed"),
			);
		}
		expect(parseSave(await h.backend.raw("default", "live"))).toMatchObject(
			live,
		);
		const wake = await h.catalog.takeWake();
		expect(wake?.firstLife).toBe(true);
		expect(wake?.hull).toBe("freighter");
		expect(wake?.holdT).toBe(4);
	});

	test("an absent lastDocked whose write failed is refused, not derived", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("dock")).rejects.toThrow(/backend/);
		expect(await h.backend.has("default", "lastDocked")).toBe(false);
		await expect(
			h.store.revertToLastDocked(h.commander, "destroyed"),
		).rejects.toThrow(/lastDocked/);
	});

	test("a failed dock write is still refused after a reload, and live is kept", async () => {
		const station = carrierKey(3, LOCAL_CARRIER_ID.trade);
		const before = harness();
		before.edit((c) => {
			const banked = applyHoldEvent(
				{
					commander: c.state,
					requests: c.requests,
					ladders: c.ladders,
					ladderPending: emptyPending(),
				},
				before.world,
				{ kind: "dock", galaxyIndex: 0, station, at: before.world.gameTime },
			).holdings.ladders;
			return {
				...c,
				dockedAt: station,
				state: {
					...c.state,
					credits: 4321,
					loadout: migrateEquipment("courier", ["Escape Pod"]).loadout,
				},
				ladders: banked,
			};
		});
		expect(hasDocked({ ...before.commander, dockedAt: null })).toBe(true);
		expect(hasDocked(newCommanderRecord("courier"))).toBe(false);
		before.store.markDirty();
		before.backend.failNextWrite();
		await expect(before.store.flush("dock")).rejects.toThrow(/backend/);
		before.edit((c) => ({ ...c, dockedAt: null }));
		before.store.markDirty();
		await before.store.flush("quit");
		expect(await before.backend.has("default", "lastDocked")).toBe(false);
		const written = await before.backend.raw("default", "live");

		const after = harness({ backend: before.backend });
		const reloaded = await after.store.load("default");
		after.edit(() => reloaded.commander);
		expect(after.store.heldFaults.size).toBe(0);
		await expect(
			after.store.revertToLastDocked(after.commander, "destroyed"),
		).rejects.toThrow(/lastDocked/);
		expect(await after.backend.raw("default", "live")).toEqual(written);
		expect((await after.store.load("default")).commander.state.credits).toBe(
			4321,
		);
	});

	test("hasDocked reads the record: a new game has not, a banked dock has", () => {
		const fresh = newCommanderRecord("courier");
		expect(hasDocked(fresh)).toBe(false);
		const station = carrierKey(3, LOCAL_CARRIER_ID.trade);
		expect(hasDocked({ ...fresh, dockedAt: station })).toBe(true);
		expect(
			hasDocked({
				...fresh,
				ladders: {
					...fresh.ladders,
					visited: { 2: { systems: [], stations: [station] } },
				},
			}),
		).toBe(true);
	});
});

describe("#89 D6 — slots, export and import", () => {
	test("a write to one slot changes no other slot's record", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		h.set(777);
		h.store.markDirty();
		await h.store.flush("dock", "beta");
		expect((await h.store.load("alpha")).commander.state.credits).toBe(100);
		expect((await h.store.load("beta")).commander.state.credits).toBe(777);
		expect((await h.catalog.slots()).sort()).toEqual(["alpha", "beta"]);
	});

	test("export then import reproduces the slot, both records", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		h.set(777);
		h.store.markDirty();
		await h.store.flush("jump", "alpha");
		const text = await h.catalog.exportSlot("alpha");
		await h.catalog.importSlot("copy", text);
		expect((await h.store.load("copy")).commander.state.credits).toBe(777);
		expect(
			(await h.store.load("copy", "lastDocked")).commander.state.credits,
		).toBe(100);
		expect(await h.catalog.exportSlot("copy")).toBe(text);
	});

	test("a queued write does not inherit the previous write's failure", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		h.clock.fire();
		await h.store.settled();
		h.set(321);
		h.store.markDirty();
		await h.store.flush("dock");
		expect(
			(await h.store.load("default", "lastDocked")).commander.state.credits,
		).toBe(321);
	});

	test("a failed debounced write re-arms rather than waiting for a flush", async () => {
		const failures: string[] = [];
		const clock = manualScheduler();
		const backend = memorySaveBackend();
		const store = new SaveStore({
			backend,
			locks: memorySlotLocks(),
			schedule: clock.scheduler,
			current: () => envelope(100),
			onWriteFailed: (error) => failures.push(String(error)),
		});
		store.markDirty();
		backend.failNextWrite();
		clock.fire();
		await store.settled();
		expect(backend.writes).toBe(0);
		expect(failures.length).toBe(1);
		expect(clock.armed).toBe(true);
		clock.fire();
		await store.settled();
		expect(backend.writes).toBe(1);
	});

	test("the retry stops drumming after the cap, and the save stays dirty", async () => {
		const clock = manualScheduler();
		const backend = memorySaveBackend();
		const failures: number[] = [];
		const store = new SaveStore({
			backend,
			locks: memorySlotLocks(),
			schedule: clock.scheduler,
			current: () => envelope(100),
			onWriteFailed: (_error, consecutive) => failures.push(consecutive),
		});
		store.markDirty();
		for (let i = 0; i < SAVE_RETRY_LIMIT + 2 && clock.armed; i++) {
			backend.failNextWrite();
			clock.fire();
			await store.settled();
		}
		expect(failures).toEqual([1, 2, 3]);
		expect(clock.armed).toBe(false);
		expect(backend.writes).toBe(0);
		await store.flush("dock");
		expect(backend.writes).toBe(1);
	});

	test("a dock flush writes both records in one transaction", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		expect(h.backend.writes).toBe(1);
		expect(await h.backend.has("default", "live")).toBe(true);
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
	});

	test("a slot name that would address another slot is refused", async () => {
		const h = harness();
		await expect(h.store.flush("dock", "")).rejects.toThrow(/may not be empty/);
		await expect(h.store.flush("dock", "a\0b")).rejects.toThrow(/NUL/);
		for (const name of ["a\0b", ""]) {
			await expect(h.store.flush("dock", name)).rejects.toThrow(
				/Commander name/,
			);
			await expect(h.catalog.importSlot(name, "{}")).rejects.toThrow(
				/Commander name/,
			);
		}
		expect(await h.catalog.slots()).toEqual([]);
	});

	test("a Commander name may hold a space", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "Commander Jameson");
		expect(await h.catalog.slots()).toEqual(["Commander Jameson"]);
		await h.catalog.beginNewGame({
			name: "New Hope",
			seed: 1,
			permadeath: false,
			firstDay: "free",
		});
		expect((await h.catalog.resolveActive()).slot).toBe("New Hope");
	});

	test("importing a file that is not a save refuses and writes nothing", async () => {
		const h = harness();
		await expect(h.catalog.importSlot("copy", "{]")).rejects.toThrow(/save/i);
		expect(await h.catalog.slots()).toEqual([]);
	});
});

describe("#89 D8/D9 — refusal, and never overwriting the bad record", () => {
	test("a version mismatch is named, and the record is still there to export", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		await h.backend.corruptVersion("alpha", "live");
		await expect(h.store.load("alpha")).rejects.toThrow(/saveSchemaVersion/);
		expect(await h.backend.has("alpha", "live")).toBe(true);
		expect(typeof (await h.catalog.exportSlot("alpha"))).toBe("string");
	});

	test("a truncated record fails as a named error rather than as an empty world", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		await h.backend.truncate("alpha", "live");
		await expect(h.store.load("alpha")).rejects.toThrow(/save:/);
	});

	test("loading a slot that does not exist is a named refusal, not an empty save", async () => {
		const h = harness();
		await expect(h.store.load("nothing")).rejects.toThrow(/no .*record/i);
	});

	test("a failed write leaves the previous record in place", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		h.set(999);
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("jump", "alpha")).rejects.toThrow(/backend/);
		expect((await h.store.load("alpha")).commander.state.credits).toBe(100);
	});
});

const seeded = async (
	h: ReturnType<typeof harness>,
	slot: string,
	credits = 100,
) => {
	h.set(credits);
	h.store.markDirty();
	await h.store.flush("dock", slot);
};

const twoTabs = (slotB?: string) => {
	const locks = memorySlotLocks();
	const backend = memorySaveBackend();
	return {
		tabA: harness({ backend, locks, slot: "jameson" }),
		tabB: harness({ backend, locks, slot: slotB }),
	};
};

describe("§11.4 — the active-Commander pointer", () => {
	test("with no pointer the active Commander is the default, and nothing fell back", async () => {
		const h = harness();
		expect(await h.catalog.resolveActive()).toEqual({
			slot: DEFAULT_SLOT,
			pending: null,
			fellBack: false,
		});
	});

	test("the pointer names the active Commander", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.chooseCommander("jameson");
		expect((await h.catalog.resolveActive()).slot).toBe("jameson");
	});

	test("a pointer naming a Commander that is gone falls back to the default, and says so", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.chooseCommander("jameson");
		await h.backend.deleteSlot("jameson");
		expect(await h.catalog.resolveActive()).toEqual({
			slot: DEFAULT_SLOT,
			pending: null,
			fellBack: true,
		});
	});
});

describe("§11.3 — the one-shot continue", () => {
	test("Load: consumed by exactly one boot, into the Commander the pointer names", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.chooseCommander("jameson");
		expect(await h.catalog.takeOneShot()).toBe("jameson");
		expect(await h.catalog.takeOneShot()).toBeNull();
		expect((await h.catalog.resolveActive()).slot).toBe("jameson");
	});

	test("Import: the imported Commander is the one the one-shot names", async () => {
		const h = harness();
		await seeded(h, "jameson");
		const text = await h.catalog.exportSlot("jameson");
		await h.catalog.importSlot("copy", text);
		await h.catalog.chooseCommander("copy");
		expect(await h.catalog.takeOneShot()).toBe("copy");
		expect((await h.catalog.resolveActive()).slot).toBe("copy");
	});

	test("New game: the pending Commander is the one the one-shot names", async () => {
		const h = harness();
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: true,
			firstDay: "free",
		});
		expect(await h.catalog.takeOneShot()).toBe("fresh");
		expect(await h.catalog.takeOneShot()).toBeNull();
	});

	test("Load after an abandoned new game boots the loaded Commander, not the abandoned one", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		await h.catalog.takeOneShot();
		await h.catalog.chooseCommander("jameson");
		expect(await h.catalog.resolveActive()).toEqual({
			slot: "jameson",
			pending: null,
			fellBack: false,
		});
	});

	test("Load refuses a Commander whose lock another store holds, and writes nothing", async () => {
		const { tabA, tabB } = twoTabs();
		await seeded(tabA, "jameson");
		expect(await tabA.store.hold()).toBe(true);
		await expect(tabB.catalog.chooseCommander("jameson")).rejects.toThrow(
			/open in another tab/,
		);
		expect(await tabB.catalog.takeOneShot()).toBeNull();
	});
});

describe("§11.3 — a pending new game", () => {
	test("a pending new game whose Commander has no record boots into that game, not the default", async () => {
		const h = harness();
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: true,
			firstDay: "free",
		});
		expect(await h.backend.has("fresh", "live")).toBe(false);
		expect(await h.catalog.resolveActive()).toEqual({
			slot: "fresh",
			pending: { name: "fresh", seed: 7, permadeath: true, firstDay: "free" },
			fellBack: false,
		});
	});

	test("it survives until its first live record lands, and not a moment earlier", async () => {
		const h = harness({ slot: "fresh" });
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		await expect(h.catalog.finishNewGame()).rejects.toThrow(/no save yet/);
		expect((await h.catalog.resolveActive()).pending).not.toBeNull();
		h.store.markDirty();
		await h.store.flush("quit");
		await h.catalog.finishNewGame();
		expect(await h.catalog.resolveActive()).toEqual({
			slot: "fresh",
			pending: null,
			fellBack: false,
		});
	});

	test("an unreadable pending record faults the boot, and a new game replaces it", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.backend.writeMeta({ pending: { name: "lost", seed: -1 } });
		await expect(h.catalog.resolveActive()).rejects.toThrow(/pending new game/);
		const text = await h.catalog.exportSlot("jameson");
		await h.catalog.importSlot("copy", text);
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		expect((await h.catalog.resolveActive()).slot).toBe("fresh");
	});

	test("an unreadable pending record is also cleared by Load", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.backend.writeMeta({ pending: "garbage" });
		await h.catalog.chooseCommander("jameson");
		expect((await h.catalog.resolveActive()).slot).toBe("jameson");
	});

	test("a pending record beside a save that already landed does not replace the save", async () => {
		const h = harness({ slot: "fresh" });
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		h.store.markDirty();
		await h.store.flush("quit");
		expect(await h.catalog.resolveActive()).toEqual({
			slot: "fresh",
			pending: null,
			fellBack: false,
		});
	});

	test("a backend that fails to read the pending record refuses a name, not frees it", async () => {
		const h = harness();
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		const failing = {
			...h.backend,
			readMeta: () => Promise.reject(new Error("backend: the read failed")),
		};
		const catalog = new CommanderCatalog({ backend: failing, locks: h.locks });
		await expect(
			catalog.beginNewGame({
				name: "fresh",
				seed: 9,
				permadeath: true,
				firstDay: "free",
			}),
		).rejects.toThrow(/backend/);
		expect(await h.backend.readMeta("pending")).toEqual({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
	});

	test("a boot that finds a pending record beside a landed save clears it", async () => {
		const h = harness({ slot: "fresh" });
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		h.store.markDirty();
		await h.store.flush("quit");
		await h.catalog.resolveActive();
		expect(await h.backend.readMeta("pending")).toBeNull();
	});

	test("renaming a Commander a stale pending record names does not bring the old name back", async () => {
		const h = harness({ slot: "fresh" });
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		h.store.markDirty();
		await h.store.flush("quit");
		await h.catalog.renameSlot("fresh", "elite");
		expect(await h.catalog.resolveActive()).toEqual({
			slot: "elite",
			pending: null,
			fellBack: false,
		});
	});

	test("deleting a Commander a stale pending record names clears the record", async () => {
		const h = harness({ slot: "fresh" });
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		h.store.markDirty();
		await h.store.flush("quit");
		await h.catalog.deleteSlot("fresh");
		expect(await h.catalog.resolveActive()).toEqual({
			slot: DEFAULT_SLOT,
			pending: null,
			fellBack: false,
		});
		expect(await h.backend.readMeta("pending")).toBeNull();
	});

	test("deleting the active Commander clears the pointer, so the next boot reports no fallback", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.chooseCommander("jameson");
		await h.catalog.deleteSlot("jameson");
		expect(await h.backend.readMeta("active")).toBeNull();
		expect(await h.catalog.resolveActive()).toEqual({
			slot: DEFAULT_SLOT,
			pending: null,
			fellBack: false,
		});
	});

	test("a New game choice this build cannot write is refused as the choice, not as a record on disk", async () => {
		const h = harness();
		await expect(
			h.catalog.beginNewGame({
				name: "fresh",
				seed: -1,
				permadeath: false,
				firstDay: "free",
			}),
		).rejects.toThrow(/New game choice/);
	});
});

describe("§11.3 — one rule for names", () => {
	test("new game, import and rename each refuse a name already taken", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await seeded(h, "other");
		const text = await h.catalog.exportSlot("jameson");
		await expect(
			h.catalog.beginNewGame({
				name: "jameson",
				seed: 1,
				permadeath: false,
				firstDay: "free",
			}),
		).rejects.toThrow(/already a Commander/);
		await expect(h.catalog.importSlot("jameson", text)).rejects.toThrow(
			/already a Commander/,
		);
		await expect(h.catalog.renameSlot("other", "jameson")).rejects.toThrow(
			/already a Commander/,
		);
		expect((await h.store.load("other")).commander.state.credits).toBe(100);
	});

	test("a name a pending new game holds is taken, although it has no record yet", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.beginNewGame({
			name: "fresh",
			seed: 7,
			permadeath: false,
			firstDay: "free",
		});
		const text = await h.catalog.exportSlot("jameson");
		await expect(h.catalog.importSlot("fresh", text)).rejects.toThrow(
			/already a Commander/,
		);
		await expect(h.catalog.renameSlot("jameson", "fresh")).rejects.toThrow(
			/already a Commander/,
		);
	});

	test("new game and rename refuse a name holding the key separator", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await seeded(h, "other");
		await expect(
			h.catalog.beginNewGame({
				name: "jameson\0x",
				seed: 1,
				permadeath: false,
				firstDay: "free",
			}),
		).rejects.toThrow(/Commander name/);
		await expect(h.catalog.renameSlot("other", "jameson\0x")).rejects.toThrow(
			/Commander name/,
		);
		expect((await h.catalog.slots()).sort()).toEqual(["jameson", "other"]);
	});

	test("import refuses a record the parser refuses, and writes nothing", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.backend.corruptVersion("jameson", "live");
		const text = await h.catalog.exportSlot("jameson");
		await expect(h.catalog.importSlot("copy", text)).rejects.toThrow(
			/saveSchemaVersion/,
		);
		expect((await h.catalog.slots()).sort()).toEqual(["jameson"]);
	});
});

describe("§11.3 — rename and delete", () => {
	test("rename moves both records and the pointer, and leaves no old name behind", async () => {
		const h = harness();
		await seeded(h, "jameson", 100);
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump", "jameson");
		await h.catalog.chooseCommander("jameson");
		await h.catalog.renameSlot("jameson", "elite");
		expect((await h.catalog.slots()).sort()).toEqual(["elite"]);
		expect((await h.store.load("elite")).commander.state.credits).toBe(555);
		expect(
			(await h.store.load("elite", "lastDocked")).commander.state.credits,
		).toBe(100);
		expect((await h.catalog.resolveActive()).slot).toBe("elite");
	});

	test("a rename interrupted between copy and delete leaves two Commanders, never zero", async () => {
		const h = harness();
		await seeded(h, "jameson");
		h.backend.failNextDelete();
		await expect(h.catalog.renameSlot("jameson", "elite")).rejects.toThrow(
			/backend/,
		);
		expect((await h.catalog.slots()).sort()).toEqual(["elite", "jameson"]);
	});

	test("delete removes the Commander", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.catalog.deleteSlot("jameson");
		expect(await h.catalog.slots()).toEqual([]);
	});

	test("delete and rename refuse a Commander whose lock is held — this tab's or another's", async () => {
		const { tabA, tabB } = twoTabs();
		await seeded(tabA, "jameson");
		expect(await tabA.store.hold()).toBe(true);
		for (const catalog of [tabA.catalog, tabB.catalog]) {
			await expect(catalog.deleteSlot("jameson")).rejects.toThrow(
				/open in another tab|in play/,
			);
			await expect(catalog.renameSlot("jameson", "elite")).rejects.toThrow(
				/open in another tab|in play/,
			);
		}
		expect(await tabB.catalog.slots()).toEqual(["jameson"]);
	});

	test("a second store cannot hold a Commander the first already holds", async () => {
		const { tabA, tabB } = twoTabs("jameson");
		expect(await tabA.store.hold()).toBe(true);
		expect(await tabB.store.hold()).toBe(false);
	});

	test("two overlapping holds on one store keep the lock, and no second store gets it", async () => {
		const { tabA, tabB } = twoTabs("jameson");
		const both = await Promise.all([tabA.store.hold(), tabA.store.hold()]);
		expect(both).toEqual([true, true]);
		expect(await tabA.store.hold()).toBe(true);
		expect(await tabB.store.hold()).toBe(false);
	});

	test("a lock request the browser rejects is a fault, not a Commander held elsewhere", async () => {
		const refused = {
			request: () => Promise.reject(new Error("SecurityError: no locks here")),
		} as unknown as LockManager;
		await expect(webSlotLocks(refused).tryHold("jameson")).rejects.toThrow(
			/SecurityError/,
		);
	});

	test("the lock check gives the lock back, so a store may hold it afterwards", async () => {
		const locks = memorySlotLocks();
		const h = harness({ locks });
		await seeded(h, "jameson");
		await h.catalog.chooseCommander("jameson");
		const tab = harness({ backend: h.backend, locks, slot: "jameson" });
		expect(await tab.store.hold()).toBe(true);
	});
});

describe("§11.5 — faults are held per record kind", () => {
	test("a lastDocked fault survives a good debounced write and clears on a good dock flush", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("dock")).rejects.toThrow(/backend/);
		expect([...h.store.faultKinds].sort()).toEqual(["lastDocked", "live"]);
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual(["lastDocked"]);
		h.store.markDirty();
		await h.store.flush("dock");
		expect([...h.store.faultKinds]).toEqual([]);
	});

	test("a later failure that lands does not replace a held dock fault's words (#311 round 1)", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("dock")).rejects.toThrow(/backend/);
		const dockWords = heldSaveFault(h.store, null);
		expect(dockWords).toContain("the dock save would not write");
		h.store.markDirty();
		h.backend.failNextWrite();
		h.clock.fire();
		await h.store.settled();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual(["lastDocked"]);
		expect(heldSaveFault(h.store, null)).toBe(dockWords);
	});

	test("a debounced write is a fault only once it has failed SAVE_RETRY_LIMIT times in a row", async () => {
		const h = harness();
		h.store.markDirty();
		for (let i = 1; i < SAVE_RETRY_LIMIT; i++) {
			h.backend.failNextWrite();
			h.clock.fire();
			await h.store.settled();
			expect(`${i}: ${[...h.store.faultKinds]}`).toBe(`${i}: `);
		}
		h.backend.failNextWrite();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual(["live"]);
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual([]);
	});

	test("a failure below the cap does not count toward it once a write lands", async () => {
		const h = harness();
		h.store.markDirty();
		for (let i = 1; i < SAVE_RETRY_LIMIT; i++) {
			h.backend.failNextWrite();
			h.clock.fire();
			await h.store.settled();
		}
		h.clock.fire();
		await h.store.settled();
		h.store.markDirty();
		h.backend.failNextWrite();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual([]);
	});

	test("a failed jump flush is a live fault at once", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("jump")).rejects.toThrow(/backend/);
		expect([...h.store.faultKinds]).toEqual(["live"]);
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual([]);
	});

	test("a failed undock flush holds both kinds, as a dock flush does (#660 D1)", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("undock")).rejects.toThrow(/backend/);
		expect([...h.store.faultKinds].sort()).toEqual(["lastDocked", "live"]);
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.faultKinds]).toEqual(["lastDocked"]);
	});
});

describe("the store writes what a parser accepts", () => {
	test("what the backend holds is exactly what serializeSave produces", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		expect(await h.backend.raw("alpha", "live")).toEqual(
			serializeSave({
				world: visit(newWorld(SEED), 0, 3),
				commander: h.commander,
			}),
		);
		expect(KEY).toBeTruthy();
	});
});
