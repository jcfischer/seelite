/**
 * The boundary this whole tier stands on: these modules must load without a DOM.
 *
 * It is one `import` away from not being true. In seekolous, a thousand lines
 * of routing arithmetic could only be loaded inside a browser because of a
 * single value import — a constant from a module that imports a module that
 * calls `document.createElement` at module scope. Nothing announced that; it
 * was found by trying.
 *
 * `import type` is free: it is erased before this ever runs. It is the value
 * import that couples, and the two look nearly identical in a diff.
 *
 * If this file stops passing, the fix is to find the value import and either
 * move the constant to the module that needs it or make the import type-only —
 * not to move the module out of this list.
 *
 * The tier matters more here than the count of modules in it suggests. The
 * scale design puts the authoritative float64 world in `sim.ts` and keeps
 * Three.js out of it; "loads without a browser" is the cheap, automatic version
 * of that claim, and it is the one that will catch the day someone imports
 * `THREE.Vector3` into the simulation because it was convenient.
 */
import { expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";
import {
	FAR_NEAR_UNITS,
	FAR_SCALE,
	HANDOFF_HYSTERESIS,
	HANDOFF_KM,
	NEAR_FAR_KM,
	layerFor,
} from "../src/units";

const HEADLESS = [
	"audio",
	"backdrop",
	"cockpit",
	"cruise",
	"galaxy",
	"hud",
	"names",
	"noise",
	"rng",
	"ship-mesh",
	"sim",
	"system",
	"units",
	"vec3",
] as const;

test("no DOM is present in this runtime", () => {
	// The control. Every assertion below is worthless if something has quietly
	// provided a `document`, since then a coupled module would import fine.
	expect(typeof globalThis.document).toBe("undefined");
	expect(typeof globalThis.window).toBe("undefined");
});

test.each([...HEADLESS])("src/%s.ts loads without a browser", async (name) => {
	const mod = await import(`../src/${name}`);
	expect(Object.keys(mod).length).toBeGreaterThan(0);
});

test("no module has been quietly dropped from the list", () => {
	// Membership, not a count. A floor of *n* stops moving the moment an
	// (n+1)th headless module is added: from then on, deleting any of these to
	// make a red test green leaves the length at n and passes — which is
	// exactly the silent regression this is here to catch.
	//
	// The two lists must be **the same set**. Checking only `required ⊆
	// HEADLESS` fails open in the direction a new module always arrives from: a
	// module added to `HEADLESS` alone would be listed, loaded, and entirely
	// unguarded, so deleting it later would leave this test green. That is
	// exactly how it went wrong in seekolous.
	const required = [
		"audio",
		"backdrop",
		"cockpit",
		"cruise",
		"galaxy",
		"hud",
		"names",
		"noise",
		"rng",
		"ship-mesh",
		"sim",
		"system",
		"units",
		"vec3",
	];
	const listed = new Set<string>(HEADLESS);
	for (const name of required) expect(listed.has(name), name).toBe(true);
	// The other direction, sorted rather than compared as sets so a failure
	// names the module instead of reporting a size.
	expect([...listed].sort()).toEqual([...required].sort());
	expect(new Set(HEADLESS).size).toBe(HEADLESS.length);
});

/**
 * Every way a module can name another one, with the prose removed first.
 *
 * Three alternatives rather than a `^\s*import\s` match, and each one closes a
 * hole seekolous shipped: the static form alone misses
 * `const t = await import("./units")`, and matching `import` anywhere still
 * misses `export { AU_KM } from "./units"`. `from` followed by a string literal
 * is what actually names another module, so that is the third and the one that
 * catches the re-export form.
 *
 * Comments are stripped before matching, so a docstring may say the word
 * "import" — several of these files do, at length — without reddening the test
 * that guards them. A code-position false positive would fail *closed*, which
 * for a leaf is the right direction to be wrong in.
 */
const importsIn = (file: string) =>
	codeOf(`src/${file}`).match(/\bimport\b|\brequire\s*\(|\bfrom\s*["'`]/g) ??
	[];

test("src/units.ts is a leaf, which is the whole of its job", () => {
	// Its docstring says what belongs in it; this says what must stay true of
	// it. A leaf with no imports cannot drag a renderer anywhere, and that
	// property — not the prose — is why both `sim.ts` and `main.ts` can read the
	// unit scheme without either depending on the other.
	expect(importsIn("units.ts")).toEqual([]);
});

test("the hysteresis band fits inside the near layer's reach", () => {
	// The threshold is not what has to fit — the *band* is. A body admitted to
	// the near layer is held there out to `HANDOFF_KM × HANDOFF_HYSTERESIS`, so
	// if `NEAR_FAR_KM` ever landed between the two, a body inside the band would
	// be drawn at 1:1 past the near camera's far plane and so not drawn at all:
	// the vanishing-between-layers failure `HANDOFF_KM`'s docstring warns about.
	//
	// Headless rather than only in the probe, which is why the hysteresis lives
	// in `units.ts` beside the constant it modifies rather than in the renderer
	// that applies it — a constant `main.ts` owns cannot be checked without a
	// browser, and this is arithmetic.
	expect(HANDOFF_KM * HANDOFF_HYSTERESIS).toBeLessThan(NEAR_FAR_KM);
	// And the band is a widening, not a narrowing.
	expect(HANDOFF_HYSTERESIS).toBeGreaterThanOrEqual(1);
});

test("the far camera's near plane admits a body that has not crossed yet", () => {
	// The other end of the same seam. A body at `HANDOFF_KM` is still in the far
	// layer, at `HANDOFF_KM × FAR_SCALE` far-units; if the far camera's near
	// plane sat beyond that, there would be a band where a body is assigned to
	// the far layer and clipped out of it.
	expect(FAR_NEAR_UNITS).toBeLessThan(HANDOFF_KM * FAR_SCALE);
});

test("layerFor holds and releases on the right sides of the band", () => {
	// The hysteresis state machine itself, which until this round needed a
	// browser to exercise: it lived in `Game` while both constants it reads lived
	// here. As a pure function it is arithmetic, and the two failures worth
	// pinning are the ones `probe-handoff.mjs` had to walk a ship around to find.
	const inside = HANDOFF_KM * 0.5;
	const band = HANDOFF_KM * ((1 + HANDOFF_HYSTERESIS) / 2);
	const outside = HANDOFF_KM * (HANDOFF_HYSTERESIS + 0.1);

	// Coming from far: the threshold is the bare one, so the band is *not* a
	// second chance to be admitted. A renderer that used the widened threshold in
	// both directions would admit a body here.
	expect(layerFor("far", band)).toBe("far");
	expect(layerFor("far", inside)).toBe("near");

	// Already near: held through the band, released past it. A band that never
	// releases returns "near" for `outside`; no band at all returns "far" for
	// `band`.
	expect(layerFor("near", band)).toBe("near");
	expect(layerFor("near", outside)).toBe("far");

	// Unplaced bodies start far — nothing is generated inside the handoff.
	expect(layerFor(undefined, outside)).toBe("far");
	expect(layerFor(undefined, inside)).toBe("near");
});

test("src/vec3.ts is a leaf, which is why the import cycle is gone", () => {
	// The vectors were in `sim.ts` while `sim.ts` was the only module with
	// positions. `galaxy.ts` and `system.ts` then imported them from there, and
	// wiring the generator into the world pointed `sim.ts` back at both — a
	// cycle ESM happens to resolve today because every use sits inside a function
	// body. Moving the shared half to a leaf is what removed it, and having no
	// imports is the property that keeps it removed: a leaf cannot close a cycle.
	expect(importsIn("vec3.ts")).toEqual([]);
});

test("src/audio.ts stays free of the rest of the game", () => {
	// The synth kit reaches `window` inside its methods and nowhere at module
	// scope, which is what lets it sit in the headless list at all. Having no
	// imports is the stronger claim beside it: an audio layer that imported the
	// simulation to decide what to play would be a coupling in the wrong
	// direction — cues are pushed to it, never pulled by it.
	expect(importsIn("audio.ts")).toEqual([]);
});
