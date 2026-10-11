/**
 * Run every probe against one running server, and fail if any of them does.
 *
 * Vendored from seekolous (`scripts/probe-all.mjs`) with its lists emptied and
 * its examples re-pointed. The mechanism is unchanged, and so are the reasons —
 * which are why it was worth copying rather than rewriting.
 *
 * The probes are the test tier for anything rendered or spatial. There is a
 * unit tier beside them (`npm test`, over the modules that need no browser),
 * and the split is deliberate: arithmetic gets asserted headlessly and cheaply,
 * and anything that only means something in front of a running renderer gets a
 * browser. What a probe suite must not be is ungated — a set of scripts run by
 * hand cannot stop a regression reaching `main`. This runner is what CI invokes
 * so they can.
 *
 * ## Two conventions, and the seed
 *
 * There are two ways to tell a probe where the game is, and the difference is
 * load-bearing rather than cosmetic:
 *
 *   - some take a **base** as `argv[2]` and append their own `?seed=…`;
 *   - the rest take a **whole URL** in `PROBE_URL`, with a seed already in it.
 *
 * That second group chooses its seed deliberately, because a probe often wants
 * a world that *has* the thing it is looking for. So a runner that set
 * `PROBE_URL` to a bare origin would strip every one of those seeds and hand
 * each probe a random world — which in seekolous produced two probes "failing"
 * against worlds that simply had none of the thing they were looking for.
 *
 * So this sets `PROBE_ORIGIN`, which replaces the host and leaves the seed
 * alone, and passes the base as `argv[2]` for the first group. An inherited
 * `PROBE_URL` is deliberately dropped from the child environment for the same
 * reason.
 *
 * ## What "failed" means here
 *
 * A probe fails if it exits non-zero — which is the probes' own convention,
 * not one imposed on them — or if it runs past `TIMEOUT_MS`. A timeout is a
 * failure, never a skip: a probe that hung told you nothing, and treating that
 * as a pass is how a suite goes quietly green while the thing it watches
 * rots.
 *
 * ## Reporters
 *
 * A probe that asserts nothing by design goes in `REPORTERS`. It still runs —
 * its numbers are the point — but its exit code does not gate. That is named in
 * the summary rather than left implicit, because a suite that silently drops a
 * member reads as covering more than it does. The set is empty today.
 *
 * ## The server
 *
 * With no URL given, this starts a **dev** server on an ephemeral port and
 * shuts it down afterwards — so `npm run probe` is one command with no port to
 * coordinate and no orphan left behind if a probe dies. Pass a URL to probe
 * something already running and it starts nothing.
 *
 * A dev server rather than a preview of `dist/`, and not by preference: the
 * probes are written against `npm run dev`, and `probe-guard` fetches the
 * TypeScript source by path to check the server is serving this checkout. A
 * production build serves no such path, so probing `dist/` fails on the harness
 * rather than on the game.
 *
 * Usage:
 *   npm run probe                                      # serve, probe
 *   node scripts/probe-all.mjs http://localhost:5173   # probe a running one
 *
 * `PROBE_FILES` is an internal exact-name handoff from `select-probes.mjs`.
 * Like `--only`, it is a visibly partial local run and is refused in CI.
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "vite";
import { freePort } from "./lib/free-port.mjs";
import { parseArgs, resolveOnly } from "./lib/probe-args.mjs";
import { failureKind, killedCode } from "./lib/probe-failure-kind.mjs";
import {
	loadSuffix,
	slowestLine,
	slowRunNote,
	SUITE_PID_ENV,
} from "./lib/probe-contention.mjs";
import { loadSampler } from "./lib/probe-load.mjs";
import { holdProbeLockOrExit, stopChildren } from "./lib/probe-lock.mjs";
import { discoverProbeFiles } from "./lib/probe-inventory.mjs";
import {
	HARDWARE_RENDERER,
	launchChromium,
	probeRendererMode,
} from "./probe-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));

/** An explicitly named target, or null to start a server ourselves. */
const GIVEN = args.target ?? process.env.PROBE_URL ?? null;

/**
 * Probes that report rather than assert. Their exit code is not a verdict, so
 * it does not gate — but they run, because their numbers are why they exist.
 */
const REPORTERS = new Set([
	// Empty, and that is the right starting state rather than an oversight: a
	// probe belongs here only once someone has argued that its numbers are worth
	// having and its verdict is not. Seelite has made that argument about
	// nothing yet.
]);

/**
 * Probes that fail on `main` today, with the issue that owns each.
 *
 * They still **run**, and their output is still printed in full — what they do
 * not do is gate. The alternative was to gate on them and have every pull
 * request open red, which trains everyone to ignore the check and is how a
 * suite stops meaning anything.
 *
 * A quarantine is a debt, so it is written where it cannot be lost: named in
 * the summary of every run with its issue, rather than commented out or
 * silently skipped. Removing an entry is the last step of fixing the thing.
 */
const QUARANTINED = new Map([
	// Empty. A quarantine is a debt, and starting a repo with one would be
	// borrowing against work that has not happened.
]);

/**
 * How long any one probe may take.
 *
 * Ten minutes, which looks absurd next to a suite that currently runs in
 * seconds — and seekolous's first CI run is why it is that high. A GitHub
 * runner has no GPU, so Chromium rasterises in software and every probe that
 * renders is several times slower: a probe that took 77s locally was still
 * running when a 240s cap killed it. A probe cut off for being slow reports as
 * a failure, and a false red is worse than a slow job.
 *
 * The job's own `timeout-minutes` is the real backstop against a wedged run;
 * this one exists so a single stuck probe cannot eat that whole budget and
 * take the rest of the suite's results down with it.
 */
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 600_000);

/**
 * How many probes run at once. **One**, and the default is not timidity —
 * it was measured.
 *
 * The measurement is seekolous's and it carries: probes that assert on
 * *rendered pixels* over a pumped clock collapse when two browsers share a
 * machine. One of its probes failed reproducibly on a 1.64px gap that reads
 * ~30px when it has the machine to itself.
 *
 * That is not flakiness to be retried around: those probes are measuring
 * frames, and starving the renderer changes the thing being measured. A green
 * suite that got there by not looking properly is worth less than a slow one.
 * The cost is wall-clock, and CI has it.
 */
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 1);

// Which probes to run: everything here, or the subset `resolveOnly` selects.
// `probe-inventory.mjs` owns exclusions such as this runner and `probe-guard`,
// plus measurement-named gates that deliberately lack the `probe-` prefix. The
// catalog-parity test calls this same function, so its inventory cannot drift.
const allProbes = discoverProbeFiles(HERE);

/** A probe whose exit code is a verdict — not a reporter, not quarantined. */
const gates = (file) => !REPORTERS.has(file) && !QUARANTINED.has(file);

const selection = resolveOnly(args, process.env, allProbes, gates);
if (selection.refusal) {
	console.error(selection.refusal);
	process.exit(2);
}
const ONLY = selection.only;
/** Which of `--only` / `PROBE_ONLY` asked for the filter, for the banners. */
const ONLY_SOURCE = selection.source ?? "--only";
const probes = selection.probes;

if (!probes.length) {
	console.error("no probes found next to this script");
	process.exit(1);
}

// One suite on this machine at a time, taken before anything boots a browser:
// two suites starve each other into reds that read like defects (#84). A
// second run waits, and a wait that runs out exits 75 with NOT RUN, not 1.
/** The probes running now, so a signal can stop them before the lock goes. */
const live = new Set();
/**
 * Set by a signal before the running probes are stopped, so no worker starts
 * another one in the grace period: with `PROBE_CONCURRENCY` above one, a
 * probe that closes during it would otherwise hand its worker the next file,
 * and that probe would outlive the lock.
 */
let stopping = false;
await holdProbeLockOrExit(
	`probe-all, ${probes.length} probe${probes.length === 1 ? "" : "s"}`,
	{
		stopFirst: () => {
			stopping = true;
			return stopChildren(live);
		},
	},
);

/**
 * The machine's load through the run, reported beside every red and in the
 * summary rather than gated on (#84): load from outside the suite — a sage
 * review, a test run, another session's dev server — is not something the lock
 * can see, and no threshold for refusing has been measured.
 */
const load = loadSampler();

// Fail before starting a dev server or any probe if the opt-in local lane cannot
// actually reach a player renderer. Each child verifies again in launchChromium.
if (probeRendererMode() === HARDWARE_RENDERER) {
	console.log("checking hardware renderer for GPU probe lane");
	const browser = await launchChromium();
	await browser.close();
}

/** Run one probe to completion. Never rejects — the verdict is the value. */
function run(file) {
	return new Promise((resolve) => {
		const started = Date.now();
		// PROBE_URL is removed, not overwritten: leaving one inherited from the
		// caller would replace each probe's whole URL and take its seed with it
		const env = { ...process.env, PROBE_ORIGIN: BASE };
		delete env.PROBE_URL;
		// This child is *inside* the run that holds the probe lock, and the guard
		// cannot tell that from its own pid — which differs every time — so the
		// suite says so. Without it a suite would print the #882 notice a hundred
		// times about itself.
		env[SUITE_PID_ENV] = String(process.pid);
		const child = spawn(process.execPath, [join(HERE, file), BASE], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		live.add(child);
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));

		const timer = setTimeout(() => {
			// SIGKILL rather than SIGTERM: a wedged probe is usually wedged
			// inside a browser it is no longer talking to, and a polite signal
			// there buys another wait rather than an answer
			child.kill("SIGKILL");
			out += `\n[probe-all] killed after ${TIMEOUT_MS}ms\n`;
		}, TIMEOUT_MS);

		child.on("close", (code, signal) => {
			clearTimeout(timer);
			live.delete(child);
			// a killed probe has a null exit code; that is a failure with a
			// name, not an absent result
			const exit = code ?? killedCode(signal);
			resolve({
				file,
				ok: code === 0,
				code: exit,
				kind: code === 0 ? null : failureKind({ code: exit, out }),
				started,
				ms: Date.now() - started,
				out,
			});
		});
	});
}

/** Run the list `CONCURRENCY` at a time, in order, reporting as each lands. */
async function runAll(files) {
	const queue = [...files];
	const results = [];
	const worker = async () => {
		for (;;) {
			if (stopping) return;
			const file = queue.shift();
			if (!file) return;
			const r = await run(file);
			results.push(r);
			const gating = !REPORTERS.has(file) && !QUARANTINED.has(file);
			const mark = r.ok ? "ok  " : gating ? "FAIL" : "warn";
			// A **green** over a minute prints its load too: slow seconds under load
			// are the machine's, and nothing said so before, which is how a starved
			// suite came to read as a slow one (#882). Both branches print through the
			// same function, so a line either names the load or says there was no
			// reading — it never means both things at once (sage round 1).
			const peak = load.peakBetween(r.started, r.started + r.ms);
			const why = r.ok
				? slowRunNote({ ms: r.ms, peak })
				: ` exit=${r.code} ${r.kind}${loadSuffix(peak)}`;
			console.log(`${mark} ${file} (${(r.ms / 1000).toFixed(1)}s)${why}`);
			if (!r.ok) {
				// the failing probe's own output, indented — the whole point of a
				// gate is that it says what broke without a second run
				console.log(
					r.out
						.trimEnd()
						.split("\n")
						.map((l) => `     │ ${l}`)
						.join("\n"),
				);
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()),
	);
	return results;
}

/** Start a dev server on a free port, or use the target we were handed. See
 *  the note above on why dev rather than a preview of `dist/`. */
async function serve() {
	if (GIVEN) return { url: GIVEN, close: async () => {} };
	const server = await createServer({
		// `open: false` explicitly, not by relying on the default: this call loads
		// `vite.config.ts`, so whatever that says about opening a browser applies
		// here too. It said `true` for a while, and a suite that launches its own
		// Chromium thirty times over was also opening a tab.
		server: {
			port: await freePort(),
			strictPort: true,
			host: "127.0.0.1",
			open: false,
		},
		logLevel: "warn",
	});
	await server.listen();
	const url = server.resolvedUrls?.local?.[0];
	if (!url) {
		await server.close();
		throw new Error("vite dev server started but reported no local URL");
	}
	// no trailing slash: the probes append their own `/?seed=…`
	return { url: url.replace(/\/$/, ""), close: () => server.close() };
}

/** How many probes the filter left out, and of how many. */
const skippedCount = () =>
	`${ONLY_SOURCE} ${ONLY}: ${allProbes.length - probes.length} of ${allProbes.length} probes were not run.`;

/** The opening banner's partial-run line, or nothing. */
const partialHeader = () =>
	ONLY ? `\n     filtered by ${skippedCount()}` : "";

/** The closing summary's, which has to say what the exit code cannot. */
const partialSummary = () =>
	ONLY
		? ` — PARTIAL RUN, ${skippedCount()}` +
			`\n     This is not a pass for the suite. Run \`npm run probe\` for that.`
		: "";

const server = await serve();
const BASE = server.url;
console.log(
	`probing ${BASE}${GIVEN ? "" : " (dev server)"} — ${probes.length} probes, ${CONCURRENCY} at a time` +
		partialHeader() +
		"\n",
);
const started = Date.now();
let results;
try {
	results = await runAll(probes);
} finally {
	// closed even when a probe throws, so a failed run leaves no server behind
	await server.close();
	load.stop();
}

const gating = results.filter(
	(r) => !REPORTERS.has(r.file) && !QUARANTINED.has(r.file),
);
const failed = gating.filter((r) => !r.ok);

console.log(
	`\n${gating.length - failed.length}/${gating.length} gating probes passed in ${((Date.now() - started) / 1000).toFixed(0)}s` +
		`${loadSuffix(load.peak())} on ${availableParallelism()} cores` +
		partialSummary(),
);
// Where the wall clock went. A suite prints its probes in file order, which is
// alphabetical and answers nothing, and the seconds that matter are two or three
// files out of a hundred (#882). Skipped for a run of one, where it would repeat
// the line above it.
if (results.length > 1) console.log(`     ${slowestLine(results)}`);
if (failed.length) {
	/** @type {Map<string, number>} */
	const kinds = new Map();
	for (const r of failed) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
	console.log(
		`     failed by kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(" · ")}` +
			" (scripts/lib/probe-failure-kind.mjs says what each means)",
	);
}

// A filter selecting nothing that gates is refused up in `resolveOnly`, before
// a browser is booted — a check that fired here instead would have printed
// `0/0 gating probes passed` first and spent the run to say it.
// Say what did not gate, and why. A suite that quietly drops a member reads as
// covering more than it does, so every non-gating probe is named on every run
// — including the quarantined ones that passed, because a quarantine nobody is
// reminded of is a quarantine nobody lifts.
for (const r of results) {
	if (REPORTERS.has(r.file))
		console.log(
			`     ${r.file} reports rather than asserts — exit ${r.code} does not gate`,
		);
	else if (QUARANTINED.has(r.file))
		console.log(
			`     ${r.file} is quarantined (${QUARANTINED.get(r.file)}) — ${r.ok ? "it PASSED, so the entry may be ready to lift" : "still failing"}, and does not gate`,
		);
}
if (failed.length) {
	console.log(`FAILED: ${failed.map((r) => r.file).join(" · ")}`);
	process.exit(1);
}
