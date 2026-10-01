/**
 * The strings lab (#547 D15): every knob in the table has a slider, the desks
 * it offers are the voicings' strings desks, what it plays compiles, and it
 * reaches no network.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DANUBE_VOICINGS } from "../src/music-danube";
import { compileSong } from "../src/music-sequencer";
import {
	labSong,
	labWaltz,
	slidersHtml,
	sourceLiteral,
	stringsDesks,
} from "../src/strings-lab-model";
import { STRINGS_PARAMS } from "../src/strings-params";

test("every entry in the table has one slider, at its range", () => {
	const html = slidersHtml({ voice: "strings", level: 0.3 });
	for (const p of STRINGS_PARAMS) {
		const found = html.match(
			new RegExp(`<input type="range" data-param="${p.key}"[^>]*>`, "g"),
		);
		expect([p.key, found?.length]).toEqual([p.key, 1]);
		expect(found?.[0]).toContain(`min="${p.min}"`);
		expect(found?.[0]).toContain(`max="${p.max}"`);
	}
	expect(html.match(/data-param=/g)?.length).toBe(STRINGS_PARAMS.length);
});

test("a desk's own settings are what the sliders show", () => {
	const spec = DANUBE_VOICINGS.orchestra.bass;
	const html = slidersHtml(spec);
	expect(html).toContain(
		`data-param="cutoffHz" min="100" max="6000" step="10" value="${spec.cutoffHz}"`,
	);
});

test("the desks offered are the voicing's strings desks", () => {
	for (const v of Object.keys(
		DANUBE_VOICINGS,
	) as (keyof typeof DANUBE_VOICINGS)[]) {
		const desks = stringsDesks(v);
		expect(desks.length).toBeGreaterThan(0);
		for (const d of desks) expect(DANUBE_VOICINGS[v][d].voice).toBe("strings");
	}
	expect(stringsDesks("orchestra")).toContain("bass");
	expect(stringsDesks("hybrid")).toContain("bass");
});

test("what the lab plays compiles", () => {
	const spec = { ...DANUBE_VOICINGS.orchestra.melody, cutoffHz: 2000 };
	for (const kind of ["note", "chord", "phrase"] as const)
		expect(() => compileSong(labSong(spec, kind, 36))).not.toThrow();
	const w = labWaltz("hybrid", "bass", spec);
	expect(() => compileSong(w)).not.toThrow();
	expect(w.parts.bass).toBe(spec);
});

test("copy as source names the voice, the level and every changed knob", () => {
	const text = sourceLiteral({ voice: "strings", level: 0.4, drive: 0.3 });
	expect(text).toContain(`voice: "strings"`);
	expect(text).toContain("level: 0.4");
	expect(text).toContain("drive: 0.3");
	expect(text).not.toContain("unison");
});

test("the lab reaches no network", () => {
	const src = ["strings-lab.ts", "strings-lab-model.ts"]
		.map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"))
		.join("\n");
	for (const banned of [
		/\bfetch\s*\(/,
		/XMLHttpRequest/,
		/WebSocket/,
		/sendBeacon/,
		/EventSource/,
		/https?:\/\//,
	])
		expect([String(banned), banned.test(src)]).toEqual([String(banned), false]);
});
