/**
 * Issue #34 is a design contract, not a wish-list. These checks keep the
 * decisions that Jens-Christian confirmed in its grilling session discoverable
 * to the ship and station visual work that follows it.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the HUD and scanner specification records every confirmed design boundary", () => {
	const spec = read("docs/specs/hud-and-scanner.md");
	const prose = spec.replace(/\s+/g, " ");
	for (const heading of [
		"## 1. Cockpit hierarchy and ownership",
		"## 2. Compact scanner",
		"## 3. Target and docking director",
		"## 4. Attention and visual grammar",
		"## 5. Persistent floor and side panels",
		"## 6. Responsive behaviour",
		"## 7. Verification plan",
	])
		expect(spec).toContain(heading);

	for (const decision of [
		"target-primary cockpit",
		"Elite-style 3D radar",
		"lower centre of the cockpit",
		"vertical mast",
		"anchor disc",
		"10,000 km vicinity",
		"axis-alignment funnel",
		"roll-match ring",
		"target-circle arrow",
		"no pause and no time compression",
		"Tuning tab",
		"assist-on, assist-off, cruise, target acquisition, granted docking, and denied docking",
	])
		expect(prose).toContain(decision);
});

test("the gallery model exposes each state the browser probe must fly through", () => {
	const gallery = read("src/state-gallery.ts");
	for (const state of [
		"assist-on",
		"assist-off",
		"cruise",
		"target-acquisition",
		"docking-granted",
		"docking-denied",
	])
		expect(gallery).toContain(`id: \"${state}\"`);
	expect(gallery).toContain("ELITE 3D RADAR");
	expect(gallery).toContain("Tuning");
	expect(gallery).toContain("sg-target-arrow");
	expect(gallery).toContain("data-gallery-target-bearing");
	expect(gallery).toContain("rotate(var(--target-bearing))");
	expect(gallery).toContain("left: 50%");
	expect(gallery).toContain("sg-contact-anchor");
});

test("the state-gallery probe runs both desktop and narrow cockpit views", () => {
	const probe = read("scripts/probe-state-gallery.mjs");
	expect(probe).toContain("desktop");
	expect(probe).toContain("narrow");
	expect(probe).toContain("docking-granted");
	expect(probe).toContain("docking-denied");
	expect(probe).toContain("targetArrowBearing");
	expect(probe).toContain("targetArrowAroundCircle");
	expect(probe).toContain("radarAnchors");
});
