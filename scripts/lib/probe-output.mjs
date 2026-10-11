/**
 * How a probe run can be watched while it runs (F14, the 2026-10-11 retro).
 *
 * A passing probe printed nothing, so a slow green looked exactly like a hung
 * one. And a run started in the background through npm showed nothing until it
 * exited: the agent harness holds npm's output, so the log a session tailed
 * stayed empty for half an hour. `--show-output` streams each probe's own lines
 * as they arrive; `--log <path>` writes every runner line to a file at the
 * moment it is printed, whatever buffers the runner's stdout.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { format } from "node:util";

/**
 * Hands `emit` whole lines from a stream of chunks; `flush` sends the rest.
 * @param {(line: string) => void} emit
 */
export function lineSplitter(emit) {
	let partial = "";
	return {
		/** @param {string} chunk */
		push(chunk) {
			const lines = (partial + chunk).split("\n");
			partial = lines.pop() ?? "";
			for (const line of lines) emit(line);
		},
		flush() {
			if (partial) emit(partial);
			partial = "";
		},
	};
}

/**
 * Starts `path` empty and appends every `log` and `error` line of `sink`.
 * @param {string} path
 * @param {Pick<Console, "log" | "error">} [sink]
 */
export function teeConsole(path, sink = console) {
	writeFileSync(path, "");
	for (const name of ["log", "error"]) {
		const print = sink[name].bind(sink);
		sink[name] = (...args) => {
			print(...args);
			appendFileSync(path, `${format(...args)}\n`);
		};
	}
}
