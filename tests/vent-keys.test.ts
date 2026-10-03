/**
 * #620: `flight-model.md` §3.5's keys on the default layout, and §3.6's two
 * meanings of what the pilot holds.
 *
 * The arrows strafe and stop repeating pitch and yaw; `shift`/`control` are a
 * speed demand with the assist on and the main drive and retro vents with it
 * off; each vent slot has a command with no default key that a pilot can bind;
 * and the pad's one free axis carries the vertical strafe under #283's law.
 */
import { describe, expect, test } from "bun:test";
import { parseLayout, serializeLayout } from "../src/binding-store";
import {
	COMMANDS,
	type CommandId,
	commandById,
	DEFAULT_BINDINGS,
	defaultCollisions,
	isHeld,
	layoutMoves,
	RebindRefused,
	rebind,
	type Trigger,
	VENT_COMMANDS,
	ventCommand,
} from "../src/commands";
import { controlsCatalogue } from "../src/controls-catalogue";
import { VENT_SLOTS } from "../src/hull";
import { boundNames } from "../src/key-names";
import { padFlightAxes } from "../src/pad-bindings";
import {
	heldVents,
	leverMoves,
	type PilotHands,
	pilotDemand,
	pilotHands,
	STRAFE_COMMANDS,
} from "../src/pilot-demand";
import { rest, sticks } from "./lib/pad-frames";

const keysOf = (id: CommandId) =>
	DEFAULT_BINDINGS.filter(
		(b) => b.command === id && b.trigger.kind === "key",
	).map((b) => b.trigger);

/** The one trigger a command ships first: a slot command's placeholder. */
const defaultTrigger = (id: CommandId): Trigger =>
	DEFAULT_BINDINGS.find((b) => b.command === id)?.trigger as Trigger;

const heldOn = (id: CommandId, ...keys: string[]) =>
	isHeld(DEFAULT_BINDINGS, id, new Set(keys), "cockpit");

describe("§3.5: the arrows strafe", () => {
	test("pitch and yaw keep their letters and lose the arrows", () => {
		for (const id of [
			"fly.pitchUp",
			"fly.pitchDown",
			"fly.yawPort",
			"fly.yawStarboard",
		] as const)
			for (const t of keysOf(id))
				expect((t as { key: string }).key.startsWith("arrow"), id).toBe(false);
		expect(heldOn("fly.pitchDown", "w")).toBe(true);
		expect(heldOn("fly.pitchDown", "arrowup")).toBe(false);
		expect(heldOn("fly.yawPort", "arrowleft")).toBe(false);
	});

	test("each arrow holds one strafe direction", () => {
		expect(heldOn("fly.strafePort", "arrowleft")).toBe(true);
		expect(heldOn("fly.strafeStarboard", "arrowright")).toBe(true);
		expect(heldOn("fly.strafeDorsal", "arrowup")).toBe(true);
		expect(heldOn("fly.strafeVentral", "arrowdown")).toBe(true);
	});

	test("the shipped layout still collides nowhere", () => {
		expect(defaultCollisions()).toEqual([]);
	});

	test("the Requests console keeps its arrows, on its own surface", () => {
		const cursor = keysOf("panel.cursorUp")[0] as Extract<
			Trigger,
			{ kind: "key" }
		>;
		expect(cursor.key).toBe("arrowup");
		expect(cursor.surface).toBe("requests");
	});
});

describe("§3.5: one command per vent slot, with no default key", () => {
	test("every slot has its command, and only those", () => {
		expect(VENT_COMMANDS.map((c) => c.slot)).toEqual([...VENT_SLOTS]);
		const ids = COMMANDS.filter((c) => c.id.startsWith("vent.")).map(
			(c) => c.id,
		);
		expect(ids).toEqual(VENT_SLOTS.map(ventCommand));
	});

	test("none is reached by anything on the shipped layout", () => {
		for (const slot of VENT_SLOTS) {
			const id = ventCommand(slot);
			expect(commandById(id).rebindable).toBe(true);
			expect(boundNames(DEFAULT_BINDINGS, id)).toEqual([]);
			const rows = DEFAULT_BINDINGS.filter((b) => b.command === id);
			expect(rows.map((b) => b.trigger.kind)).toEqual(["unbound"]);
		}
	});

	test("the Controls tab draws each as unbound, on the shipped layout", () => {
		const row = controlsCatalogue().commands.find(
			(c) => c.id === ventCommand("main"),
		);
		expect(row?.currentTriggers.map((t) => t.kind)).toEqual(["unbound"]);
	});

	test("a pilot who binds one holds it on that key", () => {
		const id = ventCommand("fore-port-lateral");
		const from = defaultTrigger(id);
		const layout = rebind(DEFAULT_BINDINGS, id, from, {
			kind: "key",
			key: "7",
			hold: true,
		});
		expect(isHeld(layout, id, new Set(["7"]), "cockpit")).toBe(true);
		expect(boundNames(layout, id)).toEqual(["hold 7"]);
		expect(layoutMoves(layout)).toHaveLength(1);
		expect(controlsCatalogue(layout).layout).toBe("player");
	});

	test("a vent is held: a press is refused, not stored and dead", () => {
		const id = ventCommand("main");
		const from = defaultTrigger(id);
		expect(() =>
			rebind(DEFAULT_BINDINGS, id, from, { kind: "key", key: "7" }),
		).toThrow(RebindRefused);
	});

	test("nothing can be moved onto the placeholder", () => {
		const from = defaultTrigger("fly.cruise");
		expect(() =>
			rebind(DEFAULT_BINDINGS, "fly.cruise", from, {
				kind: "unbound",
				hold: true,
			}),
		).toThrow(RebindRefused);
	});

	test("a bound vent survives the store", () => {
		const id = ventCommand("main");
		const from = defaultTrigger(id);
		const layout = rebind(DEFAULT_BINDINGS, id, from, {
			kind: "key",
			key: "8",
			hold: true,
		});
		const loaded = parseLayout(serializeLayout(layout));
		expect(loaded.notices).toEqual([]);
		expect(isHeld(loaded.layout, id, new Set(["8"]), "cockpit")).toBe(true);
	});

	test("a layout saved before #620 that moved pitch off ↓ is told, not applied", () => {
		const raw = JSON.stringify({
			version: 1,
			moves: [
				{
					command: "fly.pitchUp",
					from: { kind: "key", key: "arrowdown", hold: true },
					to: { kind: "key", key: "7", hold: true },
				},
			],
		});
		const loaded = parseLayout(raw);
		expect(loaded.layout).toBe(DEFAULT_BINDINGS);
		expect(loaded.notices.map((n) => n.kind)).toEqual(["rejected"]);
		expect((loaded.notices[0] as { reason?: string } | undefined)?.reason).toBe(
			"moved-default",
		);
	});
});

describe("§3.5: the held vents", () => {
	test("a held vent command fires its slot at full, and nothing else", () => {
		const held = (id: CommandId) => id === ventCommand("aft-port-lateral");
		expect(heldVents(held)).toEqual({ "aft-port-lateral": 1 });
		expect(heldVents(() => false)).toEqual({});
	});
});

const hands = (part: Partial<PilotHands>): PilotHands => ({
	assist: true,
	throttle: 0,
	fore: false,
	aft: false,
	port: false,
	starboard: false,
	dorsal: false,
	ventral: false,
	padTrim: 0,
	padHeave: 0,
	...part,
});

describe("§3.6: what the hands ask for", () => {
	test("assist on: the lever is the speed, a held strafe a lateral velocity", () => {
		expect(pilotDemand(hands({ throttle: 0.4 }))).toEqual({
			surge: 0.4,
			sway: 0,
			heave: 0,
		});
		expect(pilotDemand(hands({ starboard: true, dorsal: true }))).toEqual({
			surge: 0,
			sway: 1,
			heave: 1,
		});
		expect(pilotDemand(hands({ port: true, ventral: true })).sway).toBe(-1);
		// Held Shift moves the lever in `main.ts`, not the demand directly.
		expect(pilotDemand(hands({ fore: true })).surge).toBe(0);
	});

	test("assist off: Shift is the main drive, Ctrl the retro vents, held", () => {
		expect(pilotDemand(hands({ assist: false, fore: true })).surge).toBe(1);
		expect(pilotDemand(hands({ assist: false, aft: true })).surge).toBe(-1);
		expect(
			pilotDemand(hands({ assist: false, fore: true, aft: true })).surge,
		).toBe(0);
		// The lever is not a force: released, the drive stops.
		expect(pilotDemand(hands({ assist: false, throttle: 0.7 })).surge).toBe(0);
	});

	test("assist off: the triggers are an analog force on the same axis", () => {
		expect(pilotDemand(hands({ assist: false, padTrim: -0.5 })).surge).toBe(
			-0.5,
		);
		expect(
			pilotDemand(hands({ assist: false, fore: true, padTrim: 1 })).surge,
		).toBe(1);
	});

	test("the pad's heave joins the keys, in both regimes", () => {
		expect(pilotDemand(hands({ padHeave: 0.3 })).heave).toBeCloseTo(0.3);
		expect(
			pilotDemand(hands({ assist: false, padHeave: -1, dorsal: true })).heave,
		).toBe(0);
	});
});

describe("§3.6 and cruise: who moves the speed lever", () => {
	test("the keys move it with the assist on, and fire the drive with it off", () => {
		expect(leverMoves(true, false)).toBe(true);
		expect(leverMoves(false, false)).toBe(false);
	});

	test("in cruise the assist is not in force, so the keys set the cruise throttle", () => {
		expect(leverMoves(false, true)).toBe(true);
		expect(leverMoves(true, true)).toBe(true);
	});
});

describe("the vent commands' ids are a stored schema", () => {
	test("each id is pinned, so renaming a slot cannot orphan a saved binding unseen", () => {
		// A bound vent is saved in `seelite:bindings` under this id. A slot
		// renamed in `VENT_SLOTS` renames its command, and a player's saved
		// binding then loads as an unknown control: this row goes red first.
		expect(VENT_COMMANDS.map((c) => c.id)).toEqual([
			"vent.main",
			"vent.retroPort",
			"vent.retroStarboard",
			"vent.strafeForePort",
			"vent.strafeAftPort",
			"vent.strafeForeStarboard",
			"vent.strafeAftStarboard",
			"vent.strafeForeDorsal",
			"vent.strafeAftDorsal",
			"vent.strafeForeVentral",
			"vent.strafeAftVentral",
			"vent.forePortLateral",
			"vent.foreStarboardLateral",
			"vent.aftPortLateral",
			"vent.aftStarboardLateral",
			"vent.foreDorsalVertical",
			"vent.foreVentralVertical",
			"vent.aftDorsalVertical",
			"vent.aftVentralVertical",
			"vent.portDorsalRoll",
			"vent.portVentralRoll",
			"vent.starboardDorsalRoll",
			"vent.starboardVentralRoll",
		]);
	});

	test("a held pad button is refused for a vent, not stored and dead (#496)", () => {
		const id = ventCommand("main");
		expect(() =>
			rebind(DEFAULT_BINDINGS, id, defaultTrigger(id), {
				kind: "pad-button",
				button: "home",
				hold: true,
				contexts: [],
			}),
		).toThrow(RebindRefused);
	});
});

describe("the hands, read off the layout", () => {
	test("pilotHands reads exactly the four strafe commands STRAFE_COMMANDS lists", () => {
		const asked = new Set<string>();
		pilotHands(
			(id) => {
				asked.add(id);
				return false;
			},
			{ assist: true, throttle: 0, padTrim: 0, padHeave: 0 },
		);
		expect(
			[...asked].filter((id) => id.startsWith("fly.strafe")).sort(),
		).toEqual([...STRAFE_COMMANDS].sort());
	});

	test("each field is its command's, and the pad's figures pass through", () => {
		const held = (id: CommandId) =>
			id === "fly.strafeStarboard" || id === "fly.throttleDown";
		expect(
			pilotHands(held, {
				assist: false,
				throttle: 0.5,
				padTrim: 0.25,
				padHeave: -0.5,
			}),
		).toEqual({
			assist: false,
			throttle: 0.5,
			padTrim: 0.25,
			padHeave: -0.5,
			fore: false,
			aft: true,
			port: false,
			starboard: true,
			dorsal: false,
			ventral: false,
		});
	});
});

describe("#283's law: the vertical strafe on the left stick's free axis", () => {
	test("pushed up the ship rises, pushed down it sinks", () => {
		expect(padFlightAxes(sticks([0, -1, 0, 0]), "flight").heave).toBe(1);
		expect(padFlightAxes(sticks([0, 1, 0, 0]), "flight").heave).toBe(-1);
	});

	test("a resting stick is exactly zero, and a console suspends it", () => {
		expect(Object.is(padFlightAxes(rest(), "flight").heave, 0)).toBe(true);
		expect(padFlightAxes(sticks([0, -1, 0, 0]), "console").heave).toBe(0);
	});

	test("the registry derives the stick's rows rather than authoring them", () => {
		const stick = (id: CommandId) =>
			commandById(id).defaultTriggers.filter((t) => t.kind === "pad-stick");
		expect(stick("fly.strafeDorsal")).toEqual([
			{
				kind: "pad-stick",
				stick: "left",
				axis: "y",
				half: "-",
				contexts: ["flight", "instrument"],
			},
		]);
		expect(stick("fly.strafeVentral")[0]).toMatchObject({ half: "+" });
		// Not ruled: the pad has no free axis for the lateral strafe (#620).
		expect(stick("fly.strafePort")).toEqual([]);
		expect(stick("fly.strafeStarboard")).toEqual([]);
	});
});
