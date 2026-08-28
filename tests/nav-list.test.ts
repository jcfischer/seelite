/**
 * The left Navigation console's finding surface — node #91.
 *
 * `galaxy-map.md` §5.1 measured why this exists rather than being a
 * convenience: at the framing that fits the whole 256-system cluster, 40.2% of
 * systems have a neighbour inside the pick radius, so a chart cannot be its own
 * finder. `hud-and-scanner.md` §2 says the same from the other side — the
 * compact scanner is read-only and local to 10,000 km, and "system-scale
 * discovery, filtering, and target records therefore belong to the left
 * Navigation panel".
 *
 * The projection is pinned here rather than in the DOM because the DOM is where
 * the assertion becomes a screenshot. What the panel renders is the list this
 * returns.
 */
import { expect, test } from "bun:test";
import { navFilterMatches, projectNavTargets } from "../src/cockpit";
import { readdirSync } from "node:fs";
import { codeOf, repoPath } from "./lib/source-scan";
import { v3 } from "../src/vec3";

const BODIES = [
	{ id: "far-station", kind: "station" as const, pos: v3(9_000, 0, 0) },
	{ id: "near-station", kind: "station" as const, pos: v3(0, 300, 0) },
	{ id: "hesperia", kind: "planet" as const, pos: v3(0, 0, 4_000) },
	{ id: "seelite", kind: "star" as const, pos: v3(0, 0, 120_000) },
	{ id: "hesperia-i", kind: "moon" as const, pos: v3(100, 0, 0) },
];

test("targets list nearest first, with the range the panel prints", () => {
	const rows = projectNavTargets(v3(), BODIES, null);

	expect(rows.map((row) => row.id)).toEqual([
		"hesperia-i",
		"near-station",
		"hesperia",
		"far-station",
		"seelite",
	]);
	expect(rows[0].distanceKm).toBeCloseTo(100, 6);
	expect(rows[1].distanceKm).toBeCloseTo(300, 6);
	expect(rows[3].distanceKm).toBeCloseTo(9_000, 6);
});

test("the projection holds no kind rule of its own", () => {
	// **Deliberately lists the moon.** What can be targeted is `Game`'s rule —
	// `selectable()`, which `cycleTarget` walks and `onSelectTarget` validates
	// against — and `Game` passes that list in. A second listability set here
	// would be a second owner: the day a body kind is added the two diverge, and
	// the row either vanishes while `T` still cycles to it or appears and does
	// nothing when clicked.
	//
	// The pairing is asserted in the browser, where both halves exist:
	// `probe-navigation-console.mjs` compares the rows against the game's own
	// `selectableIds()`.
	expect(projectNavTargets(v3(), BODIES, null).map((row) => row.id)).toContain(
		"hesperia-i",
	);
});

test("the selected target is flagged, and nothing else is", () => {
	const rows = projectNavTargets(v3(), BODIES, "hesperia");
	expect(rows.filter((row) => row.selected).map((row) => row.id)).toEqual([
		"hesperia",
	]);
});

test("the kind filter narrows to one class; an empty filter is every class", () => {
	const stations = projectNavTargets(v3(), BODIES, null, {
		filter: { kinds: ["station"], query: "" },
	});
	expect(stations.map((row) => row.id)).toEqual([
		"near-station",
		"far-station",
	]);

	const all = projectNavTargets(v3(), BODIES, null, {
		filter: { kinds: [], query: "" },
	});
	expect(all).toHaveLength(BODIES.length);
});

test("the query is a trimmed, case-insensitive substring of the id", () => {
	const rows = projectNavTargets(v3(), BODIES, null, {
		filter: { kinds: [], query: "  STAT " },
	});
	expect(rows.map((row) => row.id)).toEqual(["near-station", "far-station"]);
	expect(
		navFilterMatches(
			{ id: "Hesperia", kind: "planet" },
			{ kinds: [], query: "hesp" },
		),
	).toBe(true);
});

test("ETA is asked for only the rows that survive the filter", () => {
	// `Game.timeToTarget` integrates the cruise law per body (`cruise.ts`'s
	// `legSeconds`). Asking it for every body in the system on every frame the
	// panel is open is the cost this contract exists to bound: a filtered list
	// pays for what it shows, not for what it hid.
	const asked: string[] = [];
	const rows = projectNavTargets(v3(), BODIES, null, {
		filter: { kinds: ["station"], query: "" },
		etaFor: (body) => {
			asked.push(body.id);
			return body.id === "near-station" ? 42 : null;
		},
	});

	expect(asked.sort()).toEqual(["far-station", "near-station"]);
	expect(rows.map((row) => row.etaSeconds)).toEqual([42, null]);
});

test("without an ETA source every row reads unknown rather than zero", () => {
	// A missing estimate and an immediate arrival are different facts, and a
	// panel that prints `0s` for the first is lying in the direction that gets
	// a player killed on approach.
	const rows = projectNavTargets(v3(), BODIES, null);
	expect(rows.every((row) => row.etaSeconds === null)).toBe(true);
});

test("no module in src/ statically imports the galaxy chart", () => {
	// The claim in `Game.setChartHost` is that a player who never opens the
	// Galaxy Map tab does not pay for the chart in the initial bundle. That is a
	// property of the **import graph**, not of that method: a static
	// `from "./galaxy-map"` anywhere reachable from the entry — `live-cockpit.ts`
	// is the obvious candidate, since it is what asks for the host — folds the
	// chunk back in without a line of `setChartHost` changing.
	//
	// So the whole of `src/` is scanned rather than `main.ts` alone, which is
	// what an earlier version of this test did and what made the claim wider
	// than the check behind it. `import type` is erased before the bundler sees
	// it, so it is not the thing being banned.
	const offenders: string[] = [];
	for (const file of readdirSync(repoPath("src"))) {
		if (!file.endsWith(".ts") || file === "galaxy-map.ts") continue;
		// Whole `import … from "./galaxy-map"` statements, single- or multi-line.
		// Matched as statements rather than as lines, because a type-only import
		// spread over several lines carries its `type` markers on the ones a
		// line-at-a-time scan would judge on their own.
		for (const [statement] of codeOf(`src/${file}`).matchAll(
			// `[^;]*` cannot cross a statement terminator, so the match starts at
			// this import's own `import` keyword rather than at the file's first
			// one — which a lazy `[\s\S]*?` does, swallowing every import above it.
			/^import\b[^;]*?from "\.\/galaxy-map";/gm,
		)) {
			// `import type { … }` is erased before the bundler sees it, so it is
			// not what folds the chunk back in.
			if (/^import\s+type\b/.test(statement)) continue;
			offenders.push(`src/${file}: ${statement.replace(/\s+/g, " ")}`);
		}
	}
	expect(offenders).toEqual([]);
	expect(codeOf("src/main.ts")).toContain('import("./galaxy-map")');
});
