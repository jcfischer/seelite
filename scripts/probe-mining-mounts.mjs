import { mkdir } from "node:fs/promises";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop } from "./lib/view-placement.mjs";
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
await mkdir("probe-shots/mining-mounts", { recursive: true });
try {
	for (const mining of [true, false]) {
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
				...(mining ? { mining: "1" } : {}),
				"no-save": "",
				raider: "off",
			}),
		);
		await bootedGame(page, 90000);
		await stopLoop(page);
		const state = await page.evaluate(async () => {
			const g = window.__seelite;
			const { makeModule } = await import("/src/loadout.ts");
			const { fullCondition } = await import("/src/ship-condition.ts");
			const { rockPose } = await import("/src/asteroid-field.ts");
			const { BEAM_VERTICES_PER_STROKE, PLAYER_BEAM_RGB } = await import(
				"/src/beam-glass.ts"
			);
			const { MINING_BEAM, MINING_BEAM_RGB } = await import(
				"/src/mining-beam.ts"
			);
			g.commander = {
				...g.commander,
				loadout: {
					...g.commander.loadout,
					h1: makeModule("pulse-laser", 3),
					h2: makeModule("mining-laser", 3),
					h3: makeModule("mining-laser", 3),
				},
			};
			g.armedFireGroup.reset();
			const field = g.fields[0];
			if (!field) throw Error("charted field missing");
			const rock = field.rocks.reduce((a, b) =>
				a.radiusKm > b.radiusKm ? a : b,
			);
			const pose = rockPose(field.plan, rock, g.world.gameTime);
			await window.__placeShipAt(
				{ x: pose.pos.x, y: pose.pos.y, z: pose.pos.z + rock.radiusKm + 0.25 },
				pose.vel,
			);
			g.orientation.set(0, 0, 0, 1);
			g.headLook = "forward";
			g.condition = fullCondition("miner");
			g.keys.add(" ");
			g.step(0.05);
			g.render(0);
			const sameRgb = (a, b) => a.every((v, i) => v === b[i]);
			const out = {
				group: g.armedFireGroup.current(g.fireGroups)?.label,
				ports: g.gunTracer.firedPorts.length,
				mining: g.cockpitStrokes.filter((s) => sameRgb(s.rgb, MINING_BEAM_RGB))
					.length,
				pulse: g.cockpitStrokes.filter((s) => sameRgb(s.rgb, PLAYER_BEAM_RGB))
					.length,
				vertices: g.beamLayer.vertexCount,
				expected: (2 * MINING_BEAM.segments * 2 + 1) * BEAM_VERTICES_PER_STROKE,
				expectedPlain: 3 * BEAM_VERTICES_PER_STROKE,
				hit: g.miningBeam?.hit?.rockId,
				hits: g.miningBeam?.rays.map((r) => r.hit?.rockId),
				cut: g.miningLog.cutRockId,
				cutOre: g.cut.oreT,
				rays: g.miningRays().map((r) => ({ origin: r.origin, aim: r.aim })),
				muzzles: g.miningMuzzlesWorld().slice(1),
				nose: g.nose(),
				overlay: g.chaseMiningRender,
			};
			g.keys.delete(" ");
			return out;
		});
		check(
			`${mining ? "flagged" : "flagless"}: ALL LASERS fires the mixed fit`,
			state.group === "ALL LASERS",
			JSON.stringify(state),
		);
		if (mining) {
			check(
				"only the Pulse Laser has a glass tracer",
				state.ports === 1 && state.pulse === 1,
				JSON.stringify(state),
			);
			check(
				"two complete mining beams reach the cockpit GPU layer beside the Pulse tracer",
				state.mining === 64 && state.vertices === state.expected,
				JSON.stringify(state),
			);
			check(
				"each mount ray starts at its physical muzzle along the nose",
				JSON.stringify(state.rays.map((r) => r.origin)) ===
					JSON.stringify(state.muzzles) &&
					state.rays.every(
						(r) => JSON.stringify(r.aim) === JSON.stringify(state.nose),
					),
				JSON.stringify(state.rays),
			);
			check(
				"rays meeting the same rock cut at the summed provisional 0.45 t/s",
				state.hits?.length === 2 &&
					state.hits.every((id) => id === state.hit) &&
					state.cut === state.hit &&
					Math.abs(state.cutOre - 0.45 * 0.5 * 0.05) < 1e-10,
				JSON.stringify(state),
			);
			check(
				"cockpit mining beams stay off the overlay",
				state.overlay === 0,
				String(state.overlay),
			);
		} else {
			check(
				"without the flag three combat glass tracers remain and no mining beam draws",
				state.ports === 3 &&
					state.pulse === 3 &&
					state.mining === 0 &&
					state.vertices === state.expectedPlain,
				JSON.stringify(state),
			);
		}
		await page.screenshot({
			path: `probe-shots/mining-mounts/${mining ? "cockpit" : "flagless"}.png`,
		});
		if (mining) {
			const chase = await page.evaluate(() => {
				const g = window.__seelite;
				g.view = "chase";
				g.keys.add(" ");
				g.step(0.05);
				g.render(0);
				g.keys.delete(" ");
				return {
					segments: g.chaseMiningRender,
					pulse: g.beamRender?.length ?? 0,
					vertices: g.beamLayer.vertexCount,
				};
			});
			check(
				"chase draws both mining beams beside the Pulse tracer and disables cockpit quads",
				chase.segments === 32 && chase.pulse === 1 && chase.vertices === 0,
				JSON.stringify(chase),
			);
			await page.screenshot({ path: "probe-shots/mining-mounts/chase.png" });
		}
		await page.close();
	}
} finally {
	await browser.close();
}
exit();
