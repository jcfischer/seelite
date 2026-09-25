/**
 * #532's composer term: what each side of #99's `quality` key draws, that the
 * pass costs nothing outside a jump, and that both terms branch on their dial.
 * Whether it *looks* right is the strip's and the principal's.
 */
import { describe, expect, test } from "bun:test";
import {
	WITCHSPACE_FRAGMENT,
	WITCHSPACE_PASS_QUALITY,
	WitchspacePass,
} from "../src/witchspace-pass";
import { witchspaceAtPhase, witchspaceLook } from "../src/witchspace";

describe("the witchspace pass", () => {
	test("is built disabled — nothing is drawn before a jump", () => {
		expect(new WitchspacePass("high").enabled).toBe(false);
	});

	test("enables for any lit look and disables again when it is dark", () => {
		const pass = new WitchspacePass("high");
		pass.apply(witchspaceLook(witchspaceAtPhase(-0.5)), -0.5, 1.6);
		expect(pass.enabled).toBe(true);
		pass.apply(witchspaceLook(witchspaceAtPhase(0.2)), 0.2, 1.6);
		expect(pass.enabled).toBe(true);
		pass.apply({ streak: 0, whiteout: 0 }, 0, 1.6);
		expect(pass.enabled).toBe(false);
	});

	test("both sides of the quality key draw it, and low draws fewer samples", () => {
		expect(WITCHSPACE_PASS_QUALITY.low.samples).toBeGreaterThan(0);
		expect(WITCHSPACE_PASS_QUALITY.low.samples).toBeLessThan(
			WITCHSPACE_PASS_QUALITY.high.samples,
		);
		expect(new WitchspacePass("low").samples).toBe(
			WITCHSPACE_PASS_QUALITY.low.samples,
		);
	});

	test("switching quality live rebuilds the program once", () => {
		const pass = new WitchspacePass("high");
		const version = pass.material.version;
		pass.setQuality("low");
		expect(pass.samples).toBe(WITCHSPACE_PASS_QUALITY.low.samples);
		expect(pass.material.version).toBe(version + 1);
		pass.setQuality("low");
		expect(pass.material.version).toBe(version + 1);
	});

	test("each term branches on its own dial", () => {
		expect(WITCHSPACE_FRAGMENT).toContain("if (uStreak > 0.0)");
		expect(WITCHSPACE_FRAGMENT).toContain("if (uWhiteout > 0.0)");
	});

	test("the streak's lines are not read from the sky", () => {
		// The lines come from a hash of the angle. The only texture read is the
		// frame itself, which is what a zoom smears.
		const reads = WITCHSPACE_FRAGMENT.match(/texture2D\((\w+)/g) ?? [];
		expect(new Set(reads)).toEqual(new Set(["texture2D(tDiffuse"]));
	});
});
