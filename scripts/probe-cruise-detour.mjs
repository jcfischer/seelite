/** Live Game-loop gate for the bounded automatic station detour. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/cruise-detour.ts",
	"src/cruise.ts",
]);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(`${origin}/?seed=19`);
await bootedGame(page);

const result = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	const pointSegment = (a, b, p) => {
		const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
		const abSq = ab.x ** 2 + ab.y ** 2 + ab.z ** 2;
		const t = Math.max(
			0,
			Math.min(
				1,
				((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / abSq,
			),
		);
		return dist({ x: a.x + t * ab.x, y: a.y + t * ab.y, z: a.z + t * ab.z }, p);
	};
	let station = null;
	for (const body of g.world.system.bodies) {
		if (body.kind !== "station") continue;
		g.targetId = body.id;
		const host = g.world.system.byId.get(g.targetParentId());
		if (
			host &&
			pointSegment(g.world.ship.pos, body.pos, host.pos) < host.radiusKm
		) {
			station = body;
			break;
		}
	}
	if (!station) throw new Error("seed 19 has no host-occluded station fixture");
	g.targetId = station.id;
	g.engageCruise();
	for (let i = 0; i < 80 && g.regime !== "cruise"; i++) g.step(dt);
	for (let i = 0; i < 20; i++) g.step(dt);
	const active = {
		targetId: g.targetId,
		detour: g.detour,
		prompt: g.cruisePrompt?.(g.targetRange()) ?? "",
	};
	const velocity = g.world.ship.vel;
	const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
	const nose = g.nose();
	const alignment = speed
		? (velocity.x * nose.x + velocity.y * nose.y + velocity.z * nose.z) / speed
		: 0;
	const alternate = g.world.system.bodies.find(
		(body) => body.id !== station.id,
	);
	if (!alternate) throw new Error("seed 19 has no alternate target fixture");
	g.targetId = alternate.id;
	g.step(dt);
	const retargetCleared = g.detour === null;
	g.resetFlightToStart();
	g.targetId = station.id;
	g.engageCruise();
	window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
	const spoolCancelClears = g.detour === null;
	g.engageCruise();
	for (let i = 0; i < 80 && g.regime !== "cruise"; i++) g.step(dt);
	for (let i = 0; i < 20; i++) g.step(dt);
	g.keys.add("shift");
	g.step(dt);
	g.keys.delete("shift");
	const cancelled = g.detour === null;
	g.resetFlightToStart();
	g.targetId = station.id;
	g.engageCruise();
	let flew = false;
	for (let i = 0; i < 12000; i++) {
		g.step(dt);
		if (g.regime === "cruise") flew = true;
		if (flew && g.regime === "normal") break;
	}
	return {
		stationId: station.id,
		active,
		alignment,
		retargetCleared,
		spoolCancelClears,
		cancelled,
		finalTargetId: g.targetId,
		finalExit: g.lastExit,
		finalDetour: g.detour,
		finalRangeKm: g.targetRange(),
	};
});

check(
	"detour retains the selected station",
	result.active.detour?.targetId === result.stationId,
);
check(
	"detour has exactly two internal waypoints",
	result.active.detour?.waypoints?.length === 2,
);
check(
	"detour state names the blocker to the player",
	result.active.prompt.startsWith("DETOUR AROUND"),
);
check("cruise velocity follows the visible nose", result.alignment > 0.999);
check("changing target clears the old detour", result.retargetCleared);
check("cancelling spool-up clears its detour", result.spoolCancelClears);
check("manual throttle cancels automatic detour immediately", result.cancelled);
check(
	"arrival never changes the selected station",
	result.finalTargetId === result.stationId,
);
check(
	"detour reaches the selected station",
	result.finalExit === `arrived at ${result.stationId}`,
);
console.log(JSON.stringify(result));
await browser.close();
exit();
