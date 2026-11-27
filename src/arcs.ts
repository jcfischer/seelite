import {
	type CarrierKey,
	carrierKey,
	compareCarrierKeys,
	systemIndexOfKey,
} from "./carrier-key";
import { type DeficitMap, readDeficit } from "./deficits";
import { DOMAIN } from "./domains";
import { distanceLy, type SystemRecord } from "./galaxy";
import { reachable } from "./galaxy-route";
import {
	type BindContext,
	type BountyTarget,
	bindBounty,
	bindCourier,
	bindProcurement,
	canPostJobs,
	deliveryCandidates,
	type JobFamily,
	type JobOffer,
	type JobStationRef,
	NO_EXCLUDED_STATION,
	PROCUREMENT_MIN_DEFICIT_T,
} from "./jobs";
import { marketStationOf, stationCommodities } from "./market";
import { RAIDER_LEG_CHANCE, raiderLegChance } from "./raider-slots";
import { mix } from "./rng";
import type { Station, SystemContents } from "./system";

export type QuestionKind = "raiders-on-route" | "unexplained-shortage";

export const ARC_MIN_STEPS = 3;
export const ARC_MAX_STEPS = 6;
export const ARC_MIN_FAMILIES = 2;
export const ARC_MIN_SYSTEMS = 2;
/** Share of the foreseen step rewards paid for the answer, rounded to 10 Cr. */
export const ANSWER_PAYOUT_SHARE = 0.5;
/** A shortage opens an arc at this many times the procurement floor. */
export const SHORTAGE_DEFICIT_FACTOR = 2;
/** Raiders open an arc where the leg chance is at least the anarchy figure's
 *  midpoint with the corporate one. */
export const RAIDER_OPEN_CHANCE =
	(RAIDER_LEG_CHANCE.anarchy + RAIDER_LEG_CHANCE.corporate) / 2;

const BRANCH_LIMIT = 5;
const ANSWER_FAMILY: Readonly<Record<QuestionKind, JobFamily>> = {
	"raiders-on-route": "bounty",
	"unexplained-shortage": "procurement",
};

/**
 * D6: the home each family's mark lands in, and whether the world heals it.
 * A deficit decays (§5.5), a destroyed relay is replaced, a stripped wreck
 * container stays empty, so Salvage is not composable.
 */
export const HEALING_HOME: Readonly<Record<JobFamily, boolean>> = {
	courier: true,
	procurement: true,
	bounty: true,
	salvage: false,
};

/** The reason a row may not be a step, or null when it may. */
export const refuseStep = (offer: { family: JobFamily }): string | null =>
	HEALING_HOME[offer.family]
		? null
		: `the ${offer.family} mark has no home the world heals`;

/** Everything the composer may read. */
export interface ArcWorld {
	galaxyIndex: number;
	systems: readonly SystemRecord[];
	contentsOf: (record: SystemRecord) => SystemContents;
	deficits: DeficitMap;
	gameTimeMin: number;
	maxJump: number;
	holdT: number;
	bountyTargetOf: (record: SystemRecord) => BountyTarget | null;
	settledAt?: (key: CarrierKey) => Readonly<Record<string, number>>;
}

export interface ArcStep {
	offerId: string;
	family: JobFamily;
	requester: JobStationRef;
	reportAt: JobStationRef;
	payCr: number;
	distanceLy: number;
}

export interface Arc {
	kind: QuestionKind;
	question: string;
	requester: JobStationRef;
	requesterName: string;
	answerFamily: JobFamily;
	answerPayoutCr: number;
	foreseen: readonly string[];
	taken: readonly ArcStep[];
}

export type OpenResult = { ok: true; arc: Arc } | { ok: false; reason: string };

export type NextResult =
	| {
			kind: "step";
			offer: JobOffer;
			flownLy: number;
			rerouted: boolean;
	  }
	| { kind: "answer"; bonusCr: number; text: string }
	| { kind: "none"; reason: string };

interface Cand {
	offer: JobOffer;
	flownLy: number;
}

const boardRow = (offer: JobOffer | null): offer is JobOffer =>
	offer !== null &&
	// Stryker disable next-line ConditionalExpression: the board binds only Courier, Procurement and Bounty, so this drops none
	refuseStep(offer) === null;

const keyOf = (record: SystemRecord, station: Station): CarrierKey =>
	carrierKey(record.index, station.localCarrierId);

const roundTo10 = (cr: number): number => Math.round(cr / 10) * 10;

class Planner {
	private readonly boards = new Map<string, JobOffer[]>();
	private readonly neighbourhoods = new Map<number, SystemRecord[]>();
	private readonly contents = new Map<number, SystemContents>();

	constructor(
		readonly world: ArcWorld,
		readonly answerFamily: JobFamily,
		readonly answerScope: AnswerScope,
	) {}

	system(index: number): SystemRecord {
		const record = this.world.systems.find((s) => s.index === index);
		if (!record) throw new Error(`arcs: no system ${index}`);
		return record;
	}

	contentsOf(record: SystemRecord): SystemContents {
		let c = this.contents.get(record.index);
		// Stryker disable next-line ConditionalExpression: the cache saves asking twice only; a miss asks for the same contents
		if (!c) {
			c = this.world.contentsOf(record);
			// Stryker disable next-line CallExpression: a miss that files nothing recomputes the same contents
			this.contents.set(record.index, c);
		}
		return c;
	}

	reach(record: SystemRecord): SystemRecord[] {
		let list = this.neighbourhoods.get(record.index);
		// Stryker disable next-line ConditionalExpression: the cache saves a second walk only; a miss walks the same systems
		if (!list) {
			list = [
				record,
				...reachable(this.world.systems, record, this.world.maxJump),
			];
			// Stryker disable next-line CallExpression: a miss that files nothing recomputes the same neighbourhood
			this.neighbourhoods.set(record.index, list);
		}
		return list;
	}

	board(record: SystemRecord, station: Station): JobOffer[] {
		const key = keyOf(record, station);
		const hit = this.boards.get(key);
		// Stryker disable next-line ConditionalExpression: the cache saves rebinding only; a rebuild binds the same offers
		if (hit) return hit;
		const ctx: BindContext = {
			galaxyIndex: this.world.galaxyIndex,
			system: record,
			station,
			destinations: deliveryCandidates(
				this.world.systems,
				record,
				(r) => this.contentsOf(r),
				NO_EXCLUDED_STATION,
				this.world.maxJump,
			).filter((d) => keyOf(d.system, d.station) !== key),
			deficits: this.world.deficits,
			gameTimeMin: this.world.gameTimeMin,
			settled: this.world.settledAt?.(key) ?? {},
			bountyTarget: this.world.bountyTargetOf(record),
			// Stryker disable next-line ArrayDeclaration: the composer binds no Salvage row, so no binder reads this list
			salvageTargets: [],
			holdT: this.world.holdT,
		};
		const offers = canPostJobs(station)
			? [bindCourier(ctx), bindProcurement(ctx), bindBounty(ctx)].filter(
					boardRow,
				)
			: [];
		// Stryker disable next-line CallExpression: a miss that files nothing rebinds the same offers
		this.boards.set(key, offers);
		return offers;
	}

	candidates(fromSystem: number, used: ReadonlySet<CarrierKey>): Cand[] {
		const here = this.system(fromSystem);
		const out: Cand[] = [];
		for (const record of this.reach(here)) {
			const hop = distanceLy(here.pos, record.pos);
			for (const station of this.contentsOf(record).stations) {
				const key = keyOf(record, station);
				if (used.has(key)) continue;
				for (const offer of this.board(record, station))
					out.push({ offer, flownLy: hop + offer.distanceLy });
			}
		}
		return out.sort(
			(a, b) =>
				a.flownLy - b.flownLy ||
				compareCarrierKeys(
					a.offer.requester.carrierKey,
					b.offer.requester.carrierKey,
				) ||
				a.offer.id.localeCompare(b.offer.id),
		);
	}

	isAnswer(offer: JobOffer): boolean {
		return matchesAnswer(offer, this.answerFamily, this.answerScope);
	}
}

interface AnswerScope {
	key: CarrierKey | null;
	system: number;
}

const matchesAnswer = (
	step: { family: JobFamily; requester: JobStationRef },
	family: JobFamily,
	scope: AnswerScope,
): boolean =>
	step.family === family &&
	systemIndexOfKey(step.requester.carrierKey) === scope.system &&
	(scope.key === null || step.requester.carrierKey === scope.key);

const reportSystem = (step: { reportAt: JobStationRef }): number =>
	systemIndexOfKey(step.reportAt.carrierKey);

const requesterSystem = (step: { requester: JobStationRef }): number =>
	systemIndexOfKey(step.requester.carrierKey);

const stepOf = (offer: JobOffer, flownLy: number): ArcStep => ({
	offerId: offer.id,
	family: offer.family,
	requester: offer.requester,
	reportAt: offer.reportAt,
	payCr: offer.rewardCr,
	distanceLy: flownLy,
});

export const systemsOf = (steps: readonly ArcStep[]): Set<number> => {
	const s = new Set<number>();
	for (const step of steps) {
		s.add(requesterSystem(step));
		s.add(systemIndexOfKey(step.reportAt.carrierKey));
	}
	return s;
};

const ARC_LENGTHS: readonly number[] = [
	ARC_MIN_STEPS,
	ARC_MIN_STEPS + 1,
	ARC_MIN_STEPS + 2,
	ARC_MAX_STEPS,
];

const preferredFirst = (cands: Cand[], id: string | undefined): Cand[] => {
	const i = cands.findIndex((c) => c.offer.id === id);
	// Stryker disable next-line EqualityOperator: a rebuild at index 0 is the same list
	if (i < 0) return cands;
	return [cands[i], ...cands.slice(0, i), ...cands.slice(i + 1)];
};

function route(
	planner: Planner,
	taken: readonly ArcStep[],
	start: number,
	prefer: string | undefined,
): Cand[] | null {
	for (const total of ARC_LENGTHS) {
		const remaining = total - taken.length;
		if (remaining < 1) continue;
		const used = new Set<CarrierKey>(taken.map((s) => s.requester.carrierKey));
		const found = search(
			planner,
			{ taken, pos: start, remaining, used, path: [] },
			preferredFirst(planner.candidates(start, used), prefer),
		);
		if (found) return found;
	}
	return null;
}

interface SearchState {
	taken: readonly ArcStep[];
	pos: number;
	remaining: number;
	used: Set<CarrierKey>;
	path: Cand[];
}

function search(
	planner: Planner,
	state: SearchState,
	cands: Cand[],
): Cand[] | null {
	const { taken, remaining, used, path } = state;
	const sofar = [...taken, ...path.map((c) => stepOf(c.offer, c.flownLy))];
	// Stryker disable next-line EqualityOperator: a search never starts with fewer than one step left
	if (remaining === 1) {
		for (const c of cands) {
			if (!planner.isAnswer(c.offer)) continue;
			const all = [...sofar, stepOf(c.offer, c.flownLy)];
			if (
				new Set(all.map((s) => s.family)).size >= ARC_MIN_FAMILIES &&
				systemsOf(all).size >= ARC_MIN_SYSTEMS
			)
				return [...path, c];
		}
		return null;
	}
	const mids = cands.filter((c) => !planner.isAnswer(c.offer));
	let tried = 0;
	for (const c of mids) {
		if (tried++ >= BRANCH_LIMIT) break;
		used.add(c.offer.requester.carrierKey);
		const found = search(
			planner,
			{
				taken,
				pos: reportSystem(c.offer),
				remaining: remaining - 1,
				used,
				path: [...path, c],
			},
			planner.candidates(reportSystem(c.offer), used),
		);
		used.delete(c.offer.requester.carrierKey);
		if (found) return found;
	}
	return null;
}

interface Deficit {
	good: string;
	units: number;
}

// Stryker disable next-line ObjectLiteral, StringLiteral: every market lists a legal tonne good, so this fallback is never returned
const NO_DEFICIT: Deficit = { good: "", units: 0 };

const deficitOfNote = (
	world: ArcWorld,
	record: SystemRecord,
	station: Station,
): Deficit => {
	const key = keyOf(record, station);
	let best: Deficit | null = null;
	for (const c of stationCommodities(marketStationOf(station, record.seed))) {
		if (c.illegal || c.unit !== "t") continue;
		const units = readDeficit(world.deficits, key, c.name, world.gameTimeMin);
		if (!best || units > best.units) best = { good: c.name, units };
	}
	return best ?? NO_DEFICIT;
};

const kindOrder = (
	world: ArcWorld,
	record: SystemRecord,
	station: Station,
): QuestionKind[] => {
	// Stryker disable next-line EqualityOperator: the midpoint sits at government 3.5, so no integer government lands on it
	const raiders = raiderLegChance(record.government) >= RAIDER_OPEN_CHANCE;
	const shortage =
		deficitOfNote(world, record, station).units >=
		SHORTAGE_DEFICIT_FACTOR * PROCUREMENT_MIN_DEFICIT_T;
	const kinds: QuestionKind[] = [];
	if (raiders) kinds.push("raiders-on-route");
	if (shortage) kinds.push("unexplained-shortage");
	const coin =
		mix(mix(station.berthSeed ^ station.assemblySeed, DOMAIN.JOB_OFFERS), 77) &
		1;
	if (coin) kinds.reverse();
	return kinds;
};

const questionText = (
	kind: QuestionKind,
	world: ArcWorld,
	record: SystemRecord,
	station: Station,
): string =>
	kind === "raiders-on-route"
		? `Who is sending raiders down the cruise lanes out of ${record.name}?`
		: `Why is ${station.name} short of ${deficitOfNote(world, record, station).good}?`;

/**
 * Opens an arc on a question at `station`, or refuses with a reason.
 *
 * It opens only if a route of 3 to 6 steps exists over at least two families
 * and two systems, each hop inside the hull's reach (D10).
 */
export function openArc(
	world: ArcWorld,
	record: SystemRecord,
	station: Station,
): OpenResult {
	if (!canPostJobs(station))
		return { ok: false, reason: `${station.name} posts no work` };
	const kinds = kindOrder(world, record, station);
	if (kinds.length === 0)
		return { ok: false, reason: `${station.name} has no question to ask` };
	const reqKey = keyOf(record, station);
	const reasons: string[] = [];
	for (const kind of kinds) {
		const planner = new Planner(
			world,
			ANSWER_FAMILY[kind],
			scopeFor(kind, reqKey),
		);
		const plan = route(planner, [], record.index, undefined);
		if (!plan) {
			reasons.push(
				`no route of ${ARC_MIN_STEPS}-${ARC_MAX_STEPS} steps answers ${kind}`,
			);
			continue;
		}
		const total = plan.reduce((sum, c) => sum + c.offer.rewardCr, 0);
		return {
			ok: true,
			arc: {
				kind,
				question: questionText(kind, world, record, station),
				requester: { galaxyIndex: world.galaxyIndex, carrierKey: reqKey },
				requesterName: station.name,
				answerFamily: ANSWER_FAMILY[kind],
				answerPayoutCr: roundTo10(total * ANSWER_PAYOUT_SHARE),
				foreseen: plan.map((c) => c.offer.id),
				taken: [],
			},
		};
	}
	return { ok: false, reason: reasons.join("; ") };
}

/** The arc with one more reported step. */
export const recordStep = (
	arc: Arc,
	step: { offer: JobOffer; flownLy: number },
): Arc => ({
	...arc,
	taken: [...arc.taken, stepOf(step.offer, step.flownLy)],
});

const scopeFor = (
	kind: QuestionKind,
	requesterKey: CarrierKey,
): AnswerScope => ({
	key: kind === "unexplained-shortage" ? requesterKey : null,
	system: systemIndexOfKey(requesterKey),
});

const answerScopeOf = (arc: Arc): AnswerScope =>
	scopeFor(arc.kind, arc.requester.carrierKey);

const resolved = (arc: Arc): boolean => {
	const scope = answerScopeOf(arc);
	return arc.taken.some((s) => matchesAnswer(s, arc.answerFamily, scope));
};

/**
 * Names the next step, the answer, or that there is no route.
 *
 * Replans from the previous report station against the world as it is, so a
 * step that drifted out of binding is never returned: a planned step is only
 * kept while it is still part of a valid route.
 */
export function nextStep(arc: Arc, world: ArcWorld): NextResult {
	if (resolved(arc))
		return {
			kind: "answer",
			bonusCr: arc.answerPayoutCr,
			text: `Answered: ${arc.question}`,
		};
	if (arc.taken.length >= ARC_MAX_STEPS)
		return { kind: "none", reason: "the arc spent its steps unanswered" };
	const planner = new Planner(world, arc.answerFamily, answerScopeOf(arc));
	const last = arc.taken[arc.taken.length - 1];
	const start = last
		? reportSystem(last)
		: systemIndexOfKey(arc.requester.carrierKey);
	const plan = route(planner, arc.taken, start, arc.foreseen[arc.taken.length]);
	if (!plan)
		return { kind: "none", reason: "no route reaches the answer from here" };
	const first = plan[0];
	return {
		kind: "step",
		offer: first.offer,
		flownLy: first.flownLy,
		rerouted: first.offer.id !== arc.foreseen[arc.taken.length],
	};
}

/** Total ly flown over an arc's taken steps. */
export const flownLyOf = (arc: Arc): number =>
	arc.taken.reduce((sum, s) => sum + s.distanceLy, 0);
