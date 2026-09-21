import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTROLS } from "../src/controls-catalogue";
import { PUBLIC_PAGES, pageForPath } from "../src/public-site";
import { repoPath } from "./lib/source-scan";

describe("the quiet public threshold", () => {
	test("names exactly the approved static destinations", () => {
		expect(PUBLIC_PAGES.map((page) => page.slug)).toEqual([
			"",
			"about",
			"field-notes",
			"manual",
			"trust",
			"credits",
		]);
		for (const page of PUBLIC_PAGES) {
			const route = page.slug === "" ? "/" : `/${page.slug}/`;
			expect(pageForPath(route)).toBe(page);
			const entry = readFileSync(repoPath(page.entry), "utf8");
			if (page.slug === "") expect(entry).toContain('src="/src/entry.ts"');
			else expect(entry).toContain(`data-public-page="${page.slug}"`);
		}
	});

	test("keeps the home threshold private and hands play to the existing game boot", () => {
		const source = readFileSync(repoPath("src/public-site.ts"), "utf8");
		expect(source).toContain('href="/?boot=overlay"');
		expect(source).toContain("No accounts. No tracking. No analytics.");
		expect(source).toContain("No runtime network calls.");
		expect(source).not.toMatch(/\bfetch\s*\(|WebSocket|EventSource/);
	});

	/**
	 * The manual prints keys, and the catalogue binds them. A third copy of a
	 * binding goes stale in silence, so every key the page names is looked up in
	 * `CONTROLS` by the command it is named for — a rebound command turns this
	 * row red rather than leaving the public page lying.
	 */
	test("prints only keys the controls catalogue actually binds", () => {
		const manual = PUBLIC_PAGES.find((page) => page.slug === "manual");
		if (!manual) throw new Error("no manual page");
		const bound = (id: string) =>
			CONTROLS.commands
				.find((command) => command.id === id)
				?.defaultTriggers.flatMap((trigger) =>
					trigger.kind === "key" ? [trigger.key] : [],
				) ?? [];
		const printed: [string, string][] = [
			["pitch", "w"],
			["pitch", "s"],
			["pitch", "arrowup"],
			["pitch", "arrowdown"],
			["yaw", "a"],
			["yaw", "d"],
			["yaw", "arrowleft"],
			["yaw", "arrowright"],
			["roll", "q"],
			["roll", "e"],
			["throttle-up", "shift"],
			["throttle-down", "control"],
			["assist-or-beam", "x"],
			["target-next", "t"],
			["target-previous", "g"],
			["face-target", "f"],
			["cruise", "j"],
			["jump", "`"],
			["clearance", "c"],
			["docking-computer", "u"],
			["launch", "enter"],
			["console-cursor", "arrowup"],
			["console-cursor", "arrowdown"],
			["console-activate", "enter"],
			["controls-reference", "?"],
			["head-left", "1"],
			["head-forward", "2"],
			["head-right", "3"],
		];
		for (const [id, key] of printed) expect(bound(id)).toContain(key);
		for (const shown of [
			"Pitch is W and S, yaw is A and D, roll is Q and E",
			"Shift and Ctrl move the throttle",
			"X switches flight assist",
			"T and G step through targets, F faces the one you selected",
			"J engages or drops cruise",
			"&#96; key winds up the jump",
			"C asks for clearance",
			"U switches the docking computer",
			"Enter launches again",
			"up and down arrows walk the cursor and Enter opens the row",
		])
			expect(manual.content).toContain(shown);
	});

	test("gives a new pilot the controls needed to reach every cockpit panel", () => {
		const source = readFileSync(repoPath("src/public-site.ts"), "utf8");
		expect(source).toContain("Press ? to open the Controls tab");
		expect(source).toContain(
			"1 opens the left panel, 2 faces the forward panel, and 3 opens the right panel",
		);
	});
});
