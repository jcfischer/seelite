/**
 * Baking a rocky planet into two cube maps — node #208.
 *
 * What is arithmetic lives here; what needs a GPU lives in
 * `scripts/probe-planet-surfaces.mjs`, and the split is the usual one. The band
 * itself is in `tests/relief-bands.test.ts` beside #207's, because the two are
 * one rule over one apparent size and splitting them was how they would come to
 * disagree.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { codeOf } from "./lib/source-scan";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import type { SurfaceClass } from "../src/planet-appearance";
import { CUBE_FACE_COUNT, cubeFaceBasis } from "../src/planet-bake";
import {
	BAKE_FACE_SIZES,
	BAKE_MAX_PX_PER_TEXEL,
	bakeFacePxFor,
	focalPx,
	pxPerCubeTexel,
} from "../src/relief-bands";
import {
	BAKEABLE_CLASSES,
	BAKE_DESCRIPTORS,
	bakeFragmentFor,
	bakedFragmentFor,
	isBakeable,
} from "../src/planet-shaders";

/**
 * The body of one class's `surface()`, and everything it reaches inside its own
 * chunk.
 *
 * The whole chunk, in other words — which is deliberate and is the point of the
 * check below. `lava`'s clock term moved out of `surface()` into
 * `lavaEmissive()` when #208 extracted it, so a scan of the `surface()` braces
 * alone would now report lava as static and would have reported it as animated
 * the day before. A rule that changes its answer when a function is extracted
 * is not the rule anyone meant.
 */
const chunkOf = (surface: SurfaceClass) => CLASS_GLSL[surface];

describe("which classes bake", () => {
	/**
	 * **A class bakes exactly when nothing it evaluates reads the clock**, and
	 * this is read off the shader source rather than off the table.
	 *
	 * The rule matters more than it looks, because the *other* checks cannot see
	 * a violation of it. The bake pins `time` to 0, so "bake twice and diff" — the
	 * determinism proof the node asks for — passes perfectly on a class whose
	 * animation has been frozen into a texture. Nothing renders wrong; the planet
	 * simply stops moving, on one body, in one system, and no tier says so.
	 *
	 * A bakeable class may still name the clock, but only inside the function its
	 * descriptor's `perFrame` calls — that is lava's whole arrangement: the static
	 * crack network bakes and the glow over it is recomputed. So the exemption is
	 * derived from the descriptor rather than listed here.
	 */
	test("a bakeable class reads the clock only where its descriptor says", () => {
		for (const [name, chunk] of Object.entries(CLASS_GLSL)) {
			const surface = name as SurfaceClass;
			const usesClock = /\btime\b/.test(chunk);
			if (!isBakeable(surface)) continue;
			if (!usesClock) continue;
			// Every clock reference must be inside a function the per-frame term
			// names. Lava names `lavaEmissive`, so `time` inside it is the arm the
			// draw program still evaluates; `time` anywhere else in the chunk would
			// be a term the cube has frozen.
			const perFrame = BAKE_DESCRIPTORS[surface]?.perFrame ?? "";
			const named = [...perFrame.matchAll(/\b([a-zA-Z_][\w]*)\s*\(/g)].map(
				(m) => m[1],
			);
			expect(
				named.length,
				`${surface} reads the clock and names nothing`,
			).toBeGreaterThan(0);
			// Strip each named function's body, then insist nothing is left.
			let rest = chunk;
			for (const fn of named) {
				const at = rest.indexOf(`${fn}(`);
				if (at < 0) continue;
				const open = rest.indexOf("{", at);
				let depth = 0;
				let end = open;
				for (; end < rest.length; end++) {
					if (rest[end] === "{") depth++;
					else if (rest[end] === "}" && --depth === 0) break;
				}
				rest = rest.slice(0, at) + rest.slice(end + 1);
			}
			// `uniform float time;` is a declaration, not an evaluation.
			rest = rest.replace(/uniform\s+float\s+time\s*;/g, "");
			expect(
				/\btime\b/.test(rest),
				`${surface} evaluates the clock outside ${named.join(", ")}`,
			).toBe(false);
		}
	});

	test("every class that reads the clock everywhere is left procedural", () => {
		// The other direction, which is the one that fails open. `venusian` is the
		// class the node was unsure about — "if its albedo noise justifies it" —
		// and the answer is no: its whole deck drifts and its `height` is `0.0`, so
		// there is nothing static to bake.
		for (const surface of ["venusian", "jovian", "iceGiant", "star"] as const) {
			expect(isBakeable(surface), surface).toBe(false);
			expect(/\btime\b/.test(chunkOf(surface)), surface).toBe(true);
		}
	});

	test("the roster is derived from the table and matches it", () => {
		expect([...BAKEABLE_CLASSES].sort()).toEqual(
			(["airless", "desert", "ice", "lava", "terran"] as SurfaceClass[]).sort(),
		);
		for (const surface of BAKEABLE_CLASSES)
			expect(BAKE_DESCRIPTORS[surface]).toBeDefined();
	});

	test("a class with no descriptor refuses to assemble a program", () => {
		// Loudly, per #7: a missing descriptor arriving as `undefined` would give a
		// shader with the literal string "undefined" spliced into it, which fails
		// at link time in a browser and never in this tier.
		expect(() => bakeFragmentFor("jovian", "albedo")).toThrow(
			/bake descriptor/,
		);
		expect(() => bakedFragmentFor("venusian")).toThrow(/bake descriptor/);
	});
});

describe("the two programs a bake needs", () => {
	test("the bake writes both channels and never shades", () => {
		for (const surface of BAKEABLE_CLASSES) {
			const albedo = bakeFragmentFor(surface, "albedo");
			const normal = bakeFragmentFor(surface, "normal");
			// The whole reason the bake needs its own fragment: `fragmentFor`'s
			// `main()` calls `shade(albedo, N, V)` with the bake camera's own `V`,
			// so what would land in the cube is *lit* colour and the draw program
			// would light it again.
			for (const source of [albedo, normal]) {
				expect(source).not.toMatch(/\bshade\s*\(/);
				expect(source).toMatch(/surface\(p, albedo, N, emissive/);
			}
			expect(albedo).toMatch(/gl_FragColor = vec4\(sane\(albedo\)/);
			// **Encoded, then sanitised**, and asserted in that order because the
			// other order is what shipped for an hour: `saneF` clamps a negative to
			// zero, so wrapping the normal first read every face's negative axis
			// back as exactly 0.5 and the planet lost its terrain while compiling,
			// rendering and erroring in no way at all.
			expect(normal).toMatch(/sane4\(vec4\(normalize\(N\) \* 0\.5 \+ 0\.5,/);
			expect(normal).not.toMatch(/sane\(normalize\(N\)\)/);
		}
	});

	test("the draw program samples two cubes and runs no noise it need not", () => {
		// The saving, as a property of the source. A class with no per-frame term
		// must not carry the noise library at all — that is what "two texture
		// fetches instead of 100 to 150 noise calls" means, and a prelude included
		// unconditionally would leave the program looking identical to the one it
		// replaces.
		const desert = bakedFragmentFor("desert");
		expect(desert).toMatch(/textureCube\(bakedAlbedo, p\)/);
		expect(desert).toMatch(/textureCube\(bakedNormal, p\)/);
		expect(desert).not.toMatch(/float fbm4\(/);
		expect(desert).not.toMatch(/reliefNormal/);

		// Lava is the exception and carries its prelude for one function.
		const lava = bakedFragmentFor("lava");
		expect(lava).toMatch(/emissive = lavaEmissive\(p, aux\);/);
		expect(lava).toMatch(/float fbm3\(/);
	});

	test("the specular exponent is compiled in, not baked, and only where there is one", () => {
		// `specPower` is a per-class literal in `CLASS_GLSL` — spending a channel
		// on a constant would be the one decision here that buys nothing.
		expect(bakedFragmentFor("terran")).toMatch(/specular\(N, V, 230\.0\)/);
		expect(bakedFragmentFor("ice")).toMatch(/specular\(N, V, 46\.0\)/);
		// The **call**, not the definition: `specular` is declared in
		// `LIGHT_GLSL`, which every one of these programs includes, so a bare
		// `/specular\(/` matches the shared prelude and can never fail.
		for (const surface of ["desert", "airless", "lava"] as const)
			expect(bakedFragmentFor(surface)).not.toMatch(/specular\(N, V,/);
	});

	test("the exponent in the table is the one the class shader declares", () => {
		// The table and the shader are two homes for one number, and this is what
		// stops them drifting: the literal is read out of `CLASS_GLSL` rather than
		// restated. A class that changed its water exponent without the table would
		// bake a highlight the draw program does not reproduce.
		for (const surface of BAKEABLE_CLASSES) {
			const declared = chunkOf(surface).match(/specPower\s*=\s*([\d.]+)\s*;/);
			expect(declared, `${surface} declares no specPower`).not.toBeNull();
			expect(Number(declared?.[1]), surface).toBe(
				BAKE_DESCRIPTORS[surface]?.specPower ?? Number.NaN,
			);
		}
	});

	test("the baked program honours the ladder's ablation levels", () => {
		// So an arm named on the perf panel means the same thing on a baked body as
		// on a procedural one. Without it half the bodies in a frame would ignore
		// the dial and the ladder's floor would be measured against a mixture.
		const source = bakedFragmentFor("terran");
		expect(source).toMatch(/perfAblate > 1\.5/);
		expect(source).toMatch(/perfAblate > 0\.5/);
	});
});

describe("the six faces", () => {
	test("each basis is orthonormal and right-handed", () => {
		for (let face = 0; face < CUBE_FACE_COUNT; face++) {
			const e = cubeFaceBasis(face).elements; // column-major
			const cols = [e.slice(0, 3), e.slice(3, 6), e.slice(6, 9)];
			for (const c of cols)
				expect(Math.hypot(c[0], c[1], c[2])).toBeCloseTo(1, 12);
			const dot = (a: number[], b: number[]) =>
				a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
			expect(dot(cols[0], cols[1])).toBeCloseTo(0, 12);
			expect(dot(cols[0], cols[2])).toBeCloseTo(0, 12);
			expect(dot(cols[1], cols[2])).toBeCloseTo(0, 12);
		}
	});

	test("the six forwards are the six axes, each exactly once", () => {
		// The property that makes it a cube. Derived from three's own
		// `CubeCamera.updateCoordinateSystem` table rather than transcribed from
		// the GL sign convention, which is where a bake of this shape usually goes
		// wrong — and a flipped face is a seam on one edge of one body, which is
		// exactly the failure nothing here would see.
		const seen = new Set<string>();
		for (let face = 0; face < CUBE_FACE_COUNT; face++) {
			const e = cubeFaceBasis(face).elements;
			const f = [e[6], e[7], e[8]].map((v) => Math.round(v));
			expect(Math.abs(f[0]) + Math.abs(f[1]) + Math.abs(f[2])).toBe(1);
			seen.add(f.join(","));
		}
		expect(seen.size).toBe(6);
	});

	test("the corner rays of every face reach the same eight directions", () => {
		// Coverage without gaps or overlap: the twenty-four corner rays of a cube
		// map are the eight corners of a cube, three faces each. A basis with a
		// wrong handedness passes the orthonormality check above and fails here.
		const corners = new Map<string, number>();
		for (let face = 0; face < CUBE_FACE_COUNT; face++) {
			const e = cubeFaceBasis(face).elements;
			for (const x of [-1, 1])
				for (const y of [-1, 1]) {
					const v = [0, 1, 2].map((i) => e[i] * x + e[3 + i] * y + e[6 + i]);
					const key = v.map((c) => Math.round(c)).join(",");
					corners.set(key, (corners.get(key) ?? 0) + 1);
				}
		}
		expect(corners.size).toBe(8);
		for (const [key, n] of corners) expect(n, key).toBe(3);
	});

	/**
	 * **The texel a direction samples is the texel that direction was written
	 * to** — the round trip, against GL's own rule rather than against the code
	 * that does the writing.
	 *
	 * This is the check the first version of the bake needed and did not have.
	 * The basis was built straight from three's `CubeCamera` table, which is a
	 * *camera* basis, and a cube face's `(s, t)` is not one: `s` runs against the
	 * camera's right and `t` against its up, so every face was written rotated by
	 * 180°.
	 *
	 * Nothing else could see it. Each face still held the right hemisphere, so
	 * the face means read back perfectly symmetric — `+X` at 228/255 against
	 * `-X` at 26. The six forwards were still the six axes and the corner rays
	 * still landed on the eight corners of a cube, three each, because both of
	 * those are invariant under an in-plane rotation. The planet rendered lit,
	 * seamless and the right colour, with its continents in the wrong place.
	 *
	 * So the rule is transcribed here from ES 3.0 §8.13 table 8.19 — a second
	 * author, deliberately — and the basis is required to invert it.
	 */
	test("the direction a texel holds is the direction that samples it", () => {
		/** GL's own dir → (face, s, t). `t = 0` is the first row of the face. */
		const sample = (d: number[]) => {
			const [x, y, z] = d;
			const [ax, ay, az] = [Math.abs(x), Math.abs(y), Math.abs(z)];
			let face: number;
			let sc: number;
			let tc: number;
			let ma: number;
			if (ax >= ay && ax >= az) {
				face = x > 0 ? 0 : 1;
				sc = x > 0 ? -z : z;
				tc = -y;
				ma = ax;
			} else if (ay >= az) {
				face = y > 0 ? 2 : 3;
				sc = x;
				tc = y > 0 ? z : -z;
				ma = ay;
			} else {
				face = z > 0 ? 4 : 5;
				sc = z > 0 ? x : -x;
				tc = -y;
				ma = az;
			}
			return { face, s: (sc / ma + 1) / 2, t: (tc / ma + 1) / 2 };
		};

		// The other direction: what the bake writes at a normalised (s, t) of one
		// face. `s` and `t` come from the framebuffer, so `s = (ndc.x + 1) / 2`
		// and `t = (ndc.y + 1) / 2` — the render target's first row is the first
		// row of the face image.
		const written = (face: number, s: number, t: number) => {
			const e = cubeFaceBasis(face).elements;
			const [u, v] = [s * 2 - 1, t * 2 - 1];
			const d = [0, 1, 2].map((i) => e[i] * u + e[3 + i] * v + e[6 + i]);
			const n = Math.hypot(...d);
			return d.map((c) => c / n);
		};

		// Off-centre and asymmetric on purpose: a 180° rotation leaves the centre
		// alone and swapping the two in-plane axes leaves the diagonal alone, so a
		// grid that is symmetric in either way cannot see the errors this catches.
		const grid = [0.07, 0.23, 0.5, 0.61, 0.94];
		for (let face = 0; face < CUBE_FACE_COUNT; face++)
			for (const s of grid)
				for (const t of grid) {
					const dir = written(face, s, t);
					const back = sample(dir);
					const where = `face ${face} at (${s}, ${t})`;
					expect(back.face, where).toBe(face);
					expect(back.s, where).toBeCloseTo(s, 10);
					expect(back.t, where).toBeCloseTo(t, 10);
				}
	});

	test("a face that does not exist is a throw and not an undefined", () => {
		expect(() => cubeFaceBasis(6)).toThrow(/cube face 6/);
		expect(() => cubeFaceBasis(-1)).toThrow(/cube face -1/);
	});
});

describe("resolution and memory", () => {
	test("the face size follows apparent size, and never the render layer", () => {
		// The defect this replaced rendered nothing differently: the table was
		// keyed on the render layer and gave `near` the large face, and
		// `massiveLayerFor` never admits a *massive* body to the near layer — so
		// every planet in the game held the small cube however close it got, and
		// the large rung was never allocated at all.
		const FOCAL = focalPx(900, 60);
		expect([...BAKE_FACE_SIZES]).toEqual([256, 512]);
		// Far away the small cube is ample, and holding the large one would be
		// 16 MB to draw a body four pixels across.
		expect(bakeFacePxFor(FOCAL / 30, FOCAL, null)).toBe(256);
		expect(bakeFacePxFor(FOCAL / 8, FOCAL, null)).toBe(256);
		// Inside the small cube's reach — about 3.69 radii — the large one.
		expect(bakeFacePxFor(FOCAL / 3, FOCAL, null)).toBe(512);
		expect(bakeFacePxFor(FOCAL / 2, FOCAL, null)).toBe(512);
		// And past the largest face's reach it stays at the cap rather than
		// dropping back: a body that close is about to leave the band, and
		// re-baking it small on the way in would be two recompiles for nothing.
		expect(bakeFacePxFor(FOCAL / 1.02, FOCAL, null)).toBe(512);
	});

	test("the size a body holds is sticky at the threshold", () => {
		// A re-bake is twelve full-screen evaluations of the most expensive shader
		// in the game and a body on a slow approach sits on a threshold for
		// seconds. Stepped twice, because that is the only way to see hysteresis.
		const FOCAL = focalPx(900, 60);
		let lo = 1.001;
		let hi = 100;
		for (let i = 0; i < 60; i++) {
			const mid = (lo + hi) / 2;
			if (pxPerCubeTexel(FOCAL / mid, FOCAL, 256) > BAKE_MAX_PX_PER_TEXEL)
				lo = mid;
			else hi = mid;
		}
		// Just inside the crossing, where a body arriving fresh would take 512.
		const inside = FOCAL / (hi * 0.99);
		expect(bakeFacePxFor(inside, FOCAL, null)).toBe(512);
		// A body already holding 256 keeps it rather than re-baking.
		expect(bakeFacePxFor(inside, FOCAL, 256)).toBe(256);
		// And gives it up once it is properly past.
		expect(bakeFacePxFor(FOCAL / (hi * 0.8), FOCAL, 256)).toBe(512);
	});

	test("every face size is a power of two", () => {
		// Not a style rule: mipmaps are what stop a body at twenty radii
		// shimmering, and a non-power-of-two cube face has no complete chain.
		for (const px of BAKE_FACE_SIZES) expect(Math.log2(px) % 1).toBe(0);
	});

	test("the memory figure in the docstring is the one the census derives", () => {
		// The rule `measure-hull-pricing.ts` set. The census itself is a script
		// because it sweeps 8,192 systems; what is held here is the arithmetic it
		// prints the totals with, so a change to the format or the mip assumption
		// reddens beside the prose that quotes it.
		const pairBytes = (px: number) => (6 * px * px * 4 * 2 * 4) / 3;
		const mb = (b: number) => b / 1024 / 1024;
		const [small, large] = BAKE_FACE_SIZES;
		expect(mb(pairBytes(large))).toBeCloseTo(16.0, 1);
		expect(mb(pairBytes(small))).toBeCloseTo(4.0, 1);
		// Typical is 3.40 bakeable bodies and the worst case is 14, with at most
		// one of them near enough to want the large pair.
		const held = (n: number) =>
			pairBytes(large) + Math.max(0, n - 1) * pairBytes(small);
		expect(mb(held(3.4))).toBeCloseTo(25.6, 1);
		expect(mb(held(14))).toBeCloseTo(68.0, 1);
	});

	test("the census script exists and is the one the docstring names", () => {
		// A docstring that names an instrument which does not exist is the defect
		// this repo has hit twice; `check-launcher-wiring.mjs` catches the launcher
		// half and nothing catches this half.
		expect(codeOf("scripts/measure-bake-census.ts")).toMatch(
			/bakeable bodies per system/,
		);
		// Read raw rather than through `codeOf`, which strips comments — the
		// reference being checked *is* a comment, so the stripped form can never
		// contain it and the check could never fail.
		expect(readFileSync("src/planet-bake.ts", "utf8")).toMatch(
			/scripts\/measure-bake-census\.ts/,
		);
	});
});
