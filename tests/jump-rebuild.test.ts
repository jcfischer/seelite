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

	test("the tank is spent, and the drive charge is not refilled", () => {
		expect(perform).toContain("fuelLy: decision.plan.fuelLeftLy");
		// §7 refills the cruise reserve on docking. A jump is not a dock, and a
		// jump that quietly topped it up would make the anti-stranding rule a
		// different rule.
		expect(perform).not.toContain("this.chargeAu =");
	});

	test("the last frame of the wind-up reaches the clock before the world moves", () => {
		// `step` returns straight after a jump, so `stepWorld` never runs on the
		// firing frame: without this line the clock loses a frame per jump, and
		// the wind-up is the whole of what a jump costs the clock (§8.1).
		const stepCharge = methodBody("stepJumpCharge");
		inOrder(
			stepCharge,
			"advanceWorldClock(this.world, dt)",
			"this.performJump(to)",
		);
	});
});
