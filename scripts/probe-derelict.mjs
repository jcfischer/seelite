/** Node #732: fly the existing scoop gate and read the persisted wreck row. */
import { mkdirSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	installViewPlacement,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { placeDerelict } from "./lib/derelict-state.mjs";
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
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: 47 }));
	await bootedGame(page);
	const fixture = await placeDerelict(page);
	const draw = await page.evaluate(() => {
		const g = window.__seelite;
		const wreck = g.derelictsAt()[0];
		const drawn = [...g.derelictMeshes.values()][0];
		let lamps = 0,
			emissive = 0;
		drawn.root.traverse((o) => {
			if (o.name === "nav-lights" && o.visible) lamps++;
			if (o.material?.emissiveIntensity > 0) emissive++;
		});
		return {
			lamps,
			emissive,
			finish: drawn.root.userData.finish,
			containers: drawn.containers.size,
			rowStored: wreck.row.stored,
			clock: g.world.gameTime,
		};
	});
	check(
		"dark worn roster hull has lamps off",
		draw.lamps === 0 && draw.emissive === 0 && draw.finish === "worn",
	);
	check(
		"seen containers are pinned on the world row",
		draw.rowStored && draw.containers === fixture.containers.length,
	);
	mkdirSync("view-set/node-732", { recursive: true });
	await page.screenshot({ path: "view-set/node-732/derelict.png" });
	const posed = await page.evaluate((f) => {
		const g = window.__seelite;
		const root = [...g.derelictMeshes.values()][0].root;
		const before = root.quaternion.clone();
		g.step(1);
		g.render(0);
		const { pose } = g.derelictsAt().find((w) => w.key === f.key);
		const camera = g.cameraPos();
		const k = root.scale.x;
		const error = Math.hypot(
			root.position.x - (pose.pos.x - camera.x) * k,
			root.position.y - (pose.pos.y - camera.y) * k,
			root.position.z - (pose.pos.z - camera.z) * k,
		);
		return {
			error,
			rotationError: root.quaternion.angleTo(
				g.shotRotation({ forward: pose.nose, up: pose.up }),
			),
			tumble: before.angleTo(root.quaternion),
		};
	}, fixture);
	check(
		"draw follows the post-step body-frame pose and slow tumble",
		posed.error < 1e-9 && posed.rotationError < 1e-7 && posed.tumble > 0.001,
	);
	const result = await page.evaluate(async (f) => {
		const g = window.__seelite;
		const { tetherPose } = await import("/src/derelict.ts");
		const { effectiveDerelict } = await import("/src/world-state.ts");
		const { serializeSave, parseSave, newCommanderRecord } = await import(
			"/src/save-envelope.ts"
		);
		const { newCommander } = await import("/src/station-commerce.ts");
		const { CANISTER_SCOOP_RADIUS_KM } = await import("/src/raider-wreck.ts");
		const wreck = () => g.derelictsAt().find((w) => w.key === f.key);
		const index = f.containers.findIndex(
			(c) => c.kind === "good" && c.left > 1,
		);
		if (index < 0) throw Error("fixture needs a partial good");
		g.commander = { ...newCommander("courier"), cargo: { Food: 19 } };
		const initial = wreck();
		const heatBefore = g.legalRow().heat;
		const c = tetherPose(initial.pose, index);
		g.world.ship.pos = {
			...c.pos,
			x: c.pos.x + CANISTER_SCOOP_RADIUS_KM * 1.2,
		};
		g.world.ship.vel = { ...c.vel, x: c.vel.x - 0.04 };
		g.orientation.copy(
			g.shotRotation({
				forward: { x: -1, y: 0, z: 0 },
				up: { x: 0, y: 1, z: 0 },
			}),
		);
		g.proximityFrameBodyId = initial.pose.bodyId;
		g.assist = false;
		g.throttle = 0;
		const collisions = g.collisionImpacts;
		for (let i = 0; i < 150; i++) {
			g.step(1 / 60);
			if (
				wreck()?.row.containers[index].left < initial.row.containers[index].left
			)
				break;
		}
		const after = effectiveDerelict(
			g.commerceWorld,
			g.world.galaxy.index,
			f.key,
			g.world.gameTime,
		);
		if (after.condition !== "destroyed")
			throw Error("wreck unexpectedly stripped");
		g.render(0);
		const notice = g.scoop.text;
		const record = {
			...newCommanderRecord("courier", {
				systemIndex: g.world.system.record.index,
			}),
			state: g.commander,
			ladders: g.ladders,
		};
		const loaded = parseSave(
			serializeSave({ world: g.commerceWorld, commander: record }),
		);
		const savedLeft =
			loaded.world.galaxies[g.world.galaxy.index].derelicts[f.key].containers[
				index
			].left;
		g.scoop = { text: "", left: 0, accepted: true, canisterId: null };
		g.step(1 / 60);
		g.render(0);
		return {
			before: initial.row.containers[index].left,
			left: after.containers[index].left,
			savedLeft,
			notice,
			refusal: g.scoop.text,
			collisions: g.collisionImpacts - collisions,
			hold: loaded.commander.state.cargo,
			heatBefore,
			heatAfter: g.legalRow().heat,
		};
	}, fixture);

	check(
		"a flown close slow pass takes the one free tonne",
		result.left === result.before - 1 && result.notice.includes("SCOOPED"),
	);
	check(
		"tether gate is reachable without a hull collision",
		result.collisions === 0,
	);
	check(
		"reload preserves the remainder and cargo together",
		result.savedLeft === result.left &&
			Object.values(result.hold).reduce((s, t) => s + t, 0) === 20,
	);
	check(
		"a full hold names free tonnes and leaves the item",
		result.refusal.includes("0 t FREE"),
	);
	check("owned salvage adds no heat", result.heatAfter === result.heatBefore);
	const hit = await page.evaluate((f) => {
		const g = window.__seelite;
		const w = g.derelictsAt().find((w) => w.key === f.key);
		const before = g.collisionImpacts;
		g.commander = { ...g.commander, cargo: {} };
		g.assist = false;
		g.throttle = 0;
		g.world.ship.pos = { ...w.pose.pos, x: w.pose.pos.x + 0.4 };
		g.world.ship.vel = { ...w.pose.vel, x: w.pose.vel.x - 0.1 };
		for (let i = 0; i < 600 && g.collisionImpacts === before; i++)
			g.step(1 / 60);
		return {
			hit: g.collisionImpacts > before,
			body: g.lastCollisionImpact?.bodyId,
		};
	}, fixture);
	check(
		"flying into the derelict meets its built hull proxy",
		hit.hit && hit.body === fixture.key,
	);
	// UI fixture: a carried fitting above this commander's rung. The pure tests
	// cover its scoop and the commerce transaction; this checks the painted row.
	await page.goto(gameUrl(origin, { seed: 42, system: 1 }));
	await bootedGame(page);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const station = g.world.system.bodies.find(
			(s) => s.kind === "station" && s.stationType === "shipyard",
		);
		await window.__parkInBerth(station.id, g.berthIdsOfStation(station.id)[0]);
		g.clockHeld = true;
		g.commander = {
			...g.commander,
			recoveredFittings: [{ id: "Military Laser", tonnes: 1 }],
			cargo: {},
		};
		g.stationConsoleRevision += 1;
		g.stationConsoleTab = "Equipment";
		g.setHeadLook("forward");
		g.updateCockpit();
		g.render(0);
	});
	const row = page.locator('[data-live-recovered-fitting="Military Laser"]');
	check(
		"Equipment shows carried tonnage and the fitting's locked rung",
		(await row.innerText()).includes("1 t") &&
			(await row.innerText()).includes("LOCKED") &&
			(await row.innerText()).includes("COMBAT 6"),
	);
	check(
		"a locked fitting can be sold and has no FIT control",
		(await row
			.locator('[data-live-station-action="sell-recovered"]')
			.count()) === 1 &&
			(await row
				.locator('[data-live-station-action="fit-recovered"]')
				.count()) === 0,
	);
	await page.screenshot({ path: "view-set/node-732/equipment.png" });
	const credits = await page.evaluate(() => window.__seelite.commander.credits);
	await row.locator('[data-live-station-action="sell-recovered"]').click();
	const sale = await page.evaluate(() => ({
		credits: window.__seelite.commander.credits,
		items: window.__seelite.commander.recoveredFittings ?? [],
	}));
	check(
		"the Equipment SELL press removes the fitting and credits its sale",
		sale.items.length === 0 && sale.credits > credits,
	);
	await browser.close();
	exit();
} catch (error) {
	await browser.close();
	throw error;
}
