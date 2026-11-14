import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	orphanBrowserGroups,
	parseProcessTable,
	reapOrphanBrowsers,
	startBrowserWatchdog,
	unwatchedBrowserGroups,
} from "../scripts/lib/orphan-browsers.mjs";

const CHROME =
	"/Users/x/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PLAYWRIGHT_BROWSER = `${CHROME} --headless --user-data-dir=/var/folders/T/playwright_chromiumdev_profile-abc123 --remote-debugging-pipe --no-startup-window`;
const HELPER = `${CHROME} Helper (Renderer) --type=renderer --user-data-dir=/var/folders/T/playwright_chromiumdev_profile-abc123`;
const CRASHPAD = `${CHROME} Framework.framework/Helpers/chrome_crashpad_handler --monitor-self --database=/var/folders/T/playwright_chromiumdev_profile-abc123/Crashpad`;
const OWN_CHROME =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const table = [
	`  101     1   101 ${PLAYWRIGHT_BROWSER}`,
	`  102   101   101 ${HELPER}`,
	`  103     1   103 ${CRASHPAD}`,
	`  201   900   201 ${PLAYWRIGHT_BROWSER}`,
	`  301     1   301 ${OWN_CHROME}`,
	`  401     1   400 ${PLAYWRIGHT_BROWSER}`,
].join("\n");

describe("which browsers count as orphaned", () => {
	const rows = parseProcessTable(table);

	test("a Playwright browser whose launcher died is reaped by its group", () => {
		expect(orphanBrowserGroups(rows)).toContain(101);
	});

	test("a browser whose launcher is alive is left alone", () => {
		expect(orphanBrowserGroups(rows)).not.toContain(201);
	});

	test("crashpad, the principal's own Chrome, and a non-leader are left alone", () => {
		expect(orphanBrowserGroups(rows)).toEqual([101]);
	});

	test("a launcher sees only its own browsers, and only the new ones", () => {
		expect(unwatchedBrowserGroups(rows, 900, new Set())).toEqual([201]);
		expect(unwatchedBrowserGroups(rows, 900, new Set([201]))).toEqual([]);
	});
});

describe("reapOrphanBrowsers", () => {
	test("kills each orphaned group and reports it", () => {
		const killed: [number, string][] = [];
		const reaped = reapOrphanBrowsers({
			list: () => parseProcessTable(table),
			kill: (pid: number, signal: string) => killed.push([pid, signal]),
		});
		expect(reaped).toEqual([101]);
		expect(killed).toEqual([[-101, "SIGKILL"]]);
	});
});

const live: ChildProcess[] = [];
afterEach(() => {
	for (const child of live.splice(0)) {
		if (child.pid === undefined) continue;
		for (const target of [-child.pid, child.pid])
			try {
				process.kill(target, "SIGKILL");
			} catch (_err) {}
	}
});

function groupAlive(pgid: number) {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (_err) {
		return false;
	}
}

async function until(predicate: () => boolean, ms = 3_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await Bun.sleep(25);
	}
	return predicate();
}

function standInBrowser() {
	const browser = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
	live.push(browser);
	return browser.pid as number;
}

function standInLauncher() {
	const launcher = spawn("sleep", ["60"], { stdio: "ignore" });
	live.push(launcher);
	return launcher;
}

describe("the browser watchdog", () => {
	test("kills the browser's group once its launcher is SIGKILLed", async () => {
		const pgid = standInBrowser();
		const launcher = standInLauncher();
		live.push(
			startBrowserWatchdog({
				parentPid: launcher.pid as number,
				pgid,
				pollMs: 25,
			}),
		);
		expect(groupAlive(pgid)).toBe(true);
		launcher.kill("SIGKILL");
		expect(await until(() => !groupAlive(pgid))).toBe(true);
	});

	test("leaves the browser running while its launcher lives", async () => {
		const pgid = standInBrowser();
		const launcher = standInLauncher();
		live.push(
			startBrowserWatchdog({
				parentPid: launcher.pid as number,
				pgid,
				pollMs: 25,
			}),
		);
		await Bun.sleep(300);
		expect(groupAlive(pgid)).toBe(true);
	});

	test("exits on its own once the browser closes", async () => {
		const pgid = standInBrowser();
		const launcher = standInLauncher();
		const watchdog = startBrowserWatchdog({
			parentPid: launcher.pid as number,
			pgid,
			pollMs: 25,
		});
		live.push(watchdog);
		const exited = new Promise((done) => watchdog.once("exit", done));
		process.kill(-pgid, "SIGKILL");
		expect(
			await Promise.race([
				exited.then(() => true),
				Bun.sleep(3_000).then(() => false),
			]),
		).toBe(true);
	});
});
