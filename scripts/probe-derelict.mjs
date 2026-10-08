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
// Controlled range placements exercise the live step; they do not fly an approach.
async function placeNear(
	page,
	fixture,
	dx,
	{ step = false, look = null } = {},
) {
	return page.evaluate(
		({ fixture: f, dx, step, look }) => {
			const g = window.__seelite;
			const w = g.derelictsAt().find((w) => w.key === f.key);
			g.world.ship.pos = { ...w.pose.pos, x: w.pose.pos.x + dx };
			g.world.ship.vel = { ...w.pose.vel };
			if (step) g.step(1 / 60);
			g.render(0);
			if (look) g.setHeadLook(look);
			return {
				row: g.commerceWorld.galaxies[g.world.galaxy.index].knowledge[f.key],
				contact: g.contacts.some((c) => c.id === f.key),
			};
		},
		{ fixture, dx, step, look },
	);
}

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

	// Node #733: the fixture has no identification. Opening consoles reads no
	// objective position; a sweep is a deliberate press and carries only regions.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.commander = { ...g.commander, ownedEquipment: [] };
	});
	await placeNear(page, fixture, 3000, { look: "left" });
	check(
		"unfitted console has no Sweep tab",
		(await page.locator('[data-live-left-tab="Sweep"]').count()) === 0,
	);
	await page.locator('[data-live-left-tab="Navigation"]').click();
	const hidden = await page.evaluate(
		(f) => ({
			known:
				window.__seelite.commerceWorld.galaxies[0].knowledge[f.key] !==
				undefined,
			contact: window.__seelite.contacts.some((c) => c.id === f.key),
			cue: !document.querySelector("[data-live-wreck-cue]").hidden,
		}),
		fixture,
	);
	check(
		"unfitted outside visual floor has no knowledge, cue or Navigation row",
		!hidden.known &&
			!hidden.contact &&
			!hidden.cue &&
			(await page
				.locator('[data-live-nav-target="' + fixture.key + '"]')
				.count()) === 0,
	);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const { LONG_RANGE_SCANNER } = await import("/src/market.ts");
		g.commander = { ...g.commander, ownedEquipment: [LONG_RANGE_SCANNER] };
		g.updateCockpit();
	});
	await page.locator('[data-live-left-tab="Sweep"]').click();
	await page.locator("[data-live-sweep-action]").click();
	const partial = await page.evaluate(() => {
		const g = window.__seelite;
		for (let i = 0; i < 300; i++) g.step(1 / 60);
		g.render(0);
		return {
			elapsed: g.world.gameTime - g.sweepCharge.startedAt,
			sweepReadings: g.sweepReadings.length,
		};
	});
	check(
		"five seconds paints sweep progress without writing leads",
		partial.elapsed > 4.9 &&
			partial.sweepReadings === 0 &&
			(await page.locator("[data-live-sweep-status]").innerText()).includes(
				"CHARGING",
			),
	);
	await page.evaluate(() => {
		const g = window.__seelite;
		for (let i = 0; i < 310; i++) g.step(1 / 60);
		g.render(0);
	});
	const leadText = await page.locator("[data-live-sweep]").innerText();
	const swept = await page.evaluate(
		(f) => ({
			lead: window.__seelite.sweepReadings.find(
				(r) =>
					r.kind === "wreck" &&
					r.systemIndex === window.__seelite.world.system.record.index &&
					r.id.endsWith(":" + f.key.split(":")[1]),
			),
			known: window.__seelite.commerceWorld.galaxies[0].knowledge[f.key],
		}),
		fixture,
	);
	check(
		"completed sweep paints a region with source and age, never discovery",
		leadText.includes("Salvage wreck signal") &&
			leadText.includes("OWN SENSORS") &&
			leadText.includes("ago") &&
			!!swept.lead &&
			!swept.known &&
			!("pos" in swept.lead),
	);
	mkdirSync("view-set/node-733", { recursive: true });
	await page.screenshot({ path: "view-set/node-733/scanner-tab.png" });
	await placeNear(page, fixture, 500, { look: "forward" });
	const signal = page.locator("[data-live-wreck-cue]");
	check(
		"passive cue paints strength and bearing without an exact range",
		(await signal.isVisible()) &&
			(await signal.innerText()).includes("SCANNER RETURN") &&
			(await signal.innerText()).includes("off nose") &&
			!(await signal.innerText()).includes(" km"),
	);
	await page.screenshot({ path: "view-set/node-733/scanner-cue.png" });
	const scannerFound = await placeNear(page, fixture, 100, { step: true });
	check(
		"fitted placement inside identification range makes a selectable wreck through the live step",
		scannerFound.row?.source === "scanner identification" &&
			scannerFound.contact,
	);
	// Clear this observation only to exercise the independent visual channel
	// in the same naturally seeded fixture. Production never deletes knowledge.
	await page.evaluate(async (f) => {
		const g = window.__seelite;
		const { emptyPending } = await import("/src/ladder.ts");
		const galaxies = [...g.commerceWorld.galaxies];
		const knowledge = { ...galaxies[0].knowledge };
		delete knowledge[f.key];
		galaxies[0] = { ...galaxies[0], knowledge };
		g.commerceWorld = { ...g.commerceWorld, galaxies };
		g.ladderPending = emptyPending();
	}, fixture);

	await page.evaluate(() => {
		const g = window.__seelite;
		g.commander = { ...g.commander, ownedEquipment: [] };
	});
	await placeNear(page, fixture, 9.9, { step: true, look: "left" });
	await page.locator('[data-live-left-tab="Navigation"]').click();
	const nav = page.locator('[data-live-nav-target="' + fixture.key + '"]');
	check(
		"visual floor writes knowledge and paints selectable Navigation wreck",
		(await nav.count()) === 1 && (await nav.innerText()).includes("Derelict"),
	);
	await nav.click();
	const found = await page.evaluate((f) => {
		const g = window.__seelite;
		return {
			row: g.commerceWorld.galaxies[0].knowledge[f.key],
			target: g.targetBody()?.id,
			kinds: g.ladderPending.kinds,
			cue: !document.querySelector("[data-live-wreck-cue]").hidden,
		};
	}, fixture);
	check(
		"identified wreck is the target and earns the single pending kind without a scanner cue",
		found.row.source === "visual identification" &&
			found.target === fixture.key &&
			found.kinds?.join() === "wreck" &&
			!found.cue,
	);
	await page.screenshot({ path: "view-set/node-733/navigation.png" });
	// Restore the close framing for node #732's hull and scoop rows.
	await page.evaluate((f) => {
		const g = window.__seelite;
		const w = g.derelictsAt().find((w) => w.key === f.key);
		g.world.ship.pos = {
			x: w.pose.pos.x + 0.5,
			y: w.pose.pos.y + 0.15,
			z: w.pose.pos.z + 0.7,
		};
		g.world.ship.vel = { ...w.pose.vel };
		const forward = { x: -0.5, y: -0.15, z: -0.7 };
		g.orientation.copy(g.shotRotation({ forward, up: { x: 0, y: 1, z: 0 } }));
		g.setHeadLook("forward");
		g.render(0);
	}, fixture);
	const draw = await page.evaluate(async () => {
		const g = window.__seelite;
		const wreck = g.derelictsAt()[0];
		const drawn = [...g.derelictMeshes.values()][0];
		let lamps = 0,
			emissive = 0,
			frame = 0,
			liners = 0;
		drawn.root.traverse((o) => {
			if (o.name === "nav-lights" && o.visible) lamps++;
			if (o.material?.emissiveIntensity > 0) emissive++;
			if (o.userData.derelictFrame && o.visible) frame++;
			if (o.name.endsWith("-liner") && o.visible) liners++;
		});
		// Node #735: the wreck in the scene is the torn one, and what it draws
		// fills the box the intact hull of its kind draws.
		const { drawnHullBox } = await import("/src/derelict-tear.ts");
		const { buildShipMesh } = await import("/src/ship-mesh.ts");
		const { HULL_SPECS } = await import("/src/hull.ts");
		const hull = wreck.pose.hull;
		const intact = drawnHullBox(
			buildShipMesh(hull, HULL_SPECS[hull].variant).root,
		);
		const torn = drawnHullBox(drawn.root);
		const envelopeError = Math.max(
			...["x", "y", "z"].flatMap((a) => [
				Math.abs(torn.min[a] - intact.min[a]),
				Math.abs(torn.max[a] - intact.max[a]),
			]),
		);
		return {
			lamps,
			emissive,
			frame,
			liners,
			sites: drawn.root.userData.torn?.sites.length ?? 0,
			envelopeError,
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
		"the drawn wreck is torn: an exposed frame and a liner per tear, inside the intact envelope",
		draw.frame > 0 &&
			draw.sites > 0 &&
			draw.liners === draw.sites &&
			draw.envelopeError < 5e-5,
		`frame ${draw.frame}, tears ${draw.sites}, liners ${draw.liners}, envelope off by ${(draw.envelopeError * 1e3).toFixed(4)} m`,
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
		result.refusal.toUpperCase().includes("0 T FREE"),
	);
	check("owned salvage adds no heat", result.heatAfter === result.heatBefore);
	// A multi-tonne fitting fixture exercises the live Holdings adoption and
	// the cockpit refusal. Ordinary goods above use the naturally seeded row.
	const fitting = await page.evaluate(async (f) => {
		const g = window.__seelite;
		const { tetherPose } = await import("/src/derelict.ts");
		const { newCommander } = await import("/src/station-commerce.ts");
		const w = g.derelictsAt().find((w) => w.key === f.key);
		const galaxy = g.commerceWorld.galaxies[g.world.galaxy.index];
		const stored = galaxy.derelicts[f.key];
		const galaxies = [...g.commerceWorld.galaxies];
		galaxies[g.world.galaxy.index] = {
			...galaxy,
			derelicts: {
				...galaxy.derelicts,
				[f.key]: {
					...stored,
					containers: stored.containers.map((c, i) =>
						i === 0
							? { kind: "fitting", id: "Military Laser", tonnes: 3, left: 3 }
							: c,
					),
				},
			},
		};
		g.adoptWorld({ ...g.commerceWorld, galaxies });
		const c = tetherPose(w.pose, 0);
		g.world.ship.pos = { ...c.pos };
		g.world.ship.vel = { ...c.vel };
		g.commander = { ...newCommander("courier"), cargo: { Food: 18 } };
		g.scoop = { text: "", left: 0, accepted: true, canisterId: null };
		g.stepDerelictScoops();
		const refusedLeft =
			g.commerceWorld.galaxies[g.world.galaxy.index].derelicts[f.key]
				.containers[0].left;
		const refusal = g.scoop.text;
		const refusedItems = g.commander.recoveredFittings?.length ?? 0;
		g.commander = { ...g.commander, cargo: { Food: 17 } };
		g.stepDerelictScoops();
		g.stepDerelictScoops();
		return {
			refusedLeft,
			refusal,
			refusedItems,
			items: g.commander.recoveredFittings,
			left: g.commerceWorld.galaxies[g.world.galaxy.index].derelicts[f.key]
				.containers[0].left,
			notice: g.scoop.text,
		};
	}, fixture);
	check(
		"a fitting with too little room stays whole and names the free tonnes",
		fitting.refusedLeft === 3 &&
			fitting.refusedItems === 0 &&
			fitting.refusal.toUpperCase().includes("2 T FREE") &&
			fitting.refusal.toUpperCase().includes("3 T MILITARY LASER"),
	);
	check(
		"room for a fitting recovers one whole item through Holdings",
		fitting.left === 0 &&
			fitting.items?.length === 1 &&
			fitting.items[0].tonnes === 3 &&
			fitting.notice.includes("SCOOPED"),
	);
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
