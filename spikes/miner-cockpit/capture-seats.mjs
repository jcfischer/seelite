// Review capture for #1143: the two-seat miner cabin (`?cockpit=miner`) in a no-save game near a
// rock, from the pilot seat and from the miner seat (key 5, view.seatSwap), at 60 degrees and at the build FOV. Needs a dev server serving this tree.
// Usage: node spikes/miner-cockpit/capture-seats.mjs [origin] [out-dir]
import { mkdir, writeFile } from "node:fs/promises";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const origin = await guardedOrigin(process.argv[2] ?? "http://127.0.0.1:5317");
const out = process.argv[3] ?? ".dream-loop/game-seats";
await mkdir(out, { recursive: true });
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({
		viewport: { width: 1536, height: 1024 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			hull: "miner",
			mining: "1",
			cockpit: "miner",
			"no-save": "",
			raider: "off",
		}),
	);
	await bootedGame(page, 120000);
	await page.waitForTimeout(2500);
	const facts = await page.evaluate(async () => {
		const A = await import("/src/asteroid-field.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const draw = g.fields[0];
		let best = null;
		for (const r of draw.rocks)
			if (!best || r.radiusKm > best.radiusKm) best = r;
		const p = A.rockPose(draw.plan, best, g.world.gameTime);
		const away = { x: 0.6, y: 0.48, z: 0.64 };
		const km = 0.08;
		await window.__placeShipAt(
			{
				x: p.pos.x + away.x * (best.radiusKm + km),
				y: p.pos.y + away.y * (best.radiusKm + km),
				z: p.pos.z + away.z * (best.radiusKm + km),
			},
			p.vel,
		);
		const V = g.nearScene.position.constructor;
		g.orientation.setFromUnitVectors(
			new V(0, 0, -1),
			new V(-away.x, -away.y, -away.z),
		);
		g.setHeadLook("forward");
		for (let i = 0; i < 4; i++)
			await new Promise((r) => requestAnimationFrame(r));
		return {
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			view: g.view,
			cabin: !!g.cabinScene.getObjectByName("authored-cockpit"),
			seatGroup: !!g.cockpitSeat,
			minerFaces: g.minerFaces.map((f) => f.name),
			fov: g.cabinCamera.fov,
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(facts.renderer))
		throw Error("hardware renderer required");
	const seats = [];
	for (const fov of [60, facts.fov]) {
		await page.evaluate((fov) => {
			const g = window.__seelite;
			for (const c of [
				g.backdropCamera,
				g.farCamera,
				g.approachCamera,
				g.nearCamera,
				g.cabinCamera,
			]) {
				c.fov = fov;
				c.updateProjectionMatrix();
			}
		}, fov);
		await page.waitForTimeout(1200);
		await page.screenshot({ path: `${out}/pilot-seat-fov${fov}.png` });
		await page.keyboard.press("5");
		await page.waitForTimeout(800);
		const miner = await page.evaluate(() => window.__seelite.minerSeat);
		await page.screenshot({ path: `${out}/miner-seat-fov${fov}.png` });
		await page.keyboard.press("5");
		await page.waitForTimeout(400);
		const back = await page.evaluate(() => window.__seelite.minerSeat);
		seats.push({ fov, afterKey5: miner, afterSecondKey5: back });
	}
	const report = { ...facts, seats, errors };
	await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
} finally {
	await browser.close();
}
