/**
 * The binding registry (#381), against #369's rulings rather than against
 * itself.
 *
 * Three of these rows exist because the module cannot state them: a predicate
 * that has never been shown to go red is a predicate nobody has tested, so the
 * collision rows build the colliding layout and watch it be reported, and the
 * view-liveness row removes the view dimension and watches the same pair turn
 * into a collision.
 */
import { describe, expect, test } from "bun:test";
import { codeOf, dispatchSites, srcFiles } from "./lib/source-scan";
import {
	type Binding,
	codeKey,
	collisions,
	COMMANDS,
	type CommandId,
	type Half,
	commandById,
	DEFAULT_BINDINGS,
	defaultCollisions,
	PAD_CONTEXTS,
	PAD_FLIGHT_COMMANDS,
	type Layout,
	layoutOf,
	rebind,
	resolveKey,
	resolvePad,
	TASK_GROUPS,
	type Trigger,
	triggerKey,
	VIEW_MODES,
} from "../src/commands";
import type { PadButtonName } from "../src/gamepad";
import { keyDispatch } from "../src/key-dispatch";

/**
 * The shipped keyboard layout, frozen.
 *
 * #369's Boundary is that no default moves: the principal flew #283's
 * acceptance legs to ratify this layout, and a remap feature that also moved a
 * default would be two changes and one review. Without this row any later
 * feature can move one as a side effect and the suite stays green.
 *
 * **What ties it to something outside this file, and what does not.** The
 * *pressed* keys are tied to `main.ts` in both directions by
 * `controls-catalogue.test.ts`, which reads the source with the partition
 * test's own scanner and checks each one's case body. The **held** keys are
 * not: `isPressedKey` excludes them, so nothing in that row looks at
 * `key:w::hold`. An inverted `w`/`s` would freeze green here and ship to the
 * public manual — which is why `the axis law names which key is which` below
 * reads the four `axis()` call sites out of `main.ts` and pairs them, and
 * why this row carries each binding's **scope** rather than its trigger
 * alone: dropping `surface` from a panel key would otherwise leave the row
 * unchanged while moving the key onto the ship's surface.
 *
 * **One move since, and it was ratified rather than a side effect:** #620 put
 * `flight-model.md` §3.5's strafe on the four held arrows, which stopped
 * repeating pitch and yaw. Node #703 added a row rather than moving one: the
 * eject on a held Backspace, a key nothing had bound (#660 D4). And #892
 * added the fire-group cycle on `b` by #385 D6, which moved no row: bloom
 * kept `b`, scoped to the `?perf` panel — the trailing `perf` on the
 * diagnostics, carried for `surface`'s reason.
 */
const RATIFIED_LAYOUT: readonly string[] = [
	"key: ::hold → fight.firePulse @ flight/instrument/console/modal cockpit/chase -",
	"key:'::press → tune.dropRadiusUp @ flight/instrument/console/modal cockpit/chase -",
	"key:,::press → tune.dropSpeedDown @ flight/instrument/console/modal cockpit/chase -",
	"key:-::press → tune.vMaxDown @ flight/instrument/console/modal cockpit/chase -",
	"key:.::press → tune.dropSpeedUp @ flight/instrument/console/modal cockpit/chase -",
	"key:/::press → fight.rigIncoming @ flight/instrument/console/modal cockpit/chase -",
	"key:0::press → tune.reset @ flight/instrument/console/modal cockpit/chase -",
	"key:1::hold → view.orbitPort @ flight/instrument/console/modal chase -",
	"key:1::press → view.headPort @ flight/instrument/console/modal cockpit -",
	"key:2::press → view.headForward @ flight/instrument/console/modal cockpit -",
	"key:2::press → view.orbitCentre @ flight/instrument/console/modal chase -",
	"key:3::hold → view.orbitStarboard @ flight/instrument/console/modal chase -",
	"key:3::press → view.headStarboard @ flight/instrument/console/modal cockpit -",
	"key:6::press → system.postcard @ flight/instrument/console/modal cockpit/chase -",
	"key:7::press → view.fov @ flight/instrument/console/modal cockpit -",
	"key:9::press → system.commander @ flight/instrument/console/modal cockpit/chase -",
	"key:;::press → tune.dropRadiusDown @ flight/instrument/console/modal cockpit/chase -",
	"key:=::press → tune.vMaxUp @ flight/instrument/console/modal cockpit/chase -",
	"key:?::press → view.reference @ flight/instrument/console/modal cockpit/chase -",
	"key:[::press → tune.exponentDown @ flight/instrument/console/modal cockpit/chase -",
	"key:]::press → tune.exponentUp @ flight/instrument/console/modal cockpit/chase -",
	"key:`::press → fly.jump @ flight/instrument/console/modal cockpit/chase -",
	"key:a::hold → fly.yawPort @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowdown::hold → fly.strafeVentral @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowdown::press → panel.cursorDown @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowleft::hold → fly.strafePort @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowleft::press → panel.tabPrevious @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowleft:alt:press → view.headPort @ flight/instrument/console/modal cockpit -",
	"key:arrowright::hold → fly.strafeStarboard @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowright::press → panel.tabNext @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowright:alt:press → view.headStarboard @ flight/instrument/console/modal cockpit -",
	"key:arrowup::hold → fly.strafeDorsal @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowup::press → panel.cursorUp @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowup:alt:press → view.headForward @ flight/instrument/console/modal cockpit -",
	"key:b::press → fight.cycleFireGroup @ flight/instrument/console/modal cockpit/chase -",
	"key:b::press → perf.bloom @ flight/instrument/console/modal cockpit/chase - perf",
	"key:backspace::hold → fly.eject @ flight/instrument/console/modal cockpit/chase -",
	"key:c::press → dock.clearance @ flight/instrument/console/modal cockpit/chase -",
	"key:control::hold → fly.throttleDown @ flight/instrument/console/modal cockpit/chase -",
	"key:d::hold → fly.yawStarboard @ flight/instrument/console/modal cockpit/chase -",
	"key:e::hold → fly.rollStarboard @ flight/instrument/console/modal cockpit/chase -",
	"key:enter::press → dock.launch @ flight/instrument/console/modal cockpit/chase -",
	"key:enter::press → panel.activate @ flight/instrument/console/modal cockpit/chase requests",
	"key:f1::press → view.reference @ flight/instrument/console/modal cockpit/chase -",
	"key:f2::press → view.photo @ flight/instrument/console/modal cockpit/chase -",
	"key:f7::press → fight.launchMissile @ flight/instrument/console/modal cockpit/chase -",
	"key:f8::press → fight.ecm @ flight/instrument/console/modal cockpit/chase -",
	"key:f::press → fight.faceTarget @ flight/instrument/console/modal cockpit/chase -",
	"key:g::press → fight.targetPrevious @ flight/instrument/console/modal cockpit/chase -",
	"key:h::press → perf.atmosphere @ flight/instrument/console/modal cockpit/chase - perf",
	"key:i::press → perf.restore @ flight/instrument/console/modal cockpit/chase - perf",
	"key:j::press → fly.cruise @ flight/instrument/console/modal cockpit/chase -",
	"key:k::press → tune.approachLeadDown @ flight/instrument/console/modal cockpit/chase -",
	"key:l::press → tune.approachLeadUp @ flight/instrument/console/modal cockpit/chase -",
	"key:m::press → tune.vicinityUp @ flight/instrument/console/modal cockpit/chase -",
	"key:n::press → tune.vicinityDown @ flight/instrument/console/modal cockpit/chase -",
	"key:o::press → perf.craters @ flight/instrument/console/modal cockpit/chase - perf",
	"key:p::press → perf.class @ flight/instrument/console/modal cockpit/chase - perf",
	"key:q::hold → fly.rollPort @ flight/instrument/console/modal cockpit/chase -",
	"key:q::press → fight.rigEcm @ flight/instrument/console/modal cockpit/chase -",
	"key:r::press → perf.relief @ flight/instrument/console/modal cockpit/chase - perf",
	"key:s::hold → fly.pitchUp @ flight/instrument/console/modal cockpit/chase -",
	"key:shift::hold → fly.throttleUp @ flight/instrument/console/modal cockpit/chase -",
	"key:t::press → fight.targetNext @ flight/instrument/console/modal cockpit/chase -",
	"key:u::press → dock.computer @ flight/instrument/console/modal cockpit/chase -",
	"key:v::press → view.toggle @ flight/instrument/console/modal cockpit/chase -",
	"key:w::hold → fly.pitchDown @ flight/instrument/console/modal cockpit/chase -",
	"key:x::hold → fight.fireBeam @ flight/instrument/console/modal cockpit/chase -",
	"key:x::press → fly.assist @ flight/instrument/console/modal cockpit/chase -",
	"key:y::press → perf.clouds @ flight/instrument/console/modal cockpit/chase - perf",
	"key:z::press → system.settings @ flight/instrument/console/modal cockpit/chase -",
];

const scopeText = (b: Binding) =>
	`${b.scope.pad.join("/")} ${b.scope.views.join("/")} ${b.scope.surface ?? "-"}${b.scope.perfPanel ? " perf" : ""}`;

const keyRows = (bindings: readonly Binding[]) =>
	bindings
		.flatMap((b) =>
			b.trigger.kind === "key"
				? [`${triggerKey(b.trigger)} → ${b.command} @ ${scopeText(b)}`]
				: [],
		)
		.sort();

describe("the catalogue #369 ratified", () => {
	test("every id is namespaced, unique, and not a key string", () => {
		const ids = COMMANDS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-zA-Z0-9]+$/);
	});

	test("a direction is a command, not an argument", () => {
		// D2: the smallest thing one trigger can cause is one command. Each of
		// these pairs was one row in #372's interim module.
		for (const [up, down] of [
			["fly.pitchUp", "fly.pitchDown"],
			["fly.yawPort", "fly.yawStarboard"],
			["fly.rollPort", "fly.rollStarboard"],
			["panel.cursorUp", "panel.cursorDown"],
			["panel.tabPrevious", "panel.tabNext"],
			["panel.valueDown", "panel.valueUp"],
			["view.orbitPort", "view.orbitStarboard"],
		] as const) {
			// The property the split is about: two rows, each with triggers of
			// its own. `commandById` throws on an id that is not in the table,
			// so a missing half is red before the assertion below runs.
			expect(commandById(up).defaultTriggers.length).toBeGreaterThan(0);
			expect(commandById(down).defaultTriggers.length).toBeGreaterThan(0);
			expect(commandById(up).defaultTriggers).not.toEqual(
				commandById(down).defaultTriggers,
			);
		}
		// Twelve dial steps and a reset, where #372 had six rows and a reset.
		expect(COMMANDS.filter((c) => c.id.startsWith("tune.")).length).toBe(13);
	});

	test("a signed input is two bindings, and the registry has no axis entity", () => {
		// D2's hard case. A stick causes both directions, and the answer is two
		// signed bindings on two commands rather than a second kind of bindable
		// thing — so every stick and mouse-axis trigger names its half.
		// **Not `"half" in trigger`** — the type declares it required on both
		// kinds, so that reads as a check and holds by construction. What can
		// fail is the pairing: each physical axis is pushed two ways, the two
		// pushes land on different commands, and the pair is the pair the
		// registry says it is.
		const isSigned = (
			b: Binding,
		): b is Binding & {
			trigger: Extract<Trigger, { kind: "pad-stick" | "mouse-move" }>;
		} => b.trigger.kind === "pad-stick" || b.trigger.kind === "mouse-move";
		const halves = DEFAULT_BINDINGS.filter(isSigned);
		const byAxis = new Map<string, Map<string, string[]>>();
		for (const b of halves) {
			// The mouse's axes mean one thing per view (node #691): the ship's
			// turn in the cockpit, the camera's orbit in chase.
			const axis =
				b.trigger.kind === "pad-stick"
					? `${b.trigger.stick}-stick-${b.trigger.axis}`
					: `mouse-${b.trigger.axis} in ${b.scope.views.join("/")} ${b.scope.photoMode ? "Photo" : "flight"}`;
			// **Accumulated, not overwritten.** `set` would hide a second
			// command claiming one half of an axis, which is the thing this row
			// exists to see.
			const halfMap = byAxis.get(axis) ?? new Map<string, string[]>();
			halfMap.set(b.trigger.half, [
				...(halfMap.get(b.trigger.half) ?? []),
				b.command,
			]);
			byAxis.set(axis, halfMap);
		}
		const pairs = [...byAxis]
			.map(
				([axis, halfMap]) =>
					`${axis}: ${halfMap.get("-")} | ${halfMap.get("+")}`,
			)
			.sort();
		expect(pairs).toEqual([
			"left-stick-x: fly.rollPort | fly.rollStarboard",
			"left-stick-y: fly.strafeDorsal | fly.strafeVentral",
			"mouse-x in chase Photo: view.orbitStarboard | view.orbitPort",
			"mouse-x in cockpit/chase flight: fly.yawPort | fly.yawStarboard",
			"mouse-y in chase Photo: view.orbitUp | view.orbitDown",
			"mouse-y in cockpit/chase flight: fly.pitchDown | fly.pitchUp",
			"right-stick-x: fly.yawPort | fly.yawStarboard",
			"right-stick-y: fly.pitchDown | fly.pitchUp",
		]);
	});

	test("the three kinds of fixed row are catalogued, and say which kind", () => {
		// D12's rider, and the distinction the capture slice needs: a
		// diagnostic and a rig key *have* a trigger the player is not offered,
		// while a pointer row has nothing to move at all. A bit would make
		// those one answer.
		const fixed = COMMANDS.filter((c) => c.fixed !== undefined)
			.map((c) => `${c.id}: ${c.fixed}`)
			.sort();
		expect(fixed).toEqual([
			"fight.rigEcm: rig",
			"fight.rigIncoming: rig",
			"fly.takePointer: pointer",
			"perf.atmosphere: diagnostic",
			"perf.bloom: diagnostic",
			"perf.class: diagnostic",
			"perf.clouds: diagnostic",
			"perf.craters: diagnostic",
			"perf.relief: diagnostic",
			"perf.restore: diagnostic",
			"trade.actOnRow: pointer",
			"view.orbitDown: pointer",
			"view.orbitUp: pointer",
		]);
		// And the bit agrees with the reason, both ways.
		for (const c of COMMANDS)
			expect(`${c.id}: ${c.rebindable}`).toBe(
				`${c.id}: ${c.fixed === undefined}`,
			);
	});

	test("every command is in one of the six task groups", () => {
		for (const c of COMMANDS) expect(TASK_GROUPS).toContain(c.group);
		for (const g of TASK_GROUPS)
			expect(`${g}: ${COMMANDS.some((c) => c.group === g)}`).toBe(`${g}: true`);
	});
});

describe("the ratified layout", () => {
	test("no default has moved", () => {
		expect(keyRows(DEFAULT_BINDINGS)).toEqual([...RATIFIED_LAYOUT]);
	});

	test("the frozen list is not empty, and names commands that exist", () => {
		// Guarding the guard: an empty or misspelled list would make the row
		// above pass on nothing.
		expect(RATIFIED_LAYOUT.length).toBeGreaterThan(50);
		for (const row of RATIFIED_LAYOUT) {
			const id = row.slice(row.indexOf("→ ") + 2, row.indexOf(" @ "));
			expect(`${id}: ${COMMANDS.some((c) => c.id === id)}`).toBe(`${id}: true`);
		}
	});
});

describe("the axis law names which key is which", () => {
	/**
	 * The signed axes, read out of `main.ts` — **as command ids since #381's
	 * dispatch fold**, which is what those call sites now name.
	 *
	 * The question this row asks did not change with the fold, and the thing
	 * that answers it did. `axis(negative, positive)` used to carry two key
	 * lists, and nothing outside this file knew which of `w` and `s` puts the
	 * nose up while the registry publishes that pairing to the `Controls` tab
	 * and to the public manual. The keys are the registry's now, held frozen
	 * by `RATIFIED_LAYOUT`; what `main.ts` still decides by itself is **which
	 * half of the pair is the negative term**, and swapping two ids there is
	 * still a working game that flies inverted.
	 */
	const axisCalls = () => {
		const source = codeOf("src/main.ts");
		const found = [...source.matchAll(/this\.axis\("([^"]+)",\s*"([^"]+)"\)/g)];
		return found.map((m) => ({
			negative: [m[1] as string],
			positive: [m[2] as string],
		}));
	};

	test("the scan finds the call sites it is supposed to find", () => {
		// Guarding the guard: a renamed helper would make the row below pass on
		// an empty list.
		const calls = axisCalls();
		expect(calls.length).toBe(4);
		for (const call of calls) {
			expect(call.negative.length).toBeGreaterThan(0);
			expect(call.positive.length).toBeGreaterThan(0);
		}
	});

	test("the mouse's two axes agree with the keys they share a term with", () => {
		// The hazard the row above closes for held keys, closed for the mouse
		// rows — which print a concrete direction to a player and were, until
		// this row, an authored sign with a line-number citation behind it.
		//
		// `impulse.pitch` is `-mouseDy` and `impulse.yaw` is `-mouseDx`, and
		// both are summed with `axis(negative, positive)`, which returns
		// `positive - negative`. So a *positive* mouse delta produces the same
		// sign as pressing a key from the **negative** list, and the mouse half
		// must land on that list's command. Read the negation out of the
		// source rather than restating it.
		// Since #641 the negation lives in `src/pointer.ts`'s `asked`, and
		// `main.ts` hands it the delta as `dx`/`dy` unchanged.
		const pointer = codeOf("src/pointer.ts");
		const main = codeOf("src/main.ts");
		const passedThrough =
			/dx: this\.mouseDx, dy: this\.mouseDy/.test(main) &&
			/pointerImpulse\(dx, dy, sensitivity\)/.test(main);
		const negated = (field: string, px: string) =>
			passedThrough &&
			new RegExp(`${field}:\\s*-${px}\\s*\\*\\s*MOUSE_RAD_PER_PX`).test(
				pointer,
			);
		expect({
			pitch: negated("pitch", "dyPx"),
			yaw: negated("yaw", "dxPx"),
		}).toEqual({
			pitch: true,
			yaw: true,
		});
		const mouseHalf = (axis: "x" | "y", half: Half): string | undefined =>
			DEFAULT_BINDINGS.find(
				(b) =>
					b.trigger.kind === "mouse-move" &&
					b.trigger.axis === axis &&
					b.trigger.half === half &&
					// The pointer flies the ship in the cockpit; in chase it is
					// the camera's (node #691, `tests/chase-orbit.test.ts`).
					b.scope.views.includes("cockpit"),
			)?.command;
		const calls = axisCalls();
		const pitchCall = calls.find((c) => c.negative.includes("fly.pitchUp"));
		const yawCall = calls.find((c) => c.negative.includes("fly.yawStarboard"));
		// A negated term means the positive push agrees with the negative list.
		expect([
			mouseHalf("y", "+") ?? "none",
			mouseHalf("y", "-") ?? "none",
			mouseHalf("x", "+") ?? "none",
			mouseHalf("x", "-") ?? "none",
		]).toEqual([
			pitchCall?.negative[0] ?? "none",
			pitchCall?.positive[0] ?? "none",
			yawCall?.negative[0] ?? "none",
			yawCall?.positive[0] ?? "none",
		]);
	});

	test("every axis names the pair the law gives it, in the right order", () => {
		const rows = axisCalls()
			.map(
				(call) => `${call.negative.join(",")} ← → ${call.positive.join(",")}`,
			)
			.sort();
		expect(rows).toEqual(
			[
				// `chaseOrbitInput`, whose own comment holds the port ruling.
				"view.orbitPort ← → view.orbitStarboard",
				"fly.pitchUp ← → fly.pitchDown",
				"fly.rollStarboard ← → fly.rollPort",
				"fly.yawStarboard ← → fly.yawPort",
			].sort(),
		);
	});

	test("and every id asked as held is a command that is held, not pressed", () => {
		// The half the ids alone cannot state: a call site that named a
		// *pressed* command would compile, read correctly and never fly,
		// because `isHeld` only ever looks at hold triggers.
		//
		// **Every held query, not only the axes** (sage round 1). The throttle
		// asks by id, and `combat-rig.ts` is handed the predicate and asks it
		// four times — the beam, the pulse and the two rolls — which had no
		// row anywhere while the axes had one.
		// `dispatchSites` is the shared scanner (sage round 2), and `held` is
		// the shape this row is about — not `all`, which also carries the
		// rig's `id === "fight.rigIncoming"`, a *pressed* command that this
		// row would then have demanded be held.
		const asked = new Set([
			...axisCalls().flatMap((c) => [...c.negative, ...c.positive]),
			...dispatchSites(codeOf("src/main.ts")).held,
			...dispatchSites(codeOf("src/combat-rig.ts")).held,
			...dispatchSites(codeOf("src/pilot-demand.ts")).held,
		]);
		// Guard the guard: all three scans found something.
		expect([
			asked.has("fly.pitchUp"),
			asked.has("fly.throttleUp"),
			asked.has("fight.fireBeam"),
		]).toEqual([true, true, true]);
		for (const id of asked) {
			const holds = DEFAULT_BINDINGS.some(
				(b) =>
					b.command === id &&
					b.trigger.kind === "key" &&
					b.trigger.hold === true,
			);
			expect(`${id} is held: ${holds}`).toBe(`${id} is held: true`);
		}
	});
});

describe("the pad and the chord are resolved through the layout", () => {
	/**
	 * C1's second clause, which is the one a table naming a `CommandId` does
	 * not buy.
	 *
	 * Before this slice both the pad's flight table and the Alt chords stood
	 * for a *key*, and `main.ts` resolved that key against `DEFAULT_BINDINGS`
	 * — never against the layout in force. That decoupled a pad button from a
	 * keyboard rebind, which was the point, and it also meant a pad rebind
	 * could not be expressed at all: the button's meaning lived in a table the
	 * player's layout is not. A capture modal that admits a button has nowhere
	 * to put the result.
	 *
	 * So the rows below ask the two halves separately — moving the *pad* row
	 * moves the button, and moving the *key* row does not.
	 */
	const padRowOf = (command: CommandId) => {
		const found = DEFAULT_BINDINGS.find(
			(b) =>
				b.command === command &&
				b.trigger.kind === "pad-button" &&
				b.trigger.hold !== true,
		);
		if (found === undefined) throw new Error(`${command} has no pad button`);
		return found;
	};

	/**
	 * The same layout with one pad row on another button.
	 *
	 * Built by hand rather than through `rebind`, because this row is about
	 * `resolvePad` reading a layout and not about the registry's willingness to
	 * make the move — `tests/capture.test.ts` is where `rebind`'s per-kind
	 * switch is exercised. A **new** row object, because `layoutOf` freezes
	 * through and a spread onto a frozen row throws.
	 *
	 * `home` is the button to move onto: the module's header declares it the
	 * one standard button no *press* claims — it is the eject held, which a
	 * press does not reach (node #703) — and it falls through to the flight
	 * table in exactly the contexts `y` does, so the scope carries over
	 * unchanged and the row measures the resolver rather than a context edit.
	 */
	const onButton = (row: Binding, button: PadButtonName): Layout =>
		layoutOf(
			DEFAULT_BINDINGS.map((b) =>
				b === row
					? {
							command: b.command,
							trigger: { ...b.trigger, button },
							scope: b.scope,
						}
					: b,
			),
		);

	test("a pad button reaches the command its row in the layout names", () => {
		expect(
			resolvePad(DEFAULT_BINDINGS, {
				button: "y",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["fly.cruise"]);
	});

	test("moving the pad row moves the button, and the old one goes quiet", () => {
		const layout = onButton(padRowOf("fly.cruise"), "home");
		expect(
			resolvePad(layout, {
				button: "home",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["fly.cruise"]);
		expect(
			resolvePad(layout, { button: "y", context: "flight", view: "cockpit" }),
		).toEqual([]);
	});

	test("a keyboard rebind does not move what a pad button does", () => {
		// The property the old key-resolved route bought by construction, now
		// bought by the pad row being a row of its own. Cruise moves off `j`
		// and Triangle keeps engaging it.
		//
		// **Onto `5`, because every letter in this game is already bound** —
		// `4`, `5`, `7`, `8` and the backslash are the only free characters
		// the shipped layout leaves (`6` is the Postcard screen's, #406). A letter target would be a legal D5 collision
		// and this row would then be measuring that instead.
		const layout = rebind(
			DEFAULT_BINDINGS,
			"fly.cruise",
			{ kind: "key", key: "j" },
			{ kind: "key", key: "5" },
		);
		expect(resolveKey(layout, { key: "j", view: "cockpit" })).toEqual([]);
		expect(resolveKey(layout, { key: "5", view: "cockpit" })).toEqual([
			"fly.cruise",
		]);
		expect(
			resolvePad(layout, { button: "y", context: "flight", view: "cockpit" }),
		).toEqual(["fly.cruise"]);
	});

	test("a button the layout does not claim reaches nothing", () => {
		expect(
			resolvePad(DEFAULT_BINDINGS, {
				button: "home",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual([]);
	});

	test("the context is read, not assumed", () => {
		// Circle is the console's `back` and never a flight press there, which
		// is `padIntents`' law and the reason a pad trigger carries contexts at
		// all. The resolver has to honour it or a console press requests
		// docking clearance under the panel.
		expect(
			resolvePad(DEFAULT_BINDINGS, {
				button: "b",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["dock.clearance"]);
		expect(
			resolvePad(DEFAULT_BINDINGS, {
				button: "b",
				context: "console",
				view: "cockpit",
			}),
		).toEqual([]);
	});

	test("the view is read too: the d-pad centres the chase camera", () => {
		// `2` is head-forward in the cockpit and the orbit reset in chase, and
		// both carry the same button. A resolver that dropped the view would
		// answer one of them silently — #369 D4.
		expect(
			resolvePad(DEFAULT_BINDINGS, {
				button: "up",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["view.headForward"]);
		expect(
			resolvePad(DEFAULT_BINDINGS, {
				button: "up",
				context: "flight",
				view: "chase",
			}),
		).toEqual(["view.orbitCentre"]);
	});

	test("an Alt chord is a row in the layout, and the cockpit gate is its scope", () => {
		// What removed `main.ts`'s `if (this.view === "cockpit")` guard on the
		// chord branch: the three head-look commands are `views: COCKPIT`, and
		// `matchesQualifiers` compares `alt`, so `view.orbitCentre` — `2`,
		// unqualified, chase — cannot answer an Alt fact whatever the view.
		// The guard was a second copy of that, and this row is what licenses
		// deleting it rather than an assertion that it is safe.
		expect(
			resolveKey(DEFAULT_BINDINGS, {
				key: "arrowup",
				code: "ArrowUp",
				alt: true,
				view: "cockpit",
			}),
		).toEqual(["view.headForward"]);
		expect(
			resolveKey(DEFAULT_BINDINGS, {
				key: "arrowup",
				code: "ArrowUp",
				alt: true,
				view: "chase",
			}),
		).toEqual([]);
	});

	test("a rebound Alt chord reaches the dispatch", () => {
		// The chord half of the same defect. `ALT_CHORDS` was a code-to-key
		// table outside the layout, so a chord moved in the registry was
		// expressible and dead: `keyDispatch` swallowed every Alt press whose
		// code that table did not carry. The law decides *that* a press is a
		// chord; the layout decides what it reaches.
		const layout = rebind(
			DEFAULT_BINDINGS,
			"view.headPort",
			{ kind: "key", key: "arrowleft", alt: true, code: "ArrowLeft" },
			{ kind: "key", key: "q", alt: true, code: "KeyQ" },
		);
		expect(
			resolveKey(layout, {
				key: "q",
				code: "KeyQ",
				alt: true,
				view: "cockpit",
			}),
		).toEqual(["view.headPort"]);
		const route = keyDispatch({
			key: "q",
			code: "KeyQ",
			down: true,
			repeat: false,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			editable: false,
		});
		expect(route).toEqual({ kind: "chord", key: "q", code: "KeyQ" });
	});

	test("every button the flight table binds reaches a command `command` handles", () => {
		// **Moved here from `tests/pad-bindings.test.ts` with the table.** The
		// pad does not get its own copy of what a button does; it presses a row
		// and `command` switches on the id, so a button bound to a command the
		// switch does not handle is a dead binding.
		//
		// Read off `command`'s own cases, not matched against a shape: this was
		// a regular expression accepting any single letter, which `p` and `z`
		// satisfy while `command` handles neither, so deleting a handler left
		// the check green and the binding dead (sage round 6 on #283). A source
		// read rather than an import because `main.ts` cannot be loaded in this
		// tier.
		const source = codeOf("src/main.ts");
		const body = source.slice(source.indexOf("private command(id: CommandId)"));
		const handled = new Set(
			[
				...body.slice(0, body.indexOf("\n\t}")).matchAll(/case "([^"]+)":/g),
			].map((m) => m[1]),
		);
		expect(handled.size).toBeGreaterThan(10);
		let checked = 0;
		for (const [button, ids] of Object.entries(PAD_FLIGHT_COMMANDS))
			for (const id of ids ?? []) {
				const reached = VIEW_MODES.flatMap((view) =>
					PAD_CONTEXTS.flatMap((context) =>
						resolvePad(DEFAULT_BINDINGS, {
							button: button as PadButtonName,
							context,
							view,
						}),
					),
				);
				expect(
					reached,
					`${button} is bound to ${id} and reaches nothing`,
				).toContain(id);
				expect(
					handled.has(id),
					`${button} reaches ${id}, which command does not handle`,
				).toBe(true);
				checked++;
			}
		expect(checked).toBe(13);
	});

	test("Square and `home` reach no command by a press: both are held", () => {
		// glossary-ignore: Command
		// Both rows were `padIntents(...).keys` being empty, which was that
		// module answering a question it no longer owns. Square is the pulse
		// laser's trigger and it is *held* (#324), so it has a row and no
		// press reaches it. `home` was the one free standard button and had no
		// row at all, until node #703 made it the eject *held* — so the two
		// are now the same reason, and the row says so rather than keeping a
		// distinction that went away.
		for (const view of VIEW_MODES)
			for (const context of PAD_CONTEXTS) {
				expect(
					resolvePad(DEFAULT_BINDINGS, { button: "x", context, view }),
					`x in ${context}/${view}`,
				).toEqual([]);
				expect(
					resolvePad(DEFAULT_BINDINGS, { button: "home", context, view }),
					`home in ${context}/${view}`,
				).toEqual([]);
			}
		// And each does have a row — held, on the command it holds, and no // glossary-ignore: Command
		// press row anywhere — so the empty answers above are a hold rather
		// than a button nothing reads.
		const padRows = (button: PadButtonName) =>
			DEFAULT_BINDINGS.filter(
				(b) => b.trigger.kind === "pad-button" && b.trigger.button === button, // glossary-ignore: pad
			).map((b) => `${b.command} ${"hold" in b.trigger ? "hold" : "press"}`); // glossary-ignore: Command
		expect(padRows("x")).toEqual(["fight.firePulse hold"]);
		expect(padRows("home")).toEqual(["fly.eject hold"]);
	});

	test("`layoutOf` is the only producer of a layout in the whole of src/", () => {
		// **What makes the brand mean anything.** `Layout` is a nominal type in
		// `commands.ts` and `tests/layout.types.ts` holds that a bare array
		// cannot be handed to `isHeld`, `resolveKey`, `resolvePad` or `rebind`.
		// That is worth exactly as much as the number of casts: a second one is
		// a second producer, and a layout that did not go through the freeze is
		// answered out of a stale hold index — the failure the type was made
		// for. The type cannot police this itself, because a cast is how the
		// one legitimate producer works.
		//
		// A test may cast, and two do: one stands in for a JavaScript caller
		// the brand cannot reach, and one builds a truncated table on purpose.
		// Neither is in `src/`.
		const casts: string[] = [];
		for (const file of srcFiles())
			for (const line of codeOf(file).split("\n"))
				if (/\bas\s+(unknown\s+as\s+)?Layout\b/.test(line))
					casts.push(`${file}: ${line.trim()}`);
		expect(casts).toEqual([
			"src/commands.ts: return Object.freeze(rows) as Layout;",
		]);
	});

	test("main.ts resolves both against the layout and keeps neither table", () => {
		// The wiring, read out of the source for the reason every row in this
		// file that reads `main.ts` gives: it cannot be loaded in this tier.
		// `commandKey` is the thing that must be gone — a resolver against
		// `DEFAULT_BINDINGS` standing beside one against `this.bindings`.
		const source = codeOf("src/main.ts");
		expect(source).not.toMatch(/this\.commandKey/);
		expect(source).toMatch(/resolvePad\(this\.bindings/);
		// And the chord branch no longer carries its own view test.
		expect(source).not.toMatch(
			/if\s*\(this\.view === "cockpit"\)\s*this\.command/,
		);
	});
});

describe("what a surface claims", () => {
	test("the Requests console claims by scope, and still returns out", () => {
		// The other unchecked sentence: `dock.launch`'s bare `Enter` and
		// `panel.activate`'s scoped one are not a collision *because* `main.ts`
		// returns out of its key handler for the keys that console claims.
		// Delete that early return and the CI gate would have stayed green
		// while `Enter` both launched and activated.
		//
		// **The five-key list this compared against is gone** (#381): `main.ts`
		// asks the registry for the surface's rows, so the two can no longer
		// disagree by construction and there is nothing left to compare. What
		// still has to hold is the branch — the scoped resolve, and the return
		// that keeps a claimed key from reaching the ship's switch below.
		const source = codeOf("src/main.ts");
		const from = source.indexOf("const requests =");
		const claim = source.slice(
			from,
			source.indexOf('if (route.kind === "chord")', from),
		);
		expect(claim).toContain('surface: "requests"');
		// **Anchored inside the walking branch, not loose in the span**
		// (sage round 2). `toContain("return;")` over the whole claim was
		// satisfied by any return in it, including the Space guard's — which
		// is a different branch and would have kept the row green with the
		// one that matters deleted.
		const walking = claim.slice(claim.indexOf("if (walking.length > 0) {"));
		expect(walking.startsWith("if (walking.length > 0) {")).toBe(true);
		expect(walking.slice(0, walking.indexOf("\n\t\t\t}"))).toContain("return;");
		// And the scope is not empty, so the branch cannot be satisfied by a
		// resolve that can never answer.
		const scoped = DEFAULT_BINDINGS.filter(
			(b) => b.scope.surface === "requests",
		);
		expect(scoped.length).toBeGreaterThan(4);
	});

	test("each surface a binding names is a place the source draws", () => {
		// **What this can and cannot do.** It holds the union closed — a
		// binding may name only a surface with an anchor, so a fourth cannot
		// be invented in a row and left unexamined — and it holds each anchor
		// present, so a surface whose screen is deleted goes red. It does
		// **not** prove two surfaces are disjoint; no grep can, and the
		// `console-row` defect would have survived this row. Disjointness is
		// `Scope`'s stated precondition, and adding a surface is the moment to
		// re-argue it.
		const ANCHORS: Record<string, { file: string; mark: RegExp }> = {
			requests: {
				file: "src/main.ts",
				mark: /surface: "requests",/,
			},
			"station-console": {
				file: "src/live-cockpit.ts",
				mark: /data-live-market-row/,
			},
		};
		const used = [
			...new Set(
				DEFAULT_BINDINGS.flatMap<string>((b) =>
					b.scope.surface === undefined ? [] : [b.scope.surface],
				),
			),
		].sort();
		expect(used).toEqual(Object.keys(ANCHORS).sort());
		for (const [surface, { file, mark }] of Object.entries(ANCHORS))
			expect(`${surface}: ${mark.test(codeOf(file))}`).toBe(`${surface}: true`);
	});
});

describe("D5's two predicates", () => {
	test("the shipped defaults collide with nothing", () => {
		// Through the exported helper, which is what a later slice's CI gate
		// will call: an alias nothing exercises can be pointed at the wrong
		// binding set and stay green.
		expect(defaultCollisions()).toEqual([]);
	});

	test("and the predicate can say otherwise", () => {
		// The red build, in a test rather than by hand: a player who binds the
		// pulse laser onto the cruise lever gets a report, and not a refusal —
		// D5 is warn-and-allow.
		const cruise = DEFAULT_BINDINGS.find((b) => b.command === "fly.cruise");
		if (!cruise) throw new Error("fly.cruise has no default binding");
		const clash: Binding = { ...cruise, command: "fight.firePulse" };
		const found = collisions([...DEFAULT_BINDINGS, clash]);
		expect(found.length).toBe(1);
		const clashed = found[0]?.commands.map<string>((id) => id).sort();
		expect(clashed).toEqual(["fight.firePulse", "fly.cruise"]);
	});

	test("every press/hold pair the defaults ship is named here", () => {
		// **What `defaultCollisions()` being empty does and does not say.** A
		// press and a hold of one key are different triggers, so a pair can
		// never be reported — and the shipped layout has two of them. Listing
		// them is what keeps the empty list from reading as "no key does two
		// things": `x` is #369 D3's own example, and `q` is the one the
		// resolution flags in passing, roll in the game and the ECM in the rig.
		// A third arriving unannounced turns this row red.
		const byPhysical = new Map<string, Set<string>>();
		for (const b of DEFAULT_BINDINGS) {
			if (b.trigger.kind !== "key") continue;
			// Normalised through the registry's own `codeKey`, not through
			// `code ?? key`: a letter row carries `code: "KeyQ"` since the
			// dispatch slice, and the raw code is not what a player calls it.
			const physical =
				b.trigger.code === undefined ? b.trigger.key : codeKey(b.trigger.code);
			const at = `${physical}${b.trigger.alt ? "+alt" : ""}`;
			byPhysical.set(at, (byPhysical.get(at) ?? new Set()).add(b.command));
		}
		const shared = [...byPhysical]
			.filter(([, commands]) => commands.size > 1)
			.map(([at, commands]) => `${at}: ${[...commands].sort().join(" + ")}`)
			.sort();
		expect(shared).toEqual([
			"1: view.headPort + view.orbitPort",
			"2: view.headForward + view.orbitCentre",
			"3: view.headStarboard + view.orbitStarboard",
			"arrowdown: fly.strafeVentral + panel.cursorDown",
			"arrowleft: fly.strafePort + panel.tabPrevious",
			"arrowright: fly.strafeStarboard + panel.tabNext",
			"arrowup: fly.strafeDorsal + panel.cursorUp",
			// #892: the panel's key while `?perf` is open, the ship's otherwise.
			"b: fight.cycleFireGroup + perf.bloom",
			"enter: dock.launch + panel.activate",
			"q: fight.rigEcm + fly.rollPort",
			"x: fight.fireBeam + fly.assist",
		]);
	});

	test("a surface claims a trigger, and an unscoped pair still collides", () => {
		// The third axis, and the direction it fails in. `main.ts` returns out
		// of its key handler for the five keys the Requests console claims, so
		// `Enter` there never reaches the switch that launches — the two are
		// not live at once. Bind a *second* unscoped `Enter` and they are.
		const launch = DEFAULT_BINDINGS.find((b) => b.command === "dock.launch");
		if (!launch) throw new Error("dock.launch has no default binding");
		expect(launch.scope.surface).toBeUndefined();
		const onEnter = DEFAULT_BINDINGS.filter(
			(b) => b.trigger.kind === "key" && b.trigger.key === "enter",
		);
		expect(onEnter.length).toBe(2);
		expect(collisions(onEnter)).toEqual([]);
		const second: Binding = { ...launch, command: "fly.cruise" };
		expect(collisions([...onEnter, second]).length).toBe(1);
	});

	test("a press and a hold of one key are not a collision", () => {
		// D3's split on `x` would be a collision under any model that read the
		// character alone, and the defaults would then ship colliding.
		const onX = DEFAULT_BINDINGS.filter(
			(b) => b.trigger.kind === "key" && b.trigger.key === "x",
		);
		expect(onX.map((b) => b.command).sort()).toEqual([
			"fight.fireBeam",
			"fly.assist",
		]);
		expect(new Set(onX.map((b) => triggerKey(b.trigger))).size).toBe(2);
	});
});

describe("a context is a pad context and a view", () => {
	test("the digits mean two things and that is not a collision", () => {
		// #369 D4's consequence, and the reason `PadContext` alone cannot answer
		// #370's third requirement: `2` is head-forward in the cockpit and the
		// chase reset in chase.
		const onTwo = DEFAULT_BINDINGS.filter(
			(b) =>
				b.trigger.kind === "key" && b.trigger.key === "2" && !b.trigger.alt,
		);
		expect(onTwo.map((b) => b.command).sort()).toEqual([
			"view.headForward",
			"view.orbitCentre",
		]);
		expect(collisions(onTwo)).toEqual([]);
	});

	test("and without the view dimension it is one", () => {
		// The same pair with both rows declared live in both views — which is
		// what a note built on `PadContext` alone would be asserting — collides.
		const onTwo = DEFAULT_BINDINGS.filter(
			(b) =>
				b.trigger.kind === "key" && b.trigger.key === "2" && !b.trigger.alt,
		).map((b) => ({ ...b, scope: { ...b.scope, views: VIEW_MODES } }));
		expect(collisions(onTwo).length).toBe(1);
	});

	test("a pad button's two meanings live in disjoint pad contexts", () => {
		// The other half of D4: d-pad ↑ is head-look in flight and the cursor in
		// a console, and they are two commands rather than one button with a
		// mode.
		const onUp = DEFAULT_BINDINGS.filter(
			(b) => "button" in b.trigger && b.trigger.button === "up",
		);
		expect(onUp.length).toBeGreaterThan(1);
		expect(collisions(onUp)).toEqual([]);
		const everywhere = onUp.map((b) => ({
			...b,
			scope: { pad: PAD_CONTEXTS, views: VIEW_MODES },
		}));
		expect(collisions(everywhere).length).toBeGreaterThan(0);
	});
});
