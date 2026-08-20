/** The prose documents the contract; these tests exercise its gallery model. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
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

test("the gallery uses the project radar name rather than an external-game label", () => {
	const target = renderGalleryState(
		galleryState("target-acquisition"),
		"Flight",
	);
	expect(target).toContain("LOCAL RADAR");
	expect(target).not.toContain("ELITE 3D RADAR");
});
