// A default-layout probe (#381 D11): 5 swaps seats, B cycles, 4 anchors. The Longwall's own cabin by flown hull, https://github.com/jcfischer/seelite/issues/1198
import { mkdir } from "node:fs/promises";
import { gameUrl } from "./lib/game-url.mjs";
import { deployDrill, placeAtRockFace } from "./lib/miner-bridge-fixture.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
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
const shots = "probe-shots/miner-cockpit";
await mkdir(shots, { recursive: true });
const CABIN_GLB = /miner-cockpit[^/]*\.glb/;
const FIXTURE = {
	seed: 0x5ee11e,
	system: 173,
	"no-save": "",
	raider: "off",
};
const open = async (extra, prepare) => {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await prepare?.(page);
	await page.goto(gameUrl(origin, { ...FIXTURE, ...extra }));
	await bootedGame(page, 90000);
	return page;
};
const cabinFacts = (page) =>
	page.evaluate(async () => {
		const { cockpitEyeKm } = await import("/src/cockpit-eye.ts");
		const g = window.__seelite;
		g.view = "cockpit";
		g.orientation.set(0, 0, 0, 1);
		g.render(0);
		const cam = g.cameraPos();
		const ship = g.world.ship.pos;
		const named = (name) => !!g.cabinScene.getObjectByName(name);
		return {
			cabinId: g.cabinId,
			cabins: g.cabinScene.children.filter((c) => c.name === "cockpit").length,
			eye: { x: cam.x - ship.x, y: cam.y - ship.y, z: cam.z - ship.z },
			want: cockpitEyeKm(g.cabinId, g.minerSeat),
			secondSeat: named("seat-shell-back-12"),
			perimeter: named("perimeter-lamp-port-fore"),
			fallbackScreen: named("screen-fallback"),
			faces: g.minerFaces.map((f) => f.name),
			marked: g.markedOcclusion.filter(([n]) => n === "cockpit").length,
		};
	});
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-7;

try {
	const page = await open({ hull: "miner", mining: "1" });
	const bridge = await cabinFacts(page);
	check(
		"the flown miner draws the bridge with the eye where the study puts it",
		bridge.cabinId === "miner" &&
			bridge.cabins === 1 &&
			bridge.secondSeat &&
			!bridge.perimeter &&
			near(bridge.eye, bridge.want) &&
			bridge.want.z < -0.02 &&
			bridge.want.y > 0.006,
		JSON.stringify(bridge),
	);
	check(
		"the study's mining screens have live faces",
		["survey", "ore", "drill", "anchor", "stance", "lasers"].every((n) =>
			bridge.faces.includes(n),
		),
		bridge.faces.join(),
	);
	await page.screenshot({ path: `${shots}/pilot-seat.png` });
	await page.evaluate(() => {
		document.activeElement?.blur?.();
	});
	await page.keyboard.press("5");
	const seated = await cabinFacts(page);
	check(
		"key 5 moves the eye to the miner's seat, 1.2 m to starboard",
		seated.want.x - bridge.want.x > 0.00119 &&
			seated.want.x - bridge.want.x < 0.00121 &&
			near(seated.eye, seated.want),
		JSON.stringify(seated.want),
	);
	await page.screenshot({ path: `${shots}/miner-seat.png` });
	await page.keyboard.press("5");

	const set = await placeAtRockFace(page);
	const readFaces = () =>
		page.evaluate(async () => {
			const g = window.__seelite;
			g.minerFacesPaintedAt = -Infinity;
			g.updateCockpit();
			g.render(0);
			return g.minerFaceReadings;
		});
	const stowed = await readFaces();
	await deployDrill(page, set);
	const out = await page.evaluate(async () => {
		const { cockpitSeenParts } = await import(
			"/src/cockpit-occlusion-table.ts"
		);
		const g = window.__seelite;
		g.render(0);
		const shown = [];
		const hidden = [];
		const exterior = g.shipMesh.getObjectByName("longwall-exterior");
		for (const part of exterior.children[0].children)
			if (/^(feed|anchor-\d|longwall-mount-)/.test(part.name))
				(part.visible ? shown : hidden).push(part.name);
		return {
			extension: g.drill.extension,
			hullVisible: exterior.children[0].children.find((p) => p.name === "hull")
				?.visible,
			shown: shown.sort(),
			hidden,
			want: [...cockpitSeenParts(1, g.cabinId, g.minerSeat)].sort(),
		};
	});
	check(
		"drill out at the rock face, the hull's part is hidden and only the bridge eye's measured row draws",
		out.extension === 1 &&
			out.hullVisible === false &&
			JSON.stringify(out.shown) === JSON.stringify(out.want) &&
			out.hidden.length > 0,
		JSON.stringify(out),
	);
	const deployed = await readFaces();
	check(
		"drill, anchor and stance read the live drill, not a fixture",
		JSON.stringify(deployed.drill) !== JSON.stringify(stowed.drill) ||
			JSON.stringify(deployed.anchor) !== JSON.stringify(stowed.anchor),
		JSON.stringify({ stowed, deployed }),
	);
	await page.screenshot({ path: `${shots}/drill-out-pilot.png` });
	await page.keyboard.press("5");
	await page.evaluate(() => window.__seelite.render(0));
	await page.screenshot({ path: `${shots}/drill-out-miner.png` });
	await page.keyboard.press("5");
	await page.keyboard.press("4");
	const held = await page.evaluate(async () => {
		const g = window.__seelite;
		for (let t = 0; t < 4.3; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		await new Promise((r) => requestAnimationFrame(r));
		g.render(0);
		return { held: !!g.drill.held, block: g.drill.contact?.block };
	});
	const anchored = await readFaces();
	check(
		"anchored on the face, the drill and anchor screens say so",
		held.held &&
			held.block === null &&
			anchored.drill[0][0] === "CONTACT" &&
			anchored.anchor.some(([text]) => text === "ANCHORED") &&
			anchored.stance[0][0].endsWith("/4 FEET GRIPPED"),
		JSON.stringify({ held, anchored }),
	);
	const painted = await page.evaluate(() => {
		const g = window.__seelite;
		const out = {};
		for (const face of g.minerFaces) {
			const { width: w, height: h } = face.ctx.canvas;
			const pixels = face.ctx.getImageData(0, 0, w, h).data;
			let lit = 0;
			for (let i = 0; i < pixels.length; i += 4)
				if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 120) lit++;
			out[face.name] = lit;
		}
		const cam = g.cabinScene.getObjectByName("screen-drillcam");
		return {
			out,
			drillcamUnpowered:
				cam?.material?.color?.getHex() === 0x01090b && !cam.material.map,
		};
	});
	check(
		"every live face has paint on it and the drill camera stays unpowered",
		Object.values(painted.out).every((n) => n > 500) &&
			painted.drillcamUnpowered,
		JSON.stringify(painted),
	);
	await page.screenshot({ path: `${shots}/anchored-pilot.png` });
	await page.close();

	const berth = await open({ hull: "miner", seed: 47, system: undefined });
	await berth.evaluate(() =>
		window.__parkInBerth("station-trade", "overhead-deep", {}),
	);
	await berth.waitForTimeout(1500);
	const docked = await cabinFacts(berth);
	await berth.screenshot({ path: `${shots}/docked-pilot.png` });
	const dockPhase = await berth.evaluate(() => window.__seelite.dock.phase);
	check(
		"docked, the bridge and its eye stay in place",
		dockPhase === "docked" &&
			docked.cabinId === "miner" &&
			near(docked.eye, docked.want),
		JSON.stringify({ dockPhase, docked }),
	);
	await berth.close();

	const swap = await open({ hull: "miner" });
	const cycle = await swap.evaluate(async () => {
		const g = window.__seelite;
		const memory = () => {
			g.render(0);
			const { geometries, textures } = g.renderer.info.memory;
			return { geometries, textures };
		};
		const start = { id: g.cabinId, ...memory() };
		g.setFlownHull("courier");
		const courier1 = { id: g.cabinId, ...memory() };
		g.setFlownHull("miner");
		const miner = { id: g.cabinId, ...memory() };
		g.setFlownHull("courier");
		const courier2 = { id: g.cabinId, ...memory() };
		return { start, courier1, miner, courier2 };
	});
	check(
		"a hull change swaps the cabin and the old cabin's GPU resources come back",
		cycle.start.id === "miner" &&
			cycle.courier1.id === "courier" &&
			cycle.miner.id === "miner" &&
			cycle.courier2.id === "courier" &&
			cycle.courier2.geometries === cycle.courier1.geometries &&
			cycle.courier2.textures === cycle.courier1.textures,
		JSON.stringify(cycle),
	);
	const courierAfter = await cabinFacts(swap);
	check(
		"back in the courier the second seat and the mining faces are gone",
		!courierAfter.secondSeat &&
			courierAfter.perimeter &&
			courierAfter.cabins === 1 &&
			courierAfter.faces.length === 0 &&
			courierAfter.marked === 1 &&
			courierAfter.eye.y === 0,
		JSON.stringify(courierAfter),
	);
	const launch = await swap.evaluate(async () => {
		const g = window.__seelite;
		g.setFlownHull("courier");
		g.hullOnLaunch = "miner";
		const docked = g.cabinId;
		g.setFlownHull(g.hullOnLaunch);
		g.hullOnLaunch = null;
		g.render(0);
		return { docked, launched: g.cabinId };
	});
	check(
		"a hull waiting for the launch shows its cabin when it takes over",
		launch.docked === "courier" && launch.launched === "miner",
		JSON.stringify(launch),
	);
	await swap.close();

	const courier = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(courier);
	const fetched = [];
	courier.on("request", (r) => {
		if (CABIN_GLB.test(r.url())) fetched.push(r.url());
	});
	await installViewPlacement(courier);
	await courier.goto(
		gameUrl(origin, { ...FIXTURE, hull: "courier", "models-full": false }),
	);
	await bootedGame(courier, 90000);
	const plain = await cabinFacts(courier);
	check(
		"a courier pilot neither fetches nor draws the bridge",
		plain.cabinId === "courier" &&
			!plain.secondSeat &&
			plain.perimeter &&
			fetched.length === 0,
		JSON.stringify({ plain, fetched }),
	);
	await courier.keyboard.press("5");
	const noSeat = await courier.evaluate(() => window.__seelite.minerSeat);
	check(
		"key 5 does nothing in the courier's cabin",
		noSeat === "pilot",
		noSeat,
	);
	await courier.close();

	const late = await open({ hull: "miner", "models-full": false });
	await late.waitForFunction(
		() => window.__seelite.cabinId === "miner",
		undefined,
		{ timeout: 90000 },
	);
	check(
		"a player boot starts on the courier cabin and the bridge installs after it",
		(await cabinFacts(late)).secondSeat,
	);
	await late.close();

	const failed = await open({ hull: "miner", "models-full": false }, (page) =>
		page.route(CABIN_GLB, (route) => route.abort()),
	);
	await failed.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 120000,
		},
	);
	await failed.evaluate(() => {
		const g = window.__seelite;
		g.step(g.units.MAX_DT);
		g.render(0);
	});
	const stood = await cabinFacts(failed);
	check(
		"a failed load keeps the whole courier cabin and its eye, with no crash",
		stood.cabinId === "courier" &&
			stood.cabins === 1 &&
			stood.perimeter &&
			!stood.secondSeat &&
			stood.eye.y === 0 &&
			stood.faces.length === 0,
		JSON.stringify(stood),
	);
	await failed.close();
} finally {
	await browser.close();
}
exit();
