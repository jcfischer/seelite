/**
 * Headed player-browser CPU measurement for production cruise motion prep.
 *
 *   npm run dev
 *   node scripts/measure-cruise-guard-cost.mjs
 *
 * This times `Game.step`, not rendering, and reports milliseconds per
 * simulation frame. It is neither an FPS claim nor a gate. The page counters
 * prove motion preparation ran once per mass/frame inside the measured path.
 */
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const BLOCKS = 12;
const FRAMES_PER_BLOCK = 20;
const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/cruise.ts",
	"src/sim.ts",
]);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${origin}/?seed=42`);
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "cruise guard cost");

const report = await page.evaluate(
	([blocks, framesPerBlock]) => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const distance = (body) =>
			Math.hypot(
				body.pos.x - g.world.ship.pos.x,
				body.pos.y - g.world.ship.pos.y,
				body.pos.z - g.world.ship.pos.z,
			);
		const station = [...g.world.system.bodies]
			.filter((body) => body.kind === "station")
			.sort((a, b) => distance(b) - distance(a))[0];
		if (!station) throw new Error("seed 42 has no station");
		g.targetId = station.id;
		g.faceTarget();
		g.engageCruise();
		for (let i = 0; i < 100 && g.regime !== "cruise"; i++) {
			g.setThrottle(1);
			g.faceTarget();
			g.step(dt);
		}
		if (g.regime !== "cruise") throw new Error("cruise did not engage");

		const productionMasses = g.masses.bind(g);
		let preparedFrames = 0;
		let preparedBodies = 0;
		g.masses = () => {
			const masses = productionMasses();
			preparedFrames++;
			preparedBodies += masses.length;
			return masses;
		};
		const samples = [];
		for (let block = 0; block < blocks; block++) {
			const started = performance.now();
			for (let frame = 0; frame < framesPerBlock; frame++) {
				g.setThrottle(1);
				g.faceTarget();
				g.step(dt);
				if (g.regime !== "cruise")
					throw new Error(`cruise ended during measured block ${block}`);
			}
			samples.push((performance.now() - started) / framesPerBlock);
		}
		const sorted = [...samples].sort((a, b) => a - b);
		const massCount = g.world.system.bodies.filter(
			(body) => body.kind === "star" || body.kind === "planet",
		).length;
		return {
			fixture: `seed 42 to ${station.id}`,
			frames: blocks * framesPerBlock,
			blocks,
			framesPerBlock,
			dt,
			massCount,
			preparedFrames,
			preparedBodies,
			medianStepMs: sorted[Math.floor(sorted.length / 2)],
			p95StepMs: sorted[Math.floor(sorted.length * 0.95)],
			maxStepMs: sorted.at(-1),
		};
	},
	[BLOCKS, FRAMES_PER_BLOCK],
);

await browser.close();
if (report.preparedFrames !== report.frames)
	throw new Error(
		`motion preparation ran ${report.preparedFrames} times for ${report.frames} frames`,
	);
if (report.preparedBodies !== report.frames * report.massCount)
	throw new Error(
		`prepared ${report.preparedBodies} bodies, expected ${report.frames * report.massCount}`,
	);
console.log(
	JSON.stringify({
		...report,
		renderer,
		measurement: "headed browser Game.step CPU; excludes render; not FPS",
	}),
);
