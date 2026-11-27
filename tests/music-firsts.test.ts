import { describe, expect, test } from "bun:test";
import { commanderAfterDeath } from "../src/holdings";
import { parseMusicFirsts, withFirst } from "../src/music-firsts";
import { newCommanderRecord } from "../src/save-envelope";

const commander = () => newCommanderRecord("courier");

describe("the saved firsts (#589 D13)", () => {
	test("a new commander has heard none", () => {
		expect(commander().musicFirsts).toEqual([]);
	});

	test("an unknown or repeated entry is refused by name", () => {
		expect(() => parseMusicFirsts(["holst-mars", "holst-mars"])).toThrow(
			"repeats holst-mars",
		);
		expect(() => parseMusicFirsts(["holst-venus"])).toThrow(
			"holst-venus is not a first",
		);
		expect(() => parseMusicFirsts("holst-mars")).toThrow("not an array");
	});

	test("adding a first already there changes nothing", () => {
		const once = withFirst([], "dvorak-largo");
		expect(withFirst(once, "dvorak-largo")).toBe(once);
	});
});

describe("a death keeps what was heard (#771 Q1)", () => {
	for (const cause of ["destroyed", "eject"] as const)
		test(`${cause}: the dying record's firsts, not the last dock's`, () => {
			const dock = commander();
			const dying = { ...dock, musicFirsts: withFirst([], "holst-mars") };
			expect(commanderAfterDeath(dock, dying, cause).musicFirsts).toEqual([
				"holst-mars",
			]);
		});
});
