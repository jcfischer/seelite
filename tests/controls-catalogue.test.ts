/**
 * The controls catalogue against the bindings the game actually has (#372).
 *
 * The Controls tab prints this catalogue, and a reference that is missing a
 * binding is worse than none: the player trusts it and never finds the control.
 * So the catalogue is checked **against the source**, both ways — every key the
 * partition test's own scanner finds bound must be in it, and every key it
 * prints must be bound in the shape it is printed as — pressed, held, chorded
 * or on the one surface that claims it. The first direction is #370's completeness
 * row; the second stops a row outliving the binding it names.
 *
 * This is the interface's test, not the interim module's. When #369's registry
 * replaces the innards, these rows stay as the registry's contract.
 */
import { describe, expect, test } from "bun:test";
import { COMMANDER_KEY } from "../src/commander-overlay";
import {
	isPressedKey,
	PANEL_INTENTS,
	type PanelIntent,
	TASK_GROUPS,
	type Trigger,
} from "../src/commands";
import { CONTROLS } from "../src/controls-catalogue";
import { STANDARD_BUTTONS } from "../src/gamepad";
import { ALT_CHORDS } from "../src/key-dispatch";
import { PAD_FLIGHT_KEYS, padIntents } from "../src/pad-bindings";
import { PERF_KEYS, RESTORE_KEY } from "../src/perf-panel";
import { SETTINGS_KEY } from "../src/settings-panel";
import { boundKeys, codeOf, keysByShape } from "./lib/source-scan";

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

	/**
	 * **Per shape, not per key string** (sage round 1). A bare-key check passes a
	 * printed `Alt + ←` for as long as *anything* binds `arrowleft` — and yaw
	 * does — so removing the Alt head-look would leave the row printed and this
	 * test green. Each trigger is looked for where its own shape is read, by
	 * `keysByShape`, which shares `boundKeys`' resolver (sage round 2).
	 */
	test("every key the catalogue prints is bound in the shape it is printed as", () => {
		const main = keysByShape(codeOf("src/main.ts"));
		const rig = keysByShape(codeOf("src/combat-rig.ts"));
		const pressed = new Set([
			...main.cases,
			...rig.compared,
			...PERF_KEYS,
			RESTORE_KEY,
			SETTINGS_KEY,
			COMMANDER_KEY,
		]);
		const held = new Set([...main.held, ...rig.held]);
		// Guard the guard: every shape's scan finds something it must, and `,`
		// is the one a comma-splitting scan would lose.
		expect([
			pressed.has("v"),
			pressed.has(","),
			held.has("shift"),
			Object.keys(ALT_CHORDS).length > 0,
			main.requests.has("enter"),
		]).toEqual([true, true, true, true, true]);
		for (const c of CONTROLS.commands)
			for (const t of c.currentTriggers) {
				if (t.kind !== "key") continue;
				// A chord is bound when the dispatch's table holds its physical key
				// and that entry stands for a key this row presses (#377).
				const chordOk =
					t.code !== undefined &&
					ALT_CHORDS[t.code] !== undefined &&
					c.currentTriggers.some(
						(o) =>
							o.kind === "key" &&
							!o.alt &&
							o.key === ALT_CHORDS[t.code as string],
					);
				const [shape, set] = t.alt
					? ["alt", new Set(chordOk ? [t.key] : [])]
					: t.surface
						? ["requests", main.requests]
						: t.hold
							? ["held", held]
							: ["pressed", pressed];
				const at = `${c.id}: ${JSON.stringify(t.key)} ${shape}`;
				expect(`${at}: ${set.has(t.key)}`).toBe(`${at}: true`);
			}
	});

	/**
	 * **A key on the right row, not only a bound key** (sage round 2). The two
	 * checks above hold key *sets*: swap the bodies of `case "t":` and
	 * `case "g":` and both stay green while the tab prints "Next target" against
	 * the key that now selects the previous one. So every pressed key a row
	 * prints is looked up in `main.ts`'s switch, and its `case` body must make
	 * the call this table names for that row.
	 *
	 * The table is a restatement, deliberately: it is the one place the row's
	 * *meaning* meets the code. A row whose pressed key has a `case` in `main.ts`
	 * and no entry here is a red run; a key with no `case` there — a panel's own —
	 * is not checked by this row, and the shape row above is what holds it.
	 */
	test("every pressed key's case does what its row says", () => {
		const main = codeOf("src/main.ts");
		const caseBody = (key: string) => {
			const at = main.indexOf(`case ${JSON.stringify(key)}:`);
			if (at === -1) return null;
			// Labels that fall through share the body below them: `case "f1":`
			// stands on `case "?":` (#377), so every stacked label is skipped first.
			const rest = main
				.slice(at)
				.replace(/^(\s*case\s+("[^"]+"|[A-Z][A-Z0-9_]*)\s*:)+/, "");
			return rest.slice(0, rest.search(/\n\t*(case |default:)/));
		};
		const dial = (field: string, table: string, extra = "") => ({
			up: `this.dial("${field}", ${table}, 1${extra}`,
			down: `this.dial("${field}", ${table}, -1${extra}`,
		});
		const exponent = dial("exponent", "EXPONENT_DIAL");
		const vmax = dial("vMaxKms", "V_MAX_DIAL_C", ", IN_C");
		const radius = dial("dropRadiusKm", "DROP_RADIUS_DIAL_KM");
		const speed = dial("dropSpeedKms", "DROP_SPEED_DIAL_KMS");
		const vicinity = dial("vicinityKm", "VICINITY_DIAL_KM");
		const lead = dial("approachLeadS", "APPROACH_LEAD_DIAL_S");
		const EFFECTS: Record<string, Record<string, string>> = {
			"fly.assist": { x: "this.assist = !this.assist" },
			"fly.cruise": { j: "this.engageCruise()" },
			"fly.jump": { "`": "this.chargeJump()" },
			"fight.targetNext": { t: "this.cycleTarget(1)" },
			"fight.targetPrevious": { g: "this.cycleTarget(-1)" },
			"fight.faceTarget": { f: "this.faceTarget()" },
			"fight.rigIncoming": { "/": 'this.combatRig?.command("/")' },
			"fight.rigEcm": { q: 'this.combatRig?.command("q")' },
			"dock.clearance": { c: "this.requestDockingClearance()" },
			"dock.computer": { u: "this.toggleDockingComputer()" },
			"dock.launch": { enter: "this.launch()" },
			"view.headPort": { "1": 'this.setHeadLook("left")' },
			"view.headForward": { "2": 'this.setHeadLook("forward")' },
			"view.headStarboard": { "3": 'this.setHeadLook("right")' },
			"view.reference": { "?": "controlsKeyMove(", f1: "controlsKeyMove(" },
			"view.toggle": { v: 'this.view === "cockpit" ? "chase" : "cockpit"' },
			"view.orbitCentre": { "2": "this.chaseYaw = 0" },
			"tune.reset": { "0": "DEFAULT_CRUISE" },
			"tune.exponentUp": { "]": exponent.up },
			"tune.exponentDown": { "[": exponent.down },
			"tune.vMaxUp": { "=": vmax.up },
			"tune.vMaxDown": { "-": vmax.down },
			"tune.dropRadiusUp": { "'": radius.up },
			"tune.dropRadiusDown": { ";": radius.down },
			"tune.dropSpeedUp": { ".": speed.up },
			"tune.dropSpeedDown": { ",": speed.down },
			"tune.vicinityUp": { m: vicinity.up },
			"tune.vicinityDown": { n: vicinity.down },
			"tune.approachLeadUp": { l: lead.up },
			"tune.approachLeadDown": { k: lead.down },
		};
		let checked = 0;
		for (const c of CONTROLS.commands)
			for (const t of c.currentTriggers) {
				if (!isPressedKey(t)) continue;
				const body = caseBody(t.key);
				if (body === null) continue; // a panel's own key, held above
				const want = EFFECTS[c.id]?.[t.key];
				const at = `${c.id}: ${JSON.stringify(t.key)}`;
				expect(`${at} → ${want !== undefined && body.includes(want)}`).toBe(
					`${at} → true`,
				);
				checked++;
			}
		// Every entry was used: a row renamed away from its entry is red too.
		const entries = Object.values(EFFECTS).flatMap((e) => Object.keys(e));
		expect(checked).toBe(entries.length);
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
			// #369 D1: a namespaced id, so two commands cannot collide on a
			// plausible word. **The namespace is not the task group** — three
			// namespaces (`panel`, `tune`, `perf`) share the `system` group, and
			// a reader deriving one from the other would be wrong on better than
			// a third of the rows. `group` is authored beside the id.
			expect(id).toMatch(/^[a-z]+\.[a-zA-Z0-9]+$/);
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

	test("x is two rows, because the gesture picks the meaning", () => {
		// #369 D3, which reverses #370 D8's single row on the evidence #370 did
		// not have: `x` *pressed* toggles the assist in `main.ts`'s switch and
		// `x` *held* is read every frame by `combat-rig.ts`. A trigger whose
		// meaning game state picks stays one row (`fly.cruise`, `dock.launch`);
		// a trigger whose meaning the gesture picks is two, and a player must be
		// able to move one without moving the other.
		const rows = CONTROLS.commands.filter((c) =>
			c.currentTriggers.some((t) => t.kind === "key" && t.key === "x"),
		);
		expect(rows.map((c) => c.id).sort()).toEqual([
			"fight.fireBeam",
			"fly.assist",
		]);
		const press = rows.find((c) => c.id === "fly.assist");
		const hold = rows.find((c) => c.id === "fight.fireBeam");
		expect(press?.name).toMatch(/assist/i);
		expect(hold?.name).toMatch(/beam/i);
		// And they are not a collision: a press and a hold are different triggers.
		expect(
			press?.currentTriggers.some((t) => t.kind === "key" && !t.hold),
		).toBe(true);
		expect(hold?.currentTriggers.some((t) => t.kind === "key" && t.hold)).toBe(
			true,
		);
	});

	test("? is the controls reference's own key", () => {
		const row = CONTROLS.commands.find((c) =>
			c.currentTriggers.some((t) => t.kind === "key" && t.key === "?"),
		);
		expect(row?.group).toBe("view");
	});
});
