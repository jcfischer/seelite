/**
 * The left Navigation console — nodes #91 and #96.
 *
 * Two surfaces with one job between them. `galaxy-map.md` §5.1 measured that a
 * chart cannot be its own finder (40.2% of systems have a neighbour inside the
 * pick radius at the framing that fits the cluster), so the **list** is the
 * finding surface and the **chart** is the reading one. This asserts that both
 * exist in the cockpit and that neither has quietly become the other.
 *
 * Separate from `probe-live-cockpit.mjs` on purpose: that probe owns the
 * head-look states and the physical instruments, and a console tab's contents
 * are a different claim from a console's geometry.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

/**
 * The open cell's crowding band — **measured, and it lands on the closed one.**
 *
 * The obligation was not to assume the 64-82% band carries into the narrower
 * cell (#96 is the recorded case of a crowding figure changing under a
 * different box). It was measured instead, twice: the live console reads 73.0%
 * at 743 x 462 against 73.0% at 1011 x 462, and
 * `measure-galaxy-shape.ts shipped` — which now carries a `cons-open` row —
 * prints the *same spread to the digit* for the two cells, 75.0%-86.7% over its
 * 24 layouts.
 *
 * That is a fact about the projection rather than a coincidence, and the check
 * below that compares the two sets of projected pixels is what makes it
 * falsifiable. The chart holds its vertical field of view and widens `aspect`
 * with the box, so a point lands at
 * `worldX · height / (2 · z · tan) + width / 2`: the **spacing** between two
 * systems does not depend on the width at all, and only the origin moves, by
 * half the width the finder took. A narrower cell therefore crops rather than
 * compressing, and crowding — which is a question about spacing — is the same
 * number. The moment the cluster stops fitting, `onScreen` falls below 256 and
 * the two part, which is why that equality is asserted in both checks and is
 * not decoration.
 */
const EXPANDED_CROWDING = [0.64, 0.82];

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGE_URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.goto(PAGE_URL, { waitUntil: "load" });
await bootedGame(page);

/** Turn the head to the console and wait for the panel to actually be showing. */
const lookLeft = async () => {
	await page.evaluate(() => window.__seelite.setHeadLook("left"));
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-live-cockpit]")
				?.getAttribute("data-live-head-look") === "left",
	);
};

const clickTab = async (tab) => {
	await page.evaluate((name) => {
		const el = document.querySelector(`[data-live-left-tab="${name}"]`);
		if (!(el instanceof HTMLElement)) throw new Error(`no ${name} tab`);
		el.click();
	}, tab);
	await page.waitForFunction(
		(name) =>
			document
				.querySelector("[data-live-cockpit]")
				?.getAttribute("data-live-left-view") === name,
		tab,
	);
};

/**
 * The rows as drawn, beside the ranges the *simulation* holds for the same ids.
 *
 * Both halves are read here rather than the order being compared to itself: a
 * list that sorted its own output and then reported that output as sorted would
 * pass on a build with no sort at all.
 */
const readList = () =>
	page.evaluate(() => {
		const game = window.__seelite;
		const ship = game.world.ship.pos;
		const rangeOf = (id) => {
			const body = game.world.system.byId.get(id);
			if (!body) return null;
			return Math.hypot(
				body.pos.x - ship.x,
				body.pos.y - ship.y,
				body.pos.z - ship.z,
			);
		};
		const rows = [...document.querySelectorAll("[data-live-nav-target]")].map(
			(row) => ({
				id: row.dataset.liveNavTarget,
				kind: row.querySelector("i")?.textContent ?? "",
				text: row.textContent ?? "",
				current: row.getAttribute("aria-current") === "true",
				trueRangeKm: rangeOf(row.dataset.liveNavTarget),
			}),
		);
		return {
			rows,
			empty: document.querySelectorAll(".lc-nav-empty").length,
			// **The game's own answer to "can this be targeted".** Reading the
			// kinds off the panel's filter chips instead compares the projection
			// against a second copy of the projection's own rule — both sides
			// move together, and nothing binds either to the `selectable()` that
			// `cycleTarget` walks and `onSelectTarget` validates against. If
			// those two ever diverge, a row click becomes a silent no-op.
			selectableIds: game.selectableIds(),
		};
	});

await lookLeft();
await page.waitForFunction(
	() => document.querySelectorAll("[data-live-nav-target]").length > 0,
);

const listed = await readList();
check(
	"the rendered list is exactly the set the game holds as selectable",
	listed.rows.length > 1 &&
		listed.rows.length === listed.selectableIds.length &&
		listed.rows.every((row) => listed.selectableIds.includes(row.id)),
	`rows ${listed.rows.map((r) => r.id).join(",")} against selectable ${listed.selectableIds.join(",")}`,
);
check(
	"rows are ordered by the simulation's own ranges, nearest first",
	// **Tolerance, because the world does not stop for the probe.** The rows
	// were sorted at render time and these ranges are sampled after it, so two
	// near-equidistant bodies that cross in between would fail a correct build.
	// A part-per-thousand is far below any real ordering error — the probe's
	// own seed puts its closest pair 0.17% apart — and far above one frame of
	// orbital motion.
	listed.rows.every(
		(row, i) =>
			row.trueRangeKm !== null &&
			(i === 0 ||
				row.trueRangeKm >= listed.rows[i - 1].trueRangeKm * (1 - 1e-3)),
	),
	listed.rows.map((r) => `${r.id}:${Math.round(r.trueRangeKm)}`).join(" "),
);

// ---- Selection ------------------------------------------------------------

/**
 * Click a row the game is **not** already on.
 *
 * Boot selects the nearest station, which is row 0 — clicking that would pass
 * on a build whose rows do nothing at all.
 */
const wanted = listed.rows.find((row) => !row.current);
check("some listed row is not already the target", Boolean(wanted));
if (wanted) {
	await page.evaluate((id) => {
		document.querySelector(`[data-live-nav-target="${id}"]`).click();
	}, wanted.id);
	const selected = await page.evaluate(() => ({
		targetId: window.__seelite.targetBody()?.id ?? null,
		director:
			document.querySelector("[data-live-director] > strong")?.textContent ??
			null,
		current: [...document.querySelectorAll("[data-live-nav-target]")]
			.filter((row) => row.getAttribute("aria-current") === "true")
			.map((row) => row.dataset.liveNavTarget),
	}));
	check(
		"clicking a row selects that body in the simulation, and only that row reads current",
		selected.targetId === wanted.id &&
			selected.director === wanted.id &&
			selected.current.length === 1 &&
			selected.current[0] === wanted.id,
		`target ${selected.targetId}, director ${selected.director}, current ${selected.current.join(",")}`,
	);
}

// ---- Filtering ------------------------------------------------------------

const type = async (value) => {
	await page.evaluate((text) => {
		const field = document.querySelector("[data-live-nav-query]");
		field.value = text;
		field.dispatchEvent(new Event("input", { bubbles: true }));
	}, value);
};

// A fragment of one row's id, chosen so at least one other row does not contain
// it — a query every row satisfies cannot tell a working filter from none.
//
// `includes`, not `startsWith`: `navFilterMatches` matches anywhere in the id,
// and a probe asserting a prefix would go red on a correctly-listed mid-string
// match — a check failing on working code.
const distinctive = listed.rows.find((row) =>
	listed.rows.some(
		(other) =>
			!other.id.toLowerCase().includes(row.id.slice(0, 4).toLowerCase()),
	),
);
check(
	"some id fragment distinguishes one row from another",
	Boolean(distinctive),
	`seed in ${PAGE_URL}; ids ${listed.rows.map((r) => r.id).join(",")}`,
);
if (distinctive) {
	const prefix = distinctive.id.slice(0, 4);
	await type(prefix);
	const filtered = await readList();
	// **Both directions, against a set computed here.** Asserting only that the
	// survivors match the fragment, plus `length < listed.length`, degenerates
	// on a seed where one row matches: a build that over-narrowed to a single
	// arbitrary row would satisfy both halves and read as a working filter. The
	// expected set is derived from the unfiltered list by the projection's own
	// substring rule, so a row wrongly dropped fails as loudly as one wrongly
	// kept.
	const expected = listed.rows
		.filter((row) => row.id.toLowerCase().includes(prefix.toLowerCase()))
		.map((row) => row.id)
		.sort();
	check(
		"the query narrows to exactly the ids that match it — no more and no fewer",
		expected.length > 0 &&
			expected.length < listed.rows.length &&
			filtered.rows
				.map((row) => row.id)
				.sort()
				.join(",") === expected.join(","),
		`"${prefix}" → ${filtered.rows.map((r) => r.id).join(",")}; expected ${expected.join(",")}`,
	);
}

await type("zzzz-no-such-body");
const none = await readList();
check(
	"a query matching nothing says so rather than falling back to everything",
	none.rows.length === 0 && none.empty === 1,
);
await type("");

await page.evaluate(() => {
	document.querySelector('[data-live-nav-kind="station"]').click();
});
const stations = await readList();
check(
	"the STATION chip narrows to stations, and it is a narrowing",
	stations.rows.length > 0 &&
		stations.rows.length < listed.rows.length &&
		stations.rows.every((row) => row.kind === "STATION"),
	stations.rows.map((r) => `${r.id}/${r.kind}`).join(" "),
);
await page.evaluate(() => {
	document.querySelector('[data-live-nav-kind="station"]').click();
});

// ---- The chart tab --------------------------------------------------------

await clickTab("Galaxy Map");
await page.waitForFunction(() => Boolean(window.__seeliteGalaxyMap));
// **Baselined after the mount, not before it.** Sampled before the click, the
// frames rendered while the chunk loaded and the chart built already satisfy
// the comparison, so a chart that froze the loop the moment it came up would
// pass. What is being asserted is that the loop runs *with the chart open*.
const framesBefore = await page.evaluate(() => window.__seelite.frames);

const chart = await page.evaluate(() => {
	const host = document.querySelector("[data-live-chart-host]");
	const panel = document.querySelector('[data-live-panel="left"]');
	// **The canvas, not the host.** The host is a grid cell the console laid
	// out, so its box is inside the panel by construction — measuring it
	// asserts the panel's own layout and passes on a chart that escaped the
	// panel entirely. What has to be contained is the thing that draws.
	const drawn = host?.querySelector("canvas");
	const hostBox = drawn?.getBoundingClientRect();
	const panelBox = panel?.getBoundingClientRect();
	return {
		canvases: host?.querySelectorAll("canvas").length ?? 0,
		systemCount: window.__seeliteGalaxyMap?.state.systemCount ?? 0,
		currentIndex: window.__seeliteGalaxyMap?.state.currentIndex ?? null,
		galaxy: window.__seeliteGalaxyMap?.state.galaxy ?? null,
		gameSystemIndex: window.__seelite.world.system.record.index,
		gameGalaxy: window.__seelite.world.system.record.galaxy,
		hostBox: hostBox && {
			left: hostBox.left,
			top: hostBox.top,
			right: hostBox.right,
			bottom: hostBox.bottom,
		},
		panelBox: panelBox && {
			left: panelBox.left,
			top: panelBox.top,
			right: panelBox.right,
			bottom: panelBox.bottom,
		},
		frames: window.__seelite.frames,
	};
});

check(
	"the Galaxy Map tab draws a chart of the full galaxy",
	chart.canvases === 1 && chart.systemCount === 256,
	`${chart.canvases} canvas, ${chart.systemCount} systems`,
);
/**
 * **This one cannot yet fail, and says so.** Dropping `currentIndex` at the
 * mount site leaves `mountGalaxyChart` falling back to `startSystem(galaxy)` —
 * which is where the game also begins, so the defect and the fix agree. Built
 * and run: the probe stayed green.
 *
 * It is kept because it becomes discriminating the day the ship can be
 * somewhere else, which is `galaxy-generation.md` §8's hyperspace jump, and
 * because the galaxy half of the pair is not vacuous — a chart built for
 * galaxy 3 while the ship flies in galaxy 0 fails here today.
 */
check(
	"the chart is built for the galaxy and system the ship is in (system half not yet discriminating — see the note)",
	chart.currentIndex === chart.gameSystemIndex &&
		chart.galaxy === chart.gameGalaxy,
	`chart ${chart.galaxy}/${chart.currentIndex} against game ${chart.gameGalaxy}/${chart.gameSystemIndex}`,
);
/**
 * **The containment check is the one that can go red on the obvious mistake.**
 * The workbench root is `position: fixed; inset: 0`, and a chart mounted that
 * way covers the whole viewport — which is #70's second UI grammar, the thing
 * `galaxy-map.md` §1 rules out ("not a full-screen mode ... not an
 * application"). Measured rather than asserted from the CSS, because a rule
 * about where pixels land is not a rule about which declaration was written.
 */
check(
	"the chart stays inside the console panel rather than covering the cockpit",
	chart.hostBox &&
		chart.panelBox &&
		chart.hostBox.left >= chart.panelBox.left - 1 &&
		chart.hostBox.top >= chart.panelBox.top - 1 &&
		chart.hostBox.right <= chart.panelBox.right + 1 &&
		chart.hostBox.bottom <= chart.panelBox.bottom + 1,
	`host ${JSON.stringify(chart.hostBox)} panel ${JSON.stringify(chart.panelBox)}`,
);

// `hud-and-scanner.md` §1: the game continues while a panel is open — no pause
// and no time compression. A chart that stole the frame loop would show here.
//
// Sampled and compared, not `waitForFunction` followed by `check(..., true)`:
// that pair reports a pass the tally never evaluated, and a wait that times out
// throws instead of failing the check it was standing in for.
await new Promise((resolve) => setTimeout(resolve, 500));
const framesAfter = await page.evaluate(() => window.__seelite.frames);
check(
	"the simulation keeps running while the chart is open",
	framesAfter > framesBefore + 5,
	`${framesBefore} → ${framesAfter}`,
);

// ---- Crowding at the framing the player actually gets ----------------------

/**
 * §5.1's 40.2% is what makes the list mandatory rather than a convenience — and
 * it was measured on the workbench, which is a whole 1280 × 760 page. The tab
 * draws into a grid cell inside the console — 1011 x 462 at this viewport — and
 * crowding is a **pixel** property: it is a function of the projection, the
 * viewport and `PICK_RADIUS_PX`, so a smaller box packs the same 256 points
 * into fewer pixels and can only make it worse.
 *
 * Sharing `mountGalaxyChart` therefore does not carry the figure across. The
 * same method as `probe-galaxy-map.mjs` §9.2, run at the shipped framing, and
 * the assertion is the one the decision actually rests on: at the view that
 * frames the cluster, a large share of systems cannot be picked apart, so the
 * chart cannot be its own finder.
 */
const crowding = await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	map.select(null);
	map.resetView();
	const radius = map.pickRadiusPx;
	const { width, height } = map.viewport();
	// On screen, not merely in front of the camera — counting points that have
	// left the viewport inflates the figure with pairs nobody can see.
	const visible = map
		.projected()
		.filter(
			(p) => !p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
		);
	let crowded = 0;
	for (const a of visible) {
		for (const b of visible) {
			if (a.index === b.index) continue;
			if (Math.hypot(a.x - b.x, a.y - b.y) < radius) {
				crowded++;
				break;
			}
		}
	}
	return {
		fraction: visible.length === 0 ? 1 : crowded / visible.length,
		onScreen: visible.length,
		systemCount: map.state.systemCount,
		width,
		height,
	};
});
// Banded rather than floored, the way `probe-galaxy-map.mjs` bands §5.1's own
// figure: a floor cannot notice the projection getting *better*, and a change
// that halved crowding would be a change to the argument for the list.
// Calibrated on 1280 x 760; the metric is viewport-dependent, so a narrow
// viewport would need its own band rather than this one widened.
//
// **Re-measured for the q = 0.7 disc (#118), from the spread and not from one
// galaxy.** The 1011 x 462 cell was measured over all eight galaxies —
// 76.6 75.4 74.2 76.2 76.2 77.7 68.4 75.8, a spread of 68.4-77.7 — widened about
// 4 points each way and rounded outward to a whole percent (64-82). It replaces 55-80, which was set from a single ball
// galaxy; the new band is *narrower* than the one it replaces, which is what
// re-measuring rather than widening looks like when the measurement improves.
// The live console here reads 73.0%, inside the workbench spread, which is what
// makes measuring the cell size on the workbench a fair proxy for it.
// **The basis is asserted, not assumed.** `fraction` is
// `crowded / visible.length`, so a build that framed only 101 systems would
// still satisfy a `> 100` floor while the "of 256" the spec quotes had quietly
// stopped holding — and a fraction over a smaller, sparser denominator is a
// different measurement wearing the same name.
check(
	"the chart in the console is crowded enough that the list is mandatory",
	crowding.onScreen === crowding.systemCount &&
		crowding.fraction >= 0.64 &&
		crowding.fraction <= 0.82,
	`${(crowding.fraction * 100).toFixed(1)}% of ${crowding.onScreen}/${crowding.systemCount} on screen at ${Math.round(crowding.width)}x${Math.round(crowding.height)}`,
);

// ---- The finder (#115, against #86's D2, D4, D7 and D8) --------------------

/** The chart's box, after the layout has actually settled on it. */
const canvasBox = () =>
	page.evaluate(() => window.__seeliteGalaxyMap.viewport());

/** Wait until the canvas is the width the finder's state implies, so nothing
 *  below measures a frame taken mid-relayout. */
const settled = async (widerThan, narrowerThan) => {
	await page.waitForFunction(
		({ lo, hi }) => {
			const w = window.__seeliteGalaxyMap.viewport().width;
			return w > lo && w < hi;
		},
		{ lo: widerThan, hi: narrowerThan },
	);
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
};

const finderState = () =>
	page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		const { finder } = map.state;
		const results = document.querySelector("[data-map-finder-results]");
		return {
			expanded: finder.expanded,
			filter: finder.filter,
			inBudget: finder.inBudget.map((r) => ({
				index: r.index,
				name: r.name,
				jumps: r.jumps,
			})),
			beyondRange: finder.beyondRange.map((r) => ({
				index: r.index,
				name: r.name,
				jumps: r.jumps,
			})),
			// Read off the DOM, not off the state, because the claim is about what
			// the panel *shows*: a build whose projection was right and whose
			// renderer drew nothing would satisfy the state alone.
			drawnRows: [...document.querySelectorAll("[data-map-finder-row]")].length,
			drawnBeyondHeadings: document.querySelectorAll("[data-map-finder-beyond]")
				.length,
			resultsShown: results !== null && results.style.display !== "none",
			fieldPresent: document.querySelector("[data-map-finder-query]") !== null,
			chipCount: document.querySelectorAll("[data-map-finder-economy]").length,
			selectedIndex: map.state.selectedIndex,
			pose: {
				yaw: map.state.yaw,
				pitch: map.state.pitch,
				distance: map.state.cameraDistanceLy,
				focusIndex: map.state.focusIndex,
			},
		};
	});

const clearFinder = async () => {
	await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		map.setFinderQuery("");
		map.setFinderBudget(1);
		for (const chip of document.querySelectorAll("[data-map-finder-economy]"))
			if (chip.getAttribute("aria-pressed") === "true")
				map.toggleFinderEconomy(Number(chip.dataset.mapFinderEconomy));
	});
};

const closedCell = await canvasBox();
const closed = await finderState();
check(
	"the finder's collapsed form is a visible search field, not a drawer",
	closed.fieldPresent && closed.chipCount === 8 && !closed.expanded,
	`field ${closed.fieldPresent}, ${closed.chipCount} chips, expanded ${closed.expanded}`,
);
check(
	"closed, the finder shows no results and leaves the chart its whole cell",
	!closed.resultsShown &&
		closed.drawnRows === 0 &&
		Math.round(closedCell.width) === Math.round(crowding.width),
	`results ${closed.resultsShown}, ${closed.drawnRows} rows, cell ${Math.round(closedCell.width)} against the measured ${Math.round(crowding.width)}`,
);

/**
 * **D4 needs the chip case, and it is checked before the typed one.**
 *
 * Verifying only the typed case passes a build whose chips are dead — the
 * defect `live-cockpit.ts:180-225` records having shipped once already, where a
 * state attribute swallowed every chip click and nothing errored. Running the
 * chip first also means the typed check below cannot inherit an expansion the
 * chip left behind.
 */
await clearFinder();
await page.evaluate(() => {
	const chip = document.querySelector('[data-map-finder-economy="0"]');
	chip.click();
});
const byChip = await finderState();
check(
	"a chip click with an empty query expands the finder and produces rows",
	byChip.expanded &&
		byChip.filter.query === "" &&
		byChip.resultsShown &&
		byChip.drawnRows > 0,
	`expanded ${byChip.expanded}, query "${byChip.filter.query}", ${byChip.drawnRows} rows drawn`,
);

await clearFinder();
const afterClear = await finderState();
check(
	"clearing every narrowing collapses it again",
	!afterClear.expanded &&
		!afterClear.resultsShown &&
		afterClear.drawnRows === 0,
	`expanded ${afterClear.expanded}, ${afterClear.drawnRows} rows`,
);

await page.evaluate(() => {
	const field = document.querySelector("[data-map-finder-query]");
	field.value = "a";
	field.dispatchEvent(new Event("input", { bubbles: true }));
});
const byTyping = await finderState();
check(
	"typing expands the finder too",
	byTyping.expanded && byTyping.resultsShown,
	`expanded ${byTyping.expanded}, results shown ${byTyping.resultsShown}`,
);

/**
 * D7, both directions — the node's third obligation.
 *
 * The two names are taken from the *projection* rather than hard-coded, so this
 * does not go red the day the generator renames a system, and the pair is
 * chosen to sit either side of the default budget: a check that only ever saw
 * one branch could not tell the grouping from a constant.
 */
await clearFinder();
const pool = await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	map.setFinderBudget(9);
	const rows = map.state.finder.inBudget;
	map.setFinderBudget(1);
	return {
		near: rows.find((r) => r.jumps === 1)?.name ?? null,
		far: rows.find((r) => r.jumps >= 3)?.name ?? null,
	};
});
await page.evaluate((name) => {
	window.__seeliteGalaxyMap.setFinderQuery(name);
}, pool.near);
const nearQuery = await finderState();
check(
	"a query whose matches are all in budget shows no beyond-range group",
	pool.near !== null &&
		nearQuery.inBudget.length > 0 &&
		nearQuery.beyondRange.length === 0 &&
		nearQuery.drawnBeyondHeadings === 0,
	`"${pool.near}": ${nearQuery.inBudget.length} in budget, ${nearQuery.beyondRange.length} beyond, ${nearQuery.drawnBeyondHeadings} headings drawn`,
);
await page.evaluate((name) => {
	window.__seeliteGalaxyMap.setFinderQuery(name);
}, pool.far);
const farQuery = await finderState();
check(
	"a query whose matches are all out of budget shows the group and an empty primary list",
	pool.far !== null &&
		farQuery.inBudget.length === 0 &&
		farQuery.beyondRange.length > 0 &&
		farQuery.drawnBeyondHeadings === 1 &&
		farQuery.drawnRows === farQuery.beyondRange.length,
	`"${pool.far}": ${farQuery.inBudget.length} in budget, ${farQuery.beyondRange.length} beyond, ${farQuery.drawnRows} rows drawn`,
);

/**
 * D2, both halves — the node's fifth obligation.
 *
 * A row must select and leave the camera exactly where it was; the centre
 * control must move the camera and leave the selection exactly where it was.
 * Asserting only the first half passes on a build whose camera can never move
 * at all, which is why the second half is here and why it reads the same pose.
 */
const poseBefore = (await finderState()).pose;
await page.evaluate(() => {
	document.querySelector("[data-map-finder-row]").click();
});
const afterRow = await finderState();
check(
	"a finder row selects on the chart and does not move the camera",
	afterRow.selectedIndex !== null &&
		afterRow.selectedIndex === farQuery.beyondRange[0].index &&
		afterRow.pose.yaw === poseBefore.yaw &&
		afterRow.pose.pitch === poseBefore.pitch &&
		afterRow.pose.distance === poseBefore.distance &&
		afterRow.pose.focusIndex === poseBefore.focusIndex,
	`selected ${afterRow.selectedIndex}, pose ${JSON.stringify(afterRow.pose)} against ${JSON.stringify(poseBefore)}`,
);
await page.evaluate(() => {
	document.querySelector("[data-map-finder-centre]").click();
});
const afterCentre = await finderState();
check(
	"the per-row centre control moves the camera and changes nothing else",
	afterCentre.pose.focusIndex === afterRow.selectedIndex &&
		afterCentre.pose.focusIndex !== poseBefore.focusIndex &&
		afterCentre.selectedIndex === afterRow.selectedIndex,
	`focus ${afterCentre.pose.focusIndex}, selection ${afterCentre.selectedIndex}`,
);

// D8: the chart's `set course` button is the single owner of the commit. A
// per-row commit would be a second path to one act.
const commitControls = await page.evaluate(() => ({
	rows: document.querySelectorAll("[data-map-finder-row]").length,
	perRowCourse: document.querySelectorAll(
		"[data-map-finder-results] [data-map-course]",
	).length,
	chartCourse: document.querySelectorAll("[data-map-course]").length,
}));
check(
	"the finder commits no course — the chart's button stays the only one",
	commitControls.rows > 0 &&
		commitControls.perRowCourse === 0 &&
		commitControls.chartCourse === 1,
	`${commitControls.rows} rows, ${commitControls.perRowCourse} per-row course controls, ${commitControls.chartCourse} on the chart`,
);

// ---- Crowding in the expanded cell (#115's first obligation) ---------------

/**
 * **The 64-82% band above is the *closed* cell's, and it does not carry.**
 *
 * Opening the finder takes a column off the chart, and crowding is a pixel
 * property: the same 256 points in a narrower box are packed closer, so the
 * figure can only rise. #96 is the recorded case — the workbench's 40.2% became
 * the console's 68.8% for exactly this reason — and #118 is the recorded reason
 * to band from a spread rather than from one galaxy.
 *
 * The band below is set from `measure-galaxy-shape.ts`'s console-open cell over
 * all eight galaxies, widened and rounded outward the way the closed band was.
 * The measured figure is printed either way, so a change that improved the
 * projection shows up as a value moving rather than as silence.
 */
// **The finder is open from the D7 checks above, so it is closed first.**
// Capturing the "closed" projection while the panel still held its column read
// the same 743 px box twice and made the comparison below 0.000 px on every
// build, broken ones included — which is exactly the check-that-cannot-fail this
// section is here to avoid. Caught by building the red case and watching it stay
// green.
await clearFinder();
await settled(closedCell.width - 1, closedCell.width + 1);
const closedProjection = await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	map.select(null);
	map.resetView();
	const { width, height } = map.viewport();
	return map
		.projected()
		.filter(
			(p) => !p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
		);
});
await page.evaluate(() => {
	window.__seeliteGalaxyMap.setFinderQuery("a");
});
await settled(0, closedCell.width - 100);
const openCell = await canvasBox();
const crowdingOpen = await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	const radius = map.pickRadiusPx;
	const { width, height } = map.viewport();
	const visible = map
		.projected()
		.filter(
			(p) => !p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
		);
	let crowded = 0;
	for (const a of visible) {
		for (const b of visible) {
			if (a.index === b.index) continue;
			if (Math.hypot(a.x - b.x, a.y - b.y) < radius) {
				crowded++;
				break;
			}
		}
	}
	return {
		fraction: visible.length === 0 ? 1 : crowded / visible.length,
		onScreen: visible.length,
		systemCount: map.state.systemCount,
		width,
		height,
	};
});
const crop = await page.evaluate((before) => {
	const map = window.__seeliteGalaxyMap;
	const { width, height } = map.viewport();
	const now = new Map(
		map
			.projected()
			.filter(
				(p) =>
					!p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
			)
			.map((p) => [p.index, p]),
	);
	const shifts = [];
	let worstDyPx = 0;
	for (const p of before) {
		const q = now.get(p.index);
		if (q === undefined) continue;
		shifts.push(q.x - p.x);
		worstDyPx = Math.max(worstDyPx, Math.abs(q.y - p.y));
	}
	const meanShiftPx = shifts.reduce((a, b) => a + b, 0) / (shifts.length || 1);
	return {
		compared: shifts.length,
		meanShiftPx,
		shiftSpreadPx: Math.max(...shifts) - Math.min(...shifts),
		worstDyPx,
	};
}, closedProjection);
check(
	"the expanded finder narrows the chart's cell, so the closed band is a different measurement",
	openCell.width < closedCell.width - 100 &&
		Math.round(openCell.height) === Math.round(closedCell.height),
	`${Math.round(closedCell.width)}x${Math.round(closedCell.height)} closed against ${Math.round(openCell.width)}x${Math.round(openCell.height)} open`,
);
/**
 * **The mechanism, not the coincidence.**
 *
 * Two equal percentages would also be what a build that never updated the
 * camera's aspect produced — and that build is broken in exactly the way this
 * section exists to notice. So the pixels are compared, and what is asserted is
 * that every system moved by the *same* amount: a crop translates the whole
 * cluster by half the width the panel took and leaves every spacing alone,
 * while a compression scales each point's offset from the centre and moves the
 * middle of the cluster by less than its edges.
 *
 * Written the wrong way first — "every system lands on the same pixel" — which
 * is false for a crop too, because the origin moves with the box. It was the
 * red build that said so: with the aspect frozen the check stayed green at
 * 0.000 px, and on the shipped build it went red at 134 px, which is the
 * translation the crop is *supposed* to produce. The spread is the discriminating
 * quantity, not the shift.
 */
check(
	"the narrower cell crops the chart rather than compressing it",
	crop.compared > 200 &&
		crop.shiftSpreadPx < 1 &&
		crop.worstDyPx < 1 &&
		Math.abs(crop.meanShiftPx + (closedCell.width - openCell.width) / 2) < 1,
	`${crop.compared} systems, x shifted ${crop.meanShiftPx.toFixed(1)} px (spread ${crop.shiftSpreadPx.toFixed(3)}, half the ${Math.round(closedCell.width - openCell.width)} px the panel took is ${((closedCell.width - openCell.width) / 2).toFixed(1)}), worst y move ${crop.worstDyPx.toFixed(3)} px`,
);
check(
	"the chart in the open console is crowded enough that the list is mandatory",
	crowdingOpen.onScreen === crowdingOpen.systemCount &&
		crowdingOpen.fraction >= EXPANDED_CROWDING[0] &&
		crowdingOpen.fraction <= EXPANDED_CROWDING[1],
	`${(crowdingOpen.fraction * 100).toFixed(1)}% of ${crowdingOpen.onScreen}/${crowdingOpen.systemCount} on screen at ${Math.round(crowdingOpen.width)}x${Math.round(crowdingOpen.height)}`,
);

await clearFinder();
await settled(closedCell.width - 1, closedCell.width + 1);
// ---- Teardown -------------------------------------------------------------

await clickTab("Navigation");
const afterLeaving = await page.evaluate(() => ({
	handle: window.__seeliteGalaxyMap,
	hosts: document.querySelectorAll("[data-live-chart-host]").length,
	canvasesInPanel: document.querySelectorAll('[data-live-panel="left"] canvas')
		.length,
	rows: document.querySelectorAll("[data-live-nav-target]").length,
}));
check(
	"leaving the tab takes the chart down rather than leaving a second renderer running",
	afterLeaving.handle === null &&
		afterLeaving.hosts === 0 &&
		afterLeaving.canvasesInPanel === 0,
	`handle ${afterLeaving.handle}, ${afterLeaving.hosts} hosts, ${afterLeaving.canvasesInPanel} canvases`,
);
check(
	"the target list is back after the chart tab",
	afterLeaving.rows === listed.rows.length,
	`${afterLeaving.rows} rows`,
);

await browser.close();
exit();
