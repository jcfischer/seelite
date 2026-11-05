import { installCockpitTextProbe } from "./lib/cockpit-text-probe.mjs";
// A default-layout probe (#381 D11): B cycles and Space fires.
// Drives the bound cycle while holding the trigger; reads the row actually painted.
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop } from "./lib/view-placement.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
for (const width of [900, 390]) {
	const page = await browser.newPage({ viewport: { width, height: 780 } });
	watch(page);
	await page.goto(gameUrl(origin, { seed: 42 }));
	await bootedGame(page);
	await installCockpitTextProbe(page);
	await stopLoop(page);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const { makeModule, stockLoadout } = await import("/src/loadout.ts");
		g.commander = {
			...g.commander,
			hull: "patrol",
			loadout: {
				...stockLoadout("patrol"),
				h2: makeModule("military-laser", 1),
				u1: makeModule("identity-scanner", 1),
			},
		};
		g.setFlownHull("patrol");
		g.armedFireGroup.reset();
		g.floorFit = null;
		g.render(0);
	});
	const first = await page.evaluate(
		() => window.__seelite.cockpit.text.readings.get("lasers")?.[0]?.text,
	);
	check(
		`${width}: all lasers named on its cabin face`,
		first === "ALL LASERS · 1/4",
		JSON.stringify(first),
	);
	await page.keyboard.down(" ");
	const shot = await page.evaluate(async () => {
		const g = window.__seelite;
		const { fullCondition } = await import("/src/ship-condition.ts");
		const { moduleRow } = await import("/src/loadout.ts");
		g.condition = fullCondition("patrol");
		const before = g.condition.energy;
		g.step(0.05);
		g.render(0);
		const rows = [g.commander.loadout.h1, g.commander.loadout.h2].map(
			moduleRow,
		);
		return {
			heat: g.condition.heat,
			energy: before - g.condition.energy,
			expectedHeat: rows.reduce((s, r) => s + r.heatPerS, 0) * 0.05,
			expectedEnergy: rows.reduce((s, r) => s + r.drawPerS, 0) * 0.05,
			ports: g.gunTracer.firedPorts.length,
		};
	});
	check(
		`${width}: all fitted lasers spend their summed rates and draw two ports`,
		Math.abs(shot.heat - shot.expectedHeat) < 1e-9 &&
			Math.abs(shot.energy - shot.expectedEnergy) < 1e-9 &&
			shot.ports === 2,
		JSON.stringify(shot),
	);
	await page.screenshot({ path: `/tmp/seelite-870-all-${width}.png` });
	for (let i = 1; i <= 2; i++) {
		await page.keyboard.press("b");
		const single = await page.evaluate(async (slot) => {
			const g = window.__seelite;
			const { fullCondition } = await import("/src/ship-condition.ts");
			const { moduleRow } = await import("/src/loadout.ts");
			const { tracerPorts } = await import("/src/gun-feedback.ts");
			g.condition = fullCondition("patrol");
			const before = g.condition.energy,
				row = moduleRow(g.commander.loadout[`h${slot}`]);
			g.step(0.05);
			g.render(0);
			return {
				heat: g.condition.heat,
				energy: before - g.condition.energy,
				expectedHeat: row.heatPerS * 0.05,
				expectedEnergy: row.drawPerS * 0.05,
				ports: g.gunTracer.firedPorts,
				expectedPort: tracerPorts(2)[slot - 1],
			};
		}, i);
		check(
			`${width}: H${i} alone uses its own rates and physical port`,
			Math.abs(single.heat - single.expectedHeat) < 1e-9 &&
				Math.abs(single.energy - single.expectedEnergy) < 1e-9 &&
				JSON.stringify(single.ports) === JSON.stringify([single.expectedPort]),
			JSON.stringify(single),
		);
		await page.screenshot({ path: `/tmp/seelite-870-h${i}-${width}.png` });
	}
	await page.keyboard.press("b");
	const scanner = await page.evaluate(() => {
		const g = window.__seelite;
		const before = g.condition.heat;
		g.step(0.05);
		g.render(0);
		return {
			before,
			heat: g.condition.heat,
			label: g.cockpit.text.readings.get("lasers")?.[0]?.text,
		};
	});
	check(
		`${width}: held trigger switches immediately to silent scanner`,
		scanner.heat < scanner.before && scanner.label === "IDENTITY SCANNER · 4/4",
		JSON.stringify(scanner),
	);
	await page.keyboard.up(" ");
	// Measure the longest group together with combat detail at this viewport.
	const fit = await page.evaluate(() => {
		const g = window.__seelite;
		g.cycleFireGroup();
		g.cycleFireGroup();
		g.cycleFireGroup();
		g.duelRowShown = () => true;
		g.render(0);
		return {
			laser: window.__cockpitSourcePainted("lasers"),
			combat: window.__cockpitSourcePainted("combat"),
			label: g.cockpit.text.readings.get("lasers")?.[0]?.text,
		};
	});
	check(
		`${width}: the longest armed-group label and combat values paint their own faces`,
		fit.laser && fit.combat && fit.label.includes("MILITARY LASER"),
		JSON.stringify(fit),
	);
	await page.screenshot({ path: `/tmp/seelite-893-${width}.png` });
	const mining = await page.evaluate(async () => {
		const g = window.__seelite;
		const { makeModule, moduleRow } = await import("/src/loadout.ts");
		const { fullCondition } = await import("/src/ship-condition.ts");
		g.commander = {
			...g.commander,
			loadout: {
				...g.commander.loadout,
				h1: makeModule("mining-laser", 1, "A"),
				h2: makeModule("pulse-laser", 1),
			},
		};
		g.armedFireGroup.reset();
		g.condition = fullCondition("patrol");
		g.keys.add(" ");
		g.step(0.05);
		g.keys.delete(" ");
		g.render(0);
		const rows = [g.commander.loadout.h1, g.commander.loadout.h2].map(
			moduleRow,
		);
		return {
			heat: g.condition.heat,
			expected: rows.reduce((s, r) => s + r.heatPerS, 0) * 0.05,
			ports: g.gunTracer.firedPorts.length,
		};
	});
	check(
		`${width}: Mining fires alongside Pulse on the same trigger`,
		Math.abs(mining.heat - mining.expected) < 1e-9 && mining.ports === 2,
		JSON.stringify(mining),
	);
	await page.close();
}
await browser.close();
exit();
