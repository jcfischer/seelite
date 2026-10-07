/**
 * The docking waltz's versions are loaded one module at a time
 * (`src/music-danube-load.ts`), so one that throws hides no other — the
 * fault an eager glob had, when every version rendered as absent (#738).
 */
import { expect, test } from "bun:test";
import { loadVersions, versionId } from "../src/music-danube-load";
import type { Song } from "../src/music-score";

const song = (name: string): Song => ({
	name,
	beatsPerBar: 3,
	parts: {},
	sections: [],
	tempo: [{ bar: 0, bpm: 120 }],
});

test("a version's id is danube- and its file's name", () => {
	expect(versionId("./music-danube-variants/jazz-trio.ts")).toBe(
		"danube-jazz-trio",
	);
});

test("a version that throws is skipped, and its neighbours still load", async () => {
	const warned: string[] = [];
	const versions = await loadVersions(
		{
			"./music-danube-variants/ambient.ts": async () => ({
				VARIANT: song("ambient"),
			}),
			"./music-danube-variants/broken.ts": async () => {
				throw new TypeError("Cannot read properties of undefined");
			},
			"./music-danube-variants/empty.ts": async () => ({}),
			"./music-danube-variants/techno.ts": async () => ({
				VARIANT: song("techno"),
			}),
		},
		(message) => warned.push(message),
	);
	expect(Object.keys(versions).sort()).toEqual([
		"danube-ambient",
		"danube-techno",
	]);
	expect(versions["danube-techno"].name).toBe("techno");
	expect(warned.sort()).toEqual([
		"danube version danube-broken skipped:",
		"danube version danube-empty skipped:",
	]);
});
