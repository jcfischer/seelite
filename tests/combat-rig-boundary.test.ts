/**
 * #61's first acceptance line, as a check: normal flight carries no combat
 * prototype.
 *
 * **A claim about absence, which is the kind that reads green for free.** The
 * browser half of this — `probe-boot.mjs` asserting a default boot holds no rig
 * and that neither prototype mesh is in the near layer — proves the *running*
 * game is clean. (It measures allocation, not chrome: with no rig there is
 * nothing left to draw the chrome, so the glass is not separately asserted.) It
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
import { bodyVelocity, makeWorld } from "../src/sim";
import { codeOf } from "./lib/source-scan";

const RIG = "src/combat-rig.ts";

/**
 * Every prototype name `main.ts` must not contain.
 *
 * Listed rather than counted, because a count passes on a build that traded one
 * of these for two of another.
 *
 * **Two kinds of entry, and an earlier version of this comment claimed they
 * were one.** Most were real members of `Game` before the extraction
 * (`combatTargetMesh`, `combatStatusFit`, `probeFreezeLoop`, …) and their bans
 * are a record of what left. Four were never members: `stepCombatPrototype`,
 * `createCombatPrototype` and `duelTargetInCone` were *imports* `main.ts` made,
 * and `duelInputs` is created by this branch and never appeared there at all.
 * Those four are bans on the prototype's vocabulary returning by any route
 * rather than diffs — `duelInputs` in particular could not have failed on the
 * pre-extraction tree, and saying so is the honest version.
 *
 * The rig does not re-use the member names — inside `combat-rig.ts` the file is
 * the namespace, so `combatTargetMesh` is just `targetMesh`. That is why this
 * list is only ever asserted *against* `main.ts`.
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
	// `duelInputs` until #53: the rig drove a *scripted* duel, and the schedule
	// was the thing it could not be caught without. It now flies a real striker
	// and hands the balance model that fight's own geometry, so the entry point
	// that must be here is the controller's. `duelInputs` survives for
	// `tests/combat-prototype.test.ts`, which paces the two weapon arms against
	// each other and needs a schedule identical between them.
	expect(rig).toContain("stepCombatEnemy");
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
	// And the construction is gated. Asserted as proximity rather than as a
	// shape: pinning the ternary went red on an `if`/`else` or an extracted
	// boolean, neither of which ungates anything. What the gate *does* is
	// `probe-boot.mjs`'s to prove; this only refuses a construction with no
	// `combat` flag anywhere near it.
	const built = main.indexOf("new CombatPrototypeRig(");
	expect(built).toBeGreaterThan(0);
	expect(main.slice(Math.max(0, built - 200), built)).toContain('"combat"');
});

test("no other combat vocabulary survives in main.ts", () => {
	const main = codeOf("src/main.ts");
	// The catch-all under the named bans above: any *other* combat identifier in
	// `Game`'s code is a threading site the list has not caught up with.
	//
	// One scan, two partitions, so the two halves cannot drift apart. The bare
	// `combat` tokens are expected and are not identifiers — the module specifier
	// `"./combat-rig"` and the `?combat=1` query flag — and they are matched
	// exactly rather than by substring, which would also have swallowed a real
	// `combatFoo`.
	const ALLOWED = new Set(["combatRig", "CombatPrototypeRig"]);
	const all = main.match(/[A-Za-z_$]*combat[A-Za-z0-9_$]*/gi) ?? [];
	expect(all.filter((w) => !ALLOWED.has(w) && w !== "combat")).toEqual([]);
	// Bounded too: one import path, one query flag. A third is a new place
	// `main.ts` has learned the word.
	expect(all.filter((w) => w === "combat")).toHaveLength(2);
});

/**
 * The striker is in the target list and is **not** in the world, and one of
 * those two facts throws.
 *
 * `bodyVelocity` refuses an id the system does not hold rather than returning
 * zero, deliberately — `sim.ts` says a body it cannot find is the two halves
 * having disagreed about what is in the system. `Game.targetVelocity()` runs
 * every cruise frame and `timeToBody` runs from the panel, so selecting the
 * striker and pressing J killed the animation loop on the first frame of the
 * spool. #53 put the striker in `selectable()`; nothing before it had ever put
 * something selectable outside `byId`.
 *
 * Two halves, and neither substitutes. The first proves the hazard is real
 * against a shipped world, so a future `bodyVelocity` that started returning
 * zero would fail here rather than silently making the guard decorative. The
 * second is a source scan, which is this file's tier: `Game` needs a browser,
 * so the behavioural half belongs to `probe-live-cockpit` and not here.
 */
test("the striker's id is not a world body, and bodyVelocity says so by throwing", () => {
	const world = makeWorld(42);
	expect(world.system.byId.has("combat-prototype-enemy")).toBe(false);
	expect(() =>
		bodyVelocity(world.system, "combat-prototype-enemy", world.gameTime),
	).toThrow();
});

test("every bodyVelocity call on a selectable id goes through the striker guard", () => {
	const main = codeOf("src/main.ts");
	// Round 1 guarded `targetVelocity()` and `timeToBody()` separately and this
	// counted the copies; round 2 folded both into `velocityOf`, so counting
	// copies would now be **load-testing the duplication**. What has to hold is
	// the property, and it is checkable: the two selectable-target paths call
	// `velocityOf`, and the only `bodyVelocity` left in the file that takes a
	// *target* id is the one inside it.
	expect(main).toContain("private velocityOf(id: string)");
	expect(main.match(/this\.velocityOf\(/g) ?? []).toHaveLength(2);
	// `bodyVelocity` has five callers and each takes an id the world is
	// guaranteed to hold: `velocityOf`'s own fallback, `localFrame` and the
	// velocity readout's frame (both picked by walking `world.system.bodies`),
	// `stationVelocity`, and `entryPose` — which does `byId.get(id)` and throws
	// two lines above. A sixth is a path that has not answered the question this
	// file asks, and the count is what makes it say so.
	expect(main.match(/bodyVelocity\(this\.world\.system/g) ?? []).toHaveLength(
		5,
	);
});

/**
 * The striker's borrowed `kind`, and the sites that could see it.
 *
 * `combat-rig.ts` gives `targetBody` `kind: "moon"` — a ship is none of
 * `PlacedBody`'s four kinds, and adding a fifth is a production taxonomy change
 * that a throwaway prototype has no business making. The comment there argues
 * the borrow is inert because every other `kind` dispatch in `main.ts` reads a
 * body that came out of `world.system.bodies`, which the striker is not in, and
 * it cited this file for that. The citation was false until now; this is it.
 *
 * Counted rather than inspected, because what has to hold is that no *new* site
 * appears. Thirteen reads of `.kind` today — twelve on a body and one on a
 * station aperture, which is a different taxonomy — and every body one is
 * either a literal comparison against a generated kind or a read of something
 * pulled from `world.system.bodies`. A fourteenth is a build that has to answer
 * the comment in `combat-rig.ts` again.
 */
test("main.ts's body-kind dispatch sites are the ones the striker cannot reach", () => {
	const main = codeOf("src/main.ts");
	expect(main.match(/\.kind\b/g) ?? []).toHaveLength(13);
	// `selectable()` is the one list the striker joins, and it joins it by being
	// **pushed after** the filter and the sort rather than by passing them.
	// Pinned as an ordering, because that ordering is the whole argument.
	const filtered = main.indexOf('b.kind !== "moon"');
	const pushed = main.indexOf("selectableCache.push(striker)");
	expect(filtered).toBeGreaterThan(0);
	expect(pushed).toBeGreaterThan(filtered);
});
