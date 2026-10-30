/**
 * The fire-group cycle's key, and the perf panel's claim on it (#892).
 *
 * #385 D6 ruled that the cycle key is `b`, and that bloom keeps `b` only in
 * `?perf`. Every letter was already bound, and `b` was the bloom switch — a
 * diagnostic no player sees. So the two now share one key, and the rule that
 * keeps them apart is the panel's state: **while the panel is open its key is
 * the panel's, and while it is closed the key is the ship's.**
 *
 * The rows below drive `resolveKey` and `collisions` against the shipped
 * layout and against a moved one. What the cycle *does* is #893's; this node
 * only makes the command exist and reach a dispatch site.
 */
import { describe, expect, test } from "bun:test";
import {
	collisions,
	commandById,
	DEFAULT_BINDINGS,
	defaultCollisions,
	rebind,
	resolveKey,
} from "../src/commands";
import { CONTROLS } from "../src/controls-catalogue";

const VIEWS = ["cockpit", "chase"] as const;

describe("b cycles the fire group while the perf panel is closed", () => {
	test("in both views, and nothing else answers", () => {
		for (const view of VIEWS) {
			expect(resolveKey(DEFAULT_BINDINGS, { key: "b", view })).toEqual([
				"fight.cycleFireGroup",
			]);
			// The physical key as well as the character (#369 D7).
			expect(
				resolveKey(DEFAULT_BINDINGS, { key: "b", code: "KeyB", view }),
			).toEqual(["fight.cycleFireGroup"]);
		}
	});

	test("an explicit closed panel is the same answer as an absent one", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, {
				key: "b",
				code: "KeyB",
				view: "cockpit",
				perfPanel: false,
			}),
		).toEqual(["fight.cycleFireGroup"]);
	});
});

describe("b toggles bloom while the perf panel is open", () => {
	test("the diagnostic answers and the cycle does not", () => {
		for (const view of VIEWS)
			expect(
				resolveKey(DEFAULT_BINDINGS, {
					key: "b",
					code: "KeyB",
					view,
					perfPanel: true,
				}),
			).toEqual(["perf.bloom"]);
	});

	test("a flight key the panel does not claim still flies", () => {
		// The panel claims its own keys and no others: it sits over a running
		// game and flight continues under it (#283).
		expect(
			resolveKey(DEFAULT_BINDINGS, {
				key: "v",
				code: "KeyV",
				view: "cockpit",
				perfPanel: true,
			}),
		).toEqual(["view.toggle"]);
	});

	test("the claim is the key's, so a cycle moved off b keeps working", () => {
		// Onto `5`, one of the few characters the shipped layout leaves free;
		// see `commands.test.ts`'s keyboard-rebind row for the list.
		const layout = rebind(
			DEFAULT_BINDINGS,
			"fight.cycleFireGroup",
			{ kind: "key", key: "b" },
			{ kind: "key", key: "5" },
		);
		for (const perfPanel of [false, true])
			expect(
				resolveKey(layout, { key: "5", view: "cockpit", perfPanel }),
			).toEqual(["fight.cycleFireGroup"]);
		expect(resolveKey(layout, { key: "b", view: "cockpit" })).toEqual([]);
	});
});

describe("the catalogue rows", () => {
	test("the cycle is a rebindable fight command", () => {
		const cycle = commandById("fight.cycleFireGroup");
		expect(cycle.group).toBe("fight");
		expect(cycle.rebindable).toBe(true);
		expect(cycle.fixed).toBeUndefined();
	});

	test("the Controls tab lists it in the fight group, on b", () => {
		// The tab prints `CONTROLS`, so this is the reference a pilot reads.
		const row = CONTROLS.commands.find((c) => c.id === "fight.cycleFireGroup");
		expect(row?.group).toBe("fight");
		expect(row?.rebindable).toBe(true);
		expect(
			row?.currentTriggers.map((t) => (t.kind === "key" ? t.key : t.kind)),
		).toEqual(["b"]);
	});

	test("bloom stays a fixed diagnostic", () => {
		const bloom = commandById("perf.bloom");
		expect(bloom.fixed).toBe("diagnostic");
		expect(bloom.rebindable).toBe(false);
	});
});

describe("collisions on b", () => {
	test("the shipped layout reports none", () => {
		expect(defaultCollisions()).toEqual([]);
	});

	test("a pilot's command moved onto b collides with the cycle", () => {
		// D5 is warn and allow: a report, not a refusal. The pair is the cycle
		// and the moved command; bloom is not in it, because with the panel
		// open the diagnostic is the only thing `b` reaches.
		const layout = rebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			{ kind: "key", key: "j" },
			{ kind: "key", key: "b" },
		);
		const found = collisions(layout).map((c) =>
			c.commands.map<string>((id) => id).sort(),
		);
		expect(found).toEqual([["fight.cycleFireGroup", "fly.cruise"]]);
	});
});
