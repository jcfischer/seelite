import { launchChromium } from "../scripts/probe-guard.mjs";
import { gameUrl } from "../scripts/lib/game-url.mjs";

const origin = "http://localhost:5199";
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 300)));
page.on("console", (m) => {
	if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200));
});
const t0 = Date.now();
await page.goto(gameUrl(origin, { seed: 1 }));
for (let i = 0; i < 90; i++) {
	const frames = await page
		.evaluate(() => window.__seelite?.frames ?? -1)
		.catch(() => -2);
	if (frames > 0) {
		console.log("booted after", ((Date.now() - t0) / 1000).toFixed(1), "s, frames", frames);
		break;
	}
	if (i % 10 === 0) console.log("t+", i, "s frames", frames);
	await new Promise((r) => setTimeout(r, 1000));
}
await browser.close();
