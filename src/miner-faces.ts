/**
 * What the Longwall bridge's mining faces read
 * (https://github.com/jcfischer/seelite/issues/1198). The study places survey,
 * ore, drill, anchor, stance and lasers on the miner's console; the drill
 * camera has no producer, so its screen stays unpowered.
 */
export const MINER_FACE_SCREENS = [
	"survey",
	"ore",
	"drill",
	"anchor",
	"stance",
	"lasers",
] as const;
export type MinerFaceScreen = (typeof MINER_FACE_SCREENS)[number];

const AMBER = "#ffb347";
const GREEN = "#6dff9a";
const PALE = "#d8f6ff";
const QUIET = "#9fb7c0";
const REFUSAL = "#ff4a3a";

export const MINER_FACE_TITLES: Readonly<Record<MinerFaceScreen, string>> = {
	survey: "SURVEY",
	ore: "ORE / HOLD",
	drill: "DRILL CONTACT",
	anchor: "ANCHOR",
	stance: "SHIP STANCE",
	lasers: "LASER",
};

export type MinerFaceRow = readonly [text: string, colour: string];

export interface MinerFaceState {
	readonly mining: boolean;
	readonly surveyDesignation: string | null;
	readonly minedT: number;
	readonly holdLabel: string;
	readonly holdUsedT: number;
	readonly holdCapacityT: number;
	readonly fireGroup: string;
	readonly heatPercent: number;
	readonly energyPercent: number;
	readonly drill: {
		readonly block: string | null;
		readonly gapM: number | null;
		readonly anchored: boolean;
		readonly anchorWhy: string;
		readonly feetOnRock: number;
	};
}

const GRIPPED = ["NO FEET", "ONE FOOT", "TWO FEET", "THREE FEET", "FOUR FEET"];

const OFF: readonly MinerFaceRow[] = [["MINING OFF", QUIET]];

/** Each face's rows, from live game state only. */
export function minerFaceRows(
	s: MinerFaceState,
): Readonly<Record<MinerFaceScreen, readonly MinerFaceRow[]>> {
	const d = s.drill;
	const contact = d.block === null;
	const idle = d.block === "STOWED" || d.block === "DEPLOYING";
	const gap: MinerFaceRow[] =
		d.gapM === null ? [] : [[`GAP ${d.gapM.toFixed(1)} M`, PALE]];
	return {
		survey: !s.mining
			? OFF
			: s.surveyDesignation
				? s.surveyDesignation
						.split(" · ")
						.slice(0, 3)
						.map((part): MinerFaceRow => [part, GREEN])
				: [["NO ROCK TARGETED", QUIET]],
		ore: [
			[`ORE ${s.minedT} T`, AMBER],
			[`${s.holdLabel} ${Math.round(s.holdUsedT)}/${s.holdCapacityT} T`, AMBER],
		],
		drill: !s.mining
			? OFF
			: [
					[
						contact ? "CONTACT" : (d.block as string),
						contact ? GREEN : idle ? QUIET : REFUSAL,
					],
					...gap,
				],
		anchor: !s.mining
			? OFF
			: [
					[`${GRIPPED[d.feetOnRock]} GRIPPED`, AMBER],
					d.anchored ? ["ANCHORED", GREEN] : [d.anchorWhy, QUIET],
				],
		stance: !s.mining
			? OFF
			: [
					[
						`${d.feetOnRock}/4 FEET GRIPPED`,
						d.feetOnRock === 4 ? GREEN : AMBER,
					],
				],
		lasers: [
			[s.fireGroup, PALE],
			[`HEAT ${s.heatPercent}%`, AMBER],
			[`ENERGY ${s.energyPercent}%`, GREEN],
		],
	};
}
