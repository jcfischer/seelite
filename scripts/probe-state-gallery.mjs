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

function measureGalleryState() {
	const root = document.querySelector("#state-gallery");
	const box = (selector) => {
		const element = document.querySelector(selector);
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
		floor: box("[data-gallery-floor]"),
		panels: [
			...document.querySelectorAll('[data-gallery-panel][data-active="true"]'),
		],
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
		radarMasts: [
			...document.querySelectorAll("[data-gallery-contact-stem]"),
		].every(
			(element) =>
				Number.parseFloat(
					getComputedStyle(element).getPropertyValue("--height"),
				) > 0,
		),
		cockpitCanvas: (() => {
			const canvas = document.querySelector("[data-gallery-3d-canvas]");
			return (
				canvas instanceof HTMLCanvasElement &&
				canvas.width > 0 &&
				canvas.height > 0 &&
				Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))
			);
		})(),
		viewport: { width: innerWidth, height: innerHeight },
	};
}

await guardedOrigin(ORIGIN, ["src/units.ts", "src/state-gallery.ts"]);
const browser = await launchChromium();
const { check, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	page.on("pageerror", (error) =>
		check(`${viewport.name}: no page error (${error.message})`, false),
	);
	await page.goto(`${ORIGIN}/?seed=42&hud-gallery=assist-on`, {
		waitUntil: "load",
	});
	await page.waitForSelector("#state-gallery");

	for (const state of STATES) {
		await page.locator(`[data-gallery-state="${state}"]`).click();
		const measured = await page.evaluate(measureGalleryState);
		const inside = (box) =>
			box &&
			box.width > 0 &&
			box.height > 0 &&
			box.left >= 0 &&
			box.top >= 0 &&
			box.right <= measured.viewport.width &&
			box.bottom <= measured.viewport.height;
		check(
			`${viewport.name}: ${state} keeps the target director on the glass`,
			inside(measured.director),
		);
		check(
			`${viewport.name}: ${state} keeps the local scanner visible`,
			inside(measured.scanner),
		);
		check(
			`${viewport.name}: ${state} keeps the persistent flight floor visible`,
			inside(measured.floor),
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
		if (state === "target-acquisition")
			check(
				`${viewport.name}: target acquisition renders a live Three.js cockpit canvas`,
				measured.cockpitCanvas,
			);
		if (state === "assist-on")
			check(
				`${viewport.name}: assist-on describes the Elite-style 3D local radar with anchored vertical masts`,
				measured.radar?.includes("Elite-style 3D local radar") &&
					measured.radarAnchors === 3 &&
					measured.radarMasts,
			);
		if (viewport.name === "narrow")
			check(
				`narrow: ${state} shows at most one side panel`,
				measured.panels.length <= 1,
				`${measured.panels.length} active panels`,
			);
	}
	await page.locator('[data-gallery-state="assist-on"]').click();
	await page.locator('[data-gallery-right-tab="Tuning"]').click();
	check(
		`${viewport.name}: developer tuning remains available in the right-panel Tuning tab`,
		await page.locator("[data-gallery-tuning]").isVisible(),
	);
	await page.close();
}

await browser.close();
exit();
