/**
 * #532's composer term: what each side of #99's `quality` key draws, that the
 * pass costs nothing outside a jump, and that both terms branch on their dial.
 * Whether it *looks* right is the strip's and the principal's.
 */
import { describe, expect, test } from "bun:test";
import {
	WITCHSPACE_FRAGMENT,
	WITCHSPACE_PASS_QUALITY,
	WITCHSPACE_TUNNEL_FRAGMENT,
	WitchspacePass,
} from "../src/witchspace-pass";
import { witchspaceAtPhase, witchspaceLook } from "../src/witchspace";

describe("the witchspace pass", () => {
	test("is built disabled — nothing is drawn before a jump", () => {
		expect(new WitchspacePass("high").enabled).toBe(false);
	});

	test("enables for any lit look and disables again when it is dark", () => {
		const tunnelOnly = new WitchspacePass("high");
		tunnelOnly.apply({ streak: 0, tunnel: 0.1, whiteout: 0 }, 0, 1.6);
		expect(tunnelOnly.enabled).toBe(true);
		const pass = new WitchspacePass("high");
		pass.apply(witchspaceLook(witchspaceAtPhase(-0.5)), -0.5, 1.6);
		expect(pass.enabled).toBe(true);
		pass.apply(witchspaceLook(witchspaceAtPhase(0.2)), 0.2, 1.6);
		expect(pass.enabled).toBe(true);
		pass.apply({ streak: 0, tunnel: 0, whiteout: 0 }, 0, 1.6);
		expect(pass.enabled).toBe(false);
	});

	test("both sides of the quality key draw it, and low draws fewer samples", () => {
		expect(WITCHSPACE_PASS_QUALITY.low.layers).toBeGreaterThan(0);
		expect(WITCHSPACE_PASS_QUALITY.low.layers).toBeLessThan(
			WITCHSPACE_PASS_QUALITY.high.layers,
		);
		expect(WITCHSPACE_PASS_QUALITY.low.octaves).toBeLessThanOrEqual(
			WITCHSPACE_PASS_QUALITY.high.octaves,
		);
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
		expect(WITCHSPACE_FRAGMENT).toContain("if (uStreak > 0.0 && cover < 1.0)");
		expect(WITCHSPACE_FRAGMENT).toContain("if (uTunnel > 0.0)");
		// The tunnel is sampled only inside its opening.
		expect(WITCHSPACE_FRAGMENT).toContain(
			"if (cover > 0.0) c = mix(c, texture2D(tTunnel",
		);
		expect(WITCHSPACE_FRAGMENT).toContain("if (uWhiteout > 0.0) {");
	});

	test("nothing it draws is read from the sky", () => {
		// The streak's lines come from a hash of the angle and the tunnel from
		// noise. The composite reads the frame, which is what a zoom smears, and
		// the tunnel's own target; the tunnel reads no texture at all.
		const reads = WITCHSPACE_FRAGMENT.match(/texture2D\((\w+)/g) ?? [];
		expect(new Set(reads)).toEqual(
			new Set(["texture2D(tDiffuse", "texture2D(tTunnel"]),
		);
		expect(WITCHSPACE_TUNNEL_FRAGMENT).not.toContain("texture2D");
	});

	test("the tunnel is drawn small on both sides of the key, and smaller on low", () => {
		expect(WITCHSPACE_PASS_QUALITY.high.scale).toBeLessThan(1);
		expect(WITCHSPACE_PASS_QUALITY.low.scale).toBeGreaterThan(0);
		expect(WITCHSPACE_PASS_QUALITY.low.scale).toBeLessThanOrEqual(
			WITCHSPACE_PASS_QUALITY.high.scale,
		);
		const pass = new WitchspacePass("high");
		pass.setQuality("low");
		expect(pass.scale).toBe(WITCHSPACE_PASS_QUALITY.low.scale);
		expect(pass.layers).toBe(WITCHSPACE_PASS_QUALITY.low.layers);
	});
});
