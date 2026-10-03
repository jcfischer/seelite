/**
 * The renderer's half of a jump, read as text (#187).
 *
 * ## Why a source scan
 *
 * `Game` lives in `src/main.ts`, which imports Three.js and a DOM, so no bun
 * test constructs one — `tests/leg-reset-coverage.test.ts` states that
 * constraint and every test with anything to say about that file works the same
 * way. What a scan can answer honestly is **ordering and membership**, and both
 * failures this file is about are of that kind:
 *
 * - `buildLights` running a second time. `layerLights` is a `push` and the suns
 *   and hemispheres are `scene.add`ed, so a jump that rebuilt the rig would
 *   double every light in every layer. The symptom is a system that is simply
 *   brighter than the one before it, which no probe in this repo would call a
 *   fault and which the canonical view set — captured in the start system —
 *   cannot see at all.
 * - Building before tearing down. `buildBodies` writes into the same three maps
 *   the teardown reads its handles out of, so the wrong order leaks the whole
 *   previous system silently.
 *
 * Every claim below was confirmed by breaking it and watching this file go red.
 */
import { describe, expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";

const SUBJECT = "src/main.ts";
const main = codeOf(SUBJECT);

/** The body of a one-tab-indented method, by brace matching — the same reader
 *  `leg-reset-coverage` uses, and for the same reason. */
function methodBody(name: string): string {
	const head = new RegExp(
		`^\\t(?:private |readonly |private readonly )?(?:async )?${name}\\([^)]*\\)\\s*(?::[^{\\n]+)?\\{`,
		"m",
	);
	const at = main.match(head);
	if (at?.index === undefined)
		throw new Error(`${SUBJECT} has no method ${name}() at member indentation`);
	const open = at.index + at[0].length - 1;
	let depth = 0;
	for (let i = open; i < main.length; i++) {
		if (main[i] === "{") depth++;
		else if (main[i] === "}" && --depth === 0) return main.slice(open, i);
	}
	throw new Error(`${name}() in ${SUBJECT} has no closing brace`);
}

/** `a` appears before `b`, with both present — `indexOf` returns -1 on a miss
 *  and -1 is less than every real index, so the presence half is not optional. */
function inOrder(body: string, a: string, b: string) {
	expect(body).toContain(a);
	expect(body).toContain(b);
	expect(body.indexOf(a)).toBeLessThan(body.indexOf(b));
}

describe("the light rig is built once per Game, not once per system", () => {
	const rebuild = methodBody("rebuildSystem");

	test("rebuildSystem does not rebuild the rig", () => {
		expect(rebuild).not.toContain("buildLights");
	});

	test("but it does rebake the environment, which is the star's own colour", () => {
		expect(rebuild).toContain("this.buildEnvironment()");
	});

	test("buildBodies creates no lights, which is what makes the split safe", () => {
		// The rig moved out of `buildBodies` so a jump could call that method
		// again. A light constructed back inside it would be per-system once
		// more, and nothing else here would notice.
		const bodies = methodBody("buildBodies");
		expect(bodies).not.toContain("DirectionalLight");
		expect(bodies).not.toContain("HemisphereLight");
		expect(bodies).not.toContain("layerLights.push");
		// And the rig really does hold those, so the absence above is a
		// constraint rather than a statement about a method that never had any.
		const lights = methodBody("buildLights");
		expect(lights).toContain("DirectionalLight");
		expect(lights).toContain("HemisphereLight");
		expect(lights).toContain("this.layerLights.push");
	});

	test("a boot builds bodies and then the rig", () => {
		// `buildLights` reads nothing `buildBodies` writes today, but
		// `buildEnvironment` at its end calls `applyQuality`, which walks
		// `layerLights` — so the order is the one the constructor has.
		const constructorBody = methodBody("constructor");
		inOrder(constructorBody, "this.buildBodies()", "this.buildLights()");
	});
});

describe("a jump tears down before it builds", () => {
	const rebuild = methodBody("rebuildSystem");

	test("every drawn handle is disposed before buildBodies overwrites the map", () => {
		inOrder(rebuild, "visual.dispose()", "this.buildBodies()");
		inOrder(rebuild, "station.dispose()", "this.buildBodies()");
		inOrder(rebuild, "this.meshes.clear()", "this.buildBodies()");
	});

	test("the scanner's fixed buffer is resized to the new body count", () => {
		// It is filled in place every frame so the projection allocates nothing;
		// a system with more bodies would silently drop the surplus and one with
		// fewer would leave stale contacts on the scanner.
		expect(rebuild).toContain("this.scannerContactBuffer.length = bodies");
	});
});

describe("the jump itself", () => {
	const perform = methodBody("performJump");

	test("the world moves before the renderer is rebuilt", () => {
		// The other way round rebuilds the system the ship is leaving.
		inOrder(perform, "jumpWorldTo(this.world, to)", "this.rebuildSystem()");
	});

	test("the destination traffic replaces departed routes before the jump returns", () => {
		// `render` follows `step` in the same animation frame. Traffic authority is
		// normally advanced at the start of a step, so waiting for the next one
		// leaves one render able to consume the departed system's routes and meshes.
		// `ensureTrafficActors` is the bounded hand-off: it clears those handles and
		// seeds only parked destination traffic; full projection still warms later.
		inOrder(
			perform,
			"this.clearSystemScopedState()",
			"this.ensureTrafficActors()",
		);
		inOrder(perform, "this.ensureTrafficActors()", "this.selectBootTarget()");
	});

	test("the tank is spent, and the drive charge is not refilled", () => {
		expect(perform).toContain("fuelLy: decision.plan.fuelLeftLy");
		// §7 refills the cruise reserve on docking. A jump is not a dock, and a
		// jump that quietly topped it up would make the anti-stranding rule a
		// different rule.
		expect(perform).not.toContain("this.chargeAu =");
	});

	test("the wind-up arms the jump and does not take it", () => {
		// **This row asserted the defect until sage round 3.** It pinned
		// `advanceWorldClock` before `performJump` *inside* `stepJumpCharge` —
		// which is the shape that made the firing frame unflown: the clock was
		// bumped by hand, the jump taken, and `step` returned before `stepWorld`
		// and `stepDocking` ran. §8 sells the wind-up on the ship being
		// vulnerable through it and on damage cancelling the charge, and on the
		// one frame that decides the jump neither could happen.
		const stepCharge = methodBody("stepJumpCharge");
		expect(stepCharge).toContain("this.pendingJump = step.fired");
		// The two things that made the frame unflown are gone from it.
		expect(stepCharge).not.toContain("advanceWorldClock");
		expect(stepCharge).not.toContain("performJump");
	});

	test("the firing frame is flown, and the jump is taken after the docking check", () => {
		// The clock advances once, through `stepWorld`, like any other frame —
		// and `stepDocking` is what applies a failed entry's damage, so it has
		// to run before the jump is taken or a clip on the terminal frame
		// cannot cancel it.
		const frame = methodBody("advanceNormalFlight");
		inOrder(frame, "stepWorld(", "this.stepDocking(before)");
		inOrder(frame, "this.stepDocking(before)", "this.takePendingJump()");
	});

	test("a reset that replaces the system rebuilds the renderer with it", () => {
		// `resetWorldToStart` is total (round 2), so from another star it swaps
		// `world.system` — and the renderer's meshes are the departed system's.
		// Without this the reset simulates one system while drawing another.
		// The predicate is read *before* the reset because afterwards it is
		// always true.
		const reset = methodBody("resetFlightToStart");
		inOrder(
			reset,
			"!canResetWorldToStart(this.world)",
			"resetWorldToStart(this.world)",
		);
		inOrder(reset, "resetWorldToStart(this.world)", "this.rebuildSystem()");
		inOrder(
			reset,
			"this.clearSystemScopedState()",
			"this.ensureTrafficActors()",
		);
	});

	test("the jump prompt is not gated behind the target range", () => {
		// **The playtest defect, pinned.** The jump line sat inside
		// `cruisePrompt`'s `targetKm < 3600 * ASSIST_CAP_KMS` branch, so it
		// appeared only with a target selected *and* the ship already within
		// 7,200 km of it. A ship arrives 1 AU out, so in practice the one prompt
		// for this node's whole mechanic was never seen — the principal set a
		// course, flew forward and got "press J to cruise".
		//
		// A source scan rather than a behavioural one for this file's stated
		// reason: `Game` needs Three and a DOM. What it can hold is the
		// ordering, which is the whole of the bug — the hop is read before any
		// range test, so no range can hide it.
		const prompt = methodBody("cruisePrompt");
		inOrder(prompt, "const hop = this.nextHop()", "if (targetKm === null)");
		inOrder(prompt, "const hop = this.nextHop()", "3600 * ASSIST_CAP_KMS");
		// And the branch **returns**, not merely computes — otherwise the read
		// could sit above the range tests and still fall through to them.
		//
		// This was `toContain("if (hop) return")`, a pin on one spelling: #117
		// gave the branch a body — it asks `planJump` so the line agrees with
		// §8.3's course row about whether the hop is affordable — and the pin
		// went red on a refactor that changes nothing this test is about. What
		// it holds now is the ordering that *is* the bug: the branch returns
		// before either range test is reached.
		inOrder(prompt, "if (hop) {", "return decision.ok");
		inOrder(prompt, "return decision.ok", "if (targetKm === null)");
		inOrder(prompt, "return decision.ok", "3600 * ASSIST_CAP_KMS");
	});

	/**
	 * **The two lines above the floor cannot overlap, by construction.**
	 *
	 * `floorTopY` is the one owner of the band stack since #117, and four
	 * surfaces read it: the strip, §8.3's course row, the cruise/jump prompt and
	 * §3's clearance line. The last two are both `PROMPT_FONT` and both centred
	 * on `cx`, so their gap is the difference of two constants — and moving the
	 * prompt onto the anchor closed it from 11.6 px at the probe's 760 to 6,
	 * which is less than a line.
	 *
	 * **Why a source scan and not a pixel row.** The pair coexists only when a
	 * course is set *and* the ship is inside `DIRECTOR_RANGE_KM` with an engaged
	 * docking state — a frame the live-cockpit probe cannot reach without
	 * `probe-docking`'s rig, and a probe row that clears because nothing was
	 * drawn is the control that never runs. The construction is the guarantee:
	 * the clearance offset is *derived* from the prompt's, a line further out.
	 * This goes red the day someone writes a literal back in.
	 */
	test("§3's clearance line is derived a whole line above the prompt", () => {
		expect(main).toContain(
			"const CLEARANCE_ABOVE_FLOOR_PX = PROMPT_ABOVE_FLOOR_PX + PROMPT_LINE_HEIGHT_PX;",
		);
		// And the line height is the one `TextRaster` gives a centred prompt,
		// not a number picked to make the sum come out.
		expect(codeOf("src/text-raster.ts")).toContain("this.bounds.height = 18;");
		expect(main).toContain("const PROMPT_LINE_HEIGHT_PX = 18;");
	});

	test("damage goes through one funnel that cancels the charge and the spool-up", () => {
		// `in-system-travel.md` §4: re-entering cruise is a spool-up cancelled by
		// damage, and §8's jump charge is cancelled by damage too. One method owns
		// both, and it holds the only `applyDamage` call on the condition. `step`
		// and the reset write the condition too; neither lands damage.
		const take = methodBody("takeDamage");
		expect(take).toContain("this.cancelJumpCharge(reason)");
		expect(take).toContain("this.cancelSpoolUp(reason)");
		expect(methodBody("cancelSpoolUp")).toContain("this.spoolLeftS = 0");
		expect(main.match(/this\.condition = applyDamage\(/g) ?? []).toHaveLength(
			1,
		);
		expect(take).toContain("this.condition = applyDamage(");
	});

	test("cancelling clears the armed jump, not only the charge", () => {
		// A charge that has fired is already idle, so a `charging` guard alone
		// would let damage on the terminal frame report a cancellation and the
		// jump happen anyway.
		const cancel = methodBody("cancelJumpCharge");
		expect(cancel).toContain("this.pendingJump === null");
		expect(cancel).toContain("this.pendingJump = null");
	});
});
