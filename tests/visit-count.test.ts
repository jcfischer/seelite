import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	COUNTER_ORIGIN,
	VISIT_SITES,
	countVisit,
	counterScript,
} from "../src/visit-count";
import { repoPath } from "./lib/source-scan";

type FakeTag = {
	attributes: Record<string, string>;
	setAttribute(name: string, value: string): void;
};

/** Just enough of a document to receive a script tag. */
function fakeDocument() {
	const appended: Record<string, string>[] = [];
	return {
		appended,
		doc: {
			head: {
				append: (el: FakeTag) => {
					appended.push(el.attributes);
				},
			},
			createElement: (tag: string): FakeTag => {
				const attributes: Record<string, string> = { tag };
				return {
					attributes,
					setAttribute: (name: string, value: string) => {
						attributes[name] = value;
					},
				};
			},
		},
	};
}

describe("visit count (#569)", () => {
	test("a page load, a game launch and a postcard open are counted as different sites", () => {
		// #714: a postcard link opens at `/` with its recipe in the fragment,
		// which the tracker never reads, so under the page site it would be
		// indistinguishable from the threshold.
		const ids = Object.values(VISIT_SITES);
		expect(new Set(ids).size).toBe(3);
		for (const kind of ["page", "launch", "postcard"] as const)
			expect(counterScript(kind)["data-site-id"]).toBe(VISIT_SITES[kind]);
	});

	test("the tag is the one Counterscale's tracker looks itself up by", () => {
		// tracker.js reads its site id off `#counterscale-script` and derives
		// the collect URL by replacing `tracker.js` in that element's `src`.
		expect(counterScript("launch")).toEqual({
			id: "counterscale-script",
			src: `${COUNTER_ORIGIN}/tracker.js`,
			"data-site-id": VISIT_SITES.launch,
		});
		expect(COUNTER_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
	});

	test("a build that is not production appends nothing", () => {
		const { doc, appended } = fakeDocument();
		countVisit("page", { enabled: false, doc });
		expect(appended).toEqual([]);
	});

	test("a production build appends exactly one tracker tag", () => {
		const { doc, appended } = fakeDocument();
		countVisit("launch", { enabled: true, doc });
		expect(appended).toEqual([{ tag: "script", ...counterScript("launch") }]);
	});

	test("the gate defaults to the production flag, not to on", () => {
		// bun sets no PROD flag, so the default arm must append nothing here.
		const { doc, appended } = fakeDocument();
		countVisit("page", { doc });
		expect(appended).toEqual([]);
	});

	test("public pages count a page load and the game branch counts a launch", () => {
		const entry = readFileSync(repoPath("src/entry.ts"), "utf8");
		const publicEntry = readFileSync(repoPath("src/public-entry.ts"), "utf8");
		expect(publicEntry).toContain('countVisit("page")');
		const boot = entry.indexOf('query.has("boot")');
		const launch = entry.indexOf('countVisit("launch")');
		expect(boot).toBeGreaterThan(-1);
		// On the boot branch, not the postcard viewer above it.
		expect(launch).toBeGreaterThan(boot);
		expect(entry.match(/countVisit\(/g)).toHaveLength(2);
	});

	test("an opened postcard link is counted once, as a postcard, accepted or refused (#714)", () => {
		const entry = readFileSync(repoPath("src/entry.ts"), "utf8");
		const branch = entry.indexOf("isPostcardFragment(window.location.hash)");
		const postcard = entry.indexOf('countVisit("postcard")');
		const decode = entry.indexOf("decodePostcard(window.location.hash)");
		expect(branch).toBeGreaterThan(-1);
		// Inside the postcard branch and before the parse splits it, so a link
		// this build refuses is still counted as the open it was.
		expect(postcard).toBeGreaterThan(branch);
		expect(postcard).toBeLessThan(decode);
		expect(entry.match(/countVisit\("postcard"\)/g)).toHaveLength(1);
	});
});
