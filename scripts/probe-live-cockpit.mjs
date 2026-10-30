import { installCockpitTextProbe } from "./lib/cockpit-text-probe.mjs";
/**
 * The normal game route owns the live cockpit. This is deliberately separate
 * from the gallery probe: it proves the Game's renderer, true world contacts,
 * and head-look states rather than the fixed design fixtures.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	PROBE_WINDOW_VISIBLE,
	tally,
} from "./probe-guard.mjs";
import { installCompositeFrame } from "./lib/composite-frame.mjs";
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
	const scanner = game.cabinScene.getObjectByName("scanner");
	const scannerReferenceLine = game.cabinScene.getObjectByName(
		"scanner-reference-line",
	);
	const targetInstrumentCanvas = game.cockpit.targetInstrument?.ctx?.canvas;
	const flightInstrumentCanvas = game.cockpit.flightInstrument?.ctx?.canvas;
	const overlayCanvas = document.querySelector("#overlay");
	const referenceLinePoints =
		scannerReferenceLine?.geometry?.getAttribute("position");
	/**
	 * How a drawn live face sits on the authored screen it belongs on (#792),
	 * read off the face's own vertices in the screen's plane. The centre
	 * offset is close to construction — the face sits at its mount's origin,
	 * and the mount is placed at the quad's centre — so it guards only a face
	 * moved inside its mount. `inside` and `fill` are the independent part:
	 * every face corner within the quad, and the binding side filled, which a
	 * mis-scaled or mis-oriented face fails.
	 */
	const faceFit = (screenName, faceName) => {
		const quad = game.cabinScene.getObjectByName(`screen-${screenName}`);
		const face = game.cabinScene.getObjectByName(faceName);
		if (!quad || !face) return null;
		const worldCorners = (object) => {
			object.updateWorldMatrix(true, false);
			const e = object.matrixWorld.elements;
			const position = object.geometry.getAttribute("position");
			const out = [];
			for (let i = 0; i < position.count; i++) {
				const [x, y, z] = [
					position.getX(i),
					position.getY(i),
					position.getZ(i),
				];
				out.push([
					e[0] * x + e[4] * y + e[8] * z + e[12],
					e[1] * x + e[5] * y + e[9] * z + e[13],
					e[2] * x + e[6] * y + e[10] * z + e[14],
				]);
			}
			return out;
		};
		const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
		const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
		const len = (a) => Math.hypot(...a);
		const q = worldCorners(quad);
		const uv = quad.geometry.getAttribute("uv");
		const at = (u, v) => {
			for (let i = 0; i < uv.count; i++)
				if (Math.abs(uv.getX(i) - u) < 1e-3 && Math.abs(uv.getY(i) - v) < 1e-3)
					return q[i];
			return null;
		};
		const topLeft = at(0, 0);
		const topRight = at(1, 0);
		const bottomLeft = at(0, 1);
		// A re-exported quad with shifted texture coordinates reads as a
		// missing fit, not as a crash of the whole measurement.
		if (!topLeft || !topRight || !bottomLeft) return null;
		const across = sub(topRight, topLeft);
		const upward = sub(topLeft, bottomLeft);
		const width = len(across);
		const height = len(upward);
		const right = across.map((c) => c / width);
		const up = upward.map((c) => c / height);
		const centre = [0, 1, 2].map(
			(k) => q.reduce((s, c) => s + c[k], 0) / q.length,
		);
		const inPlane = (p) => {
			const d = sub(p, centre);
			return [dot(d, right), dot(d, up)];
		};
		const f = worldCorners(face).map(inPlane);
		const fx = f.map((c) => c[0]);
		const fy = f.map((c) => c[1]);
		const faceCentre = [
			(Math.max(...fx) + Math.min(...fx)) / 2,
			(Math.max(...fy) + Math.min(...fy)) / 2,
		];
		return {
			visible: face.visible && face.parent?.visible !== false,
			offset: Math.hypot(...faceCentre) / Math.hypot(width, height),
			inside: f.every(
				// Relative: the vertices are float32, so a face that binds a side
				// meets its edge to about 1e-7 of the screen, not to 1e-9 km.
				([x, y]) =>
					Math.abs(x) <= (width / 2) * (1 + 1e-6) &&
					Math.abs(y) <= (height / 2) * (1 + 1e-6),
			),
			fill: Math.max(
				(Math.max(...fx) - Math.min(...fx)) / width,
				(Math.max(...fy) - Math.min(...fy)) / height,
			),
		};
	};
	const fitted = (fit) =>
		fit
			? {
					...fit,
					ok: fit.visible && fit.offset < 1e-3 && fit.inside && fit.fill > 0.99,
				}
			: null;
	const inScannerRange = (contact) =>
		Math.hypot(
			contact.pos.x - game.world.ship.pos.x,
			contact.pos.y - game.world.ship.pos.y,
			contact.pos.z - game.world.ship.pos.z,
		) <= game.scannerRangeKm;
	const expectedContacts =
		game.world.system.bodies.filter(inScannerRange).length +
		game.contacts.filter(inScannerRange).length;
	const rangeRingFootprint = game.cabinScene
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
		cockpitMesh: Boolean(game.cabinScene.getObjectByName("cockpit")?.visible),
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
		cruisePromptText:
			game.view === "cockpit"
				? globalThis.__cockpitSourcePainted("prompt")
				: globalThis.__seeliteTextPixelsMatch(
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
			? globalThis.__cockpitSourcePainted("prototype-combat")
			: null,
		combatOverlayReadout: game.combatRig?.overlayStatus.text ?? null,
		cruisePromptReadout: game.cockpitPrompt.text,
		scannerMounted:
			Boolean(scanner?.visible) &&
			scanner?.parent?.name === "scanner-mount" &&
			Math.abs(scanner.position.x) < 1e-6 &&
			scanner.position.y > 0 &&
			Math.abs(scanner.rotation.x + Math.PI / 2) < 1e-6 &&
			Boolean(fitted(faceFit("radar", "scanner"))?.ok),
		physicalInstruments: [
			"flight-instrument",
			"throttle-track",
			"target-instrument",
		].filter((name) => Boolean(game.cabinScene.getObjectByName(name))).length,
		forwardFloor: Boolean(document.querySelector("[data-live-floor]")),
		scannerReferenceLine: referenceLinePoints
			? Array.from({ length: referenceLinePoints.count }, (_, index) => ({
					x: referenceLinePoints.getX(index),
					y: referenceLinePoints.getY(index),
					z: referenceLinePoints.getZ(index),
				}))
			: null,
		throttleFill:
			game.cabinScene.getObjectByName("throttle-fill")?.scale.z ?? 0,
		throttleFillZ:
			game.cabinScene.getObjectByName("throttle-fill")?.position.z ?? 0,
		authoredCockpit: Boolean(
			game.cabinScene.getObjectByName("authored-cockpit"),
		),
		faceFits: [
			fitted(faceFit("radar", "scanner")),
			fitted(faceFit("flight", "flight-instrument")),
			fitted(faceFit("target", "target-instrument")),
		],
		hologramRings:
			game.cabinScene.getObjectByName("scanner-hologram")?.children.length ?? 0,
		hologramContacts:
			game.cabinScene
				.getObjectByName("scanner-contact-glyphs")
				?.children.filter((glyph) => glyph.visible).length ?? 0,
		rangeRingFootprint,
		selectedMastY:
			game.cabinScene.getObjectByName(`scanner-contact-mast-${game.targetId}`)
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
	await installCockpitTextProbe(page);
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
			window.__seelite.cabinScene.getObjectByName("throttle-fill")?.scale.z <
			0.1,
	);
	const throttleClosed = await page.evaluate(measureLiveCockpit);
	await page.evaluate(() => window.__seelite.setThrottle(1));
	await page.waitForFunction(
		() =>
			window.__seelite.cabinScene.getObjectByName("throttle-fill")?.scale.z >
			0.99,
	);
	const throttleOpen = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: normal flight uses one Game renderer with a physical cockpit mesh`,
		forward.rendererIsOnlyVisibleCanvas && forward.cockpitMesh,
		`renderer is sole visible canvas: ${forward.rendererIsOnlyVisibleCanvas}; cockpit mesh: ${forward.cockpitMesh}`,
	);
	check(
		`${viewport.name}: the one scanner is mounted on the authored scope screen and mirrors registered live contacts`,
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
		`${viewport.name}: the scope, flight and navigation screens carry their live faces, and the throttle reads as fitted hardware`,
		forward.authoredCockpit &&
			forward.faceFits.every((fit) => fit?.ok) &&
			throttleClosed.throttleFill >= 0.08 &&
			throttleClosed.throttleFill < 0.1 &&
			throttleClosed.throttleFillZ > throttleOpen.throttleFillZ &&
			throttleOpen.throttleFill > 0.99,
		`authored cabin: ${forward.authoredCockpit}; faces ${forward.faceFits.map((f) => (f ? `off ${f.offset.toExponential(1)} of a diagonal, inside ${f.inside}, fill ${f.fill.toFixed(3)}, visible ${f.visible}` : "missing")).join("; ")}; throttle z ${throttleClosed.throttleFillZ} → ${throttleOpen.throttleFillZ}`,
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
		const mast = game.cabinScene.getObjectByName(
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
			game.cockpitPrompt.text.includes("press j to cruise")
		);
	});
	const distant = await page.evaluate(measureLiveCockpit);
	check(
		`${viewport.name}: a distant target renders ETA on its physical panel and cruise guidance on its cabin face`,
		distant.targetRangeKm > 3600 * 2 &&
			distant.targetInstrumentSecondaryText &&
			distant.cruisePromptText &&
			ETA_READOUT.test(distant.targetInstrumentSecondaryReadout ?? "") &&
			distant.cruisePromptReadout.includes("press j to cruise"),
		`range ${distant.targetRangeKm}; target-panel ${distant.targetInstrumentSecondaryReadout}; prompt ${distant.cruisePromptReadout}; text match ${distant.targetInstrumentSecondaryText}/${distant.cruisePromptText}`,
	);

	const physicalReadouts = await page.evaluate(() => {
		const g = window.__seelite;
		const readings = g.cockpit.text.readings;
		const fallback = g.cockpit.text.faces.get("fallback");
		const position = fallback.mount.position.clone();
		fallback.mount.position.addScaledVector(fallback.frame.normal, -0.1);
		const occlusionDetected = !window.__cockpitSurfaceVisible("prompt");
		fallback.mount.position.copy(position);
		return {
			status: window.__cockpitSourcePainted("status"),
			lasers: window.__cockpitSourcePainted("lasers"),
			prompt: window.__cockpitSourcePainted("prompt"),
			values: g
				.floorCells()
				.every((c) =>
					readings
						.get("status")
						?.some((line) => line.text.includes(c.label + " " + c.value)),
				),
			glassFloorAbsent: g.floorRender === null,
			glassClear: window.__cockpitNoReadoutsOnGlass(),
			statusVisible: window.__cockpitSurfaceVisible("status"),
			occlusionDetected,
			promptVisible: window.__cockpitSurfaceVisible("prompt"),
			lasersVisible: window.__cockpitSurfaceVisible("lasers"),
		};
	});
	check(
		`${viewport.name}: the cockpit paints its live status, laser and guidance on cabin faces`,
		Object.values(physicalReadouts).every(Boolean),
		JSON.stringify(physicalReadouts),
	);

	for (const state of [
		{ throttle: 0.62, assist: false, charge: 4.2, spool: 0, jump: 0 },
		{ throttle: 1, assist: false, charge: 11.9, spool: 3, jump: 0 },
		{ throttle: 0, assist: true, charge: 0, spool: 0, jump: 0 },
		{ throttle: 0, assist: true, charge: 12, spool: 0, jump: 2.3 },
	]) {
		const actual = await page.evaluate((state) => {
			const g = window.__seelite;
			g.setThrottle(state.throttle);
			g.assist = state.assist;
			g.chargeAu = state.charge;
			g.spoolLeftS = state.spool;
			g.jumpCharge = { ...g.jumpCharge, leftS: state.jump };
			g.render(0);
			const lines = g.cockpit.text.readings.get("status") ?? [];
			return {
				painted: window.__cockpitSourcePainted("status"),
				values: g
					.floorCells()
					.every((c) =>
						lines.some((l) => l.text.includes(c.label + " " + c.value)),
					),
				glass: g.floorRender === null,
			};
		}, state);
		check(
			`${viewport.name}: status surface follows ${JSON.stringify(state)}`,
			Object.values(actual).every(Boolean),
			JSON.stringify(actual),
		);
	}
	await page.evaluate(() => {
		const g = window.__seelite;
		g.spoolLeftS = 0;
		g.jumpCharge = { ...g.jumpCharge, leftS: 0 };
		g.render(0);
	});

	const chargeRefusal = await page.evaluate(() => {
		const g = window.__seelite;
		const restore = g.chargeAu;
		const promptText = () =>
			(g.cockpit.text.readings.get("prompt") ?? [])
				.map((l) => l.text)
				.join(" ");
		g.chargeAu = 12;
		g.render(0);
		const charged = window.__cockpitRefusalRed("status");
		g.chargeAu = 0;
		g.render(0);
		const result = {
			charged,
			empty: window.__cockpitRefusalRed("status"),
			tone: g.floorCells().find((c) => c.label === "CHARGE")?.tone,
			prompt: promptText(),
			target: g.cockpit.targetInstrument?.secondaryText.text ?? "",
		};
		g.chargeAu = restore;
		g.render(0);
		return result;
	});
	check(
		`${viewport.name}: an empty drive paints the CHARGE cell as a refusal on the status surface, and a charged one does not`,
		chargeRefusal.charged === 0 &&
			chargeRefusal.empty > 20 &&
			chargeRefusal.tone === "refused",
		JSON.stringify(chargeRefusal),
	);
	check(
		`${viewport.name}: the empty-drive prompt and the CHARGE cell say the same thing`,
		chargeRefusal.tone === "refused" &&
			chargeRefusal.prompt.includes(
				"no drive charge — wait for it to regenerate",
			),
		JSON.stringify(chargeRefusal),
	);
	check(
		`${viewport.name}: the target instrument no longer carries the drive charge`,
		!chargeRefusal.target.includes("CHARGE") &&
			ETA_READOUT.test(chargeRefusal.target),
		`"${chargeRefusal.target}"`,
	);

	const courseRefusal = await page.evaluate(async () => {
		const g = window.__seelite;
		const { courseCue } = await import("/src/cockpit.ts");
		const reading = (source) =>
			(g.cockpit.text.readings.get(source) ?? []).map((l) => l.text).join(" ");
		const cue = () => courseCue(g.courseCueState());
		const fuel = g.fuelLy;
		const charge = g.chargeAu;
		g.chargeAu = 11.9;
		g.setCourseTo(null);
		g.render(0);
		const none = {
			cue: cue(),
			course: reading("course"),
			status: window.__cockpitSourcePainted("status"),
		};
		g.fuelLy = g.fuelCapacityLy;
		const here = g.world.system.record;
		const elsewhere = g.world.galaxy.systems.find(
			(s) => s.galaxy === here.galaxy && s.index !== here.index,
		);
		const committed = g.commitCourseTo(elsewhere.index);
		g.render(0);
		const fuelled = {
			red: window.__cockpitRefusalRed("course"),
			painted: window.__cockpitSourcePainted("course"),
			course: reading("course"),
			tone: cue()?.tone,
		};
		g.fuelLy = 0;
		g.render(0);
		const dry = {
			red: window.__cockpitRefusalRed("course"),
			painted: window.__cockpitSourcePainted("course"),
			course: reading("course"),
			tone: cue()?.tone,
			prompt: reading("prompt"),
		};
		g.fuelLy = fuel;
		g.commitCourseTo(here.index);
		g.render(0);
		const arrived = {
			course: reading("course"),
			painted: window.__cockpitSourcePainted("course"),
			cue: cue(),
			here: here.name,
		};
		g.setCourseTo(null);
		g.chargeAu = charge;
		g.render(0);
		return { none, committed, fuelled, dry, arrived };
	});
	check(
		`${viewport.name}: with no course set, no course row is painted`,
		courseRefusal.none.status &&
			courseRefusal.none.cue === null &&
			courseRefusal.none.course === "",
		JSON.stringify(courseRefusal.none),
	);
	check(
		`${viewport.name}: an unaffordable next hop paints the course row as a refusal`,
		courseRefusal.committed === true &&
			courseRefusal.fuelled.painted &&
			courseRefusal.fuelled.tone === "passive" &&
			courseRefusal.fuelled.red === 0 &&
			courseRefusal.dry.painted &&
			courseRefusal.dry.tone === "refused" &&
			courseRefusal.dry.red > 20 &&
			courseRefusal.dry.course === courseRefusal.fuelled.course,
		JSON.stringify(courseRefusal),
	);
	check(
		`${viewport.name}: the prompt and the course row agree about an unaffordable hop`,
		courseRefusal.dry.tone === "refused" &&
			/not enough fuel for \S+/.test(courseRefusal.dry.prompt),
		JSON.stringify(courseRefusal.dry),
	);
	check(
		`${viewport.name}: arriving leaves the course row standing, reading the destination`,
		courseRefusal.arrived.painted &&
			courseRefusal.arrived.cue?.value ===
				`${courseRefusal.arrived.here} arrived` &&
			courseRefusal.arrived.cue?.tone === "confirmed" &&
			courseRefusal.arrived.course.includes(courseRefusal.arrived.cue.value),
		JSON.stringify(courseRefusal.arrived),
	);

	await page.evaluate(() => window.__seelite.setHeadLook("right"));
	await nextFrames(page);
	const turnedStatus = await page.evaluate(() =>
		window.__cockpitSourcePainted("status"),
	);
	check(
		`${viewport.name}: authored readouts remain powered while looking toward another cabin surface`,
		turnedStatus,
	);
	await page.evaluate(() => window.__seelite.setHeadLook("forward"));
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

const fixturePage = await browser.newPage({
	viewport: { width: 1440, height: 900 },
});
watch(fixturePage, "alternate cabin");
await fixturePage.goto(
	gameUrl(ORIGIN, {
		seed: 0x5ee11e,
		system: 173,
		hull: "miner",
		mining: 1,
		raider: "off",
	}),
);
await bootedGame(fixturePage, 90000);
await installCockpitTextProbe(fixturePage);
await fixturePage.addScriptTag({ content: PROBE_MATCHERS_SCRIPT });
const alternate = await fixturePage.evaluate(async () => {
	const { GLTFLoader } = await import(
		"/node_modules/three/examples/jsm/loaders/GLTFLoader.js"
	);
	const { adoptCockpitTemplate } = await import("/src/cockpit-model.ts");
	const { Vector3 } = await import("/node_modules/three/build/three.module.js");
	const model = await new GLTFLoader().loadAsync(
		"/scripts/fixtures/cockpit-text-cabin.glb",
	);
	const g = window.__seelite;
	g.cabinScene.remove(g.cockpit.mesh);
	adoptCockpitTemplate(model.scene);
	g.buildCockpit();
	g.setHeadLook("forward");
	const field = g.fields[0];
	if (field?.rocks[0])
		g.targetId = `rock:${field.plan.id}:${field.rocks[0].slot}`;
	g.render(0);
	g.updateCockpit();
	g.render(0);
	const scanner = g.cabinScene.getObjectByName("scanner");
	let scannerInside = true;
	g.cockpit.hologram.root.updateWorldMatrix(true, true);
	g.cockpit.hologram.root.traverse((object) => {
		const positions = object.geometry?.getAttribute("position");
		if (!positions) return;
		for (let i = 0; i < positions.count; i++) {
			const point = scanner.worldToLocal(
				object.localToWorld(new Vector3().fromBufferAttribute(positions, i)),
			);
			if (
				Math.abs(point.x) > scanner.geometry.parameters.width / 2 + 1e-8 ||
				Math.abs(point.y) > scanner.geometry.parameters.height / 2 + 1e-8
			)
				scannerInside = false;
		}
	});

	return {
		scannerInside,
		ore: window.__cockpitSourcePainted("ore"),
		survey: window.__cockpitSourcePainted("survey"),
		oreVisible: window.__cockpitSurfaceVisible("ore"),
		surveyVisible: window.__cockpitSurfaceVisible("survey"),
		noGlass: window.__cockpitNoReadoutsOnGlass(),
		missingFlight: !g.cabinScene.getObjectByName("screen-flight"),
		statusVisible: window.__cockpitSurfaceVisible("status"),
		flightVisible: window.__cockpitSurfaceVisible("flight"),
		flightFallback: window.__seeliteTextPixelsMatch(
			g.cockpit.flightInstrument.ctx.canvas,
			g.cockpit.flightInstrument.secondaryText,
		),
		unpowered:
			g.cabinScene.getObjectByName("screen-systems")?.material.map === null,
	};
});
check(
	"an alternate cabin places survey and portrait ore on their own screens, falls back for flight and leaves systems unpowered",
	Object.values(alternate).every(Boolean),
	JSON.stringify(alternate),
);
await fixturePage.screenshot({ path: "/tmp/seelite-1151-alternate-cabin.png" });
await fixturePage.close();

// The prototype path adds the laser rig and combat glass; its assertions
// (firing feedback, lock/missile/interdiction status) belong on a dedicated
// combat-mode page so the production viewport loop above stays a production
// check.
const combatPage = await browser.newPage({
	viewport: { width: 1280, height: 760 },
});
watch(combatPage, "prototype combat");
await installCompositeFrame(combatPage);
await combatPage.goto(gameUrl(ORIGIN, { seed: 42, combat: 1 }), {
	waitUntil: "load",
});
await installCockpitTextProbe(combatPage);
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
// Off the frame the player sees, not the overlay: the rig's tracer is drawn
// into the WebGL frame behind the cabin since node #806, as the gun's is.
// `__compositeFrame` renders before it reads, so each arm is its own render.
const laserTracerPixels = await combatPage.evaluate(() => {
	const game = window.__seelite;
	const overlay = document.querySelector("#overlay");
	const count = () => {
		const data = window.__compositeFrame(overlay.width, overlay.height).data;
		let bright = 0;
		for (let i = 0; i < data.length; i += 4)
			if (data[i] > 100 && data[i + 1] > 180 && data[i + 2] > 200) bright++;
		return bright;
	};
	const shown = count();
	game.combatRig.forceLaserHidden = true;
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
	const canvas = (
		game.cockpit.text.faces.get("prototype-combat") ??
		game.cockpit.text.faces.get("fallback")
	).ctx.canvas;
	const context = canvas.getContext("2d");
	const read = () =>
		context.getImageData(0, 0, canvas.width, canvas.height).data;
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
	"prototype: holding Space shows the weapon tracer, draws it in the frame and exposes immediate PULSE feedback on a cabin face",
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
await installCockpitTextProbe(narrowCombatPage);
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
