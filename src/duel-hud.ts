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
	SHIELD_POOL,
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
		hull: `${Math.round(c.hull)} / ${c.hullMax}`,
		bank: `${Math.round(c.energy)} / ${ENERGY_BANK}`,
		heat: heatValue(c),
	};
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
