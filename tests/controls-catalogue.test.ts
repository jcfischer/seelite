/**
 * The controls catalogue against the bindings the game actually has (#372).
 *
 * The Controls tab prints this catalogue, and a reference that is missing a
 * binding is worse than none: the player trusts it and never finds the control.
 * So the catalogue is checked **against the source**, both ways — every key the
 * partition test's own scanner finds bound must be in it, and every key it
 * prints must be bound somewhere. The first direction is #370's completeness
 * row; the second stops a row outliving the binding it names.
 *
 * This is the interface's test, not the interim module's. When #369's registry
 * replaces the innards, these rows stay as the registry's contract.
 */
import { describe, expect, test } from "bun:test";
import { COMMANDER_KEY } from "../src/commander-overlay";
import {
	CONTROLS,
	PANEL_INTENTS,
	type PanelIntent,
	TASK_GROUPS,
	type Trigger,
} from "../src/controls-catalogue";
import { STANDARD_BUTTONS } from "../src/gamepad";
import { PAD_FLIGHT_KEYS, padIntents } from "../src/pad-bindings";
import { PERF_KEYS, RESTORE_KEY } from "../src/perf-panel";
import { SETTINGS_KEY } from "../src/settings-panel";
import { boundKeys, codeOf } from "./lib/source-scan";

const triggers = (): Trigger[] =>
	CONTROLS.commands.flatMap((command) => [...command.currentTriggers]);

/** Every character key the catalogue prints, whatever it is printed for. */
const catalogueKeys = () =>
	new Set(triggers().flatMap((t) => (t.kind === "key" ? [t.key] : [])));

/**
 * What the scanner finds that a keyboard can deliver.
 *
 * `main.ts` compares `key === "renderScale"` in the settings subscription, and
 * the scanner's `key === "…"` shape reads that as a binding. `onKey` lowercases
 * `e.key` before anything sees it, so a string with a capital in it is a string
 * no keypress can produce — the filter is that fact, not a list of exceptions.
 */
const keyShaped = (key: string) => key === key.toLowerCase();

/**
 * `BEAM_KEY` is private to `combat-rig.ts`, and that module imports Three, so
 * it is read the way `main.ts` is rather than imported into the unit tier.
 */
const beamKeys = () =>
	[...boundKeys(codeOf("src/combat-rig.ts"))].filter(keyShaped);

const sourceKeys = () =>
	new Set([
		...[...boundKeys(codeOf("src/main.ts"))].filter(keyShaped),
		...PERF_KEYS,
		RESTORE_KEY,
		SETTINGS_KEY,
		COMMANDER_KEY,
		...beamKeys(),
	]);

describe("the catalogue is complete against the source", () => {
	test("the scans find what they are supposed to find", () => {
		// Guarding the guard, as the partition test does: an empty scan would
		// make both directions below vacuously green.
		expect(beamKeys()).toContain("x");
		expect(sourceKeys()).toContain("shift");
		expect(sourceKeys()).toContain("?");
		expect(boundKeys(codeOf("src/main.ts"))).toContain("renderScale");
		expect(sourceKeys()).not.toContain("renderScale");
	});

	test("every bound key is in the catalogue", () => {
		const printed = catalogueKeys();
		for (const key of sourceKeys())
			expect(`${JSON.stringify(key)}: ${printed.has(key)}`).toBe(
				`${JSON.stringify(key)}: true`,
			);
	});

	test("every key the catalogue prints is bound", () => {
		const bound = sourceKeys();
		for (const key of catalogueKeys())
			expect(`${JSON.stringify(key)}: ${bound.has(key)}`).toBe(
				`${JSON.stringify(key)}: true`,
			);
	});

	test("the six panel intents each have a row", () => {
		// Read off the value the pad module returns, not off a list written
		// here: a seventh field added to `PadIntents` is a red run.
		const fields = Object.keys(padIntents(null, "flight")).filter(
			(k) => k !== "keys",
		) as PanelIntent[];
		expect(fields.length).toBe(6);
		expect([...PANEL_INTENTS].sort()).toEqual([...fields].sort());
		const printed = new Set(
			triggers().flatMap((t) => (t.kind === "pad-intent" ? [t.intent] : [])),
		);
		for (const field of fields)
			expect(`${field}: ${printed.has(field)}`).toBe(`${field}: true`);
	});

	test("every pad button the flight table binds is on the row that owns its key", () => {
		for (const [button, key] of Object.entries(PAD_FLIGHT_KEYS)) {
			const owners = CONTROLS.commands.filter((c) =>
				c.currentTriggers.some((t) => t.kind === "key" && t.key === key),
			);
			const onRow = owners.some((c) =>
				c.currentTriggers.some(
					(t) => t.kind === "pad-button" && t.button === button,
				),
			);
			expect(`${button} → ${key}: ${onRow}`).toBe(`${button} → ${key}: true`);
		}
	});

	test("every pad button is printed somewhere, except the one nothing claims", () => {
		const printed = new Set(
			triggers().flatMap((t) =>
				t.kind === "pad-button" || t.kind === "pad-intent" ? [t.button] : [],
			),
		);
		const sticksAndTriggers = new Set(
			triggers().flatMap((t) => (t.kind === "pad-trigger" ? [t.trigger] : [])),
		);
		const missing = STANDARD_BUTTONS.filter(
			(b) => !printed.has(b) && !sticksAndTriggers.has(b as "l2" | "r2"),
		);
		// `pad-bindings.ts`: "Unbound: `home` alone."
		expect(missing).toEqual(["home"]);
	});

	test("the sticks, the triggers and the mouse each have a row", () => {
		const kinds = new Set(triggers().map((t) => t.kind));
		for (const kind of [
			"pad-stick",
			"pad-trigger",
			"mouse-move",
			"mouse-button",
		] as const)
			expect(`${kind}: ${kinds.has(kind)}`).toBe(`${kind}: true`);
	});
});

describe("the catalogue's shape", () => {
	test("one entry per command, addressed by an id that is not a key", () => {
		const ids = CONTROLS.commands.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		const keys = sourceKeys();
		for (const id of ids) {
			expect(`${id} is a key: ${keys.has(id)}`).toBe(`${id} is a key: false`);
			expect(id).toMatch(/^[a-z][a-z0-9-]+$/);
		}
	});

	test("every command is in one of the six task groups, and none is empty", () => {
		for (const c of CONTROLS.commands) expect(TASK_GROUPS).toContain(c.group);
		for (const g of TASK_GROUPS)
			expect(`${g}: ${CONTROLS.commands.some((c) => c.group === g)}`).toBe(
				`${g}: true`,
			);
	});

	test("default and current are distinct fields, and today they agree", () => {
		// #370 D5: until #369's registry can report a player layout, the only
		// layout is the default and the label must say so.
		expect(CONTROLS.layout).toBe("default");
		for (const c of CONTROLS.commands)
			expect(c.currentTriggers).toEqual(c.defaultTriggers);
	});

	test("x is one row naming both of its behaviours", () => {
		const rows = CONTROLS.commands.filter((c) =>
			c.currentTriggers.some((t) => t.kind === "key" && t.key === "x"),
		);
		expect(rows.length).toBe(1);
		expect(rows[0]?.name).toMatch(/assist/i);
		expect(rows[0]?.name).toMatch(/beam/i);
	});

	test("? is the controls reference's own key", () => {
		const row = CONTROLS.commands.find((c) =>
			c.currentTriggers.some((t) => t.kind === "key" && t.key === "?"),
		);
		expect(row?.group).toBe("view");
	});
});
