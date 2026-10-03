import { expect, test } from "bun:test";
import {
	DVORAK_LARGO,
	DVORAK_LARGO_SECONDS,
} from "../../src/music-classical/dvorak-largo";
import { wellFormed } from "./well-formed";

wellFormed(DVORAK_LARGO);

const events = DVORAK_LARGO.sections.flatMap((s) => s.events);
const pitchesOf = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the English horn's first two bars, sounding a fifth below the page: F–A♭–A♭–F–E♭–D♭, E♭–F–A♭–F–E♭", () => {
	expect(pitchesOf("eh").slice(0, 11)).toEqual([
		65, 68, 68, 65, 63, 61, 63, 65, 68, 65, 63,
	]);
});

test("the English horn's statement ends on D♭5", () => {
	expect(pitchesOf("eh").at(-1)).toBe(73);
});

test("the chorale opens on E major and closes on D♭ major", () => {
	const at = (bar: number) =>
		events
			.filter(
				(e) =>
					e.bar === bar &&
					e.beat === 0 &&
					(e.part === "chorale" || e.part === "bed"),
			)
			.map((e) => e.pitch)
			.sort((a, b) => a - b);
	expect(at(0)).toEqual([40, 47, 56, 59]);
	expect(at(3)).toEqual([37, 49, 53, 56, 61]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(DVORAK_LARGO_SECONDS).toBeGreaterThan(40);
	expect(DVORAK_LARGO_SECONDS).toBeLessThan(100);
});
