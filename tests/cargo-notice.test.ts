import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SCOOP_NOTICE_S, scoopNotice } from "../src/cargo-notice";
import { repoPath } from "./lib/source-scan";

test("a scoop names the tonnage and the good, and a refusal says why", () => {
	expect(
		scoopNotice({ commodity: "Liquor/Wines", tonnes: 1, accepted: true }),
	).toBe("SCOOPED  1 t LIQUOR/WINES");
	expect(scoopNotice({ commodity: "Furs", tonnes: 1, accepted: false })).toBe(
		"HOLD FULL  FURS LEFT IN SPACE",
	);
});

test("the notice does not go to the element the page hides", () => {
	// `lastExit` already carried these words and a pilot never saw one: every
	// `lastExit` lands in `#hud`, which index.html clips to a single pixel. This
	// row pins the reason the notice needed a second home, so a later change
	// that quietly routes it back there is a red run rather than a silent
	// regression to "the canister just disappears".
	const markup = readFileSync(repoPath("index.html"), "utf8");
	const hud = markup.slice(markup.indexOf("#hud {"));
	expect(hud.slice(0, hud.indexOf("}"))).toContain("clip: rect(0 0 0 0)");
	expect(SCOOP_NOTICE_S).toBeGreaterThan(0);
});
