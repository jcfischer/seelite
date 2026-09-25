import { chromium } from "playwright";
import { bootedGame } from "./probe-guard.mjs";
const out = process.env.OUT;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(
	`http://localhost:5188/?boot=direct&seed=7919&no-save=1&guided=1`,
);
await bootedGame(page, 60000);
await page.waitForFunction(() => !window.__seelite.clockHeld);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/guided-boot.png` });
for (const k of ["1", "3"]) {
	await page.keyboard.press(k);
	await page.waitForTimeout(800);
	await page.screenshot({ path: `${out}/guided-head-${k}.png` });
	await page.keyboard.press("2");
	await page.waitForTimeout(500);
}
await browser.close();
