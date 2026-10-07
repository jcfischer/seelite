/** Node #705: real death/reload, a drawn own-loss wreck, then the live scoop.
 * Return uses controlled placement; this does not measure the approach flight. */
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";
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
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(origin, { seed: 47 }));
	await bootedGame(page);
	const fixture = await page.evaluate(async () => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.resetFlightToStart();
		g.saveStore.markDirty();
		await g.saveStore.flush("dock");
		const { deathWreckContents } = await import("/src/death-wreck.ts");
		const { advanceTo } = await import("/src/world-state.ts");
		const { advanceSystem } = await import("/src/sim.ts");
		g.commander = {
			...g.commander,
			cargo: { Food: 8, Gold: 12 },
			ownedEquipment: ["Escape Pod", "Docking Computer"],
		};
		let at = Math.ceil(g.world.gameTime);
		for (; at < 10000; at++) {
			const items = deathWreckContents(
				g.commerceWorld.seed,
				at,
				g.commander,
				"destroyed",
			);
			if (
				["Food", "Gold", "Docking Computer"].every((id) =>
					items.some((c) => c.id === id),
				)
			)
				break;
		}
		g.world.gameTime = at;
		advanceSystem(g.world.system, at);
		g.commerceWorld = advanceTo(g.commerceWorld, at);
		g.world.ship.pos.x += 200;
		g.updateLocalFrameBody();
		return { pos: { ...g.world.ship.pos }, at, frame: g.deathFrameId() };
	});
	const reloaded = page.waitForEvent("load", { timeout: 20000 });
	await page.evaluate(() => {
		setTimeout(
			() => window.__seelite.takeDamage(1e6, "fore", "death wreck probe"),
			0,
		);
	});
	await reloaded;
	await bootedGame(page);
	const after = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.render(0);
		const row = g.commerceWorld.galaxies[g.world.galaxy.index].deathWreck;
		const wreck = g.derelictsAt().find((w) => w.key === row?.key);
		return {
			row,
			pos: wreck?.pose.pos,
			contact: g.contacts.find((c) => c.id === row?.key),
			equipment: g.commander.ownedEquipment,
			cargo: g.commander.cargo,
		};
	});
	check(
		"death reload leaves the fixed inventory at the death point",
		!!after.row &&
			Math.hypot(...["x", "y", "z"].map((k) => after.pos[k] - fixture.pos[k])) <
				0.01 &&
			after.row.bodyId === fixture.frame &&
			after.row.lostAt === fixture.at &&
			after.row.containers.length === 3,
		JSON.stringify(after.row),
	);
	check(
		"own loss is already a contact without a scanner and the pilot wakes empty",
		after.contact?.name.includes("Own wreck") &&
			after.equipment.length === 0 &&
			Object.keys(after.cargo).length === 0,
	);
	await page.evaluate(() => {
		const g = window.__seelite;
		const row = g.commerceWorld.galaxies[g.world.galaxy.index].deathWreck;
		const w = g.derelictsAt().find((w) => w.key === row.key);
		g.world.ship.pos = {
			x: w.pose.pos.x + 0.5,
			y: w.pose.pos.y + 0.15,
			z: w.pose.pos.z + 0.7,
		};
		g.world.ship.vel = { ...w.pose.vel };
		g.orientation.copy(
			g.shotRotation({
				forward: { x: -0.5, y: -0.15, z: -0.7 },
				up: { x: 0, y: 1, z: 0 },
			}),
		);
		g.setHeadLook("forward");
		g.render(0);
	});
	mkdirSync("view-set/node-705", { recursive: true });
	const shown = PNG.sync.read(
		await page.screenshot({ path: "view-set/node-705/death-wreck.png" }),
	);
	await page.evaluate(() => {
		const g = window.__seelite;
		const row = g.commerceWorld.galaxies[g.world.galaxy.index].deathWreck;
		g.derelictMeshes.get(row.key + ":" + row.instanceOrdinal).root.visible =
			false;
		g.render(0);
	});
	const hidden = PNG.sync.read(await page.screenshot());
	let changed = 0;
	for (let i = 0; i < shown.data.length; i += 4)
		if (
			Math.abs(shown.data[i] - hidden.data[i]) +
				Math.abs(shown.data[i + 1] - hidden.data[i + 1]) +
				Math.abs(shown.data[i + 2] - hidden.data[i + 2]) >
			20
		)
			changed++;
	check(
		"death hull paints visible pixels through the shared wreck drawing",
		changed > 50,
		String(changed),
	);
	const scooped = await page.evaluate(async () => {
		const g = window.__seelite;
		const { tetherPose } = await import("/src/derelict.ts");
		const row = g.commerceWorld.galaxies[g.world.galaxy.index].deathWreck;
		g.derelictMeshes.get(row.key + ":" + row.instanceOrdinal).root.visible =
			true;
		g.assist = true;
		g.throttle = 0;
		g.keys.clear();
		for (let i = 0; i < row.containers.length; i++) {
			const w = g.derelictsAt().find((w) => w.key === row.key);
			if (!w) break;
			const c = tetherPose(w.pose, i);
			g.world.ship.pos = { ...c.pos };
			g.world.ship.vel = { ...c.vel };
			g.step(1 / 60);
		}
		g.render(0);
		g.saveFlush("jump");
		await g.saveStore.settled();
		return {
			dead: g.dead,
			cargo: g.commander.cargo,
			fittings: g.commander.recoveredFittings,
			equipment: g.commander.ownedEquipment,
			wreck: g.commerceWorld.galaxies[g.world.galaxy.index].deathWreck,
			drawn: g.derelictMeshes.has(row.key + ":" + row.instanceOrdinal),
			saved: await g.save.backend.read(g.save.defaultSlot, "live"),
			notice: g.scoop.text,
		};
	});
	check(
		"the live proximity scoop recovers cargo and carries the fitting without fitting it",
		!scooped.dead &&
			scooped.cargo.Food === 8 &&
			scooped.cargo.Gold === 12 &&
			scooped.fittings?.[0]?.id === "Docking Computer" &&
			scooped.equipment.length === 0,
		JSON.stringify(scooped.fittings),
	);
	check(
		"stripping removes the row and drawing and the same save records the recovered hold",
		!scooped.wreck &&
			!scooped.drawn &&
			scooped.saved.commander.state.cargo.Food === 8 &&
			scooped.saved.commander.state.cargo.Gold === 12 &&
			scooped.saved.commander.state.recoveredFittings?.[0]?.id ===
				"Docking Computer" &&
			scooped.saved.commander.state.recoveredFittings[0].tonnes === 1 &&
			scooped.saved.commander.state.ownedEquipment.length === 0 &&
			!scooped.saved.world.galaxies[0].deathWreck,
	);
} finally {
	await browser.close();
}
exit();
