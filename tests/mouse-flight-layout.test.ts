/**
 * #639: a second shipped layout, for mouse flight with the assist off.
 *
 * The mouse holds pitch and yaw; every translation key sits under the left
 * hand, so fore/aft, strafe and the vertical can be held at once. A key keeps
 * its axis whatever the assist is doing — `w`/`s` carry §3.6's two meanings
 * exactly as `shift`/`control` do on the default layout.
 *
 * What a saved rebind is a move *from* is the selected layout's own table, so
 * a later build that moves a mouse-flight key still reaches the player.
 */
import { describe, expect, test } from "bun:test";
import { parseLayout, serializeLayout } from "../src/binding-store";
import {
	collisions,
	type CommandId,
	DEFAULT_BINDINGS,
	isHeld,
	type Layout,
	LAYOUT_NAMES,
	type LayoutName,
	layoutOf,
	layoutMoves,
	MOUSE_FLIGHT_BINDINGS,
	rebind,
	resolveKey,
	SHIPPED_LAYOUTS,
	shippedOf,
	type Trigger,
	triggerKey,
} from "../src/commands";
import { controlsCatalogue } from "../src/controls-catalogue";
import { controlsBody } from "../src/controls-reference";
import { ctrlChordsReachBrowser, layoutChoiceNote } from "../src/layout-choice";

const MOUSE = MOUSE_FLIGHT_BINDINGS;

/** The first trigger a command has in a layout (sage round 2's nit). */
const triggerOf = (layout: Layout, id: CommandId): Trigger =>
	layout.find((b) => b.command === id)?.trigger as Trigger;

/** `fly.cruise` moved onto `key`, the rebind these rows use. */
const moveCruise = (layout: Layout, key: string): Layout =>
	rebind(layout, "fly.cruise", triggerOf(layout, "fly.cruise"), {
		kind: "key",
		key,
	});

const heldOn = (layout: Layout, id: CommandId, ...keys: string[]) =>
	isHeld(layout, id, new Set(keys), "cockpit");

/** Every command a held key reaches in flight, in the cockpit. */
const holding = (layout: Layout, key: string): CommandId[] =>
	layout
		.filter(
			(b) =>
				b.trigger.kind === "key" &&
				b.trigger.surface === undefined &&
				!b.trigger.alt &&
				b.trigger.key === key,
		)
		.map((b) => b.command);

describe("the mouse-flight table (#639)", () => {
	test("w/s are fore/aft, a/d strafe, Ctrl/Space strafe up/down", () => {
		expect(heldOn(MOUSE, "fly.throttleUp", "w")).toBe(true);
		expect(heldOn(MOUSE, "fly.throttleDown", "s")).toBe(true);
		expect(heldOn(MOUSE, "fly.strafePort", "a")).toBe(true);
		expect(heldOn(MOUSE, "fly.strafeStarboard", "d")).toBe(true);
		expect(heldOn(MOUSE, "fly.strafeDorsal", "control")).toBe(true);
		expect(heldOn(MOUSE, "fly.strafeVentral", " ")).toBe(true);
	});

	test("the arrows take pitch and yaw, in the sense they had before #620", () => {
		expect(heldOn(MOUSE, "fly.pitchUp", "arrowdown")).toBe(true);
		expect(heldOn(MOUSE, "fly.pitchDown", "arrowup")).toBe(true);
		expect(heldOn(MOUSE, "fly.yawPort", "arrowleft")).toBe(true);
		expect(heldOn(MOUSE, "fly.yawStarboard", "arrowright")).toBe(true);
	});

	test("each translation key reaches its one command and no other", () => {
		for (const [key, id] of [
			["w", "fly.throttleUp"],
			["s", "fly.throttleDown"],
			["a", "fly.strafePort"],
			["d", "fly.strafeStarboard"],
			["control", "fly.strafeDorsal"],
			[" ", "fly.strafeVentral"],
		] as const)
			expect(holding(MOUSE, key), key).toEqual([id]);
	});

	test("the three-axis burn holds three commands at once", () => {
		const keys = new Set(["w", "d", "control"]);
		for (const id of [
			"fly.throttleUp",
			"fly.strafeStarboard",
			"fly.strafeDorsal",
		] as const)
			expect(isHeld(MOUSE, id, keys, "cockpit"), id).toBe(true);
	});

	test("roll and the assist do not move", () => {
		expect(heldOn(MOUSE, "fly.rollPort", "q")).toBe(true);
		expect(heldOn(MOUSE, "fly.rollStarboard", "e")).toBe(true);
		expect(
			resolveKey(MOUSE, { key: "x", code: "KeyX", view: "cockpit" }),
		).toContain("fly.assist");
	});

	test("shift is free, and the pulse laser keeps the mouse and loses Space", () => {
		expect(holding(MOUSE, "shift")).toEqual([]);
		expect(heldOn(MOUSE, "fight.firePulse", " ")).toBe(false);
		const pulse = MOUSE.filter((b) => b.command === "fight.firePulse");
		expect(
			pulse.some(
				(b) => b.trigger.kind === "mouse-button" && b.trigger.action === "hold",
			),
		).toBe(true);
	});

	test("it collides nowhere, as the default layout does", () => {
		expect(collisions(MOUSE)).toEqual([]);
	});

	test("the pad and the mouse rows are the default layout's, unchanged", () => {
		for (let i = 0; i < DEFAULT_BINDINGS.length; i++) {
			const base = DEFAULT_BINDINGS[i]?.trigger as Trigger;
			if (base.kind === "key") continue;
			expect(triggerKey(MOUSE[i]?.trigger as Trigger)).toBe(triggerKey(base));
		}
	});

	test("it is the default table with triggers moved, row for row", () => {
		expect(MOUSE.length).toBe(DEFAULT_BINDINGS.length);
		for (let i = 0; i < MOUSE.length; i++)
			expect(MOUSE[i]?.command).toBe(DEFAULT_BINDINGS[i]?.command as CommandId);
	});

	test("each shipped layout names itself, and is no move away from itself", () => {
		for (const name of LAYOUT_NAMES) {
			expect(SHIPPED_LAYOUTS[name].base).toBe(name);
			expect(layoutMoves(SHIPPED_LAYOUTS[name])).toEqual([]);
		}
		expect(DEFAULT_BINDINGS.base).toBe("default");
	});

	test("a frozen table keeps its name, and refuses another (sage round 1)", () => {
		expect(layoutOf(MOUSE, "mouse-flight")).toBe(MOUSE);
		expect(() => layoutOf(MOUSE, "default")).toThrow();
		expect(() => layoutOf(Object.freeze([...DEFAULT_BINDINGS]))).toThrow();
	});

	test("a rebind keeps the layout it was made on", () => {
		const moved = moveCruise(MOUSE, "k");
		expect(moved.base).toBe("mouse-flight");
		expect(layoutMoves(moved)).toHaveLength(1);
	});
});

describe("the store keeps the selection beside the moves (#639)", () => {
	test("a default blob carries no base, so it reads as it did before", () => {
		expect(JSON.parse(serializeLayout(DEFAULT_BINDINGS))).toEqual({
			version: 1,
			moves: [],
		});
	});

	test("the mouse layout round-trips with no moves", () => {
		const blob = serializeLayout(MOUSE);
		expect(JSON.parse(blob)).toEqual({
			version: 1,
			base: "mouse-flight",
			moves: [],
		});
		const loaded = parseLayout(blob);
		expect(loaded.notices).toEqual([]);
		expect(loaded.layout.base).toBe("mouse-flight");
		expect(heldOn(loaded.layout, "fly.throttleUp", "w")).toBe(true);
	});

	test("a move is stored off the mouse layout's key, and round-trips", () => {
		const moved = rebind(
			MOUSE,
			"fly.strafeVentral",
			triggerOf(MOUSE, "fly.strafeVentral"),
			{
				kind: "key",
				key: "c",
				hold: true,
			},
		);
		const stored = JSON.parse(serializeLayout(moved));
		expect(stored.moves).toHaveLength(1);
		expect(stored.moves[0].from.key).toBe(" ");
		const loaded = parseLayout(serializeLayout(moved));
		expect(loaded.notices).toEqual([]);
		expect(heldOn(loaded.layout, "fly.strafeVentral", "c")).toBe(true);
		expect(heldOn(loaded.layout, "fly.strafeVentral", " ")).toBe(false);
	});

	test("a move off the pulse laser's freed Space row round-trips", () => {
		const placeholder = MOUSE.find(
			(b) => b.command === "fight.firePulse" && b.trigger.kind === "unbound",
		)?.trigger as Trigger;
		const moved = rebind(MOUSE, "fight.firePulse", placeholder, {
			kind: "key",
			key: "v",
			hold: true,
		});
		const loaded = parseLayout(serializeLayout(moved));
		expect(loaded.notices).toEqual([]);
		expect(heldOn(loaded.layout, "fight.firePulse", "v")).toBe(true);
	});

	test("a base this build does not know is named, and the default flies", () => {
		const loaded = parseLayout(
			JSON.stringify({ version: 1, base: "joystick", moves: [] }),
		);
		expect(loaded.layout.base).toBe("default");
		expect(loaded.notices).toHaveLength(1);
		expect(loaded.notices[0]?.kind).toBe("unreadable");
	});
});

describe("switching layout drops the player's moves, and says so (#639)", () => {
	test("each name stands for its shipped table, and an unknown one throws", () => {
		expect(shippedOf("mouse-flight")).toBe(MOUSE);
		expect(shippedOf("default")).toBe(DEFAULT_BINDINGS);
		expect(() => shippedOf("joystick" as LayoutName)).toThrow();
	});

	test("the note reads its keys off the table it names (sage round 1)", () => {
		expect(layoutChoiceNote(MOUSE, "MacIntel")).toContain(
			"w/s fore and aft, a/d strafe, Ctrl/Space up and down, ↑/↓ and ←/→ pitch and yaw",
		);
		expect(layoutChoiceNote(DEFAULT_BINDINGS, "MacIntel")).toContain(
			"Shift/Ctrl fore and aft, ←/→ strafe, ↑/↓ up and down, w/s and a/d pitch and yaw",
		);
	});

	test("the note names the loss before the switch", () => {
		const once = moveCruise(DEFAULT_BINDINGS, "k");
		const twice = rebind(once, "fly.jump", triggerOf(once, "fly.jump"), {
			kind: "key",
			key: "l",
		});
		expect(layoutChoiceNote(once, "MacIntel")).toContain("1 rebind.");
		expect(layoutChoiceNote(twice, "MacIntel")).toContain("2 rebinds");
		expect(layoutChoiceNote(DEFAULT_BINDINGS, "MacIntel")).not.toContain(
			"rebind",
		);
	});
});

describe("the Ctrl warning (#639)", () => {
	test("Chrome takes Ctrl+W everywhere but macOS", () => {
		expect(ctrlChordsReachBrowser("Win32")).toBe(true);
		expect(ctrlChordsReachBrowser("Windows")).toBe(true);
		expect(ctrlChordsReachBrowser("Linux x86_64")).toBe(true);
		expect(ctrlChordsReachBrowser("MacIntel")).toBe(false);
		expect(ctrlChordsReachBrowser("macOS")).toBe(false);
	});

	test("the mouse layout warns off macOS, and only there", () => {
		expect(layoutChoiceNote(MOUSE, "Win32")).toContain("Ctrl+W");
		expect(layoutChoiceNote(MOUSE, "MacIntel")).not.toContain("Ctrl+W");
		expect(layoutChoiceNote(DEFAULT_BINDINGS, "Win32")).not.toContain("Ctrl+W");
	});
});

describe("the Controls tab names the layout it prints (#639)", () => {
	test("the shipped mouse layout reads as itself, not as a player layout", () => {
		const catalogue = controlsCatalogue(MOUSE);
		expect(catalogue.layout).toBe("default");
		expect(catalogue.base).toBe("mouse-flight");
		expect(controlsBody(catalogue, new Set())).toContain("MOUSE FLIGHT LAYOUT");
	});

	test("a moved mouse layout reads as the player's, and says which", () => {
		const moved = moveCruise(MOUSE, "k");
		const body = controlsBody(controlsCatalogue(moved), new Set());
		expect(body).toContain("PLAYER LAYOUT");
		expect(body).toContain("MOUSE FLIGHT");
	});
});
