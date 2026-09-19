/**
 * How `probe-all` reads its arguments.
 *
 * This is the file the rest of the tier's argument was always going to point at:
 * deciding whether a run is the whole suite or one probe of it is browser-free
 * logic, and it was checked by hand for several rounds while getting a series of
 * wrong answers — `--only=x` running everything, a bare `--only` running
 * everything, a flag read as a pattern, a pattern read as a server address. Each
 * of those is a line here.
 *
 * The costly failure is always the same shape: a filtered run that looks like a
 * full one. A wrong refusal wastes a minute; a wrong pass ships.
 */
import { expect, test, describe } from "bun:test";
import { parseArgs, resolveOnly } from "../scripts/lib/probe-args.mjs";

const ALL = ["probe-alpha.mjs", "probe-beta.mjs", "probe-cost.mjs"];
/** `probe-cost` stands in for the report-only probes, whose exit is not a verdict. */
const gates = (f: string) => f !== "probe-cost.mjs";
const resolve = (argv: string[], env: Record<string, string> = {}) =>
	resolveOnly(parseArgs(argv), env, ALL, gates);

/**
 * The selection, having asserted this run was not refused.
 *
 * The cast states what the throw above it has just established. `resolveOnly`
 * returns a union — a refusal carries no `probes` — and the narrowing does not
 * survive the function boundary in JSDoc-typed JS, so it is restated here rather
 * than every call site guarding again.
 */
type Selected = { only: string | null; probes: string[] };
const selected = (
	argv: string[],
	env: Record<string, string> = {},
): Selected => {
	const r = resolve(argv, env);
	if (r.refusal)
		throw new Error(`expected a selection, got a refusal: ${r.refusal}`);
	return r as unknown as Selected;
};

describe("parseArgs", () => {
	test("takes the first bare token as the target", () => {
		expect(parseArgs(["http://localhost:5173"]).target).toBe(
			"http://localhost:5173",
		);
	});

	test("accepts both spellings of the filter", () => {
		expect(parseArgs(["--only", "alpha"]).only).toBe("alpha");
		expect(parseArgs(["--only=alpha"]).only).toBe("alpha");
	});

	test("does not mistake the filter for the target", () => {
		// `argv[2]` used to be the target flat, so `--only alpha` was read as a
		// server address and every probe spent its timeout failing to reach it.
		const a = parseArgs(["--only", "alpha"]);
		expect(a.target).toBeNull();
		expect(a.only).toBe("alpha");
	});

	test("does not mistake a flag for the filter's pattern", () => {
		const a = parseArgs(["--only", "--open"]);
		expect(a.onlySeen).toBe(true);
		expect(a.only).toBeNull();
	});

	test("does not mistake a dash-led token for the target", () => {
		// `--only alpha -5` made `-5` the origin, so the runner skipped starting a
		// server and pointed every probe at a host called `-5`.
		expect(parseArgs(["--only", "alpha", "-5"]).target).toBeNull();
	});

	test("distinguishes a filter given without a pattern from no filter at all", () => {
		// The collision that let a bare `--only` run the whole suite.
		expect(parseArgs([]).onlySeen).toBe(false);
		expect(parseArgs(["--only"]).onlySeen).toBe(true);
		expect(parseArgs(["--only"]).only).toBeNull();
	});

	test("keeps a second bare token instead of swallowing it", () => {
		expect(parseArgs(["http://a", "http://b"]).extra).toBe("http://b");
	});

	test("takes a target and a filter together", () => {
		const a = parseArgs(["http://localhost:5173", "--only", "alpha"]);
		expect(a.target).toBe("http://localhost:5173");
		expect(a.only).toBe("alpha");
	});
});

describe("resolveOnly", () => {
	test("no filter runs everything", () => {
		const r = selected([]);
		expect(r.only).toBeNull();
		expect(r.probes).toEqual(ALL);
	});

	test("a filter selects its matches", () => {
		expect(selected(["--only", "alpha"]).probes).toEqual(["probe-alpha.mjs"]);
		expect(selected(["--only=alpha"]).probes).toEqual(["probe-alpha.mjs"]);
	});

	test("refuses a filter with no pattern rather than running everything", () => {
		// The expensive wrong answer: `npm run probe:one` with the name forgotten
		// must not become the full suite.
		expect(resolve(["--only"]).refusal).toBeTruthy();
		expect(resolve(["--only="]).refusal).toBeTruthy();
		expect(resolve(["--only", "   "]).refusal).toBeTruthy();
		expect(resolve(["--only", "--open"]).refusal).toBeTruthy();
	});

	test("refuses an extra positional rather than treating it as the target", () => {
		expect(resolve(["http://a", "http://b"]).refusal).toMatch(
			/unexpected argument/,
		);
	});

	test("refuses a pattern that matches nothing, and names the options", () => {
		const r = resolve(["--only", "nonesuch"]);
		expect(r.refusal).toContain("matched none of");
		expect(r.refusal).toContain("probe-alpha.mjs");
	});

	test("refuses a filter that selects nothing which gates", () => {
		// `0/0 gating probes passed` and an exit of 0 is a yes to any question.
		expect(resolve(["--only", "cost"]).refusal).toMatch(
			/report-only or quarantined/,
		);
	});

	describe("the environment", () => {
		const selectedEnv = (files: string) => ({
			PROBE_SELECTION: "1",
			PROBE_FILES: files,
		});

		test("PROBE_FILES selects several exact gates in runner order", () => {
			expect(
				selected([], selectedEnv("probe-beta.mjs,probe-alpha.mjs")),
			).toMatchObject({
				only: "probe-alpha.mjs,probe-beta.mjs",
				probes: ["probe-alpha.mjs", "probe-beta.mjs"],
			});
		});

		test("PROBE_FILES refuses unknown, empty, or conflicting selections", () => {
			expect(resolve([], selectedEnv("probe-missing.mjs")).refusal).toMatch(
				/not available/,
			);
			expect(resolve([], selectedEnv(",")).refusal).toMatch(/no probe names/);
			expect(
				resolve(["--only", "alpha"], selectedEnv("probe-beta.mjs")).refusal,
			).toMatch(/cannot be combined/);
		});

		test("PROBE_FILES gets the same CI refusal as --only", () => {
			expect(
				resolve([], {
					CI: "true",
					...selectedEnv("probe-alpha.mjs"),
				}).refusal,
			).toContain("CI");
		});

		test("ambient PROBE_FILES cannot narrow a plain full-suite run", () => {
			expect(selected([], { PROBE_FILES: "probe-alpha.mjs" }).probes).toEqual(
				ALL,
			);
			expect(resolve([], { PROBE_SELECTION: "1" }).refusal).toContain(
				"requires PROBE_FILES",
			);
		});

		test("PROBE_ONLY filters when no flag is given", () => {
			expect(selected([], { PROBE_ONLY: "alpha" }).probes).toEqual([
				"probe-alpha.mjs",
			]);
		});

		test("an empty PROBE_ONLY is unset, as every shell means it", () => {
			expect(selected([], { PROBE_ONLY: "" }).probes).toEqual(ALL);
		});

		test("argv wins, and a bare --only is an error even with PROBE_ONLY set", () => {
			// The caller asked for a filter in this invocation and did not say which.
			expect(resolve(["--only"], { PROBE_ONLY: "alpha" }).refusal).toBeTruthy();
		});

		test("PROBE_ONLY gets argv's rejection of flag-shaped patterns", () => {
			const r = resolve([], { PROBE_ONLY: "-5" });
			expect(r.refusal).toContain("PROBE_ONLY");
			expect(r.refusal).toContain("looks like a flag");
		});
	});

	describe("CI", () => {
		test("refuses a filtered run, where the exit code is the whole message", () => {
			expect(resolve(["--only", "alpha"], { CI: "true" }).refusal).toContain(
				"CI",
			);
			expect(resolve(["--only", "alpha"], { CI: "1" }).refusal).toContain("CI");
		});

		test("does not refuse someone who said they are not in CI", () => {
			// Runners and shells export the string "false"; a truthiness test read
			// that as CI and refused the person who had explicitly said otherwise.
			expect(
				resolve(["--only", "alpha"], { CI: "false" }).refusal,
			).toBeUndefined();
			expect(resolve(["--only", "alpha"], { CI: "0" }).refusal).toBeUndefined();
			expect(resolve(["--only", "alpha"], { CI: "" }).refusal).toBeUndefined();
		});

		test("leaves an unfiltered CI run alone", () => {
			expect(selected([], { CI: "true" }).probes).toEqual(ALL);
		});
	});
});

describe("the target", () => {
	test("a URL is a target", () => {
		expect(selected(["http://localhost:5173"]).probes).toEqual(ALL);
	});

	test("a bare word is not — it is a pattern that wandered", () => {
		// `--only=granary birds` had exactly one bare token, so `birds` became the
		// origin and every probe was pointed at a host by that name. Catching a
		// *second* positional did not cover it; requiring the first to look like a
		// URL does.
		expect(resolve(["--only=alpha", "beta"]).refusal).toMatch(
			/is not a target/,
		);
		expect(resolve(["beta"]).refusal).toMatch(/is not a target/);
	});
});
