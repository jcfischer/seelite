/**
 * What kind of red a failed probe is (#84).
 *
 * `probe-all` used to report every failure the same way, so a navigation that
 * timed out on a starved machine read exactly like an assertion that caught a
 * regression. Those want different responses. Every probe reports through
 * `tally()`, which prints ` FAIL ` for a failed check, `PAGEERROR` /
 * `SHADERERROR` for a fault in the page, and always ends with
 * `N/M checks passed` — so a probe that exits without that tail did not finish.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { failureKind } from "../scripts/lib/probe-failure-kind.mjs";

const TAIL = "\n21/23 checks passed\n";

describe("failureKind", () => {
	test("a probe the harness killed is `killed`, whatever it printed", () => {
		const out = "  ok  boots\n[probe-all] killed after 600000ms\n";
		expect(failureKind({ code: "killed:SIGKILL", out })).toBe("killed");
	});

	test("a probe that exited before its tally tail is `crash`", () => {
		const out =
			"  ok  boots\n  ok  docks\nTimeoutError: page.reload: Timeout 30000ms exceeded\n";
		expect(failureKind({ code: 1, out })).toBe("crash");
	});

	test("a destroyed execution context after every check printed ok is `crash`", () => {
		const out =
			"  ok  a\n  ok  b\npage.evaluate: Execution context was destroyed, most likely because of a navigation\n";
		expect(failureKind({ code: 1, out })).toBe("crash");
	});

	test("a failed check with the tail is `assert`", () => {
		const out = `  ok  a\n FAIL  control — 1 − IoU = 0.130${TAIL}`;
		expect(failureKind({ code: 1, out })).toBe("assert");
	});

	test("a page error outranks the checks it took down with it", () => {
		const out = `PAGEERROR boom\n FAIL  reads a number${TAIL}`;
		expect(failureKind({ code: 1, out })).toBe("pageerror");
	});

	test("a page error that took the probe down before its tail is `pageerror`", () => {
		const out =
			"  ok  boots\nPAGEERROR boom\nTimeoutError: page.evaluate: Timeout 30000ms exceeded\n";
		expect(failureKind({ code: 1, out })).toBe("pageerror");
	});

	test("a shader that failed to link is `pageerror`", () => {
		const out = `SHADERERROR THREE.WebGLProgram: Shader Error${TAIL}`;
		expect(failureKind({ code: 1, out })).toBe("pageerror");
	});

	test("a line that only mentions FAIL mid-text is not a failed check", () => {
		const out = `  ok  the FAIL banner is hidden${TAIL}`;
		expect(failureKind({ code: 1, out })).toBe("exit");
	});

	test("a non-zero exit with a tail and no failure line is `exit`", () => {
		expect(failureKind({ code: 2, out: `  ok  a${TAIL}` })).toBe("exit");
	});
});

/**
 * The fixtures above are hand-written, so a rewording of `tally()` would leave
 * them green while every real red turned into `crash`. These read what the
 * real `tally()` prints, in a process of its own because `exit()` exits.
 */
describe("failureKind on what tally() really prints", () => {
	const GUARD = resolve(import.meta.dir, "../scripts/probe-guard.mjs");

	/** Run `body` against a real tally in a child; its exit code and output. */
	function tallyRun(body: string) {
		const code = `
			import { tally } from ${JSON.stringify(GUARD)};
			const t = tally();
			/** a page stand-in: \`watch\` only registers listeners on it */
			const handlers = {};
			const page = { on: (event, fn) => (handlers[event] = fn) };
			${body}
		`;
		const r = spawnSync("node", ["--input-type=module", "-e", code], {
			encoding: "utf8",
		});
		return { code: r.status ?? `killed:${r.signal}`, out: r.stdout + r.stderr };
	}

	test("a failed check reads `assert`", () => {
		const r = tallyRun(
			`t.check("holds", true); t.check("fails", false, "got 3"); t.exit();`,
		);
		expect(r.code).toBe(1);
		expect(failureKind(r)).toBe("assert");
	});

	test("a page error reads `pageerror`", () => {
		const r = tallyRun(
			`t.watch(page); handlers.pageerror(new Error("boom")); t.exit();`,
		);
		expect(r.code).toBe(1);
		expect(failureKind(r)).toBe("pageerror");
	});

	test("a throw before the tail reads `crash`", () => {
		const r = tallyRun(
			`t.check("holds", true); throw new Error("navigation timed out");`,
		);
		expect(r.code).toBe(1);
		expect(failureKind(r)).toBe("crash");
	});

	test("a clean run prints the tail the classifier looks for", () => {
		const r = tallyRun(`t.check("holds", true); t.exit();`);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^1\/1 checks passed$/m);
	});
});
