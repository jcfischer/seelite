/**
 * How the docking waltz's versions are loaded, apart from where they are
 * found: `music-danube-variants.ts` finds them with Vite's glob, which bun
 * cannot run, and hands the loaders here, so the rule below has a headless
 * test (`tests/music-danube-load.test.ts`).
 *
 * **Each module is loaded on its own, and one that throws is skipped with a
 * warning.** The glob was eager once, and a version importing a name its
 * neighbour did not export threw while the loader itself was evaluated: every
 * version then rendered as absent, the broken one's neighbours included.
 */
import type { Song } from "./music-score";

/** A module of `music-danube-variants/`, as the glob hands it over. */
export type VersionModule = () => Promise<{ VARIANT?: Song }>;

/** A version's id: `danube-` and its file's name. */
export const versionId = (path: string) =>
	`danube-${path.replace(/^.*\/|\.ts$/g, "")}`;

/** Every version that loads, by id; one that throws or exports no
 *  `VARIANT` is reported through `warn` and left out. */
export const loadVersions = async (
	modules: Readonly<Record<string, VersionModule>>,
	warn: (message: string, error: unknown) => void = console.warn,
): Promise<Readonly<Record<string, Song>>> => {
	const loaded = await Promise.all(
		Object.entries(modules).map(async ([path, load]) => {
			try {
				const { VARIANT } = await load();
				if (!VARIANT) throw new Error("exports no VARIANT");
				return [[versionId(path), VARIANT] as const];
			} catch (e) {
				warn(`danube version ${versionId(path)} skipped:`, e);
				return [];
			}
		}),
	);
	return Object.fromEntries(loaded.flat());
};
