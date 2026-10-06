import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { PUBLIC_PAGES } from "../src/public-site";
import {
	SITE_ORIGIN,
	SOCIAL_PREVIEW,
	pageUrl,
	socialPreviewTags,
} from "../src/social-preview";
import { repoPath } from "./lib/source-scan";

/** Every `og:` and `twitter:` meta tag in `html`, by key. */
function metaTags(html: string): Map<string, string> {
	const tags = new Map<string, string>();
	for (const m of html.matchAll(
		/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)" \/>/g,
	))
		tags.set(m[1] as string, m[2] as string);
	return tags;
}

/** Width and height from a baseline or progressive JPEG's frame header. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
	expect(bytes.readUInt16BE(0)).toBe(0xffd8);
	let at = 2;
	while (at < bytes.length) {
		const marker = bytes.readUInt16BE(at);
		const length = bytes.readUInt16BE(at + 2);
		if (marker === 0xffc0 || marker === 0xffc2)
			return {
				height: bytes.readUInt16BE(at + 5),
				width: bytes.readUInt16BE(at + 7),
			};
		at += 2 + length;
	}
	throw new Error("no frame header");
}

describe("social preview (#714)", () => {
	for (const page of PUBLIC_PAGES)
		test(`${page.entry} carries one complete preview block`, () => {
			const source = readFileSync(repoPath(page.entry), "utf8");
			// The block is written once, by the transform; a page that carried
			// its own copy would be a second one to keep in step.
			expect(source).not.toMatch(/og:|twitter:/);
			const html = socialPreviewTags(source, page.entry);
			const tags = metaTags(html);
			const title = /<title>([^<]*)<\/title>/.exec(source)?.[1] as string;
			expect(Object.fromEntries(tags)).toEqual({
				"og:type": "website",
				"og:site_name": "The Far Between",
				"og:title": title,
				"og:description": page.dek,
				"og:url": pageUrl(page.slug),
				"og:image": `${SITE_ORIGIN}/${SOCIAL_PREVIEW.file}`,
				"og:image:width": String(SOCIAL_PREVIEW.width),
				"og:image:height": String(SOCIAL_PREVIEW.height),
				"og:image:alt": SOCIAL_PREVIEW.alt,
				"twitter:card": "summary_large_image",
			});
			// Inside the head, where a crawler that stops at </head> reads it.
			expect(html.indexOf("og:image")).toBeLessThan(html.indexOf("</head>"));
		});

	test("the image URL is absolute https, which Facebook and LinkedIn require", () => {
		expect(SITE_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
		expect(pageUrl("")).toBe(`${SITE_ORIGIN}/`);
		expect(pageUrl("about")).toBe(`${SITE_ORIGIN}/about/`);
	});

	test("an unknown entry or a page without a head is refused, not passed through", () => {
		expect(() => socialPreviewTags("<head></head>", "nowhere.html")).toThrow();
		expect(() =>
			socialPreviewTags("<title>x</title>", PUBLIC_PAGES[0]?.entry as string),
		).toThrow();
	});

	test("a title with a quote keeps its entities and escapes the quote", () => {
		const html = socialPreviewTags(
			'<head><title>a "b" &lt;c&gt;</title></head>',
			PUBLIC_PAGES[0]?.entry as string,
		);
		expect(metaTags(html).get("og:title")).toBe("a &quot;b&quot; &lt;c&gt;");
	});

	test("the image is a 1200 x 630 JPEG under its byte budget", () => {
		const path = repoPath(`public/${SOCIAL_PREVIEW.file}`);
		const bytes = readFileSync(path);
		expect(jpegSize(bytes)).toEqual({
			width: SOCIAL_PREVIEW.width,
			height: SOCIAL_PREVIEW.height,
		});
		expect(statSync(path).size).toBeLessThan(SOCIAL_PREVIEW.maxBytes);
	});
});
