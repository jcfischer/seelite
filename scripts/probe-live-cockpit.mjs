/**
 * The normal game route owns the live cockpit. This is deliberately separate
 * from the gallery probe: it proves the Game's renderer, true world contacts,
 * and head-look states rather than the fixed design fixtures.
 */
import {
	guardedOrigin,
	launchChromium,
	PROBE_WINDOW_VISIBLE,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];
// Canvas text rasterisation differs slightly between Metal and SwiftShader.
const PIXEL_CHANNEL_TOLERANCE = 32;
/**
 * **CHARGE left this line when #92 built Â§5's floor strip.**
 *
 * It read `ETA 795d  CHARGE 12.0 AU` — the drive charge riding the *target*
 * instrument, which made a second consumable with its own regeneration read as
 * a property of the thing being flown to. The strip owns it now. This pattern
 * is what caught the removal: the boot wait below blocks on it, so a build that
 * dropped the text without updating the contract hangs rather than passing.
 */
const ETA_READOUT =
	/^ETA (?:<1s|\d+(?:\.\d+)?(?:s|min|h|d))(?:  REL \d+(?:\.\d+)? km\/s)?$/;
const ETA_READOUT_SOURCE = ETA_READOUT.source;
const VELOCITY_READOUT =
	/^(?:NOSE-LOCKED CRUISE|.+ FRAME · INERTIAL \d+ km\/s)$/;
const VELOCITY_READOUT_SOURCE = VELOCITY_READOUT.source;
const COMBAT_STATUS =
	/^FIRE (?:SAFE|PULSE|BEAM|LOCKED) · H \d+ E \d+ · LOCK (?:READY|ACQ) · MISSILE (?:WARNING|CLEAR) · INTD (?:ACTIVE|CLEAR)$/;
const COMBAT_STATUS_SOURCE = COMBAT_STATUS.source;

/** Two animation frames — a state set from the page runs before the next
 *  draw, so a record read in the same tick describes the frame before it. */
const nextFrames = (target) =>
	target.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);

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
	const inScannerRange = (contact) =>
		Math.hypot(
			contact.pos.x - game.world.ship.pos.x,
			contact.pos.y - game.world.ship.pos.y,
			contact.pos.z - game.world.ship.pos.z,
		) <= game.scannerRangeKm;
	const expectedContacts =
		game.world.system.bodies.filter(inScannerRange).length +
		game.contacts.filter(inScannerRange).length;
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
		targetId: game.targetBody()?.id ?? null,
		targetName: game.targetBody()?.name ?? null,
		directorName:
			document.querySelector("[data-live-director] > strong")?.textContent ??
			null,
		targetInstrumentPrimaryReadout:
			game.cockpit.targetInstrument?.primaryText ?? null,
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
		// `null` on a production page: since #61 the rig exists only under
		// `?combat=1`, so the production run of this measure has no overlay to
		// compare and the combat run below has one. Both call the same function.
		combatOverlayText: game.combatRig
			? globalThis.__seeliteTextPixelsMatch(
					overlayCanvas,
					game.combatRig.overlayStatus,
				)
			: null,
		combatOverlayReadout: game.combatRig?.overlayStatus.text ?? null,
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

await guardedOrigin(ORIGIN);
// macOS compositor throttling makes this rAF-driven visual integration surface
// require a visible window. Ordinary GPU probes remain off-screen.
const browser = await launchChromium({
	channel: "chromium",
	probeWindow: PROBE_WINDOW_VISIBLE,
});
const { check, watch, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.bringToFront();
	await page.goto(gameUrl(ORIGIN, { seed: 42 }), { waitUntil: "load" });
	await page.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
	await page
		.waitForFunction(
			() =>
				window.__seelite?.frames > 1 &&
				document.querySelector("[data-live-cockpit]") &&
				globalThis.__seeliteEtaReadout.test(
					window.__seelite.cockpit.targetInstrument.secondaryText.text,
				),
			undefined,
			{ timeout: 30_000 },
		)
		.catch(async () => {
			const state = await page.evaluate(() => ({
				frames: window.__seelite?.frames ?? null,
				cockpit: Boolean(document.querySelector("[data-live-cockpit]")),
				secondary:
					window.__seelite?.cockpit.targetInstrument.secondaryText.text ?? null,
			}));
			throw new Error(`live cockpit did not settle: ${JSON.stringify(state)}`);
		});
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
		`${viewport.name}: the one scanner is physically mounted to its lower-centre deck and mirrors registered live contacts`,
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
		`${viewport.name}: the HUD target readout and director print the selected name, never its id`,
		astern.targetName &&
			astern.targetName !== astern.targetId &&
			astern.targetInstrumentPrimaryReadout?.startsWith(astern.targetName) &&
			!astern.targetInstrumentPrimaryReadout?.includes(astern.targetId) &&
			astern.directorName === astern.targetName,
		`id ${astern.targetId}; name ${astern.targetName}; instrument ${astern.targetInstrumentPrimaryReadout}; director ${astern.directorName}`,
	);
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

	// ---- §5's flight-floor strip (#92) ------------------------------------

	/**
	 * §4's refusal fill, counted once for every sampler on this page.
	 *
	 * **The green channel is what discriminates it, not the red one.** The first
	 * version asked only that the pixel was red-dominant — `r > 170` and
	 * `r > b + 60` — which the *action* amber `rgba(255,196,110)` satisfies as
	 * comfortably as the refusal `rgba(255,110,96)` does. The CHARGE cell's band
	 * happens to have no amber in it and the check passed for years; §8.3's
	 * course row sits where the target brackets cross, and read 339 amber pixels
	 * in the arm asserting none — the same 339 both before and after the tank
	 * was filled, which is how the two defects were told apart. A sampler that cannot tell §4's two warm tones
	 * apart is not measuring the tone it names.
	 */
	await page.evaluate(() => {
		/**
		 * Read a floor box's own band and count §4's refusal fill in it.
		 *
		 * **The box carries its band.** Both samplers had their own
		 * `Math.floor(box.y) - 12, …, 16` — a glyph height copied out of the
		 * page, which goes lenient the day the type is raised rather than going
		 * red. Every floor box states its `top` and `height` now, so there is no
		 * fallback left to be lenient with: a box without a band is a page that
		 * has changed shape, and it throws rather than sampling a guess.
		 */
		window.__refusalRedInBox = (box) => {
			if (!box) return null;
			const { top, height } = box;
			if (typeof top !== "number" || typeof height !== "number")
				throw new Error("floor box carries no band");
			const overlay = document.getElementById("overlay");
			const ctx = overlay.getContext("2d", { willReadFrequently: true });
			const data = ctx.getImageData(
				Math.floor(box.x),
				Math.floor(top),
				Math.ceil(box.width),
				Math.ceil(height),
			).data;
			return window.__refusalRed(data);
		};
		window.__refusalRed = (data) => {
			let red = 0;
			for (let i = 0; i < data.length; i += 4)
				if (
					data[i + 3] > 40 &&
					data[i] > 170 &&
					data[i + 1] < 150 &&
					data[i] > data[i + 2] + 60
				)
					red++;
			return red;
		};
	});

	/**
	 * Read the strip as painted, plus the sim state each cell is *about*.
	 *
	 * Both halves in one evaluate, on one frame: comparing a record taken now
	 * against a game state read a frame later would be comparing two moments,
	 * and the throttle and charge both move continuously.
	 */
	const readFloor = () =>
		page.evaluate(() => {
			const g = window.__seelite;
			const render = g.floorRender;
			const overlay = document.getElementById("overlay");
			return {
				render,
				widest: g.floorWidest,
				spoolSeconds: g.spoolSeconds,
				overlayHeight: overlay?.height ?? 0,
				// The game's own state, so the check compares the instrument
				// against the simulation rather than against a second copy of
				// the projection that fills it.
				sim: {
					regime: g.regime,
					spoolLeftS: g.spoolLeftS,
					throttle: g.throttle,
					assist: g.assist,
					chargeAu: g.chargeAu,
				},
				prompt: g.cockpitPrompt.text,
			};
		});

	// **Driven to a wide reading, not left at boot.** A full tank prints no
	// regeneration suffix, so a strip measured there is a fifth narrower than
	// the one the pilot sees a second after their first cruise — and the fit
	// check below passed on exactly that while the frame showed both ends
	// clipped at 390 px.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.setThrottle(0.62);
		g.assist = false;
		g.chargeAu = 4.2;
	});
	await nextFrames(page);
	const floor = await readFloor();
	check(
		`${viewport.name}: the floor strip paints §5's four cells, in §5's order`,
		floor.render !== null &&
			floor.render.cells.map((c) => c.label).join(",") ===
				"MODE,THR,ASSIST,CHARGE",
		`${floor.render === null ? "nothing painted" : floor.render.cells.map((c) => `${c.label} ${c.value}`).join(" · ")}`,
	);
	/**
	 * **The scalars the draw was handed are the ship's.**
	 *
	 * The first version restated the projection here — a nested ternary
	 * rebuilding MODE from the regime and the spool — which is the second copy
	 * its own comment said it was avoiding, and it would have drifted silently
	 * the day `flightFloorCells` changed precedence. What the browser can say
	 * that `flight-floor.test.ts` cannot is that the **inputs** were live: the
	 * draw stamps them into the record, and they are compared against the game
	 * handle. The mapping from those inputs to the strings is the headless
	 * tier's, where it is swept.
	 */
	check(
		`${viewport.name}: the strip was drawn from the ship's own state`,
		floor.render !== null &&
			floor.render.source.regime === floor.sim.regime &&
			floor.render.source.spoolLeftS === floor.sim.spoolLeftS &&
			floor.render.source.throttle === floor.sim.throttle &&
			floor.render.source.assist === floor.sim.assist &&
			floor.render.source.chargeAu === floor.sim.chargeAu &&
			// And not a frozen snapshot: the throttle was moved above, so a draw
			// reading a boot-time copy would differ from the handle here.
			floor.sim.throttle > 0.5,
		`drawn from ${JSON.stringify(floor.render?.source)} against ${JSON.stringify(floor.sim)}`,
	);
	/**
	 * Drive every cell to its own widest at once, for the three checks below.
	 *
	 * Where the strip lands is the half a headless test cannot see: §5 puts it
	 * on the persistent floor, the glass ends at `GLASS_BOTTOM_FRACTION`, and
	 * below that is the deck where it would be drawn over the scanner.
	 *
	 * **The fit is solved for the widest reading, so the widest reading is what
	 * has to be on the glass when the assertion fires.** Setting only the charge
	 * left MODE reading `NORMAL` against its bound and THR reading `62%` against
	 * `100%` — five characters never drawn, which is the same surrogate these
	 * checks were rewritten to remove, one layer in.
	 */
	const restore = await page.evaluate(() => {
		const g = window.__seelite;
		const before = {
			throttle: g.throttle,
			assist: g.assist,
			chargeAu: g.chargeAu,
			spoolLeftS: g.spoolLeftS,
		};
		g.setThrottle(1);
		g.assist = false;
		// Below full so the regeneration suffix is there, and two digits of
		// spool. Both drift while the frame renders — the spool counts down and
		// the drive fills — so the check below asserts the *width* each cell was
		// drawn at rather than an exact string it would lose a race with.
		g.chargeAu = 11.9;
		// The sim's own wind-up, not a number chosen here. At `SPOOL_S` every
		// spool reading is one digit, so the countdown between this set and the
		// draw cannot change the width — which is what the assertion below is
		// about. Set to 10.5 it merely had half a second of margin before a
		// character dropped, which widened the race rather than removing it.
		g.spoolLeftS = g.spoolSeconds;
		return before;
	});
	await nextFrames(page);
	const wide = await readFloor();
	await page.evaluate((before) => {
		const g = window.__seelite;
		g.setThrottle(before.throttle);
		g.assist = before.assist;
		g.chargeAu = before.chargeAu;
		g.spoolLeftS = before.spoolLeftS;
	}, restore);
	await nextFrames(page);
	const runEnd = (r) => r.boxes.at(-1).x + r.boxes.at(-1).width;
	// The margin comes off the record rather than being restated here — a
	// second copy of a constant is how a probe goes falsely red on a retune.
	const margin = floor.render?.marginPx ?? 0;
	/**
	 * **Three named checks rather than one fifteen-clause boolean.** A red run
	 * on the single check named the check and not which of its eight properties
	 * broke; these fail one at a time and print only what they are about.
	 */
	check(
		`${viewport.name}: the strip is drawn at every cell's widest reading`,
		wide.render !== null &&
			// Read off the page (`floorWidest`) rather than restated here, and
			// compared by width: the font is monospace, the drive refills
			// between the set and the draw, and at the sim's own `SPOOL_S` every
			// spool reading is the same width.
			wide.render.cells.every(
				(c) => c.value.length === wide.widest[c.label].length,
			) &&
			// The headless tier restates `SPOOL_S`, since it cannot import a
			// module that pulls in Three.js. This is the seam that keeps the two
			// honest.
			wide.spoolSeconds === 3,
		`"${wide.render?.cells.map((c) => c.value).join(" ")}" against bounds "${Object.values(wide.widest ?? {}).join(" ")}", spool ${wide.spoolSeconds}s`,
	);
	check(
		`${viewport.name}: the strip sits inside the glass, above its lower edge`,
		floor.render !== null &&
			floor.render.baselineY < floor.render.glassBottomY &&
			floor.render.baselineY > floor.render.glassBottomY - 26,
		`baseline ${floor.render?.baselineY.toFixed(0)} of a glass bottom ${floor.render?.glassBottomY.toFixed(0)}`,
	);
	check(
		`${viewport.name}: the widest run clears the margins, and the fit is the viewport's`,
		floor.render !== null &&
			wide.render !== null &&
			floor.render.boxes.every((b) => b.x >= margin) &&
			runEnd(floor.render) <= viewport.width - margin &&
			wide.render.boxes.every((b) => b.x >= margin) &&
			runEnd(wide.render) <= viewport.width - margin &&
			// Zero whichever way it could have been non-zero — the legibility
			// clamp binding, or the type size rounding above the linear solve.
			wide.render.overflowPx === 0 &&
			// The fit is a property of the viewport, so it must not have moved
			// between two different readings.
			wide.render.scale === floor.render.scale,
		`runs ${wide.render?.boxes[0].x.toFixed(0)}…${runEnd(wide.render).toFixed(0)} of ${viewport.width} with a ${margin}px margin, at scale ${floor.render?.scale.toFixed(2)}, overflow ${wide.render?.overflowPx.toFixed(1)}px`,
	);

	/**
	 * **The refusal paints, and the passive reading does not.**
	 *
	 * The tone is a field on a record, and a record can say anything — so this
	 * samples the overlay's own pixels inside the CHARGE cell's box and
	 * requires red ones there when the drive is empty and none when it is not.
	 * That is what makes the tone a claim about the glass rather than about a
	 * string.
	 */
	const redInChargeCell = () =>
		page.evaluate(() =>
			window.__refusalRedInBox(
				window.__seelite.floorRender?.boxes.find((b) => b.label === "CHARGE"),
			),
		);
	const redWhenCharged = await redInChargeCell();
	await page.evaluate(() => {
		window.__seelite.chargeAu = 0;
	});
	await nextFrames(page);
	const emptyFloor = await readFloor();
	const redWhenEmpty = await redInChargeCell();
	check(
		`${viewport.name}: an empty drive paints the CHARGE cell as a refusal, and a charged one does not`,
		redWhenCharged === 0 && redWhenEmpty > 20,
		`${redWhenCharged} red pixels charged, ${redWhenEmpty} empty`,
	);
	/**
	 * **And the prompt agrees with it.** Both read `chargeReadsEmpty`; as
	 * `chargeAu <= 0` they disagreed on every frame after a starve-out, because
	 * regeneration lifts the raw value off zero immediately — the strip printed
	 * "0.0/12 AU" in calm cyan while the prompt offered "press J to cruise".
	 * Caught by looking at a captured frame, so it is checked here.
	 */
	check(
		`${viewport.name}: the empty-drive prompt and the CHARGE cell say the same thing`,
		emptyFloor.render?.cells.find((c) => c.label === "CHARGE")?.tone ===
			"refused" &&
			emptyFloor.prompt === "no drive charge — wait for it to regenerate",
		`tone ${emptyFloor.render?.cells.find((c) => c.label === "CHARGE")?.tone}, prompt "${emptyFloor.prompt}"`,
	);

	// The charge the target instrument used to carry is gone from it — asserted
	// on the text rather than only through the boot pattern, so the removal has
	// a check of its own.
	const targetSecondary = await page.evaluate(
		() => window.__seelite.cockpit.targetInstrument.secondaryText.text,
	);
	check(
		`${viewport.name}: the target instrument no longer carries the drive charge`,
		!targetSecondary.includes("CHARGE") && ETA_READOUT.test(targetSecondary),
		`"${targetSecondary}"`,
	);

	// ---- §8.3's course row (#117) -----------------------------------------

	/**
	 * The row is drawn or it is not, and both states are the decision.
	 *
	 * §5.2 / #117 D2 chose absence over a dormant field, which is a claim about
	 * the glass rather than about a string — so this reads the draw's own record,
	 * which is written from what the draw drew, and then reads where the row
	 * landed. A record assembled beside the draw would let this assert a row
	 * that never painted, which is the check-that-cannot-fail this repo has
	 * shipped once already.
	 */
	const restoreFuel = await page.evaluate(() => {
		const g = window.__seelite;
		// Put the drive back: the CHARGE refusal above left it empty, and an
		// empty drive is not what these rows are about.
		g.chargeAu = 11.9;
		g.setCourseTo(null);
		return g.fuelLy;
	});
	await nextFrames(page);
	const noCourse = await page.evaluate(() => {
		const f = window.__seelite.floorRender;
		return {
			// **The floor itself, first.** `f?.courseRow ?? null` is `null` both
			// for a row deliberately not drawn and for a frame with no floor at
			// all — a docked ship, a focused console — so the D2 check cleared
			// on a frame it was never meant to read. That is the control that
			// never runs, in the check whose own docstring warns about it.
			floorPainted: f !== null,
			row: f?.courseRow ?? null,
			box: f?.courseBox ?? null,
		};
	});
	check(
		`${viewport.name}: with no course set, no course row is painted`,
		noCourse.floorPainted === true &&
			noCourse.row === null &&
			noCourse.box === null,
		`floor painted ${noCourse.floorPainted}; row ${JSON.stringify(noCourse.row)}`,
	);

	/**
	 * **A destination the ship is not already at**, so the row reads §8.3's two
	 * facts rather than the arrival state. The index comes off the page's own
	 * galaxy: a probe with its own copy of a system index goes falsely red the
	 * day the generator moves.
	 */
	const committed = await page.evaluate(() => {
		const g = window.__seelite;
		// **A full tank, explicitly.** Read at boot the tank is whatever the
		// session has spent, so the first arm of the refusal check below was
		// measuring a row that was *already* red — the affordable reading has to
		// be reachable before a refusal can be attributed to anything.
		//
		// **Two defects, one reading, and they were told apart by the tone.**
		// The arm asserting no red printed 339 both before and after this line
		// was added, which is the tell: those 339 pixels were never the row.
		// They are the amber target brackets crossing this band, admitted by a
		// red predicate that did not look at the green channel — see
		// `__refusalRed`. What the tank fixed was the *tone*, `refused` to
		// `passive`, and the check asserts that separately now for exactly this
		// reason. Sage caught the two fixes claiming one number as their
		// evidence.
		g.fuelLy = g.fuelCapacityLy;
		const here = g.world.system.record;
		// Every system is routable from every other inside a galaxy (§5 of
		// `galaxy-generation.md`), so the first one that is not this one is a
		// course the commit will accept.
		const elsewhere = g.world.galaxy.systems.find(
			(s) => s.galaxy === here.galaxy && s.index !== here.index,
		);
		return g.commitCourseTo(elsewhere.index);
	});
	await nextFrames(page);
	check(
		`${viewport.name}: the chart's own commit sets a course`,
		committed === true,
		`commitCourseTo returned ${committed}`,
	);
	const courseSet = await page.evaluate(() => {
		const g = window.__seelite;
		const r = g.floorRender;
		return {
			row: r?.courseRow ?? null,
			box: r?.courseBox ?? null,
			baselineY: r?.baselineY ?? null,
			glassBottomY: r?.glassBottomY ?? null,
			marginPx: r?.marginPx ?? 0,
			widest: g.courseWidest,
		};
	});
	check(
		`${viewport.name}: a set course paints §8.3's row, above the strip and inside the glass`,
		courseSet.row !== null &&
			courseSet.box !== null &&
			// Above the strip: a smaller y is higher on the canvas.
			courseSet.box.y < courseSet.baselineY &&
			// And still on the flying glass, not off the top of it.
			courseSet.box.y > 0 &&
			courseSet.box.x >= courseSet.marginPx &&
			courseSet.box.x + courseSet.box.width <=
				viewport.width - courseSet.marginPx &&
			// The widest reading the row can take is what the fit was solved
			// for, read off the page rather than restated here.
			courseSet.row.value.length <= courseSet.widest.length,
		`"${courseSet.row?.label} ${courseSet.row?.value}" at y ${courseSet.box?.y.toFixed(0)} of a strip baseline ${courseSet.baselineY?.toFixed(0)}, bound "${courseSet.widest}"`,
	);

	/**
	 * **And it does not draw on the cruise/jump prompt.**
	 *
	 * The row went into the gap the prompt was sitting in, and the two painted
	 * on one baseline: `COURSE ERBILE 6 jumps` under `press \` to jump to
	 * ERBILE`, both centred, both perfectly recorded. Every record-reading row
	 * above was green through it. Two instruments overlap or they do not, and
	 * that is a question about rectangles rather than about either record — so
	 * this compares them.
	 */
	const stacking = await page.evaluate(() => {
		const g = window.__seelite;
		return {
			prompt: g.cockpitPrompt.text ? { ...g.cockpitPrompt.bounds } : null,
			promptText: g.cockpitPrompt.text,
			courseBox: g.floorRender?.courseBox ?? null,
			// **The row's own band, off the page.** This was `y - 12`, a glyph
			// height the probe kept a copy of — raise the type and the real top
			// rises above it, so the check written to catch this PR's own
			// collision goes lenient without going red.
			courseTop: g.floorRender?.courseBox?.top ?? null,
		};
	});
	check(
		`${viewport.name}: the course row and the cruise prompt do not overlap`,
		stacking.courseBox !== null &&
			// The prompt must actually be drawn, or this asserts nothing.
			stacking.prompt !== null &&
			stacking.courseTop !== null &&
			stacking.prompt.top + stacking.prompt.height <= stacking.courseTop,
		`prompt "${stacking.promptText}" ${stacking.prompt?.top}…${(stacking.prompt?.top ?? 0) + (stacking.prompt?.height ?? 0)} against a course row from ${stacking.courseTop}`,
	);

	/**
	 * **The refusal paints, and the affordable reading does not.**
	 *
	 * #117 D3 gives the row a tone and no sentence of its own, so the only
	 * thing that can be checked about it is the pixels — the same argument the
	 * CHARGE cell's red sampler is built on, and the same sampler shape. The
	 * tank is driven to empty through the handle, which is what makes this the
	 * condition `planJump` actually refuses rather than a second copy of it.
	 */
	const redInCourseRow = () =>
		page.evaluate(() =>
			window.__refusalRedInBox(window.__seelite.floorRender?.courseBox),
		);
	const redWithFuel = await redInCourseRow();
	const fuelledRow = await page.evaluate(
		() => window.__seelite.floorRender?.courseRow ?? null,
	);
	await page.evaluate(() => {
		window.__seelite.fuelLy = 0;
	});
	await nextFrames(page);
	const redWithoutFuel = await redInCourseRow();
	const dryRow = await page.evaluate(
		() => window.__seelite.floorRender?.courseRow ?? null,
	);
	check(
		`${viewport.name}: an unaffordable next hop paints the course row as a refusal`,
		redWithFuel === 0 &&
			redWithoutFuel > 20 &&
			// Named rather than left implicit in the pixel count: an arm that is
			// red for its own reasons reads exactly like the effect not working.
			fuelledRow?.tone === "passive" &&
			dryRow?.tone === "refused" &&
			// And it says nothing extra: the words belong to `planJump` and the
			// prompt, not to this row.
			dryRow?.value === courseSet.row?.value,
		`${redWithFuel} red pixels fuelled (${fuelledRow?.tone}), ${redWithoutFuel} dry (${dryRow?.tone}); "${dryRow?.value}" against "${courseSet.row?.value}"`,
	);

	/**
	 * **And the prompt says the same thing the row does.**
	 *
	 * §5.2 claimed "`planJump` owns those words and §3's prompt prints them"
	 * before it was true: `cruisePrompt` never asked `planJump`, so the glass
	 * offered "press ` to jump to ANDIMA" beside a row this build had already
	 * painted red, and the refusal arrived only after the key was pressed. That
	 * is #92's `chargeReadsEmpty` defect one instrument over, and it is checked
	 * the way that one is — the two halves of one reading, on one frame.
	 */
	const dryPrompt = await page.evaluate(
		() => window.__seelite.cockpitPrompt.text,
	);
	check(
		`${viewport.name}: the prompt and the course row agree about an unaffordable hop`,
		dryRow?.tone === "refused" &&
			// The words are `planJump`'s, through `jumpRefusalText`, so this is
			// the shipped sentence and not a second copy of it.
			/not enough fuel for \S+/.test(dryPrompt),
		`row ${dryRow?.tone}, prompt "${dryPrompt}"`,
	);

	/**
	 * **Arriving leaves the row standing** (#117 D4), ratified as shipped: a
	 * course is player intent, and intent is not cancelled by being satisfied.
	 * A course set to the system the ship is already in is the arrival state by
	 * construction, and `courseProgress` reports it without anything being
	 * stored.
	 */
	await page.evaluate((fuel) => {
		const g = window.__seelite;
		g.fuelLy = fuel;
		g.commitCourseTo(g.world.system.record.index);
	}, restoreFuel);
	await nextFrames(page);
	const arrived = await page.evaluate(() => {
		const g = window.__seelite;
		return {
			row: g.floorRender?.courseRow ?? null,
			here: g.world.system.record.name,
		};
	});
	check(
		`${viewport.name}: arriving leaves the course row standing, reading the destination`,
		arrived.row !== null &&
			arrived.row.value === `${arrived.here} arrived` &&
			arrived.row.tone === "confirmed",
		`"${arrived.row?.value}" (${arrived.row?.tone}) at ${arrived.here}`,
	);
	await page.evaluate(() => window.__seelite.setCourseTo(null));
	await nextFrames(page);

	/**
	 * **The right console's ASSIST and CHARGE rows are no longer empty.**
	 *
	 * §5 gives the Flight console assist and the Drive console the cruise
	 * charge, and the markup has carried both rows since the console was built
	 * — with an empty `<em>`, which reads as a broken instrument rather than an
	 * unbuilt one. They read the strip's own cells, so this is checking one
	 * owner rather than two that happen to agree.
	 */
	await page.evaluate(() => window.__seelite.setHeadLook("right"));
	await nextFrames(page);
	const consoleRows = await page.evaluate(() => {
		const g = window.__seelite;
		const text = (selector) =>
			document.querySelector(selector)?.textContent ?? null;
		return {
			assist: text("[data-live-assist]"),
			charge: text("[data-live-charge]"),
			cells: Object.fromEntries(g.floorCells().map((c) => [c.label, c.value])),
		};
	});
	await page.evaluate(() => window.__seelite.setHeadLook("forward"));
	await nextFrames(page);
	check(
		`${viewport.name}: the right console's assist and charge rows carry the strip's own readings`,
		consoleRows.assist === consoleRows.cells.ASSIST &&
			consoleRows.charge === consoleRows.cells.CHARGE &&
			(consoleRows.assist?.length ?? 0) > 0 &&
			(consoleRows.charge?.length ?? 0) > 0,
		`console "${consoleRows.assist}" / "${consoleRows.charge}" against cells "${consoleRows.cells.ASSIST}" / "${consoleRows.cells.CHARGE}"`,
	);

	// Restore, so the head-look checks below see the state they expect.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.chargeAu = 12;
		g.assist = true;
		g.setThrottle(0);
	});
	await nextFrames(page);

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
await combatPage.goto(gameUrl(ORIGIN, { seed: 42, combat: 1 }), {
	waitUntil: "load",
});
await combatPage.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
await combatPage.waitForFunction(
	() =>
		window.__seelite?.frames > 1 &&
		globalThis.__seeliteCombatStatus.test(
			window.__seelite.combatRig.overlayStatus.text,
		),
);
await combatPage.keyboard.press("/");
const warningShown = await combatPage
	.waitForFunction(
		() =>
			window.__seelite.combatRig.overlayStatus.text.includes("MISSILE WARNING"),
		{ timeout: 5000 },
	)
	.then(
		() => true,
		() => false,
	);
await combatPage.keyboard.press("q");
const warningCleared = await combatPage
	.waitForFunction(
		() =>
			!window.__seelite.combatRig.overlayStatus.text.includes(
				"MISSILE WARNING",
			),
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
// The beam heats up and locks out; the overlay must show the lockout.
// `x`, not `s`: the beam moved off the pitch key when the prototype gained a
// flying enemy, and a probe holding the old key silently tested nothing but
// pitch-down for fifteen seconds before timing out.
await combatPage.keyboard.down("x");
const lockShown = await combatPage
	.waitForFunction(
		() =>
			window.__seelite.combatRig.state.heatLocked &&
			window.__seelite.combatRig.overlayStatus.text.includes("FIRE LOCKED"),
		{ timeout: 15000 },
	)
	.then(
		() => true,
		() => false,
	);
await combatPage.keyboard.up("x");
check("prototype: beam heat lockout is visible on the overlay", lockShown);
await combatPage.keyboard.down("Space");
// The feedback is claimed immediate, so the wait is bounded and fails the
// check if pulse feedback does not appear in time.
const pulseFeedbackShown = await combatPage
	.waitForFunction(
		() => window.__seelite.combatRig.overlayStatus.text.includes("FIRE PULSE"),
		{ timeout: 2000 },
	)
	.then(
		() => true,
		() => false,
	);
check("prototype: pulse feedback appears promptly", pulseFeedbackShown);
const combatReadout = await combatPage.evaluate(
	() => window.__seelite.combatRig.overlayStatus.text,
);
const freezeProof = await combatPage.evaluate(async () => {
	const game = window.__seelite;
	game.combatRig.freezeLoop();
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
	game.combatRig.forceLaserHidden = true;
	game.render(0);
	const hidden = count();
	game.combatRig.forceLaserHidden = false;
	game.render(0);
	return { shown, hidden };
});
const laserPixels = laserTracerPixels.shown - laserTracerPixels.hidden;
const beamVisible = await combatPage.evaluate(() => {
	const game = window.__seelite;
	const laser = game.nearScene.getObjectByName("combat-prototype-laser");
	return laser?.visible === true;
});
const combatOverlayPixels = await combatPage.evaluate(() => {
	const game = window.__seelite;
	const rig = game.combatRig;
	const canvas = document.querySelector("#overlay");
	const context = canvas.getContext("2d");
	const { left, top, width, height } = rig.overlayStatus.bounds;
	const read = () => context.getImageData(left, top, width, height).data;
	const drawOverlay = rig.drawOverlay;
	rig.drawOverlay = () => {};
	game.render(0);
	const withoutStatus = read();
	rig.drawOverlay = drawOverlay;
	game.render(0);
	const withStatus = read();
	let changed = 0;
	for (let i = 0; i < withStatus.length; i += 4)
		if (
			withStatus[i] !== withoutStatus[i] ||
			withStatus[i + 1] !== withoutStatus[i + 1] ||
			withStatus[i + 2] !== withoutStatus[i + 2]
		)
			changed++;
	return changed;
});
const combatOverlayRendered = combatOverlayPixels > 20;
/**
 * How long to watch for frames after resuming.
 *
 * **800 ms, and it was 150.** This is a liveness check — does `rAF` re-arm —
 * but at 150 ms its `delta > 2` was also a frame-rate assertion, and one this
 * page cannot reliably meet: measured on the combat page under SwiftShader,
 * `frames` advances 3 in 150 ms and 10–11 in a second, so the threshold needed
 * the *median* exactly and flipped on jitter. #99's rig pushed the same page
 * about 15% slower headless (probe wall time 27 s → 31 s) and the check began
 * failing roughly one run in three, on a change whose measured cost on the
 * player's renderer is a quarter of a millisecond a frame.
 *
 * Widening the window costs 650 ms and gives up nothing the check was for: a
 * loop that did not re-arm produces **zero** frames over any window, so the
 * defect it names still fails it — verified by returning early from
 * `resumeLoop`. What it stops asserting is a frame rate on a software
 * rasteriser, which is a number #98 already settled is nobody's.
 */
const RESUME_WATCH_MS = 800;
const resumedFrames = await combatPage.evaluate(async (watchMs) => {
	const game = window.__seelite;
	const before = game.frames;
	game.combatRig.resumeLoop();
	// Sample after the synchronous resume call so its own rendered frame does
	// not count; then require several more to prove rAF is re-arming.
	const afterResume = game.frames;
	await new Promise((resolve) => setTimeout(resolve, watchMs));
	return { delta: game.frames - afterResume, sync: afterResume - before };
}, RESUME_WATCH_MS);
check(
	"prototype: frame loop keeps running after resume",
	resumedFrames.delta > 2,
);
await combatPage.keyboard.up("Space");
check(
	"prototype: holding Space shows the weapon tracer, draws it on the glass and exposes immediate PULSE feedback",
	beamVisible &&
		laserPixels > 50 &&
		COMBAT_STATUS.test(combatReadout) &&
		combatReadout.includes("FIRE PULSE") &&
		combatOverlayRendered,
	`beam: ${beamVisible}, ${laserPixels} tracer pixels, status: ${combatReadout}, overlay pixels: ${combatOverlayPixels}`,
);
/**
 * The striker's fire, on the canopy.
 *
 * **The check this replaces could not have failed.** Incoming fire was a
 * `THREE.Line` from the striker's hull to the origin of the near scene — where
 * the camera is — so it was `visible`, it was in the scene graph, and it drew
 * nothing at all: both ends projected to one screen point, and the far one to
 * `NaN`, because a point at the eye has no projection. Every flag said yes and
 * the player saw no shots for the life of the branch.
 *
 * So this asserts *screen* extent rather than existence: a live bolt has to
 * project inside the viewport, at a position measurably away from the striker
 * that fired it. The control **moves every head behind the camera** and requires
 * the count to fall to zero, so a measurement that was reading the hull, the
 * reticle or the star field cannot pass it. See the code comment below for why
 * it is neither `visible = false` nor a zeroed buffer: one leaves the positions
 * untouched and the other is skipped by the counter itself.
 */
const incoming = await combatPage.evaluate(async () => {
	const game = window.__seelite;
	const bolts = game.nearScene.getObjectByName("combat-prototype-enemy-laser");
	const heads = game.nearScene.getObjectByName("combat-prototype-enemy-bolts");
	const hull = game.nearScene.getObjectByName("combat-prototype-target");
	if (!bolts || !heads || !hull) return { found: false };
	const V = bolts.position.constructor;
	const camera = game.nearCamera;
	/** Live bolt heads projecting inside the viewport, clear of the striker. */
	const onCanopy = () => {
		const at = heads.geometry.getAttribute("position");
		const striker = new V(
			hull.position.x,
			hull.position.y,
			hull.position.z,
		).project(camera);
		let clear = 0;
		for (let i = 0; i < at.count; i++) {
			const x = at.getX(i);
			const y = at.getY(i);
			const z = at.getZ(i);
			// A retired bolt is collapsed onto the camera and draws nothing.
			if (x === 0 && y === 0 && z === 0) continue;
			const p = new V(x, y, z).project(camera);
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
			if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) continue;
			if (Math.hypot(p.x - striker.x, p.y - striker.y) > 0.02) clear++;
		}
		return clear;
	};
	let best = 0;
	let firingSeen = false;
	const until = Date.now() + 25_000;
	while (Date.now() < until && best === 0) {
		await new Promise((resolve) => requestAnimationFrame(resolve));
		firingSeen ||= game.combatRig.state.enemyFiring !== null;
		best = Math.max(best, onCanopy());
	}
	// The control, and it has to touch the buffer rather than `visible`: hiding
	// the objects leaves their positions exactly as they were, so a count taken
	// off the geometry would be unchanged and the control would pass over a
	// measurement that was reading something else entirely.
	//
	// **It moves the heads behind the camera rather than zeroing them**, and the
	// difference is whether the control can fail at all. `onCanopy` skips a head
	// at the origin, because that is how the renderer retires one — so zeroing
	// the buffer made `empty === 0` true *by construction*, and a counter that
	// had stopped checking the viewport bounds entirely would still have passed
	// it. Behind the camera the heads are non-zero, so the zero skip does not
	// fire and the count has to fall to zero through the `p.z > 1` test, which
	// is the test the live measurement depends on.
	//
	// **Taken off the camera, not off a world axis.** These positions are
	// camera-*relative* but world-*oriented*, and the near camera is rotated by
	// the boot facing, so a fixed `(0, 0, 1000)` is only behind the eye on a
	// facing that happens to look down world −z; on the opposite facing it is
	// 1,000 km in front, inside `NEAR_FAR_KM` (2e4), and the control would count
	// it and fail a correct build. A thousand kilometres is well inside the near
	// camera's far plane (`NEAR_FAR_KM`), which is the point: the control tests
	// the frustum's *back*, not its range. The buffer is rewritten from the bolt
	// pool on the next frame either way.
	const behind = camera.getWorldDirection(new V()).multiplyScalar(-1000);
	const at = heads.geometry.getAttribute("position");
	for (let i = 0; i < at.count; i++) at.setXYZ(i, behind.x, behind.y, behind.z);
	const empty = onCanopy();
	return { found: true, firingSeen, onCanopy: best, empty };
});
check(
	"prototype: the striker's fire reaches the canopy, clear of the ship that fired it",
	incoming.found &&
		incoming.firingSeen &&
		incoming.onCanopy > 0 &&
		incoming.empty === 0,
	`${incoming.onCanopy} bolts on canopy, ${incoming.empty} with none in the air, striker fired ${incoming.firingSeen}`,
);
await combatPage.close();

const narrowCombatPage = await browser.newPage({
	viewport: { width: 390, height: 844 },
});
watch(narrowCombatPage, "prototype combat narrow");
await narrowCombatPage.goto(gameUrl(ORIGIN, { seed: 42, combat: 1 }), {
	waitUntil: "load",
});
await narrowCombatPage.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
await narrowCombatPage.waitForFunction(
	() =>
		window.__seelite?.frames > 1 &&
		globalThis.__seeliteCombatStatus.test(
			window.__seelite.combatRig.overlayStatus.text,
		),
);
const narrowOverlay = await narrowCombatPage.evaluate(() => {
	const game = window.__seelite;
	const overlay = document.querySelector("#overlay");
	// The game exposes the four overlay lines it actually drew, at the font
	// each was fitted to; assert on those rather than reimplementing the fitter.
	const lines = game.combatRig.overlayLines;
	const fits =
		lines.length === 4 &&
		lines.every((line) => line.width <= overlay.width - 16) &&
		game.combatRig.statusWorstWidth > 0 &&
		game.combatRig.statusWorstWidth <= overlay.width - 16;
	const rendered = globalThis.__seeliteMeasureCockpit().combatOverlayText;
	return {
		rendered,
		fits,
		canvas: overlay.width,
		count: lines.length,
		worst: game.combatRig.statusWorstWidth,
	};
});
check(
	"prototype: all combat overlay lines fit the narrow viewport",
	narrowOverlay.rendered && narrowOverlay.fits,
	`canvas ${narrowOverlay.canvas}px, rendered ${narrowOverlay.rendered}`,
);
await narrowCombatPage.close();

await browser.close();
exit();
