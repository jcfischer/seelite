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
			// **The module's own allowlist, read off the chips it renders.** A
			// denylist here (`kind !== "moon"`) would be a second copy of the
			// rule, and a fourth body kind would make the two disagree and turn
			// this red without the list being wrong.
			listableCount: game.world.system.bodies.filter((b) =>
				[...document.querySelectorAll("[data-live-nav-kind]")]
					.map((chip) => chip.dataset.liveNavKind)
					.includes(b.kind),
			).length,
		};
	});

await lookLeft();
await page.waitForFunction(
	() => document.querySelectorAll("[data-live-nav-target]").length > 0,
);

const listed = await readList();
check(
	"the Navigation tab lists every selectable body in the system",
	listed.rows.length === listed.listableCount && listed.rows.length > 1,
	`${listed.rows.length} rows against ${listed.listableCount} listable`,
);
check(
	"rows are ordered by the simulation's own ranges, nearest first",
	listed.rows.every(
		(row, i) =>
			row.trueRangeKm !== null &&
			(i === 0 || row.trueRangeKm >= listed.rows[i - 1].trueRangeKm),
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

const framesBefore = await page.evaluate(() => window.__seelite.frames);
await clickTab("Galaxy Map");
await page.waitForFunction(() => Boolean(window.__seeliteGalaxyMap));

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
		gameSystemIndex: window.__seelite.world.system.record.index,
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
check(
	"the chart is centred on the system the ship is actually in",
	chart.currentIndex === chart.gameSystemIndex,
	`chart ${chart.currentIndex} against game ${chart.gameSystemIndex}`,
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
