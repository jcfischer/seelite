/** How a probe run can be watched: `scripts/lib/probe-output.mjs` (F14). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineSplitter, teeConsole } from "../scripts/lib/probe-output.mjs";

describe("watching a run", () => {
	test("a child's output reaches the reader one whole line at a time", () => {
		const lines: string[] = [];
		const split = lineSplitter((l) => lines.push(l));
		split.push("one\ntw");
		expect(lines).toEqual(["one"]);
		split.push("o\nthree");
		expect(lines).toEqual(["one", "two"]);
		split.flush();
		split.flush();
		expect(lines).toEqual(["one", "two", "three"]);
	});
	test("the log gets every console line as it is printed", () => {
		const dir = mkdtempSync(join(tmpdir(), "probe-log-"));
		const path = join(dir, "run.log");
		const sink = {
			log: (..._: unknown[]) => {},
			error: (..._: unknown[]) => {},
		};
		teeConsole(path, sink);
		sink.log("probing %s", "x");
		expect(readFileSync(path, "utf8")).toBe("probing x\n");
		sink.error("FAIL", 2);
		expect(readFileSync(path, "utf8")).toBe("probing x\nFAIL 2\n");
		rmSync(dir, { recursive: true });
	});
});
