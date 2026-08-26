/**
 * The issue #34 design gallery must remain readable before the real HUD consumes
 * its contract. It checks every named state at desktop and narrow viewports.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const STATES = [
	"assist-on",
	"assist-off",
	"cruise",
	"target-acquisition",
	"docking-granted",
	"docking-denied",
];
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

function isInsideViewport(box, viewport) {
	return (
		box &&
		box.width > 0 &&
		box.height > 0 &&
		box.left >= 0 &&
		box.top >= 0 &&
		box.right <= viewport.width &&
		box.bottom <= viewport.height
	);
}

function measureGalleryState() {
	const isVisible = (selector) => {
		const element = document.querySelector(selector);
		if (!(element instanceof HTMLElement)) return false;
		const style = getComputedStyle(element);
		return (
			style.display !== "none" &&
			style.visibility !== "hidden" &&
			Number(style.opacity) > 0
		);
	};
	const root = document.querySelector("#state-gallery");
	const boxFor = (element) => {
		if (!element) return null;
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
	const box = (selector) => boxFor(document.querySelector(selector));
	const director = box("[data-gallery-director]");
	const arrow = box("[data-gallery-target-arrow]");
	const arrowIsAroundCircle = (() => {
		if (!director || !arrow) return false;
		const dx =
			arrow.left + arrow.width / 2 - (director.left + director.width / 2);
		const dy = arrow.top + arrow.height / 2 - (director.top + 34);
		return Math.hypot(dx, dy) > 35;
	})();
	return {
		active: root
			?.querySelector("[data-gallery-state-active]")
			?.getAttribute("data-gallery-state-active"),
		director,
		scanner: box("[data-gallery-scanner]"),
		scannerVisible: isVisible("[data-gallery-scanner]"),
		floor: box("[data-gallery-floor]"),
		floorVisible: isVisible("[data-gallery-floor]"),
		galleryRendererCount: document.querySelectorAll("canvas:not(#overlay)")
			.length,
		liveGameRunning: Boolean(window.__seelite),
		panels: [
			...document.querySelectorAll('[data-gallery-panel][data-active="true"]'),
		],
		panelBoxes: [
			...document.querySelectorAll('[data-gallery-panel][data-active="true"]'),
		].map(boxFor),
		leftWorkSurface: boxFor(
			document.querySelector('[data-gallery-panel="left"][data-active="true"]'),
		),
		rightWorkSurface: boxFor(
			document.querySelector(
				'[data-gallery-panel="right"][data-active="true"]',
			),
		),
		leftPanelVisible: (() => {
			const panel = document.querySelector('[data-gallery-panel="left"]');
			return (
				panel instanceof HTMLElement &&
				getComputedStyle(panel).display !== "none"
			);
		})(),
		rightPanelVisible: (() => {
			const panel = document.querySelector('[data-gallery-panel="right"]');
			return (
				panel instanceof HTMLElement &&
				getComputedStyle(panel).display !== "none"
			);
		})(),
		docking: Boolean(document.querySelector("[data-gallery-docking]")),
		targetArrow: Boolean(document.querySelector("[data-gallery-target-arrow]")),
		targetArrowBearing: document
			.querySelector("[data-gallery-target-arrow]")
			?.getAttribute("data-gallery-target-bearing"),
		targetArrowAroundCircle: arrowIsAroundCircle,
		radar: document
			.querySelector("[data-gallery-scanner]")
			?.getAttribute("aria-label"),
		radarAnchors: document.querySelectorAll("[data-gallery-contact-anchor]")
			.length,
		radarMasts: (() => {
			// Matches the three contact stems in renderGalleryState.
			const stems = [
				...document.querySelectorAll("[data-gallery-contact-stem]"),
			];
			return (
				stems.length === 3 &&
				stems.every(
					(element) =>
						Number.parseFloat(
							getComputedStyle(element).getPropertyValue("--height"),
						) > 0,
				)
			);
		})(),
		cockpitCanvas: (() => {
			const canvas = document.querySelector("[data-gallery-3d-canvas]");
			return (
				canvas instanceof HTMLCanvasElement &&
				canvas.width > 0 &&
				canvas.height > 0 &&
				canvas.dataset.galleryRenderedFrame === "true" &&
				Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))
			);
		})(),
		headLook: document
			.querySelector("[data-gallery-cockpit]")
			?.getAttribute("data-gallery-head-look"),
		viewport: { width: innerWidth, height: innerHeight },
	};
}

await guardedOrigin(ORIGIN, ["src/units.ts", "src/state-gallery.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(`${ORIGIN}/?seed=42&hud-gallery=assist-on`, {
		waitUntil: "load",
	});
	await page.waitForSelector("#state-gallery");

	for (const state of STATES) {
		await page.locator(`[data-gallery-state="${state}"]`).click();
		const measured = await page.evaluate(measureGalleryState);
		check(
			`${viewport.name}: ${state} keeps the target director on the glass`,
			isInsideViewport(measured.director, measured.viewport),
		);
		check(
			`${viewport.name}: ${state} keeps the local scanner visible`,
			isInsideViewport(measured.scanner, measured.viewport) &&
				measured.scannerVisible,
		);
		check(
			`${viewport.name}: ${state} keeps the persistent flight floor visible`,
			isInsideViewport(measured.floor, measured.viewport) &&
				measured.floorVisible,
		);
		check(
			`${viewport.name}: ${state} is the state actually displayed`,
			measured.active === state,
			`gallery reported ${measured.active}`,
		);
		if (state.startsWith("docking-"))
			check(
				`${viewport.name}: ${state} exposes docking alignment and clearance cues`,
				measured.docking,
			);
		if (state === "target-acquisition")
			check(
				`${viewport.name}: target acquisition rotates the combat-ready arrow around the target circle`,
				measured.targetArrow &&
					measured.targetArrowBearing !== null &&
					measured.targetArrowAroundCircle,
			);
		check(
			`${viewport.name}: ${state} renders a live Three.js cockpit canvas`,
			measured.cockpitCanvas,
		);
		check(
			`${viewport.name}: ${state} gallery mode uses one non-overlay canvas without a live game`,
			measured.galleryRendererCount === 1 && !measured.liveGameRunning,
			`${measured.galleryRendererCount} non-overlay canvases; game running: ${measured.liveGameRunning}`,
		);
		if (state === "assist-on")
			check(
				`${viewport.name}: assist-on describes the local radar with anchored vertical masts`,
				measured.radar?.includes("Local radar") &&
					measured.radarAnchors === 3 &&
					measured.radarMasts,
			);
		if (viewport.name === "narrow")
			check(
				`narrow: ${state} shows at most one side panel`,
				measured.panels.length <= 1,
				`${measured.panels.length} active panels`,
			);
		if (viewport.name === "narrow") {
			const scannerIsBottomCentre =
				measured.scanner &&
				Math.abs(
					measured.scanner.left +
						measured.scanner.width / 2 -
						measured.viewport.width / 2,
				) <= 12 &&
				measured.scanner.bottom > measured.viewport.height * 0.55;
			const scannerIsUnobscured =
				measured.scanner &&
				!measured.panelBoxes.some(
					(panel) =>
						measured.scanner.left < panel.right &&
						measured.scanner.right > panel.left &&
						measured.scanner.top < panel.bottom &&
						measured.scanner.bottom > panel.top,
				);
			check(
				`narrow: ${state} keeps the scanner bottom-centre and clear of the active panel`,
				scannerIsBottomCentre && scannerIsUnobscured,
			);
		}
	}
	await page.locator('[data-gallery-state="assist-on"]').click();
	await page.locator('[data-gallery-look="left"]').click();
	const leftLook = await page.evaluate(measureGalleryState);
	check(
		`${viewport.name}: left head-look brings the full Navigation console into the working field`,
		leftLook.headLook === "left" &&
			leftLook.cockpitCanvas &&
			!leftLook.scannerVisible &&
			!leftLook.floorVisible &&
			leftLook.leftPanelVisible &&
			!leftLook.rightPanelVisible &&
			leftLook.leftWorkSurface?.width > leftLook.viewport.width * 0.7 &&
			leftLook.leftWorkSurface?.height > 180,
	);
	await page.locator('[data-gallery-look="right"]').click();
	await page
		.locator('[data-gallery-right-tab="Tuning"]')
		.evaluate((element) => element.click());
	const rightLook = await page.evaluate(measureGalleryState);
	check(
		`${viewport.name}: right head-look brings the full Tuning console into the working field`,
		rightLook.headLook === "right" &&
			!rightLook.scannerVisible &&
			!rightLook.floorVisible &&
			rightLook.rightPanelVisible &&
			!rightLook.leftPanelVisible &&
			rightLook.rightWorkSurface?.width > rightLook.viewport.width * 0.7 &&
			rightLook.rightWorkSurface?.height > 180 &&
			(await page.locator("[data-gallery-tuning]").count()) === 1,
	);
	await page.locator(".sg-close").click();
	const returnedToFlight = await page
		.waitForFunction(
			() =>
				!new URLSearchParams(location.search).has("hud-gallery") &&
				document.querySelector("#state-gallery") === null &&
				Boolean(window.__seelite),
			undefined,
			{ timeout: 5_000 },
		)
		.then(
			() => true,
			() => false,
		);
	check(
		`${viewport.name}: return to flight restores the live game route`,
		returnedToFlight,
	);
	await page.close();
}

await browser.close();
exit();
