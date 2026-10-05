/**
 * #89's D4, D6, D7, D8 and D9 as a state machine, driven by hand.
 *
 * Everything here runs against an in-memory backend and an injected scheduler.
 * That is not a convenience: bun has no fake `setTimeout`, and a debounce test
 * on the wall clock is a test that measures the machine it runs on. The
 * IndexedDB adapter is the thin half and gets a browser probe instead —
 * `scripts/probe-save.mjs` — because a transaction is the one thing only a
 * browser has.
 */

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
import { newWorld, visit } from "../src/world-state";

const SEED = 0x5ee11e;
const KEY = carrierKey(3, LOCAL_CARRIER_ID.trade);

/** A scheduler the test drives. Holds at most one pending callback, which is
 *  the debouncer's own contract — a second `schedule` cancels the first. */
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

/** A store wired to a manual clock, with `current` returning whatever the test
 *  last set — which is what `Game` will pass: a getter, not a snapshot, so the
 *  debounced write serializes the world at the moment it fires. */
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
		/** Any other change to the commander, for the rows that need one. */
		edit(change: (c: CommanderRecord) => CommanderRecord) {
			state = { ...state, commander: change(state.commander) };
		},
		/** A leg flown: a system visited, the clock moved on and the play log
		 *  with it — world state and commander state a death treats apart. */
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
		// The write carries the *latest* state, not the one that first dirtied it.
		const back = await h.store.load("default");
		expect(back.commander.state.credits).toBe(300);
	});

	test("a dock, undock, jump or quit flushes regardless of the window", async () => {
		for (const reason of ["dock", "undock", "jump", "quit"] as const) {
			const h = harness();
			h.store.markDirty();
			await h.store.flush(reason);
			expect(h.backend.writes).toBeGreaterThanOrEqual(1);
			// And the debounce is disarmed — a pending timer that fired afterwards
			// would be a second write of the same state.
			expect(h.clock.armed).toBe(false);
		}
	});

	test("a flush with nothing dirty writes nothing — except quit and undock", async () => {
		const h = harness();
		for (const reason of ["dock", "jump"] as const) {
			await h.store.flush(reason);
			expect(h.backend.writes).toBe(0);
		}
		// **Quit is the exception and has to be.** The other three each follow a
		// `saveDirty()` at the transition that caused them; `pagehide` follows
		// nothing, so a new game flown in normal flight only and then closed had
		// never dirtied and wrote no record at all — and with `?permadeath` the
		// D7 choice went with it.
		await h.store.flush("quit");
		expect(h.backend.writes).toBe(1);
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
		// **Undock too** (#660 D1, node #702): `live` can be current while the
		// checkpoint is the arrival, so a clean launch still lays it down.
		await h.store.flush("undock");
		expect(h.backend.writes).toBe(2);
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
	});

	test("a new game's first flush writes `live` with nothing dirty, and only `live`", async () => {
		// §11.3: the pending new game clears only once its first `live` record
		// lands, and nothing has dirtied a world constructed a frame ago. A
		// `quit` would write it too, but a flush named for a tab closing is not
		// what a boot is doing.
		const h = harness({ slot: "New" });
		await h.store.flush("new-game");
		expect(h.backend.writes).toBe(1);
		expect(await h.backend.has("New", "live")).toBe(true);
		expect(await h.backend.has("New", "lastDocked")).toBe(false);
	});

	test("a flush during a debounced write queues behind it rather than racing", async () => {
		// **The check the previous version of this test could not make.** New
		// dirt during a write only arms the debounce, so nothing re-enters the
		// writer and a build with no queue passes — verified by deleting the
		// queue and watching all sixteen rows stay green. A *flush* is the path
		// that re-enters it, and two IndexedDB transactions in flight can land
		// in either order, with the loser being the newer state.
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
		// The first write is in flight. New dirt must not start a second
		// transaction beside it.
		h.set(900);
		h.store.markDirty();
		expect(h.backend.inFlight).toBe(1);
		h.backend.release();
		await h.store.settled();
		// The new dirt is on the debounce, as any other change is. Firing it is
		// what the browser's own timer does; the point of the check is that the
		// second write starts *after* the first lands rather than beside it.
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
		// `live` moved on; the checkpoint the player made by docking did not.
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
		// #89's correction says so in as many words: permadeath is stated and not
		// enforced, and a death flush would be someone closing a hole the policy
		// deliberately leaves. `restoreAfterDeath` reads; it never writes.
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		const before = h.backend.writes;
		await h.store.restoreAfterDeath("default", h.commander);
		expect(h.backend.writes).toBe(before);
	});
});

/**
 * #324's death path, by the principal's ruling O5 (2026-09-14): a
 * non-permadeath death copies the last dock over `live` and the page reloads
 * into it. **This is a death-time write**, and a deliberate change to #89's
 * no-death-flush stance — it lives in its own method so `restoreAfterDeath`
 * keeps its never-writes row above.
 */
describe("#324 O5 — a death reverts live to the last dock", () => {
	/** A dock at 100 credits, then a jump at 555: the leg a death loses. */
	const docked = async (h: ReturnType<typeof harness>) => {
		h.store.markDirty();
		await h.store.flush("dock");
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump");
	};

	test("the commander becomes the last dock's commander", async () => {
		const h = harness();
		await docked(h);
		const dock = (await h.store.load("default", "lastDocked")).commander;
		const restored = await h.store.revertToLastDocked(h.commander);
		expect(restored?.commander.state.credits).toBe(100);
		const live = await h.store.load("default");
		expect(live.commander.state).toEqual(dock.state);
		expect(live.commander.dockedAt).toBe(dock.dockedAt);
		expect(live.commander.requests).toEqual(dock.requests);
	});

	test("a permadeath commander gets nothing back, and nothing is written", async () => {
		const h = harness({ permadeath: true });
		await docked(h);
		const before = h.backend.writes;
		expect(await h.store.revertToLastDocked(h.commander)).toBeNull();
		expect(h.backend.writes).toBe(before);
		expect((await h.store.load("default")).commander.state.credits).toBe(555);
	});

	test("the store writes nothing after it, not even the quit flush", async () => {
		// The reload's `pagehide` runs the quit flush, and `current` still holds
		// the dead ship: without this, the page would write the leg back over the
		// dock it just restored.
		const h = harness();
		await docked(h);
		await h.store.revertToLastDocked(h.commander);
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
		await docked(h);
		h.set(999);
		h.store.markDirty();
		await h.store.revertToLastDocked(h.commander);
		if (h.clock.armed) h.clock.fire();
		await h.store.settled();
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
	});

	/** A flight leg flushed, beside a `lastDocked` the parser refuses — the
	 *  revert's one refusal since #660 D10 made an absent record a checkpoint
	 *  (node #702). */
	const unparseableDock = async (h: ReturnType<typeof harness>) => {
		h.store.markDirty();
		await h.store.flush("jump");
		await h.backend.write("default", "lastDocked", { not: "a save" });
	};

	test("a last dock that will not parse is a named error, and live is left alone", async () => {
		const h = harness();
		await unparseableDock(h);
		const before = h.backend.writes;
		await expect(h.store.revertToLastDocked(h.commander)).rejects.toThrow(
			/save/,
		);
		expect(h.backend.writes).toBe(before);
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
	});

	test("a refused revert leaves the store saving and the lock held", async () => {
		// Sage round 1's blocker. The first build retired the store before it
		// found the dock record missing: every later write was dropped without
		// an error, and the tab kept a lock nothing released. An absent record
		// is a checkpoint now (#660 D10), so the refusal is an unparseable one.
		const h = harness();
		await unparseableDock(h);
		expect(await h.store.hold()).toBe(true);
		await h.store.revertToLastDocked(h.commander).catch(() => {});
		const before = h.backend.writes;
		h.set(777);
		h.store.markDirty();
		await h.store.flush("jump");
		expect(h.backend.writes).toBe(before + 1);
		expect((await h.store.load("default")).commander.state.credits).toBe(777);
		// Still this tab's: another attach to the Commander is refused.
		await expect(h.catalog.chooseCommander("default")).rejects.toThrow();
	});

	test("a failed revert keeps the save it interrupted", async () => {
		// Sage round 2: the revert cleared the dirty flag and cancelled the
		// debounce before it found no dock record, so a change made just before
		// the death was dropped by the next flush, which saw nothing dirty.
		const h = harness();
		await unparseableDock(h);
		h.set(888);
		h.store.markDirty();
		await h.store.revertToLastDocked(h.commander).catch(() => {});
		await h.store.flush("jump");
		expect((await h.store.load("default")).commander.state.credits).toBe(888);
	});

	test("it gives the tab's lock back, so the reload's one-shot can name the Commander", async () => {
		const h = harness();
		await docked(h);
		expect(await h.store.hold()).toBe(true);
		await h.store.revertToLastDocked(h.commander);
		await h.catalog.chooseCommander("default");
		expect(await h.catalog.takeOneShot()).toBe("default");
	});
});

/**
 * #654, the principal's Q2 ruling on #238 (2026-10-03): **a death keeps the
 * world.** Only the commander goes back to the last dock; every world change
 * from the fatal leg stays, so the galaxy remembers what the pilot did before
 * they died. This replaces #324's "live becomes the last dock, byte for byte".
 */
describe("#654 — a death keeps the world and reverts only the commander", () => {
	/** A dock, then a leg the death ends: system 9 visited, ten minutes on. */
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
		const restored = await h.store.revertToLastDocked(h.commander);
		const live = await h.store.load("default");
		for (const save of [restored, live]) {
			expect(save?.world).toEqual(dying);
			expect(save?.world.galaxies[0].visited).toContain(9);
		}
		expect(
			(await h.store.load("default", "lastDocked")).world.galaxies[0].visited,
		).not.toContain(9);
	});

	test("the world is the one current at the death, not the last write", async () => {
		// A change after the last flush is still the world's: the death reads
		// `current`, so a kill made inside the debounce window is not lost.
		const h = harness();
		await fatalLeg(h);
		h.leg(11, 30);
		const dying = h.world;
		await h.store.revertToLastDocked(h.commander);
		expect((await h.store.load("default")).world).toEqual(dying);
	});

	test("the time flown before the death stays in the play log (#581)", async () => {
		const h = harness();
		await fatalLeg(h);
		const flown = h.commander.ladders.playedS;
		expect(flown).toBe(600);
		const restored = await h.store.revertToLastDocked(h.commander);
		expect(restored?.commander.ladders.playedS).toBe(flown);
		expect((await h.store.load("default")).commander.ladders.playedS).toBe(
			flown,
		);
	});

	test("the last dock record itself is left alone", async () => {
		const h = harness();
		await fatalLeg(h);
		const before = await h.backend.raw("default", "lastDocked");
		await h.store.revertToLastDocked(h.commander);
		expect(await h.backend.raw("default", "lastDocked")).toEqual(before);
	});
});

/**
 * #660 D1 and D10, built by node #702: a death restores the commander **as it
 * launched**, and a pilot who never docked has a checkpoint too.
 */
describe("#660 D1, D10 — a death restores the launch, and a first death wakes at the start", () => {
	/** A purchase at the dock: credits spent and the pod fitted. */
	const buyPod = (h: ReturnType<typeof harness>) =>
		h.edit((c) => ({
			...c,
			state: {
				...c.state,
				credits: 40,
				ownedEquipment: [...c.state.ownedEquipment, "Escape Pod"],
			},
		}));

	test("dock, buy, undock, death: the purchase is restored", async () => {
		const h = harness();
		h.set(1040);
		h.store.markDirty();
		await h.store.flush("dock");
		buyPod(h);
		// The purchase reaches `live` through the debounce, which clears the
		// flag — so the launch's flush is the one that must still write.
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		await h.store.flush("undock");
		h.set(9999);
		h.leg(9, 600);
		h.store.markDirty();
		await h.store.flush("jump");
		const restored = await h.store.revertToLastDocked(h.commander);
		for (const save of [restored, await h.store.load("default")]) {
			expect(save?.commander.state.credits).toBe(40);
			expect(save?.commander.state.ownedEquipment).toContain("Escape Pod");
			expect(save?.world.galaxies[0].visited).toContain(9);
		}
	});

	test("a launch checkpoint queued behind a slow write is the launch, not what followed it", async () => {
		// Sage's round-1 reproduction. The launch does not await its flush, so
		// a debounced write still in flight holds the checkpoint in the queue
		// while the ship flies on. Read `current()` there and `lastDocked` gets
		// the flight; the checkpoint has to be what the world was at the call.
		const h = harness();
		h.set(1040);
		h.store.markDirty();
		await h.store.flush("dock");
		buyPod(h);
		h.backend.hold();
		h.store.markDirty();
		h.clock.fire();
		expect(h.backend.inFlight).toBe(1);
		const launched = h.store.flush("undock");
		// Flown on before the slow write lands: credits spent, a system visited.
		h.set(9999);
		h.leg(9, 600);
		h.store.markDirty();
		h.backend.release();
		await launched;
		await h.store.settled();
		const checkpoint = await h.store.load("default", "lastDocked");
		expect(checkpoint.commander.state.credits).toBe(40);
		expect(checkpoint.commander.state.ownedEquipment).toContain("Escape Pod");
		expect(checkpoint.world.galaxies[0].visited).not.toContain(9);
		// `live` landed behind the world, so the save stays dirty and the
		// debounce is armed to catch it up.
		expect(h.clock.armed).toBe(true);
		h.clock.fire();
		await h.store.settled();
		expect(h.backend.maxInFlight).toBe(1);
		const live = await h.store.load("default");
		expect(live.commander.state.credits).toBe(9999);
		expect(live.world.galaxies[0].visited).toContain(9);
		const restored = await h.store.revertToLastDocked(h.commander);
		expect(restored?.commander.state.credits).toBe(40);
		expect(restored?.commander.state.ownedEquipment).toContain("Escape Pod");
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
		h.set(1040);
		h.store.markDirty();
		await h.store.flush("dock");
		buyPod(h);
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		const restored = await h.store.revertToLastDocked(h.commander);
		expect(restored?.commander.state.credits).toBe(1040);
		expect(restored?.commander.state.ownedEquipment).not.toContain(
			"Escape Pod",
		);
	});

	test("a never-docked death wakes a new commander at the start system's trade station", async () => {
		const h = harness();
		// A free start flown on: a hold of goods, a different hull, banked
		// credit and a first-day choice, then a leg the death keeps.
		h.edit((c) => ({
			...c,
			firstDay: "guided",
			state: {
				...c.state,
				hull: "freighter",
				credits: 5000,
				cargo: { Food: 4 },
				ownedEquipment: ["Escape Pod"],
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
		const restored = await h.store.revertToLastDocked(dying);
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
			expect(c?.state).toEqual(newCommander(PLAYER_BASELINE_HULL));
			expect(c?.state.credits).toBe(STARTING_CREDITS);
			expect(c?.requests).toEqual(newCommanderRecord("courier").requests);
			expect(c?.firstDay).toBe("guided");
			expect(c?.permadeath).toBe(false);
			// The ladders are never touched by a death (§9): banked credit and
			// the play log stay, and the basis empties with the hold.
			expect(c?.ladders.banked).toEqual(dying.ladders.banked);
			expect(c?.ladders.playedS).toBe(600);
			expect(c?.ladders.basis).toEqual({});
			// And the world is the one the death happened in (#654).
			expect(save?.world).toEqual(h.world);
		}
		// The record that went to disk is one the parser accepts.
		expect(parseSave(await h.backend.raw("default", "live"))).toEqual(live);
	});

	test("an absent lastDocked whose write failed is refused, not derived", async () => {
		// The pilot docked; the dock flush did not land. Waking them as a new
		// commander would be the silent substitution D9 rules out.
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("dock")).rejects.toThrow(/backend/);
		expect(await h.backend.has("default", "lastDocked")).toBe(false);
		await expect(h.store.revertToLastDocked(h.commander)).rejects.toThrow(
			/lastDocked/,
		);
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
		// Byte-for-byte at the model boundary, which is what #89 asked for.
		expect(await h.catalog.exportSlot("copy")).toBe(text);
	});

	test("a queued write does not inherit the previous write's failure", async () => {
		// `while (this.inFlight) await this.inFlight` rethrew whatever the
		// in-flight write rejected with, so a dock flush queued behind a failing
		// debounced write threw before writing anything — no `lastDocked`
		// checkpoint, on a failure that was not its own.
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
		// Setting the dirty flag alone was described as "the next flush retries"
		// and armed nothing, so a failed debounced write sat until the next
		// dock, trade, jump or quit — the cadence doing almost none of the
		// writing waiting on the cadence doing almost all of it. And nothing
		// reached the player at all, which D9 says is what must not happen.
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
		// Re-armed: the retry is a timer, not the next unrelated transition.
		expect(clock.armed).toBe(true);
		clock.fire();
		await store.settled();
		expect(backend.writes).toBe(1);
	});

	test("the retry stops drumming after the cap, and the save stays dirty", async () => {
		// **Re-arming without a cap was the fix becoming the next defect.** A
		// backend that simply refuses — a quota, a private window — was asked
		// every window forever, each attempt paying the synchronous serialize a
		// player feels, and silently. The cap ends the drum; it does not give
		// up, because the flag survives and the next flush still writes.
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
		// Still dirty, so an unconditional flush writes.
		await store.flush("dock");
		expect(backend.writes).toBe(1);
	});

	test("a dock flush writes both records in one transaction", async () => {
		// Two sequential transactions of the same bytes cost twice the measured
		// median and left a window where the checkpoint and the live record
		// disagreed. `writes` counts transactions, not keys.
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		expect(h.backend.writes).toBe(1);
		expect(await h.backend.has("default", "live")).toBe(true);
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
	});

	test("a slot name that would address another slot is refused", async () => {
		// A record is keyed `${slot}\0${kind}`, so `"a\0b"` lists as `"a"` and
		// `deleteSlot("a")` removes it. Why this once said a space:
		// `tests/source-bytes.test.ts`.
		const h = harness();
		// Each refusal names its own reason, because the overlay shows it.
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
		// The space rule came from the same misread byte. A record key, a Web
		// Lock name and an export all take a space.
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
		// **The bad record is never overwritten.** It is the only copy of
		// whatever is left, and export is the whole reason D9 keeps it.
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
		// Stale rather than broken — D9's residual risk, and the store must not
		// have made it worse.
		expect((await h.store.load("alpha")).commander.state.credits).toBe(100);
	});
});

/** A slot with a `live` and a `lastDocked` record, written through the store. */
const seeded = async (
	h: ReturnType<typeof harness>,
	slot: string,
	credits = 100,
) => {
	h.set(credits);
	h.store.markDirty();
	await h.store.flush("dock", slot);
};

/** Two tabs of one origin: one backend and one set of locks. Tab A writes
 *  `jameson`; tab B writes `slotB`, or the default. */
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
		// The tab closed before the new Commander's first `live` record landed,
		// so the pending record is still on disk. A pending new game is read
		// before the pointer, so a Load that left it there would boot `fresh`.
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
		// It holds no name this build can read, so it takes none: import and
		// rename still work, and New game is the way out of the fault.
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
		// The tab closed between the new Commander's first `live` write and
		// `finishNewGame`. A boot that followed `pending.seed` would build a
		// fresh world over the progress on disk.
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
		// No boot ran between the first save and the rename, so the pending
		// record is still on disk. Once `fresh` has no record, it would win over
		// the pointer and boot a fresh world under the old name.
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
		// The player chose the delete. A pointer left naming the gone Commander
		// would boot the default with a notice that something fell back.
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
		// Nothing was replaced: the taken Commander still carries its own record.
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
		// `"jameson\0x"` would list as `"jameson"`, so it would pass the name
		// rule against a Commander that exists and share its delete.
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
		// The second `tryHold` answers `null` because the first already holds the
		// lock. Written over the first's release, that `null` would leave the lock
		// held with nothing able to release it, and the store reporting it lost.
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
		// The check took the lock and gave it back: a store may now hold it.
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
		// A debounced write carries `live` alone.
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
		// One debounced failure below the cap, then its retry lands.
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
		// §11.5 and `hud-and-scanner.md` §5.3 both say the cap, not the first
		// failure: a retry that lands a moment later was never the player's
		// business. The store held `live` on the first failure for a round.
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
		// Past the cap the drum has stopped, so the next write is a new mark.
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
		// And a good debounced write clears it: both carry `live` alone. The
		// flush cancelled the timer, so the write is a new mark.
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
		// A debounced write clears `live` alone; the launch's checkpoint is
		// still missing until a flush that writes it lands.
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
