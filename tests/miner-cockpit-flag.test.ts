import { describe, expect, test } from "bun:test";
import { MINER_COCKPIT, minerCockpitOn } from "../src/miner-cockpit-flag";

describe("the miner cockpit flag (#1143)", () => {
	test("a dev server with ?cockpit=miner turns it on", () => {
		expect(minerCockpitOn(true, "?cockpit=miner")).toBe(true);
		expect(minerCockpitOn(true, "?seed=4&cockpit=miner")).toBe(true);
	});

	test("a built deploy ignores the query", () => {
		expect(minerCockpitOn(false, "?cockpit=miner")).toBe(false);
		expect(minerCockpitOn(undefined, "?cockpit=miner")).toBe(false);
		expect(minerCockpitOn("true", "?cockpit=miner")).toBe(false);
	});

	test("a dev server without the query keeps the courier cabin", () => {
		expect(minerCockpitOn(true, "")).toBe(false);
		expect(minerCockpitOn(true, "?cockpit=courier")).toBe(false);
		expect(minerCockpitOn(true, "?cockpit=")).toBe(false);
		expect(minerCockpitOn(true, "?miner")).toBe(false);
	});

	test("a page with no location is off", () => {
		expect(MINER_COCKPIT).toBe(false);
	});
});
