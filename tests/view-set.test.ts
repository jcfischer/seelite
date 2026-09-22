/**
 * The canonical view set — #104's declaration half.
 *
 * The capture script is a browser tool and cannot be tested here. What *can* be
 * tested is the thing that decides whether a contact sheet is worth looking at:
 * which views exist, which lever each one is evidence for, and whether the sheet
 * a run emits is complete.
 *
 * The failure this file exists to catch is a **sheet with a hole that looks
 * whole**. #98's gate is a human saying yes to a picture, so a sheet missing the
 * one view that would have shown a regression still gets a yes — and unlike a
 * probe, nothing about it looks red. A missing view has to be an error at the
 * point the sheet is built, not something the reviewer is expected to notice.
 *
 * The second failure is a lever with no view. Six levers were charted under #98
 * and the set is supposed to cover every surface they touch; a lever added to
 * the map with no view pointed at it would be judged on somebody else's frame.
 */
import { describe, expect, test } from "bun:test";
import type { TreeDeclaration } from "../scripts/lib/tree-declaration.mjs";
import { makeWorld } from "../src/sim.ts";
import { STATION_GEOMETRY } from "../src/station.ts";
import {
	FIXTURE,
	GAME_TIME_S,
	LEVERS,
	SEED,
	SHOT_KINDS,
	VIEWPORT,
	VIEWS,
	contactSheet,
	malformedShots,
	uncoveredLevers,
} from "../scripts/lib/view-set.mjs";

/** A manifest as `capture-views.mjs` writes one, for a run that captured everything. */
type ViewShot = { name: string; file: string; gameTime?: number };
/** The producer's own type, imported rather than restated — `allowJs` resolves
 *  the JSDoc typedef, so a shape change in the plugin goes red here. */
type Served = TreeDeclaration;

const fullRun = (
	label: string,
): {
	label: string;
	gitRef: string;
	capturedAt: string;
	renderer: string;
	seed: number;
	served?: Served;
	views: ViewShot[];
} => ({
	label,
	gitRef: "abc1234",
	capturedAt: "2026-08-28T12:00:00.000Z",
	renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
	seed: SEED,
	served: {
		root: "/Users/someone/work/seelite",
		head: "9f3c1a2b4d5e6f708192a3b4c5d6e7f809a1b2c3",
		branch: "main",
		dirty: false,
	},
	views: VIEWS.map((v, i) => ({
		name: v.name,
		file: `${label}/${v.name}.png`,
		gameTime: 0.6 + i * 0.4,
	})),
});

describe("the view set itself", () => {
	/**
	 * **This replaces an ordering rule, and the reversal is the point.**
	 *
	 * The row here used to assert that a view declaring its own seed is followed
	 * only by views that navigate — `refinery-cradle-berth` carried `seed: 2`,
	 * its placer navigated, and the page was left on that seed, so anything
	 * after it expecting `SEED` 47 would have been framed in the wrong system.
	 * That rule held because the one exception sat second to last. #210 needs a
	 * second exception and wants it beside the other planet views, so the
	 * mechanism moved instead of the list: `capture-views.mjs` restores the seed
	 * a view declares — `SEED` when it declares none — *before* each view, so no
	 * view can inherit another's world and position carries no meaning.
	 *
	 * **A source assertion, and weaker than what it replaced.** The old rule was
	 * a property of data this file imports; this is a claim about a script that
	 * only runs headed, against a browser, and nothing here can execute it. What
	 * it does catch is the specific regression that would make the new mechanism
	 * silently useless — the restore being dropped, or a placer going back to
	 * navigating on its own — which is the failure the old rule existed for. The
	 * proof that it works is a capture run, and it is a person's to read.
	 */
	test("every view is captured on the seed it declares, whatever its position", async () => {
		const source = await Bun.file(
			new URL("../scripts/capture-views.mjs", import.meta.url),
		).text();
		// The restore is per view and takes the view's own seed, defaulting to
		// the fixture's. Matched against the capture loop alone rather than the
		// whole file: bun prints the received value on a failure, and a
		// whole-file `toContain` prints the whole file, which buries the one
		// line that moved. Whitespace-collapsed, because a formatter owns the
		// line breaks and a formatting change must not be a red run here.
		// Sliced to a structural end marker rather than a character count: a
		// fixed window couples the assertion to the loop's comment length, so an
		// unrelated edit above the target moves it out of range and fails a
		// mechanism that still works.
		const from = source.indexOf("for (const view of VIEWS) {");
		const to = source.indexOf("const subject =", from);
		expect(from).toBeGreaterThan(0);
		expect(to).toBeGreaterThan(from);
		const loop = source.slice(from, to).replace(/\s+/g, " ");
		// Both halves of the fixture a row may declare, restored by one call: the
		// seed, and the system since #432 — hence `ensureFixture` rather than
		// `ensureSeed`, because the name is pinned here and a name that describes
		// half of what a function guarantees is a name that misleads at the call
		// site. A row that names a system and a loop that drops it is a caption on
		// a start-system frame.
		//
		// A pattern and not a `toContain`, because the longer name is what the
		// formatter decides to wrap, and whitespace after `(` is exactly the kind
		// of change this row must stay silent about.
		expect(loop).toMatch(
			/await ensureFixture\(\s*page,\s*view\.shot\.seed \?\? SEED,\s*view\.shot\.system \?\? null,?\s*\);/,
		);
		// And no placer navigates on a fixture of its own any more. `PLACERS` is
		// the object the loop dispatches through, so a `shot.seed` read inside it
		// is exactly the mechanism that came out — and the same trap exists for
		// the system, so it is refused in the same breath.
		const placers = source.slice(
			source.indexOf("const PLACERS = {"),
			source.indexOf("\n};", source.indexOf("const PLACERS = {")),
		);
		expect(placers.length).toBeGreaterThan(200);
		expect(placers).not.toContain("shot.seed");
		expect(placers).not.toContain("shot.system");
	});

	/** Three views name their own seed, and every one does it because the
	 *  fixture cannot supply its subject: seed 47 generates no refinery and no
	 *  gas giant. Two of the three are the same gas giant at two ranges —
	 *  `ringed-giant` at six radii for #210's pair of shadows, `giant-fill` at
	 *  two for #209's band tones and limb. */
	test("the views that declare a seed are the ones the fixture cannot frame", () => {
		const declared = VIEWS.filter(
			(v) => (v.shot as { seed?: number }).seed !== undefined,
		).map((v) => [v.name, (v.shot as { seed?: number }).seed]);
		expect(declared).toEqual([
			["station-refinery-axis", 2],
			["ringed-giant", 5],
			["giant-fill", 5],
			["refinery-cradle-berth", 2],
		]);
		// Half the reason, held here. The other half — that the fixture has no
		// refinery — is already stronger than an assertion: `FIXTURE.stations`
		// is a frozen literal, so `role === "refinery"` is a type error rather
		// than a failing expectation, and tsc refuses to compile the check.
		expect(FIXTURE.planets.every((p) => !p.gasGiant)).toBe(true);
	});

	test("declares twenty-eight views with unique kebab-case names", () => {
		// Eight after #129 added `station-flank`, fifteen since #147 added
		// §13.6's seven-frame acceptance set, seventeen since #144 added the two
		// station-port views #134 ratified, eighteen since #206 added
		// `planet-fill`, nineteen since #210 added `ringed-giant`, twenty since
		// #209 added `giant-fill`, twenty-two since #300 gave the shipyard and
		// the refinery a frame from their own aperture axis, twenty-four since
		// #324 added the duel's glass and console, twenty-six since #324 part d
		// added the canisters and the raider log, twenty-eight since #372 added
		// the Controls tab open and folded. (#432 added a twenty-ninth — a rim row
		// aimed along the Core bearing — and removed it in the same PR, on the
		// principal's reading of the frame plus the density arm in
		// `measure-sky-density.ts`. The count did not move, and the row's absence
		// is explained where it stood rather than here.) A literal and not
		// `VIEWS.length`, which is
		// the whole point: a view deleted by accident has to be a red run, and a
		// check derived from its own subject cannot be one.
		expect(VIEWS.length).toBe(28);
		const names = VIEWS.map((v) => v.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
	});

	test("every view carries a caption and a known shot kind", () => {
		for (const view of VIEWS) {
			expect(view.what.length).toBeGreaterThan(0);
			expect(SHOT_KINDS).toContain(view.shot.kind);
			expect(["cockpit", "chase"]).toContain(view.shot.view);
		}
	});

	/**
	 * The kind alone is not enough — see `malformedShots`. Asserted against the
	 * real set *and* against a broken one, because a check run only over a frozen
	 * literal proves the literal is well formed today and nothing about the rule.
	 */
	test("every shot carries the payload its kind needs", () => {
		expect(malformedShots(VIEWS)).toEqual([]);
	});

	test("a shot missing its kind's payload is named", () => {
		expect(
			malformedShots([
				{
					name: "no-angle",
					shot: { kind: "body-offset", body: "x", radii: 4 },
				},
				{ name: "no-radii", shot: { kind: "station-axis", station: "trade" } },
				{ name: "bad-kind", shot: { kind: "improvised" } },
				// **A `system` that is not an index** (#432). `?system=` refuses an
				// index the galaxy does not have — politely, on the page, where the
				// refusal is a console warning and the start system boots anyway. A
				// fractional or stringy value in a row would therefore produce the
				// wrong picture wearing the right caption, which is the one failure
				// this function exists to make a name instead of a squint.
				{
					name: "system-not-an-index",
					shot: { kind: "deep-sky", system: 161.5 },
				},
				// A whole-number system on a row that does not use one is well
				// formed: `system` is a boot parameter and not a kind's payload.
				{
					name: "somewhere-else",
					shot: {
						kind: "berth",
						station: "trade",
						berth: "overhead-deep",
						system: 3,
					},
				},
				{ name: "fine", shot: { kind: "deep-sky" } },
			]),
		).toEqual(["no-angle", "no-radii", "bad-kind", "system-not-an-index"]);
	});

	test("every covered id is a lever on the map", () => {
		for (const view of VIEWS)
			for (const id of view.covers) expect(LEVERS[id]).toBeDefined();
	});

	/**
	 * **#134's two views, and the part of them a test can hold.**
	 *
	 * Not the framing numbers: #104 sets every `radii` by opening the PNG, so
	 * pinning one here would make a deliberate re-framing a red run rather than a
	 * decision. What is asserted is what #134 ratified and #129 measured the
	 * absence of — that lever 102 is judged on a station seen **off** its
	 * aperture axis, once at range on a trade station and once on a shipyard,
	 * which is the hole the set had.
	 */
	test("the two range views judge lit windows off the aperture axis", () => {
		const byName = new Map(VIEWS.map((v) => [v.name, v]));
		const shotOf = (name: string) => {
			const view = byName.get(name);
			expect(view).toBeDefined();
			return {
				covers: view?.covers ?? [],
				shot: (view?.shot ?? {}) as {
					kind?: string;
					body?: string;
					radii?: number;
				},
			};
		};
		const range = shotOf("station-range");
		const shipyard = shotOf("station-shipyard-flank");
		for (const view of [range, shipyard]) {
			expect(view.covers).toContain(102);
			// A `station-axis` shot points down the one face a station's ports are
			// deliberately kept off (#129), so neither of these may be one.
			expect(view.shot.kind).toBe("body-offset");
		}
		expect(range.shot.body).toBe("station-trade");
		expect(shipyard.shot.body).toBe("station-shipyard");
		// And the range view is the far one. That is its whole reason: every other
		// station framing in the set stands close, so before it nothing judged
		// lit-window density from further out than eight radii.
		//
		// **Both ways a view names a station**, because the two kinds spell it
		// differently: a `body-offset` carries `body: "station-trade"` and a
		// `station-axis` carries `station: "trade"`. Reading only `body` would let
		// a farther axis frame past the guard while it still reported green.
		const stationRadii = VIEWS.map(
			(v) => v.shot as { body?: string; station?: string; radii?: number },
		)
			.filter(
				(s) =>
					String(s.body ?? "").startsWith("station-") ||
					s.station !== undefined,
			)
			.map((s) => s.radii ?? 0);
		// Guarded, so the comparison cannot pass by both sides being absent.
		expect(typeof range.shot.radii).toBe("number");
		expect(Math.max(...stationRadii)).toBe(range.shot.radii ?? 0);
	});

	/**
	 * **#206's two planet views, and the part of them a test can hold.**
	 *
	 * Not the framing number — `radii` is apparent size and this module's own
	 * docstring says nothing here checks it. What is asserted is the *relation*
	 * the pair exists for: the set judges a planet surface at two apparent
	 * sizes, and `planet-fill` is the near one. Before it, the closest anything
	 * in the set stood to a subject was three radii, where a planet is a disc
	 * with sky around it and its surface detail is a few hundred pixels wide.
	 *
	 * The floor is asserted over **every** `body-offset` view rather than over
	 * the two planet ones, for the reason the `station-range` row reads both
	 * spellings of a station name: a later view added closer than this one
	 * would silently take the role this claims, and the sheet would carry two
	 * views both described as the near frame.
	 */
	test("the two planet views judge a surface at two apparent sizes", () => {
		const byName = new Map(VIEWS.map((v) => [v.name, v]));
		const planetView = (name: string) => {
			const view = byName.get(name);
			expect(view).toBeDefined();
			return {
				covers: view?.covers ?? [],
				shot: (view?.shot ?? {}) as {
					kind?: string;
					body?: string;
					radii?: number;
				},
			};
		};
		const fill = planetView("planet-fill");
		const terminator = planetView("planet-terminator");
		for (const view of [fill, terminator]) {
			expect(view.covers).toContain(206);
			expect(view.shot.kind).toBe("body-offset");
		}
		// Both frame a planet, and `planet-fill` names its subject outright
		// rather than through `largest-planet`: the cost sweep #206 built is
		// pointed at `planet-5` by id, and a view framed on a different body
		// from the one the table priced is a picture of a different claim.
		expect(fill.shot.body).toBe("planet-5");
		expect(FIXTURE.planets[0]?.id).toBe("planet-5");
		// And the fill view is the near one — of the whole set, not of the pair.
		const offsetRadii = VIEWS.map(
			(v) => v.shot as { kind?: string; radii?: number },
		)
			.filter((s) => s.kind === "body-offset")
			.map((s) => s.radii ?? Number.POSITIVE_INFINITY);
		expect(typeof fill.shot.radii).toBe("number");
		expect(Math.min(...offsetRadii)).toBe(fill.shot.radii ?? 0);
		expect(fill.shot.radii ?? 0).toBeLessThan(terminator.shot.radii ?? 0);
	});

	test("every lever is covered by at least one view", () => {
		expect(uncoveredLevers(VIEWS)).toEqual([]);
	});

	/**
	 * The coverage check has to be able to fail, or it is decoration. Drop the
	 * two views that carry #105 and the cockpit lever must come back uncovered —
	 * a check that passes on a set with a hole in it proves nothing about the
	 * set that has none.
	 */
	test("coverage goes red when a lever loses its only views", () => {
		const without = VIEWS.filter((v) => !v.covers.includes(105));
		expect(uncoveredLevers(without)).toEqual([105]);
	});

	test("the fixture is pinned: one seed, one clock, one viewport", () => {
		expect(Number.isInteger(SEED)).toBe(true);
		expect(GAME_TIME_S).toBe(0);
		expect(VIEWPORT).toEqual({ width: 1440, height: 900 });
	});
});

/**
 * **The measurement half of `FIXTURE`** — `view-set.mjs` carries why it is data
 * and not prose (#174).
 *
 * **A regression pin and not an oracle.** `FIXTURE` was populated by reading
 * `makeWorld(SEED)` back, so it is not independent evidence of what the fixture
 * *should* contain and nothing here can tell a good start system from a bad one.
 * What it does is hold the constant and the world apart in *time*: a later
 * generator change moves one and not the other, so the drift that ran from #118
 * to #174 unnoticed is a red run instead. That is the whole claim.
 */
describe("the pinned seed's world", () => {
	const world = makeWorld(SEED);

	test("generates the system the fixture names", () => {
		expect(world.system.record.name).toBe(FIXTURE.system);
	});

	test("generates the planets the fixture declares, largest first", () => {
		// **The collection and the comparator `capture-views.mjs` resolves
		// `largest-planet` with**, and both halves decide the answer: `bodies`
		// filtered to planets — not `contents.planets`, which coincides only
		// because moons carry `kind: "moon"` — sorted on **raw** `radiusKm` with
		// an id tiebreak. Sort the rounded figures instead and two planets within
		// a kilometre of each other order differently here from on the sheet, and
		// the head of this list is the subject two views are framed on.
		//
		// **The comparator is a hand-copy and the risk is stated rather than
		// closed.** It cannot be shared: `capture-views.mjs` runs its sort inside
		// `page.evaluate`, where the body is serialised into the browser and an
		// imported function does not reach. A tiebreak changed there leaves this
		// green, so the two are pinned by this comment and nothing stronger.
		//
		// `isGasGiant` is a generator field rather than a rendered one, so the
		// records are joined back by id — the sort still runs over what the
		// capture sees.
		const records = new Map(
			world.system.contents.planets.map((p) => [p.id, p]),
		);
		const planets = world.system.bodies
			.filter((b) => b.kind === "planet")
			.sort((a, b) => b.radiusKm - a.radiusKm || (a.id < b.id ? -1 : 1))
			.map((b) => ({
				id: b.id,
				radiusKm: Math.round(b.radiusKm),
				gasGiant: records.get(b.id)?.isGasGiant,
			}));
		expect(planets).toEqual([...FIXTURE.planets]);
	});

	/**
	 * **And that neither role carries a pad aperture** — `view-set.mjs` carries
	 * why that is the claim worth holding.
	 *
	 * One assertion and not two: the aperture string embeds the role, so it pins
	 * the roster and its order as well, and a second `expect` over the bare roles
	 * could not fail without this one failing too. Strings on both sides, so a
	 * failure names the role rather than a position in a list.
	 *
	 * A station with no `stationType` drops out rather than being described by a
	 * branch that cannot fire — `Body.stationType` is optional and every station
	 * `sim.ts` builds carries one, so a fallback string would promise a message
	 * no reader ever sees. Dropping shortens the list, which fails here anyway.
	 */
	test("generates the station roles the fixture declares, both of them slots", () => {
		const apertures = world.system.bodies
			.filter((b) => b.kind === "station")
			.map((b) => b.stationType)
			.filter((role) => role !== undefined)
			.map((role) => `${role}:${STATION_GEOMETRY[role].aperture.kind}`);
		expect(apertures).toEqual(
			FIXTURE.stations.map((s) => `${s.role}:${s.aperture}`),
		);
	});
});

describe("the contact sheet", () => {
	test("renders every declared view of every run", () => {
		const html = contactSheet([fullRun("before"), fullRun("after")]);
		for (const view of VIEWS) {
			expect(html).toContain(view.name);
			expect(html).toContain(`before/${view.name}.png`);
			expect(html).toContain(`after/${view.name}.png`);
		}
	});

	test("names the ref and the renderer each run was captured with", () => {
		const html = contactSheet([fullRun("before")]);
		expect(html).toContain("abc1234");
		expect(html).toContain("Apple M1 Pro");
	});

	/**
	 * The caption is the one place the sheet asserts a fixture property to the
	 * person whose yes is the gate, so it has to be true of the frames above it.
	 * It said "clock pinned at 0s" while `__startClockAt` normalises the start and
	 * lets the clock run — seven frames at seven different times. It now prints
	 * the span the frames were actually taken across.
	 */
	test("prints the clock span the frames were taken across, not a pinned time", () => {
		const html = contactSheet([fullRun("before")]);
		// The fixture spaces its frames 0.4 s apart, so the span is fixed by how
		// many views the set declares — which is the count row's business, not this
		// one's, and this literal moves with it.
		expect(html).toContain("· clock 0.6–11.4s");
		expect(html).not.toContain("pinned");
	});

	test("omits the span for a run whose views carry no clock", () => {
		const old = fullRun("before");
		old.views = old.views.map(({ name, file }) => ({ name, file }));
		const html = contactSheet([old]);
		expect(html).toContain("abc1234");
		expect(html).not.toContain("· clock ");
	});

	/**
	 * The whole point of the file. A run that dropped a view must not produce a
	 * sheet at all — the reviewer would otherwise scroll past a gap and say yes.
	 */
	test("refuses a run that is missing a declared view", () => {
		const short = fullRun("after");
		short.views = short.views.filter((v) => v.name !== VIEWS[0].name);
		expect(() => contactSheet([fullRun("before"), short])).toThrow(
			VIEWS[0].name,
		);
	});

	test("refuses a run carrying a view the set does not declare", () => {
		const extra = fullRun("after");
		extra.views.push({ name: "improvised", file: "after/improvised.png" });
		expect(() => contactSheet([extra])).toThrow("improvised");
	});

	/**
	 * #123's capture ran against a dev server in a sibling worktree, and the
	 * sheet it produced carried this checkout's ref over another branch's hulls.
	 * The ref names the tree the *script* ran in; this names the tree the
	 * *server* declared.
	 *
	 * **Provenance, not a detection**, which this said for a round. The guard
	 * refuses a server whose root is not the capture's own tree, so a live run
	 * cannot produce the disagreement — the fixture below fabricates a root
	 * this machine has never had. What the line is for is that a sheet on disk
	 * names the checkout its pixels came from.
	 */
	test("names the tree the server declared, beside the ref the script ran at", () => {
		const html = contactSheet([fullRun("before")]);
		expect(html).toContain("abc1234");
		// The **root** first and the ref in parentheses. Both, and in that order:
		// the PR's own demonstration is two worktrees of one branch at one
		// commit, which a ref alone renders as an identical string.
		expect(html).toContain(
			"served: /Users/someone/work/seelite (main@9f3c1a2)",
		);
	});

	test("says a dirty served tree was dirty", () => {
		const run = fullRun("before");
		run.served = { ...run.served, root: "/w/seelite", dirty: true };
		expect(contactSheet([run])).toContain(
			"served: /w/seelite (main@9f3c1a2-dirty)",
		);
	});

	/**
	 * The `before` half of any pair spanning #296 was captured by a script that
	 * did not record this. A sheet that refused those could never show the
	 * before/after for the change that introduced the field — so it is absent
	 * rather than wrong, and says so instead of leaving a blank that reads as
	 * agreement.
	 */
	test("says so rather than refusing a run captured before the field existed", () => {
		const old = fullRun("before");
		old.served = undefined;
		const html = contactSheet([old]);
		expect(html).toContain("served: not recorded");
		expect(html).toContain("abc1234");
	});

	/** Git is optional in the declaration — an export with no `.git` is still a
	 *  tree worth naming — so the root carries it when the branch cannot. */
	test("falls back to the root path where the server could not read git", () => {
		const run = fullRun("before");
		run.served = { root: "/w/seelite-296" };
		expect(contactSheet([run])).toContain("served: /w/seelite-296");
	});

	test("refuses no runs at all rather than emitting an empty sheet", () => {
		expect(() => contactSheet([])).toThrow();
	});

	/**
	 * The completeness rule against a set that is not the real one — the same
	 * reason `uncoveredLevers` takes its subject as a parameter. A rule only ever
	 * exercised against `VIEWS` is one nothing has watched decide.
	 */
	test("judges completeness against the set it is given, not the module's", () => {
		const alt = [{ name: "only-view", what: "just the one", covers: [99] }];
		const run = {
			label: "alt",
			gitRef: "abc1234",
			capturedAt: "2026-08-28T12:00:00.000Z",
			renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
			seed: SEED,
			views: [{ name: "only-view", file: "alt/only-view.png" }],
		};
		const html = contactSheet([run], alt);
		expect(html).toContain("only-view");
		expect(html).not.toContain("cockpit-arrival");
		// And the same run is incomplete against the real set, which is the half
		// that proves the parameter is doing the deciding.
		expect(() => contactSheet([run])).toThrow("cockpit-arrival");
	});
});

/**
 * #432's rim row: built, captured, judged, and removed in the same PR.
 *
 * The set got a second `deep-sky` row standing at a rim system and aimed along the
 * **Core bearing**, which needed the `?system=` boot affordance to exist at all —
 * that half shipped. The frame did not: the principal's reading of it was *"few
 * dots, neither wall of dots or cone of lights"*, and `measure-sky-density.ts`'s
 * field arm prints why, in the one comparison that decides it — the crowded
 * heading's points per square degree against the density the invented population
 * already lays down in *every* direction. The derived layer loses that by a
 * factor of three at a 256-system cluster, so no framing and no choice of system
 * makes #100's lever something an eye can see, and `CONTEXT.md` said as much in
 * advance: the Core bearing carries information rather than light.
 *
 * What the node therefore leaves behind is the affordance, the measurement, and
 * the node the measurement opened. These two rows keep the removal honest.
 */
describe("the rim sky row #432 built and removed", () => {
	/**
	 * The node's own prohibition, and the reason the row was added *beside*
	 * `sky-only` rather than instead of it: `sky-only` declares `covers: [100,
	 * 200]`, so relocating it would have re-baselined #200's dither evidence with
	 * it. "The arrival point, empty sky" is an honest frame of the world the game
	 * actually starts the player in, and it survives the row that replaced it.
	 */
	test("sky-only still stands at the arrival point and aims away from everything", () => {
		const skyOnly = VIEWS.find((v) => v.name === "sky-only");
		expect(skyOnly?.covers).toEqual([100, 200]);
		expect(skyOnly?.shot).toEqual({ kind: "deep-sky", view: "cockpit" });
	});

	/**
	 * `?system=` ships, `capture-views.mjs` will restore a named system beside the
	 * seed for any row, and nothing in the set asks for one. That is a decision
	 * rather than an oversight, and this row is what makes it one: the day the
	 * derived layer's population moves far enough for a rim frame to show the cone,
	 * a row here will name a system, and this row goes red with it.
	 */
	test("no row in the set names a system to stand at", () => {
		// Cast rather than a declaration: `system` is legal on a shot and no row
		// uses it, so the inferred union of the literals in `view-set.mjs` has no
		// such property to read. `malformedShots` reads it the same way.
		const declaring = VIEWS.filter(
			(v) => (v.shot as { system?: number }).system !== undefined,
		);
		expect(declaring.map((v) => v.name)).toEqual([]);
	});
});
