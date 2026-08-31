/**
 * #61's first acceptance line, as a check: normal flight carries no combat
 * prototype.
 *
 * **A claim about absence, which is the kind that reads green for free.** The
 * browser half of this — `probe-boot.mjs` asserting a default boot allocates no
 * rig meshes and draws no rig chrome — proves the *running* game is clean. It
 * cannot prove the source is: a build that still threaded the prototype through
 * eight sites in `Game` and merely guarded each one would boot identically and
 * pass it. That build is exactly what #61 exists to remove, because unpicking
 * it later is the multi-site surgery the node's "Why" names.
 *
 * So this file checks the structural half — that the rig's vocabulary has left
 * `main.ts` — and the probe checks the behavioural half. Neither substitutes.
 *
 * Read through `codeOf`, so prose naming the prototype does not count as code
 * naming it. This file's own doc comment is the demonstration.
 */
import { expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";

const RIG = "src/combat-rig.ts";

/**
 * Every member `Game` used to carry for the prototype.
 *
 * Listed rather than counted, because a count passes on a build that traded one
 * of these for two of another. Each entry was a real member of `Game` before
 * the extraction, so this list is the diff and not a wish.
 *
 * The rig does not re-use these names — inside `combat-rig.ts` the file is the
 * namespace, so `combatTargetMesh` is just `targetMesh`. That is why this list
 * is only ever asserted *against* `main.ts`: it is a record of what left, not a
 * description of where it went.
 */
const GAME_MEMBERS_GONE = [
	// scene objects the rig allocates
	"combatTargetMesh",
	"combatLaser",
	// input interception
	"combatIncoming",
	"combatEcm",
	// rendered chrome, and the fitter that existed only for it
	"combatStatusFit",
	"combatStatusWorstWidth",
	"combatOverlayLines",
	"combatOverlayStatus",
	// the simulation seam
	"combatPrototypeEnabled",
	"stepCombatPrototype",
	"createCombatPrototype",
	"duelTargetInCone",
	"duelInputs",
	// probe hooks that were public members of the shipped class
	"probeForceLaserHidden",
	"probeFreezeLoop",
	"probeResumeLoop",
] as const;

test("the scanner reads the rig, and the rig is where the prototype went", () => {
	// The control, and it is not ceremony: every assertion in the next test is a
	// `not.toContain`, so a `codeOf` that returned an empty string — a bad path,
	// a stripper that ate the file — would pass all of them while checking
	// nothing.
	//
	// Asserted on things that must be true of the rig wherever its members are
	// named: the two scene objects a probe looks up by name, and the simulation
	// entry points. A rig that stopped allocating or stopped stepping would fail
	// here, which is what makes this a check rather than a length assertion.
	const rig = codeOf(RIG);
	expect(rig).toContain('"combat-prototype-target"');
	expect(rig).toContain('"combat-prototype-laser"');
	expect(rig).toContain("stepCombatPrototype");
	expect(rig).toContain("duelInputs");
});

test("main.ts does not thread the combat prototype", () => {
	const main = codeOf("src/main.ts");
	for (const name of GAME_MEMBERS_GONE) expect(main).not.toContain(name);
});

test("main.ts declares the rig once and builds it once", () => {
	const main = codeOf("src/main.ts");
	// One field, one construction. Not a mention count: the rig is *called* at
	// each seam it owns — resize, two keys, step, render, two overlay paths —
	// and those calls are the design rather than a leak. What must stay at one
	// is the state.
	expect(main.match(/readonly combatRig[?!]?:/g) ?? []).toHaveLength(1);
	expect(main.match(/new CombatPrototypeRig\(/g) ?? []).toHaveLength(1);
	// And the construction is gated, so a normal flight allocates nothing.
	expect(main).toMatch(
		/get\("combat"\) === "1"\s*\n?\s*\?\s*new CombatPrototypeRig/,
	);
});

test("no other combat vocabulary survives in main.ts", () => {
	const main = codeOf("src/main.ts");
	// The catch-all under the named bans above: any *other* combat identifier in
	// `Game`'s code is a threading site the list has not caught up with.
	//
	// Two bare `combat` tokens are expected and are not identifiers — the module
	// specifier `"./combat-rig"` and the `?combat=1` query flag — so they are
	// matched exactly rather than filtered by a substring, which would also have
	// swallowed a real `combatFoo`.
	const words = (main.match(/[A-Za-z_$]*combat[A-Za-z0-9_$]*/gi) ?? []).filter(
		(w) => w !== "combatRig" && w !== "CombatPrototypeRig" && w !== "combat",
	);
	expect(words).toEqual([]);
	// The bare tokens are bounded too: one import path, one query flag. A third
	// is a new place `main.ts` has learned the word.
	const bare = (main.match(/[A-Za-z_$]*combat[A-Za-z0-9_$]*/gi) ?? []).filter(
		(w) => w === "combat",
	);
	expect(bare).toHaveLength(2);
});
