/**
 * A station's **name** (`docs/specs/docking.md` §12.5, decision **E9**).
 *
 * `Station.id` is `"station-trade"` and `station.ts` says outright that it is a
 * lookup key; `localCarrierId` is the **carrier slot**, which is what a save row
 * is filed under. The name is a third thing — `CONTEXT.md` §Language now carries
 * it as its own term for that reason — and this module is where it is derived.
 *
 * **Derived, never drawn.** A new draw from any existing domain tag shifts
 * every station generated after it and moves `tests/station-orbits.test.ts`'s
 * committed fixture. So nothing here takes a `rand`: the name is a pure
 * function of facts that already exist, and it costs no stream. That is why the
 * designator below is chosen by a hash of the inputs rather than by a draw —
 * the variety is real and the generator's draw sequence is untouched.
 *
 * **What it is a function of, and why not the obvious thing.** "System plus
 * parent planet" does not work: `system.ts` picks the shipyard's host from
 * `[primary, ...gasGiants]` at random, so a trade station and a shipyard can
 * orbit the same planet and would derive the same name — and the refinery is
 * `parentId: null`, star-centric in the belt, with no parent to derive from at
 * all. So the inputs are the **system name and the station's type**, which
 * `system.ts` places at most one of each of: uniqueness within a system by
 * construction rather than by a check.
 *
 * **Uniqueness means within a system, and that is all this name needs** (§12.5).
 * Two systems may share a name — `galaxy-generation.md` §9's obligation 6 asks
 * only that the duplicate rate be recorded — so two identically-named systems
 * carry identically-named stations. Nothing in §12 requires a globally unique
 * station name and a reader should not infer one from obligation 10.
 */

import type { StationType } from "./station";

/**
 * The designator vocabulary, per type.
 *
 * Per type rather than one shared list, because the word is the only place the
 * name says what kind of place this is: a refinery called "Lave Hub" tells the
 * player nothing the trade station has not already told them. Every entry is a
 * word Elite's own fiction would use, and the lists are deliberately different
 * lengths — nothing indexes across them.
 */
export const STATION_DESIGNATORS: Record<StationType, readonly string[]> = {
	trade: ["Station", "Ring", "Hub", "Orbital", "Terminal", "Gateway"],
	shipyard: ["Yards", "Drydock", "Works", "Slipway"],
	refinery: ["Refinery", "Smelter", "Cracking Works"],
	outpost: ["Outpost", "Depot", "Waystation"],
};

/**
 * FNV-1a over the UTF-16 code units, 32-bit.
 *
 * A hash rather than an RNG stream for the reason in the header: this must not
 * consume a draw. FNV-1a specifically because it is four lines, has no tuning
 * constants of ours to get wrong, and mixes the *last* character — which
 * matters here, since two system names commonly differ only in their tail.
 *
 * `>>> 0` after the multiply keeps this in the unsigned 32-bit range that
 * `Math.imul` leaves as a signed integer.
 */
function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/**
 * The station's name.
 *
 * `systemName` is `SystemRecord.name`; `type` is the station's. The pair is
 * hashed with a separator that **cannot occur in either**, so a system named
 * `AB` with type `C` and one named `A` with type `BC` cannot collide into the
 * same designator by concatenation. `|` qualifies: `names.ts` builds a system
 * name from a digram table of letters alone, and `StationType` is a closed
 * union of lowercase words.
 *
 * It was a literal `NUL` for one commit, which is a separator no input can
 * carry at all — and made git classify this file as **binary**, so the whole
 * module arrived in review as `Binary files differ` with nothing to read. A
 * separator has to be impossible in the inputs *and* printable in the source.
 */
export function stationName(systemName: string, type: StationType): string {
	const words = STATION_DESIGNATORS[type];
	const word = words[fnv1a(`${systemName}|${type}`) % words.length];
	return `${systemName} ${word}`;
}

/**
 * §12.5's stated remedy, as a function rather than as a paragraph.
 *
 * E9's uniqueness is by construction — one station per type per system — and
 * construction is what a generator change can break without a compile error.
 * The spec names the fallback: **append `localCarrierId` as a discriminator**,
 * appended so an existing station's name never moves when a second one appears
 * beside it. It ships here, with the detecting test, rather than being
 * deferred: a red test with no owner is what deferring it would produce.
 *
 * Applied to a whole system's station list at once, because "is this name a
 * duplicate" is a question about the set and not about one station.
 *
 * **It takes each station's own `localCarrierId` rather than deriving one from
 * its type, and that is not a paraphrase of §12.5 — it is the only reading of
 * it that works.** `LOCAL_CARRIER_ID` is a `Record<StationType, string>`, so two
 * stations of one type in one system carry the *same* carrier id; appending it
 * would hand both the same discriminated name and the remedy would not remedy
 * anything. Passing the id in makes the discriminator as unique as the
 * persistence key is, and moves the failure to where it belongs: if two
 * stations in one system share a carrier id, `economy-trade.md` §5.5's deficit
 * map has already merged their market memory, and two stations sharing a name is
 * the smallest of that day's problems. This function does not paper over it —
 * duplicate ids come back as duplicate names, which is the honest report.
 */
export function stationNames(
	systemName: string,
	stations: readonly { type: StationType; localCarrierId: string }[],
): string[] {
	const base = stations.map((s) => stationName(systemName, s.type));
	const seen = new Map<string, number>();
	for (const name of base) seen.set(name, (seen.get(name) ?? 0) + 1);
	return base.map((name, i) =>
		(seen.get(name) ?? 0) > 1
			? `${name} (${stations[i].localCarrierId})`
			: name,
	);
}
