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
 * **The constant is the closed cell's band verbatim, reused because the two
 * cells measure alike — it is not a derivation from the instrument's numbers.**
 * Those are different claims and only the first is true. The two instruments
 * measure different populations: §5.1's 64-82% comes from this probe's own
 * eight-galaxy sweep of one world seed at this framing (68.4%-77.7%), while
 * `measure-galaxy-shape.ts` sweeps **three** world seeds — 24 layouts — and
 * reports 75.0%-86.7%, a top this ceiling excludes. That gap is not new and is
 * not this node's: it is the same gap the closed-cell band has carried since
 * #118, and the closed check lives inside 64-82% for the same reason this one
 * does. What the instrument is used for here is the **equality of the two
 * cells' spreads**, which is a comparison within one population and is what
 * licenses reusing the band at all. Both checks are therefore scoped to the
 * population the probe can reach — seed 42, galaxy 0 — and a band that covered
 * the instrument's whole sweep would be a different, looser claim.
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
/**
 * **One definition of "on screen", installed once.**
 *
 * The predicate — in front of the camera *and* inside the canvas box — appeared
 * verbatim in four evaluates here, and a fifth in `probe-galaxy-map.mjs`. Four
 * copies means a change to what the figure counts silently applies to some
 * checks and not others, and §5.1 already records one wrong version of this
 * predicate shipping (it counted everything in front of the camera and credited
 * the zoomed views with crowding they did not have). Installed on `window` so
 * every evaluate below calls the same function rather than restating it.
 */
await page.addInitScript(() => {
	/**
	 * §5.1's crowding metric, once.
	 *
	 * The closed cell and the open one are the same question asked of two
	 * boxes, and the kernel was written out twice — which is how the two come
	 * to measure subtly different things while both being called "crowding".
	 * The same argument as `__seeliteOnScreen` below, one level up.
	 */
	window.__seeliteCrowding = () => {
		const map = window.__seeliteGalaxyMap;
		const radius = map.pickRadiusPx;
		const { width, height } = map.viewport();
		const visible = window.__seeliteOnScreen();
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
	};

	window.__seeliteOnScreen = () => {
		const map = window.__seeliteGalaxyMap;
		const { width, height } = map.viewport();
		return map
			.projected()
			.filter(
				(p) =>
					!p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
			);
	};
});
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
			(row) => {
				const id = row.dataset.liveNavTarget;
				const body = game.world.system.byId.get(id);
				return {
					id,
					name: row.querySelector("span")?.textContent ?? "",
					kind: row.querySelector("i")?.textContent ?? "",
					text: row.textContent ?? "",
					current: row.getAttribute("aria-current") === "true",
					trueRangeKm: rangeOf(id),
					expectedName: body?.name ?? null,
					expectedKind:
						body?.kind === "station" && body.stationType
							? `${body.stationType} station`.toUpperCase()
							: (body?.kind.toUpperCase() ?? null),
				};
			},
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
	"every primary row label is the body's name, never its id",
	listed.rows.every(
		(row) =>
			row.name === row.expectedName &&
			row.name.toLowerCase() !== row.id.toLowerCase(),
	),
	listed.rows
		.map((row) => `${row.id} -> ${row.name} (expected ${row.expectedName})`)
		.join(", "),
);
check(
	"station kind cells carry the station type, and every other kind is exact",
	listed.rows.every((row) => row.kind === row.expectedKind),
	listed.rows.map((row) => `${row.id}: ${row.kind}`).join(", "),
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
			selected.director === wanted.name &&
			selected.director !== "NO TARGET SELECTED" &&
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

const searchableText = (row) => `${row.name} ${row.kind}`.toLowerCase();

// Choose the shortest visible-name prefix that narrows this particular list.
// Four characters are not inherently distinctive in the finite digram
// vocabulary, so a generated pair may need a longer prefix.
const distinctive = listed.rows
	.map((row) => {
		const name = row.name.toLowerCase();
		for (let length = 1; length <= name.length; length++) {
			const prefix = name.slice(0, length);
			const matching = listed.rows.filter((other) =>
				searchableText(other).includes(prefix),
			);
			if (matching.length > 0 && matching.length < listed.rows.length)
				return { row, prefix };
		}
		return null;
	})
	.find((candidate) => candidate !== null);
check(
	"some visible-name fragment distinguishes one row from another",
	Boolean(distinctive),
	`seed in ${PAGE_URL}; names ${listed.rows.map((r) => r.name).join(",")}`,
);
if (distinctive) {
	const prefix = distinctive.prefix;
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
		.filter((row) => searchableText(row).includes(prefix))
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

await type("");
const rawStationId = await page.evaluate(
	() =>
		document
			.querySelector('[data-live-nav-target^="station-"]')
			?.getAttribute("data-live-nav-target") ?? null,
);
check("the fixture exposes a raw station id", Boolean(rawStationId));
if (rawStationId) {
	await type(rawStationId);
	const rawIdMatch = await readList();
	check(
		"a raw station id is not a player-visible search term",
		rawIdMatch.rows.length === 0 && rawIdMatch.empty === 1,
		`${rawStationId} -> ${rawIdMatch.rows.map((row) => row.id).join(",")}`,
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
		stations.rows.every((row) => row.kind.endsWith(" STATION")),
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
//
// **Two seconds, not the half it was** (#201). What this check discriminates is
// *running* against *stopped*, and a stopped loop draws zero frames however long
// the window is — so the window is free to be long and the floor is what has to
// be defended. At 500 ms the floor of five frames was a **10 fps** bar on a
// SwiftShader page (`CLAUDE.md`, #98: every probe here renders through it), and
// this repo has already recorded one node reddening this exact row by adding a
// per-frame cost — `station-interior-mesh.ts`'s Lambert note. #201's shadow map
// took it from 49 frames to 39 in 500 ms, which is 78 fps of a player's frame
// and a hair under a bar nobody meant to set at 10.
//
// Lengthening the window rather than lowering the floor keeps every failure the
// check could ever catch and adds four times the margin: a loop stopped by an
// open chart still draws nothing in two seconds.
await new Promise((resolve) => setTimeout(resolve, 2000));
const framesAfter = await page.evaluate(() => window.__seelite.frames);
check(
	"the simulation keeps running while the chart is open",
	framesAfter > framesBefore + 5,
	`${framesBefore} → ${framesAfter} over 2 s`,
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
	return window.__seeliteCrowding();
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

/** Two animation frames — `resetView` and `zoom` change fields the frame
 *  loop applies, so a projection read in the same tick describes the view
 *  before them. */
const nextFrames = (target) =>
	target.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);

const finderLayout = () =>
	page.evaluate(
		() =>
			document
				.querySelector("[data-map-finder]")
				?.getAttribute("data-map-finder-layout") ?? null,
	);

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
		// **A facility chip left on leaks into every later check.** It was not
		// cleared here at first, and #275's own checks were the ones that put a
		// chip on — so the layout, hover and cap checks below would all have run
		// under a narrowing nothing named.
		for (const chip of document.querySelectorAll("[data-map-finder-facility]"))
			if (chip.getAttribute("aria-pressed") === "true") chip.click();
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
		Math.round(closedCell.width) === Math.round(crowding.width) &&
		Math.round(closedCell.height) === Math.round(crowding.height),
	`results ${closed.resultsShown}, ${closed.drawnRows} rows, cell ${Math.round(closedCell.width)}x${Math.round(closedCell.height)} against the measured ${Math.round(crowding.width)}x${Math.round(crowding.height)}`,
);

/**
 * **"Its whole cell" is about the canvas box, and the closed panel floats over
 * a corner of it — so how many systems land under it is a question, not an
 * assumption.**
 *
 * D3 preserved the *cell*, which is what §5.1's band is a figure about. But the
 * collapsed finder is `position: absolute` over the stage, and a system drawn
 * beneath it cannot be clicked — so if any were, the crowding figure would be
 * counting unpickable points as pickable, which is the flattering direction.
 * §5.1's own history has one of those in it already.
 *
 * **Measured: at the default framing, none are.** The cluster does not reach
 * the top-right corner the panel sits in, so nothing §5.1 counts is hidden and
 * the band means what it says. That is a fact about this framing rather than
 * about the layout — orbit toward the panel and points do go under it, which
 * the second half asserts so the first half is a measurement and not a check
 * that cannot fail. A later panel that grew into the cluster at the default
 * view would go red here rather than quietly changing what the figure means.
 */
const occlusionAt = () =>
	page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		const { width, height, left, top } = map.viewport();
		const panel = document
			.querySelector("[data-map-finder]")
			?.getBoundingClientRect();
		const onScreen = window.__seeliteOnScreen();
		const under = onScreen.filter((p) => {
			const x = p.x + left;
			const y = p.y + top;
			return (
				panel !== undefined &&
				x >= panel.left &&
				x <= panel.right &&
				y >= panel.top &&
				y <= panel.bottom
			);
		});
		return { under: under.length, onScreen: onScreen.length };
	});

await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	map.select(null);
	map.resetView();
});
await nextFrames(page);
const occludedDefault = await occlusionAt();
// Toward the panel: zooming *in* spreads the cluster across the canvas until
// it reaches the corner the control sits in. Zooming out was tried first and
// moves every point toward the centre, which is the wrong direction.
await page.evaluate(() => window.__seeliteGalaxyMap.zoom(-40));
await nextFrames(page);
const occludedZoomed = await occlusionAt();
await page.evaluate(() => window.__seeliteGalaxyMap.resetView());
await nextFrames(page);
check(
	"nothing §5.1 counts is hidden under the closed panel at the default framing",
	occludedDefault.onScreen === crowding.systemCount &&
		occludedDefault.under === 0 &&
		occludedZoomed.under > 0,
	`${occludedDefault.under} of ${occludedDefault.onScreen} under the panel at the default framing, ${occludedZoomed.under} of ${occludedZoomed.onScreen} when the cluster is zoomed in under it`,
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
// **"Nothing else" has to be asserted, not just named.** Written first as focus
// plus selection, it passed a build whose centre control also spun or zoomed the
// camera — while the sentence above it, and §9.3, both said "the whole pose".
// The other three components are compared here for that reason.
check(
	"the per-row centre control moves the camera and changes nothing else",
	afterCentre.pose.focusIndex === afterRow.selectedIndex &&
		afterCentre.pose.focusIndex !== poseBefore.focusIndex &&
		afterCentre.selectedIndex === afterRow.selectedIndex &&
		afterCentre.pose.yaw === afterRow.pose.yaw &&
		afterCentre.pose.pitch === afterRow.pose.pitch &&
		afterCentre.pose.distance === afterRow.pose.distance,
	`focus ${afterCentre.pose.focusIndex}, selection ${afterCentre.selectedIndex}, pose ${JSON.stringify(afterCentre.pose)} against ${JSON.stringify(afterRow.pose)}`,
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

/**
 * **The drawn list is capped, and the cap says so.**
 *
 * A one-character query at a wide budget matches most of a 256-system galaxy,
 * and every row is five elements — an uncapped rebuild made a keystroke create
 * about a thousand nodes for a scroll box showing fifteen. The cap is on the
 * drawing only: `state.finder` still carries every matching row, which is what
 * the checks above read, and the panel prints what it left out. A list that
 * stopped at sixty in silence would read exactly like a galaxy with sixty
 * matches in it, which is the silent-truncation failure the map's constraints
 * name.
 */
await clearFinder();
await page.evaluate(() => window.__seeliteGalaxyMap.setFinderBudget(9));
const wide = await finderState();
const cap = await page.evaluate(() => {
	const more = document.querySelector("[data-map-finder-more]");
	return {
		drawnRows: document.querySelectorAll("[data-map-finder-row]").length,
		omitted: more === null ? 0 : Number(more.dataset.mapFinderMore),
		says: more?.textContent ?? "",
	};
});
check(
	"a wide budget draws a capped list and prints what it left out",
	wide.inBudget.length > cap.drawnRows &&
		cap.omitted === wide.inBudget.length - cap.drawnRows &&
		cap.says.includes(String(cap.omitted)),
	`${wide.inBudget.length} matched, ${cap.drawnRows} drawn, "${cap.says}"`,
);
await clearFinder();

// ---- Facility chips (#275, against galaxy-map.md §9.4) --------------------

/**
 * **§9.4's sixth obligation is the only one that needs a browser**, and it is
 * three separate claims: the chips produce the pure projection's rows, the rows
 * carry §5.2.1's annotation, and the chart is untouched by any of it.
 *
 * The chips are clicked in the **DOM**, never through the handle. §115's own
 * note above records a build whose chips were dead because a state attribute
 * swallowed every click while `state.filter` was perfectly correct — driving
 * the handle reproduces that build exactly and passes.
 *
 * The knowledge behind this is the *game's*: booting observes the start
 * system's stations through the System relay and nothing else, so the galaxy
 * splits into one system with real readings and 255 with none. That is the
 * split §5.2.1 cares about, and it is why no fixture is injected here.
 */
// **Read off the page, never restated.** A probe carrying its own copy of a
// module constant goes falsely red the day the module changes it, which is this
// repo's standing rule; `clearFinder` and the `observedChip` block below already
// enumerate the same attribute.
const FACILITY_CHIPS = await page.evaluate(() =>
	[...document.querySelectorAll("[data-map-finder-facility]")].map(
		(chip) => chip.dataset.mapFinderFacility,
	),
);

const clickFacility = (facility) =>
	page.evaluate((name) => {
		const chip = document.querySelector(`[data-map-finder-facility="${name}"]`);
		if (!chip) throw new Error(`no ${name} chip`);
		chip.click();
	}, facility);

/** What the rows actually print, per row, off the DOM. */
const facilityRows = () =>
	page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		return {
			filterFacilities: map.state.finder.filter.facilities,
			// The panel's own count of what it put in the DOM. Read rather than
			// re-derived: the cap is the panel's constant and a probe carrying a
			// copy goes red the day it moves.
			drawnCount: map.state.finder.drawn.inBudget,
			projected: map.state.finder.inBudget.map((r) => ({
				index: r.index,
				facilities: r.matchedFacilities.map((a) => a.facility),
			})),
			rows: [...document.querySelectorAll("[data-map-finder-row]")].map(
				(row) => ({
					index: Number(row.dataset.mapFinderRow),
					disabled:
						row.disabled === true ||
						row.getAttribute("aria-disabled") === "true",
					annotations: [
						...row.querySelectorAll("[data-map-finder-facility-row]"),
					].map((line) => line.textContent),
				}),
			),
			unchecked: (() => {
				const line = document.querySelector(
					"[data-map-finder-unchecked-fence]",
				);
				return line === null
					? null
					: {
							count: Number(line.dataset.mapFinderUncheckedFence),
							says: line.textContent,
						};
			})(),
		};
	});

/** The chart as geography: which points exist, where they are, which are lit
 *  (the chart's one colour distinction) and which are on screen. */
const chartSurface = () =>
	page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		const { width, height } = map.viewport();
		return {
			systemCount: map.state.systemCount,
			cell: { width, height },
			lit: map.state.litIndices.join(","),
			points: map
				.projected()
				.map(
					(p) =>
						`${p.index}:${p.x.toFixed(2)}:${p.y.toFixed(2)}:${p.behind ? 1 : 0}:${
							p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height ? 1 : 0
						}`,
				)
				.join("|"),
		};
	});

/**
 * The whole §9.4 browser obligation at one viewport. Run at both widths,
 * because §5.2.1 puts the finder in a column on one and over the chart on the
 * other, and "the rows render" is a different claim when the panel is the
 * whole screen.
 */
const facilityChecks = async (where) => {
	await clearFinder();
	/**
	 * **The control is another narrowing, and the layout has to settle first.**
	 *
	 * Read against a *closed* finder this fails on a correct build: expanding
	 * the panel takes a column off the chart's cell (§5.2), so every
	 * canvas-relative position moves under any narrowing at all. An economy chip
	 * expands it exactly as a facility chip does, so both arms share a cell
	 * width and the only difference left is the filter.
	 *
	 * And `nextFrames` is not enough to reach it — the panel applies its layout
	 * from a `ResizeObserver`, so two frames after a chip click the canvas can
	 * still be the closed width, which is how this first read 1011 px against
	 * 743 and reported all 256 points moved.
	 *
	 * **Waiting for a *narrower* canvas is the desktop's rule, not the rule.**
	 * Below `FINDER_MIN_CHART_PX` the panel covers the chart instead of taking a
	 * column, so the cell never moves and `settled(0, closed - 1)` waits thirty
	 * seconds for something that will not happen. This waits for the width to
	 * stop changing, which is true of both layouts.
	 */
	const stableViewport = () =>
		page.waitForFunction(() => {
			const now = window.__seeliteGalaxyMap.viewport().width;
			const last = window.__seeliteSettleWidth;
			window.__seeliteSettleWidth = now;
			return last === now;
		});
	const openTheFinder = async (open) => {
		await open();
		await page.evaluate(() => {
			window.__seeliteSettleWidth = null;
		});
		await stableViewport();
		await nextFrames(page);
	};
	await openTheFinder(() =>
		page.evaluate(() => {
			document.querySelector('[data-map-finder-economy="0"]').click();
			window.__seeliteGalaxyMap.setFinderBudget(9);
		}),
	);
	const before = await chartSurface();

	for (const facility of FACILITY_CHIPS) {
		await clearFinder();
		await clickFacility(facility);
		await nextFrames(page);
		const state = await finderState();
		const drawn = await facilityRows();
		const capped = Math.min(state.inBudget.length, drawn.rows.length);
		// **`KNOWN FENCE` is expected to be empty here and the others are not.**
		// A fresh boot has docked nowhere, so no fence is checked — demanding
		// rows of all three failed on the one chip whose empty list is the
		// spec's own zero-known-match case, and demanding rows of none would
		// pass a build whose public chips returned nothing at all.
		const owesRows = facility !== "KNOWN FENCE";
		check(
			`${where}: the ${facility} chip expands the finder and draws the projection's rows`,
			state.expanded &&
				state.resultsShown &&
				drawn.filterFacilities.join(",") === facility &&
				drawn.rows.length === drawn.drawnCount &&
				(owesRows ? drawn.rows.length > 0 : drawn.rows.length === 0) &&
				drawn.rows
					.slice(0, capped)
					.every((row, i) => row.index === drawn.projected[i]?.index),
			`expanded ${state.expanded}, ${state.inBudget.length} projected, ${drawn.rows.length} drawn, first ${drawn.rows[0]?.index} against ${drawn.projected[0]?.index}`,
		);
		if (owesRows)
			check(
				`${where}: every ${facility} row annotates that role and only that role, and none is disabled`,
				drawn.rows.length > 0 &&
					drawn.rows.every(
						(row) =>
							row.annotations.length === 1 &&
							row.annotations[0].startsWith(`${facility} · `) &&
							!row.disabled,
					),
				`${drawn.rows.length} rows, first "${drawn.rows[0]?.annotations[0]}", disabled ${drawn.rows.filter((r) => r.disabled).length}`,
			);
	}

	/**
	 * §5.2.1's two readings, in one list.
	 *
	 * **The chip has to be one the start system carries**, and the seed decides
	 * which. A fresh boot has observed exactly that system, so the observed
	 * reading can only appear under a chip its own roster matches — written
	 * against `REFINERY` first, and the start system has a shipyard and no
	 * refinery, so sixty rows came back every one of them `STATUS UNKNOWN`.
	 * Both readings are demanded, because a build that rendered only one would
	 * pass a check that looked for either.
	 */
	await clearFinder();
	const observedChip = await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		for (const chip of document.querySelectorAll(
			"[data-map-finder-facility]",
		)) {
			const name = chip.dataset.mapFinderFacility;
			if (name === "KNOWN FENCE") continue;
			chip.click();
			map.setFinderBudget(9);
			const hit = map.state.finder.inBudget.some(
				(row) => row.index === map.state.currentIndex,
			);
			chip.click();
			map.setFinderBudget(1);
			if (hit) return name;
		}
		return null;
	});
	await clickFacility(observedChip ?? "SHIPYARD");
	await page.evaluate(() => window.__seeliteGalaxyMap.setFinderBudget(9));
	await nextFrames(page);
	const mixed = await facilityRows();
	const labels = mixed.rows.map((r) => r.annotations[0] ?? "");
	check(
		`${where}: an observed role and a never-observed one render distinctly in one list`,
		labels.some((l) => /·\s+SEEN .+ AGO$|·\s+SEEN JUST NOW$/.test(l)) &&
			labels.some((l) => l.endsWith("STATUS UNKNOWN")),
		`${observedChip}: ${labels.length} rows: ${[...new Set(labels)].slice(0, 4).join(" / ")}`,
	);

	/**
	 * §5.2.1: "Zero matches therefore means 'no known fence', never 'no fence
	 * exists'." A fresh boot has docked nowhere, so this is exactly the
	 * zero-known-match case, and the panel owes the count rather than silence.
	 */
	await clearFinder();
	await clickFacility("KNOWN FENCE");
	await page.evaluate(() => window.__seeliteGalaxyMap.setFinderBudget(9));
	await nextFrames(page);
	const fence = await facilityRows();
	const fenceState = await finderState();
	const fenceUnchecked = await page.evaluate(
		() => window.__seeliteGalaxyMap.state.finder.uncheckedFence,
	);
	check(
		`${where}: KNOWN FENCE prints its exact unchecked count with no known match to show`,
		fenceState.inBudget.length === 0 &&
			fence.unchecked !== null &&
			fence.unchecked.count === fenceUnchecked &&
			fence.unchecked.count > 0 &&
			fence.unchecked.says.includes(String(fence.unchecked.count)),
		`${fenceState.inBudget.length} known matches, panel says ${fence.unchecked?.count} against the projection's ${fenceUnchecked}, line "${fence.unchecked?.says}"`,
	);

	/**
	 * §9.4: "the same system-point set, colours, and visibility are measured
	 * before and after facility narrowing, so the chart remains geography-only."
	 *
	 * **Read *while* a chip is on, and again after clearing.** Written first as
	 * two readings either side of a `clearFinder`, it never looked at the chart
	 * under a narrowing at all — a build that moved or recoloured points while a
	 * chip was active and restored them on clear passed it, which is the whole
	 * failure the sentence names. The restored reading is kept as a second arm,
	 * because a build that changed the chart permanently is a different defect.
	 *
	 * Compared as strings so a single moved or recoloured point fails: a count
	 * cannot see a swap, which is the failure `output-stage`'s multisample check
	 * records having shipped once.
	 */
	await clearFinder();
	await openTheFinder(async () => {
		await clickFacility("REFINERY");
		await page.evaluate(() => window.__seeliteGalaxyMap.setFinderBudget(9));
	});
	const narrowed = await chartSurface();
	check(
		`${where}: facility narrowing leaves the chart's points, colours and visibility untouched`,
		narrowed.systemCount === before.systemCount &&
			narrowed.lit === before.lit &&
			narrowed.points === before.points,
		`${narrowed.systemCount} points under a facility chip against ${before.systemCount} under an economy chip, lit set ${narrowed.lit === before.lit ? "identical" : "CHANGED"}, positions ${narrowed.points === before.points ? "identical" : "CHANGED"}` +
			(narrowed.points === before.points
				? ""
				: ` — first difference ${(() => {
						const a = before.points.split("|");
						const b = narrowed.points.split("|");
						for (let i = 0; i < Math.max(a.length, b.length); i++)
							if (a[i] !== b[i]) return `${a[i]} vs ${b[i]}`;
						return "none";
					})()}, cell ${JSON.stringify(before.cell)} vs ${JSON.stringify(narrowed.cell)}`),
	);
	await clearFinder();
};

await facilityChecks("desktop");

/**
 * §5.2.1: "selecting one fills the existing system record card with the
 * complete station roster, exact observation times, and report sources."
 *
 * The **start system** is the one the boot relay observed, so it is the only
 * selection that can carry a time and a source at all; selecting an unvisited
 * one shows the roster with `STATUS UNKNOWN`. Both are asserted, because a card
 * that printed the roster and dropped the observation would satisfy either
 * alone.
 */
await clearFinder();
await clickFacility("REFINERY");
await page.evaluate(() => window.__seeliteGalaxyMap.setFinderBudget(9));
await nextFrames(page);
const cardReadings = await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	const read = (index) => {
		map.select(index);
		const card = document.querySelector("[data-map-record]");
		return card?.textContent ?? "";
	};
	const rows = map.state.finder.inBudget;
	return {
		hereText: read(map.state.currentIndex),
		awayText: read(
			(rows.find((r) => r.index !== map.state.currentIndex) ?? rows[0]).index,
		),
	};
});
check(
	"the record card carries the roster with exact observation times and sources",
	/@\s*\d+s/.test(cardReadings.hereText) &&
		/(system-relay|docking)/.test(cardReadings.hereText) &&
		/TRADE|REFINERY|SHIPYARD|OUTPOST/.test(cardReadings.hereText),
	`observed card: ${JSON.stringify(cardReadings.hereText.slice(0, 200))}`,
);
check(
	"an unobserved system's card still shows its public roster, marked unknown",
	/STATUS UNKNOWN/.test(cardReadings.awayText) &&
		/TRADE|REFINERY|SHIPYARD|OUTPOST/.test(cardReadings.awayText),
	`unobserved card: ${JSON.stringify(cardReadings.awayText.slice(0, 200))}`,
);
await clearFinder();

/**
 * **D6's session persistence, which is only visible across a remount.**
 *
 * The chart is disposed every time the player leaves the tab, so a budget held
 * in `mountGalaxyChart`'s closure would read as "persists" in every
 * single-mount check and reset the moment anyone actually used the map. That is
 * how it was built first. The query and the chips are asserted *not* to
 * survive, because D6 widens the budget alone and a check that only watched the
 * budget would pass a build that persisted the whole filter.
 */
await clearFinder();
await page.evaluate(() => {
	window.__seeliteGalaxyMap.setFinderQuery("ra");
	window.__seeliteGalaxyMap.setFinderBudget(4);
});
await clickTab("Navigation");
await page.waitForFunction(() => window.__seeliteGalaxyMap == null);
await clickTab("Galaxy Map");
await page.waitForFunction(() => window.__seeliteGalaxyMap != null);
const remounted = await finderState();
check(
	"a widened budget survives leaving and re-entering the tab; the query does not",
	remounted.filter.budgetJumps === 4 &&
		remounted.filter.query === "" &&
		remounted.filter.economies.length === 0 &&
		remounted.expanded,
	`budget ${remounted.filter.budgetJumps}, query "${remounted.filter.query}", ${remounted.filter.economies.length} chips, expanded ${remounted.expanded}`,
);
await clearFinder();

// ---- Crowding in the expanded cell (#115's first obligation) ---------------

/**
 * **The 64-82% band above is the *closed* cell's, and it does not carry.**
 *
 * Opening the finder takes a column off the chart, and crowding is a pixel
 * property, so the figure had to be re-measured rather than carried across. #96
 * is the recorded case of one changing under a different box — the workbench's
 * 40.2% became the console's 68.8% — and #118 is the recorded reason to band
 * from a spread rather than from one galaxy. **Here it did not move**, and the
 * check below says why: this cell crops rather than compressing. An earlier
 * draft of this paragraph said the figure "can only rise", which the check
 * twelve lines down disproves.
 *
 * `EXPANDED_CROWDING` at the top of this file carries the band and the whole of
 * its provenance. The measured figure is printed either way, so a change that
 * moved the projection shows up as a value moving rather than as silence.
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
	return window.__seeliteOnScreen();
});
await page.evaluate(() => {
	window.__seeliteGalaxyMap.setFinderQuery("a");
});
// **Checked before it is waited on.** `settled` is a `waitForFunction`, and a
// build that opened the panel as a cover at the desktop cell would never
// satisfy it — the probe would then die on a 30 s timeout instead of failing
// the check that is actually about it, which is the failure mode this file
// already records for a `waitForFunction` standing in for an assertion. Found
// by red-building exactly that.
const openMode = await finderLayout();
check(
	"the desktop console opens the finder as a column, so the cell narrows",
	openMode === "column",
	`layout "${openMode}" at ${Math.round(closedCell.width)}x${Math.round(closedCell.height)}`,
);
if (openMode === "column") await settled(0, closedCell.width - 100);
const openCell = await canvasBox();
const crowdingOpen = await page.evaluate(() => {
	return window.__seeliteCrowding();
});
const crop = await page.evaluate((before) => {
	const map = window.__seeliteGalaxyMap;
	const { width, height } = map.viewport();
	const now = new Map(window.__seeliteOnScreen().map((p) => [p.index, p]));
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
	// **All 256, not a floor of 200.** The comment above and `galaxy-map.md`
	// §5.2 both say this check requires the whole cluster on screen in both
	// states — and it did not: a translation moves the survivors identically, so
	// up to 55 systems could have left the box with the spread still under a
	// pixel. The precondition was being borrowed from the crowding check next
	// door rather than held here.
	crop.compared === crowding.systemCount &&
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
/**
 * **The column layout is a desktop claim, and the narrow console gets its own.**
 *
 * Everything above runs at 1280 x 760, where the panel takes a 268 px column
 * off a 1011 px cell and leaves 743. At the 390 px viewport the console's media
 * query drops to, the cell is 344 px and that same column would leave a
 * **76 px strip** — not a reading surface, and neither the crop mechanism nor
 * the crowding band was ever measured there. So below `FINDER_MIN_CHART_PX` the panel covers the
 * chart instead, and this measures both halves of that rule at the viewport it
 * is about rather than asserting it from the constant.
 */
await page.setViewportSize({ width: 390, height: 844 });
await nextFrames(page);
const narrowClosed = await canvasBox();
await page.evaluate(() => window.__seeliteGalaxyMap.setFinderQuery("a"));
await nextFrames(page);
const narrowOpen = await canvasBox();
const narrowGeometry = await page.evaluate(() => {
	const box = document
		.querySelector("[data-map-finder]")
		?.getBoundingClientRect();
	const stage = document
		.querySelector("[data-map-stage]")
		?.getBoundingClientRect();
	return { panelWidth: box?.width ?? 0, stageWidth: stage?.width ?? 0 };
});
const narrowLayout = {
	...narrowGeometry,
	mode: await finderLayout(),
};
check(
	"on a narrow console the open finder covers the chart rather than leaving a strip",
	narrowLayout.mode === "cover" &&
		Math.round(narrowOpen.width) === Math.round(narrowClosed.width) &&
		narrowLayout.panelWidth > 0.7 * narrowLayout.stageWidth,
	`layout "${narrowLayout.mode}", cell ${Math.round(narrowClosed.width)} closed and ${Math.round(narrowOpen.width)} open, panel ${Math.round(narrowLayout.panelWidth)} of ${Math.round(narrowLayout.stageWidth)}`,
);
/**
 * **Widened while the panel is open, which is the path the code claims and no
 * check exercised.**
 *
 * The first version cleared the filter before resizing, so it measured a fresh
 * open at the new width — a build whose layout never responded to a resize
 * would have passed it. The panel now watches the chart's box itself, because
 * the chart's own `ResizeObserver` sets a redraw flag rather than calling back
 * into the panel, and neither did anything about the layout.
 */
await page.setViewportSize({ width: 1280, height: 760 });
await nextFrames(page);
const grownMode = await finderLayout();
const grownState = await finderState();
check(
	"widening the console while the finder is open turns the cover back into a column",
	grownMode === "column" &&
		grownState.expanded &&
		grownState.filter.query === "a",
	`layout "${grownMode}", still open ${grownState.expanded} on query "${grownState.filter.query}"`,
);
// And back the other way, still open, so the transition is not one-directional.
await page.setViewportSize({ width: 390, height: 844 });
await nextFrames(page);
const shrunkMode = await finderLayout();
check(
	"narrowing it again while open turns the column back into a cover",
	shrunkMode === "cover",
	`layout "${shrunkMode}"`,
);
await facilityChecks("narrow console");
await page.setViewportSize({ width: 1280, height: 760 });
await nextFrames(page);
await clearFinder();

// ---- The hover label (#112, against #108's D1-D5) --------------------------

/**
 * **The shipped framing is where the crowding lives, so the checks live here.**
 *
 * §5.1 measures 68.4%-77.7% of hovers in this console cell as having a second
 * system inside the pick radius, against 39.8%-48.0% on the workbench page. A
 * hover label is therefore ambiguous most of the time *here* and only some of
 * the time there, which is why #108's receipt puts its five checks in this file
 * rather than on `probe-galaxy-map.mjs`.
 *
 * **Every cursor position below is off its system's projected centre.** A hit
 * test driven to a point's exact centre passes on a build whose radius
 * comparison is wrong at the boundary — the failure §5's own picking paragraph
 * records, and the reason §9.2 finds the pick boundary rather than clicking
 * dead centre.
 *
 * The pick radius is read off the page. The release radius and the switch
 * margin are **not**, and that is deliberate: #108 leaves both as retune
 * retunable and asks the browser tier to pin the behaviour instead. A probe
 * that stepped by the release radius it read off the build under test would
 * pass on a build with any release radius at all, which is the check-derived-
 * from-its-subject shape this file already records twice.
 */
await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	map.select(null);
	map.resetView();
});
await nextFrames(page);

/**
 * One configuration of cursor positions, chosen from the projection rather than
 * hard-coded, so nothing here goes red the day the generator moves a system.
 *
 * The whole thing is found in one pass because the pieces are not independent:
 * check 3 needs a *pair* close enough to trade the label, and the same pair
 * needs a direction to drift in where no third system is inside the pick radius
 * and a far position to be released onto. A configuration missing any of those
 * is not usable, so the search backtracks over pairs rather than picking a pair
 * and hoping.
 */
const plan = await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	const r = map.pickRadiusPx;
	const { width, height } = map.viewport();
	const pts = window.__seeliteOnScreen();
	const dist = (p, x, y) => Math.hypot(p.x - x, p.y - y);
	const within = (x, y) => pts.filter((p) => dist(p, x, y) < r);
	const nearest = (x, y) => {
		let best = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const p of within(x, y)) {
			const d = dist(p, x, y);
			if (d < bestD) {
				bestD = d;
				best = p;
			}
		}
		return best;
	};
	// **A margin wider than the pick radius, and it is no longer load-bearing.**
	// It was: `__seeliteOnScreen` discards systems outside the box and the hover
	// rule did not, so a cursor near an edge could be inside the radius of a
	// point this search cannot see. That was round 1's blocker and the module
	// shares the predicate now — the check below the finder section holds it.
	// The margin is kept because it also keeps the label's clamp off the edge,
	// so a text assertion is about the label and not about the clamp.
	const inset = 2 * r + 4;
	const inside = (x, y) =>
		x > inset && y > inset && x < width - inset && y < height - inset;

	/** The twelve off-centre cursor positions tried around one system, at 60% of
	 *  the pick radius. Off-centre because a hit test driven to a point's exact
	 *  projected centre passes on a build whose radius test is wrong at the
	 *  boundary. */
	const offCentre = function* (p) {
		for (let a = 0; a < 12; a++) {
			const angle = (a / 12) * Math.PI * 2;
			const x = p.x + Math.cos(angle) * r * 0.6;
			const y = p.y + Math.sin(angle) * r * 0.6;
			if (inside(x, y)) yield { x, y };
		}
	};

	/** Exactly one system inside the radius: the label must name it and carry no
	 *  badge. */
	const findUncontested = () => {
		for (const p of pts)
			for (const spot of offCentre(p)) {
				const hits = within(spot.x, spot.y);
				if (hits.length === 1 && hits[0].index === p.index)
					return { ...spot, index: p.index, expectedContested: 0 };
			}
		return null;
	};

	/** The most crowded off-centre position on offer. Three or more systems, so
	 *  the badge's number is a count rather than one a constant could match. */
	const findContested = () => {
		let best = null;
		for (const p of pts)
			for (const spot of offCentre(p)) {
				const hits = within(spot.x, spot.y);
				const near = nearest(spot.x, spot.y);
				if (near === null || hits.length < 3) continue;
				if (best === null || hits.length - 1 > best.expectedContested)
					best = {
						...spot,
						index: near.index,
						expectedContested: hits.length - 1,
					};
			}
		return best;
	};

	/**
	 * A pair close enough to trade the label, with somewhere to drift to.
	 *
	 * `park` sits 0.5 px on S's side of the perpendicular bisector of S and T,
	 * so S is nearer by 1 px. `step` is exactly 1 px further along S -> T, which
	 * puts T nearer by 1 px — nearer, and by less than any switch margin worth
	 * having. A nearest-wins build changes the name between those two positions;
	 * a build with hysteresis does not.
	 *
	 * `drift` is 16 px from S with nothing else inside the pick radius: past the
	 * 14 px a fresh pick would allow, and the half of the hold the switch margin
	 * does not cover. A pair with no such direction is not usable, so this
	 * backtracks over pairs rather than picking one and hoping.
	 */
	const findHysteresis = () => {
		for (const s of pts)
			for (const t of pts) {
				if (t.index === s.index) continue;
				const sep = Math.hypot(t.x - s.x, t.y - s.y);
				if (sep < 4 || sep > 12) continue;
				const ux = (t.x - s.x) / sep;
				const uy = (t.y - s.y) / sep;
				const park = {
					x: (s.x + t.x) / 2 - ux * 0.5,
					y: (s.y + t.y) / 2 - uy * 0.5,
				};
				const step = { x: park.x + ux, y: park.y + uy };
				if (!inside(park.x, park.y) || !inside(step.x, step.y)) continue;
				if (nearest(park.x, park.y)?.index !== s.index) continue;
				if (nearest(step.x, step.y)?.index !== t.index) continue;
				let drift = null;
				for (let a = 0; a < 36 && drift === null; a++) {
					const angle = (a / 36) * Math.PI * 2;
					const x = s.x + Math.cos(angle) * 16;
					const y = s.y + Math.sin(angle) * 16;
					if (!inside(x, y) || within(x, y).length !== 0) continue;
					drift = { x, y };
				}
				if (drift === null) continue;
				return {
					park,
					step,
					held: s.index,
					rival: t.index,
					separationPx: sep,
					drift,
				};
			}
		return null;
	};

	/**
	 * Where the release half of check 3 moves to.
	 *
	 * **Not just any uncontested spot.** Written that way first, and round 2
	 * caught it: `findUncontested` only asks for one system inside the radius,
	 * so nothing stopped it returning a spot a few pixels from the held system —
	 * and the label changing there would be an ordinary switch rather than a
	 * release, which is a check passing for the wrong reason. The floor is 60 px,
	 * well past any release radius worth having and **not** the release radius
	 * itself: a probe that moved by the constant it was checking would pass on a
	 * build with any value of it.
	 */
	const findRelease = (from) => {
		for (const p of pts)
			for (const spot of offCentre(p)) {
				if (Math.hypot(spot.x - from.x, spot.y - from.y) < 60) continue;
				const hits = within(spot.x, spot.y);
				if (hits.length === 1 && hits[0].index === p.index)
					return { ...spot, index: p.index, expectedContested: 0 };
			}
		return null;
	};

	const hysteresis = findHysteresis();
	return {
		r,
		width,
		height,
		uncontested: findUncontested(),
		contested: findContested(),
		hysteresis,
		release: hysteresis === null ? null : findRelease(hysteresis.park),
	};
});

/**
 * **The configuration is a checked precondition, not an assumption.**
 *
 * Every check below reads one of these three, so a framing that offered none of
 * them would leave the section silently doing nothing. `probe-galaxy-map.mjs`
 * records the same discipline for its skipped-everywhere aspect check.
 */
check(
	"the shipped framing offers an uncontested spot, a contested one, a pair close enough to trade the label, and somewhere well beyond it to be released onto",
	plan.uncontested !== null &&
		plan.contested !== null &&
		plan.hysteresis !== null &&
		plan.release !== null,
	`uncontested ${JSON.stringify(plan.uncontested)}, contested ${JSON.stringify(plan.contested)}, pair ${plan.hysteresis && `${plan.hysteresis.held}/${plan.hysteresis.rival} ${plan.hysteresis.separationPx.toFixed(2)} px apart`}, release ${JSON.stringify(plan.release)}`,
);

/** A system's name, through the handle the game already has. `projected()`
 *  carries indices alone, and the label's text is asserted as text. */
const nameOf = (index) =>
	page.evaluate((i) => {
		const map = window.__seeliteGalaxyMap;
		const was = map.state.selectedIndex;
		map.select(i);
		const name = map.state.record?.name ?? null;
		map.select(was);
		return name;
	}, index);

/** Move the real pointer to a canvas-relative position, and read back both the
 *  hover state and the drawn label. */
const hoverAt = async (spot) => {
	const box = await page.evaluate(() => window.__seeliteGalaxyMap.viewport());
	await page.mouse.move(box.left + spot.x, box.top + spot.y);
	await nextFrames(page);
	return page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		const el = document.querySelector("[data-map-hover]");
		return {
			hovered: map.hovered(),
			shown: el !== null && el.style.display !== "none",
			text: el?.textContent ?? "",
			selectedIndex: map.state.selectedIndex,
		};
	});
};

if (plan.uncontested && plan.contested && plan.hysteresis && plan.release) {
	// ---- 1. It names the right system ------------------------------------
	const quietName = await nameOf(plan.uncontested.index);
	const quiet = await hoverAt(plan.uncontested);
	check(
		"a hover at an uncontested position names that system, and says it in the label",
		quiet.hovered?.index === plan.uncontested.index &&
			quiet.shown &&
			quiet.text.startsWith(`${quietName} `) &&
			/\d+\.\d LY/.test(quiet.text) &&
			/(in range|out of range)/.test(quiet.text),
		`hovered ${JSON.stringify(quiet.hovered)} against ${plan.uncontested.index} (${quietName}), label "${quiet.text}"`,
	);

	// ---- 2. The badge is real, in both directions -------------------------
	const crowded = await hoverAt(plan.contested);
	check(
		"the badge counts the systems the cursor cannot tell apart here, and is absent where there are none",
		crowded.hovered?.contested === plan.contested.expectedContested &&
			crowded.hovered.contested >= 2 &&
			crowded.text.includes(`(${plan.contested.expectedContested} more)`) &&
			quiet.hovered?.contested === 0 &&
			!quiet.text.includes("more)"),
		`contested ${crowded.hovered?.contested} against the ${plan.contested.expectedContested} the same arithmetic gives, label "${crowded.text}"; uncontested ${quiet.hovered?.contested}, label "${quiet.text}"`,
	);

	// ---- 3. Hysteresis holds, and releases --------------------------------
	const heldName = await nameOf(plan.hysteresis.held);
	const parked = await hoverAt(plan.hysteresis.park);
	const stepped = await hoverAt(plan.hysteresis.step);
	const drifted = await hoverAt(plan.hysteresis.drift);
	const released = await hoverAt(plan.release);
	check(
		"a 1 px step onto a nearer neighbour does not move the label, and neither does drifting past the pick radius",
		parked.hovered?.index === plan.hysteresis.held &&
			stepped.hovered?.index === plan.hysteresis.held &&
			stepped.text.startsWith(`${heldName} `) &&
			drifted.hovered?.index === plan.hysteresis.held,
		`parked ${parked.hovered?.index}, after a 1 px step toward ${plan.hysteresis.rival} it is ${stepped.hovered?.index} ("${stepped.text}"), 16 px off it is ${drifted.hovered?.index}; expected ${plan.hysteresis.held} (${heldName}) throughout`,
	);
	// **Both directions, on the same pair.** A label that never changes at all
	// passes the half above, which is why #108 writes check 3 as two claims.
	const releaseDistancePx = Math.hypot(
		plan.release.x - plan.hysteresis.park.x,
		plan.release.y - plan.hysteresis.park.y,
	);
	check(
		"a move well past the release radius does let the label go",
		released.hovered?.index === plan.release.index &&
			released.hovered.index !== plan.hysteresis.held &&
			// **The distance is asserted, not merely reported.** Without it this
			// passes through an ordinary switch to a system a few pixels away,
			// which proves nothing about releasing.
			releaseDistancePx >= 60,
		`after moving ${Math.round(releaseDistancePx)} px from the held system the label is ${released.hovered?.index}, expected ${plan.release.index}`,
	);

	// ---- 4. The click agrees with the label -------------------------------
	/**
	 * **Driven to the position where the two answers differ.**
	 *
	 * At a plain contested position the held candidate and a fresh `pick()`
	 * return the same system, so a build that re-ran `pick()` on `pointerup`
	 * would pass. The discriminating position is the one check 3 just
	 * established: park on S, step 1 px so T is nearer, and the label still says
	 * S while `pick()` would now say T. That is the two-implementations drift
	 * D1 routes the click through the hover candidate to prevent, and it is the
	 * only position on the chart where the two can be told apart.
	 */
	await page.evaluate(() => window.__seeliteGalaxyMap.select(null));
	await hoverAt(plan.hysteresis.park);
	const beforeClick = await hoverAt(plan.hysteresis.step);
	const box = await page.evaluate(() => window.__seeliteGalaxyMap.viewport());
	await page.mouse.down();
	await page.mouse.up();
	await nextFrames(page);
	const clicked = await page.evaluate(
		() => window.__seeliteGalaxyMap.state.selectedIndex,
	);
	check(
		"the click selects the system the label named, not the one nearest the cursor",
		beforeClick.hovered?.index === plan.hysteresis.held &&
			clicked === plan.hysteresis.held &&
			plan.hysteresis.held !== plan.hysteresis.rival,
		`label said ${beforeClick.hovered?.index}, nearest was ${plan.hysteresis.rival}, click selected ${clicked} at ${Math.round(box.left + plan.hysteresis.step.x)},${Math.round(box.top + plan.hysteresis.step.y)}`,
	);

	// ---- 5. A drag says nothing -------------------------------------------
	/**
	 * Press, orbit, release — and the label is read *during* the orbit rather
	 * than after it. Sampling only at the end would pass on a build that drew
	 * the label through the whole drag and cleared it on `pointerup`, which is
	 * the noise D4 is about.
	 */
	await page.evaluate(() => window.__seeliteGalaxyMap.select(null));
	await hoverAt(plan.contested);
	await page.mouse.down();
	const duringDrag = [];
	for (let i = 1; i <= 4; i++) {
		await page.mouse.move(
			box.left + plan.contested.x + i * 12,
			box.top + plan.contested.y + i * 7,
		);
		await nextFrames(page);
		duringDrag.push(
			await page.evaluate(() => {
				const el = document.querySelector("[data-map-hover]");
				return {
					hovered: window.__seeliteGalaxyMap.hovered(),
					shown: el !== null && el.style.display !== "none",
				};
			}),
		);
	}
	await page.mouse.up();
	await nextFrames(page);
	const afterDrag = await page.evaluate(() => {
		const el = document.querySelector("[data-map-hover]");
		return {
			hovered: window.__seeliteGalaxyMap.hovered(),
			shown: el !== null && el.style.display !== "none",
			selectedIndex: window.__seeliteGalaxyMap.state.selectedIndex,
		};
	});
	check(
		"an orbit shows no label at any point, and releasing it selects nothing",
		duringDrag.length === 4 &&
			duringDrag.every((s) => s.hovered === null && !s.shown) &&
			afterDrag.hovered === null &&
			!afterDrag.shown &&
			afterDrag.selectedIndex === null,
		`${duringDrag.map((s) => `${s.hovered === null ? "none" : s.hovered.index}/${s.shown ? "shown" : "hidden"}`).join(" ")}, after release ${afterDrag.hovered === null ? "none" : afterDrag.hovered.index}, selection ${afterDrag.selectedIndex}`,
	);

	// ---- 6 (§9.3 item 22). The projection can move without the pointer ----
	/**
	 * **A wheel zoom moves every system under a perfectly still cursor.**
	 *
	 * Round 3's finding, and it was a real one: the candidate was rebuilt only on
	 * `pointermove`, so after a zoom the label named — and a click selected — a
	 * system that had slid out from under the cursor. The same hole was open for
	 * the finder's centre control, `resetView` and a panel resize; the fix is one
	 * rule (recompute on the frame) rather than a clear on each of the four.
	 *
	 * The assertion is against what the *new* projection puts under that cursor,
	 * computed here from `projected()`. The held system's post-zoom distance is
	 * asserted past 60 px as well, so the expectation is unambiguous: at that
	 * distance no release radius worth having still holds it, and a build that
	 * merely blinked the label off would also pass — which is fine, since either
	 * is honest and only the stale one is not.
	 */
	// **Back to the default framing first.** Check 5's orbit left the camera
	// somewhere else, and `plan`'s positions are the default framing's — the
	// first version of this check skipped the reset and hovered a different
	// system than the one it went on to assert about.
	await page.evaluate(() => {
		window.__seeliteGalaxyMap.select(null);
		window.__seeliteGalaxyMap.resetView();
	});
	await nextFrames(page);
	const beforeZoom = await hoverAt(plan.uncontested);
	// To the near stop, not a nudge: -40 LY moved this system only 53 px, which
	// is inside a plausible release radius and would have made the expectation
	// below ambiguous rather than wrong.
	await page.evaluate(() => window.__seeliteGalaxyMap.zoom(-50));
	await nextFrames(page);
	const afterZoom = await page.evaluate((spot) => {
		const map = window.__seeliteGalaxyMap;
		const r = map.pickRadiusPx;
		const { width, height } = map.viewport();
		const pts = map
			.projected()
			.filter(
				(p) =>
					!p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
			);
		let best = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const p of pts) {
			const d = Math.hypot(p.x - spot.x, p.y - spot.y);
			if (d < r && d < bestD) {
				bestD = d;
				best = p.index;
			}
		}
		const held = pts.find((p) => p.index === spot.index);
		return {
			expected: best,
			hovered: map.hovered(),
			heldDistancePx:
				held === undefined
					? Number.POSITIVE_INFINITY
					: Math.hypot(held.x - spot.x, held.y - spot.y),
		};
	}, plan.uncontested);
	check(
		"a zoom under a still pointer re-answers the label rather than leaving it on the system that moved away",
		beforeZoom.hovered?.index === plan.uncontested.index &&
			afterZoom.heldDistancePx > 60 &&
			(afterZoom.hovered?.index ?? null) === afterZoom.expected,
		`before the zoom the label was ${beforeZoom.hovered?.index}; after it that system is ${afterZoom.heldDistancePx.toFixed(0)} px from the unmoved cursor, the label is ${afterZoom.hovered?.index ?? null} and the new projection puts ${afterZoom.expected} there`,
	);
	await page.evaluate(() => window.__seeliteGalaxyMap.resetView());
	await nextFrames(page);

	// ---- 7 (§9.3 item 23). A system the chart does not draw is not nameable
	/**
	 * **Round 1's blocker, and it was in `pick` before it was in the hover.**
	 *
	 * `toPixels` maps NDC linearly, so a system just off an edge lands a few
	 * pixels outside the canvas box and is rasterised by nothing — while still
	 * being inside the 14 px radius of a cursor just inside that edge. The
	 * label put a name on a system the player cannot see, and `pointerup` then
	 * selected it. `pick` had done the selecting half since #11; a click on an
	 * invisible system reads as a click on empty space, which is why nothing
	 * noticed until there was a label.
	 *
	 * Driven at a zoomed framing, because the default one frames all 256 and has
	 * no off-screen system to name. The position is chosen so the off-screen
	 * system is **nearer than anything on screen**, which is what makes this red
	 * on the build that only skipped `behind`.
	 */
	await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		map.select(null);
		map.resetView();
		map.zoom(-40);
	});
	await nextFrames(page);
	const edge = await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		const r = map.pickRadiusPx;
		const { width, height } = map.viewport();
		const all = map.projected().filter((p) => !p.behind);
		const on = (p) => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
		for (const off of all) {
			if (on(off)) continue;
			// A cursor 3 px inside whichever edge this system fell off, on the
			// same row or column, so it is a few pixels from the point.
			const x = Math.min(Math.max(off.x, 3), width - 3);
			const y = Math.min(Math.max(off.y, 3), height - 3);
			const d = Math.hypot(off.x - x, off.y - y);
			if (d >= r) continue;
			const nearerOnScreen = all
				.filter(on)
				.some((p) => Math.hypot(p.x - x, p.y - y) <= d);
			if (nearerOnScreen) continue;
			return {
				x,
				y,
				index: off.index,
				distancePx: d,
				onScreen: all.filter(on).length,
			};
		}
		return null;
	});
	check(
		"the zoomed framing puts a system just off the canvas, within the pick radius of a cursor inside it",
		edge !== null,
		`${JSON.stringify(edge)}`,
	);
	if (edge) {
		const atEdge = await hoverAt(edge);
		await page.mouse.down();
		await page.mouse.up();
		await nextFrames(page);
		const selectedAtEdge = await page.evaluate(
			() => window.__seeliteGalaxyMap.state.selectedIndex,
		);
		check(
			"a system the chart does not draw is neither labelled nor selected, though it is the nearest thing to the cursor",
			atEdge.hovered?.index !== edge.index && selectedAtEdge !== edge.index,
			`off-screen system ${edge.index} is ${edge.distancePx.toFixed(1)} px from the cursor and nearest; label said ${atEdge.hovered === null ? "nothing" : atEdge.hovered.index}, click selected ${selectedAtEdge} (${edge.onScreen} of 256 drawn)`,
		);
	}

	await page.evaluate(() => {
		window.__seeliteGalaxyMap.select(null);
		window.__seeliteGalaxyMap.resetView();
	});
}

/**
 * §5.2.1: "Opening the Galaxy Map is never an information channel."
 *
 * The chart takes `knowledge` as a value and has no writer, so this is true by
 * construction — and the construction is exactly what a later node could
 * change without noticing, which is why it is measured rather than argued. The
 * whole galaxy's knowledge is serialised either side of a full leave-and-return
 * of the chart tab, so a row added, refreshed or re-sourced anywhere fails it.
 */
const knowledgeSnapshot = () =>
	page.evaluate(() =>
		JSON.stringify(
			window.__seelite.commerceWorld.galaxies.map((g) => g.knowledge),
		),
	);
const knowledgeBefore = await knowledgeSnapshot();
await clickTab("Navigation");
await page.waitForFunction(() => window.__seeliteGalaxyMap == null);
await clickTab("Galaxy Map");
await page.waitForFunction(() => window.__seeliteGalaxyMap != null);
await nextFrames(page);
await page.evaluate(() => {
	const map = window.__seeliteGalaxyMap;
	map.setFinderBudget(9);
	map.select(map.state.litIndices[0] ?? map.state.currentIndex);
});
await nextFrames(page);
const knowledgeAfter = await knowledgeSnapshot();
check(
	"opening the map, browsing it and selecting a system changes no knowledge row",
	knowledgeBefore === knowledgeAfter && knowledgeBefore.length > 2,
	`${knowledgeBefore.length} bytes of knowledge before, ${knowledgeAfter.length} after, ${knowledgeBefore === knowledgeAfter ? "identical" : "CHANGED"}`,
);
await clearFinder();

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
