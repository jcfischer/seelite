import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LAUNCH_HOLD_NOTICE } from "../src/live-cockpit";

test("every held-launch notice reads as a hold (#314)", () => {
	// The record's type already demands a notice per refusal; what it cannot
	// demand is that each one says what happened.
	const notices = Object.values(LAUNCH_HOLD_NOTICE);
	expect(notices.length).toBeGreaterThan(0);
	for (const notice of notices) expect(notice).toMatch(/^LAUNCH HELD — /);
});

test("the market row's five cells and the market grid's five tracks agree (#196)", () => {
	// **Why this reads the source instead of a browser.** §5.6 gave the market a fifth
	// cell — GOOD, BUY, SELL, SHELF, ACTION — and the four-column rule the equipment list
	// still wants is what made the ACTION button wrap onto a second grid line in every
	// listed row. A wrapped button is still a button, so the browser probe cannot see it,
	// and `src/live-cockpit.ts`'s CSS comment claims a check exists. This is that check.
	//
	// It is a text read because the stylesheet and the template live in one module
	// (repo precedent: `hud-scanner-spec.test.ts`, `source-bytes.test.ts`), and what it
	// asserts is the pairing, not either count alone: five tracks beside five cells, and
	// four tracks for the list that still draws four.
	const src = readFileSync("src/live-cockpit.ts", "utf8");
	/** Track count of the first stylesheet line whose selector is exactly `selector`. */
	const tracks = (selector: string): number => {
		const line = src
			.split("\n")
			.find(
				(l) => l.startsWith(selector) && l.includes("grid-template-columns"),
			);
		if (!line) throw new Error(`no grid rule for selector ${selector}`);
		const decl = /grid-template-columns: ([^;]+);/.exec(line);
		if (!decl) throw new Error(`no declaration in ${line.slice(0, 60)}`);
		// Count top-level track expressions: commas only ever appear inside minmax().
		return decl[1]
			.replace(/minmax\([^)]*\)/g, "T")
			.split(/\s+/)
			.filter(Boolean).length;
	};
	const cells = (marker: string): number => {
		// The row *templates*, not the CSS selector that also mentions the attribute.
		const line = src
			.split("\n")
			.find((l) => l.includes("<div") && l.includes(marker));
		if (!line) throw new Error(`no row template matched ${marker}`);
		return (line.match(/<span/g) ?? []).length;
	};
	// The listed row and the header carry the grid's arity; an unlisted row is one cell
	// short (there is no ACTION column to draw) and a grid leaves that track empty,
	// which is why the assertion is "at most", not "equal".
	const marketTracks = tracks(".lc-station-market .lc-station-row {");
	expect(marketTracks).toBe(5);
	expect(cells('data-live-listed="true"')).toBe(marketTracks);
	expect(cells('data-live-listed="false"')).toBeLessThan(marketTracks);
	const head = src
		.split("\n")
		.find((l) => l.includes("<div") && l.includes("lc-station-head"));
	if (!head) throw new Error("no market header template");
	expect((head.match(/<span/g) ?? []).length).toBe(marketTracks);
	// The shared rule keeps four tracks, which is what the override rule exists for: the
	// equipment list draws four cells and the market five.
	expect(tracks(".lc-station-row { display")).toBe(4);
});

test("a value that can move while the stick holds still is named in the console's key (#396)", () => {
	// **Why this reads the source and not only the browser.** `update` rebuilds the
	// left console only when `valueKey` changes, and both the law's label and the
	// new `HAILS` row are bound *inside* that gate — so a member that
	// is not in the key refreshes only when something else moves. In flight that is
	// invisible: speed and charge are never still long enough to notice the lag, and
	// #429's first draft shipped exactly that bug with every headless row green. The
	// behavioural evidence is `probe-witnesses.mjs`, whose loop is the first caller
	// that ever stood still; this row is the one that goes red the day a member is
	// dropped from the key again, which is what "the browser saw it once" cannot do.
	const src = readFileSync("src/live-cockpit.ts", "utf8");
	const key = src
		.split("\n")
		.find((l) => l.trim().startsWith("const valueKey ="));
	if (!key) throw new Error("no valueKey — the gate this row guards has moved");
	// **Every figure the left console prints that is not driven by the stick.**
	// The pilot's own numbers are already in the key; the law and the hail are the
	// two that move on their own, and both have to be named.
	for (const member of ["legalStatus", "hails"])
		expect(key).toContain(`\${state.${member}}`);
	// And they are bound *behind* the gate, which is the whole reason the key has
	// to carry them. If a refactor lifts them in front of it, this row is where the
	// reader learns the key stopped mattering for them.
	expect(src).toContain("if (valueKey === this.lastValueKey) return;");
});
