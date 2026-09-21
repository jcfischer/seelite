/**
 * Node #324 part (c)'s combat HUD, as pure presentation state.
 *
 * **Both places, by the principal's ruling (2026-09-14).** A minimal row on the
 * glass floor during a fight — the two readings a pilot needs without looking
 * away, shield pools and the heat lock — and the full detail on the Flight
 * console: fore, aft, hull, the energy bank and heat, each against its capacity. The
 * console's heat is the glass cell's own value, so the two cannot describe one
 * gun two ways.
 *
 * **The cue is amber, and red only while the raider fires** (also the
 * principal's). §4 gives amber to the selected target and red to blocking
 * danger; a raider is the first, and becomes the second while it is shooting.
 *
 * The cells use §5.1's floor grammar — a label, a value, a tone — so the glass
 * draws them with the strip's own painter. It imports types from `cockpit` and
 * `encounter` and constants from `ship-condition`; nothing here reaches a
 * renderer.
 */
import type { FloorCell, FloorTone } from "./cockpit";
import type { EncounterPhase } from "./encounter";
import {
	ENERGY_BANK,
	HEAT_LOCK,
	printHull,
	printHullPercent,
	SHIELD_POOL,
	type ConditionPrint,
	type ShipCondition,
} from "./ship-condition";

/** The glass row's cells, in order. */
export const DUEL_ROW_LABELS = ["SHD", "HEAT"] as const;
type DuelRowLabel = (typeof DUEL_ROW_LABELS)[number];

/** The share of the lock at which the heat cell turns amber: close enough to
 *  the ceiling that another burst may lock the gun. */
export const HEAT_ACTION_FRACTION = 0.75;

/** Heat as the glass prints it: a whole percent of the lock. */
const heatPercent = (c: ShipCondition): number =>
	Math.round((c.heat / HEAT_LOCK) * 100);

const heatValue = (c: ShipCondition): string =>
	c.heatLocked ? "LOCK" : `${heatPercent(c)}%`;

/** The glass combat row: shield pools, then heat. */
export function duelRowCells(c: ShipCondition): FloorCell[] {
	const fore = Math.round(c.fore);
	const aft = Math.round(c.aft);
	// **The refusal reads the printed value** (§5.1's CHARGE lesson): a pool at
	// 0.3 prints 0, and a tone keyed on the raw number would go calm beside it.
	const shieldTone: FloorTone = fore === 0 || aft === 0 ? "refused" : "passive";
	// The heat tone reads the printed percent too: 74.6% prints 75% and is amber.
	const heatTone: FloorTone = c.heatLocked
		? "refused"
		: heatPercent(c) >= HEAT_ACTION_FRACTION * 100
			? "action"
			: "passive";
	return [
		{ label: "SHD", value: `F ${fore} A ${aft}`, tone: shieldTone },
		{ label: "HEAT", value: heatValue(c), tone: heatTone },
	];
}

/**
 * The widest value each cell can print, found by asking the formatter over the
 * worst cases rather than restating its output — `flightFloorWidest`'s rule, so
 * the glass fit and the formatter have one owner.
 */
export function duelRowWidest(): Record<DuelRowLabel, string> {
	const widest: Record<DuelRowLabel, string> = { SHD: "", HEAT: "" };
	const base: ShipCondition = {
		fore: SHIELD_POOL,
		aft: SHIELD_POOL,
		hull: 1,
		hullMax: 1,
		energy: ENERGY_BANK,
		heat: 0,
		heatLocked: false,
		sinceStruckS: 0,
	};
	const candidates: ShipCondition[] = [
		base,
		{ ...base, heat: HEAT_LOCK * 0.999 },
		{ ...base, heatLocked: true },
		{ ...base, fore: 0, aft: 0 },
	];
	for (const c of candidates)
		for (const cell of duelRowCells(c)) {
			const label = cell.label as DuelRowLabel;
			if (cell.value.length > widest[label].length) widest[label] = cell.value;
		}
	return widest;
}

export interface DuelConsoleReadout {
	fore: string;
	aft: string;
	hull: string;
	/** The energy bank (`CONTEXT.md`), never unqualified "energy". */
	bank: string;
	heat: string;
}

/** The Flight console's full combat detail. */
export function duelConsoleReadout(c: ShipCondition): DuelConsoleReadout {
	return {
		fore: `${Math.round(c.fore)} / ${SHIELD_POOL}`,
		aft: `${Math.round(c.aft)} / ${SHIELD_POOL}`,
		hull: `${printHull(c.hull)} / ${c.hullMax}`,
		bank: `${Math.round(c.energy)} / ${ENERGY_BANK}`,
		heat: heatValue(c),
	};
}

/**
 * The selected enemy's condition, as the line under its label on the glass
 * (#324, the principal's ruling after the second playtest): shield pools and
 * hull, printed as the duel row prints them. It is refused while either printed
 * pool is 0, so an open side reads at a glance.
 *
 * **Both pools print, every time.** A carrier cut off from behind loses `aft`
 * while `fore` stands at 106, and one met from ahead the other way round; those
 * are different fights, and a reading that named one pool could not tell them
 * apart. #395's measurement is what found the question had never been asked.
 *
 * **Every selected combat target, not the raider alone** (since #395), and its
 * hull is a share rather than a point figure — `hud-and-scanner.md` §5.4 says
 * why, and `printHullPercent` owns the law that a live hull never prints 0.
 */
export function targetConditionLine(c: ConditionPrint): {
	text: string;
	tone: FloorTone;
} {
	const fore = Math.round(c.fore);
	const aft = Math.round(c.aft);
	return {
		text: `SHD F ${fore} A ${aft}  HULL ${printHullPercent(c)}%`,
		tone: fore === 0 || aft === 0 ? "refused" : "passive",
	};
}

/**
 * The widest reading the line under a selected target's name can take.
 *
 * `duelRowWidest` bounds the floor's duel row; the sky label has its own
 * reservation, so this is the second one. Found the same way — by asking the
 * formatter over the worst cases rather than restating its output, so the fit and
 * the print have one owner.
 *
 * **One case covers every hull in the game, and that is the whole reason the hull
 * on this line is a share.** In points a raider's 81 is two digits and a miner's
 * 215 three, so a fit built on the raider's reading clips a Traffic line — and
 * the fit *was* built on the raider's reading, because until #395 nothing else
 * was ever selected and shot at. A percent is three digits and a sign at both
 * ends of the roster, from a patrol's 85 to a capital's 2635, so the widest case
 * does not read the hull table at all. `tests/duel-hud.test.ts` holds that over
 * every hull's walk to its kill: put a point figure back on this line and that
 * row goes red instead of a callsign losing its last character on the glass.
 */
export function targetConditionWidest(): string {
	// Typed as the print's own `ConditionPrint`, not as a whole `ShipCondition`:
	// the widest reading is a question about four figures, and building a full
	// condition to ask it meant naming three fields this function can neither see
	// nor vary, and giving each of them a value it is not entitled to choose.
	const base: ConditionPrint = {
		fore: SHIELD_POOL,
		aft: SHIELD_POOL,
		hull: 1,
		hullMax: 1,
	};
	// One case, not a sweep, and the reason is in each of the three figures: both
	// pools are clamped to `SHIELD_POOL` by `stepCondition`, and the hull is a
	// percent that reads 100 at both ends of the roster. A zeroed pool is therefore
	// never wider than this one — `0` is one character and `106` is three. It still
	// goes through the formatter rather than being spelled out, so the fit cannot
	// drift from the print, and `tests/duel-hud.test.ts` holds that this string is
	// actually attained rather than a guess with room in it.
	return targetConditionLine(base).text;
}

/** The hostile cue's tone: amber, and red while the raider fires. */
export const raiderCueTone = (raiderFiring: boolean): FloorTone =>
	raiderFiring ? "refused" : "action";

/**
 * Whether the on-target mark is drawn: a shot along the sightline would land
 * **and** the duel is on. The raider is selectable from the contest, but the
 * contest flies no duel step, so a shot there does nothing and a mark would
 * promise one that does.
 */
export const onTargetMark = (
	phase: EncounterPhase | null,
	inSights: boolean,
): boolean => phase === "duel" && inSights;

/**
 * Whether the glass combat row shows: while a raider is contesting or
 * dueling, or while one is the selected target. Otherwise the floor carries
 * nothing of combat.
 */
export function showDuelRow(state: {
	encounterPhase: EncounterPhase | null;
	targetIsRaider: boolean;
}): boolean {
	return (
		state.targetIsRaider ||
		state.encounterPhase === "contest" ||
		state.encounterPhase === "duel"
	);
}
