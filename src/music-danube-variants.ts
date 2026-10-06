/**
 * Every alternative version of the docking waltz: one module per version in
 * `music-danube-variants/`, each exporting its song as `VARIANT`. A version
 * keeps the waltz's contract — an intro, a loop, a `resolve` to a cadence —
 * so the director could play any of them where it plays the waltz.
 *
 * Found by Vite's glob, so a version is added by adding its file and nothing
 * else. The id is `danube-<file name>`.
 *
 * **Each module is loaded on its own, and one that throws is skipped with a
 * warning.** The glob was eager once, and a version importing a name its
 * neighbour did not export threw while the loader itself was evaluated: every
 * version then rendered as absent, the broken one's neighbours included.
 */
import type { Song } from "./music-score";

const MODULES = import.meta.glob<{ VARIANT: Song }>(
	"./music-danube-variants/*.ts",
);

const idOf = (path: string) => `danube-${path.replace(/^.*\/|\.ts$/g, "")}`;

/** Every version that loads, by id: `danube-techno`, `danube-jazz`, … */
export const danubeVariants = async (): Promise<
	Readonly<Record<string, Song>>
> => {
	const loaded = await Promise.all(
		Object.entries(MODULES).map(async ([path, load]) => {
			try {
				const { VARIANT } = await load();
				if (!VARIANT) throw new Error("exports no VARIANT");
				return [[idOf(path), VARIANT] as const];
			} catch (e) {
				console.warn(`danube version ${idOf(path)} skipped:`, e);
				return [];
			}
		}),
	);
	return Object.fromEntries(loaded.flat());
};
