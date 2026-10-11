import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const url = "http://localhost:5199/?seed=1";
await p.goto(url);
try {
  await p.waitForFunction(() => window.__seelite && window.__seelite.frames > 0, null, { timeout: 180000 });
  console.log("warmed:", await p.evaluate(() => window.__seelite.frames));
} catch (e) { console.log("boot failed:", e.message); }
await b.close();
