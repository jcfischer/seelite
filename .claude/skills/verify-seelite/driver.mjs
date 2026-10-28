import { mkdir, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertServingThisTree,
	bootedGame,
	HARDWARE_CHANNEL,
	installViewPlacement,
	launchChromium,
} from "../../../scripts/probe-guard.mjs";
import { gameUrl } from "../../../scripts/lib/game-url.mjs";
import {
	assertBrowserRenderer,
	assertPlayersRenderer,
} from "../../../scripts/lib/players-renderer.mjs";
import {
	startLoop,
	stopLoop,
	setView,
	settleFrames,
} from "../../../scripts/lib/view-placement.mjs";
import {
	acquireProbeLock,
	defaultLockPath,
	notRunMessage,
} from "../../../scripts/lib/probe-lock.mjs";
import { origin, sessionDirectory, socketPath } from "./control-seelite.mjs";

async function locked(work) {
	const lock = await acquireProbeLock({
		path: defaultLockPath(),
		label: "control-seelite",
		waitMs: 0,
		log: console.error,
	});
	if (!lock.ok)
		return {
			ok: false,
			exitCode: 75,
			error: notRunMessage(lock.holder, lock.waitedMs, defaultLockPath()),
		};
	try {
		return await work();
	} finally {
		lock.release();
	}
}

export async function doctor() {
	const checks = {};
	try {
		await assertServingThisTree(origin);
		checks.server = { ok: true, origin };
	} catch (error) {
		return {
			ok: false,
			checks: {
				server: { ok: false, error: error.message },
				playwright: {
					ok: null,
					status: "not-checked",
					reason: "Server unavailable",
				},
				renderer: {
					ok: null,
					status: "not-checked",
					reason: "Server unavailable",
				},
			},
		};
	}
	return locked(async () => {
		let browser;
		const log = console.log;
		console.log = console.error;
		try {
			const mode = process.env.SEELITE_PROBE_RENDERER;
			try {
				process.env.SEELITE_PROBE_RENDERER = "hardware";
				browser = await launchChromium({ channel: HARDWARE_CHANNEL });
				checks.playwright = { ok: true };
			} catch (error) {
				checks.playwright = { ok: false, error: error.message };
			} finally {
				if (mode === undefined) delete process.env.SEELITE_PROBE_RENDERER;
				else process.env.SEELITE_PROBE_RENDERER = mode;
			}
			if (browser) {
				try {
					const page = await browser.newPage();
					checks.renderer = {
						ok: true,
						name: await assertBrowserRenderer(page, "control seelite"),
					};
				} catch (error) {
					checks.renderer = { ok: false, error: error.message };
				}
			} else
				checks.renderer = {
					ok: false,
					error: "Not checked: Playwright browser unavailable",
				};
			return { ok: Object.values(checks).every((check) => check.ok), checks };
		} finally {
			await browser?.close();
			console.log = log;
		}
	});
}

async function serve() {
	let browser;
	let page;
	let idle;
	let queue = Promise.resolve();
	let closing = false;
	console.log = console.error;
	process.env.SEELITE_PROBE_RENDERER = "hardware";
	const shutdown = async () => {
		if (closing) return;
		closing = true;
		clearTimeout(idle);
		await browser?.close();
		server.close();
		await unlink(socketPath).catch(() => {});
	};
	const resetIdle = () => {
		clearTimeout(idle);
		idle = setTimeout(
			() => {
				queue = queue.then(shutdown);
			},
			10 * 60 * 1000,
		);
	};
	const snapshot = () =>
		page.evaluate(() => {
			const g = window.__seelite;
			return {
				view: g.view,
				frames: g.frames,
				gameTime: g.world.gameTime,
				dockPhase: g.dockPhase,
				positionKm: { ...g.world.ship.pos },
				modelsSettled: g.modelsSettled(),
				nebulaPending: g.nebulaPending,
				bakeQueueLength: g.bakeQueue?.length ?? 0,
			};
		});
	const settle = async () => {
		await bootedGame(page, 60000);
		await page.waitForFunction(
			() =>
				window.__seelite.modelsSettled() &&
				(window.__seelite.bakeQueue?.length ?? 0) === 0,
			null,
			{ timeout: 60000 },
		);
		await settleFrames(page);
	};
	const handle = async ({ command, args }) => {
		resetIdle();
		if (command === "ping") return { ok: true, pid: process.pid, origin };
		if (command === "close") {
			await shutdown();
			return { ok: true, closed: true };
		}
		return locked(async () => {
			await assertServingThisTree(origin);
			if (!page) {
				if (command !== "goto")
					throw new Error("No game session. Run goto cockpit first.");
				try {
					browser = await launchChromium();
					const context = await browser.newContext({
						viewport: { width: 1440, height: 900 },
					});
					page = await context.newPage();
					page.on("pageerror", (error) =>
						console.error(`game page: ${error.message}`),
					);
					page.on("console", (message) => {
						if (message.type() === "error") console.error(message.text());
					});
					page.setDefaultTimeout(60000);
					await installViewPlacement(page);
					await page.goto(gameUrl(origin, { seed: 47, raider: "off" }), {
						waitUntil: "load",
						timeout: 60000,
					});
					await bootedGame(page, 60000);
				} catch (error) {
					page = undefined;
					await browser?.close();
					browser = undefined;
					throw error;
				}
			}
			await startLoop(page);
			try {
				const renderer = await assertPlayersRenderer(page, "control seelite");
				if (command === "goto") await setView(page, args[0]);
				else if (!["wait-settle", "screenshot", "snapshot"].includes(command))
					throw new Error(`Unknown driver command ${command}`);
				if (command !== "snapshot") await settle();
				if (command === "screenshot") {
					await mkdir(dirname(args[0]), { recursive: true });
					await page.screenshot({ path: args[0], type: "png" });
				}
				return {
					ok: true,
					command,
					origin,
					renderer,
					...(await snapshot()),
					...(command === "screenshot" ? { path: args[0] } : {}),
				};
			} finally {
				await stopLoop(page);
			}
		});
	};
	await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
	const server = createServer({ allowHalfOpen: true }, (socket) => {
		let input = "";
		socket.on("error", () => {});
		socket.on("data", (part) => {
			input += part;
			if (input.length > 65536) socket.destroy();
		});
		socket.on("end", () => {
			queue = queue.then(async () => {
				try {
					socket.end(`${JSON.stringify(await handle(JSON.parse(input)))}\n`);
				} catch (error) {
					socket.end(
						`${JSON.stringify({ ok: false, error: error.message })}\n`,
					);
				}
			});
		});
	});
	server.on("error", (error) => {
		console.error(error.message);
		process.exitCode = 1;
		clearTimeout(idle);
	});
	server.listen(socketPath);
	resetIdle();
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	serve().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
