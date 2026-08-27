/** The prose documents the contract; these tests exercise its gallery model. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CONSOLE_STATIONS,
	DEFAULT_CONSOLE_VIEW,
	GALLERY_STATES,
	galleryState,
	renderGalleryState,
} from "../src/state-gallery";

const read = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the HUD and scanner document retains the agreed decision vocabulary", () => {
	const prose = read("docs/specs/hud-and-scanner.md").replace(/\s+/g, " ");
	for (const decision of [
		"target-primary cockpit",
		"local radar",
		"lower centre of the cockpit",
		"vertical mast",
		"anchor disc",
		"target-circle arrow",
		"Tuning tab",
	])
		expect(prose).toContain(decision);
});

test("the gallery resolves every inspectable flight state and defaults safely", () => {
	expect(GALLERY_STATES.map((state) => state.id)).toEqual([
		"assist-on",
		"assist-off",
		"cruise",
		"target-acquisition",
		"docking-granted",
		"docking-denied",
		"docked",
	]);
	expect(galleryState("missing-state").id).toBe("assist-on");
	expect(galleryState("target-acquisition").targetBearingDeg).toBe(-112);
});

test("the rendered target state exposes the gallery hooks used by browser checks", () => {
	const target = renderGalleryState(
		galleryState("target-acquisition"),
		"Flight",
	);
	const tuning = renderGalleryState(galleryState("assist-on"), "Tuning");
	const leftLook = renderGalleryState(
		galleryState("assist-on"),
		"Flight",
		"left",
	);
	expect(target).toContain("data-gallery-cockpit");
	expect(target).toContain('data-gallery-target-bearing="-112"');
	expect(target).toContain("data-gallery-contact-anchor");
	expect(target).toContain("data-gallery-3d-prototype");
	expect(tuning).toContain("data-gallery-tuning");
	expect(leftLook).toContain('data-gallery-look="left"');
});

test("head-look activates exactly the readable console overlay for that side", () => {
	const forward = renderGalleryState(galleryState("assist-on"), "Flight");
	const left = renderGalleryState(galleryState("assist-on"), "Flight", "left");
	const right = renderGalleryState(
		galleryState("assist-on"),
		"Tuning",
		"right",
	);
	expect(forward).toContain('data-gallery-physical-console="forward"');
	expect(left).toContain('data-gallery-physical-console="left"');
	expect(right).toContain('data-gallery-physical-console="right"');
	expect(forward).toContain('data-gallery-panel="left" data-active="false"');
	expect(forward).toContain('data-gallery-panel="right" data-active="false"');
	expect(left).toContain('data-gallery-panel="left" data-active="true"');
	expect(right).toContain('data-gallery-panel="right" data-active="true"');
});

test("§8: docked takes the whole flight floor away and hangs the console forward", () => {
	// M10 and M2, on the rendered markup rather than on the state record: the
	// floor, the scanner and the director are the three things §5 calls
	// persistent, and docked is the state that is not the same cockpit with dead
	// instruments.
	const docked = renderGalleryState(galleryState("docked"), "Flight");
	expect(docked).toContain("data-gallery-station-console");
	expect(docked).not.toContain("data-gallery-floor");
	expect(docked).not.toContain("data-gallery-scanner");
	expect(docked).not.toContain("data-gallery-director");
	// M9: launch is on the Flight console, and the rest of it says it is inert.
	expect(docked).toContain("data-gallery-launch");
	expect(docked).toContain("data-gallery-inert");
	// The flying states are untouched by all of it.
	const flying = renderGalleryState(galleryState("assist-on"), "Flight");
	expect(flying).toContain("data-gallery-floor");
	expect(flying).not.toContain("data-gallery-station-console");
	expect(flying).not.toContain("data-gallery-launch");
});

test("§8: the arrival renders neither the console nor the floor it replaced", () => {
	// M4's negative on the markup. The render is driven by `flightFloorVisible`
	// and `stationConsoleVisible` rather than by a second `state.id` test, so
	// the two predicates the headless tier asserts are the ones the glass obeys.
	const arriving = renderGalleryState(
		galleryState("docked"),
		"Flight",
		"forward",
		{ ...DEFAULT_CONSOLE_VIEW, phase: "arriving" },
	);
	expect(arriving).toContain('data-gallery-dock-phase="arriving"');
	expect(arriving).toContain("data-gallery-arriving");
	expect(arriving).not.toContain("data-gallery-station-console");
	expect(arriving).not.toContain("data-gallery-floor");
	expect(arriving).not.toContain("data-gallery-scanner");
});

test("§8.3: the gallery has a shipyard, so the empty hull heading is rendered somewhere", () => {
	// The heading is drawn at a shipyard and nowhere else. Without a shipyard in
	// the rig it would be markup no state reaches — shipped, and unprobed.
	const yard = CONSOLE_STATIONS.find((station) => station.id === "yard");
	if (!yard) throw new Error("the console rig has no shipyard");
	const rendered = renderGalleryState(
		galleryState("docked"),
		"Flight",
		"forward",
		{ ...DEFAULT_CONSOLE_VIEW, station: yard, tab: "Equipment" },
	);
	expect(rendered).toContain("data-gallery-hulls");
	expect(rendered).toContain("data-gallery-hulls-empty");
	const trade = renderGalleryState(
		galleryState("docked"),
		"Flight",
		"forward",
		{ ...DEFAULT_CONSOLE_VIEW, tab: "Equipment" },
	);
	expect(trade).not.toContain("data-gallery-hulls");
});

test("M6: the rendered moved row carries the arrow the builder gave it", () => {
	const rendered = renderGalleryState(
		galleryState("docked"),
		"Flight",
		"forward",
		DEFAULT_CONSOLE_VIEW,
	);
	expect(rendered).toMatch(/data-gallery-price-delta>[↑↓]\d/);
	expect(rendered).toMatch(/data-gallery-shelf-delta>[↑↓]\d/);
});

test("the gallery keeps the scanner self-explanatory without a visible title", () => {
	const target = renderGalleryState(
		galleryState("target-acquisition"),
		"Flight",
	);
	expect(target).toContain(
		'aria-label="Local radar, 10,000 kilometre vicinity"',
	);
	expect(target).not.toContain("LOCAL RADAR");
	expect(target).not.toContain("ELITE 3D RADAR");
});
