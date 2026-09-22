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
 * **It is not a fixture the registry generated for itself.** Every key in it
 * is tied to `main.ts` in both directions by `controls-catalogue.test.ts`,
 * which reads the source with the partition test's own scanner — so what this
 * adds over that row is the *pairing*: which command each key reaches, and
 * that it has not silently changed hands.
 */
const RATIFIED_LAYOUT: readonly string[] = [
	"key: ::hold → fight.firePulse",
	"key:'::press → tune.dropRadiusUp",
	"key:,::press → tune.dropSpeedDown",
	"key:-::press → tune.vMaxDown",
	"key:.::press → tune.dropSpeedUp",
	"key:/::press → fight.rigIncoming",
	"key:0::press → tune.reset",
	"key:1::hold → view.orbitPort",
	"key:1::press → view.headPort",
	"key:2::press → view.headForward",
	"key:2::press → view.orbitCentre",
	"key:3::hold → view.orbitStarboard",
	"key:3::press → view.headStarboard",
	"key:9::press → system.commander",
	"key:;::press → tune.dropRadiusDown",
	"key:=::press → tune.vMaxUp",
	"key:?::press → view.reference",
	"key:ArrowLeft:alt:press → view.headPort",
	"key:ArrowRight:alt:press → view.headStarboard",
	"key:ArrowUp:alt:press → view.headForward",
	"key:[::press → tune.exponentDown",
	"key:]::press → tune.exponentUp",
	"key:`::press → fly.jump",
	"key:a::hold → fly.yawPort",
	"key:arrowdown::hold → fly.pitchUp",
	"key:arrowdown::press → panel.cursorDown",
	"key:arrowleft::hold → fly.yawPort",
	"key:arrowleft::press → panel.tabPrevious",
	"key:arrowright::hold → fly.yawStarboard",
	"key:arrowright::press → panel.tabNext",
	"key:arrowup::hold → fly.pitchDown",
	"key:arrowup::press → panel.cursorUp",
	"key:b::press → perf.bloom",
	"key:c::press → dock.clearance",
	"key:control::hold → fly.throttleDown",
	"key:d::hold → fly.yawStarboard",
	"key:e::hold → fly.rollStarboard",
	"key:enter::press → dock.launch",
	"key:enter::press → panel.activate",
	"key:f1::press → view.reference",
	"key:f::press → fight.faceTarget",
	"key:g::press → fight.targetPrevious",
	"key:h::press → perf.atmosphere",
	"key:i::press → perf.restore",
	"key:j::press → fly.cruise",
	"key:k::press → tune.approachLeadDown",
	"key:l::press → tune.approachLeadUp",
	"key:m::press → tune.vicinityUp",
	"key:n::press → tune.vicinityDown",
	"key:o::press → perf.craters",
	"key:p::press → perf.class",
	"key:q::hold → fly.rollPort",
	"key:q::press → fight.rigEcm",
	"key:r::press → perf.relief",
	"key:s::hold → fly.pitchUp",
	"key:shift::hold → fly.throttleUp",
	"key:t::press → fight.targetNext",
	"key:u::press → dock.computer",
	"key:v::press → view.toggle",
	"key:w::hold → fly.pitchDown",
	"key:x::hold → fight.fireBeam",
	"key:x::press → fly.assist",
	"key:y::press → perf.clouds",
	"key:z::press → system.settings",
];

const keyRows = (bindings: readonly Binding[]) =>
	bindings
		.flatMap((b) =>
			b.trigger.kind === "key"
				? [`${triggerKey(b.trigger)} → ${b.command}`]
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
			expect(commandById(up).id).toBe(up);
			expect(commandById(down).id).toBe(down);
		}
		// And the twelve dial steps are twelve, not six.
		expect(COMMANDS.filter((c) => c.id.startsWith("tune.")).length).toBe(13);
	});

	test("a signed input is two bindings, and the registry has no axis entity", () => {
		// D2's hard case. A stick causes both directions, and the answer is two
		// signed bindings on two commands rather than a second kind of bindable
		// thing — so every stick and mouse-axis trigger names its half.
		const halves = DEFAULT_BINDINGS.filter(
			(b) => b.trigger.kind === "pad-stick" || b.trigger.kind === "mouse-move",
		);
		expect(halves.length).toBeGreaterThan(0);
		for (const b of halves)
			expect(`${b.command}: ${"half" in b.trigger}`).toBe(`${b.command}: true`);
		// The two halves of one stick axis land on different commands.
		const pitch = halves.filter((b) => b.command.startsWith("fly.pitch"));
		expect(new Set(pitch.map((b) => b.command)).size).toBe(2);
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
			const id = row.slice(row.indexOf("→ ") + 2);
			expect(`${id}: ${COMMANDS.some((c) => c.id === id)}`).toBe(`${id}: true`);
		}
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
