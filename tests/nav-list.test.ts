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
import { readdirSync } from "node:fs";
import { navFilterMatches, projectNavTargets } from "../src/cockpit";
import { v3 } from "../src/vec3";
import { codeOf, repoPath } from "./lib/source-scan";

const BODIES = [
	{
		id: "far-station",
		name: "QUERIOR",
		kind: "station" as const,
		stationType: "trade",
		pos: v3(9_000, 0, 0),
	},
	{
		id: "near-station",
		name: "ARLEDI",
		kind: "station" as const,
		stationType: "refinery",
		pos: v3(0, 300, 0),
	},
	{
		id: "hesperia",
		name: "SOORATLE I",
		kind: "planet" as const,
		pos: v3(0, 0, 4_000),
	},
	{
		id: "seelite",
		name: "SOORATLE",
		kind: "star" as const,
		pos: v3(0, 0, 120_000),
	},
	{
		id: "hesperia-i",
		name: "SOORATLE I a",
		kind: "moon" as const,
		pos: v3(100, 0, 0),
	},
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

test("near-equal ranges retain their rendered order until the lead is meaningful", () => {
	const bodies = [
		{
			id: "alpha",
			name: "Alpha",
			kind: "station" as const,
			pos: v3(100, 0, 0),
		},
		{
			id: "beta",
			name: "Beta",
			kind: "station" as const,
			pos: v3(99.98, 0, 0),
		},
	];

	expect(
		projectNavTargets(v3(), bodies, null, {
			previousOrder: ["alpha", "beta"],
		}).map(({ id }) => id),
	).toEqual(["alpha", "beta"]);
	expect(
		projectNavTargets(v3(), bodies, null, {
			previousOrder: ["alpha", "beta"],
			distanceHysteresisKm: 0.01,
		}).map(({ id }) => id),
	).toEqual(["beta", "alpha"]);
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

test("the query matches the displayed name and kind words, never the id", () => {
	const rows = projectNavTargets(v3(), BODIES, null, {
		filter: { kinds: [], query: "  TRADE " },
	});
	expect(rows.map((row) => row.id)).toEqual(["far-station"]);
	expect(rows[0].displayKind).toBe("trade station");
	expect(
		navFilterMatches(
			{ name: "Hesperia", kind: "planet" },
			{ kinds: [], query: "hesp" },
		),
	).toBe(true);
	expect(
		navFilterMatches(
			{ name: "QUERIOR", kind: "station", stationType: "trade" },
			{ kinds: [], query: "station-trade" },
		),
	).toBe(false);
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
	const walk = (dir: string) => {
		for (const entry of readdirSync(repoPath(dir), { withFileTypes: true })) {
			const path = `${dir}/${entry.name}`;
			// Recursive, because `readdirSync` on `src` alone would let a module
			// in a subdirectory carry the import the whole test exists to ban.
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!entry.name.endsWith(".ts") || path === "src/galaxy-map.ts") continue;
			for (const [statement] of codeOf(path).matchAll(
				// Three forms fold the chunk back in, and an earlier version of
				// this test caught only the first: a named `import … from`, a
				// bare side-effect `import "./galaxy-map";`, and a re-export.
				//
				// `[^;]*` cannot cross a statement terminator, so each match
				// starts at its own keyword rather than at the file's first
				// import — which a lazy `[\s\S]*?` does, swallowing everything
				// above it.
				// The specifier is matched as *any* path ending in `/galaxy-map`,
				// not as the literal `./galaxy-map`: a module one directory down
				// writes `../galaxy-map` and folds the chunk in exactly the same
				// way. The recursion was added without this and the subdirectory
				// case stayed green.
				// Anchored to a line *start plus any indentation* rather than to
				// column zero: nothing in this repo indents a top-level import,
				// but the test's claim is about the whole tree and a claim wider
				// than its regex is how the last three holes in this check got
				// through.
				/(?:^|\n)[ \t]*(?:import|export)\b[^;]*?["'][^"']*\/galaxy-map["'];/g,
			)) {
				// `import type { … }` is erased before the bundler sees it, so it
				// is not what costs anything.
				if (/^\s*import\s+type\b/.test(statement)) continue;
				offenders.push(`${path}: ${statement.replace(/\s+/g, " ")}`);
			}
		}
	};
	walk("src");
	expect(offenders).toEqual([]);
	expect(codeOf("src/main.ts")).toContain('import("./galaxy-map")');
	// **What this does not prove.** It is a check on the import graph, not on
	// the built output: a bundler configured to inline dynamic chunks would
	// keep it green while the chart shipped in the entry anyway. The split was
	// confirmed by hand against `npm run build`, which emits `galaxy-map` as its
	// own 12.1K chunk. Asserting that here would mean running vite inside the
	// headless tier, which is a different tier's job.
});
