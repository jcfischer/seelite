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
import { HULL_SPECS, PURCHASABLE_HULL_IDS, stockPlant } from "./hull";
import {
	HEAT_LOCK,
	HULL_HEAT_RISE_PER_S,
	HULL_TEMP_AMBIENT,
	HULL_TEMP_COOL_TAU_S,
	HULL_TEMP_TOP,
	printHull,
	printHullPercent,
	printShieldPercent,
	type ConditionPrint,
	type ShipCondition,
} from "./ship-condition";

/** The largest shield pool among the hulls a pilot can fly: the widest figure
 *  the pilot's own shield cell can print, now that each hull has its own pool
 *  (#866). */
const widestPool = (): number =>
	Math.max(...PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].shieldPool));

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
	// The row is the pilot's own, so the widest pool is the widest a pilot can
	// fly: a hull a shipyard sells.
	const pool = widestPool();
	const bank = Math.max(
		...PURCHASABLE_HULL_IDS.map((id) => stockPlant(id).bankE),
	);
	const base: ShipCondition = {
		fore: pool,
		aft: pool,
		hull: 1,
		hullMax: 1,
		shieldMax: pool,
		energy: bank,
		energyMax: bank,
		energyRegenPerS: 0,
		boosterDrawPerS: 0,
		heat: 0,
		heatLocked: false,
		sinceStruckS: 0,
		hullTemp: HULL_TEMP_AMBIENT,
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

/** The hull-temperature gauge's label: not `HEAT`, which is the gun's. */
export const HULL_TEMP_LABEL = "TEMP";

/** Hull temperature as the glass prints it: a whole percent of the top, and
 *  never 0% above ambient (`printHullPercent`'s floor, for the same reason). */
const hullTempPercent = (hullTemp: number): number =>
	Math.max(1, Math.round((hullTemp / HULL_TEMP_TOP) * 100));

/**
 * The hull-temperature gauge (#931, #871 D6): one cell in the duel band while
 * the hull is above ambient, and nothing at ambient. Amber at the gun's
 * `HEAT_ACTION_FRACTION` of the top — close enough that staying costs hull —
 * and red above the top, where it does. The tone reads the printed percent.
 */
export function hullTempCells(c: Pick<ShipCondition, "hullTemp">): FloorCell[] {
	if (!(c.hullTemp > HULL_TEMP_AMBIENT)) return [];
	const percent = hullTempPercent(c.hullTemp);
	const tone: FloorTone =
		percent > 100
			? "refused"
			: percent >= HEAT_ACTION_FRACTION * 100
				? "action"
				: "passive";
	return [{ label: HULL_TEMP_LABEL, value: `${percent}%`, tone }];
}

/**
 * The widest reading the gauge can print: the hottest a hull gets, settled at
 * the shell, where the rise and the cooling balance. Asked of the formatter,
 * as `duelRowWidest` is.
 */
export function hullTempWidest(): string {
	const hottest = HULL_HEAT_RISE_PER_S * HULL_TEMP_COOL_TAU_S;
	return hullTempCells({ hullTemp: hottest })[0]?.value ?? "";
}

/** The fuel scoop's line (#932, #871 D6). */
export const SCOOP_LABEL = "SCOOPING";

/**
 * The scoop's cell in the duel band, beside the TEMP gauge: `SCOOPING` and the
 * tank in LY while the scoop fills (`stepFuelScoop`'s `filling`), and nothing
 * once it stops — a full tank, the band left, the cruise ended or a bank too
 * low to pay the draw.
 */
export function scoopCells(filling: boolean, fuelLy: number): FloorCell[] {
	if (!filling) return [];
	return [
		{ label: SCOOP_LABEL, value: `${fuelLy.toFixed(1)} LY`, tone: "passive" },
	];
}

/**
 * The widest tank reading the line can print: two digits. No ship a pilot can
 * fly carries 100 LY, and `tests/scoop-line.test.ts` fills every fuel slot of
 * every such hull to hold that.
 */
export function scoopWidest(): string {
	return scoopCells(true, 99.9)[0]?.value ?? "";
}

/**
 * The duel band's cells before the armed group: SHD and HEAT in combat, the
 * hull temperature while it is above ambient, and the scoop's line while it
 * fills — **but never the scoop's line in combat** (#932, the principal's
 * ruling, 2026-10-12). In combat SHD and HEAT keep their place and the line
 * drops; the scoop still fills. Out of combat the line shows. So SHD, HEAT
 * and SCOOPING never share the row, and the floor's fit takes the row as one
 * or the other.
 *
 * `fighting` is `showDuelRow`: the predicate that already decides whether SHD
 * and HEAT are on the glass.
 */
export function duelBandCells(state: {
	fighting: boolean;
	condition: ShipCondition;
	scooping: boolean;
	fuelLy: number;
}): FloorCell[] {
	return composeDuelBand(state.fighting, {
		duel: duelRowCells(state.condition),
		// Hull temperature, while the hull is above ambient (#931).
		temp: hullTempCells(state.condition),
		scoop: scoopCells(state.scooping, state.fuelLy),
	});
}

/** The one rule both the drawn row and its fit compose by. */
function composeDuelBand(
	fighting: boolean,
	parts: { duel: FloorCell[]; temp: FloorCell[]; scoop: FloorCell[] },
): FloorCell[] {
	return [
		...(fighting ? parts.duel : []),
		...parts.temp,
		...(fighting ? [] : parts.scoop),
	];
}

/**
 * The widest row `duelBandCells` can draw, in combat and out of it: each
 * cell at its widest reading, composed by the same rule. The floor's fit
 * sizes against both, so a cell added to the band reaches the fit too.
 */
export function duelBandWidestRows(): FloorCell[][] {
	const widest = duelRowWidest();
	const cell = (label: string, value: string): FloorCell => ({
		label,
		value,
		tone: "passive",
	});
	const parts = {
		duel: DUEL_ROW_LABELS.map((label) => cell(label, widest[label])),
		temp: [cell(HULL_TEMP_LABEL, hullTempWidest())],
		scoop: [cell(SCOOP_LABEL, scoopWidest())],
	};
	return [true, false].map((fighting) => composeDuelBand(fighting, parts));
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
		fore: `${Math.round(c.fore)} / ${c.shieldMax}`,
		aft: `${Math.round(c.aft)} / ${c.shieldMax}`,
		hull: `${printHull(c.hull)} / ${c.hullMax}`,
		bank: `${Math.round(c.energy)} / ${Math.round(c.energyMax)}`,
		heat: heatValue(c),
	};
}

/**
 * The selected enemy's condition, as the line under its label on the glass
 * (#324, the principal's ruling after the second playtest): shield pools and
 * hull. It is refused while either printed pool is 0, so an open side reads at
 * a glance. Since #866 each hull has its own pool, so both pools print as a
 * share of it, as the hull does (the principal's ruling on #866).
 *
 * **Both pools print, every time.** A carrier cut off from behind loses `aft`
 * while `fore` stands whole, and one met from ahead the other way round; those
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
	const fore = printShieldPercent(c.fore, c.shieldMax);
	const aft = printShieldPercent(c.aft, c.shieldMax);
	return {
		text: `SHD F ${fore}% A ${aft}%  HULL ${printHullPercent(c)}%`,
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
		fore: 1,
		aft: 1,
		shieldMax: 1,
		hull: 1,
		hullMax: 1,
	};
	// One case, not a sweep, and the reason is in each of the three figures: each
	// is a percent that reads 100 at both ends of the roster, since both pools are
	// clamped to the hull's `shieldPool` by `stepCondition` (#866). It still
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
