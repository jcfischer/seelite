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

const BOOT_GLB =
	/\/(?:courier-cockpit|coriolis|trade-(?:ring|drum|wheel))[^/]*\.glb(?:\?|$)/;

const flyRows = async () => {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await page.route(/\.glb(?:\?|$)/, (route) =>
		BOOT_GLB.test(route.request().url()) ? route.continue() : route.abort(),
	);
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			voices: "formant",
			raider: "off",
			cinematic: false,
			"no-save": true,
			"models-full": false,
			"interiors-full": false,
			"shipyards-full": false,
			"refineries-full": false,
		}),
	);
	await bootedGame(page, 90000);
	const rows = await page.evaluate(async () => {
		const F = await import("/src/field-collision.ts");
		const S = await import("/src/sim.ts");
		const { envelopeAt } = await import("/src/rock-pieces.ts");
		const { rockArchetype } = await import("/src/field-lod.ts");
		const A = await import("/src/asteroid-field.ts");
		const { add, sub, scale, length, dot } = await import("/src/vec3.ts");
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const { plan, rocks } = g.fields[0];
		const rock = rocks.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));
		const id = F.rockId(plan, rock);
		const poseNow = () =>
			F.rockSolid(plan, rock, {
				fromTime: g.world.gameTime,
				toTime: g.world.gameTime,
			}).start;
		const velNow = () => A.rockPose(plan, rock, g.world.gameTime).vel;
		const face = envelopeAt(F.archetypePieces(rockArchetype(rock)), {
			x: 0,
			y: 0,
			z: 1,
		});
		const unit = (v) => scale(v, 1 / length(v));
		const prepare = () => {
			g.resetDock();
			g.dockingComputer.disengage();
			g.regime = "normal";
			g.assist = false;
			g.setThrottle(0);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			g.setAttitude({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
			g.condition = structuredClone(g.condition);
			g.world.rockPlacement = { placed: false, rocks: new Set() };
		};
		const offset = () => sub(g.world.ship.pos, poseNow().origin);
		const out = {
			id,
			radiusKm: rock.radiusKm,
			inertialSpeedKms: length(velNow()),
		};

		prepare();
		const approachKms = 0.2;
		g.world.ship.pos = add(
			poseNow().origin,
			scale(poseNow().z, face * rock.radiusKm + 0.3),
		);
		g.world.ship.vel = sub(velNow(), scale(poseNow().z, approachKms));
		const before = g.collisionImpacts;
		let hitAt = null;
		for (let i = 0; i < 120 && hitAt === null; i++) {
			g.step(dt);
			if (g.collisionImpacts > before) hitAt = i;
		}
		out.impact = {
			steps: hitAt,
			count: g.collisionImpacts - before,
			last: g.lastCollisionImpact,
			approachKms,
			outwardKms: dot(sub(g.world.ship.vel, velNow()), unit(offset())),
			dead: g.dead,
		};

		prepare();
		g.world.ship.pos = add(
			poseNow().origin,
			scale(poseNow().z, face * rock.radiusKm + 0.2),
		);
		g.world.ship.vel = sub(velNow(), scale(poseNow().z, 0.04));
		const takeDamage = g.takeDamage.bind(g);
		let damaged = 0;
		g.takeDamage = (amount, ...rest) => {
			damaged += amount;
			return takeDamage(amount, ...rest);
		};
		const landing = g.collisionImpacts;
		for (let i = 0; i < 200 && g.collisionImpacts === landing; i++) g.step(dt);
		damaged = 0;
		const base = g.collisionImpacts;
		const ghostsBase = g.collisionGhostSteps;
		let last = offset();
		let worstJump = 0;
		let nearest = Number.POSITIVE_INFINITY;
		const steps = 200;
		for (let i = 0; i < steps; i++) {
			g.world.ship.vel = add(velNow(), scale(unit(scale(offset(), -1)), 0.01));
			g.step(dt);
			const now = offset();
			worstJump = Math.max(worstJump, length(sub(now, last)));
			nearest = Math.min(nearest, length(now));
			last = now;
		}
		out.ride = {
			steps,
			impacts: g.collisionImpacts - base,
			ghostSteps: g.collisionGhostSteps - ghostsBase,
			worstJumpKm: worstJump,
			nearestKm: nearest,
			damaged,
			dead: g.dead,
		};

		prepare();
		g.world.ship.pos = add(poseNow().origin, scale(poseNow().x, 0.05));
		g.world.ship.vel = add(velNow(), { x: 0, y: 0, z: 0.05 });
		S.markShipPlaced(g.world);
		const placedBase = g.collisionImpacts;
		const ghostBase = g.collisionGhostSteps;
		let escaped = null;
		for (let i = 0; i < 600 && escaped === null; i++) {
			g.step(dt);
			if (length(offset()) > 2 * rock.radiusKm + 0.1) escaped = i;
		}
		out.placed = {
			escapedAfter: escaped,
			impacts: g.collisionImpacts - placedBase,
			ghostSteps: g.collisionGhostSteps - ghostBase,
			ghost: g.lastCollisionGhost,
		};
		g.world.ship.vel = sub(velNow(), scale(unit(offset()), 0.1));
		const reentry = g.collisionImpacts;
		for (let i = 0; i < 200 && g.collisionImpacts === reentry; i++) g.step(dt);
		out.placed.reentered = g.collisionImpacts > reentry;
		out.placed.reentryBody = g.lastCollisionImpact?.bodyId;
		return out;
	});
	await page.close();
	return rows;
};

try {
	const r = await flyRows();
	check(
		"the field's biggest rock is a body of its own, moving at orbital speed",
		/^field-00:rock-\d+$/.test(r.id) && r.inertialSpeedKms > 5,
		`${r.id} R=${(r.radiusKm * 1000).toFixed(0)} m, ${r.inertialSpeedKms.toFixed(1)} km/s`,
	);
	check(
		"an impact at a rock face names the rock and reads the closing speed in the rock's frame",
		r.impact.steps !== null &&
			r.impact.last?.bodyId === r.id &&
			r.impact.last.closingKms > 0.5 * r.impact.approachKms &&
			r.impact.last.closingKms < 1.5 * r.impact.approachKms &&
			r.impact.outwardKms > 0 &&
			!r.impact.dead,
		JSON.stringify(r.impact),
	);
	check(
		"pressed against a spinning rock the ship rides it: contact every step, no ghost, no damage, no sinking, no jump",
		r.ride.impacts >= r.ride.steps &&
			r.ride.ghostSteps === 0 &&
			r.ride.damaged === 0 &&
			!r.ride.dead &&
			r.ride.worstJumpKm < 0.003 &&
			r.ride.nearestKm > 0.3 * r.radiusKm,
		JSON.stringify(r.ride),
	);
	check(
		"a ship placed inside a rock ghosts the whole rock and flies out, then meets it again on re-entry",
		r.placed.escapedAfter !== null &&
			r.placed.impacts === 0 &&
			r.placed.ghostSteps > 0 &&
			r.placed.reentered &&
			r.placed.reentryBody === r.id,
		JSON.stringify(r.placed),
	);
} catch (error) {
	check("field flight probe ran", false, String(error?.stack ?? error));
} finally {
	await browser.close();
}
exit();
