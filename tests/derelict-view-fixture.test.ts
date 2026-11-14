import "../src/loadout";
import { expect, test } from "bun:test";
import { nextDerelictViewWreck } from "../scripts/lib/derelict-view-fixture";
import { SEED, VIEWS } from "../scripts/lib/view-set.mjs";
import { carrierKey } from "../src/carrier-key";
import { makeWorld } from "../src/sim";

test("the retired tear view has no fixture or coverage claim", () => {
	expect(VIEWS.some((view) => view.name === "derelict-tear")).toBe(false);
	expect(VIEWS.some((view) => view.covers.includes(735))).toBe(false);
});

test("the plain fixture keeps its first-slot wreck", () => {
	const { system } = makeWorld(SEED);
	const wreck = nextDerelictViewWreck(system);
	expect(wreck.key).toBe(carrierKey(248, "derelict-00"));
	expect(wreck.at).toBe(386297.2543988052);
	expect(wreck.pose.hull).toBe("freighter");
});
