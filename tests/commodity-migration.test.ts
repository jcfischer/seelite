import { expect, test } from "bun:test";
import { newWorld } from "../src/world-state";
import {
	newCommanderRecord,
	serializeSave,
	parseSave,
	type SaveEnvelope,
} from "../src/save-envelope";
import {
	CommanderCatalog,
	memorySaveBackend,
	memorySlotLocks,
	SaveStore,
	SAVE_COMMIT_TIMEOUT_MS,
	type Scheduler,
} from "../src/save-store";
import { fnv1a } from "../src/rng";
import { money, signedMoney } from "../src/exact-amount";
const legacy = (cash: number) => {
	const e: SaveEnvelope = {
		world: newWorld(47),
		commander: newCommanderRecord("courier"),
	};
	e.commander.state = {
		...e.commander.state,
		credits: cash,
		cargo: { Alloys: 0.5, Gold: Number.MIN_VALUE },
	};
	e.commander.ladders = {
		...e.commander.ladders,
		banked: { ...e.commander.ladders.banked, trade: 0.1 },
		basis: { Alloys: { units: 0.25, cr: 0.1 }, Gold: { units: 0, cr: 3 } },
	};
	const blob = serializeSave(e) as any;
	delete blob.commander.state.accounting;
	blob.saveSchemaVersion = 19;
	const { integrity, ...body } = blob;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

test("migration writes distinct live and launch records atomically before returning", async () => {
	const backend = memorySaveBackend(),
		locks = memorySlotLocks();
	await backend.write("pilot", "live", legacy(0.1));
	await backend.write("pilot", "lastDocked", legacy(-0.1));
	const catalog = new CommanderCatalog({ backend, locks });
	const raw = await catalog.prepareForBoot("pilot");
	const live = parseSave(raw),
		checkpoint = parseSave(await backend.read("pilot", "lastDocked"));
	expect((raw as any).saveSchemaVersion).toBe(20);
	expect(live.commander.state.accounting!.cash).toBe(
		signedMoney.fromNumber(0.1),
	);
	expect(checkpoint.commander.state.accounting!.cash).toBe(
		signedMoney.fromNumber(-0.1),
	);
	expect(live.commander.state.accounting!.bankedTrade).toBe(
		money.fromNumber(0.1),
	);
	expect(live.commander.state.accounting!.pools.Gold.unrecoveredCost).toBe(
		money.fromNumber(3),
	);
	expect(live.commander.state.cargo.Gold).toBe(Number.MIN_VALUE);
	expect(backend.writeManyCalls.at(-1)!.kinds).toEqual(["live", "lastDocked"]);
});

test("invalid checkpoint or quota refusal leaves both original records exportable", async () => {
	const backend = memorySaveBackend();
	const live = legacy(150),
		checkpoint = legacy(200);
	await backend.write("pilot", "live", live);
	await backend.write("pilot", "lastDocked", checkpoint);
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	backend.failNextWrite();
	await expect(catalog.prepareForBoot("pilot")).rejects.toThrow("migration");
	expect(await backend.read("pilot", "live")).toEqual(live);
	expect(await backend.read("pilot", "lastDocked")).toEqual(checkpoint);
});

test("replacement checkpoint commit recovers a lost acknowledgement from both records", async () => {
	const backend = memorySaveBackend();
	const timers: (() => void)[] = [];
	const schedule: Scheduler = (fn, ms) => {
		if (ms === SAVE_COMMIT_TIMEOUT_MS) timers.push(fn);
		return () => {};
	};
	let current = parseSave(legacy(150));
	const checkpoint = parseSave(legacy(200));
	const store = new SaveStore({
		backend,
		locks: memorySlotLocks(),
		slot: "pilot",
		current: () => current,
		schedule,
	});
	backend.hangNextWriteApplied();
	const pending = store.commit({
		txSeq: 0,
		replacementCheckpoint: checkpoint,
		apply: (e) => e,
		adopt: (e) => {
			current = e;
		},
	});
	await new Promise((r) => setTimeout(r, 0));
	timers[0]();
	expect(await pending).toBe("committed");
	expect(current.commander.txSeq).toBe(1);
	expect(
		parseSave(await backend.read("pilot", "lastDocked")).commander.state
			.credits,
	).toBe(200);
	backend.release();
	await store.settled();
});

test("legacy nonfinite, negative, unknown and excess basis saves refuse without modifying either record", async () => {
	for (const mutate of [
		(b: any) => {
			b.commander.state.credits = Infinity;
		},
		(b: any) => {
			b.commander.state.cargo.Alloys = -1;
		},
		(b: any) => {
			b.commander.state.cargo.Unknown = 1;
		},
		(b: any) => {
			b.commander.ladders.basis.Alloys.units = 2;
		},
	]) {
		const raw = legacy(100) as any;
		mutate(raw);
		const { integrity, ...body } = raw;
		raw.integrity = fnv1a(JSON.stringify(body));
		const before = structuredClone(raw);
		expect(() => parseSave(raw)).toThrow();
		expect(raw).toEqual(before);
	}
	const current = serializeSave(parseSave(legacy(100))) as any;
	for (const encoding of [
		"1@3200",
		"01@0",
		"2@0",
		"-1@0",
		"f".repeat(900) + "@0",
	]) {
		const raw = structuredClone(current);
		raw.commander.state.accounting.bankedTrade = encoding;
		const { integrity, ...body } = raw;
		raw.integrity = fnv1a(JSON.stringify(body));
		const backend = memorySaveBackend();
		await backend.write("pilot", "live", raw);
		const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
		expect(() => catalog.parseRecord(raw)).toThrow();
		expect(await backend.read("pilot", "live")).toEqual(raw);
		expect(await catalog.exportSlot("pilot")).toContain(encoding);
	}
});

test("save round trip never rebuilds recovered debt from remaining physical basis", async () => {
	const { acquire, sell, emptyAccount, withAccount } = await import(
		"../src/commodity-pools"
	);
	const { quoteFromNumber } = await import("../src/exact-amount");
	const initial = acquire(
		emptyAccount(1000),
		"Alloys",
		2,
		money.fromNumber(40),
	);
	const first = sell(initial, "Alloys", 1, quoteFromNumber(50));
	const commander = newCommanderRecord("courier");
	commander.state = withAccount(commander.state, first);
	const saved = parseSave(serializeSave({ world: newWorld(47), commander }));
	expect(saved.commander.state.accounting!.basis.Alloys.cost).toBe(
		money.fromNumber(20),
	);
	expect(saved.commander.state.accounting!.pools.Alloys.unrecoveredCost).toBe(
		money.fromNumber(0),
	);
	const last = sell(
		saved.commander.state.accounting!,
		"Alloys",
		1,
		quoteFromNumber(20),
	);
	expect(last.bankedTrade).toBe(money.fromNumber(30));
});

test("a malformed launch checkpoint refuses migration and exports the untouched pair", async () => {
	const backend = memorySaveBackend();
	const live = legacy(150),
		dock = legacy(200) as any;
	dock.commander.state.cargo.Alloys = -1;
	const { integrity, ...body } = dock;
	dock.integrity = fnv1a(JSON.stringify(body));
	await backend.write("pilot", "live", live);
	await backend.write("pilot", "lastDocked", dock);
	const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	const before = await catalog.exportSlot("pilot");
	await expect(catalog.prepareForBoot("pilot")).rejects.toThrow("nonnegative");
	expect(await catalog.exportSlot("pilot")).toBe(before);
	expect(await backend.read("pilot", "live")).toEqual(live);
	expect(await backend.read("pilot", "lastDocked")).toEqual(dock);
});

test("replacement migration stays uncertain until both records can be read", async () => {
	const backend = memorySaveBackend(),
		timers: (() => void)[] = [];
	const schedule: Scheduler = (fn, ms) => {
		if (ms === SAVE_COMMIT_TIMEOUT_MS) timers.push(fn);
		return () => {};
	};
	let current = parseSave(legacy(150));
	const read = backend.read.bind(backend);
	let refuseCheckpoint = true;
	backend.read = async (slot, kind) => {
		if (kind === "lastDocked" && refuseCheckpoint)
			throw Error("checkpoint read failed");
		return read(slot, kind);
	};
	const store = new SaveStore({
		backend,
		locks: memorySlotLocks(),
		slot: "pilot",
		current: () => current,
		schedule,
	});
	backend.hangNextWriteApplied();
	const pending = store.commit({
		txSeq: 0,
		replacementCheckpoint: parseSave(legacy(200)),
		apply: (e) => e,
		adopt: (e) => {
			current = e;
		},
	});
	await new Promise((r) => setTimeout(r, 0));
	timers[0]();
	expect(await pending).toBe("uncertain");
	expect(current.commander.txSeq).toBe(0);
	expect(store.hasUncertainCommit).toBe(true);
	refuseCheckpoint = false;
	expect(await store.resolveUncertainCommit()).toBe("committed");
	expect(current.commander.txSeq).toBe(1);
	expect(
		parseSave(await backend.read("pilot", "lastDocked")).commander.state
			.credits,
	).toBe(200);
	backend.release();
	await store.settled();
});

test("a refused boot exposes its export slot without needing an attach snapshot", async () => {
	const { planBoot } = await import("../src/commander-flow");
	const backend = memorySaveBackend(),
		catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
	const raw = legacy(100) as any;
	raw.commander.state.cargo.Alloys = -1;
	const { integrity, ...body } = raw;
	raw.integrity = fnv1a(JSON.stringify(body));
	await backend.write("default", "live", raw);
	const before = await catalog.exportSlot("default");
	const plan = await planBoot({
		catalog,
		backend,
		boot: "overlay",
		noSave: false,
		querySeed: null,
		pinnedSystem: null,
	});
	expect(plan.canContinue).toBe(false);
	expect(plan.faultSlot).toBe("default");
	expect(plan.fault).toContain("Export takes a copy");
	expect(await catalog.exportSlot(plan.faultSlot!)).toBe(before);
});

test("schema19 numeric endpoints preserve cash, cargo, bank and aggregate basis in both records", async () => {
	for (const cash of [
		Number.MIN_VALUE,
		Number.MAX_VALUE,
		-Number.MAX_VALUE,
		0.1,
	]) {
		const make = (balance: number) => {
			const raw = legacy(balance) as any;
			raw.commander.state.cargo = {
				Alloys: Number.MIN_VALUE,
				Gold: Number.MAX_VALUE,
			};
			raw.commander.ladders.banked.trade = Number.MAX_VALUE;
			raw.commander.ladders.basis = {
				Alloys: { units: 0, cr: Number.MIN_VALUE },
				Gold: { units: Number.MAX_VALUE, cr: Number.MAX_VALUE },
			};
			const { integrity, ...body } = raw;
			return { ...body, integrity: fnv1a(JSON.stringify(body)) };
		};
		const backend = memorySaveBackend();
		await backend.write("pilot", "live", make(cash));
		await backend.write("pilot", "lastDocked", make(-cash));
		const catalog = new CommanderCatalog({ backend, locks: memorySlotLocks() });
		await catalog.prepareForBoot("pilot");
		for (const kind of ["live", "lastDocked"] as const) {
			const c = parseSave(await backend.read("pilot", kind)).commander;
			expect(c.state.accounting!.cash).toBe(
				signedMoney.fromNumber(kind === "live" ? cash : -cash),
			);
			expect(c.state.accounting!.bankedTrade).toBe(
				money.fromNumber(Number.MAX_VALUE),
			);
			expect(c.state.cargo).toEqual({
				Alloys: Number.MIN_VALUE,
				Gold: Number.MAX_VALUE,
			});
			const sum = Object.values(c.state.accounting!.basis).reduce(
				(n, b) => n + b.cost,
				0n,
			);
			expect(sum).toBe(
				money.fromNumber(Number.MIN_VALUE) + money.fromNumber(Number.MAX_VALUE),
			);
		}
	}
});
