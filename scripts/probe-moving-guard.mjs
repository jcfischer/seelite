/** Live spatial gate for the moving-body cruise stop and local-frame handoff. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 2 }));
await bootedGame(page);

const result = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const planet = [...g.world.system.bodies]
		.filter((body) => body.kind === "planet")
		.sort((a, b) => b.radiusKm - a.radiusKm)[0];
	const otherTarget = g.world.system.bodies.find(
		(body) => body.kind === "station",
	);
	if (!planet || !otherTarget)
		throw new Error("fixture lacks planet or station");
	const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	const relativeSpeed = (body) => {
		const velocity = g.velocityOf(body.id);
		return Math.hypot(
			g.world.ship.vel.x - velocity.x,
			g.world.ship.vel.y - velocity.y,
			g.world.ship.vel.z - velocity.z,
		);
	};
	const pointNose = (nose) => {
		// Quaternion rotating the canonical forward (0,0,-1) onto `nose`.
		const cross = { x: nose.y, y: -nose.x, z: 0 };
		let w = 1 - nose.z;
		if (w < 1e-9) {
			g.orientation.set(0, 1, 0, 0);
			return;
		}
		const norm = Math.hypot(cross.x, cross.y, cross.z, w);
		g.orientation.set(cross.x / norm, cross.y / norm, 0, w / norm);
	};
	const placeInsideShell = () => {
		g.world.ship.pos = {
			x: planet.pos.x + planet.radiusKm * 1.025,
			y: planet.pos.y,
			z: planet.pos.z,
		};
		g.world.ship.vel = g.velocityOf(planet.id);
		pointNose({ x: -1, y: 0, z: 0 });
		g.targetId = otherTarget.id;
		g.regime = "cruise";
		g.throttle = 1;
		g.chargeAu = 12;
	};

	g.assist = true;
	placeInsideShell();
	g.step(dt);
	const assistedDrop = {
		regime: g.regime,
		exit: g.lastExit,
		frameBodyId: g.frameBody?.id ?? null,
		centreKm: distance(g.world.ship.pos, planet.pos),
		surfaceKm: distance(g.world.ship.pos, planet.pos) - planet.radiusKm,
		relativeKms: relativeSpeed(planet),
	};
	g.setThrottle(0);
	g.step(dt);
	const assistedHold = {
		frameBodyId: g.frameBody?.id ?? null,
		relativeKms: relativeSpeed(planet),
		surfaceKm: distance(g.world.ship.pos, planet.pos) - planet.radiusKm,
	};

	const outwardBefore = assistedHold.surfaceKm;
	pointNose({ x: 1, y: 0, z: 0 });
	g.chargeAu = 12;
	g.engageCruise();
	for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
	const reengaged = {
		regime: g.regime,
		surfaceKm: distance(g.world.ship.pos, planet.pos) - planet.radiusKm,
		beforeKm: outwardBefore,
	};

	g.assist = false;
	placeInsideShell();
	g.assist = false;
	g.step(dt);
	const unassistedDrop = {
		regime: g.regime,
		frameBodyId: g.frameBody?.id ?? null,
		relativeKms: relativeSpeed(planet),
	};
	g.setThrottle(0);
	g.step(dt);
	const unassistedHold = {
		frameBodyId: g.frameBody?.id ?? null,
		relativeKms: relativeSpeed(planet),
		surfaceKm: distance(g.world.ship.pos, planet.pos) - planet.radiusKm,
	};
	return {
		planetId: planet.id,
		planetRadiusKm: planet.radiusKm,
		selectedTargetId: otherTarget.id,
		nearFarKm: g.units.NEAR_FAR_KM,
		assistedDrop,
		assistedHold,
		reengaged,
		unassistedDrop,
		unassistedHold,
	};
});

check(
	result.planetRadiusKm > result.nearFarKm,
	"fixture is a giant by centre-distance threshold",
);
check(
	result.selectedTargetId !== result.planetId,
	"blocking body differs from selected target",
);
check(
	result.assistedDrop.regime === "normal",
	"proximity stop enters normal flight",
);
check(
	result.assistedDrop.frameBodyId === result.planetId,
	"assist-on drop binds the blocking body frame",
);
check(
	result.assistedDrop.centreKm > result.nearFarKm,
	"giant handoff works beyond the ordinary centre-distance threshold",
);
check(result.assistedDrop.surfaceKm > 0, "drop remains outside the surface");
check(
	result.assistedDrop.relativeKms < 1e-6,
	"drop stops in the blocker frame",
);
check(
	result.assistedHold.frameBodyId === result.planetId &&
		result.assistedHold.relativeKms < 0.01 &&
		result.assistedHold.surfaceKm > 0,
	"assist-on next frame preserves the safe blocker handoff",
);
check(
	result.reengaged.regime === "cruise" &&
		result.reengaged.surfaceKm > result.reengaged.beforeKm,
	"outward re-engagement releases the ship",
);
check(
	result.unassistedDrop.regime === "normal" &&
		result.unassistedDrop.frameBodyId === result.planetId &&
		result.unassistedDrop.relativeKms < 1e-6,
	"assist-off drop uses the same blocker frame",
);
check(
	result.unassistedHold.frameBodyId === result.planetId &&
		result.unassistedHold.relativeKms < 0.01 &&
		result.unassistedHold.surfaceKm > 0,
	"assist-off next frame remains outside the moving blocker",
);

console.log(JSON.stringify(result));
await browser.close();
exit();
