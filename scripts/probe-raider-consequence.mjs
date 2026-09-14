/**
 * Node #324 part (d)'s browser tier: what a kill leaves in the running game.
 *
 * The headless rows own the arithmetic — `tests/world-state.test.ts` (the lazy
 * scheduled start), `tests/raider-wreck.test.ts` (the lifecycle event, the
 * drop and the scoop), `tests/raider-log.test.ts` and `tests/encounter.test.ts`
 * (a slot that is not operational fields no raider). What only the page can
 * answer is the wiring:
 *
 * - a kill writes the slot's destruction into the live world state;
 * - the destroyed slot fields no raider, so a forced one takes the next slot;
 * - the wreck drops canisters, which show on the glass;
 * - a close, slow pass scoops one into the hold;
 * - the lifecycle runs on the game clock;
 * - the Communications console shows it.
 *
 * The kill is taken on a raider brought to its last point of hull. How a duel
 * wears a raider down is `probe-interdiction.mjs`'s question, and flying one
 * down here would make this probe a minute long for nothing it checks.
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

const kill = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const frame = (each) => {
		g.step(dt);
		each?.();
		g.render(dt);
	};
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
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) frame();
	for (let i = 0; i < 30 && !g.encounter?.raider; i++) frame();
	const encounter = g.encounter;
	if (!encounter?.raider) return { error: "no duel", phase: encounter?.phase };
	const key = encounter.slot.key;
	const name = encounter.name;
	// The raider's last point of hull, and every shield spent.
	g.encounter = {
		...encounter,
		raider: {
			...encounter.raider,
			condition: {
				...encounter.raider.condition,
				fore: 0,
				aft: 0,
				hull: 0.01,
			},
		},
	};
	const cargoBefore = { ...g.commander.cargo };
	g.keys.add(" ");
	for (let i = 0; i < 600 && g.encounter; i++)
		frame(() => {
			const r = g.encounter?.raider;
			if (!r) return;
			const p = g.world.ship.pos;
			const t = r.flight.ship.pos;
			g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
		});
	g.keys.delete(" ");
	return {
		key,
		name,
		killedAt: g.world.gameTime,
		lastExit: g.lastExit,
		encounter: g.encounter,
		condition: g.carrierCondition(key).condition,
		canisters: g.canisters.map((c) => ({
			commodity: c.commodity,
			tonnes: c.tonnes,
			km: Math.hypot(
				c.pos.x - g.world.ship.pos.x,
				c.pos.y - g.world.ship.pos.y,
				c.pos.z - g.world.ship.pos.z,
			),
			expiresAt: c.expiresAt,
		})),
		cargoBefore,
	};
});
check(
	"a kill ends the encounter as destroyed",
	!kill.error && kill.encounter === null && kill.lastExit.endsWith("destroyed"),
	JSON.stringify(kill),
);
check(
	"the kill writes the slot's destruction into world state",
	kill.condition === "destroyed",
	`${kill.key} is ${kill.condition}`,
);
check(
	"the wreck drops one to three one-tonne canisters near the kill, expiring in five minutes",
	kill.canisters.length >= 1 &&
		kill.canisters.length <= 3 &&
		kill.canisters.every(
			(c) =>
				c.tonnes === 1 &&
				c.km < 20 &&
				// The kill is stamped at the start of the step it happened in,
				// and `killedAt` is read after that step, so a step apart.
				Math.abs(c.expiresAt - kill.killedAt - 300) <= 0.2,
		),
	JSON.stringify(kill.canisters),
);

// ---------------------------------------------------------------------------
// The glass shows them, and a close, slow pass scoops one.
// ---------------------------------------------------------------------------
const glass = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const c = g.canisters[0];
	// Face the canister so its marker is on the glass.
	const p = g.world.ship.pos;
	g.setAttitude(
		{ x: c.pos.x - p.x, y: c.pos.y - p.y, z: c.pos.z - p.z },
		g.shipUp(),
	);
	g.step(dt);
	g.render(dt);
	const overlay = document.getElementById("overlay");
	const ctx = overlay.getContext("2d", { willReadFrequently: true });
	const data = ctx.getImageData(
		overlay.width / 2 - 40,
		overlay.height / 2 - 40,
		80,
		80,
	).data;
	let green = 0;
	for (let i = 0; i < data.length; i += 4)
		if (
			data[i + 3] > 40 &&
			data[i + 1] > 200 &&
			data[i] < 190 &&
			data[i + 2] < 200
		)
			green++;
	return { green, count: g.canisters.length };
});
check(
	"a canister ahead is marked on the glass",
	glass.count > 0 && glass.green > 0,
	JSON.stringify(glass),
);

const scoop = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const before = g.canisters.length;
	const c = g.canisters[0];
	const held = g.commander.cargo[c.commodity] ?? 0;
	g.world.ship.pos = { ...c.pos };
	g.world.ship.vel = { ...c.vel };
	g.step(dt);
	g.render(dt);
	return {
		before,
		after: g.canisters.length,
		commodity: c.commodity,
		held,
		now: g.commander.cargo[c.commodity] ?? 0,
		lastExit: g.lastExit,
	};
});
check(
	"a close, slow pass scoops the canister into the hold",
	scoop.after === scoop.before - 1 &&
		scoop.now === scoop.held + 1 &&
		scoop.lastExit.startsWith("scooped"),
	JSON.stringify(scoop),
);

// ---------------------------------------------------------------------------
// The destroyed slot fields no raider; the lifecycle runs on the clock; the
// Communications console shows it.
// ---------------------------------------------------------------------------
const next = await page.evaluate((killedKey) => {
	const g = window.__seelite;
	g.forceRaider("ahead", 5, 12);
	return {
		slot: g.encounter?.slot.key ?? null,
		name: g.encounter?.name ?? null,
		killedKey,
	};
}, kill.key);
check(
	"a forced raider after the kill never takes the destroyed slot",
	// A lawful system can hold a single slot, and then there is no raider at all
	// to force — which is the answer, not a miss.
	next.slot !== next.killedKey,
	JSON.stringify(next),
);

const logAt = async (t) => {
	await page.evaluate((time) => {
		const g = window.__seelite;
		g.encounter = null;
		g.world.gameTime = time;
		g.leftTab = "Communications";
		g.setHeadLook("left");
		g.render(g.units.MAX_DT);
	}, t);
	await page.evaluate(
		() =>
			new Promise((done) => {
				let n = 3;
				const tick = () => (n-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
	);
	return page.evaluate((key) => {
		const g = window.__seelite;
		return {
			condition: g.carrierCondition(key).condition,
			instance: g.carrierCondition(key).instanceOrdinal,
			lines: [...document.querySelectorAll("[data-live-raider-log] li")].map(
				(li) => li.textContent,
			),
		};
	}, kill.key);
};
const atKill = await logAt(kill.killedAt + 1);
const repairing = await logAt(kill.killedAt + 601);
const replaced = await logAt(kill.killedAt + 1801);
check(
	"the Communications log names the kill",
	atKill.condition === "destroyed" &&
		atKill.lines.some((l) => l.endsWith(`${kill.name} destroyed`)),
	JSON.stringify(atKill),
);
check(
	"ten minutes on, the slot is repairing and the log says so",
	repairing.condition === "repairing" &&
		repairing.lines.some((l) => l.endsWith(`${kill.name} under repair`)),
	JSON.stringify(repairing),
);
check(
	"thirty minutes on, the raider is replaced and back in service",
	replaced.condition === "operational" &&
		replaced.instance === 1 &&
		replaced.lines.some((l) => l.endsWith(`${kill.name} back in service`)),
	JSON.stringify(replaced),
);

await browser.close();
exit();
