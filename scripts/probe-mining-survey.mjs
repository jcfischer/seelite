import { mkdir } from "node:fs/promises";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
/** The asteroid-field probe's world and system: a charted field near the start. */
const WORLD = 0x5ee11e;
const browser = await launchChromium();
const { check, watch, exit } = tally();
await mkdir("probe-shots/mining-survey", { recursive: true });

try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: WORLD,
			system: 173,
			hull: "miner",
			mining: "1",
			"no-save": "",
			raider: "off",
		}),
	);
	await bootedGame(page, 90000);
	const setup = await page.evaluate(async () => {
		const A = await import("/src/asteroid-field.ts");
		const S = await import("/src/rock-survey.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const draw = g.fields[0];
		if (!draw) return { fields: 0 };
		const t = g.world.gameTime;
		const deep = (r) =>
			S.rockContents(
				g.world.system.record.seed,
				draw.plan.slot,
				draw.plan.profile,
				r,
			).deepT > 0;
		let best = null;
		for (const r of draw.rocks)
			if (deep(r) && (!best || r.radiusKm > best.radiusKm)) best = r;
		if (!best) return { fields: g.fields.length, deep: 0 };
		const pose = A.rockPose(draw.plan, best, t);
		window.__rockPose = () => A.rockPose(draw.plan, best, g.world.gameTime);
		window.__standOff = async (km) => {
			const p = window.__rockPose();
			const away = { x: 0.6, y: 0.48, z: 0.64 };
			const at = {
				x: p.pos.x + away.x * (best.radiusKm + km),
				y: p.pos.y + away.y * (best.radiusKm + km),
				z: p.pos.z + away.z * (best.radiusKm + km),
			};
			await window.__placeShipAt(at, p.vel);
			const V = g.nearScene.position.constructor;
			g.orientation.setFromUnitVectors(
				new V(0, 0, -1),
				new V(-away.x, -away.y, -away.z),
			);
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
		};
		await window.__standOff(2);
		return {
			fields: g.fields.length,
			id: `rock:${draw.plan.id}:${best.slot}`,
			rocks: draw.rocks.length,
			radiusKm: best.radiusKm,
			pose: pose.pos,
		};
	});
	check(
		"the start system draws a field",
		setup.fields > 0,
		JSON.stringify(setup),
	);
	if (setup.fields > 0) {
		const picked = await page.evaluate(() => {
			const g = window.__seelite;
			g.cycleTarget(1);
			return g.surveyState();
		});
		check(
			"aim and decay are the defaults",
			picked.pick === "aim" && picked.interrupt === "decay",
			`${picked.pick}/${picked.interrupt}`,
		);
		check(
			"the target key selects the rock in the reticle",
			picked.target?.id === setup.id,
			JSON.stringify(picked.target),
		);
		check(
			"a Mining Laser is fitted for the prototype",
			picked.figures !== null,
			JSON.stringify(picked.figures),
		);
		check(
			"the hold charges at 2 km in view",
			picked.block === null,
			String(picked.block),
		);
		const dwellS = picked.figures?.dwellS ?? 4;
		const done = await page.evaluate(async (dwellS) => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			const half = [];
			for (let s = 0; s < dwellS + 0.5; s += dt) {
				g.step(dt);
				if (half.length === 0 && s > dwellS / 2)
					half.push(g.surveyState().designation);
			}
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
			return { half: half[0], state: g.surveyState() };
		}, dwellS);
		check(
			"the instrument shows progress mid-hold",
			/SURVEYING \d+%/.test(done.half ?? ""),
			done.half,
		);
		check(
			"a completed hold writes surveyedAt",
			typeof done.state.row?.surveyedAt === "number",
			JSON.stringify(done.state.row),
		);
		check(
			"the instrument shows the reading",
			done.state.designation?.startsWith(
				done.state.contents.family.toUpperCase(),
			),
			done.state.designation,
		);
		const glass = await page.evaluate(() => ({
			selected: window.__seelite.selectedRender?.id ?? null,
			deep: window.__seelite.deepCueRender,
		}));
		check(
			"the glass brackets the selected rock",
			glass.selected === done.state.target?.id,
			String(glass.selected),
		);
		check(
			"the reading names a deep deposit",
			/DEEP \d+ T/.test(done.state.designation ?? ""),
			done.state.designation,
		);
		check(
			"the glass marks the deep-deposit mouth",
			glass.deep !== null,
			JSON.stringify(glass.deep),
		);
		await page.screenshot({ path: "probe-shots/mining-survey/reading.png" });
		const far = await page.evaluate(async () => {
			await window.__standOff(30);
			return window.__seelite.surveyState().block;
		});
		check(
			"a rock past survey range refuses the hold",
			/^OUT OF RANGE/.test(far ?? ""),
			String(far),
		);
	}
} finally {
	await browser.close();
}
exit();
