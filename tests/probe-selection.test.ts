import { describe, expect, test } from "bun:test";
import { PROBE_CATALOG } from "../scripts/lib/probe-catalog.mjs";
import { discoverProbeFiles } from "../scripts/lib/probe-inventory.mjs";
import { parseArgs, resolveOnly } from "../scripts/lib/probe-args.mjs";
import {
	PROBE_EXCLUSION_MAX,
	selectProbes,
} from "../scripts/lib/probe-selection.mjs";
import {
	createTypeSafeProbeJudge,
	withoutTypeSafeCredential,
} from "../scripts/lib/typesafe-probe-judge.mjs";

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
				title: "Clarify and test docking arithmetic",
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
				title: "Tighten galaxy-map picking evidence",
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
			"vite.config.ts",
		]) {
			const result = await selectProbes({ changedFiles: [file], title: file });
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
				title: "Keep a cruise route clear of a moving host planet",
				body: "Change moving-body avoidance and arrival handoff.",
				diff: "+ sweep the moving host before advancing the cruise leg",
			},
			async ({ questions }) => ({
				answers: probabilities({
					probe_cruise: 0.99,
					probe_arrival: PROBE_EXCLUSION_MAX + 0.01,
				}),
				questionCount: Object.keys(questions).length,
			}),
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

	test("falls back to all probes when an answer is missing or malformed", async () => {
		for (const answers of [
			{},
			{ ...probabilities(), probe_cruise: { type: "choice", choice: "yes" } },
			{ ...probabilities(), probe_cruise: { type: "noul", noul: 2 } },
		]) {
			const result = await selectProbes(
				{ changedFiles: ["src/cruise.ts"], title: "Cruise" },
				async () => ({ answers }),
			);
			expect(result.mode).toBe("all");
			expect(result.fallback).toBe(true);
		}
	});

	test("falls back to all probes when TypeSafe is unavailable", async () => {
		const unavailable = await selectProbes({
			changedFiles: ["src/cruise.ts"],
			title: "Cruise",
		});
		expect(unavailable.mode).toBe("all");
		expect(unavailable.fallback).toBe(true);

		const failed = await selectProbes(
			{ changedFiles: ["src/cruise.ts"], title: "Cruise" },
			async () => {
				throw new Error("service unavailable");
			},
		);
		expect(failed.mode).toBe("all");
		expect(failed.reason).toContain("service unavailable");
	});

	test("refuses an empty semantic run for a production change", async () => {
		const result = await selectProbes(
			{ changedFiles: ["src/cruise.ts"], title: "Cruise" },
			async () => ({ answers: probabilities() }),
		);
		expect(result.mode).toBe("all");
		expect(result.fallback).toBe(true);
		expect(result.reason).toContain("empty semantic run");
	});
});

describe("the TypeSafe transport", () => {
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

		await judge({ state: { title: "safe" }, questions: {} });
		expect(authorization).toBe(`Bearer ${apiKey}`);
		expect(body).not.toContain(apiKey);
		expect(JSON.parse(body).model).toBe("jev-latest");
	});

	test("removes the credential before browser-probe children are spawned", () => {
		const parent = { TYPESAFE_API_KEY: "secret", KEEP_ME: "yes" };
		expect(withoutTypeSafeCredential(parent)).toEqual({ KEEP_ME: "yes" });
		expect(parent.TYPESAFE_API_KEY).toBe("secret");
	});
});
