import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const { check, watch, exit } = tally();
const browser = await launchChromium();
const SEED = 42;

const legacyBlob = async (page, { full }) =>
	page.evaluate(
		async ({ full }) => {
			const g = window.__seelite;
			const { HULL_SPECS } = await import("/src/hull.ts");
			const { moduleRows, makeModule, moduleFits } = await import(
				"/src/loadout.ts"
			);
			const { fnv1a } = await import("/src/rng.ts");
			const station = g.world.system.contents.stations.find(
				(s) => s.type === "trade",
			);
			const env = g.saveEnvelope();
			const hull = env.commander.state.hull;
			const loadout = {};
			for (const [key, m] of Object.entries(env.commander.state.loadout))
				if (m.module !== "cargo-scoop") loadout[key] = m;
			if (full)
				for (const slot of HULL_SPECS[hull].slots) {
					if (
						slot.kind !== "internal" ||
						slot.accepts === "any" ||
						!slot.accepts.includes("cargo")
					)
						continue;
					const row = moduleRows().find(
						(r) =>
							r.kind === "cargo-rack" &&
							moduleFits(makeModule(r.kind, r.size, r.grade), slot),
					);
					loadout[slot.key] = makeModule(row.kind, row.size, row.grade);
				}
			const record = {
				...env.commander,
				dockedAt: `${g.world.system.record.index}:${station.localCarrierId}`,
				state: { ...env.commander.state, loadout },
			};
			const blob = JSON.parse(
				JSON.stringify(
					g.save.serialize({ world: env.world, commander: record }),
				),
			);
			const { integrity: _, ...body } = blob;
			body.saveSchemaVersion = 16;
			delete body.commander.scoopNotice;
			return {
				loadout,
				blob: { ...body, integrity: fnv1a(JSON.stringify(body)) },
			};
		},
		{ full },
	);

const redockTwice = (page) =>
	page.evaluate(async () => {
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const id = g.dockedAt;
		if (!g.hasDockingComputer)
			g.commander = {
				...g.commander,
				loadout: migrateEquipment(g.commander.hull, [
					...equipmentNames(g.commander.loadout ?? {}),
					g.dockingComputerName,
				]).loadout,
			};
		const phase = () => g.dockingSnapshot(id).dockPhase;
		const shown = () => {
			g.render(0);
			g.updateCockpit();
			return (
				document.querySelector("[data-live-station-message]")?.textContent ??
				null
			);
		};
		const cycle = () => {
			for (let t = 0; t < 200 && phase() !== "flying"; t += dt) {
				if (phase() === "docked") g.launch();
				g.step(dt);
			}
			const out = phase();
			const shownOut = shown();
			g.targetId = id;
			g.requestDockingClearance();
			if (!g.dockingComputer.engaged) g.toggleDockingComputer();
			for (let t = 0; t < 400 && phase() !== "docked"; t += dt) g.step(dt);
			return {
				out,
				shownOut,
				phase: phase(),
				message: shown(),
				field: g.stationConsoleMessage,
				owed: g.scoopNotice,
			};
		};
		const second = cycle();
		g.scoopNotice = true;
		const control = cycle();
		return { second, control };
	});

const arm = async (label, { full, redock = false }) => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 760 },
	});
	try {
		const seedPage = await context.newPage();
		watch(seedPage, `${label} seed`);
		await seedPage.goto(gameUrl(origin, { seed: SEED, "no-save": true }), {
			waitUntil: "load",
		});
		await bootedGame(seedPage, 90000);
		const fixture = await legacyBlob(seedPage, { full });
		await seedPage.evaluate(async ({ blob }) => {
			const { indexedDbSaveBackend, DEFAULT_SLOT } = await import(
				"/src/save-store.ts"
			);
			await indexedDbSaveBackend().write(DEFAULT_SLOT, "live", blob);
		}, fixture);
		await seedPage.close();

		const page = await context.newPage();
		watch(page, label);
		await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
		await bootedGame(page, 90000).catch(async (error) => {
			console.log(
				await page.evaluate(() => document.body.innerText.slice(0, 600)),
			);
			throw error;
		});
		await page
			.waitForFunction(() => window.__seelite.dockPhase === "docked", null, {
				timeout: 20000,
			})
			.catch(() => {});
		const notice = await page.evaluate(async () => {
			const { NO_SCOOP_DOCK_NOTICE } = await import("/src/cargo-notice.ts");
			return NO_SCOOP_DOCK_NOTICE;
		});
		await page
			.waitForFunction(
				(text) =>
					document
						.querySelector("[data-live-station-message]")
						?.textContent?.includes(text),
				notice,
				{ timeout: 3000 },
			)
			.catch(() => {});
		const after = await page.evaluate(() => {
			const g = window.__seelite;
			return {
				fault: g.saveFault,
				phase: g.dockPhase,
				loadout: g.commander.loadout,
				message:
					document.querySelector("[data-live-station-message]")?.textContent ??
					null,
				owed: g.scoopNotice,
			};
		});
		const docks = redock ? await redockTwice(page) : null;
		await page.close();
		return { fixture, after, notice, docks };
	} finally {
		await context.close();
	}
};

try {
	const full = await arm("full", { full: true, redock: true });
	check(
		"a version 16 save with its cargo internals full loads without a fault, docked",
		full.after.fault == null && full.after.phase === "docked",
		JSON.stringify({ fault: full.after.fault, phase: full.after.phase }),
	);
	const byKey = (loadout) =>
		JSON.stringify(
			Object.entries(loadout).sort(([a], [b]) => a.localeCompare(b)),
		);
	check(
		"its loadout is unchanged: no scoop was fitted",
		byKey(full.after.loadout) === byKey(full.fixture.loadout),
		byKey(full.after.loadout),
	);
	check(
		"the station console says the ship has no cargo scoop",
		full.after.message === full.notice,
		JSON.stringify(full.after.message),
	);
	check("and the notice is spent once it is said", full.after.owed === false);
	check(
		"a second dock after the notice was said shows no scoop notice",
		full.docks.second.out === "flying" &&
			!full.docks.second.shownOut &&
			full.docks.second.phase === "docked" &&
			full.docks.second.field !== full.notice &&
			!full.docks.second.message?.includes(full.notice),
		JSON.stringify(full.docks.second),
	);
	check(
		"control: the same dock path shows the notice when one is owed",
		full.docks.control.out === "flying" &&
			!full.docks.control.shownOut &&
			full.docks.control.phase === "docked" &&
			full.docks.control.field === full.notice &&
			full.docks.control.message?.includes(full.notice) === true &&
			full.docks.control.owed === false,
		JSON.stringify(full.docks.control),
	);

	const free = await arm("free", { full: false });
	const scoops = Object.entries(free.after.loadout).filter(
		([, m]) => m.module === "cargo-scoop",
	);
	check(
		"a version 16 save with a free cargo internal loads with one 1E scoop and no flex fitting",
		free.after.fault == null &&
			scoops.length === 1 &&
			scoops[0][1].size === 1 &&
			scoops[0][1].grade === "E" &&
			scoops[0][0] !== "flex",
		JSON.stringify(scoops),
	);
	check(
		"and the console says nothing about a scoop",
		!free.after.message && free.after.owed === false,
		JSON.stringify(free.after.message),
	);
} finally {
	await browser.close();
}
exit();
