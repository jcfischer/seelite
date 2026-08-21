/**
 * The normal game route owns the live cockpit. This is deliberately separate
 * from the gallery probe: it proves the Game's renderer, true world contacts,
 * and head-look states rather than the fixed design fixtures.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

function measureLiveCockpit() {
	const visible = (selector) => {
		const element = document.querySelector(selector);
		if (!(element instanceof HTMLElement)) return false;
		const style = getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden";
	};
	const box = (selector) => {
		const element = document.querySelector(selector);
		if (!(element instanceof HTMLElement)) return null;
		const rect = element.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top,
			right: rect.right,
			bottom: rect.bottom,
			width: rect.width,
			height: rect.height,
		};
	};
	const game = window.__seelite;
	const scanner = game.nearScene.getObjectByName("scanner");
	const deck = game.nearScene.getObjectByName("scanner-deck");
	const pitch = deck?.rotation.x ?? 0;
	const deckNormal = { y: Math.cos(pitch), z: Math.sin(pitch) };
	const scannerOffset =
		scanner && deck
			? (scanner.position.y - deck.position.y) * deckNormal.y +
				(scanner.position.z - deck.position.z) * deckNormal.z
			: 0;
	const expectedContacts = game.world.system.bodies.filter(
		(body) =>
			Math.hypot(
				body.pos.x - game.world.ship.pos.x,
				body.pos.y - game.world.ship.pos.y,
				body.pos.z - game.world.ship.pos.z,
			) <= 10_000,
	).length;
	const rangeRingFootprint = game.nearScene
		.getObjectsByProperty("name", "scanner-range-ring")
		.map((ring) => {
			const points = ring.geometry.getAttribute("position");
			let maxX = 0;
			let maxZ = 0;
			for (let i = 0; i < points.count; i++) {
				maxX = Math.max(maxX, Math.abs(points.getX(i)));
				maxZ = Math.max(maxZ, Math.abs(points.getZ(i)));
			}
			return { maxX, maxZ };
		});
	return {
		headLook: document
			.querySelector("[data-live-cockpit]")
			?.getAttribute("data-live-head-look"),
		cockpitMesh: Boolean(game.nearScene.getObjectByName("cockpit")?.visible),
		rendererCount: document.querySelectorAll("canvas:not(#overlay)").length,
		scannerMounted:
			Boolean(scanner?.visible) &&
			scanner?.parent === deck?.parent &&
			Math.abs(scanner.position.x) < 1e-6 &&
			scannerOffset > 0 &&
			Math.abs(scanner.rotation.x + Math.PI / 2 - pitch) < 1e-6,
		floorVisible: visible("[data-live-floor]"),
		physicalInstruments: [
			"flight-instrument",
			"throttle-track",
			"target-instrument",
		].filter((name) => Boolean(game.nearScene.getObjectByName(name))).length,
		throttleFill: game.nearScene.getObjectByName("throttle-fill")?.scale.z ?? 0,
		throttleFillZ:
			game.nearScene.getObjectByName("throttle-fill")?.position.z ?? 0,
		canopyHeaderBraces: [
			"canopy-header-brace-port",
			"canopy-header-brace-starboard",
		].filter((name) => Boolean(game.nearScene.getObjectByName(name))).length,
		scannerWell: Boolean(game.nearScene.getObjectByName("scanner-well")),
		scannerBezels: game.nearScene.getObjectsByProperty("name", "scanner-bezel")
			.length,
		hologramRings:
			game.nearScene.getObjectByName("scanner-hologram")?.children.length ?? 0,
		hologramContacts:
			game.nearScene.getObjectByName("scanner-contact-glyphs")?.children
				.length ?? 0,
		rangeRingFootprint,
		selectedMastY:
			game.nearScene.getObjectByName(`scanner-contact-mast-${game.targetId}`)
				?.position.y ?? null,
		contacts: game.scannerContacts.length,
		expectedContacts,
		selectedBaseX: game.scannerContacts.find((contact) => contact.selected)
			?.baseXPercent,
		selectedBaseY: game.scannerContacts.find((contact) => contact.selected)
			?.baseYPercent,
		selectedTipOffset: game.scannerContacts.find((contact) => contact.selected)
			?.tipOffsetPx,
		targetDirectorVisible: visible("[data-live-director]"),
		leftPanel: box('[data-live-panel="left"]'),
		rightPanel: box('[data-live-panel="right"]'),
		leftVisible: visible('[data-live-panel="left"]'),
		rightVisible: visible('[data-live-panel="right"]'),
		activePanels: document.querySelectorAll(
			'[data-live-panel][data-active="true"]',
		).length,
		viewport: { width: innerWidth, height: innerHeight },
	};
}

// The guard fingerprints numeric constants. `cockpit.ts` intentionally has no
// such literal contract beyond the imported unit projection, so fingerprint the
// existing renderer and unit surfaces before probing the live DOM it mounts.
await guardedOrigin(ORIGIN, ["src/main.ts", "src/units.ts"]);
const browser = await launchChromium();
const { check, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	page.on("pageerror", (error) =>
		check(`${viewport.name}: no page error (${error.message})`, false),
	);
	await page.goto(`${ORIGIN}/?seed=42`, { waitUntil: "load" });
	await page.waitForFunction(
		() =>
			window.__seelite?.frames > 1 &&
			document.querySelector("[data-live-cockpit]"),
	);
	// Put the selected station at a known ship-local port-bow bearing. This is a
	// live simulation state (not a mock contact) and lets the browser prove that
	// the physical screen honours the same near-field projection as the unit
	// seam. Convert the camera-local literal through the ship quaternion so this
	// stays true for the boot orientation as well as any future one.
	await page.evaluate(() => {
		const game = window.__seelite;
		const target = game.targetId
			? game.world.system.byId.get(game.targetId)
			: null;
		if (!target) throw new Error("expected a selected target");
		const q = game.orientation;
		const local = { x: -1_000, y: 1_000, z: -1_000 };
		const ix = q.w * local.x + q.y * local.z - q.z * local.y;
		const iy = q.w * local.y + q.z * local.x - q.x * local.z;
		const iz = q.w * local.z + q.x * local.y - q.y * local.x;
		const iw = -q.x * local.x - q.y * local.y - q.z * local.z;
		const world = {
			x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
			y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
			z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
		};
		game.world.ship.pos = {
			x: target.pos.x - world.x,
			y: target.pos.y - world.y,
			z: target.pos.z - world.z,
		};
	});
	await page.waitForFunction(() =>
		window.__seelite?.scannerContacts.some((contact) => contact.selected),
	);
	const forward = await page.evaluate(measureLiveCockpit);
	await page.evaluate(() => window.__seelite.setThrottle(0));
	await page.waitForFunction(
		() =>
			window.__seelite.nearScene.getObjectByName("throttle-fill")?.scale.z <
			0.1,
	);
	const throttleClosed = await page.evaluate(measureLiveCockpit);
	await page.evaluate(() => window.__seelite.setThrottle(1));
	await page.waitForFunction(
		() =>
			window.__seelite.nearScene.getObjectByName("throttle-fill")?.scale.z >
			0.99,
	);
	const throttleOpen = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: normal flight uses one Game renderer with a physical cockpit mesh`,
		forward.rendererCount === 1 && forward.cockpitMesh,
		`${forward.rendererCount} non-overlay canvases; cockpit mesh: ${forward.cockpitMesh}`,
	);
	check(
		`${viewport.name}: the one scanner is physically mounted to its lower-centre deck and mirrors true simulation contacts`,
		forward.scannerMounted &&
			forward.contacts === forward.expectedContacts &&
			forward.contacts > 0 &&
			forward.selectedBaseX < 42 &&
			forward.selectedTipOffset > 0,
		`${forward.contacts}/${forward.expectedContacts} live contacts; selected x: ${forward.selectedBaseX}, tip: ${forward.selectedTipOffset}; mounted: ${forward.scannerMounted}`,
	);
	check(
		`${viewport.name}: scanner range rings fit the flattened contact footprint inside the well`,
		forward.rangeRingFootprint.length === 5 &&
			forward.rangeRingFootprint.every(
				(ring) => ring.maxX <= 0.010501 && ring.maxZ <= 0.005201,
			),
		JSON.stringify(forward.rangeRingFootprint.at(-1)),
	);
	check(
		`${viewport.name}: forward view seats live instruments and holographic scanner lines in the physical cockpit`,
		forward.headLook === "forward" &&
			!forward.targetDirectorVisible &&
			forward.physicalInstruments === 3 &&
			forward.throttleFill > 0 &&
			forward.hologramRings >= 7 &&
			forward.hologramContacts === forward.contacts * 2 &&
			!forward.leftVisible &&
			!forward.rightVisible,
		`${forward.physicalInstruments} instruments; ${forward.hologramRings} static lines; ${forward.hologramContacts} live hologram glyphs`,
	);
	check(
		`${viewport.name}: canopy braces, inset scanner well, and full-height throttle read as fitted hardware`,
		forward.canopyHeaderBraces === 2 &&
			forward.scannerWell &&
			forward.scannerBezels === 4 &&
			throttleClosed.throttleFillZ > throttleOpen.throttleFillZ &&
			throttleOpen.throttleFill > 0.99,
		`${forward.canopyHeaderBraces} braces; well: ${forward.scannerWell}; bezels: ${forward.scannerBezels}; throttle z ${throttleClosed.throttleFillZ} → ${throttleOpen.throttleFillZ}`,
	);

	await page.evaluate(() => {
		const game = window.__seelite;
		const target = game.targetId
			? game.world.system.byId.get(game.targetId)
			: null;
		if (!target) throw new Error("expected a selected target");
		const q = game.orientation;
		const local = { x: 0, y: 0, z: 2_500 };
		const ix = q.w * local.x + q.y * local.z - q.z * local.y;
		const iy = q.w * local.y + q.z * local.x - q.x * local.z;
		const iz = q.w * local.z + q.x * local.y - q.y * local.x;
		const iw = -q.x * local.x - q.y * local.y - q.z * local.z;
		const world = {
			x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
			y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
			z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
		};
		game.world.ship.pos = {
			x: target.pos.x - world.x,
			y: target.pos.y - world.y,
			z: target.pos.z - world.z,
		};
	});
	await page.waitForFunction(
		() =>
			window.__seelite.scannerContacts.find((contact) => contact.selected)
				?.baseYPercent > 50,
	);
	const astern = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: a selected station astern remains visible in the scanner lower half`,
		astern.selectedBaseX > 48 &&
			astern.selectedBaseX < 52 &&
			astern.selectedBaseY > 50 &&
			astern.selectedBaseY <= 82,
		`selected x: ${astern.selectedBaseX}; y: ${astern.selectedBaseY}`,
	);

	await page.evaluate(() => {
		const game = window.__seelite;
		const target = game.targetId
			? game.world.system.byId.get(game.targetId)
			: null;
		if (!target) throw new Error("expected a selected target");
		const q = game.orientation;
		const local = { x: -1_000, y: -1_000, z: -1_000 };
		const ix = q.w * local.x + q.y * local.z - q.z * local.y;
		const iy = q.w * local.y + q.z * local.x - q.x * local.z;
		const iz = q.w * local.z + q.x * local.y - q.y * local.x;
		const iw = -q.x * local.x - q.y * local.y - q.z * local.z;
		const world = {
			x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
			y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
			z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
		};
		game.world.ship.pos = {
			x: target.pos.x - world.x,
			y: target.pos.y - world.y,
			z: target.pos.z - world.z,
		};
	});
	await page.waitForFunction(() => {
		const game = window.__seelite;
		const contact = game.scannerContacts.find((item) => item.selected);
		const mast = game.nearScene.getObjectByName(
			`scanner-contact-mast-${game.targetId}`,
		);
		return contact?.tipOffsetPx < 0 && mast?.position.y < 0;
	});
	const below = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: a below-ship target extends its stilt beneath the scan plane`,
		below.selectedTipOffset < 0 && below.selectedMastY < 0,
		`tip: ${below.selectedTipOffset}; mast y: ${below.selectedMastY}`,
	);

	await page.evaluate(() => window.__seelite.setHeadLook("left"));
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-live-cockpit]")
				?.getAttribute("data-live-head-look") === "left",
	);
	const left = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: left head turn reveals only a large Navigation console`,
		left.headLook === "left" &&
			!left.floorVisible &&
			left.leftVisible &&
			!left.rightVisible &&
			left.activePanels === 1 &&
			left.leftPanel?.width > viewport.width * 0.7 &&
			left.leftPanel?.height > 180,
	);

	await page.evaluate(() => window.__seelite.setHeadLook("right"));
	await page.evaluate(() => {
		const tuning = document.querySelector('[data-live-right-tab="Tuning"]');
		if (!(tuning instanceof HTMLElement)) throw new Error("missing Tuning tab");
		tuning.click();
	});
	const right = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: right head turn reveals the readable Tuning console`,
		right.headLook === "right" &&
			!right.floorVisible &&
			right.rightVisible &&
			!right.leftVisible &&
			right.activePanels === 1 &&
			right.rightPanel?.width > viewport.width * 0.7 &&
			right.rightPanel?.height > 180 &&
			(await page.locator("[data-live-tuning]").count()) === 1,
	);
	await page.close();
}

await browser.close();
exit();
