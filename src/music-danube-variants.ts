/**
 * Every alternative version of the docking waltz: one module per version in
 * `music-danube-variants/`, each exporting its song as `VARIANT`. A version
 * keeps the waltz's contract — an intro, a loop, a `resolve` to a cadence —
 * so the director could play any of them where it plays the waltz.
 *
 * Found by Vite's glob, so a version is added by adding its file and nothing
 * else. The id is `danube-<file name>`. Loading them, one at a time so a
 * broken one hides no other, is `music-danube-load.ts`'s.
 */
import { loadVersions } from "./music-danube-load";
import type { Song } from "./music-score";

const MODULES = import.meta.glob<{ VARIANT: Song }>(
	"./music-danube-variants/*.ts",
);

/** Every version that loads, by id: `danube-techno`, `danube-jazz`, … */
export const danubeVariants = (): Promise<Readonly<Record<string, Song>>> =>
	loadVersions(MODULES);
