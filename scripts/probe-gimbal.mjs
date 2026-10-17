/**
 * The pulse laser's gimbal in the running game (#324, the principal's rulings:
 * ±6° cone, selected target, finite slew, true-hull hits).
 *
 * `tests/gimbal.test.ts` owns the arithmetic. What only the page can answer is
 * the wiring: that `Game` steps the gimbal before the shot, that the duel's
 * beam is the gimballed one, and that the beam stays in its cone.
 *
 * **The raider is held at a fixed angle off the boresight** by placing it again
 * before every step, at 2 km, and the ship's attitude is not touched. That
 * isolates the gimbal from the controller's flying. The angles are geometry for
 * this probe: 3° is inside the ruled ±6° cone and 8° outside it.
 */
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
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

const reachDuel = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	g.resetFlightToStart();
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
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) {
		g.step(dt);
		g.render(dt);
	}
	for (let i = 0; i < 30 && !g.encounter?.raider; i++) {
		g.step(dt);
		g.render(dt);
	}
	g.targetId = g.raiderContact.id;
	g.render(dt);
	return {
		phase: g.encounter?.phase ?? null,
		targeted: g.targetBody()?.id === g.raiderContact.id,
	};
});
check(
	"the probe reaches a duel with the raider selected",
	reachDuel.phase === "duel" && reachDuel.targeted,
	JSON.stringify(reachDuel),
);

/** Hold the raider `deg` off the boresight at 2 km and fire for `frames`. */
const holdOff = (deg) =>
	page.evaluate((angleDeg) => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const pool = (c) => c.fore + c.aft + c.hull;
		const a = (angleDeg * Math.PI) / 180;
		const angle = (u, v) =>
			(Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z))) *
				180) /
			Math.PI;
		// Full shields and hull, so a hit shows as a fall and no kill ends it.
		const start = g.encounter.raider;
		const full = {
			...start.condition,
			fore: start.condition.shieldMax,
			aft: start.condition.shieldMax,
		};
		g.encounter = { ...g.encounter, raider: { ...start, condition: full } };
		const before = pool(g.encounter.raider.condition);
		let widest = 0;
		g.keys.add(" ");
		for (let i = 0; i < 90 && g.encounter?.raider; i++) {
			const bore = g.nose();
			const up = g.shipUp();
			const across = {
				x: up.y * bore.z - up.z * bore.y,
				y: up.z * bore.x - up.x * bore.z,
				z: up.x * bore.y - up.y * bore.x,
			};
			const dir = {
				x: bore.x * Math.cos(a) + across.x * Math.sin(a),
				y: bore.y * Math.cos(a) + across.y * Math.sin(a),
				z: bore.z * Math.cos(a) + across.z * Math.sin(a),
			};
			const cam = g.cameraPos();
			const r = g.encounter.raider;
			g.encounter = {
				...g.encounter,
				raider: {
					...r,
					flight: {
						...r.flight,
						ship: {
							...r.flight.ship,
							pos: {
								x: cam.x + dir.x * 2,
								y: cam.y + dir.y * 2,
								z: cam.z + dir.z * 2,
							},
							vel: { ...g.world.ship.vel },
						},
					},
				},
			};
			g.step(dt);
			g.render(dt);
			if (g.gunAim) widest = Math.max(widest, angle(g.gunAim, g.weaponAim()));
		}
		g.keys.delete(" ");
		const after = g.encounter?.raider
			? pool(g.encounter.raider.condition)
			: null;
		// Let go of the target and step on: the beam must come back to centre.
		g.targetId = null;
		for (let i = 0; i < 30; i++) {
			g.step(dt);
			g.render(dt);
		}
		return {
			before,
			after,
			widestDeg: widest,
			settledDeg: g.gunAim ? angle(g.gunAim, g.weaponAim()) : 0,
			phase: g.encounter?.phase ?? null,
		};
	}, deg);

const inside = await holdOff(3);
check(
	"a selected raider 3° off the boresight is hit through the gimbal",
	inside.after !== null && inside.after < inside.before,
	JSON.stringify(inside),
);
check(
	"the gimballed beam never leaves the ±6° cone",
	inside.widestDeg <= 6 + 1e-6 && inside.widestDeg > 2,
	`widest ${inside.widestDeg.toFixed(3)}°`,
);
check(
	"with no target the beam returns to the boresight",
	inside.settledDeg < 0.01,
	`settled ${inside.settledDeg.toFixed(4)}°`,
);

// The raider again, selected, and now outside the cone.
await page.evaluate(() => {
	const g = window.__seelite;
	g.targetId = g.raiderContact.id;
	g.render(g.units.MAX_DT);
});
const outside = await holdOff(8);
check(
	"a selected raider 8° off is outside the cone and is not hit",
	outside.after !== null && Math.abs(outside.after - outside.before) < 1e-9,
	JSON.stringify(outside),
);

// A body that is not a raider, selected 3° off the nose: the beam stays on the
// boresight, or a raider on the boresight would be missed (sage #330).
const body = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const angle = (u, v) =>
		(Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z))) *
			180) /
		Math.PI;
	const other = g.world.system.bodies.find(
		(b) => b.kind !== "star" && b.id !== g.raiderContact.id,
	);
	g.targetId = other.id;
	const a = (3 * Math.PI) / 180;
	let offDeg = 0;
	for (let i = 0; i < 60; i++) {
		const cam = g.cameraPos();
		const d = {
			x: other.pos.x - cam.x,
			y: other.pos.y - cam.y,
			z: other.pos.z - cam.z,
		};
		const n = Math.hypot(d.x, d.y, d.z);
		const to = { x: d.x / n, y: d.y / n, z: d.z / n };
		const up = g.shipUp();
		const across = {
			x: up.y * to.z - up.z * to.y,
			y: up.z * to.x - up.x * to.z,
			z: up.x * to.y - up.y * to.x,
		};
		const m = Math.hypot(across.x, across.y, across.z);
		g.setAttitude(
			{
				x: to.x * Math.cos(a) + (across.x / m) * Math.sin(a),
				y: to.y * Math.cos(a) + (across.y / m) * Math.sin(a),
				z: to.z * Math.cos(a) + (across.z / m) * Math.sin(a),
			},
			up,
		);
		g.step(dt);
		g.render(dt);
		offDeg = angle(to, g.weaponAim());
	}
	return {
		kind: other.kind,
		offDeg,
		beamDeg: g.gunAim ? angle(g.gunAim, g.weaponAim()) : 0,
	};
});
check(
	"a selected body that is not a raider, inside the cone, does not turn the beam",
	body.offDeg > 1 && body.offDeg < 5 && body.beamDeg < 0.01,
	JSON.stringify(body),
);

await browser.close();
exit();
