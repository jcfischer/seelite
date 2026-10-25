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
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	for (const path of [
		"cruise exit",
		"launch",
		"flight restore",
		"docked restore",
		"guided fallback",
	]) {
		const page = await browser.newPage();
		watch(page);
		await page.goto(gameUrl(origin, { seed: 47, hull: "miner" }));
		await bootedGame(page);
		const result = await page.evaluate(async (path) => {
			const { stepWorld, flightPerformance, speedDemand } = await import(
				"/src/sim.ts"
			);
			const { shipPrimitives, IDENTITY_AXES } = await import(
				"/src/collision.ts"
			);
			const { buildRockPieces } = await import("/src/rock-pieces.ts");
			const { HULL_SPECS } = await import("/src/hull.ts");
			const { parseSave, serializeSave } = await import(
				"/src/save-envelope.ts"
			);
			const { v3, sub } = await import("/src/vec3.ts");
			let g = window.__seelite;
			const dt = g.units.MAX_DT;
			const unplaced = () => ({ placed: false, rocks: new Set() });
			g.world.rockPlacement = unplaced();
			let reached = false;
			if (path === "cruise exit") {
				g.regime = "cruise";
				g.cruiseSpeedKms = 10;
				g.dropOut("rock placement probe");
				reached = g.regime === "normal";
			} else if (path === "launch") {
				if (!g.startDockedAtHome())
					throw new Error("could not dock for launch");
				g.world.rockPlacement = unplaced();
				g.launch();
				for (let i = 0; i < 12000 && g.dockPhase !== "flying"; i++) {
					if (g.dockPhase === "launching") g.skipDockTraversal();
					g.step(dt);
				}
				reached = g.dockPhase === "flying";
			} else if (path === "flight restore") {
				const save = parseSave(
					JSON.parse(JSON.stringify(serializeSave(g.saveEnvelope()))),
				);
				g = new g.constructor(save.world.seed, save);
				reached = g.dockPhase === "flying";
			} else {
				const station = g.world.system.contents.stations.find(
					(s) => s.type === "trade",
				);
				g.dockingStates.set(station.id, {
					...g.dockingStateOf(station.id),
					hostile: true,
					hostileUntilS: g.world.gameTime + 600,
				});
				reached =
					path === "docked restore"
						? g.restoreDockedAt(g.stationKey(station)) === false
						: g.startDockedAtHome() === false;
				reached &&= g.dockPhase === "flying";
			}
			const armed = g.world.rockPlacement.placed;
			const saved = JSON.stringify(serializeSave(g.saveEnvelope()));
			const origin = sub(g.world.ship.pos, v3(0, 0, 0.32));
			const pose = { ...IDENTITY_AXES, origin };
			const rock = {
				id: "placement-probe-rock",
				motion: {
					kind: "rock",
					pieces: buildRockPieces({
						res: 64,
						r: new Float32Array(6 * 64 * 64).fill(0.8),
					}),
					radiusKm: 0.4,
					start: pose,
					end: pose,
					velStart: v3(),
					velEnd: v3(),
				},
			};
			const run = (world) => {
				const impacts = [];
				for (let i = 0; i < 3; i++) {
					world.ship = { pos: { ...world.ship.pos }, vel: v3(0.1, 0, 0) };
					const out = stepWorld(
						world,
						{
							nose: v3(1, 0, 0),
							up: v3(0, 0, 1),
							rates: { pitch: 0, yaw: 0, roll: 0 },
						},
						{
							stick: { pitch: 0, yaw: 0, roll: 0 },
							turnAssist: false,
							translation: { demand: speedDemand(0), assist: false },
						},
						dt,
						flightPerformance("miner"),
						shipPrimitives(HULL_SPECS.miner, false),
						[],
						[],
						[rock],
					);
					impacts.push(...out.impacts);
				}
				return {
					impacts: impacts.length,
					rockImpacts: impacts.filter((impact) => impact.bodyId === rock.id)
						.length,
					ghosts: [...world.rockPlacement.rocks],
				};
			};
			const controlWorld = structuredClone(g.world);
			controlWorld.rockPlacement = unplaced();
			const control = run(controlWorld);
			const placed = run(g.world);
			const savedActive = JSON.stringify(serializeSave(g.saveEnvelope()));
			return {
				reached,
				armed,
				savedTransient: /rockPlacement|rockGhosts|placement-probe-rock/.test(
					saved + savedActive,
				),
				control,
				placed,
			};
		}, path);
		await page.close();
		console.log(`${path}: ${JSON.stringify(result)}`);
		check(
			`${path} arms whole-rock ghosting at its final pose`,
			result.reached &&
				result.armed &&
				result.placed.impacts === 0 &&
				result.placed.ghosts.includes("placement-probe-rock"),
			JSON.stringify(result),
		);
		check(
			`${path} control without placement meets the next pieces`,
			result.control.rockImpacts > 0,
			JSON.stringify(result),
		);
		check(
			`${path} saves no transient ghost state`,
			!result.savedTransient,
			JSON.stringify(result),
		);
	}
} finally {
	await browser.close();
}
exit();
