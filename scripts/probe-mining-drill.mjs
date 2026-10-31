// A default-layout probe (#381 D11): B cycles, 4 anchors and Space fires. https://github.com/jcfischer/seelite/issues/381
import { mkdir } from "node:fs/promises";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
await mkdir("probe-shots/mining-drill", { recursive: true });
try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			hull: "miner",
			mining: "1",
			"no-save": "",
			raider: "off",
		}),
	);
	await bootedGame(page, 90000);
	const setup = await page.evaluate(async () => {
		const { rockPose } = await import("/src/asteroid-field.ts");
		const { rockDirectionNow } = await import("/src/rock-target.ts");
		const { HULL_SPECS } = await import("/src/hull.ts");
		const { beamHit } = await import("/src/rock-extraction.ts");
		const { DRILL, ANCHOR, seatPose } = await import("/src/rock-drill.ts");
		const { add, scale } = await import("/src/vec3.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const draw = g.fields[0];
		const rock = draw?.rocks.find(
			(r) =>
				g.rockContentsOf({ plan: draw.plan, rock: r }).deepT > 0 &&
				r.radiusKm > ANCHOR.gripRadiusKm,
		);
		if (!rock) throw new Error("the fixture needs a large deep-deposit rock");
		const id = `rock:${draw.plan.id}:${rock.slot}`;
		const ref = {
			id,
			plan: draw.plan,
			rock,
			...rockPose(draw.plan, rock, g.world.gameTime),
			distKm: 0,
		};
		const cutter = HULL_SPECS.miner.cutter;
		const mouth = rockDirectionNow(
			ref,
			g.rockContentsOf(ref).deepDir,
			g.world.gameTime,
		);
		const start = add(ref.pos, scale(mouth, rock.radiusKm * 2));
		const hit = beamHit(
			start,
			scale(mouth, -1),
			g.rockTargets([ref]),
			rock.radiusKm * 3,
		);
		if (!hit || !cutter) throw new Error("no mouth hit or cutter");
		const seat = seatPose(hit.point, hit.normal, { x: 0, y: 1, z: 0 }, cutter);
		const pos = add(seat.pos, scale(hit.normal, ANCHOR.reachKm * 0.5));
		await window.__placeShipAt(
			pos,
			rockPose(draw.plan, rock, g.world.gameTime).vel,
		);
		g.setAttitude(seat.nose, seat.up);
		g.throttle = 0;
		g.view = "chase";
		g.targetId = null;
		window.__drillRock = id;
		window.__drillFigures = DRILL;
		window.__drillBefore = {
			hold: g.minedT,
			deep: g.rockDepositRow(ref)?.deep ?? 0,
		};
		return {
			id,
			groups: g.fireGroups.map((group) => group.label),
			surveyed: g.rockDepositRow(ref)?.surveyedAt ?? null,
		};
	});
	check(
		"a cutter hull has its own drill group without requiring a survey",
		setup.groups.includes("BUILT-IN DRILL") && setup.surveyed === null,
		JSON.stringify(setup),
	);
	for (let i = 0; i < setup.groups.length - 1; i++)
		await page.keyboard.press("b");
	const deployed = await page.evaluate(() => {
		const g = window.__seelite;
		for (
			let t = 0;
			t < window.__drillFigures.deployS + 0.2;
			t += g.units.MAX_DT
		)
			g.step(g.units.MAX_DT);
		return {
			extension: g.drill.extension,
			why: g.drill.anchorWhy,
			fine: g.drill.fine,
			solid: g.flownSolid.length,
			group: g.armedFireGroup.current(g.fireGroups)?.label,
		};
	});
	check(
		"arming deploys in six seconds and adds the cutter solid",
		deployed.extension === 1 &&
			deployed.solid === 2 &&
			deployed.group === "BUILT-IN DRILL",
		JSON.stringify(deployed),
	);
	check(
		"fine control reads range, close and slide beside the surface",
		deployed.fine !== null && deployed.fine.rangeKm !== null,
		JSON.stringify(deployed.fine),
	);
	await page.keyboard.press("4");
	const anchored = await page.evaluate(async () => {
		const g = window.__seelite;
		for (let t = 0; t < 4.3; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		for (let i = 0; i < 2; i++)
			await new Promise((r) => requestAnimationFrame(r));
		return {
			held: g.drill.held?.rockId,
			contact: g.drill.contact,
			line: g.drillLine(),
			delivered: g.drill.delivered,
		};
	});
	check(
		"key 4 seats on the real mouth and shows the release cue",
		anchored.held === setup.id &&
			anchored.contact?.block === null &&
			anchored.contact?.deposit === "deep" &&
			anchored.line.readout.includes("ANCHORED · PRESS 4 TO RELEASE"),
		JSON.stringify(anchored),
	);
	await page.keyboard.down("Space");
	const cut = await page.evaluate(async () => {
		const g = window.__seelite;
		for (let t = 0; t < 12; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		for (let i = 0; i < 2; i++)
			await new Promise((r) => requestAnimationFrame(r));
		const ref = g.rockRef(window.__drillRock);
		return {
			before: window.__drillBefore,
			hold: g.minedT,
			deep: g.rockDepositRow(ref)?.deep ?? 0,
			delivered: g.drill.delivered,
			line: g.drillLineRender,
			heat: g.condition.heat,
			spin: g.drill.spin,
			sparks: g.sparks.length,
		};
	});
	await page.keyboard.up("Space");
	check(
		"the hold gains exactly the deep tonnes the deposit loses",
		cut.hold > cut.before.hold &&
			cut.hold - cut.before.hold === cut.deep - cut.before.deep &&
			cut.delivered === cut.hold - cut.before.hold,
		JSON.stringify(cut),
	);
	check(
		"the powered drill spins, heats and paints its cutting feedback",
		cut.spin > 0 &&
			cut.heat > 0 &&
			cut.sparks > 0 &&
			cut.line?.line.includes("DRILL CONTACT DEEP"),
		JSON.stringify(cut),
	);
	await page.screenshot({ path: "probe-shots/mining-drill/cutting.png" });
	const switches = await page.evaluate(async () => {
		const g = window.__seelite;
		const rows = [];
		const frames = () =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		for (let run = 0; run < 5; run++) {
			g.view = "chase";
			await frames();
			delete g.shipMesh.userData.cockpitOcclusion;
			const tasks = [];
			const observer = new PerformanceObserver((list) =>
				tasks.push(...list.getEntries().map((e) => e.duration)),
			);
			observer.observe({ type: "longtask" });
			const start = performance.now();
			g.view = "cockpit";
			await frames();
			await new Promise((r) => setTimeout(r, 80));
			tasks.push(...observer.takeRecords().map((e) => e.duration));
			observer.disconnect();
			rows.push({
				ms: performance.now() - start,
				tasks,
				visible: g.shipMesh.visible,
				plumes: g.ventPlumes.object.visible,
				view: g.view,
				line: g.drillLineRender?.line,
			});
		}
		return rows;
	});
	check(
		"five real cockpit drill switches produce no long task and hide plumes",
		switches.every(
			(row) =>
				row.tasks.length === 0 &&
				row.visible &&
				!row.plumes &&
				row.view === "cockpit" &&
				row.line?.includes("DRILL CONTACT"),
		),
		JSON.stringify(switches),
	);
	await page.screenshot({ path: "probe-shots/mining-drill/cockpit.png" });
	await page.keyboard.press("4");
	await page.keyboard.press("b");
	const released = await page.evaluate(() => {
		const g = window.__seelite;
		for (
			let t = 0;
			t < window.__drillFigures.deployS + 0.2;
			t += g.units.MAX_DT
		)
			g.step(g.units.MAX_DT);
		return {
			held: g.drill.held,
			extension: g.drill.extension,
			solid: g.flownSolid.length,
			delivered: g.drill.delivered,
		};
	});
	check(
		"release and disarm retract the cutter and stop output",
		released.held === null &&
			released.extension === 0 &&
			released.solid === 1 &&
			released.delivered === cut.delivered,
		JSON.stringify(released),
	);
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			hull: "miner",
			"no-save": "",
			raider: "off",
		}),
	);
	await bootedGame(page, 90000);
	const flagless = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		return {
			groups: g.fireGroups.map((group) => group.kind),
			solid: g.flownSolid.length,
			extension: g.drill.extension,
			view: g.view,
			visible: g.shipMesh.visible,
		};
	});
	check(
		"without the flag the miner has no drill group or extra solid or cockpit hull",
		!flagless.groups.includes("drill") &&
			flagless.solid === 1 &&
			flagless.extension === 0 &&
			flagless.view === "cockpit" &&
			!flagless.visible,
		JSON.stringify(flagless),
	);
} finally {
	await browser.close();
}
exit();
