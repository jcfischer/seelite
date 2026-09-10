/**
 * The strings a last-known reading turns into, and the one rule about time
 * underneath them.
 *
 * **A module of its own because two surfaces read it, and neither owns it.**
 * These lived in `galaxy-finder.ts` for two rounds, which made the selected
 * system's record card import its own formatting from the *finder* — a surface
 * the finder does not own, and one a later knowledge display elsewhere would
 * inherit the same import for. Nothing here knows what a row or a card is.
 *
 * It imports types and nothing else, so both the main bundle and the lazily
 * loaded chart chunk can pull it without dragging the finder along — which is
 * what `NO_KNOWLEDGE` needs to be one binding rather than two under one name.
 */

import type { StationType } from "./station";
import type {
	GalaxyEnvelope,
	KnowledgeRow,
	ObservedRecovery,
	OperationalCondition,
} from "./world-state";

/**
 * §5.2.1's exact chip set.
 *
 * **Here rather than in `galaxy-finder.ts`, so this module is a leaf.** It was
 * imported back from the finder, which pointed the low-level module at the
 * high-level one it had just been split out of — a declaration cycle held open
 * only by that import staying type-only, which nothing asserted, against a doc
 * comment staking the module on importing types and nothing else.
 * `tests/headless.test.ts` asserts the leafness now, the way it does for
 * `units.ts`, `vec3.ts` and `hull.ts`.
 */
export const FACILITY_CHIPS = ["REFINERY", "SHIPYARD", "KNOWN FENCE"] as const;
export type FacilityChip = (typeof FACILITY_CHIPS)[number];

/**
 * CONTEXT.md's **Last-known state**, as a map from carrier to row.
 *
 * **Named for the concept, not for one reader.** It was `FinderKnowledge` while
 * the record card took the same type through `GalaxyChartOptions.knowledge` —
 * and this module's own doc says these labels live here because two surfaces
 * read them and neither owns them.
 *
 * **Derived from the envelope, never re-declared.** Written first as
 * `Record<string, KnowledgeRow>`, which widens `CarrierKey` back to a bare
 * string on the public surface — and the brand exists precisely so a raw string
 * cannot index it (`carrier-key.ts`).
 */
export type LastKnownState = Readonly<GalaxyEnvelope["knowledge"]>;

/**
 * The empty overlay, as one object.
 *
 * A caller returning a fresh `{}` defeats the panel's identity comparison and
 * re-projects the galaxy every render — which both the workbench and the game
 * mount did until a round caught it. **One binding, not one name twice:** the
 * game's mount held its own copy for a round because the only home for this was
 * inside the chart chunk, and a later `knowledge() === NO_KNOWLEDGE` written
 * against the exported one would have quietly failed for the game.
 */
export const NO_KNOWLEDGE: LastKnownState = Object.freeze({});

/**
 * Which world-minute a clock reading falls in.
 *
 * **One bucketing rule, not three.** The panel retimes its annotation spans on
 * a minute change and the chart repaints its card on one, and each kept its own
 * `Math.floor(now() / 60)` with its own long comment to keep in sync. The bound
 * this buys is 60 s and the buckets are *not* aligned to either label: an
 * `observedAt` of 30 reads `SEEN JUST NOW` until `now` reaches 120, and
 * `recoveryScheduleLabel` flips at an arbitrary `completesAt`.
 */
export const worldMinute = (now: number): number =>
	Math.floor(now / SECONDS_PER_MINUTE);

/**
 * §5.2.1's annotation on one matched role.
 *
 * **It is a fact about the carrier, not an echo of the chip.** The first
 * implementation set `FinderRow.matchedFacilities` to `[...filter.facilities]`,
 * so a row printed back exactly what was asked for — a value no build could
 * get wrong, and no check could catch. This carries what the *station* is:
 * which role matched, and what the player last saw there.
 *
 * `condition`, `observedAt` and `source` are all `null` together, which is
 * §5.2.1's `STATUS UNKNOWN` — a carrier never observed, not one observed long
 * ago. Knowledge here never expires.
 *
 * **No age, and no formatted string.** Age is `now` minus `observedAt`, and
 * `now` moves every frame while the projection is memoised on the filter. A
 * formatted label baked in here would be the stalest thing in the panel;
 * `facilityAnnotationLabel` renders it at paint time instead.
 */
export interface FacilityAnnotation {
	facility: FacilityChip;
	/** The station role carrying the fact. `KNOWN FENCE` uses its refinery's
	 *  (§5.2.1), because the fence is not a carrier of its own. */
	role: StationType;
	name: string;
	condition: OperationalCondition | null;
	observedAt: number | null;
	source: string | null;
	/** §3.1's remembered schedule, present only on a `repairing` observation.
	 *  The record card prints it as unconfirmed; nothing here promotes it. */
	observedRecovery?: ObservedRecovery;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/**
 * §5.2.1's compact condition-plus-age, as the finder row prints it:
 * `OPERATIONAL · SEEN 2H AGO`, `DESTROYED · SEEN 3D AGO`, `STATUS UNKNOWN`.
 *
 * **Elapsed time is a display term and nothing else.** A `repairing` row whose
 * remembered `completesAt` is long past still reads `REPAIRING` — §5.2.1 is
 * explicit that only an approved information channel may report the completed
 * condition, so the one place that could quietly promote it does not look at
 * `observedRecovery` at all. The record card is where the remembered schedule
 * surfaces, marked `UNCONFIRMED`.
 *
 * The coarsest unit that fits wins, floored, so an age never rounds *up* into
 * a longer one than has actually passed. Under a minute is `JUST NOW` rather
 * than `0M`, which reads as a broken clock.
 */
export function facilityAnnotationLabel(
	annotation: FacilityAnnotation,
	now: number,
): string {
	if (annotation.condition === null || annotation.observedAt === null)
		return "STATUS UNKNOWN";
	const elapsed = Math.max(0, now - annotation.observedAt);
	const age =
		elapsed >= SECONDS_PER_DAY
			? `${Math.floor(elapsed / SECONDS_PER_DAY)}D AGO`
			: elapsed >= SECONDS_PER_HOUR
				? `${Math.floor(elapsed / SECONDS_PER_HOUR)}H AGO`
				: elapsed >= SECONDS_PER_MINUTE
					? `${Math.floor(elapsed / SECONDS_PER_MINUTE)}M AGO`
					: "JUST NOW";
	return `${annotation.condition.toUpperCase()} · SEEN ${age}`;
}

/**
 * §5.2.1's remembered recovery, as the record card prints it: `DUE @ 100s ·
 * UNCONFIRMED` before the remembered completion, `OVERDUE · UNCONFIRMED` after
 * it.
 *
 * **The `@` is not decoration.** `completesAt` is a world-clock reading and
 * every other figure in a finder row is relative (`SEEN 2H AGO`), so `DUE 70s`
 * reads as seventy seconds remaining when it means world time 70. The record
 * card already marks an absolute time that way — `${source} @ ${observedAt}s`.
 *
 * **Both are unconfirmed and neither is a completion.** Passing `completesAt`
 * changes the wording and nothing else — only a relay or a docking report may
 * say the repair finished, so the row's condition stays `repairing` on both
 * sides of it. It lives here rather than inline in the card because a rule
 * about what elapsed time may and may not conclude is exactly the thing a
 * headless tier should hold.
 */
export function recoveryScheduleLabel(
	recovery: ObservedRecovery,
	now: number,
): string {
	return now >= recovery.completesAt
		? "OVERDUE · UNCONFIRMED"
		: `DUE @ ${recovery.completesAt.toFixed(0)}s · UNCONFIRMED`;
}

/** §5.2.1's three values for a refinery's fence. */
export type FenceKnowledge = "known-fence" | "known-absent" | "unchecked";

/**
 * §5.2.1's three-valued fence, and **this is its one home.**
 *
 * The rule was written three times over two rounds: inline in `facilitiesOf`,
 * again in the record card's render branch, and again in the label below.
 * `fenceStatusLabel`'s doc claimed exclusivity while `facilitiesOf` kept its
 * own branch — which is the claim a later reader trusts when changing one of
 * them. Both call this now.
 *
 * The generated flag supplies the value once a marker exists; without one the
 * fact is unchecked, whatever the flag says.
 */
export function fenceKnowledge(
	blackMarket: boolean,
	known: KnowledgeRow | undefined,
): FenceKnowledge {
	if (!known?.knownPrivateFacts?.blackMarket) return "unchecked";
	return blackMarket ? "known-fence" : "known-absent";
}

/** `fenceKnowledge` as the record card prints it. A non-refinery has no fence
 *  to have an opinion about. */
export function fenceStatusLabel(
	role: StationType,
	blackMarket: boolean,
	known: KnowledgeRow | undefined,
): string | null {
	if (role !== "refinery") return null;
	return {
		unchecked: "FENCE UNCHECKED",
		"known-fence": "KNOWN FENCE",
		"known-absent": "KNOWN NO FENCE",
	}[fenceKnowledge(blackMarket, known)];
}

/**
 * How a report channel reads on the card.
 *
 * **The save's own words are not the player's.** `source` is the persisted enum
 * — `system-relay`, `docking`, `intervention` — and the card printed it raw, so
 * a roster line read `OPERATIONAL · system-relay @ 37s`. The principal caught it
 * on the first look at the built thing, which is what that tier is for.
 *
 * An unknown source falls through to itself rather than to a placeholder: a
 * channel added later should look odd on the card, not invisible.
 */
const SOURCE_LABELS: Record<string, string> = {
	"system-relay": "RELAY REPORT",
	docking: "DOCKED HERE",
	intervention: "YOUR DOING",
};

/** The exact age behind the finder row's coarse one — `1M 08S AGO`, `3D 04H
 *  AGO`. Two units, never three: the card is precise, not a stopwatch. */
const exactAge = (elapsed: number): string => {
	const s = Math.max(0, Math.floor(elapsed));
	const d = Math.floor(s / SECONDS_PER_DAY);
	const h = Math.floor((s % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
	const m = Math.floor((s % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
	const sec = s % SECONDS_PER_MINUTE;
	const pad = (n: number) => String(n).padStart(2, "0");
	if (d > 0) return `${d}D ${pad(h)}H AGO`;
	if (h > 0) return `${h}H ${pad(m)}M AGO`;
	if (m > 0) return `${m}M ${pad(sec)}S AGO`;
	return `${sec}S AGO`;
};

/**
 * One station's line in §5.2.1's record card: the exact observation age and
 * report source the finder row's relative age is a rounding of, plus the
 * remembered recovery and the fence.
 *
 * **Elapsed, not a timestamp.** This printed `@ 37s` — the world clock at the
 * moment of observation — and nothing in the game shows that clock, so the
 * figure was anchored to something the player cannot see. §5.2.1 wants the card
 * to carry the exact reading the row rounds; an exact *age* does that against a
 * reference the player has, which is now.
 *
 * Beside `recoveryScheduleLabel` and `fenceStatusLabel` for the reason those
 * two are here — it was ~25 lines of formatting inside an already long render
 * branch, where only the browser tier could reach it.
 */
export function stationRosterLine(
	station: { name: string; type: StationType; blackMarket: boolean },
	known: KnowledgeRow | undefined,
	now: number,
): string {
	// **Two lines, and the break is deliberate.** As one line this runs to 84
	// characters at its worst — an observed refinery with an old reading and an
	// unchecked fence — which no card width on a 1280 stage fits, so it wrapped
	// mid-phrase and a continuation began `· RELAY REPORT`. What the station
	// *is* goes on the first line; what is *known* about it goes on the second,
	// indented, so an entry reads as one thing at any width.
	const head = `${station.name} — ${station.type.toUpperCase()} · ${
		known ? known.observedCondition.toUpperCase() : "STATUS UNKNOWN"
	}`;
	const reading = [
		known ? (SOURCE_LABELS[known.source] ?? known.source) : null,
		known ? `SEEN ${exactAge(now - known.observedAt)}` : null,
		known?.observedRecovery
			? recoveryScheduleLabel(known.observedRecovery, now)
			: null,
		fenceStatusLabel(station.type, station.blackMarket, known),
	]
		.filter((part) => part)
		.join(" · ");
	return reading ? `${head}\n    ${reading}` : head;
}
