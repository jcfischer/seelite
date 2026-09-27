import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	SCOOP_NOTICE_S,
	nextScoopNotice,
	scoopExit,
	scoopNotice,
} from "../src/cargo-notice";
import { repoPath } from "./lib/source-scan";

test("a scoop names the tonnage and the good, and a refusal says why", () => {
	expect(
		scoopNotice({ commodity: "Liquor/Wines", tonnes: 1, accepted: true }),
	).toBe("SCOOPED  1 t LIQUOR/WINES");
	expect(scoopNotice({ commodity: "Furs", tonnes: 1, accepted: false })).toBe(
		"HOLD FULL  FURS LEFT IN SPACE",
	);
	// The exit line is the same event in the other voice, and lives here too.
	expect(
		scoopExit({ commodity: "Liquor/Wines", tonnes: 1, accepted: true }),
	).toBe("scooped 1 t Liquor/Wines");
	expect(scoopExit({ commodity: "Furs", tonnes: 1, accepted: false })).toBe(
		"hold full: canister left in space",
	);
	// Long enough to read after the approach that earned it, short enough that
	// three scoops in a row read as three events.
	expect(SCOOP_NOTICE_S).toBeGreaterThan(1.5);
	expect(SCOOP_NOTICE_S).toBeLessThan(4);
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
});

describe("a partial take (civilian-combat H11)", () => {
	const quiet = { text: "", left: 0, accepted: true, canisterId: null };

	test("names what it took and what it left", () => {
		expect(
			scoopNotice({ commodity: "Food", tonnes: 5, accepted: true, leftT: 7 }),
		).toBe("SCOOPED  5 t FOOD  7 t LEFT");
		expect(
			scoopExit({ commodity: "Food", tonnes: 5, accepted: true, leftT: 7 }),
		).toBe("scooped 5 t Food, 7 t left in the canister");
	});

	test("the refusal of the same canister next frame does not replace it, and sounds nothing", () => {
		const took = nextScoopNotice(quiet, {
			canisterId: "c1",
			commodity: "Food",
			tonnes: 5,
			accepted: true,
			leftT: 7,
		});
		expect(took.cue?.kind).toBe("scoop");
		const refused = nextScoopNotice(took.notice, {
			canisterId: "c1",
			commodity: "Food",
			tonnes: 7,
			accepted: false,
		});
		expect(refused.notice).toBe(took.notice);
		expect(refused.cue).toBe(null);
	});

	test("a different canister's refusal still replaces it, with the alert", () => {
		const took = nextScoopNotice(quiet, {
			canisterId: "c1",
			commodity: "Food",
			tonnes: 5,
			accepted: true,
			leftT: 7,
		});
		const other = nextScoopNotice(took.notice, {
			canisterId: "c2",
			commodity: "Furs",
			tonnes: 3,
			accepted: false,
		});
		expect(other.notice.text).toBe("HOLD FULL  FURS LEFT IN SPACE");
		expect(other.cue?.kind).toBe("alert");
	});

	test("a standing refusal re-arms without restarting the tone (sage #355)", () => {
		const first = nextScoopNotice(quiet, {
			canisterId: "c1",
			commodity: "Furs",
			tonnes: 1,
			accepted: false,
		});
		expect(first.cue?.kind).toBe("alert");
		const again = nextScoopNotice(first.notice, {
			canisterId: "c2",
			commodity: "Food",
			tonnes: 1,
			accepted: false,
		});
		expect(again.cue).toBe(null);
		expect(again.notice.left).toBe(SCOOP_NOTICE_S);
	});

	test("once the partial take's notice has lapsed, the refusal shows", () => {
		const took = nextScoopNotice(quiet, {
			canisterId: "c1",
			commodity: "Food",
			tonnes: 5,
			accepted: true,
			leftT: 7,
		});
		const lapsed = { ...took.notice, left: 0 };
		const refused = nextScoopNotice(lapsed, {
			canisterId: "c1",
			commodity: "Food",
			tonnes: 7,
			accepted: false,
		});
		expect(refused.notice.accepted).toBe(false);
		expect(refused.cue?.kind).toBe("alert");
	});
});
