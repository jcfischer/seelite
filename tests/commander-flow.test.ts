/**
 * The Commander overlay's boot flow, attach and switch rules
 * (`persistent-world-state.md` §11.2, §11.3 and §11.7's headless list).
 *
 * `main.ts` cannot be imported here — it builds a renderer at module scope — so
 * the decisions a boot makes live in `src/commander-flow.ts` and `main.ts` only
 * carries them out. What this file cannot reach is named where it would be:
 * the held clock is a property of the frame loop, and `scripts/probe-commander.mjs`
 * measures it on a running page.
 */

import { describe, expect, test } from "bun:test";
import {
	attachCommander,
	CommanderSwitch,
	flushFault,
	loadFault,
	lockHeldFault,
	lockRequestFault,
	messageOf,
	pendingFor,
	permadeathAtAttach,
	planBoot,
	recordText,
	restoreFault,
	withLockFault,
	withRestoreFault,
	writeFault,
} from "../src/commander-flow";
import {
	newCommanderRecord,
	type SaveEnvelope,
	serializeSave,
} from "../src/save-envelope";
import {
	CommanderCatalog,
	DEFAULT_SLOT,
	memorySaveBackend,
	memorySlotLocks,
	SAVE_RETRY_LIMIT,
	SaveStore,
	type SlotLocks,
} from "../src/save-store";
import { newWorld, visit } from "../src/world-state";

const SEED = 0x5ee11e;
const OTHER_SEED = 77;

const envelope = (seed = SEED): SaveEnvelope => ({
	world: visit(newWorld(seed), 0, 3),
	commander: newCommanderRecord("courier"),
});

/** One origin: a backend and its locks, shared by every "tab" a test builds. */
const origin = () => {
	const backend = memorySaveBackend();
	const locks = memorySlotLocks();
	const catalog = new CommanderCatalog({ backend, locks });
	const save = (slot: string, seed = SEED) =>
		backend.write(slot, "live", serializeSave(envelope(seed)));
	const boot = (
		options: {
			boot?: "direct" | "overlay";
			noSave?: boolean;
			querySeed?: number | null;
			pinnedSystem?: number | null;
		} = {},
	) =>
		planBoot({
			catalog,
			backend,
			boot: options.boot ?? "overlay",
			noSave: options.noSave ?? false,
			querySeed: options.querySeed ?? null,
			pinnedSystem: options.pinnedSystem ?? null,
		});
	const store = (slot: string, env: () => SaveEnvelope = () => envelope()) =>
		new SaveStore({
			backend,
			locks,
			slot,
			schedule: () => () => {},
			current: env,
		});
	return { backend, locks, catalog, save, boot, store };
};

describe("planBoot: which Commander a boot is for (§11.2)", () => {
	test("a fresh profile opens the overlay on the default Commander with nothing to continue", async () => {
		const o = origin();
		const plan = await o.boot();
		expect(plan.mode).toBe("overlay");
		expect(plan.slot).toBe(DEFAULT_SLOT);
		expect(plan.loaded).toBeNull();
		expect(plan.canContinue).toBe(false);
		expect(plan.fault).toBeNull();
	});

	test("a saved default Commander opens the overlay with Continue available", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT);
		const plan = await o.boot();
		expect(plan.mode).toBe("overlay");
		expect(plan.loaded?.world.seed).toBe(SEED);
		expect(plan.canContinue).toBe(true);
	});

	test("the active pointer picks the Commander, and a pointer to a gone one falls back with a notice, not a fault", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		await o.catalog.takeOneShot();
		expect((await o.boot()).slot).toBe("Jameson");

		await o.backend.writeMeta({ active: "gone" });
		const plan = await o.boot();
		expect(plan.slot).toBe(DEFAULT_SLOT);
		expect(plan.fault).toBeNull();
		expect(plan.notice).not.toBeNull();
	});

	test("a pending new game whose Commander has no record boots into that game, not the default", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT);
		await o.catalog.beginNewGame({
			name: "Fresh",
			seed: OTHER_SEED,
			permadeath: true,
		});
		const plan = await o.boot();
		expect(plan.slot).toBe("Fresh");
		expect(plan.pending).toEqual({
			name: "Fresh",
			seed: OTHER_SEED,
			permadeath: true,
		});
		expect(plan.loaded).toBeNull();
		expect(plan.notice).toBeNull();
		expect(plan.mode).toBe("continue");
		expect(plan.canContinue).toBe(true);
	});

	test("a pending new game that lost its one-shot still offers Continue into it", async () => {
		const o = origin();
		await o.catalog.beginNewGame({ name: "Fresh", seed: 9, permadeath: false });
		await o.catalog.takeOneShot();
		const plan = await o.boot();
		expect(plan.mode).toBe("overlay");
		expect(plan.pending?.seed).toBe(9);
		expect(plan.canContinue).toBe(true);
	});

	test("an unreadable pending new game is a fault with nothing to continue, under either boot mode", async () => {
		for (const boot of ["overlay", "direct"] as const) {
			const o = origin();
			await o.save(DEFAULT_SLOT);
			await o.backend.writeMeta({ pending: { name: 3 } });
			const plan = await o.boot({ boot });
			expect(plan.fault).not.toBeNull();
			expect(plan.canContinue).toBe(false);
			expect(plan.loaded).toBeNull();
		}
	});

	test("a refused load is a fault naming the Commander, which Export can still reach", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT);
		await o.backend.corruptVersion(DEFAULT_SLOT, "live");
		const plan = await o.boot();
		expect(plan.fault).toContain(`Commander "${DEFAULT_SLOT}"`);
		expect(plan.faultSlot).toBe(DEFAULT_SLOT);
		expect(plan.canContinue).toBe(false);
		expect(await o.catalog.exportSlot(DEFAULT_SLOT)).toContain("live");
	});
});

describe("the one-shot continue (§11.3)", () => {
	test("after Load, exactly one boot continues into the Commander the pointer names", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		const first = await o.boot();
		expect(first.mode).toBe("continue");
		expect(first.slot).toBe("Jameson");
		const second = await o.boot();
		expect(second.mode).toBe("overlay");
		expect(second.slot).toBe("Jameson");
	});

	test("after New game, exactly one boot continues into the new Commander", async () => {
		const o = origin();
		await o.catalog.beginNewGame({ name: "New", seed: 5, permadeath: false });
		expect((await o.boot()).mode).toBe("continue");
		expect((await o.boot()).mode).toBe("overlay");
	});

	test("after Import, exactly one boot continues into the imported Commander", async () => {
		const o = origin();
		await o.save("Source");
		const text = await o.catalog.exportSlot("Source");
		const reloads: number[] = [];
		const sw = new CommanderSwitch({
			catalog: o.catalog,
			store: () => null,
			reload: () => reloads.push(1),
		});
		await sw.importCommander("Imported", text);
		expect(reloads.length).toBe(1);
		const first = await o.boot();
		expect([first.mode, first.slot]).toEqual(["continue", "Imported"]);
		expect((await o.boot()).mode).toBe("overlay");
	});

	test("a one-shot into a Commander whose load fails is discarded and the overlay opens with the fault", async () => {
		const o = origin();
		await o.save("Broken");
		await o.catalog.chooseCommander("Broken");
		await o.backend.truncate("Broken", "live");
		const plan = await o.boot();
		expect(plan.mode).toBe("overlay");
		expect(plan.fault).not.toBeNull();
		expect((await o.boot()).mode).toBe("overlay");
	});

	test("a direct boot consumes a one-shot too, so the next player boot still opens the overlay", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		expect((await o.boot({ boot: "direct" })).mode).toBe("direct");
		expect((await o.boot()).mode).toBe("overlay");
	});

	test("`?no-save` reads and consumes nothing", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		const plan = await o.boot({ noSave: true });
		expect(plan.loaded).toBeNull();
		expect(plan.slot).toBe(DEFAULT_SLOT);
		expect((await o.boot()).mode).toBe("continue");
	});
});

/**
 * `?system=<index>` (#432), the boot affordance that lets a script stand the page
 * at a named star. It outlived the view row it was built for: see the note beside
 * `sky-only` in `scripts/lib/view-set.mjs`.
 *
 * §11.6 of `persistent-world-state.md` owns the rule that such a boot writes
 * nothing, and why — a named system carries none of the disagreement that makes
 * `?seed` protective, so the set-aside never reaches it. This file's job is that
 * the plan answers it, and the rows below are the ones §11.7's obligation points
 * at: reads nothing, writes nothing, and leaves the save continuable afterwards.
 */
describe("`?system` pins where the ship boots and writes nothing (§11.6)", () => {
	test("a pinned boot reads nothing and writes nothing, beside its own save", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT, SEED);
		await o.catalog.chooseCommander(DEFAULT_SLOT);
		// Same seed as the save, which is the arm that would otherwise load it,
		// attach a store, and overwrite the Commander with a different start.
		const plan = await o.boot({
			boot: "direct",
			querySeed: SEED,
			pinnedSystem: 161,
		});
		expect(plan.loaded).toBeNull();
		expect(plan.writesNothing).toBe(true);
		expect(plan.canContinue).toBe(true);
		// **The third half of the obligation, and asserted rather than titled:**
		// a later plain boot still loads that Commander, so the pinned boot left
		// the pointer and the continue alone. No continue was *set up* for the
		// pinned boot to consume — under `?boot=direct` there is no overlay to
		// arm one — which is why this reads as "left alone" and not "consumed".
		expect((await o.boot({ boot: "direct" })).loaded?.world.seed).toBe(SEED);
	});

	test("it says which system the boot was pinned to", async () => {
		const o = origin();
		const plan = await o.boot({ boot: "direct", pinnedSystem: 161 });
		expect(plan.notice).not.toBeNull();
		expect(plan.notice).toContain("161");
		expect(plan.fault).toBeNull();
	});

	/**
	 * `writesNothing` is the field the shell reads before attaching a store, and
	 * it now has two authors. A row that pins both is the only thing between a
	 * new affordance and a store quietly attaching to a fixture boot.
	 */
	test("writesNothing says which boots touch storage, and an ordinary one does", async () => {
		const o = origin();
		expect((await o.boot({ boot: "direct" })).writesNothing).toBe(false);
		expect((await o.boot({ noSave: true })).writesNothing).toBe(true);
		expect((await o.boot({ pinnedSystem: 3 })).writesNothing).toBe(true);
	});
});

describe("`?seed` sets a Commander aside only under `?boot=direct` (§11.6)", () => {
	test("without direct, a differing seed loads the Commander and only pre-fills New game", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT, SEED);
		const plan = await o.boot({ querySeed: OTHER_SEED });
		expect(plan.fault).toBeNull();
		expect(plan.loaded?.world.seed).toBe(SEED);
		expect(plan.canContinue).toBe(true);
		expect(plan.seedPrefill).toBe(OTHER_SEED);
	});

	test("under direct, a differing seed sets the Commander aside as a fault", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT, SEED);
		const plan = await o.boot({ boot: "direct", querySeed: OTHER_SEED });
		expect(plan.loaded).toBeNull();
		expect(plan.fault).toContain(String(OTHER_SEED));
		expect(plan.seedPrefill).toBeNull();
	});

	test("under direct, the same seed loads", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT, SEED);
		const plan = await o.boot({ boot: "direct", querySeed: SEED });
		expect(plan.fault).toBeNull();
		expect(plan.loaded).not.toBeNull();
	});
});

describe("attachCommander: no store before the lock (§11.2 step 5, §11.3)", () => {
	test("a Commander another tab holds attaches nothing and says so", async () => {
		const o = origin();
		await o.save("Jameson");
		const other = o.store("Jameson");
		expect(await other.hold()).toBe(true);
		const attached: SaveStore[] = [];
		const result = await attachCommander({
			slot: "Jameson",
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: null,
			pending: null,
			makeStore: (slot) => o.store(slot),
			onHeld: (store) => attached.push(store),
		});
		expect(result).toEqual({
			attached: false,
			fault: lockHeldFault("Jameson"),
		});
		expect(attached.length).toBe(0);
	});

	test("a lock request that fails is a fault, not a Commander held elsewhere", async () => {
		const o = origin();
		const refusing: SlotLocks = {
			tryHold: () => Promise.reject(new Error("SecurityError")),
		};
		const attached: SaveStore[] = [];
		const result = await attachCommander({
			slot: DEFAULT_SLOT,
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: null,
			pending: null,
			makeStore: (slot) =>
				new SaveStore({
					backend: o.backend,
					locks: refusing,
					slot,
					schedule: () => () => {},
					current: () => envelope(),
				}),
			onHeld: (store) => attached.push(store),
		});
		expect(result.attached).toBe(false);
		expect(result.fault).toBe(
			lockRequestFault(DEFAULT_SLOT, new Error("SecurityError")),
		);
		expect(attached.length).toBe(0);
	});

	test("a held lock attaches the store, and a Commander with a store attached refuses rename and delete", async () => {
		const o = origin();
		await o.save("Jameson");
		const attached: SaveStore[] = [];
		const result = await attachCommander({
			slot: "Jameson",
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: recordText(await o.backend.read("Jameson", "live")),
			pending: null,
			makeStore: (slot) => o.store(slot),
			onHeld: (store) => attached.push(store),
		});
		expect(result).toEqual({ attached: true, fault: null });
		expect(attached.length).toBe(1);
		await expect(o.catalog.deleteSlot("Jameson")).rejects.toThrow(
			/open in another tab/,
		);
	});

	test("a pending new game survives until its first `live` write lands, and clears after", async () => {
		const o = origin();
		await o.catalog.beginNewGame({ name: "New", seed: 5, permadeath: false });
		const plan = await o.boot();
		o.backend.hold();
		const attaching = attachCommander({
			slot: plan.slot,
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: plan.record,
			pending: plan.pending,
			makeStore: (slot) => o.store(slot, () => envelope(5)),
			onHeld: () => {},
		});
		while (o.backend.inFlight === 0) await Bun.sleep(1);
		expect(await o.backend.readMeta("pending")).not.toBeNull();
		expect(await o.backend.has("New", "live")).toBe(false);
		o.backend.release();
		expect(await attaching).toEqual({ attached: true, fault: null });
		expect(await o.backend.has("New", "live")).toBe(true);
		expect(await o.backend.readMeta("pending")).toBeNull();
	});

	test("a first write that fails keeps the pending new game on disk and reports the fault", async () => {
		const o = origin();
		await o.catalog.beginNewGame({ name: "New", seed: 5, permadeath: false });
		const plan = await o.boot();
		o.backend.failNextWrite();
		const result = await attachCommander({
			slot: plan.slot,
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: plan.record,
			pending: plan.pending,
			makeStore: (slot) => o.store(slot),
			onHeld: () => {},
		});
		expect(result.attached).toBe(true);
		expect(result.fault).not.toBeNull();
		expect(await o.backend.readMeta("pending")).not.toBeNull();
	});
});

describe("CommanderSwitch: what reloads, and the awaited flush (§11.3)", () => {
	const setup = async (options: { withStore?: boolean } = {}) => {
		const o = origin();
		await o.save("A");
		await o.save("B");
		let store: SaveStore | null = null;
		if (options.withStore) {
			store = o.store("A");
			expect(await store.hold()).toBe(true);
		}
		let reloads = 0;
		const sw = new CommanderSwitch({
			catalog: o.catalog,
			store: () => store,
			reload: () => {
				reloads += 1;
			},
		});
		return { o, sw, reloads: () => reloads };
	};

	test("New game, Load and Import each reload once", async () => {
		const a = await setup();
		await a.sw.newGame({ name: "N", seed: 1, permadeath: false });
		expect(a.reloads()).toBe(1);

		const b = await setup();
		await b.sw.load("B");
		expect(b.reloads()).toBe(1);

		const c = await setup();
		await c.sw.importCommander("C", await c.o.catalog.exportSlot("B"));
		expect(c.reloads()).toBe(1);
	});

	test("Export, Rename and Delete never reload", async () => {
		const s = await setup();
		expect(await s.sw.exportCommander("B")).toContain("live");
		await s.sw.rename("B", "B2");
		await s.sw.remove("B2");
		expect(s.reloads()).toBe(0);
		expect(await s.o.catalog.slots()).toEqual(["A"]);
	});

	test("a switch out of a game in play awaits its flush, and a failed flush refuses the switch", async () => {
		const s = await setup({ withStore: true });
		s.o.backend.failNextWrite();
		await expect(s.sw.load("B")).rejects.toThrow();
		expect(s.reloads()).toBe(0);
		expect(await s.o.backend.readMeta("active")).toBeNull();
		expect(await s.o.backend.readMeta("oneShot")).toBeNull();

		const before = s.o.backend.writes;
		await s.sw.load("B");
		expect(s.o.backend.writes).toBeGreaterThan(before);
		expect(s.reloads()).toBe(1);
	});

	test("a refused choice reloads nothing", async () => {
		const s = await setup();
		await expect(
			s.sw.newGame({ name: "A", seed: 1, permadeath: false }),
		).rejects.toThrow(/already a Commander/);
		await expect(s.sw.importCommander("B", "{}")).rejects.toThrow();
		expect(s.reloads()).toBe(0);
	});
});

describe("the overlay's words name the Commander, never the slot (§11.5)", () => {
	// The storage word, and `CONTEXT.md`'s Commander entry's player-facing
	// _Avoid_ list, as the label row in `commander-overlay.test.ts` checks.
	const SLOT_WORD = /\b(slot|save game|save file|profile)\b/i;

	test("every fault a boot, an attach or a switch can hand the overlay", async () => {
		const messages: string[] = [
			lockHeldFault("Jameson"),
			lockRequestFault("Jameson", new Error("SecurityError")),
			restoreFault("Jameson", new Error("bad")),
			// In play, through the badge (§11.5).
			flushFault("dock", new Error("QuotaExceededError")),
			writeFault(SAVE_RETRY_LIMIT, new Error("QuotaExceededError")),
		];
		const collect = async (run: () => Promise<unknown>) => {
			try {
				await run();
			} catch (error) {
				messages.push(messageOf(error));
			}
		};

		const corrupt = origin();
		await corrupt.save(DEFAULT_SLOT);
		await corrupt.backend.corruptVersion(DEFAULT_SLOT, "live");
		const refused = await corrupt.boot();
		messages.push(refused.fault ?? "");

		const truncated = origin();
		await truncated.save(DEFAULT_SLOT);
		await truncated.backend.truncate(DEFAULT_SLOT, "live");
		messages.push((await truncated.boot()).fault ?? "");

		const seeded = origin();
		await seeded.save(DEFAULT_SLOT, SEED);
		messages.push(
			(await seeded.boot({ boot: "direct", querySeed: OTHER_SEED })).fault ??
				"",
		);

		const pending = origin();
		await pending.backend.writeMeta({ pending: { name: 3 } });
		messages.push((await pending.boot()).fault ?? "");

		const gone = origin();
		await gone.backend.writeMeta({ active: "gone" });
		messages.push((await gone.boot()).notice ?? "");

		const ops = origin();
		await ops.save("A");
		await collect(() => ops.catalog.exportSlot("nobody"));
		await collect(() => ops.catalog.importSlot("A", "{}"));
		await collect(() => ops.catalog.importSlot("Z", "not json"));
		await collect(() => ops.catalog.importSlot("Z", "{}"));
		await collect(() => ops.catalog.renameSlot("A", ""));
		await collect(() =>
			ops.catalog.beginNewGame({ name: "A", seed: 1, permadeath: false }),
		);
		const held = ops.store("A");
		await held.hold();
		await collect(() => ops.catalog.deleteSlot("A"));
		await collect(() => ops.catalog.chooseCommander("A"));

		// Guard the guard: every arm above produced a message.
		expect(messages.filter((m) => m.length > 0).length).toBe(messages.length);
		expect(messages.length).toBe(18);
		for (const message of messages)
			expect(`${message}: ${SLOT_WORD.test(message)}`).toBe(
				`${message}: false`,
			);
	});
});

describe("a fault is a sentence for the player, then its detail (§11.5)", () => {
	const refused = new Error("save: saveSchemaVersion undefined is not 2");

	test("the storage modules' own `save:` prefix is not the player's", () => {
		expect(messageOf(refused)).toBe("saveSchemaVersion undefined is not 2");
		expect(messageOf(new Error("the backend: no"))).toBe("the backend: no");
	});

	test("each builder's first line is a sentence, and the reason follows on its own line", () => {
		expect(loadFault("Jameson", refused)).toBe(
			'Commander "Jameson" would not load. It is left as it is on disk; ' +
				"Export takes a copy of it.\nsaveSchemaVersion undefined is not 2",
		);
		for (const fault of [
			loadFault("Jameson", refused),
			restoreFault("Jameson", refused),
			lockRequestFault("Jameson", refused),
			flushFault("dock", refused),
			writeFault(3, refused),
		]) {
			const [sentence, detail, ...rest] = fault.split("\n");
			expect(`${sentence}`).toMatch(/\.$/);
			expect(sentence).not.toContain("save:");
			expect(detail).toBe("saveSchemaVersion undefined is not 2");
			expect(rest).toEqual([]);
		}
	});

	test("a reason with no words adds no empty detail line", () => {
		expect(flushFault("jump", new Error(""))).toBe(
			"the jump save would not write.",
		);
	});
});

describe("the rules a boot applies after the plan (§11.2, §11.3, D7, D9)", () => {
	test("a record that parses and will not restore is a fault, and a one-shot into it opens the overlay", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		const plan = await o.boot();
		expect(plan.mode).toBe("continue");
		const faulted = withRestoreFault(plan, new Error("bad hull"));
		// D9: a one-shot boot would otherwise attach a store over the record.
		expect(faulted.mode).toBe("overlay");
		expect(faulted.fault).toBe(restoreFault("Jameson", new Error("bad hull")));
		expect(faulted.faultSlot).toBe("Jameson");
		expect(faulted.loaded).toBeNull();
		expect(faulted.canContinue).toBe(false);
		// The plan it was given is not changed under the caller.
		expect(plan.mode).toBe("continue");
	});

	test("a restore fault leaves an overlay or a direct boot in its own mode", async () => {
		const o = origin();
		await o.save(DEFAULT_SLOT);
		for (const boot of ["overlay", "direct"] as const) {
			const faulted = withRestoreFault(await o.boot({ boot }), "bad");
			expect(faulted.mode).toBe(boot);
			expect(faulted.fault).not.toBeNull();
		}
	});

	test("an attach finishes the pending new game only for the Commander it names", async () => {
		const o = origin();
		await o.catalog.beginNewGame({ name: "New", seed: 5, permadeath: true });
		const plan = await o.boot();
		expect(pendingFor(plan, "New")?.seed).toBe(5);
		expect(pendingFor(plan, "Other")).toBeNull();
	});

	test("permadeath is chosen by New game, or by `?permadeath` on a direct boot with nothing loaded, and never otherwise", async () => {
		const pending = origin();
		await pending.catalog.beginNewGame({
			name: "New",
			seed: 5,
			permadeath: true,
		});
		const pendingPlan = await pending.boot();
		expect(permadeathAtAttach(pendingPlan, "New", false)).toBe(true);
		expect(permadeathAtAttach(pendingPlan, "Other", true)).toBe(false);

		const chosenOff = origin();
		await chosenOff.catalog.beginNewGame({
			name: "Off",
			seed: 5,
			permadeath: false,
		});
		expect(
			permadeathAtAttach(await chosenOff.boot({ boot: "direct" }), "Off", true),
		).toBe(false);

		const fresh = origin();
		expect(
			permadeathAtAttach(
				await fresh.boot({ boot: "direct" }),
				DEFAULT_SLOT,
				true,
			),
		).toBe(true);
		expect(
			permadeathAtAttach(
				await fresh.boot({ boot: "direct" }),
				DEFAULT_SLOT,
				false,
			),
		).toBe(false);
		// A query parameter cannot choose it for a Commander the overlay offered.
		expect(permadeathAtAttach(await fresh.boot(), DEFAULT_SLOT, true)).toBe(
			false,
		);

		const loaded = origin();
		await loaded.save(DEFAULT_SLOT);
		expect(
			permadeathAtAttach(
				await loaded.boot({ boot: "direct" }),
				DEFAULT_SLOT,
				true,
			),
		).toBe(false);
	});
});

describe("an attach reads the record again once it holds the lock (§11.3)", () => {
	test("a boot keeps the record it read, as text", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		const plan = await o.boot();
		expect(plan.record).toBe(
			recordText(await o.backend.read("Jameson", "live")),
		);
		expect((await origin().boot()).record).toBeNull();
	});

	test("a record another tab saved after this boot read it is not attached to, and the lock is given back", async () => {
		// The page's game was built from the boot's read. A store attached to it
		// would write that older world over the other tab's progress on the
		// first dirty event, or on the quit flush.
		const o = origin();
		await o.save("Jameson", SEED);
		await o.catalog.chooseCommander("Jameson");
		await o.catalog.takeOneShot();
		const plan = await o.boot();
		await o.backend.write(
			"Jameson",
			"live",
			serializeSave(envelope(OTHER_SEED)),
		);
		const attached: SaveStore[] = [];
		const result = await attachCommander({
			slot: "Jameson",
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: plan.record,
			pending: null,
			makeStore: (slot) => o.store(slot),
			onHeld: (store) => attached.push(store),
		});
		expect(result).toEqual({ attached: false, fault: null, stale: true });
		expect(attached.length).toBe(0);
		expect(await o.store("Jameson").hold()).toBe(true);
	});

	test("an unchanged record attaches", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		const plan = await o.boot();
		const result = await attachCommander({
			slot: "Jameson",
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: plan.record,
			pending: null,
			makeStore: (slot) => o.store(slot),
			onHeld: () => {},
		});
		expect(result).toEqual({ attached: true, fault: null });
	});

	test("a one-shot refused by another tab's lock opens the overlay and keeps Continue for a retry", async () => {
		const o = origin();
		await o.save("Jameson");
		await o.catalog.chooseCommander("Jameson");
		const plan = await o.boot();
		expect(plan.mode).toBe("continue");
		const faulted = withLockFault(plan, "held");
		expect([faulted.mode, faulted.fault, faulted.canContinue]).toEqual([
			"overlay",
			"held",
			true,
		]);
		expect(faulted.faultSlot).toBeNull();
		expect(plan.mode).toBe("continue");
	});

	test("a pending new game's Commander that another tab saved since the boot read is not overwritten", async () => {
		// Two tabs booted while the pending record was on disk. Tab A continued,
		// played and closed; tab B's attach would write a fresh world over it.
		const o = origin();
		await o.catalog.beginNewGame({ name: "New", seed: 5, permadeath: false });
		await o.catalog.takeOneShot();
		const plan = await o.boot();
		expect(plan.pending?.name).toBe("New");
		await o.backend.write("New", "live", serializeSave(envelope(5)));
		const before = await o.backend.read("New", "live");
		const attached: SaveStore[] = [];
		const result = await attachCommander({
			slot: "New",
			catalog: o.catalog,
			backend: o.backend,
			bootRecord: plan.record,
			pending: pendingFor(plan, "New"),
			makeStore: (slot) => o.store(slot, () => envelope(OTHER_SEED)),
			onHeld: (store) => attached.push(store),
		});
		expect(result).toEqual({ attached: false, fault: null, stale: true });
		expect(attached.length).toBe(0);
		expect(await o.backend.read("New", "live")).toEqual(before);
		expect(await o.store("New").hold()).toBe(true);
	});
});
