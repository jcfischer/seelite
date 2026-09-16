/**
 * How long a canister actually moves after a kill, and what it moves relative
 * to (#324, the principal's sixth playtest: "it felt like they were on
 * trajectories much longer than 10s").
 *
 * `CANISTER_FADE_S` is 10 and `driftCanister` decays the canister's velocity
 * linearly to its frame's. **This instrument is what changed that frame from a
 * snapshot taken at the kill into the frame as it stands, resolved per
 * canister.** A kill in deep space rests in the star frame, which is zero and
 * never moves; a kill on a leg rests in a *body's* frame, and that body keeps
 * orbiting, so a frozen copy peels away from the frame the pilot's assist parks
 * them in.
 *
 * **The "before" is measured here, not remembered.** An earlier version said to
 * run this against a build with the snapshot restored, which it cannot do — a
 * canister no longer carries one, and the old code would throw on it. Instead
 * every row carries a **frozen twin**: the same canister integrated in this
 * script with the same linear fade against a frame fixed at the kill, which is
 * exactly what the old build did. The twin's range is the "before" column and
 * the real canister's is the "after", from one run of the shipped game.
 *
 * Two scenarios, because the first version of this instrument only measured the
 * first and found nothing:
 *   - `deep space`: a flown kill, far from any body (star frame).
 *   - `near a body`: a canister placed beside the station and run through the
 *     shipped step. Synthesized, because a forced raider only reaches the duel
 *     phase on a cruise leg and cruising carries the ship 1.5e8 km out.
 *
 * Columns, with the ship parked at throttle 0 so its own motion cannot be
 * mistaken for the canister's:
 *   vs snapshot  — canister against the local frame this instrument copied at
 *                  the kill. Climbs once the fix is in, and should.
 *   vs frame now — canister against `localFrame()` as it stands. This is what a
 *                  parked pilot sees, and the report is about this column.
 *   vs ship      — canister against the ship.
 *   range        — canister to ship.
 *   frozen range — the twin to ship: the range the old build gave.
 *   frozen vs f  — the twin's own speed against the live frame: the old build's
 *                  velocity, measured on the twin rather than inferred.
 *   frame drift  — how far the live frame has moved from the kill's.
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
	const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
	const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
	const len = (a) => Math.hypot(a.x, a.y, a.z);
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};

	/** The **shipped** fade, run against a frame that never moves: the rule this
	 *  fix replaced. Called through the page rather than copied here, so the
	 *  "before" column cannot drift onto arithmetic the game no longer has. */
	const stepFrozen = (c, dt, now, frameVel) =>
		g.canisterFade(c, dt, now, frameVel);

	const nearestKm = () => {
		let best = Infinity;
		for (const b of g.world.system.bodies)
			if (b.kind !== "star")
				best = Math.min(best, len(sub(b.pos, g.world.ship.pos)));
		return best;
	};

	const headFor = (first, frame0, killedAt) => ({
		id: first.id,
		restsAtFromKill: first.restsAt - killedAt,
		frameAtKillKms: len(frame0),
		frameBody: g.frameBody?.name ?? "star",
		frameBodyId: first.frameBodyId ?? "(star)",
		nearestKm: nearestKm(),
	});

	/** Both arms sample the same way, or the tables cannot be read together —
	 *  the first version duplicated this and only one copy grew a column. */
	const sampleRows = (id, frame0) => {
		g.throttle = 0;
		const rows = [];
		const start = g.world.gameTime;
		let twin = { ...g.canisters.find((x) => x.id === id) };
		for (let s = 0; s <= 24; s++) {
			const c = g.canisters.find((x) => x.id === id);
			const liveFrame = g.localFrame();
			rows.push({
				t: Math.round(g.world.gameTime - start),
				vsSnapshot: c ? len(sub(c.vel, frame0)) : null,
				vsFrameNow: c ? len(sub(c.vel, liveFrame)) : null,
				vsShip: c ? len(sub(c.vel, g.world.ship.vel)) : null,
				rangeKm: c ? len(sub(c.pos, g.world.ship.pos)) : null,
				frozenKm: len(sub(twin.pos, g.world.ship.pos)),
				// The twin's **own** speed against the live frame, so the "before"
				// velocity is the twin's rather than a figure read off the tracked
				// canister that only matches it once both have rested (sage #355).
				frozenVsFrameNow: len(sub(twin.vel, liveFrame)),
				frameDrift: len(sub(liveFrame, frame0)),
			});
			const until = g.world.gameTime + 5;
			while (g.world.gameTime < until) {
				const now = g.world.gameTime;
				g.step(dt);
				// The twin advances on the same clock, against the kill's frame.
				twin = stepFrozen(twin, g.world.gameTime - now, now, frame0);
			}
		}
		return rows;
	};

	/** A canister beside the start station, built the way `dropCanisters`
	 *  builds one and run through the shipped step. */
	const nearBody = () => {
		g.resetFlightToStart();
		for (let i = 0; i < 30; i++) frame();
		// **Put the ship beside a station.** `resetFlightToStart` leaves it 1.7e8
		// km from anything, so an arm that only resets measures the star frame a
		// second time and changes nothing. The body's velocity comes from two
		// steps rather than a private accessor.
		const station =
			g.world.system.bodies.find((b) => b.kind === "station") ??
			g.world.system.bodies.find((b) => b.kind === "planet");
		const was = { ...station.pos };
		const t0 = g.world.gameTime;
		g.step(dt);
		const moved = g.world.system.byId.get(station.id) ?? station;
		const span = g.world.gameTime - t0;
		const bodyVel = scale(sub(moved.pos, was), 1 / span);
		g.world.ship.pos = { x: moved.pos.x + 200, y: moved.pos.y, z: moved.pos.z };
		g.world.ship.vel = { ...bodyVel };
		for (let i = 0; i < 10; i++) frame();
		const now = g.world.gameTime;
		const frame0 = g.localFrame();
		const ahead = g.nose();
		const first = {
			id: "measured#canister-0",
			commodity: "Food",
			tonnes: 1,
			pos: add(g.world.ship.pos, scale(ahead, 2)),
			// **Hand-built, not a drop.** `dropCanisters` needs a kill, and no
			// forced duel lands near a body, so this is the eject term alone:
			// no fifth of a wreck's velocity and no spread. The gentlest case
			// there is — if this one slides, every real one does — but the
			// figures below are this canister's, not a drop the game produced.
			vel: { x: frame0.x + 0.15, y: frame0.y, z: frame0.z },
			// Its own frame is the station's, which is what the game resolves per
			// canister rather than from wherever the pilot happens to be.
			frameBodyId: station.id,
			restsAt: now + 10,
			expiresAt: now + 300,
		};
		g.canisters = [first];
		return {
			head: headFor(first, frame0, now),
			rows: sampleRows(first.id, frame0),
		};
	};

	/** A flown kill, which always lands in deep space. */
	const deepSpace = () => {
		g.resetFlightToStart();
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
						pos: add(shipPos, scale(ahead, 2)),
						vel: add(g.world.ship.vel, scale(ahead, g.assistCapKms)),
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
			if (r)
				g.setAttitude(sub(r.flight.ship.pos, g.world.ship.pos), g.shipUp());
			frame();
		}
		g.keys.delete(" ");
		if (!g.canisters.length) return { error: "no canisters" };
		const first = g.canisters[0];
		const killedAt = g.world.gameTime;
		const frame0 = { ...g.localFrame() };
		return {
			head: headFor(first, frame0, killedAt),
			rows: sampleRows(first.id, frame0),
		};
	};

	return { deep: deepSpace(), near: nearBody() };
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
		`   frame at the kill   ${h.frameBody} (${h.frameBodyId}), moving ${h.frameAtKillKms.toFixed(3)} km/s`,
	);
	console.log(`   nearest body        ${h.nearestKm.toFixed(0)} km`);
	console.log(
		"      t  vs snapshot  vs frame now     vs ship     range  frozen range  frozen vs f  frame drift",
	);
	for (const r of arm.rows) {
		const n = (v, p = 4, w = 9) =>
			v === null || v === undefined
				? "     gone".padStart(w)
				: v.toFixed(p).padStart(w);
		console.log(
			`${String(r.t).padStart(5)}s ${n(r.vsSnapshot)} ${n(r.vsFrameNow, 4, 13)} ${n(r.vsShip, 4, 11)} ${n(r.rangeKm, 1, 9)} ${n(r.frozenKm, 1, 13)} ${n(r.frozenVsFrameNow, 4, 12)} ${n(r.frameDrift, 4, 12)}`,
		);
	}
};

table("deep space (star frame), flown kill", run.deep);
table("near a body, synthesized drop", run.near);
console.log("");

await browser.close();
