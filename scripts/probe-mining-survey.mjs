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
const CHARTED_FIELD_WORLD = 0x5ee11e;
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
			seed: CHARTED_FIELD_WORLD,
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
		window.__rockRadiusKm = best.radiusKm;
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
			"front and decay are the defaults",
			picked.pick === "front" && picked.interrupt === "decay",
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
		const cut = await page.evaluate(async () => {
			const g = window.__seelite;
			await window.__standOff(1);
			const before = g.surveyState().row?.surface ?? 0;
			const dt = g.units.MAX_DT;
			g.keys.add(" ");
			let rock = null;
			for (let s = 0; s < 40 && g.miningLog.released < 2; s += dt) {
				g.step(dt);
				rock ??= g.miningLog.cutRockId;
			}
			g.keys.delete(" ");
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
			return {
				rock,
				before,
				after: g.surveyState().row?.surface ?? 0,
				log: { ...g.miningLog },
				ore: g.fragmentPlaces().filter((f) => f.ore).length,
				drawn: g.fragmentRender,
				impact: g.impactRender,
				beam: g.miningBeam,
				line: g.miningLineRender,
			};
		});
		check(
			"the Mining Laser cuts the rock in its beam",
			cut.rock === setup.id,
			String(cut.rock),
		);
		check(
			"each released ore tonne leaves the deposit at once",
			cut.log.released >= 1 && cut.after - cut.before === cut.log.released,
			JSON.stringify(cut),
		);
		check(
			"ore fragments drift and the nearest is marked",
			cut.ore === cut.log.released && cut.drawn !== null,
			JSON.stringify(cut.drawn),
		);
		await page.screenshot({ path: "probe-shots/mining-survey/fragments.png" });
		check(
			"the beam ends on the rock with a flare and sparks",
			cut.beam?.hit?.rockId === setup.id &&
				cut.impact !== null &&
				cut.impact.r >= 3 &&
				cut.impact.sparks > 0,
			JSON.stringify(cut.impact),
		);
		const beside = await page.evaluate(async () => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			const p = window.__rockPose();
			const ship = g.world.ship.pos;
			const to = {
				x: p.pos.x - ship.x,
				y: p.pos.y - ship.y,
				z: p.pos.z - ship.z,
			};
			const d = Math.hypot(to.x, to.y, to.z);
			const f = { x: to.x / d, y: to.y / d, z: to.z / d };
			const a =
				Math.abs(f.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
			const cross = (p, q) => ({
				x: p.y * q.z - p.z * q.y,
				y: p.z * q.x - p.x * q.z,
				z: p.x * q.y - p.y * q.x,
			});
			const unit = (v) => {
				const l = Math.hypot(v.x, v.y, v.z);
				return { x: v.x / l, y: v.y / l, z: v.z / l };
			};
			const u = unit(cross(a, f));
			const w = unit(cross(f, u));
			const R = window.__rockRadiusKm;
			const V = g.nearScene.position.constructor;
			const tried = [];
			g.keys.add(" ");
			for (let k = 0; k < 24; k++) {
				const th = (k / 24) * Math.PI * 2;
				const off = 0.97 * R;
				const aim = unit({
					x: to.x + off * (Math.cos(th) * u.x + Math.sin(th) * w.x),
					y: to.y + off * (Math.cos(th) * u.y + Math.sin(th) * w.y),
					z: to.z + off * (Math.cos(th) * u.z + Math.sin(th) * w.z),
				});
				g.orientation.setFromUnitVectors(
					new V(0, 0, -1),
					new V(aim.x, aim.y, aim.z),
				);
				for (let i = 0; i < 3; i++) g.step(dt);
				tried.push(g.miningBeam?.hit?.rockId ?? null);
				if (g.miningBeam && !g.miningBeam.hit) {
					for (let i = 0; i < 2; i++)
						await new Promise((r) => requestAnimationFrame(r));
					const out = { k, R, impact: g.impactRender, beam: g.miningBeam };
					g.keys.delete(" ");
					return out;
				}
			}
			g.keys.delete(" ");
			return { R, tried };
		});
		check(
			"a beam inside the bounding sphere but clear of the surface makes no flare",
			!!beside.beam && beside.beam.hit === null && beside.impact === null,
			JSON.stringify(beside),
		);
		const chase = await page.evaluate(async () => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			await window.__standOff(1);
			g.view = "chase";
			g.keys.add(" ");
			for (let i = 0; i < 3; i++) g.step(dt);
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
			return {
				segments: g.chaseMiningRender,
				hit: g.miningBeam?.hit?.rockId ?? null,
				impact: g.impactRender,
			};
		});
		await page.screenshot({ path: "probe-shots/mining-survey/chase.png" });
		await page.evaluate(() => {
			const g = window.__seelite;
			g.keys.delete(" ");
			g.view = "cockpit";
		});
		check(
			"chase view draws the mining beam to the cut",
			chase.segments > 0 && chase.hit === setup.id && chase.impact !== null,
			JSON.stringify(chase),
		);
		const scoop = await page.evaluate(async () => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			const ore = g.fragmentPlaces().filter((f) => f.ore);
			const visit = async (seen) => {
				const f = g.fragmentPlaces().find((p) => p.id === seen.id);
				await window.__placeShipAt(f.pos, f.vel);
				for (let i = 0; i < 3; i++) g.step(dt);
			};
			const noScoop = { present: !!ore[0] };
			if (ore[0]) {
				const fitted = g.commander;
				const { i1: _scoop, ...bare } = fitted.loadout;
				g.commander = { ...fitted, loadout: bare };
				const hadMined = g.minedT;
				const refusedBefore = g.miningLog.refused;
				await visit(ore[0]);
				for (let i = 0; i < 2; i++)
					await new Promise((r) => requestAnimationFrame(r));
				noScoop.left = g.fragmentPlaces().some((p) => p.id === ore[0].id);
				noScoop.minedDelta = g.minedT - hadMined;
				noScoop.refused = g.miningLog.refused - refusedBefore;
				noScoop.notice = g.miningLineRender?.notice;
				g.commander = fitted;
				await visit(ore[0]);
				noScoop.refitTaken = g.minedT - hadMined;
			}
			const took = { ...g.miningLog, mined: { ...g.minedOre } };
			g.rightTab = "Hold";
			g.step(dt);
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
			const holdRows = [
				...document.querySelectorAll("[data-live-hold-row]"),
			].map((row) => ({
				good: row.getAttribute("data-live-hold-row"),
				amount: row.querySelector("[data-live-hold-amount]")?.textContent,
				ore: /mined ore/.test(row.textContent ?? ""),
			}));
			const hold = g.commander;
			g.minedOre = { "Prototype fill": 10000 };
			if (ore[1]) await visit(ore[1]);
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
			const full = { ...g.miningLog, notice: g.miningLineRender?.notice };
			g.minedOre = {};
			await window.__standOff(5);
			const surface = g.surveyState().row?.surface ?? 0;
			for (let s = 0; s < 125; s += dt) g.step(dt);
			return {
				took,
				holdRows,
				full,
				noScoop,
				hasSecond: !!ore[1],
				lost: g.miningLog.lost,
				surface,
				surfaceAfter: g.surveyState().row?.surface ?? 0,
				hull: hold.hull,
			};
		});
		check(
			"the hold page lists the scooped ore",
			scoop.holdRows.some((r) => r.ore && r.amount === "1 t"),
			JSON.stringify(scoop.holdRows),
		);
		check(
			"a fragment in the scoop window goes into the hold",
			scoop.took.taken === 1 &&
				Object.values(scoop.took.mined).reduce((a, b) => a + b, 0) === 1,
			JSON.stringify(scoop.took),
		);
		check(
			"a full hold leaves the fragment and says so",
			!scoop.hasSecond ||
				(scoop.full.refused > 0 && /HOLD FULL/.test(scoop.full.notice ?? "")),
			JSON.stringify(scoop.full),
		);
		check(
			"with the scoop removed a fragment in the window is refused and the no-scoop notice is painted",
			scoop.noScoop.present &&
				scoop.noScoop.left &&
				scoop.noScoop.minedDelta === 0 &&
				scoop.noScoop.refused > 0 &&
				/NO CARGO SCOOP FITTED/.test(scoop.noScoop.notice ?? ""),
			JSON.stringify(scoop.noScoop),
		);
		check(
			"with the scoop fitted again the same fragment is taken",
			scoop.noScoop.refitTaken === 1,
			JSON.stringify(scoop.noScoop),
		);
		check(
			"an expired fragment is lost and the deposit is not restored",
			scoop.lost >= 1 && scoop.surfaceAfter === scoop.surface,
			JSON.stringify(scoop),
		);
	}
} finally {
	await browser.close();
}
exit();
