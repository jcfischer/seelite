/**
 * Every alternative version of the docking waltz: one module per version in
 * `music-danube-variants/`, each exporting its song as `VARIANT`. A version
 * keeps the waltz's contract — an intro, a loop, a `resolve` to a cadence —
 * so the director could play any of them where it plays the waltz.
 *
 * Found by Vite's glob, so a version is added by adding its file and nothing
 * else. The id is `danube-<file name>`.
 */
import type { Song } from "./music-score";

const MODULES = import.meta.glob<{ VARIANT: Song }>(
	"./music-danube-variants/*.ts",
	{ eager: true },
);

/** Every version by id: `danube-techno`, `danube-jazz`, … */
export const danubeVariants = (): Readonly<Record<string, Song>> =>
	Object.fromEntries(
		Object.entries(MODULES).map(([path, m]) => [
			`danube-${path.replace(/^.*\/|\.ts$/g, "")}`,
			m.VARIANT,
		]),
	);
