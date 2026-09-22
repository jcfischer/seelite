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
import { codeOf } from "./lib/source-scan";
import {
	type Binding,
	collisions,
	COMMANDS,
	commandById,
	DEFAULT_BINDINGS,
	defaultCollisions,
	PAD_CONTEXTS,
	TASK_GROUPS,
	triggerKey,
	VIEW_MODES,
} from "../src/commands";

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
 * reads the three `axis()` call sites out of `main.ts` and pairs them, and
 * why this row carries each binding's **scope** rather than its trigger
 * alone: dropping `surface` from a panel key would otherwise leave the row
 * unchanged while moving the key onto the ship's surface.
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
	"key:9::press → system.commander @ flight/instrument/console/modal cockpit/chase -",
	"key:;::press → tune.dropRadiusDown @ flight/instrument/console/modal cockpit/chase -",
	"key:=::press → tune.vMaxUp @ flight/instrument/console/modal cockpit/chase -",
	"key:?::press → view.reference @ flight/instrument/console/modal cockpit/chase -",
	"key:ArrowLeft:alt:press → view.headPort @ flight/instrument/console/modal cockpit -",
	"key:ArrowRight:alt:press → view.headStarboard @ flight/instrument/console/modal cockpit -",
	"key:ArrowUp:alt:press → view.headForward @ flight/instrument/console/modal cockpit -",
	"key:[::press → tune.exponentDown @ flight/instrument/console/modal cockpit/chase -",
	"key:]::press → tune.exponentUp @ flight/instrument/console/modal cockpit/chase -",
	"key:`::press → fly.jump @ flight/instrument/console/modal cockpit/chase -",
	"key:a::hold → fly.yawPort @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowdown::hold → fly.pitchUp @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowdown::press → panel.cursorDown @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowleft::hold → fly.yawPort @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowleft::press → panel.tabPrevious @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowright::hold → fly.yawStarboard @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowright::press → panel.tabNext @ flight/instrument/console/modal cockpit/chase requests",
	"key:arrowup::hold → fly.pitchDown @ flight/instrument/console/modal cockpit/chase -",
	"key:arrowup::press → panel.cursorUp @ flight/instrument/console/modal cockpit/chase requests",
	"key:b::press → perf.bloom @ flight/instrument/console/modal cockpit/chase -",
	"key:c::press → dock.clearance @ flight/instrument/console/modal cockpit/chase -",
	"key:control::hold → fly.throttleDown @ flight/instrument/console/modal cockpit/chase -",
	"key:d::hold → fly.yawStarboard @ flight/instrument/console/modal cockpit/chase -",
	"key:e::hold → fly.rollStarboard @ flight/instrument/console/modal cockpit/chase -",
	"key:enter::press → dock.launch @ flight/instrument/console/modal cockpit/chase -",
	"key:enter::press → panel.activate @ flight/instrument/console/modal cockpit/chase requests",
	"key:f1::press → view.reference @ flight/instrument/console/modal cockpit/chase -",
	"key:f::press → fight.faceTarget @ flight/instrument/console/modal cockpit/chase -",
	"key:g::press → fight.targetPrevious @ flight/instrument/console/modal cockpit/chase -",
	"key:h::press → perf.atmosphere @ flight/instrument/console/modal cockpit/chase -",
	"key:i::press → perf.restore @ flight/instrument/console/modal cockpit/chase -",
	"key:j::press → fly.cruise @ flight/instrument/console/modal cockpit/chase -",
	"key:k::press → tune.approachLeadDown @ flight/instrument/console/modal cockpit/chase -",
	"key:l::press → tune.approachLeadUp @ flight/instrument/console/modal cockpit/chase -",
	"key:m::press → tune.vicinityUp @ flight/instrument/console/modal cockpit/chase -",
	"key:n::press → tune.vicinityDown @ flight/instrument/console/modal cockpit/chase -",
	"key:o::press → perf.craters @ flight/instrument/console/modal cockpit/chase -",
	"key:p::press → perf.class @ flight/instrument/console/modal cockpit/chase -",
	"key:q::hold → fly.rollPort @ flight/instrument/console/modal cockpit/chase -",
	"key:q::press → fight.rigEcm @ flight/instrument/console/modal cockpit/chase -",
	"key:r::press → perf.relief @ flight/instrument/console/modal cockpit/chase -",
	"key:s::hold → fly.pitchUp @ flight/instrument/console/modal cockpit/chase -",
	"key:shift::hold → fly.throttleUp @ flight/instrument/console/modal cockpit/chase -",
	"key:t::press → fight.targetNext @ flight/instrument/console/modal cockpit/chase -",
	"key:u::press → dock.computer @ flight/instrument/console/modal cockpit/chase -",
	"key:v::press → view.toggle @ flight/instrument/console/modal cockpit/chase -",
	"key:w::hold → fly.pitchDown @ flight/instrument/console/modal cockpit/chase -",
	"key:x::hold → fight.fireBeam @ flight/instrument/console/modal cockpit/chase -",
	"key:x::press → fly.assist @ flight/instrument/console/modal cockpit/chase -",
	"key:y::press → perf.clouds @ flight/instrument/console/modal cockpit/chase -",
	"key:z::press → system.settings @ flight/instrument/console/modal cockpit/chase -",
];

const scopeText = (b: Binding) =>
	`${b.scope.pad.join("/")} ${b.scope.views.join("/")} ${b.scope.surface ?? "-"}`;

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
			expect(up).not.toBe(down);
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
		const halves = DEFAULT_BINDINGS.filter(
			(b) => b.trigger.kind === "pad-stick" || b.trigger.kind === "mouse-move",
		);
		const byAxis = new Map<string, Map<string, string>>();
		for (const b of halves) {
			if (b.trigger.kind !== "pad-stick" && b.trigger.kind !== "mouse-move")
				continue;
			const axis =
				b.trigger.kind === "pad-stick"
					? `${b.trigger.stick}-stick-${b.trigger.axis}`
					: `mouse-${b.trigger.axis}`;
			const halfMap = byAxis.get(axis) ?? new Map<string, string>();
			halfMap.set(b.trigger.half, b.command);
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
			"mouse-x: fly.yawPort | fly.yawStarboard",
			"mouse-y: fly.pitchDown | fly.pitchUp",
			"right-stick-x: fly.yawPort | fly.yawStarboard",
			"right-stick-y: fly.pitchDown | fly.pitchUp",
		]);
	});

	test("the three kinds of fixed row are catalogued and not rebindable", () => {
		// D12's rider: `tests/perf-panel-keys.test.ts` exists to keep the
		// diagnostics off the flight path, and D5 permits a player layout to
		// collide — so a registry that offered them would be permitted to bind a
		// bloom toggle onto a flight key.
		const fixed = COMMANDS.filter((c) => !c.rebindable).map<string>(
			(c) => c.id,
		);
		expect(fixed.sort()).toEqual(
			[
				"fight.rigEcm",
				"fight.rigIncoming",
				"fly.takePointer",
				"perf.atmosphere",
				"perf.bloom",
				"perf.class",
				"perf.clouds",
				"perf.craters",
				"perf.relief",
				"perf.restore",
				"trade.actOnRow",
			].sort(),
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
	 * The held keys' half of the ratified layout, read out of `main.ts`.
	 *
	 * `controls-catalogue.test.ts` checks every *pressed* key against its case
	 * body; a held key has no case, so nothing outside this file knew which of
	 * `w` and `s` puts the nose up — and the registry publishes that pairing to
	 * the `Controls` tab and to the public manual. `axis(negative, positive)`
	 * at `main.ts` is where it is actually decided, so this reads the call
	 * sites and pairs them against the ids.
	 */
	const axisCalls = () => {
		const source = codeOf("src/main.ts");
		const found = [
			...source.matchAll(/this\.axis\(\[([^\]]*)\],\s*\[([^\]]*)\]\)/g),
		];
		const keys = (list: string) =>
			[...list.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
		return found.map((m) => ({
			negative: keys(m[1] as string),
			positive: keys(m[2] as string),
		}));
	};

	/** The command a *held* key reaches. */
	const heldCommand = (key: string) => {
		const found = DEFAULT_BINDINGS.filter(
			(b) =>
				b.trigger.kind === "key" && b.trigger.key === key && b.trigger.hold,
		);
		return found.length === 1 ? found[0]?.command : `${found.length} commands`;
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

	test("every held key lands on the command the axis law gives it", () => {
		const rows = axisCalls()
			.map(
				(call) =>
					`${call.negative.map(heldCommand).join(",")} ← → ${call.positive
						.map(heldCommand)
						.join(",")}`,
			)
			.sort();
		expect(rows).toEqual(
			[
				// `chaseOrbitInput`, whose own comment holds the port ruling.
				"view.orbitPort ← → view.orbitStarboard",
				"fly.pitchUp,fly.pitchUp ← → fly.pitchDown,fly.pitchDown",
				"fly.rollStarboard ← → fly.rollPort",
				"fly.yawStarboard,fly.yawStarboard ← → fly.yawPort,fly.yawPort",
			].sort(),
		);
	});
});

describe("D5's two predicates", () => {
	test("the shipped defaults collide with nothing", () => {
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
			const at = `${b.trigger.code ?? b.trigger.key}${b.trigger.alt ? "+alt" : ""}`;
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
			"arrowdown: fly.pitchUp + panel.cursorDown",
			"arrowleft: fly.yawPort + panel.tabPrevious",
			"arrowright: fly.yawStarboard + panel.tabNext",
			"arrowup: fly.pitchDown + panel.cursorUp",
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
