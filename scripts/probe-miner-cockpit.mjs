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
const readFaces = (page) =>
	page.evaluate(async () => {
		const g = window.__seelite;
		g.minerFacesPaintedAt = -Infinity;
		g.updateCockpit();
		g.render(0);
		return {
			...g.minerFaceReadings,
			feet: g.drill.feet.filter((f) => f.onRock).length,
		};
	});
const installDrillCamReader = (page) =>
	page.evaluate(() => {
		window.__readDrillCam = () => {
			const g = window.__seelite;
			g.render(0);
			const report = g.drillCameraReport();
			const face = g.cabinScene.getObjectByName("miner-drillcam-feed");
			if (!face) return { report, pixels: null };
			face.updateWorldMatrix(true, false);
			g.cabinCamera.updateMatrixWorld(true);
			const V = face.position.constructor;
			const at = face.geometry.getAttribute("position");
			const canvas = g.renderer.domElement;
			const ndc = [];
			let x0 = Infinity;
			let y0 = Infinity;
			let x1 = -Infinity;
			let y1 = -Infinity;
			for (let i = 0; i < at.count; i++) {
				const q = new V()
					.fromBufferAttribute(at, i)
					.applyMatrix4(face.matrixWorld)
					.project(g.cabinCamera);
				if (i < 4)
					ndc.push([+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3)]);
				const x = (q.x * 0.5 + 0.5) * canvas.width;
				const y = (q.y * 0.5 + 0.5) * canvas.height;
				x0 = Math.min(x0, x);
				x1 = Math.max(x1, x);
				y0 = Math.min(y0, y);
				y1 = Math.max(y1, y);
			}
			const inset = 0.12;
			const box = {
				x0: Math.round(x0 + (x1 - x0) * inset),
				y0: Math.round(y0 + (y1 - y0) * inset),
				x1: Math.round(x1 - (x1 - x0) * inset),
				y1: Math.round(y1 - (y1 - y0) * inset),
			};
			const sx = Math.max(0, box.x0);
			const sy = Math.max(0, box.y0);
			const ex = Math.min(canvas.width, box.x1);
			const ey = Math.min(canvas.height, box.y1);
			const w = ex - sx;
			const h = ey - sy;
			if (w < 20 || h < 10)
				return {
					report,
					camera: {
						fov: g.cabinCamera.fov,
						setting: g.settings.value.cockpitFov,
						ndc,
					},
					pixels: { clipped: true, box, canvas: [canvas.width, canvas.height] },
				};
			const buffer = new Uint8Array(w * h * 4);
			const gl = g.renderer.getContext();
			gl.readPixels(sx, sy, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
			let lit = 0;
			let sum = 0;
			let hash = 0;
			for (let i = 0; i < buffer.length; i += 4) {
				const luma = (buffer[i] + buffer[i + 1] + buffer[i + 2]) / 3;
				sum += luma;
				if (luma > 28) lit++;
				hash =
					(Math.imul(hash, 31) +
						buffer[i] * 3 +
						buffer[i + 1] * 5 +
						buffer[i + 2] * 7) |
					0;
			}
			return {
				report,
				camera: {
					fov: g.cabinCamera.fov,
					setting: g.settings.value.cockpitFov,
					ndc,
				},
				pixels: {
					width: w,
					height: h,
					box,
					lit,
					litShare: lit / (w * h),
					mean: sum / (w * h),
					hash,
				},
			};
		};
	});
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-7;

try {
	const page = await open({ hull: "miner", mining: "1" });
	await installDrillCamReader(page);
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
	const stowed = await readFaces(page);
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
	const deployed = await readFaces(page);
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
	const narrow = await page.evaluate(() => window.__readDrillCam());
	check(
		"at the normal field of view the console is below the frame, so the pass does not run",
		narrow.report?.active === false &&
			narrow.report.overlay.line === "FEED OFF" &&
			narrow.pixels !== null,
		JSON.stringify({
			report: narrow.report,
			camera: narrow.camera,
			pixels: narrow.pixels,
		}),
	);
	await page.keyboard.press("7");
	const feedOn = await page.evaluate(() => window.__readDrillCam());
	await page.screenshot({ path: `${shots}/drill-cam.png` });
	check(
		"from the miner's seat with the console in frame, the screen carries a live picture",
		feedOn.report?.active === true &&
			feedOn.report.frames > 0 &&
			feedOn.report.overlay.title === "DRILL CAM" &&
			feedOn.report.overlay.line.startsWith("TCR ") &&
			feedOn.pixels &&
			!feedOn.pixels.clipped &&
			feedOn.pixels.litShare > 0.15 &&
			feedOn.pixels.mean > 20,
		JSON.stringify(feedOn),
	);
	const turned = await page.evaluate(() => {
		window.__seelite.drill.rotorRad = 1.1;
		return window.__readDrillCam();
	});
	check(
		"the picture is of the drill: turning its rotor changes the feed",
		turned.report.active === true &&
			turned.pixels.hash !== feedOn.pixels.hash &&
			turned.pixels.litShare > 0.15,
		JSON.stringify({ on: feedOn.pixels, turned: turned.pixels }),
	);
	const lookedAway = await page.evaluate(() => {
		const g = window.__seelite;
		const back = window.__readDrillCam();
		g.setHeadLook("left");
		window.__readDrillCam();
		const away = window.__readDrillCam();
		g.setHeadLook("forward");
		return { back, away };
	});
	check(
		"looking away from the console stops the pass; the screen it left reads off",
		lookedAway.back.report.active === true &&
			lookedAway.away.report.active === false &&
			lookedAway.away.report.overlay.line === "FEED OFF" &&
			lookedAway.away.report.frames === lookedAway.back.report.frames,
		JSON.stringify({
			back: lookedAway.back.report,
			away: lookedAway.away.report,
		}),
	);
	const qualityOff = await page.evaluate(() => {
		window.__seelite.settings.set("quality", "low");
		window.__readDrillCam();
		const first = window.__readDrillCam();
		const second = window.__readDrillCam();
		return { first, second };
	});
	check(
		"on low quality the feed is excluded, and the screen reads off rather than frozen",
		qualityOff.first.report.active === false &&
			qualityOff.second.report.active === false &&
			qualityOff.first.report.overlay.line === "FEED OFF" &&
			qualityOff.second.report.frames === qualityOff.first.report.frames,
		JSON.stringify({
			first: qualityOff.first.report,
			second: qualityOff.second.report,
		}),
	);
	const switchedOff = await page.evaluate(() => {
		const g = window.__seelite;
		g.settings.set("quality", "high");
		const before = window.__readDrillCam();
		g.drillCameraEnabled = false;
		const off = window.__readDrillCam();
		g.drillCameraEnabled = true;
		return { before, off };
	});
	check(
		"the pass is the measurement's to switch off, and off the screen says so",
		switchedOff.before.report.active === true &&
			switchedOff.off.report.active === false &&
			switchedOff.off.report.overlay.line === "FEED OFF" &&
			switchedOff.off.report.frames === switchedOff.before.report.frames,
		JSON.stringify({
			before: switchedOff.before.report,
			off: switchedOff.off.report,
		}),
	);
	await page.keyboard.press("7");
	await page.keyboard.press("5");
	await page.keyboard.press("4");
	const held = await page.evaluate(async () => {
		const g = window.__seelite;
		for (let t = 0; t < 4.3; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		await new Promise((r) => requestAnimationFrame(r));
		g.render(0);
		return { held: !!g.drill.held, block: g.drill.contact?.block };
	});
	const anchored = await readFaces(page);
	check(
		"anchored on the face, the drill and anchor screens say so",
		held.held &&
			held.block === null &&
			anchored.drill[0][0] === "CONTACT" &&
			anchored.anchor.some(([text]) => text === "ANCHORED") &&
			anchored.stance[0][0] === `${anchored.feet}/4 FEET GRIPPED` &&
			anchored.feet > 0 &&
			stowed.stance[0][0] === "0/4 FEET GRIPPED",
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
		return { out };
	});
	check(
		"every live face has paint on it",
		Object.values(painted.out).every((n) => n > 500),
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
		const courierCamera = g.drillCameraReport();
		g.setFlownHull("miner");
		const miner = { id: g.cabinId, ...memory() };
		const minerCamera = g.drillCameraReport();
		g.setFlownHull("courier");
		const courier2 = { id: g.cabinId, ...memory() };
		return { start, courier1, miner, courier2, courierCamera, minerCamera };
	});
	check(
		"a hull change swaps the cabin and the old cabin's GPU resources come back",
		cycle.start.id === "miner" &&
			cycle.courier1.id === "courier" &&
			cycle.miner.id === "miner" &&
			cycle.courier2.id === "courier" &&
			cycle.courier2.geometries === cycle.courier1.geometries &&
			cycle.courier2.textures === cycle.courier1.textures &&
			cycle.courierCamera === null &&
			cycle.minerCamera?.active === false,
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
	await swap.close();

	const fetched = [];
	const courier = await open(
		{ hull: "courier", "models-full": false },
		(page) =>
			page.on("request", (r) => {
				if (CABIN_GLB.test(r.url())) fetched.push(r.url());
			}),
	);
	await courier.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
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
	await courier.evaluate(() =>
		window.__parkInBerth("station-trade", "overhead-near", {}),
	);
	const beforeLaunch = await courier.evaluate(() => {
		const g = window.__seelite;
		g.hullOnLaunch = "miner";
		return { phase: g.dockPhase, cabin: g.cabinId };
	});
	await courier.evaluate(() => {
		const g = window.__seelite;
		g.launch();
		for (let i = 0; i < 60 * 60 && g.flownHull !== "miner"; i++) {
			g.skipDockTraversal();
			g.step(1 / 60);
		}
	});
	const atLaunch = await courier.evaluate(() => ({
		hull: window.__seelite.flownHull,
		cabin: window.__seelite.cabinId,
	}));
	await courier.waitForFunction(
		() => window.__seelite.cabinId === "miner",
		undefined,
		{ timeout: 120000 },
	);
	const bought = await cabinFacts(courier);
	check(
		"a real launch hands over a bought Longwall: the bridge is fetched then, and installs",
		beforeLaunch.phase === "docked" &&
			beforeLaunch.cabin === "courier" &&
			atLaunch.hull === "miner" &&
			fetched.length === 1 &&
			bought.secondSeat &&
			near(bought.eye, bought.want),
		JSON.stringify({ beforeLaunch, atLaunch, fetched, want: bought.want }),
	);
	await courier.close();

	let releaseBridge;
	const bridgeHeld = new Promise((resolve) => {
		releaseBridge = resolve;
	});
	const late = await open({ hull: "miner", "models-full": false }, (page) =>
		page.route(CABIN_GLB, async (route) => {
			await bridgeHeld;
			await route.continue();
		}),
	);
	const standIn = await cabinFacts(late);
	releaseBridge();
	await late.waitForFunction(
		() => window.__seelite.cabinId === "miner",
		undefined,
		{ timeout: 90000 },
	);
	const installed = await cabinFacts(late);
	check(
		"a player boot flies the courier cabin until the bridge's bytes arrive, then swaps",
		standIn.cabinId === "courier" &&
			standIn.perimeter &&
			standIn.eye.y === 0 &&
			installed.secondSeat &&
			near(installed.eye, installed.want),
		JSON.stringify({ standIn, installed }),
	);
	const offRows = await readFaces(late);
	check(
		"without the flag the shipped bridge's mining faces read MINING OFF",
		["survey", "drill", "anchor", "stance"].every(
			(name) => offRows[name][0][0] === "MINING OFF",
		) && offRows.ore[0][0].startsWith("ORE "),
		JSON.stringify(offRows),
	);
	await late.close();

	let aborted = 0;
	const failed = await open({ hull: "miner", "models-full": false }, (page) =>
		page.route(CABIN_GLB, (route) => {
			aborted += 1;
			return route.abort();
		}),
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
		aborted > 0 &&
			stood.cabinId === "courier" &&
			stood.cabins === 1 &&
			stood.perimeter &&
			!stood.secondSeat &&
			stood.eye.y === 0 &&
			stood.faces.length === 0,
		JSON.stringify({ aborted, stood }),
	);
	await failed.close();
} finally {
	await browser.close();
}
exit();
