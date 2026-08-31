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
import {
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
const fullRun = (
	label: string,
): {
	label: string;
	gitRef: string;
	capturedAt: string;
	renderer: string;
	seed: number;
	views: ViewShot[];
} => ({
	label,
	gitRef: "abc1234",
	capturedAt: "2026-08-28T12:00:00.000Z",
	renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
	seed: SEED,
	views: VIEWS.map((v, i) => ({
		name: v.name,
		file: `${label}/${v.name}.png`,
		gameTime: 0.6 + i * 0.4,
	})),
});

describe("the view set itself", () => {
	test("declares fifteen views with unique kebab-case names", () => {
		// Eight after #129 added `station-flank`, fifteen since #147 added
		// §13.6's seven-frame acceptance set. A literal and not `VIEWS.length`,
		// which is the whole point: a view deleted by accident has to be a red
		// run, and a check derived from its own subject cannot be one.
		expect(VIEWS.length).toBe(15);
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
				{ name: "fine", shot: { kind: "deep-sky" } },
			]),
		).toEqual(["no-angle", "no-radii", "bad-kind"]);
	});

	test("every covered id is a lever on the map", () => {
		for (const view of VIEWS)
			for (const id of view.covers) expect(LEVERS[id]).toBeDefined();
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
		// many views the set declares — fifteen since #147's acceptance frames.
		expect(html).toContain("· clock 0.6–6.2s");
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
