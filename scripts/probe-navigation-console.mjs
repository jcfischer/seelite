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
	check(
		"the query narrows the list to the ids that match it",
		filtered.rows.length > 0 &&
			filtered.rows.length < listed.rows.length &&
			filtered.rows.every((row) =>
				row.id.toLowerCase().includes(prefix.toLowerCase()),
			),
		`"${prefix}" → ${filtered.rows.map((r) => r.id).join(",")}`,
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
// **The basis is asserted, not assumed.** `fraction` is
// `crowded / visible.length`, so a build that framed only 101 systems would
// still satisfy a `> 100` floor while the "of 256" the spec quotes had quietly
// stopped holding — and a fraction over a smaller, sparser denominator is a
// different measurement wearing the same name.
check(
	"the chart in the console is crowded enough that the list is mandatory",
	crowding.onScreen === crowding.systemCount &&
		crowding.fraction >= 0.55 &&
		crowding.fraction <= 0.8,
	`${(crowding.fraction * 100).toFixed(1)}% of ${crowding.onScreen}/${crowding.systemCount} on screen at ${Math.round(crowding.width)}x${Math.round(crowding.height)}`,
);

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
