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
	type CommandId,
	DEFAULT_BINDINGS,
	PAD_FLIGHT_COMMANDS,
	PANEL_INTENTS,
	rebind,
	type PanelIntent,
	TASK_GROUPS,
	resolveKey,
	type Trigger,
} from "../src/commands";
import { CONTROLS, controlsCatalogue } from "../src/controls-catalogue";
import { STANDARD_BUTTONS } from "../src/gamepad";
import { padIntents } from "../src/pad-bindings";
import { PERF_KEYS, RESTORE_KEY } from "../src/perf-panel";
import { SETTINGS_KEY } from "../src/settings-panel";
import { boundKeys, codeOf, dispatchSites } from "./lib/source-scan";

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
 * Every key the game states **outside** the registry.
 *
 * Four constants, in three panels. The perf panel's two are keys it reads.
 * `SETTINGS_KEY` and `COMMANDER_KEY` are the two player screens' shipped
 * defaults, and since #381 S5 neither screen reads its own: both open, close
 * and print through the layout in force. They are the whole of this set since
 * #381's dispatch fold: `main.ts` and `combat-rig.ts` no longer **compare** a
 * key, so a scan of their text answers nothing — and a scan that answers
 * nothing makes a completeness row vacuously green, which is the direction
 * this file must never fail in.
 *
 * *Compared*, and since S5 not *stated* either: `combat-rig.ts` drew a
 * `LEGEND` naming four keys in prose until `rigLegend` read them off the
 * layout. This sentence said "state no key at all" for a round before that
 * was true, and the fix landed in one copy of the claim and not the other
 * (sage round 5).
 */
const sourceKeys = () =>
	// **Unfiltered**: `keyShaped` is for scanner output, where a string with a
	// capital in it is a comparison no keypress can satisfy. These are
	// imported constants, and filtering them would silently drop an uppercase
	// panel key out of the completeness row instead of checking it.
	new Set([...PERF_KEYS, RESTORE_KEY, SETTINGS_KEY, COMMANDER_KEY]);

describe("the catalogue is complete against the source", () => {
	test("the two files that used to compare keys no longer compare any", () => {
		// The fold's own claim, and the reason the scan above shrank rather
		// than breaking: a key *compared* in either file is a binding the
		// registry does not own and the `Controls` tab cannot report.
		//
		// **Compared, not stated** — the weaker word was the true one for a
		// round, while `combat-rig.ts` shipped a `LEGEND` naming SPACE, X, `/`
		// and Q that the fold had made rebindable. #381 S5 derived it
		// (`rigLegend`), and `tests/derived-names.test.ts` holds it; this scan
		// could not have, since a key inside a prose string is not a
		// comparison shape.
		//
		// Two things the scanner reads that are not keys, and both are named
		// rather than filtered by shape. `main.ts` compares
		// `key === "renderScale"` in the settings subscription, which is a
		// settings field — `onKey` lowercases `e.key`, so a string with a
		// capital in it is one no keyboard produces, and that is `keyShaped`.
		// And every `case` label is a command id now, which is the fold.
		//
		// The one literal left is Space, and it is the browser's rather than
		// the game's: a focused native button activates on its *release*, so
		// `onKey` returns without firing or preventing it. That is not a
		// binding and has no registry row.
		const anId = (k: string) => /^[a-z]+\.[A-Za-z0-9]+$/.test(k);
		for (const file of ["src/main.ts", "src/combat-rig.ts"]) {
			const left = [...boundKeys(codeOf(file))]
				.filter(keyShaped)
				.filter((k) => !anId(k) && k !== " ");
			expect(`${file}: ${left.join(",")}`).toBe(`${file}: `);
		}
		// Guarding that guard: the scanner still reads this file, so an empty
		// answer above is the code being clean rather than the regex being dead.
		expect(boundKeys(codeOf("src/main.ts"))).toContain("renderScale");
	});

	test("the panels' own keys are found", () => {
		// Guarding the guard: an empty set would make the row below vacuously
		// green.
		expect(sourceKeys().size).toBeGreaterThan(8);
		expect(sourceKeys()).toContain(SETTINGS_KEY);
	});

	test("every bound key is in the catalogue", () => {
		const printed = catalogueKeys();
		for (const key of sourceKeys())
			expect(`${JSON.stringify(key)}: ${printed.has(key)}`).toBe(
				`${JSON.stringify(key)}: true`,
			);
	});

	/**
	 * **Every command a key reaches is named by its id in the code** (#381).
	 *
	 * The row this replaces checked each printed key in the shape it was
	 * printed as, against `main.ts`'s own text — a `case "v":`, a `keys.has`,
	 * an `axis` list. The dispatch fold took every one of those shapes away:
	 * the registry states the key and `main.ts` states only the effect, keyed
	 * by id. So the question turns over. It is no longer "is this key bound",
	 * which the registry answers by construction; it is **"does anything
	 * happen when it is pressed"**, and a command printed on the `Controls`
	 * tab with no handler behind it is exactly the failure the old row was
	 * opened against — a player trusts the reference and the key does nothing.
	 *
	 * The two exempt groups are named rather than filtered by shape: the
	 * player screens listen for their own key, and the `?perf` diagnostics are
	 * `fixed: "diagnostic"` and live in a module this tier does not read.
	 */
	test("every command a key reaches is named by its id at a dispatch site", () => {
		// **The shapes, not the file's text** (sage round 1). A bare
		// `source.includes(id)` cannot tell a live dispatch site from a stale
		// mention in a comment, which is the failure the row it replaced was
		// immune to — that one looked each trigger up in the shape it was
		// printed as. `dispatchSites` owns the four shapes that actually run a
		// command, and is shared with `commands.test.ts` rather than copied
		// (sage round 2).
		const reached = new Set([
			...dispatchSites(codeOf("src/main.ts")).all,
			...dispatchSites(codeOf("src/combat-rig.ts")).all,
			// The hands' table moved out of `main.ts` (#620): `pilotHands` asks
			// the held predicate for the throttle and the four strafes.
			...dispatchSites(codeOf("src/pilot-demand.ts")).all,
		]);
		// Guard the guard: each shape found something, so a renamed helper
		// cannot make the loop below pass on a set built from four dead regexes.
		expect([
			reached.has("fly.assist"), // a case
			reached.has("panel.cursorUp"), // a case in the other switch
			reached.has("fly.throttleUp"), // a held read
			reached.has("fly.pitchUp"), // an axis list
			reached.has("fight.fireBeam"), // the rig's predicate
			reached.has("fight.rigEcm"), // the rig's own command
		]).toEqual([true, true, true, true, true, true]);

		// **No panel is exempt since #381 S5.** The Commander overlay's open
		// was the last one on a listener of its own, and a panel exemption
		// here is what let the registry offer its key for rebinding while
		// nothing dispatched it.
		let checked = 0;
		for (const c of CONTROLS.commands) {
			if (c.fixed === "diagnostic") continue;
			if (!c.currentTriggers.some((t) => t.kind === "key")) continue;
			expect(`${c.id}: ${reached.has(c.id)}`).toBe(`${c.id}: true`);
			checked++;
		}
		expect(checked).toBeGreaterThan(40);
	});

	/**
	 * **A command on the right row, not only a reached one** (sage round 2 on
	 * #372, re-aimed by #381). The row above holds id *sets*: swap the bodies
	 * of `case "fight.targetNext":` and `case "fight.targetPrevious":` and it
	 * stays green while the tab prints "Next target" against the command that
	 * now selects the previous one. So every command with a case in `main.ts`
	 * is looked up there, and its body must make the call this table names.
	 *
	 * The table is a restatement, deliberately: it is the one place a row's
	 * *meaning* meets the code. A command with a `case` and no entry here is a
	 * red run; one with no case — a panel's own, or a held command, which has
	 * no case by construction — is not checked by this row, and the row above
	 * is what holds it.
	 */
	test("every case does what its command's row says", () => {
		const main = codeOf("src/main.ts");
		const caseBody = (id: string) => {
			const at = main.indexOf(`case ${JSON.stringify(id)}:`);
			if (at === -1) return null;
			const rest = main.slice(at).replace(/^(\s*case\s+"[^"]+"\s*:)+/, "");
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
		const EFFECTS: Record<string, string> = {
			"fly.assist": "this.assist = !this.assist",
			"fly.cruise": "this.engageCruise()",
			"fly.jump": "this.chargeJump()",
			"fight.targetNext": "this.cycleTarget(1)",
			"fight.targetPrevious": "this.cycleTarget(-1)",
			"fight.faceTarget": "this.faceTarget()",
			"fight.rigIncoming": 'this.combatRig?.command("fight.rigIncoming")',
			"fight.rigEcm": 'this.combatRig?.command("fight.rigEcm")',
			"dock.clearance": "this.requestDockingClearance()",
			"dock.computer": "this.toggleDockingComputer()",
			"dock.launch": "this.launch()",
			"view.headPort": 'this.setHeadLook("left")',
			"view.headForward": 'this.setHeadLook("forward")',
			"view.headStarboard": 'this.setHeadLook("right")',
			"view.orbitCentre": "this.chaseOrbit = ORBIT_ASTERN",
			"view.photo": "this.togglePhotoMode()",
			// #381 S4: the settings screen's open key is the registry's now, not
			// the panel's own listener.
			"system.settings": "this.settingsPanel?.open()",
			"system.commander": "this.commanderOverlay?.open()",
			// Node #843: sharing waits for the models before opening the panel.
			"system.postcard": "this.openPostcardWithModels()",
			"view.reference": "controlsKeyMove(",
			"view.toggle": 'this.view === "cockpit" ? "chase" : "cockpit"',
			"panel.activate": "this.liveCockpit.activateKeyboardFocus(target)",
			"panel.tabPrevious": "this.liveCockpit.stepTab(-1)",
			"panel.tabNext": "this.liveCockpit.stepTab(1)",
			"panel.cursorUp": "this.stepConsoleFocus(-1)",
			"panel.cursorDown": "this.stepConsoleFocus(1)",
			"tune.reset": "DEFAULT_CRUISE",
			"tune.exponentUp": exponent.up,
			"tune.exponentDown": exponent.down,
			"tune.vMaxUp": vmax.up,
			"tune.vMaxDown": vmax.down,
			"tune.dropRadiusUp": radius.up,
			"tune.dropRadiusDown": radius.down,
			"tune.dropSpeedUp": speed.up,
			"tune.dropSpeedDown": speed.down,
			"tune.vicinityUp": vicinity.up,
			"tune.vicinityDown": vicinity.down,
			"tune.approachLeadUp": lead.up,
			"tune.approachLeadDown": lead.down,
		};
		let checked = 0;
		for (const c of CONTROLS.commands) {
			const body = caseBody(c.id);
			if (body === null) continue;
			const want = EFFECTS[c.id];
			const at = `${c.id}`;
			expect(`${at} → ${want !== undefined && body.includes(want)}`).toBe(
				`${at} → true`,
			);
			checked++;
		}
		// Every entry was used: a row renamed away from its entry is red too.
		expect(checked).toBe(Object.keys(EFFECTS).length);
	});

	/**
	 * **The chord shape, and what became checkable about it** (sage round 3,
	 * reworked by #381 S4).
	 *
	 * The finding was that the per-command row cannot hold a chord: deleting
	 * an entry from `ALT_CHORDS` would leave the tab printing `Alt + ←` with
	 * the suite green. The row written against it *could not fail*, because
	 * `chordsFor` derived the catalogue's chord rows from that same table, and
	 * so did its replacement.
	 *
	 * **The table is gone now, and with it the class of defect.** A chord is a
	 * row of the registry, and `keyDispatch` holds no chord table at all — it
	 * decides only *that* an Alt press is a chord, and the layout answers what
	 * it reaches. There are no longer two places to disagree, so the row worth
	 * having is the one that says the second place has not come back.
	 */
	test("the dispatch law holds no chord table of its own", () => {
		// A code literal there is the shape of the defect: `ArrowLeft` beside
		// the key it stands for is exactly what was deleted. Nothing in the law
		// may name a physical key, because naming one is holding a binding.
		const law = codeOf("src/key-dispatch.ts");
		const body = law.slice(law.indexOf("export function keyDispatch"));
		expect(body).not.toMatch(/Arrow(Left|Up|Right|Down)/);
		expect(body).not.toMatch(/\bKey[A-Z]\b/);
	});

	test("the three ratified chords are printed, and nothing else is", () => {
		// A literal, because this is the *defaults-did-not-move* question and a
		// list derived from the thing it checks answers it with itself. #369's
		// Boundary is that the principal flew this layout.
		const printed = triggers().flatMap((t) =>
			t.kind === "key" && t.alt === true && t.code !== undefined
				? [t.code]
				: [],
		);
		expect([...printed].sort()).toEqual(
			["ArrowLeft", "ArrowRight", "ArrowUp"].sort(),
		);
	});

	/**
	 * And that each printed chord reaches the row that prints it.
	 *
	 * **Weaker than the row it replaces, and deliberately so.** A chord used
	 * to *stand for* a key, so the two halves came from different places and
	 * could part company — a command whose bare key moved out from under its
	 * chord would print `Alt + ←` and run something else. There is one half
	 * now, so this asks only that `resolveKey`'s Alt arm agrees with what the
	 * tab prints: it would catch a resolver that dropped `alt` from its
	 * qualifiers, and it cannot catch a drift that no longer has two sides.
	 */
	test("and each printed chord reaches the row that prints it", () => {
		let checked = 0;
		for (const c of CONTROLS.commands)
			for (const t of c.currentTriggers) {
				if (t.kind !== "key" || t.alt !== true || t.code === undefined)
					continue;
				const reached = resolveKey(DEFAULT_BINDINGS, {
					key: t.key,
					code: t.code,
					alt: true,
					view: "cockpit",
				});
				const at = `${c.id}: ${JSON.stringify(t.code)}+alt`;
				expect(`${at}: ${reached.includes(c.id)}`).toBe(`${at}: true`);
				checked++;
			}
		expect(checked).toBe(3);
	});

	/**
	 * **And the surface shape, for the same reason.** `panel.cursorUp` and
	 * `fly.pitchDown` are both reached, so the per-command row is satisfied by
	 * either; what it cannot say is that the *surface-scoped* arrow is the one
	 * the console walks on. `main.ts` resolves that branch with an explicit
	 * `surface: "requests"`, so the registry's answer there is the check.
	 */
	test("every surface-scoped key is resolved on that surface and not off it", () => {
		let checked = 0;
		for (const c of CONTROLS.commands)
			for (const t of c.currentTriggers) {
				if (t.kind !== "key" || t.surface === undefined) continue;
				const on = resolveKey(DEFAULT_BINDINGS, {
					key: t.key,
					surface: t.surface,
					view: "cockpit",
				});
				const off = resolveKey(DEFAULT_BINDINGS, {
					key: t.key,
					view: "cockpit",
				});
				const at = `${c.id}: ${JSON.stringify(t.key)} on ${t.surface}`;
				expect(`${at}: ${on.includes(c.id)} / ${off.includes(c.id)}`).toBe(
					`${at}: true / false`,
				);
				checked++;
			}
		expect(checked).toBeGreaterThan(4);
	});

	test("the six panel intents each have a row", () => {
		// Read off the value the pad module returns, not off a list written
		// here: a seventh field added to `PadIntents` is a red run.
		const fields = Object.keys(padIntents(null, "flight")).filter(
			(k) => k !== "buttons",
		) as PanelIntent[];
		expect(fields.length).toBe(6);
		expect([...PANEL_INTENTS].sort()).toEqual([...fields].sort());
		const printed = new Set(
			triggers().flatMap((t) => (t.kind === "pad-intent" ? [t.intent] : [])),
		);
		for (const field of fields)
			expect(`${field}: ${printed.has(field)}`).toBe(`${field}: true`);
	});

	test("every pad button the flight table binds is printed on that command's row", () => {
		// The table names commands since #381 S4, so this no longer hops
		// through a key: the button is printed on the row of the command the
		// table names, and a button naming a command that does not print it is
		// a player told the wrong thing.
		let checked = 0;
		for (const [button, ids] of Object.entries(PAD_FLIGHT_COMMANDS))
			for (const id of ids ?? []) {
				const row = CONTROLS.commands.find((c) => c.id === id);
				const onRow =
					row?.currentTriggers.some(
						(t) => t.kind === "pad-button" && t.button === button,
					) === true;
				expect(`${button} → ${id}: ${onRow}`).toBe(`${button} → ${id}: true`);
				checked++;
			}
		expect(checked).toBe(13);
	});

	test("every pad button is printed somewhere", () => {
		// glossary-ignore: pad
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
		// `home` was the one button nothing claimed, and this row excepted it
		// by name; node #703 made it the eject, held, so there is no exception
		// left and a button dropped from the catalogue is a red run.
		expect(missing).toEqual([]);
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
			press?.currentTriggers.some(
				(t) => t.kind === "key" && t.key === "x" && !t.hold,
			),
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

describe("the catalogue is a view of the layout in force (#381 S3)", () => {
	const PITCH_UP: CommandId = "fly.pitchUp";
	const found = DEFAULT_BINDINGS.find(
		(b) => b.command === PITCH_UP && b.trigger.kind === "key" && b.trigger.hold,
	)?.trigger;
	if (found === undefined || found.kind !== "key")
		throw new Error(`${PITCH_UP} ships on no held key`);
	const from = found;
	const moved = rebind(DEFAULT_BINDINGS, PITCH_UP, from, {
		kind: "key",
		key: "8",
		hold: true,
	});

	test("the shipped layout is reported as the default, not the player's", () => {
		// The screen must not offer "PLAYER LAYOUT" for rows the player never
		// moved — which is what `layout: \"default\"` was hardcoded to say until
		// there was a layout to compare against.
		expect(controlsCatalogue(DEFAULT_BINDINGS).layout).toBe("default");
		expect(CONTROLS.layout).toBe("default");
	});

	test("one moved row makes it the player's", () => {
		expect(controlsCatalogue(moved).layout).toBe("player");
	});

	test("and the row prints the key it is on now, not the one it shipped on", () => {
		// `currentTriggers` was a copy of `defaultTriggers` for two slices, so
		// the two were the same thing and nothing could tell them apart.
		const row = controlsCatalogue(moved).commands.find(
			(c) => c.id === PITCH_UP,
		);
		expect(
			row?.currentTriggers.some((t) => t.kind === "key" && t.key === "8"),
		).toBe(true);
		expect(
			row?.currentTriggers.some((t) => t.kind === "key" && t.key === from.key),
		).toBe(false);
		// The shipped triggers are untouched beside it, which is what makes the
		// tab able to say what a control *was*.
		expect(
			row?.defaultTriggers.some((t) => t.kind === "key" && t.key === from.key),
		).toBe(true);
	});

	test("notices are carried, and there are none by default", () => {
		expect(CONTROLS.notices).toEqual([]);
		const carried = controlsCatalogue(DEFAULT_BINDINGS, [
			{ kind: "unreadable", cause: "corrupt", detail: "not JSON" },
		]);
		expect(carried.notices.length).toBe(1);
	});
});
