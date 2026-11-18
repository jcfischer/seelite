// A default-layout probe (#381 D11): B cycles, 4 anchors and Space fires. https://github.com/jcfischer/seelite/issues/381
import { mkdir } from "node:fs/promises";
import { gameUrl } from "./lib/game-url.mjs";
import { deployDrill, placeAtRockFace } from "./lib/miner-bridge-fixture.mjs";
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
	await probeSparkOcclusion(browser, origin, check, watch);
	await probeFineMonitor(browser, origin, check, watch);
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
		for (let t = 0; t < 1; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
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
	await page.keyboard.down("Space");
	const skips = await page.evaluate(async () => {
		const g = window.__seelite;
		const ref = g.rockRef(window.__drillRock);
		window.__skipFixture = {
			commander: g.commander,
			delivered: g.drill.delivered,
			row: g.rockDepositRow(ref),
		};
		const { withAccount, emptyAccount, acquire, accountOf } = await import(
			"/src/commodity-pools.ts"
		);
		const { holdSummary } = await import("/src/hold.ts");
		const { oreCargoName } = await import("/src/ore-goods.ts");
		g.commander = withAccount(g.commander, emptyAccount(g.commander.credits));
		const emptyMass = g.flownShipMassT;
		const contents = g.rockContentsOf(ref);
		g.commander = withAccount(
			g.commander,
			acquire(
				accountOf(g.commander),
				oreCargoName(contents.family, contents.grade),
				2999,
			),
		);
		g.drill.cut = { key: null, progressT: 0 };
		g.putDepositRow(ref, { surface: 0, deep: 0, at: g.world.gameTime });
		g.condition = { ...g.condition, energy: g.condition.energyMax, heat: 0 };
		for (let t = 0; t < 1; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		const after = g.rockDepositRow(ref)?.deep ?? 0;
		const full = g.drillExtract(
			g.rockRef(window.__drillRock),
			g.drill.contact,
			1,
		);
		g.view = "cockpit";
		g.setHeadLook("right");
		g.rightTab = "Hold";
		g.updateCockpit();
		for (let i = 0; i < 2; i++)
			await new Promise((r) => requestAnimationFrame(r));
		const result = {
			full,
			gained: g.minedT - 2999,
			debit: after,
			mass: g.flownShipMassT - emptyMass,
			ore: document.querySelector("[data-live-ore-capacity]")?.textContent,
			general: holdSummary(
				{ ...g.commander, cargo: { ...g.commander.cargo, Food: 40 } },
				g.requests,
				true,
			).freeT,
		};
		return result;
	});
	await page.keyboard.up("Space");
	check(
		"dedicated skips stop at 3000 t, conserve reserve and add flown mass",
		skips.gained === 1 &&
			skips.debit === 1 &&
			skips.full.tonnes === 0 &&
			skips.mass === 3000 &&
			skips.general === 0,
		JSON.stringify(skips),
	);
	check(
		"the Hold page paints raw-ore capacity separately",
		skips.ore?.includes("RAW ORE 3000 / 3000 t"),
		JSON.stringify(skips),
	);
	await page.screenshot({ path: "probe-shots/mining-drill/ore-skips.png" });
	await page.evaluate(() => {
		const g = window.__seelite;
		g.commander = window.__skipFixture.commander;
		g.drill.delivered = window.__skipFixture.delivered;
		g.putDepositRow(g.rockRef(window.__drillRock), window.__skipFixture.row);
		g.setHeadLook("forward");
	});
	const switches = await page.evaluate(async () => {
		const g = window.__seelite;
		const rows = [];
		const frames = () =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		for (let run = 0; run < 5; run++) {
			g.view = "chase";
			await frames();
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
	const armed = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		return {
			groups: g.fireGroups.map((group) => group.kind),
			solid: g.flownSolid.length,
			extension: g.drill.extension,
		};
	});
	check(
		"a stowed drill adds no solid, and the fire groups carry it",
		armed.groups.includes("drill") &&
			armed.solid === 1 &&
			armed.extension === 0,
		JSON.stringify(armed),
	);
} finally {
	await browser.close();
}
exit();

async function probeSparkOcclusion(browser, origin, check, watch) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, { seed: 2, hull: "miner", "no-save": "", raider: "off" }),
	);
	await bootedGame(page, 90000);
	const groups = await placeAtRockFace(page);
	await deployDrill(page, groups);
	await page.keyboard.press("4");
	await page.evaluate(() => {
		const g = window.__seelite;
		for (let t = 0; t < 4.3; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
	});
	await page.keyboard.down("Space");
	await page.evaluate(() => {
		const g = window.__seelite;
		for (let t = 0; t < 1; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		g.render(0);
	});
	await page.keyboard.up("Space");
	const result = await page.evaluate(async () => {
		const THREE = await import("/node_modules/three/build/three.module.js");
		const { cockpitHullRays } = await import("/src/cockpit-hull-rays.ts");
		const g = window.__seelite;
		const live = [...g.sparks];
		const rock = g.rockRef(g.drill.held.rockId);
		const canvas = g.overlay;
		const ctx = g.overlayCtx;
		const hull = [];
		g.shipMesh
			.getObjectByName("longwall-exterior")
			.getObjectByName("hull")
			.traverse((o) => {
				if (o.isMesh && !/glazing|display/.test(o.name)) hull.push(o);
			});
		const rows = [];
		let clearControl = [];
		for (const seat of ["pilot", "miner"]) {
			g.setMinerSeat(seat);
			g.view = "cockpit";
			g.render(0);
			g.shipMesh.updateWorldMatrix(true, true);
			const hit = cockpitHullRays(hull);
			const caster = new THREE.Raycaster();
			const blocked = (x, y) => {
				caster.setFromCamera(
					new THREE.Vector2(
						(x / canvas.width) * 2 - 1,
						1 - (y / canvas.height) * 2,
					),
					g.nearCamera,
				);
				return hit(caster.ray, 0.2) !== null;
			};
			const paint = (sparks, view) => {
				g.view = view;
				const heat = g.heatSpots;
				const beam = g.miningBeam;
				g.heatSpots = new Map();
				g.miningBeam = null;
				g.sparks = [];
				g.render(0);
				const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				g.sparks = sparks;
				g.render(0);
				g.heatSpots = heat;
				g.miningBeam = beam;
				let pixels = 0;
				let onHull = 0;
				const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				for (let i = 0; i < data.length; i += 4) {
					if (
						Math.abs(data[i] - before[i]) +
							Math.abs(data[i + 1] - before[i + 1]) +
							Math.abs(data[i + 2] - before[i + 2]) <
						24
					)
						continue;
					pixels++;
					const n = i / 4;
					if (
						blocked(
							(n % canvas.width) + 0.5,
							Math.floor(n / canvas.width) + 0.5,
						)
					)
						onHull++;
				}
				return { pixels, onHull };
			};
			const actual = paint(live, "cockpit");
			const samples = { hidden: [], clear: [] };
			const cam = g.cameraPos();
			for (let y = 80; y < canvas.height - 80; y += 40)
				for (let x = 80; x < canvas.width - 80; x += 40) {
					const isBlocked = blocked(x, y);
					const bucket = isBlocked ? samples.hidden : samples.clear;
					if (
						bucket.length >= 3 ||
						![-4, 0, 4].every((dx) =>
							[-4, 0, 4].every((dy) => blocked(x + dx, y + dy) === isBlocked),
						)
					)
						continue;
					blocked(x, y);
					const p = caster.ray.direction.clone().multiplyScalar(0.1);
					bucket.push({
						rockId: rock.id,
						offset: {
							x: cam.x + p.x - rock.pos.x,
							y: cam.y + p.y - rock.pos.y,
							z: cam.z + p.z - rock.pos.z,
						},
						vel: { x: 0, y: 0, z: 0 },
						bornAt: g.world.gameTime - 0.1,
					});
				}
			const hidden = paint(samples.hidden, "cockpit");
			const clear = paint(samples.clear, "cockpit");
			const chase = paint(samples.hidden, "chase");
			clearControl = samples.clear;
			rows.push({
				seat,
				actual,
				hidden,
				clear,
				chase,
				samples: [samples.hidden.length, samples.clear.length],
			});
		}
		g.view = "cockpit";
		g.sparks = [...live, ...clearControl];
		g.render(0);
		return { anchored: !!g.drill.held, live: live.length, rows };
	});
	check(
		"anchored seed 2 drill sparks leave no pixels on the hull silhouette from either seat",
		result.anchored &&
			result.live > 0 &&
			result.rows.every(
				(r) =>
					r.actual.onHull === 0 && r.hidden.pixels === 0 && r.samples[0] === 3,
			),
		JSON.stringify(result),
	);
	check(
		"clear canopy sparks remain painted and chase sparks retain their strokes",
		result.rows.every(
			(r) =>
				r.clear.pixels > 0 &&
				r.clear.onHull === 0 &&
				r.chase.pixels > 0 &&
				r.samples[1] === 3,
		),
		JSON.stringify(result),
	);
	await page.screenshot({
		path: "probe-shots/mining-drill/cockpit-sparks.png",
	});
	await page.close();
}

async function probeFineMonitor(browser, origin, check, watch) {
	const monitor = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(monitor);
	await installViewPlacement(monitor);
	await monitor.goto(
		gameUrl(origin, { seed: 2, hull: "miner", "no-save": "", raider: "off" }),
	);
	await bootedGame(monitor, 90000);
	const monitorGroups = await placeAtRockFace(monitor);
	await deployDrill(monitor, monitorGroups);
	await monitor.keyboard.press("5");
	const fineMonitor = await monitor.evaluate(async () => {
		const { Vector3 } = await import(
			"/node_modules/three/build/three.module.js"
		);
		const { fineFigures } = await import("/src/miner-faces.ts");
		const g = window.__seelite;
		const face = g.minerFaces.find((f) => f.name === "drill");
		if (!face || !g.drill.fine)
			throw new Error("fine mode and drill monitor required");
		const ctx = face.ctx;
		const fillText = ctx.fillText;
		const hud = g.overlayCtx;
		const hudFillText = hud.fillText;
		const labels = /^(RANGE|CLOSE|SLIDE) /;
		const { width, height } = ctx.canvas;
		const pixels = () => ctx.getImageData(0, 0, width, height).data;
		const capture = (omit = "") => {
			const draws = [];
			const glass = [];
			ctx.fillText = function (text, ...args) {
				if (String(text).startsWith(omit) && omit) return;
				draws.push({ text: String(text), y: args[1], font: this.font });
				return fillText.call(this, text, ...args);
			};
			hud.fillText = function (text, ...args) {
				glass.push(String(text));
				return hudFillText.call(this, text, ...args);
			};
			try {
				face.key = "";
				g.updateCockpit();
				g.render(0);
			} finally {
				ctx.fillText = fillText;
				hud.fillText = hudFillText;
			}
			return { draws, glass, pixels: pixels() };
		};
		function changedPixels(a, b, threshold) {
			let changed = 0;
			for (let i = 0; i < a.length; i += 4)
				if (
					Math.abs(a[i] - b[i]) +
						Math.abs(a[i + 1] - b[i + 1]) +
						Math.abs(a[i + 2] - b[i + 2]) >
					threshold
				)
					changed++;
			return changed;
		}
		const first = capture();
		const ink = ["RANGE", "CLOSE", "SLIDE"].map((label) => {
			const control = capture(label);
			const changed = changedPixels(first.pixels, control.pixels, 24);
			return { label, changed };
		});
		g.throttle = 0.1;
		g.step(g.units.MAX_DT);
		g.updateCockpit();
		g.render(0);
		const previous = face.key;
		const version = face.texture.version;
		g.throttle = 0.2;
		g.step(g.units.MAX_DT);
		g.minerFacesPaintedAt = performance.now();
		g.updateCockpit();
		g.render(0);
		const live = {
			changed: previous !== face.key,
			painted: face.texture.version > version,
			figures: fineFigures(g.drill.fine),
			rows: g.minerFaceReadings.drill.map(([text]) => text),
		};
		g.view = "chase";
		const chase = capture().glass;
		g.view = "cockpit";
		const fine = g.drill.fine;
		g.drill.fine = null;
		const off = capture();
		g.drill.fine = fine;
		capture();
		const mesh = g.cabinScene.getObjectByName("miner-drill-face");
		const positions = mesh.geometry.getAttribute("position");
		const visible = Array.from({ length: positions.count }, (_, i) =>
			new Vector3()
				.fromBufferAttribute(positions, i)
				.applyMatrix4(mesh.matrixWorld)
				.project(g.cabinCamera),
		).every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1);
		return {
			visible,
			ink,
			live,
			chase,
			rows: first.draws,
			glass: first.glass,
			off: off.draws.map((d) => d.text),
			fits: first.draws
				.filter((d) => labels.test(d.text))
				.every((d) => d.y > 80 && d.y < height - 20),
		};
	});
	check(
		"fine range, close and slide are painted on the cabin monitor",
		fineMonitor.ink.every((r) => r.changed > 100) &&
			fineMonitor.visible &&
			fineMonitor.fits &&
			fineMonitor.rows.some((r) => r.text.startsWith("RANGE")),
		JSON.stringify(fineMonitor),
	);
	check(
		"fine figures update on the next rendered frame inside the normal monitor interval",
		fineMonitor.live.changed &&
			fineMonitor.live.painted &&
			fineMonitor.live.rows.includes(
				`RANGE ${fineMonitor.live.figures.range} M`,
			) &&
			fineMonitor.live.rows.includes(
				`CLOSE ${fineMonitor.live.figures.close} M/S`,
			) &&
			fineMonitor.live.rows.includes(
				`SLIDE ${fineMonitor.live.figures.slide} M/S`,
			),
		JSON.stringify(fineMonitor.live),
	);
	check(
		"fine figures leave the cockpit HUD and remain on chase HUD",
		fineMonitor.glass.length > 0 &&
			!fineMonitor.glass.some((s) => /FINE|RANGE|CLOSE|SLIDE/.test(s)) &&
			fineMonitor.chase.some(
				(s) =>
					s.includes("FINE") &&
					s.includes("RANGE") &&
					s.includes("CLOSE") &&
					s.includes("SLIDE"),
			),
		JSON.stringify({ cockpit: fineMonitor.glass, chase: fineMonitor.chase }),
	);
	check(
		"fine off restores contact and gap without fine figures on the monitor",
		fineMonitor.off.some((s) => s.startsWith("GAP")) &&
			fineMonitor.off.length === 3 &&
			!fineMonitor.off.some((s) => /RANGE|CLOSE|SLIDE/.test(s)),
		JSON.stringify(fineMonitor.off),
	);
	await monitor.screenshot({
		path: "probe-shots/mining-drill/fine-monitor-cockpit.png",
	});
	await monitor.close();
}
