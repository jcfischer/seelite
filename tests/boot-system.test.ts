/**
 * `?system=<index>`: the boot affordance that stands a new game at a named
 * system instead of at the start system ([#432]
 * (https://github.com/jcfischer/seelite/issues/432)).
 *
 * The parse lives here rather than in `main.ts` for the standing reason
 * `commander-flow.ts` carries: `main.ts` builds a renderer at module scope and
 * cannot be imported under bun, so a decision written there is a decision
 * nothing runs. `querySeed`'s parse is in `main.ts` — this node neither moves it
 * nor copies its weakness, which is what the empty-string row is for.
 *
 * What this file cannot reach is the boot itself: that a page handed
 * `?system=161` actually boots at system 161 is a browser claim, and
 * `scripts/probe-sky.mjs` reads it off a running page.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEMS_PER_GALAXY } from "../src/galaxy";
import { SYSTEM_QUERY, querySystem } from "../src/boot-system";

const query = (search: string) => new URLSearchParams(search);

/**
 * One parse, and whatever the page was told about it.
 *
 * A refusal that says nothing is the failure this affordance cannot have: a
 * person who types `?system=161` into a build that refuses it gets the start
 * system, and the difference between "the fixture refused" and "the fixture
 * landed" is the difference between a frame captioned honestly and one captioned
 * a lie. So the warns are captured rather than silenced, and every refusing row
 * below has to see one.
 */
function parse(search: string): { value: number | null; said: string[] } {
	const said: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) =>
		void said.push(args.map(String).join(" "));
	try {
		return { value: querySystem(query(search)), said };
	} finally {
		console.warn = warn;
	}
}

describe("?system=", () => {
	test("absent is null, which is the start system a player gets", () => {
		// Absent is not a refusal, so nothing is said.
		expect(parse("")).toEqual({ value: null, said: [] });
		expect(parse("seed=47")).toEqual({ value: null, said: [] });
	});

	test("an index the galaxy has is read, both ends of it", () => {
		expect(parse("system=0").value).toBe(0);
		expect(parse(`system=${SYSTEMS_PER_GALAXY - 1}`).value).toBe(
			SYSTEMS_PER_GALAXY - 1,
		);
		expect(parse("system=161").said).toEqual([]);
	});

	/**
	 * Clamping would be the worse refusal. A capture asking for system 999 and
	 * quietly getting system 255 would photograph a frame and caption it with a
	 * system it is not — #104's "captured, green, complete and shows nothing"
	 * wearing the right label. `capture-views.mjs` reads the booted index back
	 * and throws, and this refusal is what makes that read the whole answer.
	 */
	test("an index the galaxy does not have is refused, and said", () => {
		for (const bad of [
			`${SYSTEMS_PER_GALAXY}`,
			`${SYSTEMS_PER_GALAXY + 1}`,
			"99999",
			"-1",
			"-0.5",
		]) {
			const { value, said } = parse(`system=${bad}`);
			expect(value).toBeNull();
			expect(said.length).toBe(1);
			expect(said[0]).toContain(bad);
		}
	});

	/**
	 * `Number("")` and `Number("   ")` are both `0`, and `Number("0x4")` and
	 * `Number("1e2")` are 4 and 100, so a `Number()`-only parse would pin a
	 * system nobody typed. This is `querySeed`'s empty-string trap one rung up
	 * the ladder: only a run of decimal digits is an index. And `0` is a legal
	 * value, so a fallback to `0` is indistinguishable from the answer — the
	 * reason every refused case above has to be *said*.
	 */
	test("an unusable value is refused, and system 0 is not the fallback", () => {
		for (const bad of ["", "   ", "abc", "12.5", "1e2", "0x4", "NaN"]) {
			const { value, said } = parse(`system=${encodeURIComponent(bad)}`);
			expect(value).toBeNull();
			expect(said.length).toBe(1);
		}
	});

	test("the parameter is spelled the one way the scripts build it", async () => {
		// `scripts/lib/game-url.mjs` runs under node and cannot import this file,
		// so the two spellings are pinned by reading the script — the same
		// bargain `tests/game-url.test.ts` strikes for `?boot`. `gameUrl` takes
		// parameters generically, so the spelling this pins is the one
		// `capture-views.mjs` passes it.
		expect(SYSTEM_QUERY).toBe("system");
		const capture = await Bun.file(
			new URL("../scripts/capture-views.mjs", import.meta.url),
		).text();
		// The game URL the capture builds has to carry a `system` parameter.
		// Matched as the call rather than as `system:`, because an object
		// shorthand spells the same parameter and a formatting choice is not a
		// change in what the URL says.
		const scoped = capture.replace(/\s+/g, " ");
		expect(/gameUrl\(SERVING, \{[^}]*\bsystem\b[^}]*\}\)/.test(scoped)).toBe(
			true,
		);
	});
});
