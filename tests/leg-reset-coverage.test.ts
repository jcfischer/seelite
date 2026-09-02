/**
 * `Game.resetFlightToStart` restores every field the flight path writes.
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
 * it. It reads a declared **hand-maintained** list of methods, so a flight-path
 * field written in some method not on that list is invisible — a rename fails
 * loudly, an addition does not, and the docking path is a gap this reset names
 * in its own docblock rather than one this file can see. And it cannot know
 * that a boot value is the *right* value to restore.
 *
 * **It reads two kinds of write, and the second is here because the first
 * missed one.** Assignment was the whole scan to begin with, and `step` turns
 * the ship by mutating a `readonly` field in place — `this.orientation.multiply
 * (turn)` — so attitude went unrestored underneath a test asserting the reset
 * restored everything. A method call on a field is now its own class. Neither
 * pattern sees a field written through a local alias or inside a helper it was
 * handed to.
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
	// §8's wind-up (#187). It is on this list and `performJump` is not, and the
	// difference is what a reset is *for*: the charge is flight-session state a
	// second leg must not inherit, while a jump writes the commander's tank, the
	// per-galaxy visited set and the station console's cache — none of which a
	// return to the start of a leg should undo. `resetWorldToStart` refuses a
	// jumped world outright, so a reset after a jump is a throw rather than a
	// half-restored state this scan would have to have an exemption for.
	"stepJumpCharge",
	"stepCruise",
	"advanceNormalFlight",
	"step",
	"masses",
	"updateEtaEstimate",
	"updateInstruments",
	"navRows",
	"selectable",
];

/**
 * Methods a leg runs through whose **assignments** are session state but whose
 * in-place mutations are not.
 *
 * `render` is the case, and the split is the map's constraint rather than a
 * convenience: the scene graph is display only, and nothing reads a position
 * back out of an `Object3D`. So `this.nearScene.add(...)` is not state a second
 * leg could inherit, while `this.frames++` — which is what put `render` on this
 * list — plainly is. Scanning it for both would demand an exemption line for
 * every scene object the frame touches, and a list of seven exemptions reads as
 * coverage while guarding nothing.
 */
const DISPLAY_PATH = ["render"];

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

/**
 * Fields the flight path touches that the reset deliberately leaves alone, with
 * the reason.
 *
 * An exemption is a decision, so it costs a line here rather than being
 * silence. Anything not listed has to appear in the reset.
 */
const NOT_RESET: Record<string, string> = {
	audio:
		"the WebAudio engine is a device, not world state — a leg asks it to make " +
		"noises and leaves nothing on it a second leg could read",
	frames:
		"a monotonic count of frames drawn since boot, read by the probes' own " +
		"boot wait — rewinding it would make `bootedGame` wait again for a page " +
		"that never left, and nothing in the sim reads it",
};

/**
 * Fields restored by calling a method rather than by naming them.
 *
 * `orientation` is the case: a boot points the nose with `faceTheStar`, so the
 * reset does too, and writing the quaternion out here instead would be a second
 * spelling of the boot rule. The indirection is declared rather than allowed
 * for, so the scan still knows which field each call is answering for.
 */
const RESTORED_BY: Record<string, string> = { orientation: "faceTheStar" };

/**
 * `this.foo =`, and every compound form: `+= -= *= /= ??= ||= &&=`, `++`, `--`.
 *
 * The increment forms are here because `render` writes `this.frames++` and the
 * first version of this pattern covered only `= += -=`, so that write was
 * invisible to a test claiming to list everything the leg path writes.
 * Deliberately not matching bare `==` or `===`.
 */
const assignedFields = (body: string) => {
	const out = new Set<string>();
	for (const [, name] of body.matchAll(
		/this\.([A-Za-z_$][\w$]*)\s*(?:=[^=]|\+\+|--|[+\-*/%]=|\?\?=|\|\|=|&&=)/g,
	))
		out.add(name);
	return out;
};

/** `this.foo.bar(...)` — a field written in place rather than replaced. */
const mutatedFields = (body: string) => {
	const out = new Set<string>();
	for (const [, name] of body.matchAll(
		/this\.([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\(/g,
	))
		out.add(name);
	return out;
};

/** Every field the named methods write, by whichever mechanism `extract` reads. */
const across = (names: string[], extract: (body: string) => Set<string>) => {
	const out = new Set<string>();
	for (const name of names)
		for (const field of extract(methodBody(main, name))) out.add(field);
	return out;
};

/** Computed once: each call re-reads ten method bodies out of the largest file
 *  in the project. */
/**
 * Memoised rather than computed at module scope, and that is the difference
 * between one useful failure and six useless ones.
 *
 * `methodBody` throws when a declared method is gone — which is the case
 * "every method the reset is declared against exists" was written for. At
 * module scope that throw happens during import, so the file never loads, every
 * test in it reports as a load error, and the one test that would have named
 * `LEG_PATH` never runs.
 */
const memo = <T>(build: () => T) => {
	let value: T | undefined;
	return () => {
		if (value === undefined) value = build();
		return value;
	};
};

const mutated = memo(() => across(LEG_PATH, mutatedFields));
const assigned = memo(
	() =>
		new Set([
			...across(LEG_PATH, assignedFields),
			...across(DISPLAY_PATH, assignedFields),
		]),
);
/**
 * The reset's body **and the helper it delegates to**.
 *
 * `clearFlightSession` was extracted in sage round 2 because `performJump` had
 * spelled the same fifteen assignments — and extracting it immediately reddened
 * this scan, which is the scan working: the assignments left the method it reads
 * and it said so rather than passing on a method that now clears nothing.
 *
 * Concatenated rather than followed, because a scan that chased calls would be
 * a call graph, and this file's whole argument is that it is a text scan whose
 * one question is answerable as text. If a third site is ever added, it goes in
 * this list rather than being discovered.
 */
const resetBody = memo(
	() =>
		`${methodBody(main, "resetFlightToStart")}\n${methodBody(main, "clearFlightSession")}`,
);

test("every method the reset is declared against exists", () => {
	// Its own test because the failure is different in kind: a renamed method
	// makes this file guard *less* than it says, and a scan that silently covers
	// nine methods while claiming ten is the shape of false confidence this repo
	// has been bitten by before.
	for (const name of LEG_PATH)
		expect(() => methodBody(main, name)).not.toThrow();
});

test("resetFlightToStart assigns every field the flight path assigns", () => {
	const written = assigned();

	// The premise. Without it a scan that found no methods, or a regex that
	// stopped matching, would pass by finding nothing to check — the failure mode
	// where a green run means the check has stopped running.
	expect(written.size).toBeGreaterThan(10);

	const restored = assignedFields(resetBody());
	expect(
		[...written].filter((f) => !NOT_RESET[f] && !restored.has(f)).sort(),
	).toEqual([]);
});

test("resetFlightToStart deals with every field the flight path mutates in place", () => {
	// The blocker this file was extended for. `step` turns the ship with
	// `this.orientation.multiply(turn)`, which the assignment scan cannot see —
	// so the reset shipped restoring position and velocity while leaving the nose
	// pointing wherever the previous leg finished, under a docblock claiming boot
	// state. A named field either appears in the reset or is exempt with a
	// reason; there is no third option.
	const fields = mutated();
	expect(fields.size).toBeGreaterThan(0);

	const body = resetBody();
	const handled = (f: string) =>
		NOT_RESET[f] ||
		body.includes(`this.${f}`) ||
		(RESTORED_BY[f] && body.includes(`this.${RESTORED_BY[f]}()`));
	expect([...fields].filter((f) => !handled(f)).sort()).toEqual([]);
});

test("every declared restorer is a real method the reset calls", () => {
	// Without this, `RESTORED_BY` is a way to silence the scan by naming a method
	// that does not exist or is never called — an exemption wearing a fix's
	// clothes.
	const body = resetBody();
	for (const [field, method] of Object.entries(RESTORED_BY)) {
		expect(() => methodBody(main, method)).not.toThrow();
		expect(body).toContain(`this.${method}()`);
		expect(mutated().has(field)).toBe(true);
	}
});

test("every exemption names a field the leg path actually writes", () => {
	// An exemption for a field nothing writes is dead weight that reads as
	// coverage: it makes the list look considered while guarding nothing. Either
	// mechanism counts — `audio` is mutated in place, `frames` is incremented.
	for (const field of Object.keys(NOT_RESET))
		expect(mutated().has(field) || assigned().has(field)).toBe(true);
});

test("resetFlightToStart hands the world half to sim.ts", () => {
	// The renderer must not restate the clock, the bodies or the arrival point:
	// `resetWorldToStart` owns those and `tests/world-reset.test.ts` is what
	// proves them right. A second spelling here is a second answer to where boot
	// state is.
	const body = resetBody();
	expect(body).toContain("resetWorldToStart(this.world)");
	expect(body).not.toContain("arrivalPoint");
	expect(body).not.toContain("gameTime =");
});

test("the scan reads code, and comments are not code", () => {
	// Twice reported as a hole — that `body.includes(\`this.${f}\`)` would be
	// satisfied by the reset's own comment quoting `this.orientation.multiply
	// (turn)`, and that the phrase "a scan looking for `this.x =`" would register
	// a phantom field. Neither happens: `main` is `codeOf(SUBJECT)`, which blanks
	// every comment before any scan runs. Pinned here so it stops being an open
	// question, and so a future scanner built on the raw file rather than on
	// `codeOf` goes red instead of quietly reading prose as code.
	const body = resetBody();
	expect(body).not.toContain("this.orientation");
	expect(body).not.toContain("multiply");
	expect(body).toContain("this.faceTheStar()");
});
