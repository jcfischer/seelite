import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const LAUNCHD_PID = 1;
const PIPE_FLAG = "--remote-debugging-pipe";
const PLAYWRIGHT_PROFILE = "playwright_chromiumdev_profile-";
const WATCHDOG_ENTRY = fileURLToPath(
	new URL("./browser-watchdog.mjs", import.meta.url),
);
export const WATCHDOG_POLL_MS = 1_000;

/**
 * @typedef {{ pid: number, ppid: number, pgid: number, command: string }} ProcessRow
 */

/**
 * A Chromium that Playwright launched and whose launcher has since died.
 *
 * Playwright spawns the browser `detached`, in its own process group, so a
 * signal to the probe's group never reaches it and a SIGKILLed probe leaves it
 * running under launchd. This module finds such a browser by its process
 * group and stops it: `startBrowserWatchdog` at launch, `reapOrphanBrowsers`
 * before a suite. The rows come from `ps -o pid=,ppid=,pgid=,command=`.
 *
 * @param {string} text
 */
export function parseProcessTable(text) {
	return text.split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		if (!match) return [];
		return [
			{
				pid: Number(match[1]),
				ppid: Number(match[2]),
				pgid: Number(match[3]),
				command: match[4],
			},
		];
	});
}

/** @returns {ProcessRow[]} */
export function readProcessTable() {
	return parseProcessTable(
		execFileSync("ps", ["-axww", "-o", "pid=,ppid=,pgid=,command="], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		}),
	);
}

/** @param {ProcessRow} row */
export function isPlaywrightBrowserLeader(row) {
	return (
		row.pid === row.pgid &&
		row.command.includes(PIPE_FLAG) &&
		row.command.includes(PLAYWRIGHT_PROFILE)
	);
}

/** @param {ProcessRow[]} rows */
export function orphanBrowserGroups(rows) {
	return rows
		.filter((row) => row.ppid === LAUNCHD_PID && isPlaywrightBrowserLeader(row))
		.map((row) => row.pgid);
}

/**
 * @param {ProcessRow[]} rows
 * @param {number} launcherPid
 * @param {Set<number>} watched
 */
export function unwatchedBrowserGroups(rows, launcherPid, watched) {
	return rows
		.filter(
			(row) =>
				row.ppid === launcherPid &&
				isPlaywrightBrowserLeader(row) &&
				!watched.has(row.pgid),
		)
		.map((row) => row.pgid);
}

/**
 * SIGKILL every orphaned Playwright browser group; returns the groups killed.
 *
 * @param {{ list?: () => ProcessRow[], kill?: (pid: number, signal: string) => unknown }} [io]
 */
export function reapOrphanBrowsers({
	list = readProcessTable,
	kill = process.kill,
} = {}) {
	const reaped = [];
	for (const pgid of orphanBrowserGroups(list())) {
		try {
			kill(-pgid, "SIGKILL");
			reaped.push(pgid);
		} catch (error) {
			process.stderr.write(
				`[probe] could not reap orphaned browser group ${pgid}: ${error}\n`,
			);
		}
	}
	return reaped;
}

/**
 * Start a detached process that SIGKILLs browser group `pgid` once `parentPid`
 * dies, and exits by itself once the group is gone.
 *
 * @param {{ parentPid: number, pgid: number, pollMs?: number }} target
 */
export function startBrowserWatchdog({
	parentPid,
	pgid,
	pollMs = WATCHDOG_POLL_MS,
}) {
	const watchdog = spawn(
		process.execPath,
		[WATCHDOG_ENTRY, String(parentPid), String(pgid), String(pollMs)],
		{ detached: true, stdio: "ignore" },
	);
	watchdog.unref();
	return watchdog;
}

const watchedByThisProcess = new Set();

/**
 * Give every browser this process launched and has not yet covered its own
 * watchdog. Called right after a launch.
 */
export function watchLaunchedBrowsers() {
	let rows;
	try {
		rows = readProcessTable();
	} catch (error) {
		process.stderr.write(
			`[probe] no browser watchdog — the process table was unreadable: ${error}\n`,
		);
		return [];
	}
	const groups = unwatchedBrowserGroups(
		rows,
		process.pid,
		watchedByThisProcess,
	);
	for (const pgid of groups) {
		watchedByThisProcess.add(pgid);
		startBrowserWatchdog({ parentPid: process.pid, pgid });
	}
	return groups;
}
