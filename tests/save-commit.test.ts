/**
 * #936 D1–D5 as a state machine, built by node #943.
 *
 * `SaveStore.commit` is the shared transactional write the durable gameplay
 * transactions resolution ratified: the candidate is the op applied to the
 * current envelope, a landed commit adopts **only the footprint** the op names
 * (D1), a commit made while docked writes `live` and `lastDocked` in one
 * transaction (D2), one `txSeq` refuses stale and repeat ops (D4), and a write
 * that does not settle is decided by reading `live` back, never by a blind
 * retry (D4's outcomes). The Game-level Saving display and D3's suppression of
 * repeat input and departure come with the first consumer, not here.
 *
 * Everything runs against the in-memory fake backend, which can resolve,
 * reject or hang a write on demand, and an injected scheduler that holds every
 * armed timer — the debounce and the commit timeout side by side — because bun
 * has no fake `setTimeout` and a timeout test on the wall clock would be
 * measuring the machine.
 */

import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { newCommanderRecord, type SaveEnvelope } from "../src/save-envelope";
import {
	memorySaveBackend,
	memorySlotLocks,
	type SaveCommitOp,
	type SaveCommitOutcome,
	SAVE_COMMIT_TIMEOUT_MS,
	SAVE_DEBOUNCE_MS,
	SaveStore,
	type Scheduler,
} from "../src/save-store";
import { LOCAL_CARRIER_ID } from "../src/station";
import { newWorld, visit } from "../src/world-state";

const SEED = 0x5ee11e;
const SLOT = "committer";
const KEY = carrierKey(3, LOCAL_CARRIER_ID.trade);

/** A scheduler that holds every armed timer, so the debounce and the commit
 *  timeout can be pending at once and each fired by hand. */
const timerScheduler = () => {
	let next = 1;
	const timers = new Map<number, { fn: () => void; ms: number }>();
	const scheduler: Scheduler = (fn, ms) => {
		const id = next;
		next += 1;
		timers.set(id, { fn, ms });
		return () => {
			timers.delete(id);
		};
	};
	return {
		scheduler,
		/** The delays currently armed. */
		armed: () => [...timers.values()].map((t) => t.ms),
		/** Fire every timer armed with exactly `ms`, cancelling them. */
		fire(ms: number) {
			for (const [id, t] of [...timers])
				if (t.ms === ms) {
					timers.delete(id);
					t.fn();
				}
		},
	};
};

/** Let every pending microtask (queue handoffs, adoption, resolution) run. A
 *  macrotask boundary, not a measurement: it waits for quiescence, not for a
 *  debounce window. */
const quiesce = () => new Promise((resolve) => setTimeout(resolve, 0));

const envelope = (credits: number): SaveEnvelope => ({
	world: visit(newWorld(SEED), 0, 3),
	commander: {
		...newCommanderRecord("courier"),
		state: { ...newCommanderRecord("courier").state, credits },
		dockedAt: KEY,
	},
});

/** A store over live state the test mutates by hand — which is what `Game`
 *  will pass: `current` is a getter, and adoption is the op's callback moving
 *  footprint fields back into that live state (D1). */
const harness = () => {
	const clock = timerScheduler();
	const backend = memorySaveBackend();
	let state = envelope(100);
	const store = new SaveStore({
		backend,
		locks: memorySlotLocks(),
		schedule: clock.scheduler,
		slot: SLOT,
		current: () => state,
	});
	return {
		backend,
		clock,
		store,
		get state() {
			return state;
		},
		/** Change live world state the way a flown frame would: the clock moves
		 *  on and a system gets visited. Neither is in any op's footprint. */
		fly(systemIndex: number, seconds: number) {
			state = {
				...state,
				world: {
					...visit(state.world, 0, systemIndex),
					gameTime: state.world.gameTime + seconds,
				},
			};
		},
		/** The op under test: debit credits, and on adoption take only the
		 *  footprint — credits and `txSeq` — from the committed record. */
		debit(
			tonnes: number,
			options: { checkpoint?: boolean } = {},
		): SaveCommitOp {
			return {
				txSeq: state.commander.txSeq,
				checkpoint: options.checkpoint,
				apply: (env) => ({
					world: env.world,
					commander: {
						...env.commander,
						state: {
							...env.commander.state,
							credits: env.commander.state.credits - tonnes,
						},
					},
				}),
				adopt: (committed) => {
					state = {
						...state,
						commander: {
							...state.commander,
							txSeq: committed.commander.txSeq,
							state: {
								...state.commander.state,
								credits: committed.commander.state.credits,
							},
						},
					};
				},
			};
		},
	};
};

describe("#936 D1/D4 — commit lands", () => {
	test("a resolving write commits the debit, advances txSeq once, and the record matches", async () => {
		const h = harness();
		const outcome = await h.store.commit(h.debit(50));
		expect(outcome).toBe("committed");
		expect(h.state.commander.state.credits).toBe(50);
		expect(h.state.commander.txSeq).toBe(1);
		// The record that was written carries the same txSeq the live state now
		// holds — not just a newer one, the same one (D4).
		const written = (await h.backend.raw(SLOT, "live")) as {
			commander: { txSeq: number; state: { credits: number } };
		};
		expect(written.commander.txSeq).toBe(h.state.commander.txSeq);
		expect(written.commander.state.credits).toBe(50);
		expect(h.backend.writes).toBe(1);
	});

	test("checkpoint: true writes live and lastDocked in one writeMany with the same bytes (D2)", async () => {
		const h = harness();
		expect(await h.store.commit(h.debit(50, { checkpoint: true }))).toBe(
			"committed",
		);
		const calls = h.backend.writeManyCalls;
		expect(calls.length).toBe(1);
		expect(calls[0]?.kinds).toEqual(["live", "lastDocked"]);
		const live = await h.backend.raw(SLOT, "live");
		const docked = await h.backend.raw(SLOT, "lastDocked");
		expect(live).toEqual(docked);
	});

	test("the clock and a world field outside the footprint survive adoption (D1, case 7)", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const pending = h.store.commit(h.debit(50));
		expect(h.backend.inFlight).toBe(1);
		// The world moves while the write is in flight — the clock, and a visit
		// outside any footprint the op names.
		h.fly(7, 600);
		h.backend.release();
		expect(await pending).toBe("committed");
		// Live keeps the new clock and the new field, and takes only the
		// footprint from the candidate.
		expect(h.state.world.gameTime).toBe(600);
		expect(h.state.world.galaxies[0].visited).toContain(7);
		expect(h.state.commander.state.credits).toBe(50);
	});

	test("a debounced markDirty armed mid-commit serializes the state that includes the commit (D1's hazard, case 6)", async () => {
		const h = harness();
		h.backend.hold();
		const pending = h.store.commit(h.debit(50));
		h.store.markDirty();
		h.clock.fire(SAVE_DEBOUNCE_MS);
		h.backend.release();
		expect(await pending).toBe("committed");
		await quiesce();
		// The debounced write serialized `current()` again — and what it put on
		// disk is the state after adoption, not the state from before it.
		const written = (await h.backend.raw(SLOT, "live")) as {
			commander: { state: { credits: number } };
		};
		expect(written.commander.state.credits).toBe(50);
		expect(h.backend.writes).toBe(2);
	});
});

describe("#936 D4 — the definite outcomes", () => {
	test("a rejected write resolves failed, changes nothing, and holds the fault for the kinds written (case 3)", async () => {
		const h = harness();
		h.backend.failNextWrite();
		expect(await h.store.commit(h.debit(50))).toBe("failed");
		expect(h.state.commander.state.credits).toBe(100);
		expect(h.state.commander.txSeq).toBe(0);
		expect([...h.store.faultKinds]).toEqual(["live"]);
		expect(h.store.heldFaults.get("live")?.reason).toBe("commit");
		// A checkpoint commit holds both kinds, because both were written.
		h.backend.failNextWrite();
		expect(await h.store.commit(h.debit(50, { checkpoint: true }))).toBe(
			"failed",
		);
		expect(h.store.faultKinds.has("live")).toBe(true);
		expect(h.store.faultKinds.has("lastDocked")).toBe(true);
	});

	test("an op recorded against another txSeq resolves stale and writes nothing (D4, case 5/6)", async () => {
		const h = harness();
		await h.store.commit(h.debit(50));
		const writes = h.backend.writes;
		// The second submission: the action still carries the txSeq it was
		// quoted at, which is no longer the current one.
		const repeat: SaveCommitOp = {
			...h.debit(50),
			txSeq: 0,
		};
		expect(await h.store.commit(repeat)).toBe("stale");
		expect(h.backend.writes).toBe(writes);
		expect(h.state.commander.state.credits).toBe(50);
	});

	test("a retired store refuses to commit", async () => {
		const h = harness();
		// The death path refuses a pilot who docked with no checkpoint to
		// restore, so retire behind a docked commit — which is also the state
		// the revert writes from.
		await h.store.commit(h.debit(50, { checkpoint: true }));
		await h.store.revertToLastDocked({ permadeath: false }, "destroyed");
		await expect(h.store.commit(h.debit(50))).rejects.toThrow(/retired/);
	});
});

describe("#936 D4 — a write that does not settle (case 4)", () => {
	test("SAVE_COMMIT_TIMEOUT_MS is 10 000 and commit arms exactly that", async () => {
		expect(SAVE_COMMIT_TIMEOUT_MS).toBe(10_000);
		const h = harness();
		h.backend.hangNextWrite();
		const pending = h.store.commit(h.debit(50));
		expect(h.clock.armed()).toContain(SAVE_COMMIT_TIMEOUT_MS);
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		await pending;
		h.backend.release();
		await h.store.settled();
	});

	test("a read-back that finds the txSeq advanced resolves committed and adopts from the record it read", async () => {
		const h = harness();
		// The ack never arrives, but the record did land: the page tore down
		// between commit and acknowledgement (case 2 in the failure list).
		h.backend.hangNextWriteApplied();
		const pending = h.store.commit(h.debit(50));
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		expect(await pending).toBe("committed");
		expect(h.state.commander.state.credits).toBe(50);
		expect(h.state.commander.txSeq).toBe(1);
		expect(h.store.hasUncertainCommit).toBe(false);
		h.backend.release();
		await h.store.settled();
	});

	test("a read-back that finds the previous txSeq resolves failed and leaves a retry allowed", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const pending = h.store.commit(h.debit(50));
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		expect(await pending).toBe("failed");
		expect(h.state.commander.state.credits).toBe(100);
		expect(h.state.commander.txSeq).toBe(0);
		expect(h.store.hasUncertainCommit).toBe(false);
		h.backend.release();
		await h.store.settled();
	});

	test("a retry queues behind the unsettled write; when that write lands the store adopts it and the retry resolves stale", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const first = h.store.commit(h.debit(50));
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		expect(await first).toBe("failed");
		// The retry: the same op, recorded at the same txSeq (D4: the read-back
		// found the previous value, so the retry has the same txSeq).
		const retry: SaveCommitOp = { ...h.debit(50), txSeq: 0 };
		const retried = h.store.commit(retry);
		h.backend.release(); // the first write lands after the retry was queued
		expect(await retried).toBe("stale");
		// The store adopted the late landing — exactly one debit, one write, and
		// no double write of the same value.
		expect(h.state.commander.state.credits).toBe(50);
		expect(h.state.commander.txSeq).toBe(1);
		expect(h.backend.writeManyCalls.length).toBe(1);
	});

	test("a read-back that throws resolves uncertain, and a second commit is refused until a read succeeds", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const pending = h.store.commit(h.debit(50));
		h.backend.failNextRead();
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		expect(await pending).toBe("uncertain");
		expect(h.store.hasUncertainCommit).toBe(true);
		// A blind retry is never made (D4): the store refuses to write again
		// while the outcome of the last one is unknown.
		await expect(h.store.commit({ ...h.debit(50), txSeq: 0 })).rejects.toThrow(
			/uncertain/,
		);
		// A read succeeds, and it settles the outcome for good: the previous
		// txSeq is on disk, so the write did not land and a retry is allowed.
		expect(await h.store.resolveUncertainCommit()).toBe("failed");
		expect(h.store.hasUncertainCommit).toBe(false);
		const retry = h.store.commit({ ...h.debit(50), txSeq: 0 });
		h.backend.release();
		expect(await retry).toBe("stale"); // accepted — refused never once more
		expect(h.state.commander.state.credits).toBe(50);
	});

	test("a late landing settles an uncertain outcome by itself: adoption, and the refusal lifts", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const pending = h.store.commit(h.debit(50));
		h.backend.failNextRead();
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		expect(await pending).toBe("uncertain");
		h.backend.release();
		await h.store.settled();
		// The write itself is the strongest read: it landed, so the commit did
		// too, and the footprint is adopted through the same pre-`inFlight`
		// order as a directly-acknowledged one.
		expect(h.store.hasUncertainCommit).toBe(false);
		expect(h.state.commander.state.credits).toBe(50);
		expect(h.state.commander.txSeq).toBe(1);
	});

	test("a late definite failure settles an uncertain outcome toward retry", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const pending = h.store.commit(h.debit(50));
		h.backend.failNextRead();
		h.clock.fire(SAVE_COMMIT_TIMEOUT_MS);
		expect(await pending).toBe("uncertain");
		// The transaction aborted after all. Nothing to adopt, nothing held
		// back: the refusal lifts and the fault is the one any failure holds.
		h.backend.failNextWrite(); // fails the write that releases from the gate
		h.backend.release();
		await h.store.settled();
		expect(h.store.hasUncertainCommit).toBe(false);
		expect(h.state.commander.state.credits).toBe(100);
		expect([...h.store.faultKinds]).toEqual(["live"]);
	});
});

describe("#936 D2/D3 — death around a commit", () => {
	test("revertToLastDocked waits for a pending commit and its outcome before it reads lastDocked (case 10)", async () => {
		const h = harness();
		h.backend.hangNextWrite();
		const commit = h.store.commit(h.debit(50, { checkpoint: true }));
		// A death while the commit is pending: the revert must not read the
		// checkpoint that is about to be replaced.
		const reverted = h.store.revertToLastDocked(
			{ permadeath: false },
			"destroyed",
		);
		h.backend.release();
		expect(await commit).toBe("committed");
		const restored = await reverted;
		// It read the checkpoint the commit wrote, not the one before it: the
		// credits and the txSeq it woke on agree with the world.
		expect(restored?.commander.state.credits).toBe(50);
		expect(restored?.commander.txSeq).toBe(1);
	});
});

describe("#936 D4 — the outcome type is the whole contract", () => {
	test("commit resolves one of the four named outcomes", async () => {
		const h = harness();
		const outcome: SaveCommitOutcome = await h.store.commit(h.debit(1));
		expect(["committed", "failed", "stale", "uncertain"]).toContain(outcome);
	});

	test("an op whose recorded txSeq is not a non-negative safe integer is refused, not written", async () => {
		const h = harness();
		for (const txSeq of [-1, 1.5, 2 ** 53]) {
			await expect(h.store.commit({ ...h.debit(50), txSeq })).rejects.toThrow(
				/txSeq/,
			);
		}
		expect(h.backend.writes).toBe(0);
	});
});
