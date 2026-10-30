import { expect, test } from "bun:test";
import { renderStatementSlice } from "./lib/game-methods";

test("render statement slice includes its declaration and complete body loop", () => {
	const slice = renderStatementSlice("star", "this.world.system.bodies");
	expect(slice.startsWith("const star =")).toBe(true);
	expect(slice).toContain("for (const body of this.world.system.bodies)");
	expect(slice).toContain(
		"visual.setDetailQuality(this.settings.value.quality)",
	);
	expect(slice.trimEnd().endsWith("}")).toBe(true);
});

test("render statement slice refuses missing or reversed boundaries", () => {
	expect(() =>
		renderStatementSlice("absent", "this.world.system.bodies"),
	).toThrow("Missing Game.render declaration: absent");
	expect(() => renderStatementSlice("star", "this.absent")).toThrow(
		"Missing Game.render loop after star: this.absent",
	);
	expect(() =>
		renderStatementSlice("shipRel", "this.world.system.bodies"),
	).toThrow("Missing Game.render loop after shipRel: this.world.system.bodies");
});
