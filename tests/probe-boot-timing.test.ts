import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	bootTimings,
	bootTimingReceipt,
	instrumentGuard,
} from "../scripts/lib/probe-boot-timing.mjs";

test("receipts refuse non-finite durations, negative spans and double counting", () => {
	for (const [total, seconds] of [
		[NaN, 1],
		[10, NaN],
		[10, -1],
		[10, 11],
	])
		expect(() => bootTimingReceipt("fixture", total, [{ seconds }])).toThrow();
	expect(
		bootTimingReceipt("fixture", 10, [{ seconds: 2 }, { seconds: 3 }]),
	).toMatchObject({
		bootSeconds: 5,
		totalSeconds: 10,
		boots: 2,
	});
});

test("boot time spans navigation and readiness, excluding flight between boots", async () => {
	let clock = 0;
	const timing = bootTimings(() => clock);
	const page = {
		on: () => {},
		context: () => ({ on: () => {} }),
		close: async () => {},
		goto: async () => {
			clock += 7000;
		},
		waitForEvent: async (_event: string) => {},
		url: () => "http://fixture/",
	};
	const browser = timing.observe({ newPage: async () => page });
	await browser.newPage();
	await page.goto();
	await timing.ready(async () => {
		clock += 3000;
	}, page);
	clock += 90000;
	await page.waitForEvent("load");
	await timing.ready(async () => {
		clock += 2000;
	}, page);
	expect(timing.rows.map((r: { seconds: number }) => r.seconds)).toEqual([
		10, 2,
	]);
	expect(
		timing.rows.reduce(
			(sum: number, r: { seconds: number }) => sum + r.seconds,
			0,
		),
	).toBe(12);
});

test("a failed readiness is propagated and cannot become a successful boot", async () => {
	const timing = bootTimings(() => 0);
	await expect(
		timing.ready(async () => {
			throw new Error("not ready");
		}, {}),
	).rejects.toThrow("not ready");
	expect(timing.rows).toEqual([]);
});

test("instrumentation refuses an unrecognised guard", () => {
	expect(() => instrumentGuard("export function other() {}")).toThrow("guard");
	const source = instrumentGuard(
		"export async function launchChromium() {}\nexport async function bootedGame() {}",
	);
	expect(source).toContain("originalLaunchChromium");
	expect(source).toContain("originalBootedGame");
});

test("an unawaited workbench return is timed from commit until close", async () => {
	let clock = 0;
	let url = "about:blank";
	const frame = { url: () => url };
	const context = new EventEmitter();
	const page = Object.assign(new EventEmitter(), {
		url: () => url,
		mainFrame: () => frame,
		context: () => context,
		goto: async () => {},
		close: async () => {},
		waitForEvent: async () => {},
	});
	const timing = bootTimings(() => clock);
	const browser = timing.observe({ newPage: async () => page });
	await browser.newPage();
	url = "http://fixture/?model-viewer=station";
	page.emit("framenavigated", frame);
	clock = 1000;
	url = "http://fixture/";
	page.emit("framenavigated", frame);
	clock = 5000;
	await page.close();
	expect(timing.rows).toEqual([
		{
			seconds: 4,
			url,
			end: "close-after-route-return",
		},
	]);
});

test("a new page in the same storage context still times its whole navigation", async () => {
	let clock = 0;
	const context = new EventEmitter();
	const makePage = () =>
		Object.assign(new EventEmitter(), {
			context: () => context,
			url: () => "http://fixture/",
			goto: async () => {
				clock += 4000;
			},
			close: async () => {},
			waitForEvent: async () => {},
		});
	const timing = bootTimings(() => clock);
	const browser = timing.observe({
		newPage: async () => makePage(),
		newContext: async () => context,
	});
	await browser.newContext();
	const next = makePage();
	context.emit("page", next);
	await next.goto();
	await timing.ready(async () => {
		clock += 1000;
	}, next);
	expect(timing.rows[0].seconds).toBe(5);
});
