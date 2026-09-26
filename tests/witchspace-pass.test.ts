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
		tunnelOnly.apply(
			{ streak: 0, beta: 0, dark: 0, tunnel: 0.1, whiteout: 0, rift: 0 },
			0,
			1.6,
		);
		// The starbow alone lights it: it runs from the first second of the charge.
		const betaOnly = new WitchspacePass("high");
		betaOnly.apply(
			{ streak: 0, beta: 0.1, dark: 0, tunnel: 0, whiteout: 0, rift: 0 },
			0,
			1.6,
		);
		expect(betaOnly.enabled).toBe(true);
		expect(tunnelOnly.enabled).toBe(true);
		const pass = new WitchspacePass("high");
		pass.apply(witchspaceLook(witchspaceAtPhase(-0.5)), -0.5, 1.6);
		expect(pass.enabled).toBe(true);
		pass.apply(witchspaceLook(witchspaceAtPhase(0.2)), 0.2, 1.6);
		expect(pass.enabled).toBe(true);
		pass.apply(
			{ streak: 0, beta: 0, dark: 0, tunnel: 0, whiteout: 0, rift: 0 },
			0,
			1.6,
		);
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
		// The pull on the sky, the tunnel's samples and the rim each run only
		// while their own term is up.
		expect(WITCHSPACE_FRAGMENT).toContain(
			"if ((pull > 0.0 || uLensE > 0.0) && cover < 1.0 && r < visible) {",
		);
		expect(WITCHSPACE_FRAGMENT).toContain("if (cover > 0.0) {");
		expect(WITCHSPACE_FRAGMENT).toContain(
			"if (uTunnel > 0.0 && uTunnel < 1.0) {",
		);
		expect(WITCHSPACE_FRAGMENT).toContain("if (uWhiteout > 0.0) {");
		expect(WITCHSPACE_FRAGMENT).toContain("if (uBeta > 0.0) {");
		expect(WITCHSPACE_FRAGMENT).toContain("if (uDark > 0.0) {");
		// The smear only while there is a streak to smear: the rift's lens
		// alone takes one tap, not SAMPLES of the same texel.
		expect(WITCHSPACE_FRAGMENT).toContain(
			"if (uStreak > 0.0) {\n\t\t\t// Smeared inward",
		);
		expect(WITCHSPACE_FRAGMENT).toContain(
			"c = texture2D(tDiffuse, toUv(q)).rgb;",
		);
	});

	test("space bends, it does not swirl: the sky is read through a lens", () => {
		// The principal's fourth flight: the pull on the sky and the rift's
		// effect on it are point lenses, which move a star along its own line
		// through the centre and never round it.
		expect(WITCHSPACE_FRAGMENT).toContain(
			"vec2 witchLens(vec2 p, vec2 centre, float einstein)",
		);
		expect(WITCHSPACE_FRAGMENT).toContain(
			"return centre + d * (1.0 - einstein * einstein / r2);",
		);
		expect(WITCHSPACE_FRAGMENT).not.toContain("twist");
		// Nor does the tunnel: it bends toward a drifting throat instead (the
		// fifth flight), and its colour stripes are the angle alone.
		expect(WITCHSPACE_TUNNEL_FRAGMENT).not.toContain("twist");
		expect(WITCHSPACE_TUNNEL_FRAGMENT).toContain(
			"vec2 pk = p - throat * bend;",
		);
		expect(WITCHSPACE_TUNNEL_FRAGMENT).toContain(
			"float stripe = 0.2 * sin(atan(xy.y, xy.x) * 3.0);",
		);
		// And the streak's spokes are straight: their lane is the angle alone.
		expect(WITCHSPACE_FRAGMENT).toContain(
			"float lanes = (ang + 3.14159265) * 19.099;",
		);
	});

	test("nothing turns in time: no angle is advanced by the phase", () => {
		// `not.toContain("twist")` only caught rotation spelled that way; the rim's
		// `witchPalette(ang * 0.16 + uFlow * 0.3)` turned its colours round the
		// opening and passed it (sage round 2 on #533). An angle plus a multiple
		// of the phase is a rotation whatever it is called.
		const turns =
			/\bang\b\s*(\*\s*[\d.]+\s*)?[+-][^;,)]*\buFlow\b|\buFlow\b[^;,)]*[+-]\s*\bang\b/;
		// The guard can fail: it catches the line it was written for.
		expect(turns.test("witchPalette(ang * 0.16 + uFlow * 0.3)")).toBe(true);
		for (const source of [WITCHSPACE_FRAGMENT, WITCHSPACE_TUNNEL_FRAGMENT])
			for (const line of source.split("\n"))
				expect(turns.test(line)).toBe(false);
	});

	test("the rift alone lights the pass, for its lens, and a lens is never negative", () => {
		const pass = new WitchspacePass("high");
		pass.apply(
			{ streak: 0, beta: 0, dark: 0, tunnel: 0, whiteout: 0, rift: 0.5 },
			4,
			1.6,
		);
		expect(pass.enabled).toBe(true);
		pass.setLens(0.1, -0.2, -1);
		expect(pass.lens).toEqual({ x: 0.1, y: -0.2, einstein: 0 });
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
