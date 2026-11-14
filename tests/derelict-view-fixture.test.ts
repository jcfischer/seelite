import "../src/loadout";
import { expect, test } from "bun:test";
import { nextDerelictViewWreck } from "../scripts/lib/derelict-view-fixture";
import { SEED, VIEWS } from "../scripts/lib/view-set.mjs";
import { carrierKey } from "../src/carrier-key";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import { isAuthoredHullModel } from "../src/model-catalog";
import { makeWorld, makeWorldAtSystem, resetWorldToStart } from "../src/sim";

test("derelict-tear's declared fixture selects a wreck with torn skin and exposed frame", () => {
	const view = VIEWS.find((view) => view.name === "derelict-tear");
	if (!view) throw Error("derelict-tear view is missing");
	const shot = view.shot;
	expect(shot.framing).toBe("tear");
	if (shot.framing !== "tear") throw Error("derelict-tear framing changed");
	const seed = ("seed" in shot ? shot.seed : undefined) ?? SEED;
	const systemIndex = "system" in shot ? shot.system : undefined;
	const world =
		systemIndex === undefined
			? makeWorld(seed)
			: makeWorldAtSystem(seed, systemIndex);
	resetWorldToStart(world);
	// **The subject is gone (node #1035).** A tear cuts a loft's ring-and-segment
	// grid, and every hull in the roster now draws an authored model, so no
	// wreck of this view can carry torn skin. The fixture refuses rather than
	// capturing a whole-looking hull under a tear's name, and this row states
	// that refusal: what is left is the principal's decision — extend the tear
	// to authored geometry, keep one hull's loft for wrecks, or retire the view.
	expect(() => nextDerelictViewWreck(world.system, "tear")).toThrow(
		"no derelict slot whose wreck the tear can cut",
	);
	const plain = nextDerelictViewWreck(world.system);
	expect(isAuthoredHullModel(plain.pose.hull)).toBe(true);
	disposeDerelict(buildDerelictMesh(plain.pose.hull));
});

test("the original fixture refuses tear framing but keeps its plain first-slot wreck", () => {
	const { system } = makeWorld(SEED);
	expect(() => nextDerelictViewWreck(system, "tear")).toThrow(
		"no derelict slot whose wreck the tear can cut",
	);
	const wreck = nextDerelictViewWreck(system);
	expect(wreck.key).toBe(carrierKey(248, "derelict-00"));
	expect(wreck.at).toBe(386297.2543988052);
	expect(wreck.pose.hull).toBe("freighter");
});
