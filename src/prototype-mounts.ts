/**
 * https://github.com/jcfischer/seelite/issues/920
 * Where the drill prototype's Longwall mounts study is, when `?mining=1` set
 * it: read by the lazily loaded Longwall installer, written by the page at
 * load, so neither imports the other.
 */
let mountsUrl: string | null = null;

/** Name the mounts study for the next Longwall install. */
export function setLongwallPrototypeMounts(url: string): void {
	mountsUrl = url;
}

/** The mounts study's URL, or `null` without the flag. */
export const longwallPrototypeMounts = (): string | null => mountsUrl;
