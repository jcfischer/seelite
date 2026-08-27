/**
 * The persisted identity of a carrier slot — `persistent-world-state.md` §2.
 *
 * **A leaf, and that is the point**, exactly as `domains.ts` is one. Every
 * persistence domain has to agree on this key: the market's stock deficits
 * today, carrier condition and player knowledge in `world-state.ts`, whatever
 * §7 approves later. It lived in `market.ts` because the deficit map was the
 * first domain to need it, which made the canonical identity of a saved fact a
 * detail of how a price is computed — every future domain would have imported
 * the commodity table to name its own rows.
 *
 * This file imports nothing.
 */

/**
 * `CONTEXT.md`'s **CarrierKey**, given a type rather than left as a string.
 *
 * Branded because the whole hazard this key exists to prevent is a `Station.id`
 * being passed where a persisted identity belongs — and a bare `string` accepts
 * one silently. The brand is erased at runtime; what it buys is that
 * `carrierKey` is the only way to make one.
 */
export type CarrierKey = string & { readonly __carrierKey: unique symbol };

/**
 * The envelope-relative carrier key. The containing galaxy index comes from the
 * save envelope, not from here — `station-trade` names one station in nearly
 * every system in the galaxy, which is why the key is composite at all.
 */
export const carrierKey = (
	systemIndex: number,
	localCarrierId: string,
): CarrierKey => `${systemIndex}:${localCarrierId}` as CarrierKey;

/**
 * The persisted key's shape, in one place.
 *
 * Checked rather than asserted at every boundary a key crosses: the brand makes
 * `carrierKey` the only way to *make* one, and a cast at a parser would undo
 * that — letting a save keyed on a bare `Station.id` load silently and file one
 * system's state under every system's.
 */
export const isCarrierKey = (key: string): boolean => /^\d+:.+$/.test(key);

/** System index and local id, split back out. */
export const splitCarrierKey = (key: string): [number, string] => {
	const at = key.indexOf(":");
	return [Number(key.slice(0, at)), key.slice(at + 1)];
};

/**
 * The canonical carrier order: system index **numerically**, then the local id.
 *
 * A plain string sort is wrong here and quietly so — `"11:station-trade"` sorts
 * before `"2:station-trade"` — and the order is load-bearing, because
 * `persistent-world-state.md` §4 resolves same-timestamp completions in it.
 */
export const compareCarrierKeys = (a: string, b: string): number => {
	const [sa, ia] = splitCarrierKey(a);
	const [sb, ib] = splitCarrierKey(b);
	if (sa !== sb) return sa - sb;
	return ia < ib ? -1 : ia > ib ? 1 : 0;
};
