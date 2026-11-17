import { expect, test } from "bun:test";
import { refineryQuoteBlock } from "../src/live-cockpit";

const ore = [{ good: "Metallic ore STD", tonnes: 3 }];

test("node #1305: REVIEW QUOTE with ore aboard and processing online has no block", () => {
	expect(refineryQuoteBlock({ saving: false, online: true, ore })).toBeNull();
});

test("node #1305: every disabled state names its reason", () => {
	expect(refineryQuoteBlock({ saving: true, online: true, ore })).toMatch(
		/Saving/,
	);
	expect(refineryQuoteBlock({ saving: false, online: false, ore })).toMatch(
		/offline/,
	);
	expect(refineryQuoteBlock({ saving: false, online: true, ore: [] })).toMatch(
		/No ore/,
	);
});
