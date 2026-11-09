import { miningHold, hasOreBay } from "../../src/mining-capacity";
import {
	fieldCentre,
	fieldRocks,
	latticeRocks,
	rockLocal,
	systemFields,
	type FieldPlan,
	type Rock,
} from "../../src/asteroid-field";
import {
	initialCapabilityTime,
	queryCapabilityTime,
	type CapabilityTimeContext,
} from "../../src/capability-time";
import { DEFAULT_CRUISE, legSeconds } from "../../src/cruise";
import { readDeficit, recordTrade, type DeficitMap } from "../../src/deficits";
import { debitAt, RECOVERY_T_PER_H } from "../../src/deposit-state";
import {
	money,
	signedMoney,
	massFromNative,
	quoteFromNumber,
	quoteMass,
	transferCost,
	type Money,
} from "../../src/exact-amount";
import {
	discoverFieldsWithin,
	fieldIsKnown,
	FIELD_DISCOVERY_RADIUS_KM,
} from "../../src/field-discovery";
import { HULL_SPECS, type SlotSize } from "../../src/hull";
import { distanceLy, type SystemRecord } from "../../src/galaxy";
import {
	fittedCapacity,
	fittedMassT,
	loadoutValue,
	makeModule,
	moduleRow,
	parseLoadout,
	stockLoadout,
} from "../../src/loadout";
import { groupLaserRates } from "../../src/laser-modules";
import {
	commodity,
	FUEL_CR_PER_LY,
	marketQuote,
	marketRow,
	shelfQuantity,
	stockResponse,
} from "../../src/market";
import { GRADES, type Grade } from "../../src/module-catalog";
import { fnv1a } from "../../src/rng";
import {
	beginCut,
	oreShare,
	stepCut,
	EXTRACTION,
} from "../../src/rock-extraction";
import {
	beginDrillCut,
	DRILL,
	DRILL_RATES,
	stepDrillCut,
} from "../../src/rock-drill";
import {
	rockContents,
	ORE_FAMILIES,
	ORE_GRADES,
	surveyFigures,
	surveyReading,
	type OreFamily,
	type OreGrade,
	type RockContents,
} from "../../src/rock-survey";
import { fullCondition, stepCondition } from "../../src/ship-condition";
import { CANISTER_SCOOP_CHARGE_E } from "../../src/scoop-window";
import { flightPerformance, ASSIST_CAP_KMS } from "../../src/sim";
import { placeBodies } from "../../src/system";
import { length, sub } from "../../src/vec3";
import { organicRocks } from "../../spikes/field-shape-1043/organic";
import { serviceCalendar } from "./mining-service";
import { recipeFor, productMarketBid } from "./mining-batch";
import {
	DOCK_SECONDS,
	jumpSeconds,
	portsOf,
	run,
	worldFor,
	type Port,
	type World,
} from "./greedy-trader";

export interface FitInput {
	hull: "courier" | "miner";
	size: SlotSize;
	grade: Grade;
}
export interface Candidate {
	id: string;
	provenance: string;
	seeds: number[];
	galaxies: number[];
	systemsPerWorld: number;
	hours: number;
	startCr: number;
	dockS: number;
	loadouts: FitInput[];
	recoveryTPerH: number;
	surveyLifetimeH: number;
	rawValueShare: number;
	rawStockMinT: number;
	rawStockMaxT: number;
	feeCrPerT: number;
	serviceSPerT: number;
	drillTPerS: number;
	positioningKm: number;
	positioningFloorS: number;
	searchRareS: number;
	fragmentS: number;
	fragmentKeepShare: number;
	goodMinimumGrade: OreGrade;
	rockLimit: number;
	returnLoadT?: number;
	visitLargestShare?: number;
	fieldLayout?: "baseline" | "organic" | "production";
	onePass?: boolean;
	rawElasticityScale?: number;
	collectS?: number;
	feeShareOfProduct?: number;
	routeFields?: number;
	routeRevisitLoadT?: number;
	routeChartedFindS?: number;
	routeReferenceHours?: number;
}

const OPTIONAL_FIELDS = [
	"returnLoadT",
	"visitLargestShare",
	"fieldLayout",
	"onePass",
	"rawElasticityScale",
	"collectS",
	"feeShareOfProduct",
	"routeFields",
	"routeRevisitLoadT",
	"routeChartedFindS",
	"routeReferenceHours",
] as const satisfies readonly (keyof Candidate)[];

/** Unratified design inputs authorized by https://github.com/jcfischer/seelite/issues/922 */
export function candidateDefaults(): Candidate {
	return {
		id: "mining-v1-unratified",
		rockLimit: 100000,
		provenance:
			"node922 principal ruling 2026-11-07; proposed inputs, no balance approval",
		seeds: [1, 47, 1234],
		galaxies: [0, 1],
		systemsPerWorld: 4,
		hours: 1,
		startCr: 10000,
		dockS: DOCK_SECONDS,
		loadouts: [
			...["E", "D", "A"].map((grade) => ({
				hull: "courier" as const,
				size: 1 as const,
				grade: grade as Grade,
			})),
			...[1, 2, 3].flatMap((size) =>
				GRADES.map((grade) => ({
					hull: "miner" as const,
					size: size as SlotSize,
					grade,
				})),
			),
		],
		recoveryTPerH: 1,
		surveyLifetimeH: 24,
		rawValueShare: 0.55,
		rawStockMinT: 8,
		rawStockMaxT: 63,
		feeCrPerT: 1,
		serviceSPerT: 30,
		drillTPerS: 0.1,
		positioningKm: 0.1,
		positioningFloorS: 12,
		searchRareS: 600,
		fragmentS: 3,
		fragmentKeepShare: 0.9,
		goodMinimumGrade: "standard",
	};
}
const valid = (
	name: string,
	n: number,
	min = 0,
	max = Number.MAX_SAFE_INTEGER,
) => {
	if (!Number.isFinite(n) || n < min || n > max)
		throw new Error(`mining comparison: invalid ${name}`);
	return n;
};
const integer = (
	name: string,
	n: number,
	min = 0,
	max = Number.MAX_SAFE_INTEGER,
) => {
	valid(name, n, min, max);
	if (!Number.isSafeInteger(n))
		throw new Error(`mining comparison: invalid whole ${name}`);
	return n;
};
function validate(c: Candidate) {
	const required = Object.keys(candidateDefaults());
	if (
		Object.keys(c).some(
			(k) =>
				!required.includes(k) && !OPTIONAL_FIELDS.some((name) => name === k),
		) ||
		required.some((k) => !(k in c))
	)
		throw new Error(
			"mining comparison: unsupported or missing candidate field",
		);
	integer("rock selection limit", c.rockLimit, 1, 100000);
	if (c.onePass !== undefined && typeof c.onePass !== "boolean")
		throw new Error("mining comparison: onePass must be a boolean");
	if (c.returnLoadT !== undefined) valid("return load", c.returnLoadT, 1);
	if (c.visitLargestShare !== undefined)
		valid("visited rock share", c.visitLargestShare, 0.001, 1);
	if (c.rawElasticityScale !== undefined)
		valid("raw elasticity scale", c.rawElasticityScale, 0, 1);
	if (c.collectS !== undefined) valid("collection seconds", c.collectS, 0.01);
	if (c.feeShareOfProduct !== undefined)
		valid("fee share", c.feeShareOfProduct, 0, 1);
	if (
		c.fieldLayout !== undefined &&
		c.fieldLayout !== "baseline" &&
		c.fieldLayout !== "organic" &&
		c.fieldLayout !== "production"
	)
		throw new Error("mining comparison: unsupported field layout");
	if (c.routeFields === undefined) {
		if (
			c.routeRevisitLoadT !== undefined ||
			c.routeChartedFindS !== undefined ||
			c.routeReferenceHours !== undefined
		)
			throw new Error("mining comparison: route inputs need routeFields");
	} else {
		integer("route fields", c.routeFields, 1, 64);
		valid("route revisit load", c.routeRevisitLoadT ?? Number.NaN, 1);
		if (c.routeChartedFindS !== undefined)
			valid("charted finding seconds", c.routeChartedFindS);
		if (c.routeReferenceHours !== undefined)
			valid("reference hours", c.routeReferenceHours, 0.01, 24);
		if (c.onePass !== true || c.loadouts?.some((fit) => fit.hull !== "miner"))
			throw new Error(
				"mining comparison: a route flies the one-pass miner pilot",
			);
	}
	if (!c.id?.trim() || !c.provenance?.trim())
		throw new Error(
			"mining comparison: candidate identity and provenance required",
		);
	for (const [k, v] of Object.entries(c))
		if (typeof v === "number") valid(k, v);
	valid("hours", c.hours, 0.01, 24);
	valid("serviceSPerT", c.serviceSPerT, 0.01, 86400);
	valid("survey lifetime", c.surveyLifetimeH, 1 / 3600, 8760);
	valid("drill rate", c.drillTPerS, 0.0001, 100);
	valid("fragment share", c.fragmentKeepShare, 0, 1);
	valid("raw share", c.rawValueShare, 0.001, 10);
	valid("fragment seconds", c.fragmentS, 0.01, EXTRACTION.lifetimeS - 0.01);
	integer("systems", c.systemsPerWorld, 1, 256);
	integer("raw stock min", c.rawStockMinT, 0, 63);
	integer("raw stock max", c.rawStockMaxT, c.rawStockMinT, 63);
	if (
		!ORE_GRADES.includes(c.goodMinimumGrade) ||
		!c.seeds?.length ||
		!c.galaxies?.length ||
		!c.loadouts?.length
	)
		throw new Error("mining comparison: empty or invalid corpus");
	for (const seed of c.seeds) integer("seed", seed, 0, 0xffffffff);
	for (const g of c.galaxies) integer("galaxy", g, 0, 7);
	for (const fit of c.loadouts) makeMiningFit(fit.hull, fit.size, fit.grade);
}
export function makeMiningFit(
	hull: FitInput["hull"],
	size: SlotSize,
	grade: Grade,
) {
	if (
		!["courier", "miner"].includes(hull) ||
		![1, 2, 3].includes(size) ||
		!GRADES.includes(grade)
	)
		throw new Error("mining comparison: unsupported fit");
	const stock = stockLoadout(hull);
	const loadout = parseLoadout(
		{
			...stock,
			plant: makeModule("power-plant", HULL_SPECS[hull].plantSize, grade),
			h1: makeModule("mining-laser", size, grade),
		},
		hull,
	);
	const capacity = fittedCapacity(hull, loadout);
	if (capacity.scoopRadiusKm <= 0 || capacity.holdT < 1)
		throw new Error("mining comparison: fitted scoop and hold required");
	return {
		loadout,
		capacity,
		massT: fittedMassT(hull, loadout),
		investmentCr: (HULL_SPECS[hull].priceCr ?? 0) + loadoutValue(loadout),
		refitCr:
			loadoutValue(loadout) -
			loadoutValue(stock) +
			(moduleRow(stock.h1).priceCr +
				(grade !== "E" ? moduleRow(stock.plant).priceCr : 0)) *
				0.1,
	};
}

/** Candidate rate adapter with the shipped whole-tonne recovery law; default is asserted against debitAt. */
export function candidateDebit(
	taken: number,
	at: number,
	t: number,
	rate: number,
) {
	integer("debit", taken);
	valid("debit time", at);
	valid("clock", t, at);
	valid("recovery", rate);
	return rate === RECOVERY_T_PER_H
		? debitAt(taken, at, t)
		: Math.max(0, taken - Math.floor(((t - at) / 3600) * rate));
}

function completionTime(
	service: (to: number) => number,
	work: number,
	from: number,
	to: number,
) {
	let lo = from,
		hi = to;
	for (let i = 0; i < 48; i++) {
		const mid = (lo + hi) / 2;
		if (service(mid) >= work) hi = mid;
		else lo = mid;
	}
	return hi;
}

export function serviceQueue(
	context: CapabilityTimeContext,
	jobs: readonly { workS: number; submittedAt: number }[],
	to: number,
) {
	valid("queue time", to);
	const anchor = initialCapabilityTime(context, 0);
	let cursor = 0;
	const total = queryCapabilityTime(context, anchor, 0, to);
	return jobs.map((job) => {
		valid("job work", job.workS);
		valid("submission", job.submittedAt, 0, to);
		const start = Math.max(
			cursor,
			queryCapabilityTime(context, anchor, 0, job.submittedAt),
		);
		const available = total - start;
		const workLeftS = Math.max(0, job.workS - available);
		if (workLeftS > 0) {
			cursor = total;
			return { ...job, workLeftS, completedAt: null as number | null };
		}
		const hi = completionTime(
			(mid) => queryCapabilityTime(context, anchor, 0, mid),
			start + job.workS,
			job.submittedAt,
			to,
		);
		cursor = start + job.workS;
		return { ...job, workLeftS, completedAt: hi };
	});
}
const rawName = (family: OreFamily, grade: OreGrade) =>
	`ore:${family}:${grade}`;
const price = (cr: number, units: number, unitG = 1_000_000) =>
	quoteMass(
		quoteFromNumber(valid("quote", cr)),
		massFromNative(integer("native units", units), unitG),
		unitG,
	);
const approximate = (ticks: bigint) =>
	Number((ticks * 1_000_000n) / money.fromNumber(1)) / 1_000_000;

/** Explicit proposed market law: product-equivalent generated mid times raw share; shipped spread, shelves and deficits. */
export function rawQuote(
	port: Port,
	family: OreFamily,
	grade: OreGrade,
	t: number,
	deficits: DeficitMap,
	holdT: number,
	c: Candidate,
) {
	const recipe = recipeFor(family, grade);
	const good = commodity(recipe.product);
	const row = marketRow(good, port.record.economy, port.market, t / 60);
	const mark = readDeficit(deficits, port.key, rawName(family, grade), t / 60);
	const mid =
		((row.priceCr * recipe.yieldGPerT) / recipe.nativeUnitG) * c.rawValueShare;
	const responded = stockResponse(mid, mark, holdT);
	const quote = marketQuote(
		c.rawElasticityScale === undefined
			? responded
			: mid + (responded - mid) * c.rawElasticityScale,
		port.record.displayTL,
	);
	const epoch = Math.floor((t / 60 + port.market.phaseMin) / 30);
	const generated =
		c.rawStockMinT +
		(fnv1a(`${port.market.seed}/${family}/${grade}/${epoch}/922-stock`) %
			(c.rawStockMaxT - c.rawStockMinT + 1));
	return { ...quote, stockT: shelfQuantity(generated, mark) };
}
interface Cargo {
	family: OreFamily;
	grade: OreGrade;
	tonnes: number;
	basis: Money;
}
interface Job {
	family: OreFamily;
	grade: OreGrade;
	inputT: number;
	workLeftS: number;
	productG: number;
	collectedG: number;
	port: Port;
	submittedAt: number;
	doneAt: number | null;
	basis: Money;
	startedAt: number | null;
}
interface Debit {
	taken: number;
	at: number;
	surveyedAt?: number;
}

interface FieldStock {
	rocks: Rock[];
	deposits: RockContents[];
}
interface ReachMap {
	distanceLy: number[];
	previous: (number | null)[];
}
interface ComparisonCache {
	baselines: Map<string, ReturnType<typeof run>>;
	services: Map<string, ReturnType<typeof serviceCalendar>>;
	stocks: Map<string, FieldStock>;
	reach: Map<string, ReachMap>;
	references: Map<string, Record<string, Distribution>>;
}
const comparisonCache = (): ComparisonCache => ({
	baselines: new Map(),
	services: new Map(),
	stocks: new Map(),
	reach: new Map(),
	references: new Map(),
});
function chosenRocks(record: SystemRecord, plan: FieldPlan, c: Candidate) {
	const layout =
		c.fieldLayout === "organic"
			? organicRocks(record, plan, "organic")
			: c.fieldLayout === "production"
				? fieldRocks(record, plan)
				: latticeRocks(record, plan);
	const visited =
		c.visitLargestShare === undefined
			? layout
			: [...layout]
					.sort((a, b) => b.radiusKm - a.radiusKm)
					.slice(0, Math.ceil(layout.length * c.visitLargestShare));
	return visited.slice(0, c.rockLimit);
}
function marketPort(world: World, record: SystemRecord): Port | undefined {
	const ports = portsOf(record, world.contentsFor(record));
	return ports.find((p) => p.station.type === "refinery") ?? ports[0];
}
interface RouteContext {
	world: World;
	key: string;
	tankLy: number;
	cache: ComparisonCache;
}
function reachFrom(
	{ world, key, tankLy, cache }: RouteContext,
	origin: number,
): ReachMap {
	const cacheKey = JSON.stringify([key, origin, tankLy]);
	const known = cache.reach.get(cacheKey);
	if (known) return known;
	const count = world.systems.length;
	const hasMarketPort = world.systems.map(
		(record) => marketPort(world, record) !== undefined,
	);
	const distance = new Array<number>(count).fill(Infinity);
	const previous = new Array<number | null>(count).fill(null);
	const settled = new Array<boolean>(count).fill(false);
	distance[origin] = 0;
	for (;;) {
		let here = -1;
		for (let i = 0; i < count; i++)
			if (
				!settled[i] &&
				Number.isFinite(distance[i]) &&
				(here < 0 || distance[i] < distance[here])
			)
				here = i;
		if (here < 0) break;
		settled[here] = true;
		for (const record of world.systems) {
			const i = record.index;
			if (settled[i] || !hasMarketPort[i]) continue;
			const hop = distanceLy(world.systems[here].pos, record.pos);
			if (hop > tankLy) continue;
			if (distance[here] + hop < distance[i]) {
				distance[i] = distance[here] + hop;
				previous[i] = here;
			}
		}
	}
	const reach = { distanceLy: distance, previous };
	cache.reach.set(cacheKey, reach);
	return reach;
}
function hopsBetween(context: RouteContext, from: number, to: number): Port[] {
	const { world } = context;
	const { previous } = reachFrom(context, from);
	const hops: Port[] = [];
	for (let at = to; at !== from; at = previous[at]!) {
		const stop = marketPort(world, world.systems[at]);
		if (!stop || previous[at] === null)
			throw new Error("mining comparison: route leg has no path");
		hops.unshift(stop);
	}
	return hops;
}
interface RouteStop {
	port: Port;
	plan: FieldPlan;
	fromHomeLy: number;
}
function fieldRoute(
	context: RouteContext,
	home: Port,
	start: FieldPlan,
	count: number,
): RouteStop[] {
	const { world } = context;
	const fromHome = reachFrom(context, home.record.index);
	const others = world.systems
		.filter(
			(record) =>
				record.index !== home.record.index &&
				Number.isFinite(fromHome.distanceLy[record.index]),
		)
		.flatMap((record) => {
			const contents = world.contentsFor(record);
			const port = portsOf(record, contents).find(
				(p) => p.station.type === "refinery",
			);
			if (!port) return [];
			return systemFields(record, contents)
				.filter((plan) => plan.profile === start.profile)
				.map((plan) => ({
					port,
					plan,
					fromHomeLy: fromHome.distanceLy[record.index],
				}));
		})
		.sort(
			(a, b) =>
				a.fromHomeLy - b.fromHomeLy ||
				a.port.record.index - b.port.record.index,
		)
		.slice(0, count - 1);
	const route: RouteStop[] = [{ port: home, plan: start, fromHomeLy: 0 }];
	while (others.length) {
		const at = route[route.length - 1].port.record.index;
		const { distanceLy: from } = reachFrom(context, at);
		let best = 0;
		for (let i = 1; i < others.length; i++)
			if (
				from[others[i].port.record.index] < from[others[best].port.record.index]
			)
				best = i;
		route.push(others.splice(best, 1)[0]);
	}
	return route;
}
function secondRefinery(world: World, port: Port, tankLy: number) {
	const record = port.record;
	return world.systems
		.filter(
			(r) =>
				r.index !== record.index && distanceLy(record.pos, r.pos) <= tankLy,
		)
		.sort(
			(a, b) => distanceLy(record.pos, a.pos) - distanceLy(record.pos, b.pos),
		)
		.flatMap((r) => portsOf(r, world.contentsFor(r)))
		.find((p) => p.station.type === "refinery");
}
interface ScenarioInput {
	seed: number;
	galaxy: number;
	port: Port;
	plan: FieldPlan;
	fitInput: FitInput;
	c: Candidate;
	elapsedS: number;
	trade: {
		elapsedS: number;
		activeS: number;
		passiveS: number;
		crPerElapsedMinute: number;
		crPerMinute: number;
		earnedCr: number;
		hops: number;
	};
	path: "raw" | "refine" | "buy-refine" | "refine-parallel";
	buyOre?: { family: OreFamily; grade: OreGrade };
	other?: Port;
	route?: {
		stops: RouteStop[];
		context: RouteContext;
		tradeStalled: boolean;
	};
	cache: ComparisonCache;
}
function scenario({
	seed,
	galaxy,
	port,
	plan,
	fitInput,
	c,
	elapsedS,
	trade,
	path,
	buyOre,
	other,
	route,
	cache,
}: ScenarioInput) {
	const fit = makeMiningFit(fitInput.hull, fitInput.size, fitInput.grade);
	const holdT = Math.floor(fit.capacity.holdT);
	const oreHoldT = miningHold(
		fitInput.hull,
		{ usedT: 0, capacityT: holdT },
		0,
	).capacityT;
	const dedicatedOre = hasOreBay(fitInput.hull);
	const loadLimitT = Math.min(oreHoldT, c.returnLoadT ?? oreHoldT);
	let record = port.record,
		contents = port.contents;
	let rocks = chosenRocks(record, plan, c);
	if (path === "refine-parallel" && !other)
		throw new Error(
			"mining comparison: parallel scenario needs a second reachable refinery",
		);
	let venue = port;
	let deposits = rocks.map((rock) =>
		rockContents(record.seed, plan.slot, plan.profile, rock),
	);
	let debits: Debit[] = rocks.map(() => ({ taken: 0, at: 0 }));
	const worthMining = (deposit: RockContents) =>
		deposit.deepT > 0 &&
		ORE_GRADES.indexOf(deposit.grade) >= ORE_GRADES.indexOf(c.goodMinimumGrade);
	const legs = route?.stops.map((stop, i) => {
		const key = JSON.stringify([
			seed,
			galaxy,
			stop.port.key,
			stop.plan.id,
			c.fieldLayout,
			c.visitLargestShare,
			c.rockLimit,
		]);
		let stock = cache.stocks.get(key);
		if (!stock) {
			const chosen = chosenRocks(stop.port.record, stop.plan, c);
			stock = {
				rocks: chosen,
				deposits: chosen.map((rock) =>
					rockContents(
						stop.port.record.seed,
						stop.plan.slot,
						stop.plan.profile,
						rock,
					),
				),
			};
			cache.stocks.set(key, stock);
		}
		return {
			...stop,
			rocks: stock.rocks,
			deposits: stock.deposits,
			debits:
				i === 0 ? debits : stock.rocks.map((): Debit => ({ taken: 0, at: 0 })),
			reached: false,
			passes: 0,
			minedT: 0,
		};
	});
	type Leg = NonNullable<typeof legs>[number];
	const legReserveT = (l: Leg) =>
		l.deposits.reduce((sum, d) => sum + (worthMining(d) ? d.deepT : 0), 0);
	let leg: Leg | undefined = legs?.[0];
	const capacity = fit.capacity;
	let condition = fullCondition(fitInput.hull, capacity);
	let t = 0,
		activeS = 0;
	let deficits: DeficitMap = {};
	let paid = money.fromNumber(0),
		proceeds = money.fromNumber(0),
		cash = money.fromNumber(c.startCr),
		peakTied = 0n;
	let purchasedT = 0;
	let cargo: Cargo[] = [];
	const jobs: Job[] = [];
	let unitsMined = 0,
		lostT = 0,
		soldRawT = 0,
		refineryInputT = 0,
		productG = 0,
		soldProductG = 0,
		refusedFee = 0;
	let surveys = 0,
		resurveys = 0,
		exhaustions = 0,
		remined = 0,
		poweredS = 0,
		unpoweredS = 0,
		trips = 0,
		partialCollections = 0,
		unloadS = 0,
		searchS = 0,
		travelS = 0,
		positionS = 0,
		feeTotal = 0n,
		purchaseTotal = 0n;
	let peakBasisCr = 0,
		basisCrSeconds = 0,
		movedBasis = money.fromNumber(0);
	let fuelPaid = money.fromNumber(0),
		refusedFuel = 0,
		maxOutstandingSlots = 0;
	const poolDebt: Record<string, Money> = {};
	let banked = money.fromNumber(0);
	const venues = legs
		? [...new Map(legs.map((l) => [l.port.key, l.port])).values()]
		: [port, ...(other ? [other] : [])];
	let moveS = 0,
		refineryWaitS = 0,
		recoveryWaitS = 0,
		reachExhaustedAtS: number | null = null,
		lastVisited: Rock | null = null;
	let exhaustionCr = 0,
		exhaustionActiveS = 0;
	const visits: {
		system: number;
		field: string;
		kind: "first" | "remainder" | "restored";
		startS: number;
		endS: number;
		activeS: number;
		minedT: number;
		cr: number;
	}[] = [];
	let visitStart = { t: 0, activeS: 0, mined: 0, cr: 0 };
	let visitKind: "first" | "remainder" | "restored" = "first";
	let visitOpen = legs !== undefined;
	const services = new Map(venues.map((p) => [p.key, cachedService(p)]));
	function cachedService(p: Port) {
		const key = JSON.stringify([seed, galaxy, p.key, elapsedS]);
		let service = cache.services.get(key);
		if (!service) {
			service = serviceCalendar(seed, galaxy, p, elapsedS);
			cache.services.set(key, service);
		}
		return service;
	}
	function advance(dt: number, active: boolean) {
		const next = Math.min(elapsedS, t + valid("time step", dt));
		const basis = approximate(
			[...cargo, ...jobs].reduce((n, item) => n + item.basis, 0n),
		);
		peakBasisCr = Math.max(peakBasisCr, basis);
		basisCrSeconds += basis * (next - t);
		for (const p of venues) {
			const pending = jobs.filter(
				(j) => j.port.key === p.key && j.workLeftS > 0,
			);
			if (!pending.length) continue;
			let available = services.get(p.key)!(t, next);
			let cursor = t;
			for (const job of pending) {
				if (job.workLeftS <= 0) continue;
				const work = job.workLeftS;
				const use = Math.min(available, work);
				if (use > 0 && job.startedAt === null) job.startedAt = cursor;
				job.workLeftS -= use;
				available -= use;
				if (job.workLeftS <= 1e-9) {
					job.workLeftS = 0;
					const hi = completionTime(
						(mid) => services.get(p.key)!(cursor, mid),
						work,
						cursor,
						next,
					);
					job.doneAt = hi;
					cursor = hi;
				}
			}
		}
		if (active) activeS += next - t;
		t = next;
	}
	function spend(cost: Money, product: string) {
		if (cost > cash) return false;
		cash = money.subtract(cash, cost);
		paid = money.add(paid, cost);
		poolDebt[product] = money.add(
			poolDebt[product] ?? money.fromNumber(0),
			cost,
		);
		peakTied = paid - proceeds > peakTied ? paid - proceeds : peakTied;
		return true;
	}
	function sell(value: Money, product: string) {
		cash = money.add(cash, value);
		proceeds = money.add(proceeds, value);
		const debt = poolDebt[product] ?? money.fromNumber(0);
		const recovery = debt < value ? debt : value;
		poolDebt[product] = money.subtract(debt, recovery);
		banked = money.add(banked, money.subtract(value, recovery));
	}
	function mark(name: string, units: number) {
		deficits = recordTrade(deficits, venue.key, {
			goodName: name,
			units,
			gameTimeMin: t / 60,
			holdT,
		});
	}
	function productPrice(family: OreFamily, grade: OreGrade) {
		const recipe = recipeFor(family, grade);
		return productMarketBid({
			product: recipe.product,
			economy: venue.record.economy,
			station: venue.market,
			gameTimeS: t,
			holdT,
			displayTL: venue.record.displayTL,
			deficit: readDeficit(deficits, venue.key, recipe.product, t / 60),
		});
	}
	function feeFor(family: OreFamily, grade: OreGrade, tonnes: number) {
		const recipe = recipeFor(family, grade);
		const share = c.feeShareOfProduct ?? 0;
		const perT =
			c.feeCrPerT +
			(share > 0
				? (share * productPrice(family, grade) * recipe.yieldGPerT) /
					recipe.nativeUnitG
				: 0);
		return price(perT, tonnes);
	}
	function idle(dt: number, active: boolean) {
		const start = t;
		advance(dt, active);
		condition = stepCondition(condition, t - start, false).condition;
	}
	const heldT = () => cargo.reduce((n, item) => n + item.tonnes, 0);
	function outstanding() {
		return jobs.filter(
			(j) =>
				j.port.key === venue.key &&
				(j.workLeftS > 0 ||
					j.productG - j.collectedG >=
						recipeFor(j.family, j.grade).nativeUnitG),
		).length;
	}
	function unload() {
		if (t >= elapsedS) return;
		trips++;
		const before = t;
		idle(c.dockS, true);
		unloadS += t - before;
		if (t >= elapsedS) return;
		if (path === "raw") {
			for (const item of cargo) {
				const q = rawQuote(
					port,
					item.family,
					item.grade,
					t,
					deficits,
					holdT,
					c,
				);
				sell(
					price(q.sellCr, item.tonnes),
					recipeFor(item.family, item.grade).product,
				);
				mark(rawName(item.family, item.grade), -item.tonnes);
				soldRawT += item.tonnes;
			}
			cargo = [];
			return;
		}
		if (path === "buy-refine") {
			const best = buyOre!;
			const q = rawQuote(port, best.family, best.grade, t, deficits, holdT, c);
			let n = Math.min(oreHoldT - heldT(), q.stockT);
			while (
				n > 0 &&
				money.add(price(q.buyCr, n), feeFor(best.family, best.grade, n)) > cash
			)
				n--;
			if (n > 0) {
				const cost = price(q.buyCr, n);
				if (spend(cost, recipeFor(best.family, best.grade).product)) {
					purchasedT += n;
					purchaseTotal += cost;
					mark(rawName(best.family, best.grade), n);
					cargo.push({
						family: best.family,
						grade: best.grade,
						tonnes: n,
						basis: cost,
					});
				}
			}
		}
		submitCargo();
		collectOutput();
	}
	function feeBudget() {
		if (!other) return cash;
		const reserve = money.fromNumber(
			2 * distanceLy(port.record.pos, other.record.pos) * FUEL_CR_PER_LY,
		);
		return cash > reserve ? money.subtract(cash, reserve) : money.fromNumber(0);
	}
	function affordableLot(item: Cargo, retained: Cargo[]) {
		if (c.feeShareOfProduct === undefined) return item;
		const budget = feeBudget();
		const whole = feeFor(item.family, item.grade, item.tonnes);
		if (whole <= budget) return item;
		let tonnes = Math.floor(
			(item.tonnes * approximate(budget)) / approximate(whole),
		);
		while (tonnes > 0 && feeFor(item.family, item.grade, tonnes) > budget)
			tonnes--;
		if (tonnes < 1) return null;
		const split = transferCost(
			item.basis,
			massFromNative(tonnes, 1),
			massFromNative(item.tonnes, 1),
		);
		retained.push({
			...item,
			tonnes: item.tonnes - tonnes,
			basis: split.retained,
		});
		return { ...item, tonnes, basis: split.moved };
	}
	function submitCargo() {
		const retained: Cargo[] = [];
		for (const whole of cargo) {
			const item = affordableLot(whole, retained);
			if (!item) {
				retained.push(whole);
				refusedFee++;
				continue;
			}
			const recipe = recipeFor(item.family, item.grade);
			const fee = feeFor(item.family, item.grade, item.tonnes);
			if (
				outstanding() >= 8 ||
				services.get(venue.key)!(t, Math.min(elapsedS, t + 1e-6)) === 0 ||
				!spend(fee, recipe.product)
			) {
				retained.push(item);
				refusedFee++;
				continue;
			}
			feeTotal += fee;
			refineryInputT += item.tonnes;
			productG += item.tonnes * recipe.yieldGPerT;
			jobs.push({
				...item,
				basis: money.add(item.basis, fee),
				startedAt: null,
				inputT: item.tonnes,
				workLeftS: item.tonnes * c.serviceSPerT,
				productG: item.tonnes * recipe.yieldGPerT,
				collectedG: 0,
				port: venue,
				submittedAt: t,
				doneAt: null,
			});
			maxOutstandingSlots = Math.max(maxOutstandingSlots, outstanding());
		}
		cargo = retained;
	}
	function readyOutput() {
		return jobs.filter(
			(j) =>
				j.workLeftS === 0 &&
				j.port.key === venue.key &&
				j.productG > j.collectedG,
		);
	}
	function hasWholeOutput() {
		const ready = readyOutput();
		return [...new Set(ready.map((j) => j.family))].some((family) => {
			const group = ready.filter((j) => j.family === family);
			const unitG = recipeFor(group[0].family, group[0].grade).nativeUnitG;
			return group.reduce((n, j) => n + j.productG - j.collectedG, 0) >= unitG;
		});
	}
	function collectOutput() {
		let free = holdT - (dedicatedOre ? 0 : heldT());
		const ready = readyOutput();
		for (const family of [...new Set(ready.map((j) => j.family))]) {
			const group = ready.filter((j) => j.family === family);
			const job = group[0];
			const recipe = recipeFor(job.family, job.grade);
			const available = Math.floor(
				group.reduce((n, j) => n + j.productG - j.collectedG, 0) /
					recipe.nativeUnitG,
			);
			const n = recipe.occupiesHold ? Math.min(free, available) : available;
			if (n > 0) {
				if (n < available) partialCollections++;
				const g = n * recipe.nativeUnitG;
				let left = g;
				for (const source of group) {
					const remaining = source.productG - source.collectedG;
					const take = Math.min(left, remaining);
					const basis = transferCost(
						source.basis,
						massFromNative(take, 1),
						massFromNative(remaining, 1),
					);
					source.basis = basis.retained;
					movedBasis = money.add(movedBasis, basis.moved);
					source.collectedG += take;
					left -= take;
					if (!left) break;
				}
				soldProductG += g;
				sell(
					price(productPrice(job.family, job.grade), n, recipe.nativeUnitG),
					recipe.product,
				);
				mark(recipe.product, -n);
				if (recipe.occupiesHold) free -= n;
			}
		}
	}
	function settleAtRefineries() {
		const stations = route
			? [venue]
			: [venue, ...venues.filter((p) => p.key !== venue.key)];
		for (const station of stations) {
			if (!jobs.some((j) => j.port.key === station.key)) continue;
			if (station.key !== venue.key) {
				jump(venue, station);
				venue = station;
			}
			while (t < elapsedS - 1e-8) {
				if (cargo.length) submitCargo();
				if (hasWholeOutput()) {
					idle(c.collectS ?? c.dockS, true);
					if (t < elapsedS) collectOutput();
					continue;
				}
				const waiting =
					cargo.length > 0 ||
					jobs.some((j) => j.port.key === venue.key && j.workLeftS > 0);
				if (!waiting) break;
				const before = t;
				idle(Math.min(60, elapsedS - t), false);
				refineryWaitS += t - before;
			}
		}
	}
	function travel(toField: boolean) {
		const jumpStart = t;
		if (toField && venue.key !== port.key) jump(venue, port);
		travelS += t - jumpStart;
		const centre = fieldCentre(plan, t);
		const station = port.posAt(t);
		const masses = placeBodies(contents, t)
			.filter((b) => b.kind !== "station")
			.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm }));
		const target = toField ? centre : station;
		const start = t;
		idle(
			legSeconds(
				toField ? station : centre,
				{ pos: target, radiusKm: 0 },
				masses,
				DEFAULT_CRUISE,
			),
			true,
		);
		travelS += t - start;
		if (!toField && other) {
			venue = trips % 2 === 0 ? other : port;
			if (venue.key !== port.key) {
				const jumpStart = t;
				jump(port, venue);
				travelS += t - jumpStart;
			}
		}
	}
	function jump(from: Port, to: Port) {
		const cost = money.fromNumber(
			distanceLy(from.record.pos, to.record.pos) * FUEL_CR_PER_LY,
		);
		if (cost > cash) {
			refusedFuel++;
			idle(elapsedS - t, false);
			return;
		}
		cash = money.subtract(cash, cost);
		paid = money.add(paid, cost);
		fuelPaid = money.add(fuelPaid, cost);
		idle(jumpSeconds(from, to, t, c.dockS), true);
	}
	function findField() {
		if (plan.profile === "rare") {
			const start = t;
			idle(c.searchRareS, true);
			searchS += t - start;
			const known = discoverFieldsWithin([], {
				record,
				contents,
				shipPos: fieldCentre(plan, t),
				gameTime: t,
				radiusKm: FIELD_DISCOVERY_RADIUS_KM,
			});
			if (!fieldIsKnown(known, record.index, plan))
				throw new Error(
					"mining comparison: candidate search did not discover field",
				);
		} else if (route) {
			const start = t;
			idle(c.routeChartedFindS ?? 0, true);
			searchS += t - start;
		}
	}
	const netCr = () => approximate(signedMoney.fromTicks(proceeds - paid));
	const restoredT = (l: Leg) =>
		l.deposits.reduce(
			(n, deposit, i) =>
				n +
				(worthMining(deposit)
					? Math.max(
							0,
							deposit.deepT -
								candidateDebit(
									l.debits[i].taken,
									l.debits[i].at,
									t,
									c.recoveryTPerH,
								),
						)
					: 0),
			0,
		);
	function openVisit(kind: typeof visitKind) {
		visitKind = kind;
		visitOpen = true;
		visitStart = { t, activeS, mined: unitsMined, cr: netCr() };
	}
	function closeVisit() {
		if (!visitOpen) return;
		visitOpen = false;
		leg!.minedT += unitsMined - visitStart.mined;
		visits.push({
			system: record.index,
			field: plan.id,
			kind: visitKind,
			startS: visitStart.t,
			endS: t,
			activeS: activeS - visitStart.activeS,
			minedT: unitsMined - visitStart.mined,
			cr: netCr() - visitStart.cr,
		});
	}
	function chooseLeg(): Leg | undefined {
		const current = leg!;
		const load = c.routeRevisitLoadT!;
		if (restoredT(current) >= load) return current;
		const fresh = legs!.find((l) => !l.reached);
		if (fresh) return fresh;
		if (reachExhaustedAtS === null) {
			reachExhaustedAtS = t;
			exhaustionCr = netCr();
			exhaustionActiveS = activeS;
		}
		const at = legs!.indexOf(current);
		for (let i = 1; i <= legs!.length; i++) {
			const candidate = legs![(at + i) % legs!.length];
			if (restoredT(candidate) >= load) return candidate;
		}
		return undefined;
	}
	function moveTo(next: Leg) {
		const start = t;
		for (const hop of hopsBetween(
			route!.context,
			venue.record.index,
			next.port.record.index,
		)) {
			jump(venue, hop);
			venue = hop;
			if (t >= elapsedS) break;
		}
		travelS += t - start;
		moveS += t - start;
		leg = next;
		port = next.port;
		venue = next.port;
		plan = next.plan;
		record = port.record;
		contents = port.contents;
		rocks = next.rocks;
		deposits = next.deposits;
		debits = next.debits;
		lastVisited = null;
	}
	function nextPass() {
		closeVisit();
		while (t < elapsedS - c.dockS * 2) {
			const next = chooseLeg();
			if (next) {
				const stayed = next === leg;
				const kind = !next.reached
					? "first"
					: stayed && reachExhaustedAtS === null
						? "remainder"
						: "restored";
				openVisit(kind);
				if (!stayed) moveTo(next);
				if (t >= elapsedS) return false;
				if (!next.reached) findField();
				next.reached = true;
				next.passes++;
				travel(true);
				lastVisited = null;
				return t < elapsedS;
			}
			const before = t;
			idle(Math.min(60, elapsedS - t), false);
			recoveryWaitS += t - before;
		}
		return false;
	}
	findField();
	if (leg) {
		leg.reached = true;
		leg.passes++;
	}
	if (path !== "buy-refine") travel(true);
	let cursor = 0,
		emptyVisits = 0;
	while (t < elapsedS - 1e-8) {
		if (path === "buy-refine") {
			unload();
			if (t >= elapsedS) break;
			const waiting = jobs.some((j) => j.workLeftS > 0);
			if (waiting) idle(Math.min(c.serviceSPerT * holdT, 60), false);
			else idle(1, false);
			continue;
		}
		if (!rocks.length) break;
		if (c.onePass && (cursor >= rocks.length || t > elapsedS - c.dockS * 2)) {
			if (cargo.length || jobs.length || route) {
				travel(false);
				unload();
				settleAtRefineries();
			}
			if (!route || !nextPass()) break;
			cursor = 0;
			emptyVisits = 0;
			continue;
		}
		const i = cursor++ % rocks.length,
			rock = rocks[i],
			deposit = deposits[i],
			debit = debits[i];
		if (route && debit.surveyedAt !== undefined) {
			const reading = surveyReading(
				deposit,
				{ surveyedAt: debit.surveyedAt },
				t,
				c.surveyLifetimeH,
			);
			if (
				reading &&
				(!worthMining(deposit) ||
					deposit.deepT -
						candidateDebit(debit.taken, debit.at, t, c.recoveryTPerH) <
						1)
			)
				continue;
		}
		const lifetimeLive = surveyReading(
			deposit,
			{ surveyedAt: debit.surveyedAt },
			t,
			c.surveyLifetimeH,
		);
		if (!lifetimeLive) {
			if (debit.surveyedAt !== undefined) resurveys++;
			surveys++;
			const before = t;
			idle(surveyFigures(fitInput.size, fitInput.grade).dwellS, true);
			positionS += t - before;
			debit.surveyedAt = t;
		}
		const drilling = fitInput.hull === "miner";
		if (drilling && !worthMining(deposit)) {
			idle(c.positioningFloorS, true);
			emptyVisits++;
		} else {
			const reserve = drilling ? deposit.deepT : deposit.surfaceT;
			const remaining =
				reserve - candidateDebit(debit.taken, debit.at, t, c.recoveryTPerH);
			if (remaining < 1) {
				exhaustions++;
				emptyVisits++;
				idle(c.positioningFloorS, true);
			} else {
				if (debit.taken > 0) remined++;
				emptyVisits = 0;
				const perf = flightPerformance(fitInput.hull, {}, fit.massT + heldT());
				const positioning =
					Math.max(
						c.positioningFloorS,
						2 * Math.sqrt(c.positioningKm / perf.thrustKms2),
						Math.max(
							c.positioningKm,
							length(
								sub(
									rockLocal(rock, t),
									route
										? lastVisited
											? rockLocal(lastVisited, t)
											: { x: 0, y: 0, z: 0 }
										: cursor > 1
											? rockLocal(rocks[(cursor - 2) % rocks.length], t)
											: { x: 0, y: 0, z: 0 },
								),
							),
						) / ASSIST_CAP_KMS,
					) + (drilling ? DRILL.deployS + DRILL.spinUpS : 0);
				const before = t;
				idle(positioning, true);
				positionS += t - before;
				let cut = beginCut(),
					drill = beginDrillCut();
				let takenThisVisit = 0;
				const laser = moduleRow(fit.loadout.h1);
				const rates = drilling
					? DRILL_RATES
					: groupLaserRates(fit.loadout, {
							kind: "lasers",
							slots: ["h1"],
							label: "mining",
							trigger: "primary",
						});
				while (t < elapsedS - 1e-8 && heldT() < loadLimitT) {
					const left =
						reserve - candidateDebit(debit.taken, debit.at, t, c.recoveryTPerH);
					if (left < 1) {
						exhaustions++;
						break;
					}
					const dt = Math.min(0.25, elapsedS - t);
					const stepped = stepCondition(condition, dt, true, rates);
					condition = stepped.condition;
					if (stepped.fired) poweredS += dt;
					else unpoweredS += dt;
					advance(dt, true);
					let released = 0;
					if (drilling) {
						const step = stepDrillCut(drill, {
							key: String(rock.slot),
							powered: stepped.fired,
							spin: 1,
							rateTPerS: c.drillTPerS,
							dt,
							holdFreeT: loadLimitT - heldT(),
							reserveLeftT: left,
						});
						drill = step.cut;
						released = step.tonnes;
					} else if (stepped.fired) {
						const step = stepCut(
							cut,
							String(rock.slot),
							laser.output.extractionTPerS,
							oreShare(fitInput.grade),
							dt,
							left,
						);
						cut = step.cut;
						released = step.ore;
					}
					if (!released) continue;
					debit.taken =
						candidateDebit(debit.taken, debit.at, t, c.recoveryTPerH) +
						released;
					debit.at = t;
					takenThisVisit += released;
					for (let j = 0; j < released; j++) {
						let kept = true;
						if (!drilling) {
							const beforeScoop = t;
							idle(c.fragmentS, true);
							positionS += t - beforeScoop;
							kept =
								t < elapsedS &&
								(fnv1a(
									`${seed}/${record.index}/${plan.id}/${rock.slot}/${unitsMined + lostT}`,
								) %
									10000) /
									10000 <
									c.fragmentKeepShare;
							if (kept) {
								while (
									condition.energy < CANISTER_SCOOP_CHARGE_E &&
									t < elapsedS
								)
									idle(0.25, true);
								kept = t < elapsedS;
								if (kept)
									condition = {
										...condition,
										energy: condition.energy - CANISTER_SCOOP_CHARGE_E,
									};
							}
						}
						if (kept) {
							unitsMined++;
							const item = cargo.find(
								(x) => x.family === deposit.family && x.grade === deposit.grade,
							);
							if (item) item.tonnes++;
							else
								cargo.push({
									family: deposit.family,
									grade: deposit.grade,
									tonnes: 1,
									basis: money.fromNumber(0),
								});
						} else lostT++;
					}
				}
				if (takenThisVisit === 0) emptyVisits++;
			}
		}
		lastVisited = rock;
		const full = heldT() >= loadLimitT;
		if (full || (emptyVisits >= rocks.length && cargo.length)) {
			travel(false);
			unload();
			travel(true);
			emptyVisits = 0;
		} else if (emptyVisits >= rocks.length) {
			idle(Math.min(60, elapsedS - t), false);
			emptyVisits = 0;
		}
	}
	if (route) closeVisit();
	if (t < elapsedS) idle(elapsedS - t, false);
	const heldRawT = heldT();
	const completed = jobs.filter((j) => j.workLeftS === 0);
	const inProcess = jobs.filter((j) => j.workLeftS > 0);
	const custodyG = completed.reduce((n, j) => n + j.productG - j.collectedG, 0);
	const inProcessG = inProcess.reduce((n, j) => n + j.productG, 0);
	const delta = signedMoney.fromTicks(proceeds - paid);
	const cr = approximate(delta);
	const crPerActiveMinute = activeS > 0 ? cr / (activeS / 60) : 0;
	const targetFailures: string[] = [];
	if (
		path !== "buy-refine" &&
		fitInput.hull === "courier" &&
		crPerActiveMinute >= trade.crPerMinute
	)
		targetFailures.push("surface-at-or-above-good-trade");
	if (
		path !== "buy-refine" &&
		fitInput.hull === "miner" &&
		plan.profile === "charted" &&
		(crPerActiveMinute < trade.crPerMinute * 0.8 ||
			crPerActiveMinute > trade.crPerMinute * 1.2)
	)
		targetFailures.push(
			"ordinary-miner-outside-explicit-0.8-to-1.2-trade-band",
		);
	if (path === "buy-refine" && cr > 0)
		targetFailures.push("profitable-buy-refine-sell-cycle");
	const queueWaitS = jobs.reduce(
		(n, j) => n + (j.startedAt ?? elapsedS) - j.submittedAt,
		0,
	);
	const turnaroundS = jobs.reduce(
		(n, j) => n + (j.doneAt ?? elapsedS) - j.submittedAt,
		0,
	);
	return {
		seed,
		galaxy,
		system: record.index,
		field: plan.id,
		profile: plan.profile,
		fit: fitInput,
		generalHoldT: holdT,
		oreHoldT,
		path,
		buyOre,
		trade,
		elapsedS,
		activeS,
		passiveS: elapsedS - activeS,
		crPerActiveMinute,
		crPerElapsedMinute: cr / (elapsedS / 60),
		cashDelta: signedMoney.encode(delta),
		paid: money.encode(paid),
		proceeds: money.encode(proceeds),
		endCash: money.encode(cash),
		bankedTrade: money.encode(banked),
		unrecoveredDebt: Object.fromEntries(
			Object.entries(poolDebt).map(([k, v]) => [k, money.encode(v)]),
		),
		fees: money.encode(money.fromTicks(feeTotal)),
		purchases: money.encode(money.fromTicks(purchaseTotal)),
		fuelPaid: money.encode(fuelPaid),
		refusedFuel,
		maxOutstandingSlots,
		peakTiedCashCr: approximate(peakTied),
		peakBasisCr,
		averageBasisCr: basisCrSeconds / elapsedS,
		retainedBasis: money.encode(
			money.fromTicks(
				[...cargo, ...jobs].reduce((n, item) => n + item.basis, 0n),
			),
		),
		soldBasis: money.encode(movedBasis),
		parallelRefineries: venues.length,
		investmentCr: fit.investmentCr,
		refitCr: fit.refitCr,
		paybackActiveMinutes:
			crPerActiveMinute > 0 ? fit.investmentCr / crPerActiveMinute : null,
		inputG: (unitsMined + purchasedT) * 1_000_000,
		soldRawG: soldRawT * 1_000_000,
		refineryInputG: refineryInputT * 1_000_000,
		heldRawG: heldRawT * 1_000_000,
		productG,
		soldProductG,
		custodyG,
		inProcessG,
		lostT,
		refusedFee,
		surveys,
		resurveys,
		exhaustions,
		remined,
		poweredS,
		unpoweredS,
		trips,
		partialCollections,
		queueWaitS,
		turnaroundS,
		jobRecords: jobs.map((j) => ({
			refineryKey: j.port.key,
			family: j.family,
			grade: j.grade,
			inputT: j.inputT,
			workLeftS: j.workLeftS,
			submittedAt: j.submittedAt,
			startedAt: j.startedAt,
			doneAt: j.doneAt,
			productG: j.productG,
			collectedG: j.collectedG,
			basis: money.encode(j.basis),
		})),
		unloadS,
		searchS,
		travelS,
		positionS,
		jobs: jobs.length,
		pendingJobs: inProcess.length,
		targetFailures,
		productionBalanceChanged: false as const,
		...(legs
			? {
					route: {
						fields: legs.map((l) => ({
							system: l.port.record.index,
							field: l.plan.id,
							profile: l.plan.profile,
							fromHomeLy: l.fromHomeLy,
							passes: l.passes,
						})),
						tradeStalled: route!.tradeStalled,
						marketMarks: Object.fromEntries(
							legs
								.filter((l) => deficits[l.port.key])
								.map((l) => [l.port.key, deficits[l.port.key]]),
						),
						fieldsVisited: legs.filter((l) => l.reached).length,
						reserveT: legs.reduce((n, l) => n + legReserveT(l), 0),
						goodRocks: legs.reduce(
							(n, l) => n + l.deposits.filter(worthMining).length,
							0,
						),
						rocksSurveyed: legs.reduce(
							(n, l) =>
								n +
								(l.reached
									? l.debits.filter((d) => d.surveyedAt !== undefined).length
									: 0),
							0,
						),
						visits,
						moveS,
						refineryWaitS,
						recoveryWaitS,
						otherPassiveS: elapsedS - activeS - refineryWaitS - recoveryWaitS,
						restoredMinedT: legs.reduce(
							(n, l) => n + Math.max(0, l.minedT - legReserveT(l)),
							0,
						),
						reachExhaustedAtS,
						beforeExhaustion:
							reachExhaustedAtS === null
								? { activeS, cr }
								: { activeS: exhaustionActiveS, cr: exhaustionCr },
						afterExhaustion:
							reachExhaustedAtS === null
								? { activeS: 0, cr: 0 }
								: {
										activeS: activeS - exhaustionActiveS,
										cr: cr - exhaustionCr,
									},
					},
				}
			: {}),
	};
}

interface Distribution {
	n: number;
	min: number | null;
	p10: number | null;
	p50: number | null;
	p90: number | null;
	p99: number | null;
	max: number | null;
}
function distribution(values: number[]): Distribution {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length)
		return {
			n: 0,
			min: null,
			p10: null,
			p50: null,
			p90: null,
			p99: null,
			max: null,
		};
	const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
	return {
		n: sorted.length,
		min: sorted[0],
		p10: q(0.1),
		p50: q(0.5),
		p90: q(0.9),
		p99: q(0.99),
		max: sorted.at(-1)!,
	};
}

const ROUTE_ASSUMPTIONS = [
	"Route: the nearest routeFields fields of the starting field's profile by shortest refuelled jump path, visited in nearest-first order; not an optimal route and not a chosen rich route",
	"Route: every leg jumps through market systems within one fitted tank, each hop paying fuel, the jump, the cruise to its station and a dock",
	"Route: a charted field costs routeChartedFindS on first arrival and a rare field costs searchRareS on first arrival; a known field costs nothing to find again",
	"Route: the pilot sells or refines at the refinery in the field's own system and settles every job there before moving on",
	"Route: reachExhaustedAtS is the moment every field has been reached and the pilot's own field holds under routeRevisitLoadT; fields left earlier may already have restored that much",
	"Route: the pilot stays while the field holds routeRevisitLoadT of known good ore, otherwise goes to the next unvisited field, otherwise to the next field that has restored that much, otherwise waits passively",
	"Route: the mining clock stays the matched trader's realised clock, so a world whose trader stalls ends its route early; tradeStalled counts those rows",
	"Route: on a return a live survey lets the pilot skip empty and below-grade rocks without flying to them; each pass otherwise follows the one-pass rock order",
];
type RouteRow = ReturnType<typeof scenario> & {
	route: NonNullable<ReturnType<typeof scenario>["route"]>;
};
function onePassRatios(
	c: Candidate,
	cache: ComparisonCache,
): Record<string, Distribution> {
	const {
		routeFields: _fields,
		routeRevisitLoadT: _load,
		routeChartedFindS: _find,
		routeReferenceHours: _hours,
		...plain
	} = c;
	const onePassCandidate = {
		...plain,
		hours: c.routeReferenceHours ?? c.hours,
	};
	const referenceKey = JSON.stringify(onePassCandidate);
	let reference = cache.references.get(referenceKey);
	if (!reference) {
		reference = Object.fromEntries(
			Object.entries(compare(onePassCandidate, cache, true).summaries).map(
				([key, summary]) => [key, summary.tradeRatio],
			),
		);
		cache.references.set(referenceKey, reference);
	}
	return reference;
}
function routeReporting(
	c: Candidate,
	rows: ReturnType<typeof scenario>[],
	reference: Record<string, Distribution>,
) {
	const grouped = new Map<string, RouteRow[]>();
	for (const row of rows as RouteRow[]) {
		const key = `${row.fit.hull}/${row.fit.size}/${row.fit.grade}/${row.profile}/${row.path}`;
		grouped.set(key, [...(grouped.get(key) ?? []), row]);
	}
	const of = (group: RouteRow[], read: (r: RouteRow) => number) =>
		distribution(group.map(read));
	const rateAgainstTrade = (
		part: { activeS: number; cr: number },
		r: RouteRow,
	) => part.cr / (part.activeS / 60) / r.trade.crPerMinute;
	const routeSummaries = Object.fromEntries(
		[...grouped].map(([key, group]) => [
			key,
			{
				tradeRatio: of(group, (r) => r.crPerActiveMinute / r.trade.crPerMinute),
				elapsedTradeRatio: of(
					group,
					(r) => r.crPerElapsedMinute / r.trade.crPerElapsedMinute,
				),
				beforeExhaustionTradeRatio: of(group, (r) =>
					rateAgainstTrade(r.route.beforeExhaustion, r),
				),
				afterExhaustionTradeRatio: distribution(
					group
						.filter((r) => r.route.afterExhaustion.activeS > 0)
						.map((r) => rateAgainstTrade(r.route.afterExhaustion, r)),
				),
				activeMinutes: of(group, (r) => r.activeS / 60),
				moveMinutes: of(group, (r) => r.route.moveS / 60),
				findMinutes: of(group, (r) => r.searchS / 60),
				refineryWaitMinutes: of(group, (r) => r.route.refineryWaitS / 60),
				recoveryWaitMinutes: of(group, (r) => r.route.recoveryWaitS / 60),
				fieldsNamed: of(group, (r) => r.route.fields.length),
				fieldsVisited: of(group, (r) => r.route.fieldsVisited),
				reserveT: of(group, (r) => r.route.reserveT),
				inputT: of(group, (r) => r.inputG / 1_000_000),
				restoredMinedT: of(group, (r) => r.route.restoredMinedT),
				earnedCr: of(group, (r) => approximate(signedMoney.parse(r.cashDelta))),
				tradeEarnedCr: of(group, (r) => r.trade.earnedCr),
				reachExhausted: group.filter((r) => r.route.reachExhaustedAtS !== null)
					.length,
				reachExhaustedHours: distribution(
					group.flatMap((r) =>
						r.route.reachExhaustedAtS === null
							? []
							: [r.route.reachExhaustedAtS / 3600],
					),
				),
				refusedFuel: group.reduce((n, r) => n + r.refusedFuel, 0),
				clockHours: of(group, (r) => r.elapsedS / 3600),
				tradeStalled: group.filter((r) => r.route.tradeStalled).length,
			},
		]),
	);
	const routeComparison = Object.fromEntries(
		Object.entries(routeSummaries).map(([key, summary]) => {
			const onePass = reference[key] ?? distribution([]);
			return [
				key,
				{
					onePassHours: c.routeReferenceHours ?? c.hours,
					sustainedHours: c.hours,
					sustained: summary.tradeRatio,
					onePass,
					p50Change:
						summary.tradeRatio.p50 === null || onePass.p50 === null
							? null
							: summary.tradeRatio.p50 - onePass.p50,
				},
			];
		}),
	);
	return { routeSummaries, routeComparison };
}

/** Deterministic model predictions, with all candidate inputs distinct from consequences. */
export function comparison(c: Candidate) {
	return compare(c, comparisonCache());
}
function compare(c: Candidate, cache: ComparisonCache, minedOnly = false) {
	validate(c);
	const routed = c.routeFields !== undefined;
	const rows: ReturnType<typeof scenario>[] = [];
	const refusedScenarios: {
		seed: number;
		galaxy: number;
		system: number;
		fit: FitInput;
		path: string;
		reason: string;
	}[] = [];
	let systemsSeen = 0,
		rarePresent = 0,
		chartedPresent = 0;
	for (const seed of c.seeds)
		for (const galaxy of c.galaxies) {
			const world = worldFor(seed, galaxy);
			const systems = world.systems
				.filter((record) =>
					portsOf(record, world.contentsFor(record)).some(
						(p) => p.station.type === "refinery",
					),
				)
				.slice(0, c.systemsPerWorld);
			for (const fit of c.loadouts) {
				const capacity = makeMiningFit(fit.hull, fit.size, fit.grade).capacity;
				const baselineKey = JSON.stringify([
					seed,
					galaxy,
					capacity.holdT,
					capacity.fuelCapacityLy,
					c.hours,
					c.startCr,
					c.dockS,
				]);
				const baseline =
					cache.baselines.get(baselineKey) ??
					run(world, c.hours, {
						holdT: capacity.holdT,
						tankLy: capacity.fuelCapacityLy,
						startCr: c.startCr,
						shop: false,
						stopAtKit: false,
						remembers: true,
						dockSeconds: c.dockS,
						startPolicy: "developed",
					});
				cache.baselines.set(baselineKey, baseline);
				const elapsedS = valid(
					"realised trader clock",
					baseline.minutes * 60,
					0.001,
				);
				const trade = {
					elapsedS,
					activeS: (baseline.minutes - baseline.waitMinutes) * 60,
					passiveS: baseline.waitMinutes * 60,
					crPerElapsedMinute: baseline.earnedCr / baseline.minutes,
					crPerMinute:
						baseline.minutes > baseline.waitMinutes
							? baseline.earnedCr / (baseline.minutes - baseline.waitMinutes)
							: 0,
					earnedCr: baseline.earnedCr,
					hops: baseline.hops,
				};
				const routeContext = routed
					? {
							world,
							key: JSON.stringify([seed, galaxy]),
							tankLy: capacity.fuelCapacityLy,
							cache,
						}
					: undefined;
				for (const record of systems) {
					const contents = world.contentsFor(record);
					const port = portsOf(record, contents).find(
						(p) => p.station.type === "refinery",
					)!;
					const fields = systemFields(record, contents);
					const other =
						routed || minedOnly
							? undefined
							: secondRefinery(world, port, capacity.fuelCapacityLy);
					if (fit === c.loadouts[0]) {
						systemsSeen++;
						rarePresent += Number(fields.some((f) => f.profile === "rare"));
						chartedPresent += Number(
							fields.some((f) => f.profile === "charted"),
						);
					}
					for (const plan of fields)
						for (const path of ["raw", "refine", "refine-parallel"] as const) {
							if (path === "refine-parallel" && (routed || minedOnly)) continue;
							if (path === "refine-parallel" && !other) {
								refusedScenarios.push({
									seed,
									galaxy,
									system: record.index,
									fit,
									path,
									reason: "no second refinery reachable with fitted tank",
								});
								continue;
							}
							rows.push(
								scenario({
									seed,
									galaxy,
									port,
									plan,
									fitInput: fit,
									c,
									elapsedS,
									trade,
									path,
									other: path === "refine-parallel" ? other : undefined,
									route: routeContext
										? {
												stops: fieldRoute(
													routeContext,
													port,
													plan,
													c.routeFields!,
												),
												context: routeContext,
												tradeStalled: baseline.stalled,
											}
										: undefined,
									cache,
								}),
							);
						}
					if (fit === c.loadouts[0] && !routed && !minedOnly) {
						const charted = fields.find((f) => f.profile === "charted");
						if (!charted) {
							refusedScenarios.push({
								seed,
								galaxy,
								system: record.index,
								fit,
								path: "buy-refine",
								reason: "no charted field for comparison fixture",
							});
							continue;
						}
						for (const family of ORE_FAMILIES)
							for (const grade of ORE_GRADES)
								rows.push(
									scenario({
										seed,
										galaxy,
										port,
										plan: charted,
										fitInput: fit,
										c,
										elapsedS,
										trade,
										path: "buy-refine",
										buyOre: { family, grade },
										cache,
									}),
								);
					}
				}
			}
		}
	const groups: Record<
		string,
		{
			rates: number[];
			elapsedRates: number[];
			ratios: number[];
			failures: number;
			activeMinutes: number[];
			pendingJobs: number[];
			unsoldRawT: number[];
		}
	> = {};
	for (const row of rows) {
		if (row.path !== "refine") continue;
		const raw = rows.find(
			(r) =>
				r.path === "raw" &&
				r.seed === row.seed &&
				r.galaxy === row.galaxy &&
				r.system === row.system &&
				r.field === row.field &&
				r.fit === row.fit,
		);
		if (
			raw &&
			signedMoney.parse(row.cashDelta) <= signedMoney.parse(raw.cashDelta)
		)
			row.targetFailures.push("refining-did-not-improve-cash-at-equal-clock");
	}
	for (const row of rows) {
		const key = `${row.fit.hull}/${row.fit.size}/${row.fit.grade}/${row.profile}/${row.path}`;
		const g = (groups[key] ??= {
			rates: [],
			elapsedRates: [],
			ratios: [],
			failures: 0,
			activeMinutes: [],
			pendingJobs: [],
			unsoldRawT: [],
		});
		g.activeMinutes.push(row.activeS / 60);
		g.pendingJobs.push(row.pendingJobs);
		g.unsoldRawT.push(row.heldRawG / 1_000_000);
		g.rates.push(row.crPerActiveMinute);
		g.elapsedRates.push(row.crPerElapsedMinute);
		if (row.trade.crPerMinute > 0)
			g.ratios.push(row.crPerActiveMinute / row.trade.crPerMinute);
		g.failures += Number(row.targetFailures.length > 0);
	}
	const routeReport: Partial<ReturnType<typeof routeReporting>> = routed
		? routeReporting(c, rows, onePassRatios(c, cache))
		: {};
	const report = {
		status: "candidate-comparison" as const,
		approvedBalance: false as const,
		inputs: c,
		corpus: { systemsSeen, rarePresent, chartedPresent, samples: rows.length },
		summaries: Object.fromEntries(
			Object.entries(groups).map(([key, g]) => [
				key,
				{
					activeCrPerMinute: distribution(g.rates),
					elapsedCrPerMinute: distribution(g.elapsedRates),
					tradeRatio: distribution(g.ratios),
					failedSamples: g.failures,
					activeMinutes: distribution(g.activeMinutes),
					pendingJobs: distribution(g.pendingJobs),
					unsoldRawT: distribution(g.unsoldRawT),
				},
			]),
		),
		rows,
		refusedScenarios,
		assumptions: [
			"Predicted trained-pilot scenario, not measured human performance; ideal drill contact, sequential rock surveys and no free omniscient best-rock selection",
			"Good miner means deep deposit at minimum candidate grade; good trade is developed-start greedy basket with shipped prices/stock/deficits and fitted hold/tank",
			"Same initial cash, modeled docking cost and geometric cruise estimator; each mining arm uses the actual realised trader clock, including terminal-hop overshoot",
			"Rare samples are conditional on field presence and successful search; candidate search seconds are an explicit assumed discovery cost, not a simulated blind search or observed success probability",
			"Fragment collection time/loss share are explicit scenario assumptions; module energy, heat and cut law are shipped; timestep 0.25 seconds",
			"FIFO jobs process during every trip; only completed output can be collected; fractions combine per refinery/product and never become cash before collection. Eight outstanding slots include completed whole units; fractional-only balances free slots, per #921 D2/D5",
			"Single-refinery and alternating two-refinery scenarios use production world operationalDuration; parallel paths pay interstellar travel and fuel. No optimal routing claim",
			"Raw ore market is a proposed product-equivalent mid times rawValueShare, seeded per-ore epoch shelf and shipped spread/deficit response; no runtime prices changed",
			"Cr rates are presentation projections truncated to millionths before division; exact money wire values own settlement; 0.8–1.2 trade target band is an explicit instrument interpretation, not a ratified numeric band",
			"Cruise uses geometric legSeconds and shared default cruise parameters; traffic, combat, finite-charge path planning and player mistakes are not simulated",
			...(routed ? ROUTE_ASSUMPTIONS : []),
		],
		provenance: {
			recipes: "#917; recipeFor fixed fifteen yields",
			target: "#872 D12; live approved Algorithm record and #923 brief",
			authority: "#922 ruling 2026-11-07",
			pricing:
				"src/market.ts, src/deficits.ts and scripts/lib/greedy-trader.ts",
			service: "src/world-state.ts operationalDuration",
			extraction:
				"src/rock-survey.ts, src/rock-extraction.ts, src/rock-drill.ts, src/ship-condition.ts",
			accounting:
				"src/exact-amount.ts; #935 known-zero-cost mining and cost-debt policy",
		},
		...routeReport,
	};
	JSON.stringify(report, (_key, value) => {
		if (typeof value === "number" && !Number.isFinite(value))
			throw new Error("mining comparison: non-finite output");
		return value;
	});
	return report;
}

/** One-factor sensitivity retains each comparison, including failed targets and profitable cycles. */
export function sensitivity(c: Candidate) {
	const cache = comparisonCache();
	const variants: [string, Partial<Candidate>][] = [
		["base", {}],
		...[0, 0.1, 10, 3600].map(
			(rate) =>
				[`recovery-${rate}`, { recoveryTPerH: rate }] as [
					string,
					Partial<Candidate>,
				],
		),
		...[1 / 3600, 1].map(
			(lifetime) =>
				[`lifetime-${lifetime}`, { surveyLifetimeH: lifetime }] as [
					string,
					Partial<Candidate>,
				],
		),
		["fast-refinery", { serviceSPerT: c.serviceSPerT / 4 }],
		["slow-refinery", { serviceSPerT: c.serviceSPerT * 4 }],
		["low-fee", { feeCrPerT: c.feeCrPerT / 4 }],
		["fast-drill", { drillTPerS: c.drillTPerS * 4 }],
		[
			"one-rock-loop",
			{
				rockLimit: 1,
				recoveryTPerH: 3600,
				goodMinimumGrade: "poor",
				surveyLifetimeH: 1 / 3600,
			},
		],
	];
	return {
		approvedBalance: false,
		method:
			"one-factor-at-a-time; variant inputs explicit; one-rock-loop jointly stresses recovery and expiry",
		variants: Object.fromEntries(
			variants.map(([name, patch]) => [
				name,
				compare({ ...c, ...patch, id: `${c.id}/${name}` }, cache),
			]),
		),
	};
}

const GRID_AXES = [
	"serviceSPerT",
	"rawValueShare",
	"rawElasticityScale",
	"feeCrPerT",
	"feeShareOfProduct",
	"returnLoadT",
	"visitLargestShare",
	"collectS",
	"hours",
	"routeFields",
	"routeRevisitLoadT",
	"routeChartedFindS",
	"searchRareS",
	"recoveryTPerH",
] as const;
type GridAxis = (typeof GRID_AXES)[number];
const isGridAxis = (name: string): name is GridAxis =>
	GRID_AXES.some((axis) => axis === name);

/** Full-factorial candidate grid: per-variant summaries with their inputs and failures; rows are omitted for size. */
export function grid({
	candidate,
	axes,
}: {
	candidate: Candidate;
	axes: Record<string, readonly number[]>;
}) {
	const combinations = Object.entries(axes).reduce<Record<string, number>[]>(
		(partial, [name, values]) => {
			if (!isGridAxis(name) || !values.length)
				throw new Error(`mining comparison: unsupported grid axis ${name}`);
			return partial.flatMap((inputs) =>
				values.map((value) => ({ ...inputs, [name]: value })),
			);
		},
		[{}],
	);
	const cache = comparisonCache();
	return {
		status: "candidate-grid" as const,
		approvedBalance: false as const,
		candidate,
		axes,
		method: "full factorial; samples retained only as distributions",
		variants: combinations.map((inputs) => {
			const report = compare(
				{
					...candidate,
					...inputs,
					id: `${candidate.id}/${JSON.stringify(inputs)}`,
				},
				cache,
			);
			return {
				inputs,
				corpus: report.corpus,
				refusedScenarios: report.refusedScenarios.length,
				summaries: report.summaries,
				routeSummaries: report.routeSummaries,
				routeComparison: report.routeComparison,
			};
		}),
	};
}
