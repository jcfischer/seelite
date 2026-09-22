/**
 * Warn at bind time, allow the bind, and keep the door open (#369 D5/D9/D12).
 *
 * Three rulings land in one place, because they are one flow: the modal has to
 * be able to tell a player *before* it commits that the trigger they just
 * pressed already means something, and it has to commit anyway.
 *
 * **What makes the warning structural rather than remembered.** A caller
 * cannot obtain the candidate layout without the warnings beside it —
 * `proposedRebind` returns them together or returns a refusal — so a modal
 * that committed without asking would have nothing to commit. A `rebind`
 * beside a separate `collisionNotices` call is the same two lines with the
 * second one optional, which is the version a later edit drops.
 */
import { describe, expect, test } from "bun:test";
import {
	COMMANDS,
	DEFAULT_BINDINGS,
	rebind,
	type Trigger,
	triggerKey,
} from "../src/commands";
import { collisionNotices, proposedRebind } from "../src/layout-notice";
import { controlsTree, SETTINGS_ACTION } from "../src/controls-reference";
import { controlsCatalogue } from "../src/controls-catalogue";
import { codeOf } from "./lib/source-scan";

const shipped = (command: string, kind: Trigger["kind"] = "key") => {
	const found = DEFAULT_BINDINGS.find(
		(b) => b.command === command && b.trigger.kind === kind,
	);
	if (!found) throw new Error(`${command} has no ${kind} binding`);
	return found.trigger;
};

describe("a bind is warned about before it is taken, and taken anyway", () => {
	test("a move onto a free key proposes a layout and says nothing", () => {
		// `5` is one of the five characters the shipped layout leaves alone.
		const out = proposedRebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			shipped("fly.cruise"),
			{
				kind: "key",
				key: "5",
			},
		);
		expect("refused" in out).toBe(false);
		if ("refused" in out) return;
		expect(out.warnings).toEqual([]);
		expect(triggerKey(out.layout[0]?.trigger as Trigger)).toBeDefined();
	});

	test("a move onto a taken key proposes it anyway, and names both commands", () => {
		// D5 is warn **and allow**: the candidate is returned, not withheld.
		// `k` is `tune.approachLeadDown`, which is what makes this a collision.
		const out = proposedRebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			shipped("fly.cruise"),
			{
				kind: "key",
				key: "k",
			},
		);
		if ("refused" in out) throw new Error(`refused: ${out.refused}`);
		expect(out.warnings.length).toBe(1);
		const only = out.warnings[0];
		expect(only?.kind).toBe("collision");
		if (only?.kind === "collision")
			expect(only.collision.commands.slice().sort()).toEqual([
				"fly.cruise",
				"tune.approachLeadDown",
			]);
		// And it really is a layout that flies, not a diagnosis of one.
		expect(out.layout.length).toBe(DEFAULT_BINDINGS.length);
	});

	test("the layout in force is untouched by a proposal", () => {
		// The whole point of a *proposal*: a player who reads the warning and
		// backs out has changed nothing. `rebind` returns a new table, so this
		// follows — and it is the property a modal that mutated in place to
		// "preview" the bind would break.
		const before = DEFAULT_BINDINGS.map((b) => triggerKey(b.trigger)).join("|");
		proposedRebind(DEFAULT_BINDINGS, "fly.cruise", shipped("fly.cruise"), {
			kind: "key",
			key: "k",
		});
		expect(DEFAULT_BINDINGS.map((b) => triggerKey(b.trigger)).join("|")).toBe(
			before,
		);
	});

	test("a refusal is a refusal and carries no candidate at all", () => {
		// A stick has no reader off the layout, so there is nothing to warn
		// about — and the caller gets a sentence rather than a layout, which is
		// the shape that keeps the modal from committing one.
		const out = proposedRebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			shipped("fly.cruise", "pad-button"),
			{
				kind: "pad-stick",
				stick: "right",
				axis: "x",
				half: "+",
				contexts: ["capture"],
			},
		);
		expect("refused" in out).toBe(true);
		if ("refused" in out) expect(out.refused).toMatch(/padFlightAxes/);
	});

	test("the warning is the same one the band prints after the bind", () => {
		// One predicate, two moments. If the bind-time warning had its own
		// arithmetic, a player could be warned about one thing and then shown
		// another — which is the drift two implementations of one question buy.
		const to: Trigger = { kind: "key", key: "k" };
		const out = proposedRebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			shipped("fly.cruise"),
			to,
		);
		if ("refused" in out) throw new Error("refused");
		const after = rebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			shipped("fly.cruise"),
			to,
		);
		// `collisionNotices` is what the band is built from, and the proposal
		// must answer with exactly that on exactly that table.
		expect(out.warnings).toEqual(collisionNotices(after));
		expect(out.layout.map((b) => triggerKey(b.trigger))).toEqual(
			after.map((b) => triggerKey(b.trigger)),
		);
	});
});

describe("the door cannot be shut", () => {
	test("a rebind moves and never removes, so nothing loses its last trigger", () => {
		// **C9 rests on this and on nothing else.** Before this node's first
		// step the d-pad's head-turn was pinned to the default by
		// construction; it is a layout row now and a player may move it. What
		// keeps the reach is that `rebind` has no empty arm: every command that
		// had a trigger still has one, wherever the player put it.
		const before = new Map<string, number>();
		for (const b of DEFAULT_BINDINGS)
			before.set(b.command, (before.get(b.command) ?? 0) + 1);
		const moved = rebind(
			DEFAULT_BINDINGS,
			"view.headStarboard",
			shipped("view.headStarboard"),
			{
				kind: "key",
				key: "5",
			},
		);
		const after = new Map<string, number>();
		for (const b of moved)
			after.set(b.command, (after.get(b.command) ?? 0) + 1);
		for (const c of COMMANDS)
			expect(`${c.id}: ${after.get(c.id) ?? 0}`).toBe(
				`${c.id}: ${before.get(c.id) ?? 0}`,
			);
	});

	test("and there is no verb that would remove one", () => {
		// The property above is only as good as the absence of an unbind. S4
		// ships none, deliberately: a true unbind would let a player take the
		// last trigger off `view.headStarboard` and lose the tab that fixes it,
		// and answering that needs a fourth `FixedReason` — an amendment to
		// #369 D12 rather than something this slice may decide in passing.
		const registry = codeOf("src/commands.ts");
		for (const verb of [
			"export function unbind",
			"export const unbind",
			"export function clearBinding",
		])
			expect(registry, verb).not.toContain(verb);
	});

	test("the Controls tab carries a settings row that is not a binding", () => {
		// #369 D12: `z` becomes remappable, and what makes that safe is that
		// settings gains a non-binding route through this tab — extending
		// #370's "nothing a binding table holds is on the path to it" to the
		// one door that is a letter today.
		const items = controlsTree(controlsCatalogue(), new Set());
		const action = items.find((i) => i.kind === "action");
		expect(action).toBeDefined();
		if (action?.kind === "action") expect(action.action).toBe(SETTINGS_ACTION);
		// It is first, so it is reached without opening a group — a player who
		// folded everything still has the door in front of them.
		expect(items[0]?.kind).toBe("action");
	});

	test("and that row is not a command, so nothing can be bound to it", () => {
		const items = controlsTree(controlsCatalogue(), new Set());
		const actions = items.filter((i) => i.kind === "action");
		expect(actions.length).toBe(1);
		// No command in the registry shares its name, which is what would make
		// it bindable by the back door.
		// **A `string` comparison on purpose, and the compiler already knows.**
		// `CommandId` and `typeof SETTINGS_ACTION` have no overlap, so TS
		// reports the direct `===` as unintentional — which is the property
		// being asserted, one tier earlier. This row holds it at runtime too,
		// for the day someone authors a command called `settings`.
		expect(COMMANDS.some((c) => (c.id as string) === SETTINGS_ACTION)).toBe(
			false,
		);
	});
});
