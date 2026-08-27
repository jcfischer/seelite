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
const PIXEL_CHANNEL_TOLERANCE = 3;
const ETA_READOUT =
	/^ETA (?:<1s|\d+(?:\.\d+)?(?:s|min|h|d))  CHARGE \d+\.\d AU$/;
const ETA_READOUT_SOURCE = ETA_READOUT.source;
const VELOCITY_READOUT =
	/^(?:NOSE-LOCKED CRUISE|.+ FRAME · INERTIAL \d+ km\/s)$/;
const VELOCITY_READOUT_SOURCE = VELOCITY_READOUT.source;
const COMBAT_STATUS =
	/^FIRE (?:SAFE|PULSE|BEAM) · LOCK (?:READY|ACQUIRING) · MISSILE (?:WARNING|CLEAR) · INTERDICTION (?:ACTIVE|CLEAR)$/;
const COMBAT_STATUS_SOURCE = COMBAT_STATUS.source;

function textPixelsMatch(canvas, renderedText) {
	if (!canvas || !renderedText) return false;
	const { bounds, text, font, fillStyle, textAlign } = renderedText;
	const context = canvas.getContext("2d");
	if (!context || !bounds || !text) return false;
	const expectedCanvas = document.createElement("canvas");
	expectedCanvas.width = canvas.width;
	expectedCanvas.height = canvas.height;
	const expectedContext = expectedCanvas.getContext("2d");
	const backgroundCanvas = document.createElement("canvas");
	backgroundCanvas.width = canvas.width;
	backgroundCanvas.height = canvas.height;
	const backgroundContext = backgroundCanvas.getContext("2d");
	if (!expectedContext || !backgroundContext) return false;
	if (renderedText.background) {
		expectedContext.fillStyle = renderedText.background;
		expectedContext.fillRect(0, 0, expectedCanvas.width, expectedCanvas.height);
		backgroundContext.fillStyle = renderedText.background;
		backgroundContext.fillRect(
			0,
			0,
			backgroundCanvas.width,
			backgroundCanvas.height,
		);
	}
	expectedContext.font = font;
	expectedContext.fillStyle = fillStyle;
	expectedContext.textAlign = textAlign;
	expectedContext.fillText(text, renderedText.x, renderedText.y);
	const grab = (source) =>
		source.getImageData(bounds.left, bounds.top, bounds.width, bounds.height)
			.data;
	const actual = grab(context);
	const expected = grab(expectedContext);
	const background = grab(backgroundContext);
	let glyphPixels = 0;
	for (let index = 0; index < expected.length; index += 4) {
		const glyphPixel =
			expected[index] !== background[index] ||
			expected[index + 1] !== background[index + 1] ||
			expected[index + 2] !== background[index + 2];
		if (!glyphPixel) continue;
		glyphPixels++;
		if (
			Math.abs(actual[index] - expected[index]) > PIXEL_CHANNEL_TOLERANCE ||
			Math.abs(actual[index + 1] - expected[index + 1]) >
				PIXEL_CHANNEL_TOLERANCE ||
			Math.abs(actual[index + 2] - expected[index + 2]) >
				PIXEL_CHANNEL_TOLERANCE
		) {
			return false;
		}
	}
	return glyphPixels > 0;
}

const PROBE_MATCHERS_SCRIPT = `const PIXEL_CHANNEL_TOLERANCE = ${PIXEL_CHANNEL_TOLERANCE}; globalThis.__seeliteTextPixelsMatch = ${textPixelsMatch}; globalThis.__seeliteMeasureCockpit = ${measureLiveCockpit}; globalThis.__seeliteEtaReadout = new RegExp(${JSON.stringify(ETA_READOUT_SOURCE)}); globalThis.__seeliteVelocityReadout = new RegExp(${JSON.stringify(VELOCITY_READOUT_SOURCE)}); globalThis.__seeliteCombatStatus = new RegExp(${JSON.stringify(COMBAT_STATUS_SOURCE)});`;

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
	const scannerReferenceLine = game.nearScene.getObjectByName(
		"scanner-reference-line",
	);
	const targetInstrumentCanvas = game.cockpit.targetInstrument?.ctx?.canvas;
	const flightInstrumentCanvas = game.cockpit.flightInstrument?.ctx?.canvas;
	const overlayCanvas = document.querySelector("#overlay");
	const referenceLinePoints =
		scannerReferenceLine?.geometry?.getAttribute("position");
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
			) <= game.scannerRangeKm,
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
		rendererIsOnlyVisibleCanvas:
			game.renderer.domElement.parentElement === document.body &&
			document.querySelectorAll("canvas:not(#overlay)").length === 1,
		targetRangeKm: game.targetRange(),
		targetInstrumentSecondaryText: globalThis.__seeliteTextPixelsMatch(
			targetInstrumentCanvas,
			game.cockpit.targetInstrument?.secondaryText,
		),
		cruisePromptText: globalThis.__seeliteTextPixelsMatch(
			overlayCanvas,
			game.cockpitPrompt,
		),
		targetInstrumentSecondaryReadout:
			game.cockpit.targetInstrument?.secondaryText.text,
		flightInstrumentSecondaryText: globalThis.__seeliteTextPixelsMatch(
			flightInstrumentCanvas,
			game.cockpit.flightInstrument?.secondaryText,
		),
		flightInstrumentSecondaryReadout:
			game.cockpit.flightInstrument?.secondaryText.text,
		combatOverlayText: globalThis.__seeliteTextPixelsMatch(
			overlayCanvas,
			game.combatOverlayStatus,
		),
		combatOverlayReadout: game.combatOverlayStatus.text,
		cruisePromptReadout: game.cockpitPrompt.text,
		scannerMounted:
			Boolean(scanner?.visible) &&
			scanner?.parent === deck?.parent &&
			Math.abs(scanner.position.x) < 1e-6 &&
			scannerOffset > 0 &&
			Math.abs(scanner.rotation.x + Math.PI / 2 - pitch) < 1e-6,
		physicalInstruments: [
			"flight-instrument",
			"throttle-track",
			"target-instrument",
		].filter((name) => Boolean(game.nearScene.getObjectByName(name))).length,
		forwardFloor: Boolean(document.querySelector("[data-live-floor]")),
		scannerReferenceLine: referenceLinePoints
			? Array.from({ length: referenceLinePoints.count }, (_, index) => ({
					x: referenceLinePoints.getX(index),
					y: referenceLinePoints.getY(index),
					z: referenceLinePoints.getZ(index),
				}))
			: null,
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
			game.nearScene
				.getObjectByName("scanner-contact-glyphs")
				?.children.filter((glyph) => glyph.visible).length ?? 0,
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

async function placeShipAtLocalOffset(page, local) {
	await page.evaluate((offset) => {
		const game = window.__seelite;
		const target = game.targetId
			? game.world.system.byId.get(game.targetId)
			: null;
		if (!target) throw new Error("expected a selected target");
		const q = game.orientation;
		const ix = q.w * offset.x + q.y * offset.z - q.z * offset.y;
		const iy = q.w * offset.y + q.z * offset.x - q.x * offset.z;
		const iz = q.w * offset.z + q.x * offset.y - q.y * offset.x;
		const iw = -q.x * offset.x - q.y * offset.y - q.z * offset.z;
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
	}, local);
}

// The guard compares top-level numeric declarations in the renderer and unit
// surfaces; scanner projection terms are covered by cockpit's unit tests.
await guardedOrigin(ORIGIN, ["src/main.ts", "src/units.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(`${ORIGIN}/?seed=42`, { waitUntil: "load" });
	await page.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
	await page.waitForFunction(
		() =>
			window.__seelite?.frames > 1 &&
			document.querySelector("[data-live-cockpit]") &&
			globalThis.__seeliteEtaReadout.test(
				window.__seelite.cockpit.targetInstrument.secondaryText.text,
			),
	);
	// Put the selected station at a known ship-local port-bow bearing. This is a
	// live simulation state (not a mock contact) and lets the browser prove that
	// the physical screen honours the same near-field projection as the unit
	// seam. Convert the camera-local literal through the ship quaternion so this
	// stays true for the boot orientation as well as any future one.
	await placeShipAtLocalOffset(page, { x: -1_000, y: 1_000, z: -1_000 });
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
		forward.rendererIsOnlyVisibleCanvas && forward.cockpitMesh,
		`renderer is sole visible canvas: ${forward.rendererIsOnlyVisibleCanvas}; cockpit mesh: ${forward.cockpitMesh}`,
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
			forward.physicalInstruments === 3 &&
			!forward.forwardFloor &&
			forward.targetInstrumentSecondaryText &&
			ETA_READOUT.test(forward.targetInstrumentSecondaryReadout ?? "") &&
			forward.flightInstrumentSecondaryText &&
			VELOCITY_READOUT.test(forward.flightInstrumentSecondaryReadout ?? "") &&
			forward.throttleFill > 0 &&
			forward.hologramRings >= 7 &&
			forward.hologramContacts === forward.contacts * 2 &&
			!forward.leftVisible &&
			!forward.rightVisible,
		`${forward.physicalInstruments} physical instruments; DOM forward floor: ${forward.forwardFloor}; ${forward.hologramRings} static lines; ${forward.hologramContacts} live hologram glyphs`,
	);
	check(
		`${viewport.name}: scanner reference line is a full centred diameter in the scan plane`,
		forward.scannerReferenceLine?.length === 2 &&
			forward.scannerReferenceLine.every(
				(point) => Math.abs(point.x) < 1e-6 && Math.abs(point.y) < 1e-6,
			) &&
			forward.scannerReferenceLine[0].z < -0.00519 &&
			forward.scannerReferenceLine[1].z > 0.00519 &&
			Math.abs(
				forward.scannerReferenceLine[0].z + forward.scannerReferenceLine[1].z,
			) < 1e-6,
		JSON.stringify(forward.scannerReferenceLine),
	);
	check(
		`${viewport.name}: canopy braces, inset scanner well, and full-height throttle read as fitted hardware`,
		forward.canopyHeaderBraces === 2 &&
			forward.scannerWell &&
			forward.scannerBezels === 4 &&
			throttleClosed.throttleFill >= 0.08 &&
			throttleClosed.throttleFill < 0.1 &&
			throttleClosed.throttleFillZ > throttleOpen.throttleFillZ &&
			throttleOpen.throttleFill > 0.99,
		`${forward.canopyHeaderBraces} braces; well: ${forward.scannerWell}; bezels: ${forward.scannerBezels}; throttle z ${throttleClosed.throttleFillZ} → ${throttleOpen.throttleFillZ}`,
	);

	await placeShipAtLocalOffset(page, { x: 0, y: 0, z: 2_500 });
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

	await placeShipAtLocalOffset(page, { x: -1_000, y: -1_000, z: -1_000 });
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

	await placeShipAtLocalOffset(page, { x: -80_000, y: 0, z: -80_000 });
	await page.waitForFunction(() => {
		const game = window.__seelite;
		return (
			game.targetRange() > 3600 * 2 &&
			globalThis.__seeliteEtaReadout.test(
				game.cockpit.targetInstrument.secondaryText.text,
			) &&
			game.cockpitPrompt.text.includes("press J to cruise")
		);
	});
	const distant = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: a distant target renders ETA on its physical panel and cruise guidance on the glass`,
		distant.targetRangeKm > 3600 * 2 &&
			distant.targetInstrumentSecondaryText &&
			distant.cruisePromptText &&
			ETA_READOUT.test(distant.targetInstrumentSecondaryReadout ?? "") &&
			distant.cruisePromptReadout.includes("press J to cruise"),
		`range ${distant.targetRangeKm}; target-panel ${distant.targetInstrumentSecondaryReadout}; prompt ${distant.cruisePromptReadout}; text match ${distant.targetInstrumentSecondaryText}/${distant.cruisePromptText}`,
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
			right.rightVisible &&
			!right.leftVisible &&
			right.activePanels === 1 &&
			right.rightPanel?.width > viewport.width * 0.7 &&
			right.rightPanel?.height > 180 &&
			(await page.locator("[data-live-tuning]").count()) === 1,
	);
	await page.close();
}

// The prototype path adds the laser rig and combat glass; its assertions
// (firing feedback, lock/missile/interdiction status) belong on a dedicated
// combat-mode page so the production viewport loop above stays a production
// check.
const combatPage = await browser.newPage({
	viewport: { width: 1280, height: 760 },
});
watch(combatPage, "prototype combat");
await combatPage.goto(`${ORIGIN}/?seed=42&combat=1`, { waitUntil: "load" });
await combatPage.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
await combatPage.waitForFunction(
	() =>
		window.__seelite?.frames > 1 &&
		globalThis.__seeliteCombatStatus.test(
			window.__seelite.combatOverlayStatus.text,
		),
);
await combatPage.keyboard.press("z");
const warningShown = await combatPage
	.waitForFunction(
		() => window.__seelite.combatOverlayStatus.text.includes("MISSILE WARNING"),
		{ timeout: 5000 },
	)
	.then(
		() => true,
		() => false,
	);
await combatPage.keyboard.press("r");
const warningCleared = await combatPage
	.waitForFunction(
		() =>
			!window.__seelite.combatOverlayStatus.text.includes("MISSILE WARNING"),
		{ timeout: 5000 },
	)
	.then(
		() => true,
		() => false,
	);
check(
	"prototype: Z injects and R clears a missile warning",
	warningShown && warningCleared,
);
const energyBeforePulse = await combatPage.evaluate(
	() => window.__seelite.combat.energy,
);
await combatPage.keyboard.down("Space");
await combatPage.waitForFunction(
	(before) => window.__seelite.combat.energy < before,
	energyBeforePulse,
);
const combatReadout = await combatPage.evaluate(
	() => window.__seelite.combatOverlayStatus.text,
);
const freezeProof = await combatPage.evaluate(async () => {
	const game = window.__seelite;
	game.probeFreezeLoop();
	const frozenAt = game.frames;
	await new Promise((resolve) => setTimeout(resolve, 80));
	const stayedFrozen = game.frames === frozenAt;
	game.render(0);
	return stayedFrozen;
});
check("prototype: frame loop halts while frozen", freezeProof);
const laserTracerPixels = await combatPage.evaluate(() => {
	const game = window.__seelite;
	const overlay = document.querySelector("#overlay");
	const context = overlay.getContext("2d");
	const count = () => {
		const data = context.getImageData(0, 0, overlay.width, overlay.height).data;
		let bright = 0;
		for (let i = 0; i < data.length; i += 4)
			if (data[i] > 100 && data[i + 1] > 180 && data[i + 2] > 200) bright++;
		return bright;
	};
	const shown = count();
	game.probeForceLaserHidden = true;
	game.render(0);
	const hidden = count();
	game.probeForceLaserHidden = false;
	game.render(0);
	return { shown, hidden };
});
const laserPixels = laserTracerPixels.shown - laserTracerPixels.hidden;
const combatOverlayRendered = await combatPage.evaluate(
	() => globalThis.__seeliteMeasureCockpit().combatOverlayText,
);
const resumedFrames = await combatPage.evaluate(async () => {
	const game = window.__seelite;
	const before = game.frames;
	game.probeResumeLoop();
	await new Promise((resolve) => setTimeout(resolve, 80));
	return game.frames - before;
});
check("prototype: frame loop resumes after freeze", resumedFrames > 0);
await combatPage.keyboard.up("Space");
check(
	"prototype: holding Space draws a laser and exposes immediate PULSE feedback on the glass overlay",
	laserPixels > 50 &&
		COMBAT_STATUS.test(combatReadout) &&
		combatReadout.includes("FIRE PULSE") &&
		combatOverlayRendered,
	`${laserPixels} changed pixels, status: ${combatReadout}, overlay glyphs: ${combatOverlayRendered}`,
);
await combatPage.close();

const narrowCombatPage = await browser.newPage({
	viewport: { width: 390, height: 844 },
});
watch(narrowCombatPage, "prototype combat narrow");
await narrowCombatPage.goto(`${ORIGIN}/?seed=42&combat=1`, {
	waitUntil: "load",
});
await narrowCombatPage.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
await narrowCombatPage.waitForFunction(
	() =>
		window.__seelite?.frames > 1 &&
		globalThis.__seeliteCombatStatus.test(
			window.__seelite.combatOverlayStatus.text,
		),
);
const narrowOverlay = await narrowCombatPage.evaluate(() => {
	const game = window.__seelite;
	const status = game.combatOverlayStatus;
	const overlay = document.querySelector("#overlay");
	const context = overlay.getContext("2d");
	context.font = status.font;
	const width = context.measureText(status.text).width;
	const fits = width <= overlay.width - 16;
	const rendered = globalThis.__seeliteMeasureCockpit().combatOverlayText;
	return {
		rendered,
		fits,
		width,
		canvas: overlay.width,
		font: status.font,
		text: status.text,
	};
});
check(
	"prototype: combat overlay renders legibly at the narrow viewport",
	narrowOverlay.rendered && narrowOverlay.fits,
	`${narrowOverlay.width}/${narrowOverlay.canvas} px, font ${narrowOverlay.font}, rendered ${narrowOverlay.rendered}`,
);
await narrowCombatPage.close();

await browser.close();
exit();
