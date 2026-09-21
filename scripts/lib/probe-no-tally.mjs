/**
 * TEMPORARY (#403): this file exists to be caught. It opens a page through the
 * launcher and calls no `tally()`, which is the exact shape the launcher-wiring
 * gate refuses. Pushed to prove the new pull-request step can fail a job on the
 * runner, and reverted in the next commit.
 */
import { launchChromium } from "../probe-guard.mjs";

const browser = await launchChromium();
const page = await browser.newPage();
await page.goto("about:blank");
await page.close();
await browser.close();
