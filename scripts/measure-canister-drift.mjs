/**
 * How long a canister actually moves after a kill, and what it moves relative
 * to (#324, the principal's sixth playtest: "it felt like they were on
 * trajectories much longer than 10s").
 *
 * `CANISTER_FADE_S` is 10 and `driftCanister` decays the canister's velocity
 * linearly to the local frame's. **This instrument is what changed that frame
 * from a snapshot taken at the kill into the frame as it stands.** A kill in
 * deep space rests in the star frame, which is zero and never moves; a kill on
 * a leg rests in a *body's* frame, and that body keeps orbiting, so a frozen
 * copy peels away from the frame the player's assist parks them in. Run it
 * against a build with the snapshot restored and the `vs frame now` column
 * climbs without bound; here it must go to zero and stay.
 *
 * Two scenarios, because the first run of this instrument only measured the
 * first and found nothing:
 *   - `deep space`: the kill taken far from any body (star frame).
 *   - `near a body`: the kill taken at the start position, beside the station.
 *
 * Columns, with the ship parked at throttle 0 so its own motion cannot be
 * mistaken for the canister's:
 *   vs snapshot  — canister against `restVel`; this is what the fade promises,
 *                  and it must reach 0 at 10 s.
 *   vs frame now — canister against `localFrame()` as it stands; this is what a
 *                  parked pilot actually sees, and the report is about this.
 *   vs ship      — canister against the ship.
 */
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

const run = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
	const len = (a) => Math.hypot(a.x, a.y, a.z);
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};

	/**
	 * A canister placed beside the start station, built the way `dropCanisters`
	 * builds one: at rest in the local frame as it stands now, plus the eject
	 * speed. **Synthesized, not flown** — a forced raider only reaches the duel
	 * phase on a cruise leg, and cruising carries the ship 1.5e8 km out, so no
	 * duel this instrument can stage happens near a body. What runs it is the
	 * shipped step: `stepCargoCanisters` → `driftCanister`.
	 */
	const nearBody = () => {
		g.resetFlightToStart();
		for (let i = 0; i < 30; i++) frame();
		// **Put the ship beside a station.** The first version of this arm just
		// reset and measured, and `resetFlightToStart` leaves the ship 1.7e8 km
		// from anything — so it read the star frame a second time and changed
		// nothing. A body's velocity is taken from two steps rather than a
		// private accessor: the generator moves bodies, so this is the velocity
		// the sim itself is using.
		const station =
			g.world.system.bodies.find((b) => b.kind === "station") ??
			g.world.system.bodies.find((b) => b.kind === "planet");
		const was = { ...station.pos };
		const t0 = g.world.gameTime;
		g.step(dt);
		const moved = g.world.system.byId.get(station.id) ?? station;
		const span = g.world.gameTime - t0;
		const bodyVel = {
			x: (moved.pos.x - was.x) / span,
			y: (moved.pos.y - was.y) / span,
			z: (moved.pos.z - was.z) / span,
		};
		g.world.ship.pos = {
			x: moved.pos.x + 200,
			y: moved.pos.y,
			z: moved.pos.z,
		};
		g.world.ship.vel = { ...bodyVel };
		for (let i = 0; i < 10; i++) frame();
		const now = g.world.gameTime;
		const frame0 = g.localFrame();
		const ahead = g.nose();
		const first = {
			id: "measured#canister-0",
			commodity: "Food",
			tonnes: 1,
			pos: {
				x: g.world.ship.pos.x + ahead.x * 2,
				y: g.world.ship.pos.y + ahead.y * 2,
				z: g.world.ship.pos.z + ahead.z * 2,
			},
			// The wreck at rest in the frame, so only the eject term is left: the
			// gentlest drop there is. If this one slides, every real one does.
			vel: { x: frame0.x + 0.15, y: frame0.y, z: frame0.z },
			restsAt: now + 10,
			expiresAt: now + 300,
		};
		g.canisters = [first];
		const head = {
			id: first.id,
			restsAtFromKill: first.restsAt - now,
			snapshotKms: len(frame0),
			frameAtKillKms: len(frame0),
			frameBody: g.frameBody?.name ?? "star",
			nearestKm: (() => {
				let best = Infinity;
				for (const b of g.world.system.bodies)
					if (b.kind !== "star")
						best = Math.min(best, len(sub(b.pos, g.world.ship.pos)));
				return best;
			})(),
		};
		g.throttle = 0;
		const rows = [];
		const start = g.world.gameTime;
		for (let s = 0; s <= 24; s++) {
			const c = g.canisters.find((x) => x.id === first.id);
			const liveFrame = g.localFrame();
			rows.push({
				t: Math.round(g.world.gameTime - start),
				vsSnapshot: c ? len(sub(c.vel, frame0)) : null,
				vsFrameNow: c ? len(sub(c.vel, liveFrame)) : null,
				vsShip: c ? len(sub(c.vel, g.world.ship.vel)) : null,
				rangeKm: c ? len(sub(c.pos, g.world.ship.pos)) : null,
				// How far the frame the pilot is parked in has moved from the one
				// the canister froze. This is the hypothesis, as a number.
				frameDrift: len(sub(liveFrame, frame0)),
			});
			const until = g.world.gameTime + 5;
			while (g.world.gameTime < until) g.step(dt);
		}
		return { head, rows };
	};

	const scenario = (flyOut) => {
		g.resetFlightToStart();
		if (flyOut) {
			let far = null;
			let farKm = 0;
			for (const b of g.world.system.bodies) {
				const d = len(sub(b.pos, g.world.ship.pos));
				if (b.kind !== "star" && d > farKm) {
					far = b;
					farKm = d;
				}
			}
			g.targetId = far.id;
			g.faceTarget?.();
			g.engageCruise();
			for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
		}
		g.forceRaider("ahead", 0.5, 12);
		for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) frame();
		for (let i = 0; i < 30 && !g.encounter?.raider; i++) frame();
		const encounter = g.encounter;
		if (!encounter?.raider) return { error: "no duel" };
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
							x: g.world.ship.vel.x + ahead.x * g.assistCapKms,
							y: g.world.ship.vel.y + ahead.y * g.assistCapKms,
							z: g.world.ship.vel.z + ahead.z * g.assistCapKms,
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
		if (!g.canisters.length) return { error: "no canisters" };

		const first = g.canisters[0];
		const killedAt = g.world.gameTime;
		// The frame at the kill, kept by this instrument rather than by the
		// canister: the canister no longer carries one, which is the fix.
		const snapshot = { ...g.localFrame() };
		const head = {
			id: first.id,
			restsAtFromKill: first.restsAt - killedAt,
			snapshotKms: len(snapshot),
			frameAtKillKms: len(g.localFrame()),
			frameBody: g.frameBody?.name ?? "star",
			nearestKm: (() => {
				let best = Infinity;
				for (const b of g.world.system.bodies)
					if (b.kind !== "star")
						best = Math.min(best, len(sub(b.pos, g.world.ship.pos)));
				return best;
			})(),
		};

		// Park the ship: throttle off, assist on. This is the state the principal
		// flew — "I had to stop completely" — so it is the state to measure.
		g.throttle = 0;
		const rows = [];
		const start = g.world.gameTime;
		for (let s = 0; s <= 24; s++) {
			const c = g.canisters.find((x) => x.id === first.id);
			const now = g.localFrame();
			rows.push({
				t: Math.round(g.world.gameTime - start),
				vsSnapshot: c ? len(sub(c.vel, snapshot)) : null,
				vsFrameNow: c ? len(sub(c.vel, now)) : null,
				vsShip: c ? len(sub(c.vel, g.world.ship.vel)) : null,
				rangeKm: c ? len(sub(c.pos, g.world.ship.pos)) : null,
			});
			const until = g.world.gameTime + 5;
			// Stepped without rendering: this is a physics question and 120 s of
			// frames is the slow half.
			while (g.world.gameTime < until) g.step(dt);
		}
		return { head, rows };
	};

	return { deep: scenario(true), near: nearBody() };
});

const table = (title, arm) => {
	if (arm.error) {
		console.log(`\n${title}: ${arm.error}`);
		return;
	}
	const h = arm.head;
	console.log("");
	console.log(`── ${title}`);
	console.log(
		`   rests               ${h.restsAtFromKill.toFixed(1)} s after the kill`,
	);
	console.log(
		`   local frame at kill ${h.frameBody}, moving ${h.frameAtKillKms.toFixed(3)} km/s`,
	);
	console.log(`   nearest body        ${h.nearestKm.toFixed(0)} km`);
	console.log(
		"      t   vs snapshot  vs frame now      vs ship     range  frame drift",
	);
	for (const r of arm.rows) {
		const n = (v, p = 4) =>
			v === null || v === undefined ? "      gone" : v.toFixed(p).padStart(10);
		console.log(
			`${String(r.t).padStart(5)}s ${n(r.vsSnapshot)} ${n(r.vsFrameNow)} ${n(r.vsShip)} ${n(r.rangeKm, 1)} ${n(r.frameDrift)}`,
		);
	}
};

table("deep space (star frame), flown kill", run.deep);
table("near a body, synthesized drop", run.near);
console.log("");

await browser.close();
