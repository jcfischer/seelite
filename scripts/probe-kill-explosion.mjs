/**
 * https://github.com/jcfischer/seelite/issues/1090
 *
 * Node #1090's browser tier: a raider killed by the player's laser explodes.
 * The headless rows (`tests/kill-explosion.test.ts`) own the scale, the drift,
 * the timing and the rule that every kill path draws it. What only the page
 * can answer is the wiring:
 *
 * - the frame the raider dies, one explosion is live at the wreck, the raider's
 *   hull is gone and its points are drawn by the renderer;
 * - it drifts with the wreck's velocity;
 * - after its duration it is gone, and the near scene keeps no explosion
 *   object behind.
 *
 * The kill is taken on a raider brought to its last point of hull, as
 * `probe-raider-consequence.mjs` takes it. `KILL_EVIDENCE=<dir>` writes a
 * capture at the kill and one a second later.
 */
import { mkdirSync } from "node:fs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const EVIDENCE = process.env.KILL_EVIDENCE;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

const kill = await page.evaluate(async () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};
	g.resetFlightToStart();
	const { makeModule } = await import("/src/loadout.ts");
	g.commander = {
		...g.commander,
		loadout: {
			...g.commander.loadout,
			h1: makeModule("military-laser", 1, "A"),
		},
	};
	g.armedFireGroup.reset();
	let far = null;
	let farKm = 0;
	for (const b of g.world.system.bodies) {
		const d = Math.hypot(
			b.pos.x - g.world.ship.pos.x,
			b.pos.y - g.world.ship.pos.y,
			b.pos.z - g.world.ship.pos.z,
		);
		if (b.kind !== "star" && d > farKm) {
			far = b;
			farKm = d;
		}
	}
	g.targetId = far.id;
	g.faceTarget?.();
	g.engageCruise();
	for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
	g.forceRaider("ahead", 0.5, 12);
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) frame();
	for (let i = 0; i < 30 && !g.encounter?.raider; i++) frame();
	const encounter = g.encounter;
	if (!encounter?.raider) return { error: "no duel", phase: encounter?.phase };
	const key = encounter.slot.key;
	const ahead = g.nose();
	const shipPos = g.world.ship.pos;
	g.encounter = {
		...encounter,
		raider: {
			...encounter.raider,
			flight: {
				...encounter.raider.flight,
				ship: {
					...encounter.raider.flight.ship,
					pos: {
						x: shipPos.x + ahead.x * 2,
						y: shipPos.y + ahead.y * 2,
						z: shipPos.z + ahead.z * 2,
					},
					vel: {
						x: g.world.ship.vel.x + ahead.x * 0.3,
						y: g.world.ship.vel.y + ahead.y * 0.3,
						z: g.world.ship.vel.z + ahead.z * 0.3,
					},
				},
			},
			condition: {
				...encounter.raider.condition,
				fore: 0,
				aft: 0,
				hull: 0.01,
			},
		},
	};
	const before = g.killExplosions.live().length;
	g.keys.add(" ");
	for (let i = 0; i < 600 && g.encounter; i++) {
		const r = g.encounter?.raider;
		if (r) {
			const p = g.world.ship.pos;
			const t = r.flight.ship.pos;
			g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
		}
		frame();
	}
	g.keys.delete(" ");
	const live = g.killExplosions.live();
	const group = g.killExplosions.object;
	const points = group.children[0] ?? null;
	let drawn = 0;
	if (points) {
		const prior = points.onBeforeRender;
		points.onBeforeRender = (...args) => {
			drawn++;
			prior.apply(points, args);
		};
	}
	g.render(0);
	return {
		key,
		before,
		encounterOver: g.encounter === null,
		lastExit: g.lastExit,
		raiderShown: g.raiderMesh.parent !== null,
		live: live.map((e) => ({
			key: e.key,
			at: e.at,
			pos: e.pos,
			vel: e.vel,
			reachKm: e.reachKm,
		})),
		killedAt: g.world.gameTime,
		inNearScene: group.parent === g.nearScene,
		children: group.children.length,
		drawn,
		pointCount: points?.geometry.getAttribute("position").count ?? 0,
	};
});

check(
	"the raider dies to the laser",
	!kill.error && kill.encounterOver && kill.lastExit.endsWith("destroyed"),
	JSON.stringify({ error: kill.error, lastExit: kill.lastExit }),
);
check(
	"its kill starts one explosion at the wreck, and its hull is gone",
	kill.before === 0 &&
		kill.live.length === 1 &&
		kill.live[0].key === kill.key &&
		kill.raiderShown === false,
	JSON.stringify({
		before: kill.before,
		live: kill.live,
		raider: kill.raiderShown,
	}),
);
check(
	"the explosion is in the near scene and the renderer draws its points",
	kill.inNearScene &&
		kill.children === 1 &&
		kill.drawn > 0 &&
		kill.pointCount > 0,
	JSON.stringify({
		inNearScene: kill.inNearScene,
		children: kill.children,
		drawn: kill.drawn,
		points: kill.pointCount,
	}),
);

if (EVIDENCE) {
	mkdirSync(EVIDENCE, { recursive: true });
	await page.screenshot({ path: `${EVIDENCE}/kill-explosion-0s.png` });
}

const drift = await page.evaluate(async () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const e = g.killExplosions.live()[0];
	if (!e) return { error: "no live explosion" };
	for (let i = 0; i < Math.round(1 / dt); i++) {
		g.step(dt);
		g.render(dt);
	}
	const points = g.killExplosions.object.children[0];
	const cam = g.cameraPos();
	const age = g.world.gameTime - e.at;
	const ship = g.world.ship.vel;
	const drawnAt = {
		x: points.position.x + cam.x,
		y: points.position.y + cam.y,
		z: points.position.z + cam.z,
	};
	return {
		age,
		offWreck: Math.hypot(
			drawnAt.x - (e.pos.x + e.vel.x * age),
			drawnAt.y - (e.pos.y + e.vel.y * age),
			drawnAt.z - (e.pos.z + e.vel.z * age),
		),
		apartFromShip:
			Math.hypot(e.vel.x - ship.x, e.vel.y - ship.y, e.vel.z - ship.z) * age,
	};
});
if (EVIDENCE)
	await page.screenshot({ path: `${EVIDENCE}/kill-explosion-1s.png` });
check(
	"a second on, it is drawn where the wreck's own velocity carried it, not where the ship's would have",
	!drift.error &&
		drift.age > 0.9 &&
		drift.offWreck < 1e-3 &&
		drift.apartFromShip > 0.1,
	JSON.stringify(drift),
);

const cleared = await page.evaluate(async () => {
	const g = window.__seelite;
	const { explosionDurationS } = await import("/src/kill-explosion.ts");
	const dt = g.units.MAX_DT;
	const e = g.killExplosions.live()[0];
	if (!e) return { error: "no live explosion" };
	const end = e.at + explosionDurationS(e.reachKm);
	for (let i = 0; i < 2000 && g.world.gameTime <= end + 0.1; i++) {
		g.step(dt);
		g.render(dt);
	}
	let leaked = 0;
	g.nearScene.traverse((o) => {
		if (o.name.startsWith("kill-explosion-")) leaked++;
	});
	return {
		past: g.world.gameTime > end,
		live: g.killExplosions.live().length,
		children: g.killExplosions.object.children.length,
		leaked,
	};
});
check(
	"after its duration it is gone, and the near scene keeps no explosion object",
	!cleared.error &&
		cleared.past &&
		cleared.live === 0 &&
		cleared.children === 0 &&
		cleared.leaked === 0,
	JSON.stringify(cleared),
);

await browser.close();
exit();
