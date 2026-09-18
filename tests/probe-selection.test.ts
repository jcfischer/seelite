import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { PROBE_CATALOG } from "../scripts/lib/probe-catalog.mjs";
import { discoverProbeFiles } from "../scripts/lib/probe-inventory.mjs";
import { parseArgs, resolveOnly } from "../scripts/lib/probe-args.mjs";
import {
	PROBE_EXCLUSION_MAX,
	selectProbes,
} from "../scripts/lib/probe-selection.mjs";
import { createTypeSafeProbeJudge } from "../scripts/lib/typesafe-probe-judge.mjs";
import { probeRunnerEnvironment } from "../scripts/lib/probe-runner-env.mjs";

const discovered = discoverProbeFiles(new URL("../scripts", import.meta.url));

const probabilities = (overrides: Record<string, number> = {}) =>
	Object.fromEntries(
		PROBE_CATALOG.map(({ id }) => [
			id,
			{ type: "noul", noul: overrides[id] ?? 0.01 },
		]),
	);

describe("the probe catalog", () => {
	test("describes every gating probe the runner discovers, exactly once", () => {
		expect(PROBE_CATALOG.map(({ file }) => file)).toEqual(discovered);
		expect(new Set(PROBE_CATALOG.map(({ id }) => id)).size).toBe(
			PROBE_CATALOG.length,
		);
		for (const entry of PROBE_CATALOG) {
			expect(entry.contract.length).toBeGreaterThan(24);
			expect(entry.evidence.length).toBeGreaterThan(0);
		}
	});

	test("hands the measurement-named cruise gate to the exact runner path", () => {
		const selection = resolveOnly(
			parseArgs([]),
			{ PROBE_FILES: "measure-cruise-detour.mjs" },
			discovered,
		);
		expect(selection).toMatchObject({
			probes: ["measure-cruise-detour.mjs"],
			source: "PROBE_FILES",
		});
	});
});

describe("the deterministic branches", () => {
	test("select no browser probes for docs and headless tests only", async () => {
		let called = false;
		const result = await selectProbes(
			{
				changedFiles: ["docs/specs/docking.md", "tests/docking.test.ts"],
			},
			async () => {
				called = true;
				return { answers: probabilities() };
			},
		);

		expect(result.mode).toBe("none");
		expect(result.probes).toEqual([]);
		expect(called).toBe(false);
	});

	test("selects a directly edited probe without calling TypeSafe", async () => {
		let called = false;
		const result = await selectProbes(
			{
				changedFiles: [
					"scripts/probe-galaxy-map.mjs",
					"tests/galaxy-route.test.ts",
				],
			},
			async () => {
				called = true;
				return { answers: probabilities() };
			},
		);

		expect(result.mode).toBe("exact");
		expect(result.probes).toEqual(["probe-galaxy-map.mjs"]);
		expect(called).toBe(false);
	});

	test("forces the full suite for shared runtime and harness changes", async () => {
		for (const file of [
			"src/main.ts",
			"scripts/probe-guard.mjs",
			"scripts/select-probes.mjs",
			"scripts/future-shared-harness.mjs",
			".github/workflows/deploy.yml",
			"vite.config.ts",
		]) {
			const result = await selectProbes({ changedFiles: [file] });
			expect(result.mode).toBe("all");
			expect(result.probes).toEqual(discovered);
			expect(result.reason).toContain(file);
		}
	});
});

describe("the semantic branch", () => {
	test("excludes only strong no judgments and keeps uncertainty", async () => {
		const result = await selectProbes(
			{
				changedFiles: ["src/cruise.ts"],
				intent: "Keep a cruise route clear of a moving host planet.",
			},
			async ({ questions, state }) => {
				expect(state).toEqual({
					reviewer_intent: "Keep a cruise route clear of a moving host planet.",
					untrusted_evidence: {
						changed_files: ["src/cruise.ts"],
					},
				});
				return {
					answers: probabilities({
						probe_cruise: 0.99,
						probe_arrival: PROBE_EXCLUSION_MAX + 0.01,
					}),
					questionCount: Object.keys(questions).length,
				};
			},
		);

		expect(result.mode).toBe("semantic");
		expect(result.probes).toEqual(["probe-arrival.mjs", "probe-cruise.mjs"]);
		expect(
			result.decisions?.find(
				(row: { id: string }) => row.id === "probe_arrival",
			),
		).toMatchObject({
			action: "include",
			probability: PROBE_EXCLUSION_MAX + 0.01,
		});
	});

	test("force-includes an edited probe in a mixed production change", async () => {
		const result = await selectProbes(
			{
				changedFiles: ["scripts/probe-cruise.mjs", "src/cruise.ts"],
			},
			async () => ({ answers: probabilities() }),
		);
		expect(result.mode).toBe("semantic");
		expect(result.probes).toEqual(["probe-cruise.mjs"]);
		expect(
			result.decisions?.find(
				(row: { id: string }) => row.id === "probe_cruise",
			),
		).toMatchObject({ action: "include", forced: true, probability: 0.01 });
	});

	test("falls back to all probes when an answer is missing or malformed", async () => {
		for (const answers of [
			{},
			{ ...probabilities(), probe_cruise: { type: "choice", choice: "yes" } },
			{ ...probabilities(), probe_cruise: { type: "noul", noul: 2 } },
		]) {
			const result = await selectProbes(
				{ changedFiles: ["src/cruise.ts"] },
				async () => ({ answers }),
			);
			expect(result.mode).toBe("all");
			expect(result.fallback).toBe(true);
		}
	});

	test("falls back to all probes when TypeSafe is unavailable", async () => {
		const unavailable = await selectProbes({
			changedFiles: ["src/cruise.ts"],
		});
		expect(unavailable.mode).toBe("all");
		expect(unavailable.probes).toEqual(discovered);
		expect(unavailable.fallback).toBe(true);

		const failed = await selectProbes(
			{ changedFiles: ["src/cruise.ts"] },
			async () => {
				throw new Error("service unavailable");
			},
		);
		expect(failed.mode).toBe("all");
		expect(failed.reason).toContain("service unavailable");
	});

	test("refuses an empty semantic run for a production change", async () => {
		const result = await selectProbes(
			{ changedFiles: ["src/cruise.ts"] },
			async () => ({ answers: probabilities() }),
		);
		expect(result.mode).toBe("all");
		expect(result.fallback).toBe(true);
		expect(result.reason).toContain("empty semantic run");
	});
});

describe("the TypeSafe transport", () => {
	test("the CLI fails loudly when its git range is invalid", () => {
		const child = spawnSync(
			process.execPath,
			[
				"scripts/select-probes.mjs",
				"--base",
				"definitely-not-a-ref",
				"--head",
				"HEAD",
			],
			{ encoding: "utf8" },
		);
		expect(child.status).toBe(1);
		expect(child.stderr).toContain(
			"could not read git diff definitely-not-a-ref...HEAD",
		);
		expect(child.stdout).not.toContain("probe selection:");
	});

	test("the evaluator refuses a missing key without a stack trace", () => {
		const { TYPESAFE_API_KEY: _key, ...env } = process.env;
		const child = spawnSync(
			process.execPath,
			["scripts/evaluate-probe-selection.mjs"],
			{ encoding: "utf8", env },
		);
		expect(child.status).toBe(1);
		expect(child.stderr.trim()).toBe(
			"TYPESAFE_API_KEY is not set; load it before running probe:evaluate.",
		);
	});

	test("the evaluator refuses a missing receipt path without a stack trace", () => {
		const child = spawnSync(
			process.execPath,
			["scripts/evaluate-probe-selection.mjs", "--receipt"],
			{ encoding: "utf8" },
		);
		expect(child.status).toBe(1);
		expect(child.stderr.trim()).toBe("--receipt requires an output path");
	});

	test("keeps the credential in the authorization header and out of the body", async () => {
		const apiKey = "test-key-that-must-not-enter-state";
		let authorization = "";
		let body = "";
		const judge = createTypeSafeProbeJudge({
			apiKey,
			fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
				authorization = new Headers(init?.headers).get("Authorization") ?? "";
				body = String(init?.body ?? "");
				return new Response(
					JSON.stringify({ model: "jev-test", answers: {}, usage: {} }),
					{ status: 200 },
				);
			},
		});

		await judge({ state: { changed_files: ["src/safe.ts"] }, questions: {} });
		expect(authorization).toBe(`Bearer ${apiKey}`);
		expect(body).not.toContain(apiKey);
		expect(JSON.parse(body).model).toBe("jev-latest");
	});

	test("keeps a bounded API error detail for fallback diagnosis", async () => {
		const judge = createTypeSafeProbeJudge({
			apiKey: "test-key",
			fetchImpl: async () =>
				new Response(`  rate limited\n${"x".repeat(240)}  `, { status: 429 }),
		});

		expect(judge({ state: {}, questions: {} })).rejects.toThrow(
			/^HTTP 429: rate limited x{187}$/,
		);
	});

	test("scrubs credentials and stale filters before browser children", () => {
		const parent = {
			TYPESAFE_API_KEY: "secret",
			PROBE_FILES: "probe-boot.mjs",
			PROBE_ONLY: "boot",
			KEEP_ME: "yes",
		};
		expect(probeRunnerEnvironment(parent)).toEqual({ KEEP_ME: "yes" });
		expect(probeRunnerEnvironment(parent, [])).toEqual({ KEEP_ME: "yes" });
		expect(probeRunnerEnvironment(parent, ["probe-cruise.mjs"])).toEqual({
			KEEP_ME: "yes",
			PROBE_FILES: "probe-cruise.mjs",
		});
		expect(parent.TYPESAFE_API_KEY).toBe("secret");
	});
});
