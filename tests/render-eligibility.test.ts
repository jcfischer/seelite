import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sceneRenderEligible } from "../src/render-eligibility";

test("only the opaque forward docked console suppresses scene rendering (#425)", () => {
	expect(
		sceneRenderEligible({
			dockPhase: "docked",
			view: "cockpit",
			headLook: "forward",
		}),
	).toBe(false);

	for (const state of [
		{ dockPhase: "docked", view: "cockpit", headLook: "left" },
		{ dockPhase: "docked", view: "cockpit", headLook: "right" },
		{ dockPhase: "docked", view: "chase", headLook: "forward" },
		{ dockPhase: "arriving", view: "cockpit", headLook: "forward" },
		{ dockPhase: "launching", view: "cockpit", headLook: "forward" },
		{ dockPhase: "flying", view: "cockpit", headLook: "forward" },
	] as const)
		expect(sceneRenderEligible(state)).toBe(true);
});

test("the frame loop leaves simulation unconditional and gates only render (#425)", () => {
	const source = readFileSync("src/main.ts", "utf8");
	const animate = source.slice(
		source.indexOf("private animate = () =>"),
		source.indexOf("private readonly chaseOffset"),
	);
	// #535: while the opening runs it steps the sim itself, at its own fixed
	// step; either way the step sits under the clock and never under render.
	expect(animate).toContain("if (dt > 0 && !this.clockHeld) {");
	expect(animate).toContain("opening.frame(this.openingSim, dt);");
	expect(animate).toContain("} else this.step(dt);");
	expect(animate).toContain("if (this.sceneRenderEligible()) this.render(dt);");
});
