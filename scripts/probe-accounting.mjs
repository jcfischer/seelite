import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
import { workbenchUrl } from "./lib/game-url.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const t = tally();
try {
	const page = await browser.newPage();
	t.watch(page, "accounting-storage");
	await page.goto(workbenchUrl(origin, { "galaxy-map": true }), {
		waitUntil: "load",
	});
	const rows = await page.evaluate(async () => {
		const { accountingSaveCases } = await import(
			"/scripts/lib/accounting-save-cases.ts"
		);
		const { serializeSave, parseSave } = await import("/src/save-envelope.ts");
		const { indexedDbSaveBackend, SaveStore, memorySlotLocks } = await import(
			"/src/save-store.ts"
		);
		const { withAccount, accountOf } = await import("/src/commodity-pools.ts");
		const { signedMoney, money } = await import("/src/exact-amount.ts");
		const { fnv1a } = await import("/src/rng.ts");
		const backend = indexedDbSaveBackend(indexedDB, "seelite-accounting-probe");
		const rows = [];
		for (const { name, save } of accountingSaveCases()) {
			const start = performance.now(),
				raw = serializeSave(save),
				serialized = performance.now();
			const text = JSON.stringify(raw),
				stringifyEnd = performance.now();
			const { integrity, ...body } = raw;
			const hashStart = performance.now();
			fnv1a(JSON.stringify(body));
			const hashEnd = performance.now();
			const parseStart = performance.now();
			parseSave(JSON.parse(text));
			const parsed = performance.now();
			let current = save,
				adopted = false,
				backendMs = 0;
			const checkpointAccount = {
				...accountOf(save.commander.state),
				cash: signedMoney.subtract(
					accountOf(save.commander.state).cash,
					money.fromNumber(1),
				),
			};
			const checkpoint = {
				...save,
				commander: {
					...save.commander,
					state: withAccount(save.commander.state, checkpointAccount),
				},
			};
			const original = backend.writeMany;
			backend.writeMany = async (...args) => {
				const begin = performance.now();
				await original.apply(backend, args);
				backendMs = performance.now() - begin;
			};
			const store = new SaveStore({
				backend,
				locks: memorySlotLocks(),
				slot: name,
				current: () => current,
				schedule: (fn, ms) => {
					const timer = setTimeout(fn, ms);
					return () => clearTimeout(timer);
				},
			});
			const outcome = await store.commit({
				txSeq: current.commander.txSeq,
				replacementCheckpoint: checkpoint,
				apply: (e) => e,
				adopt: (e) => {
					current = e;
					adopted = true;
				},
			});
			const live = await backend.read(name, "live"),
				dock = await backend.read(name, "lastDocked");
			const distinct =
				parseSave(live).commander.state.accounting.cash -
					parseSave(dock).commander.state.accounting.cash ===
				money.fromNumber(1);
			backend.writeMany = async () => {
				throw new DOMException("Injected quota refusal", "QuotaExceededError");
			};
			let quotaAdopted = false;
			const quota = await store.commit({
				txSeq: current.commander.txSeq,
				apply: (e) => e,
				adopt: () => {
					quotaAdopted = true;
				},
			});
			backend.writeMany = original;
			const intact =
				JSON.stringify(await backend.read(name, "live")) ===
					JSON.stringify(live) &&
				JSON.stringify(await backend.read(name, "lastDocked")) ===
					JSON.stringify(dock);
			rows.push({
				name,
				envelopeUtf8: new TextEncoder().encode(text).length,
				liveAndCheckpointUtf8:
					new TextEncoder().encode(JSON.stringify(live)).length +
					new TextEncoder().encode(JSON.stringify(dock)).length,
				serializeHashMs: serialized - start,
				stringifyMs: stringifyEnd - serialized,
				hashMs: hashEnd - hashStart,
				parseValidationMs: parsed - parseStart,
				indexedDbAtomicPairMs: backendMs,
				outcome,
				adopted,
				distinct,
				quota,
				quotaAdopted,
				intact,
			});
			await backend.deleteSlot(name);
		}
		return rows;
	});
	for (const row of rows) {
		t.check(
			`${row.name}: complete distinct pair commits through IndexedDB`,
			row.outcome === "committed" && row.adopted && row.distinct,
			JSON.stringify(row),
		);
		t.check(
			`${row.name}: quota refuses adoption and preserves both records`,
			row.quota === "failed" && !row.quotaAdopted && row.intact,
		);
	}
} finally {
	await browser.close();
}
t.exit();
