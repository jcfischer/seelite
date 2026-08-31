/**
 * `Game.resetToStart` restores every field the flight path writes.
 *
 * ## Why a source scan and not a behavioural test
 *
 * `tests/world-reset.test.ts` guards the *world* half of the reset against a
 * fresh `makeWorld(seed)`, which is a real comparison because `sim.ts` runs
 * headless. The renderer's half cannot be tested that way: `Game` lives in
 * `src/main.ts`, which imports Three.js and a DOM, so no bun test constructs
 * one — every test that has anything to say about that file reads it as text
 * (`combat-rig-boundary`, `perf-panel-keys`, `nav-list`, `source-scan`).
 *
 * So this reads it as text, and asks the one question a text scan can answer
 * honestly: **is there a field the flight path assigns that the reset does
 * not?** That is exactly the failure #121 named — a reset that forgets a field
 * puts the second leg in a state no player ever has, and the browser probe
 * flying that leg cannot tell, because it would report a perfectly well-formed
 * number about the wrong start.
 *
 * ## What it cannot see, said plainly
 *
 * It compares names, not values. A reset that assigns `chargeAu = 0` satisfies
 * it. It reads a declared list of methods, so a flight-path field written in
 * some method not on that list is invisible — the list is the claim, and
 * widening it is a person's judgement. And it cannot know that a boot value is
 * the *right* value to restore.
 *
 * What it does catch is the drift that actually happens: cruise gains a field,
 * the reset is not updated, and nothing says so. That goes red here, on the
 * tier that runs on every push.
 */
import { expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";

const SUBJECT = "src/main.ts";
const main = codeOf(SUBJECT);

/**
 * The methods a cruise leg runs through, and the ones holding a cache keyed on
 * the clock the reset rewinds.
 *
 * The second group is here because rewinding is the operation a time-keyed
 * cache is least prepared for: a cache stamped at t=900 and read at t=0 is
 * being asked a question it has never been asked in a forward-only game.
 */
const LEG_PATH = [
	"engageCruise",
	"dropOut",
	"stepCruise",
	"advanceNormalFlight",
	"step",
	"masses",
	"updateEtaEstimate",
	"updateInstruments",
	"navRows",
	"selectable",
];

/** The body of a one-tab-indented method, by brace matching. */
function methodBody(source: string, name: string): string {
	const head = new RegExp(
		`^\\t(?:private |readonly |private readonly )?(?:async )?${name}\\([^)]*\\)\\s*(?::[^{\\n]+)?\\{`,
		"m",
	);
	const at = source.match(head);
	if (at?.index === undefined)
		throw new Error(
			`${SUBJECT} has no method ${name}() at class-member indentation — ` +
				`if it was renamed or removed, LEG_PATH is the thing to update`,
		);
	const open = at.index + at[0].length - 1;
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) return source.slice(open, i);
	}
	throw new Error(`${name}() in ${SUBJECT} has no closing brace`);
}

/** `this.foo =`, `this.foo +=`, `this.foo -=` — assignments, not reads, and not
 *  `===`. */
const assignedFields = (body: string) => {
	const out = new Set<string>();
	for (const [, name] of body.matchAll(
		/this\.([A-Za-z_$][\w$]*)\s*(?:=[^=]|\+=|-=)/g,
	))
		out.add(name);
	return out;
};

test("every method the reset is declared against exists", () => {
	// Its own test because the failure is different in kind: a renamed method
	// makes this file guard *less* than it says, and a scan that silently covers
	// nine methods while claiming ten is the shape of false confidence this repo
	// has been bitten by before.
	for (const name of LEG_PATH)
		expect(() => methodBody(main, name)).not.toThrow();
});

test("resetToStart assigns every field the flight path assigns", () => {
	const written = new Set<string>();
	for (const name of LEG_PATH)
		for (const field of assignedFields(methodBody(main, name)))
			written.add(field);

	// The premise. Without it a scan that found no methods, or a regex that
	// stopped matching, would pass by finding nothing to check — the failure mode
	// where a green run means the check has stopped running.
	expect(written.size).toBeGreaterThan(10);

	const restored = assignedFields(methodBody(main, "resetToStart"));
	const missing = [...written].filter((f) => !restored.has(f)).sort();
	expect(missing).toEqual([]);
});

test("resetToStart hands the world half to sim.ts", () => {
	// The renderer must not restate the clock, the bodies or the arrival point:
	// `resetWorldToStart` owns those and `tests/world-reset.test.ts` is what
	// proves them right. A second spelling here is a second answer to where boot
	// state is.
	const body = methodBody(main, "resetToStart");
	expect(body).toContain("resetWorldToStart(this.world)");
	expect(body).not.toContain("arrivalPoint");
	expect(body).not.toContain("gameTime =");
});
