/** Gated corpus probe through the real Game steering loop. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { cpus } from "node:os";
import { cruiseDetourCorpus } from "./lib/cruise-detour-corpus.mjs";
import { loadSampler } from "./lib/probe-load.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const started = performance.now();
const timings = [];
const args = process.argv.slice(2);
const suppliedOrigin = /^https?:/.test(args[0] ?? "")
	? args.shift()
	: undefined;
const ORIGIN =
	process.env.PROBE_ORIGIN ?? suppliedOrigin ?? "http://localhost:5173";
const corpus = cruiseDetourCorpus(args);
const load = loadSampler();
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const rows = [];
const nonEngagingSeeds = [];
for (const seed of corpus.seeds) {
	const seedStart = performance.now();
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await page.goto(gameUrl(origin, { seed, raider: "off" }));
	await bootedGame(page);
	const bootMs = performance.now() - seedStart;
	const evaluateStart = performance.now();
	const row = await page.evaluate(
		({ seed, maxSteps }) => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			let station = null;
			for (const body of g.world.system.bodies) {
				if (body.kind !== "station") continue;
				g.resetFlightToStart();
				g.targetId = body.id;
				g.engageCruise();
				if (g.detour) {
					station = body;
					break;
				}
			}
			if (!station) return null;
			g.resetFlightToStart();
			g.targetId = station.id;
			const start = performance.now();
			g.engageCruise();
			let steps = 0;
			let detourFrames = 0;
			const detourBodies = new Set();
			let lastDetour = null;
			for (let i = 0; i < maxSteps; i++) {
				g.step(dt);
				steps++;
				if (g.detour) {
					detourFrames++;
					detourBodies.add(`${g.detour.bodyId}:${g.detour.side}`);
					lastDetour = {
						bodyId: g.detour.bodyId,
						side: g.detour.side,
						waypoint: g.detour.waypoint,
					};
				}
				if (g.lastExit) break;
			}
			const exitBody = [...g.world.system.bodies].find((body) =>
				g.lastExit.endsWith(body.id),
			);
			return {
				seed,
				stationId: station.id,
				exit: g.lastExit,
				targetId: g.targetId,
				detourFrames,
				detourBodies: [...detourBodies],
				lastDetour,
				exitBodyPos: exitBody?.pos,
				shipPos: g.world.ship.pos,
				steps,
				cpuMs: performance.now() - start,
				charge: g.chargeAu,
			};
		},
		{ seed, maxSteps: corpus.maxSteps },
	);
	const evaluateMs = performance.now() - evaluateStart;
	await page.close();
	const timing = {
		seed,
		bootMs,
		evaluateMs,
		wallMs: performance.now() - seedStart,
		cpuMs: row?.cpuMs ?? 0,
		steps: row?.steps ?? 0,
	};
	if (!Object.values(timing).every(Number.isFinite))
		throw new Error(`Non-finite measurement for seed ${seed}`);
	timings.push(timing);
	console.log(JSON.stringify({ timing }));
	if (row) rows.push(row);
	else nonEngagingSeeds.push(seed);
}
const arrivals = rows.filter(
	(row) => row.exit === `arrived at ${row.stationId}`,
).length;
const timeouts = rows.filter((row) => !row.exit).length;
const detours = rows.filter((row) => row.detourFrames > 0).length;
load.stop();
const cpuMs = rows.reduce((sum, row) => sum + row.cpuMs, 0);
console.log(
	JSON.stringify(
		{
			measurementWallMs: performance.now() - started,
			mode: corpus.mode,
			seeds: corpus.seeds,
			maxSteps: corpus.maxSteps,
			cores: cpus().length,
			peakLoad: load.peak(),
			totalBootMs: timings.reduce((sum, row) => sum + row.bootMs, 0),
			totalCpuMs: cpuMs,
			legs: rows,
			timings,
			requestedSeeds: corpus.seeds.length,
			detourLegs: rows.length,
			nonEngagingSeeds,
			accountedSeeds: rows.length + nonEngagingSeeds.length,
			arrivals,
			timeouts,
			detours,
			meanCpuMs: rows.length ? cpuMs / rows.length : 0,
			nonArrivals: rows.filter(
				(row) => row.exit !== `arrived at ${row.stationId}`,
			),
		},
		null,
		2,
	),
);
check(
	"every requested seed is accounted for as an engagement or a non-engagement",
	rows.length + nonEngagingSeeds.length === corpus.seeds.length,
);
check("corpus contains at least one production detour leg", rows.length > 0);
check(
	"every production detour leg arrives at its selected station",
	arrivals === rows.length,
);
check("no production detour leg exhausts the frame budget", timeouts === 0);
check("every selected corpus leg activates a detour", detours === rows.length);
await browser.close();
exit();
