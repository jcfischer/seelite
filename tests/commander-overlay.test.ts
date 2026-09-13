/**
 * The Commander overlay's menu, as a model (`persistent-world-state.md` §11.2,
 * §11.3).
 *
 * The drawing is plain DOM and bun has none, so what is checked here is what
 * the overlay offers — which rows, which of them can be chosen, where the
 * cursor starts — and `scripts/probe-commander.mjs` checks that the page draws
 * and acts on it.
 */

import { describe, expect, test } from "bun:test";
import {
	commanderMenu,
	freeCommanderName,
	initialCursor,
	type MenuInput,
	parseSeed,
} from "../src/commander-overlay";

const base: MenuInput = {
	slots: [],
	active: "default",
	inPlay: null,
	canContinue: false,
	pendingName: null,
	faultSlot: null,
	saving: true,
};

describe("commanderMenu", () => {
	test("a fresh profile cannot continue, and the cursor starts on New game", () => {
		const rows = commanderMenu(base);
		expect(rows[0]).toMatchObject({ kind: "continue", enabled: false });
		expect(rows[initialCursor(rows)].kind).toBe("new-game");
	});

	test("something to continue puts the cursor on Continue", () => {
		const rows = commanderMenu({
			...base,
			slots: ["default"],
			canContinue: true,
		});
		expect(rows[initialCursor(rows)].kind).toBe("continue");
	});

	test("every Commander is listed, with Load, Rename and Delete refused on the one in play", () => {
		const rows = commanderMenu({
			...base,
			slots: ["default", "Jameson"],
			canContinue: true,
			inPlay: "Jameson",
		});
		const commanders = rows.flatMap((r) => (r.kind === "commander" ? [r] : []));
		expect(commanders.map((r) => r.slot)).toEqual(["default", "Jameson"]);
		expect(commanders[0]?.enabled).toEqual([
			"load",
			"export",
			"rename",
			"delete",
		]);
		expect(commanders[1]?.enabled).toEqual(["export"]);
	});

	test("a boot fault offers Export of the Commander it concerns", () => {
		const rows = commanderMenu({
			...base,
			slots: ["default"],
			faultSlot: "default",
		});
		const exportRow = rows.find((r) => r.kind === "export-fault");
		expect(exportRow).toMatchObject({ slot: "default" });
	});

	test("the labels name Commanders and never the storage word", () => {
		const rows = commanderMenu({
			...base,
			slots: ["default", "Jameson"],
			canContinue: true,
			inPlay: "default",
			faultSlot: "Jameson",
		});
		for (const row of rows)
			expect(`${row.label}: ${/\bslot\b/i.test(row.label)}`).toBe(
				`${row.label}: false`,
			);
	});

	test("with saving off there is nothing to choose but Continue", () => {
		const rows = commanderMenu({ ...base, saving: false, canContinue: true });
		expect(rows.map((r) => r.kind)).toEqual(["continue"]);
	});
});

describe("New game's defaults", () => {
	test("the pre-filled name is free", () => {
		expect(freeCommanderName([])).toBe("Commander 1");
		expect(freeCommanderName(["Commander 1", "Commander 2"])).toBe(
			"Commander 3",
		);
		expect(freeCommanderName(["Commander 2"])).toBe("Commander 1");
	});

	test("a seed is a whole number a galaxy can take, and nothing else", () => {
		expect(parseSeed("0")).toBe(0);
		expect(parseSeed(" 42 ")).toBe(42);
		expect(parseSeed("4294967295")).toBe(0xffff_ffff);
		for (const bad of ["", " ", "-1", "1.5", "4294967296", "abc", "1e3"])
			expect(`${bad}: ${parseSeed(bad)}`).toBe(`${bad}: null`);
	});
});
