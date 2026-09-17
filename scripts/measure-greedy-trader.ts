/**
 * What the economy actually pays, per minute, flown against the real generator.
 *
 *   bun run scripts/measure-greedy-trader.ts [hours] [seed]
 *
 * `economy-trade.md` §10.3 requires this before three of its numbers may be
 * believed:
 *
 * 1. **§8's 1.5–2.5 hours** to fit out. The spec states it as a target and says
 *    so — "about fifteen clean runs" is arithmetic over a canonical lane at zero
 *    fluctuation, not a measurement of the galaxy the generator makes.
 * 2. **§6's compounding in minutes.** `runsUntilHoldLimited` derives six *runs*
 *    from 100 Cr; the wall-clock figure needs a run length, which nothing
 *    committed had.
 * 3. **§5.5's "waiting never beats flying"**, which §12 weak joint 5 records as
 *    an assumption. `MARKET_PERIOD` 30 min and `DEFICIT_HALF_LIFE` 20 min were
 *    chosen against a 3–5 minute run so that parking for a re-roll is dominated
 *    by going somewhere else — and no committed code had a time dimension over
 *    the whole loop, so nothing could tell.
 *
 * **Re-run it whenever `MARKET_PERIOD_MIN`, `DEFICIT_HALF_LIFE_MIN` or
 * `PRICE_ELASTICITY` moves.** All three are in this loop, and §12.5 is explicit
 * that changing either of the first two re-opens the exploit with nothing else
 * to catch it.
 *
 * **The trader itself is `scripts/lib/greedy-trader.ts`** (#182), not this
 * file. What is here is the §5.5 and §8 report; #182's hold curve is a second
 * report over the same engine, and one engine is what makes the two arms of a
 * sweep incapable of differing in the way #25's three riggings did.
 */

import {
	BID_CUT_FLOOR,
	BID_CUT_GRADE,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	PRICE_STEP_CR,
	type QuoteFn,
	bidCutAtTl,
	HOLD_REFERENCE_T,
	marketQuote,
	quoteWithCut,
} from "../src/market";
import {
	type WorstCycle,
	NO_WEDGE,
	surveyConsoleCycles,
} from "../tests/helpers/console-cycle";
import {
	DOCK_SECONDS,
	finite,
	GALAXY_LIST,
	JUMP_SECONDS,
	type Result,
	run,
	START_CR,
	WORKING_FLOAT_CR,
	worldFor,
} from "./lib/greedy-trader";

const hours = Number(process.argv[2] ?? 4);
const worldSeed = Number(process.argv[3] ?? 0x5ee11e);
if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours must be > 0");
// The same guard, for the reason `finite()` exists: a mistyped seed otherwise
// enters `generateGalaxy` as `NaN` and the run reports a galaxy nobody asked
// for.
if (!Number.isInteger(worldSeed))
	throw new Error(`seed must be an integer, got ${process.argv[3]}`);

console.log(
	`greedy trader — world 0x${worldSeed.toString(16)}, ${hours} h cap, ` +
		`${HOLD_REFERENCE_T} t hold, ${START_CR} Cr start`,
);
console.log(
	`modelled: jump ${JUMP_SECONDS}s, dock+market ${DOCK_SECONDS}s. ` +
		"Everything else is `legSeconds` against the placed bodies.\n",
);

/** Each galaxy built once and reused by the sweep below. */
const WORLDS = GALAXY_LIST.map((g) => ({ g, world: worldFor(worldSeed, g) }));
const results = WORLDS.map(({ g, world }) => ({ g, r: run(world, hours) }));

/** One derivation, two tables. Written out twice they drift on the next edit,
 *  and the two copies already spelled the kit total differently.
 *
 *  `earnedCr` is the engine's, for the same reason one step further out: #182's
 *  report needs the identical rate, and `START_CR` — capital the trader was
 *  handed rather than money it made — is a bias in exactly the direction §8
 *  argues about, so a second copy that dropped the subtraction would flatter
 *  one report and not the other. */
const summarize = (r: Result): { rate: number; kit: number | null } => ({
	kit: r.kitAffordableAtMinutes,
	rate: finite("Cr/min", r.earnedCr / Math.max(r.minutes, 1e-9)),
});

console.log(
	"galaxy   minutes    Cr/min   hops   intra    jump   waits   kit affordable",
);
for (const { g, r } of results) {
	const { rate, kit } = summarize(r);
	console.log(
		`${String(g).padStart(6)}${finite("minutes", r.minutes).toFixed(1).padStart(10)}` +
			`${rate.toFixed(1).padStart(10)}${String(r.hops).padStart(7)}` +
			`${String(r.intra).padStart(8)}${String(r.jumps).padStart(8)}` +
			`${String(r.waits).padStart(8)}   ${kit === null ? "not in cap" : `${kit.toFixed(0)} min`}`,
	);
}

console.log("\ntime to each upgrade, minutes (galaxy 0)");
console.log("  item                  affordable    bought");
for (const u of results[0].r.upgrades)
	console.log(
		`  ${u.name.padEnd(22)}${finite(u.name, u.affordableAtMinutes).toFixed(1).padStart(10)}` +
			`${finite(u.name, u.atMinutes).toFixed(1).padStart(10)}`,
	);
console.log(
	`  (\`bought\` trails \`affordable\` by the ${WORKING_FLOAT_CR} Cr working float, ` +
		"which is a property of this sim and not of the economy.)",
);
if (results[0].r.upgrades.length === 0) console.log("  none — nothing bought");
{
	// §6 quotes the first purchase's affordability, so it gets a range across
	// the four galaxies rather than galaxy 0's figure standing for all of them.
	const first = results
		.map(({ r }) => r.upgrades.find((u) => u.name === "Large Cargo Bay"))
		.filter((u): u is NonNullable<typeof u> => u !== undefined)
		.map((u) => u.affordableAtMinutes);
	if (first.length > 0)
		console.log(
			`  Large Cargo Bay affordable across ${first.length} galaxies: ` +
				`${finite("first", Math.min(...first)).toFixed(1)}–${finite("first", Math.max(...first)).toFixed(1)} min`,
		);
}

/** One derivation of the wait distribution, for the two places that report it.
 *  Two copies of the "won" predicate would have to move together the day it
 *  changes. */
const waitStats = (input: readonly number[]) => {
	const r = [...input].sort((a, b) => a - b);
	const at = (q: number) =>
		r.length === 0
			? 0
			: finite("ratio", r[Math.min(r.length - 1, Math.floor(q * r.length))]);
	return {
		n: r.length,
		median: at(0.5),
		p95: at(0.95),
		max: at(1),
		won: r.filter((x) => x > 1).length,
	};
};

console.log("\n§5.5 — waiting against flying");
const all = waitStats(results.flatMap(({ r }) => r.waitRatios));
const waited = results.reduce((sum, { r }) => sum + r.waits, 0);
const flew = results.reduce((sum, { r }) => sum + r.hops, 0);
if (all.n === 0) {
	console.log("  no decision point ever offered a profitable wait.");
} else {
	console.log(`  decision points where a wait was on the table: ${all.n}`);
	console.log(
		`  wait rate / best flight rate — median ${all.median.toFixed(3)}×, ` +
			`p95 ${all.p95.toFixed(3)}×, max ${all.max.toFixed(3)}×`,
	);
	console.log(
		`  points where waiting won: ${all.won} (${((100 * all.won) / all.n).toFixed(1)}%)`,
	);
	console.log(`  hops actually spent waiting: ${waited} of ${flew + waited}`);
	console.log(
		all.won === 0
			? "  waiting never beat flying — §5.5's intent holds at these constants."
			: "  **waiting beat flying somewhere** — §5.5's intent is not unconditional " +
					"at these constants. The share above is what it is worth.",
	);
}

// The dock cost is paid on every hop and is half the clock, so the milestone
// above is a claim about it as much as about the economy. Swept rather than
// conceded in prose: if 45 s is wrong by 2×, this is what moves.
//
// **Across all four galaxies, not galaxy 0.** A one-galaxy sweep was the first
// version, and galaxy 0 is the one that never produces a winning wait — so it
// reported a null result drawn from a population without the phenomenon, and
// then concluded the phenomenon was not an artefact of the constant. The wait
// distribution is swept with the milestone because a longer dock stop makes
// flying worse relative to waiting, which is exactly the direction §5.5 argues
// about.
console.log(
	`\ndock+market cost, swept over ${GALAXY_LIST.length} galaxies — the modelled number that decides`,
);
console.log(
	"  dock s   kit affordable      Cr/min   waits won    rate    max×",
);
for (const dock of [15, 30, 45, 60, 90]) {
	const swept = WORLDS.map(({ world }) =>
		run(world, hours, { dockSeconds: dock }),
	);
	const kits = swept
		.map((r) => summarize(r).kit)
		.filter((k): k is number => k !== null);
	const rates = swept.map((r) => summarize(r).rate);
	const stats = waitStats(swept.flatMap((r) => r.waitRatios));
	console.log(
		`${String(dock).padStart(8)}   ` +
			(kits.length === GALAXY_LIST.length
				? `${finite("kit", Math.min(...kits)).toFixed(0)}–${finite("kit", Math.max(...kits)).toFixed(0)} min`
				: `${kits.length}/${GALAXY_LIST.length} in cap`
			).padEnd(15) +
			`${finite("rate", Math.min(...rates)).toFixed(0)}–${finite("rate", Math.max(...rates)).toFixed(0)}`.padStart(
				10,
			) +
			`${stats.won}/${stats.n}`.padStart(12) +
			`${((100 * stats.won) / Math.max(stats.n, 1)).toFixed(1)}%`.padStart(8) +
			`${stats.max.toFixed(2)}×`.padStart(9),
	);
}

{
	// Over the four reported runs only — the dock sweep's five extra runs are
	// not in this figure, which is what made the first version of it wrong.
	const truncated = results.reduce((sum, { r }) => sum + r.tally.truncated, 0);
	const enumerations = results.reduce(
		(sum, { r }) => sum + r.tally.enumerations,
		0,
	);
	console.log(
		// The limit these runs *flew*, read off a result rather than off the default,
		// so the line cannot describe a sweep it did not report.
		`\nneighbour list truncated at ${results[0].r.neighbourLimit} on ${truncated} of ` +
			`${enumerations} neighbour lookups (${((100 * truncated) / Math.max(enumerations, 1)).toFixed(1)}%) ` +
			"— where it bit, the trader did not see the whole jump range.",
	);
}
{
	// **What the truncation costs, not just how often it bites.** Reporting a
	// blind rate and calling the trader a ceiling is half an answer: the question
	// is whether the eight nearest systems are where the money is. Run again at
	// sixteen and compare — if the milestone barely moves, the limit is bounding
	// work rather than knowledge after all. **Per run rather than through a
	// module-level setter**, which is what it was: a global a caller flips
	// between arms is the variance surface `RunOptions` exists to close.
	const wide = WORLDS.map(({ world }) =>
		run(world, hours, { neighbourLimit: 16 }),
	);
	const kitsOf = (rs: Result[]) =>
		rs
			.map((r) => r.kitAffordableAtMinutes)
			.filter((k): k is number => k !== null);
	const narrowKits = kitsOf(results.map(({ r }) => r));
	const wideKits = kitsOf(wide);
	const span = (k: number[]) =>
		k.length === 0
			? "none in cap"
			: `${finite("kit", Math.min(...k)).toFixed(0)}–${finite("kit", Math.max(...k)).toFixed(0)} min`;
	console.log(
		`\nneighbour limit 8 vs 16 — kit affordable ${span(narrowKits)} vs ${span(wideKits)}`,
	);
}

const totalMin = results.reduce((sum, { r }) => sum + r.minutes, 0);
const modelled = results.reduce(
	(sum, { r }) => sum + r.jumpMinutes + r.dockMinutes,
	0,
);
console.log(
	`\nmodelled time as a share of the total: ${((100 * modelled) / Math.max(totalMin, 1e-9)).toFixed(1)}% ` +
		"— the rest is the generator's own geometry, estimated by `legSeconds`.",
);

// ---------------------------------------------------------------------------
// §5.6 — the bid cut: what it closes, and what it costs to close it
// ---------------------------------------------------------------------------

/**
 * **This section exists because #196 asked for both ends and not one.** *Closed
 * has to mean measured-at-zero rather than smaller-than-before* — that is the
 * closure ladder below, flown through the game's own `transactAtStation`. And a
 * cut that closes a pump is only worth shipping if the honest trade loop still
 * runs, which is the direction sweep under it. One engine holds both, so the
 * figure that closes the hole cannot be quoted without the figure that prices it.
 *
 * **Determinism, stated once.** Every arm here is a pure function of the world
 * seed and its own parameters, so a same-build control is bit-identical and a
 * "noise floor" would be theatre. The comparisons that mean something are
 * therefore against *matched* arms: the no-wedge law for "did the spread change
 * anything", and a flat spread at the same mean cut for "was it the direction or
 * merely the level". What is *not* controlled is the sample — four galaxies is
 * four draws, and the spread across them is printed as a range rather than
 * smoothed into a mean so the thinness stays visible.
 */
const TL_SPAN = DISPLAY_TL_MAX - DISPLAY_TL_MIN + 1;

/** One-sided, uniform in tech level: the shape the closure ladder needs. */
const uniformCut = (cut: number): QuoteFn => quoteWithCut(() => cut);

/**
 * The wedge split across both columns, which is the one shape `quoteWithCut`
 * cannot express because it moves the *ask* as well as the bid.
 *
 * It lives here rather than in `market.ts` for that reason: the game does not ship
 * it, #191 D1 declined it, and the only thing it is good for is saying what the
 * shipped one-sided law costs against it. Both arms are still guarded against
 * `marketQuote` below, since an unguarded re-implementation is what the "shipped"
 * row in this report once quietly was.
 */
const quoteSplitting =
	(eachSide: number): QuoteFn =>
	(mid, tl) => ({
		buyCr: mid * (1 + eachSide),
		sellCr: Math.max(PRICE_STEP_CR, mid * (1 - eachSide)),
	});

/**
 * The shipped law's shape with two dials: `base` at the rim, `+grade` at the
 * core, or mirrored when `wideAtRim`.
 *
 * The shipped table is `spreadArm(BID_CUT_FLOOR, BID_CUT_GRADE, false)`, and the
 * row below checks exactly that against `bidCutAtTl` before any arm is flown —
 * otherwise the report's "shipped" row could quietly be a re-implementation,
 * which is §4's scope note's whole objection to an instrument with its own rules.
 */
const spreadArm = (
	base: number,
	grade: number,
	wideAtRim: boolean,
): QuoteFn => {
	// The same offset `bidCutAtTl` uses — 0 at the rim, 1 at the core — because the
	// "shipped" row below has to *be* the shipped table, and the guard under this
	// function is what says whether it is. It used to be one-based over the span,
	// which is what left `BID_CUT_FLOOR` naming a cut no market pays; the mirror
	// takes the complementary offset, which is the same multiset of cuts in the
	// other order, so a difference between the two rows is the direction and not the
	// level.
	const position = (tl: number) =>
		(wideAtRim ? DISPLAY_TL_MAX - tl : tl - DISPLAY_TL_MIN) / (TL_SPAN - 1);
	return quoteWithCut((tl) => base + grade * position(tl));
};

const shippedMatchesTheLaw = (): boolean => {
	const arm = spreadArm(BID_CUT_FLOOR, BID_CUT_GRADE, false);
	for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
		const viaArm = arm(100, tl).sellCr;
		const viaLaw = marketQuote(100, tl).sellCr;
		if (Math.abs(viaArm - viaLaw) > 1e-12) return false;
	}
	return true;
};

const bindingRow = (row: WorstCycle): string =>
	`${row.cycle.good.name}/${row.cycle.hull} e${row.cycle.economy} ` +
	`${row.cycle.type} TL${row.cycle.displayTL} ${row.cycle.arm} ` +
	`(${row.units} u @ ${row.midCr.toFixed(2)} Cr)`;

console.log("\n§5.6 — the console round trip, cut swept");
if (!shippedMatchesTheLaw())
	console.log(
		"  ** the report's arms no longer agree with `marketQuote` — the rows below " +
			"measure a spread the game does not ship. **",
	);
console.log(
	"  cut     tonnage cycles open   sub-tonne cycles open   best surviving cycle",
);
for (const cut of [0, 0.05, 0.075, 0.09, 0.1, 0.15, 0.2, 0.315]) {
	const s = surveyConsoleCycles(uniformCut(cut));
	console.log(
		`${cut.toFixed(3).padStart(7)}   ` +
			`${s.positiveByTonnage.tonnage}`.padStart(22) +
			`${s.positiveByTonnage.subTonnes}`.padStart(23) +
			`   ${s.positiveRows === 0 ? "—" : bindingRow(s.worst)}`,
	);
}
const shippedSurvey = surveyConsoleCycles(marketQuote);
console.log(
	`  shipped  ` +
		`${shippedSurvey.positiveByTonnage.tonnage}`.padStart(21) +
		`${shippedSurvey.positiveByTonnage.subTonnes}`.padStart(23) +
		`   ${shippedSurvey.positiveRows === 0 ? "—" : bindingRow(shippedSurvey.worst)}`,
);
console.log(
	// Read off the shipped function at the domain's ends, not off the constants: the
	// first version of this line printed `BID_CUT_FLOOR` as the rim cut while the
	// table's rim cut was 0.110, and the report reprinted the wrong figure for a
	// round.
	`  cut at the rim ${bidCutAtTl(DISPLAY_TL_MIN).toFixed(3)}, at the core ${bidCutAtTl(DISPLAY_TL_MAX).toFixed(3)}; ` +
		`rows flown ${shippedSurvey.rows.toLocaleString()}; ` +
		// Each of these is flown again with the quote step taken off, which is the only
		// reading that says *what* closed it. The last figure is the one to watch: a
		// zero the display precision closes is the weakest closure there is, and it
		// belongs in the open rather than folded into the count above it.
		`${shippedSurvey.zeroRows} net nothing, of which ` +
		`${shippedSurvey.zeroOffFloor.count} are not on a row §3's floor pins: ` +
		`${shippedSurvey.zeroOffFloor.lawCloses} closed by the law outright, ` +
		`${shippedSurvey.zeroOffFloor.quantizedToZero} the law loses and the quote ` +
		`step washes, ` +
		`${shippedSurvey.zeroOffFloor.rescuedByRounding.count} would profit without ` +
		`the tenth-credit quote step (best ` +
		`${shippedSurvey.zeroOffFloor.rescuedByRounding.worstCr.toFixed(2)} Cr).`,
);

/**
 * The smallest cut with no profitable tonnage cycle, by bisection.
 *
 * Bisection rather than a ladder because the answer is a *step* in a monotone
 * predicate and a ladder reports the last rung it tried. The bracket is printed
 * with the figure so the resolution is part of the claim: `<= 1e-3` is the width
 * the search was allowed to leave, not a claim about the constants.
 */
const closingCut = (
	arm: (x: number) => QuoteFn,
): { cr: number; width: number } => {
	const closes = (x: number): boolean =>
		surveyConsoleCycles(arm(x)).positiveByTonnage.tonnage === 0;
	let lo = 0;
	let hi = 0.6;
	if (!closes(hi)) return { cr: Number.NaN, width: Number.NaN };
	while (hi - lo > 1e-3) {
		const mid = (lo + hi) / 2;
		if (closes(mid)) hi = mid;
		else lo = mid;
	}
	return { cr: hi, width: hi - lo };
};

console.log("\n§5.6 — what closure costs, one-sided against split");
const oneSidedClosing = closingCut((x) => uniformCut(x));
const splitClosing = closingCut(quoteSplitting);
console.log(
	`  one-sided, cut on the bid alone: closes at ${oneSidedClosing.cr.toFixed(3)} ` +
		`(±${oneSidedClosing.width.toFixed(3)}) — total wedge ${oneSidedClosing.cr.toFixed(3)}`,
);
console.log(
	`  split across both columns: closes at ${splitClosing.cr.toFixed(3)} each side ` +
		`(±${splitClosing.width.toFixed(3)}) — total wedge ${(2 * splitClosing.cr).toFixed(3)}`,
);
console.log(
	"  so the split form costs more of the player's margin for the same closure, and it " +
		"raises what the BUY column charges, which #191 D1 declined to do.",
);

console.log("\n§5.6 — direction, at matched mean cut");
console.log(
	"  arm                kit affordable     Cr/min   docks by TL 1-5/6-10/11-15   mean radius",
);
/**
 * What an arm costs, in the four readings the direction question is decided on.
 *
 * **One measurement, two printers**, because the direction table and the grade
 * ladder are the same run wearing a different dial on the left, and two copies of
 * an accumulator is how a report ends up with rows that look comparable and are
 * not. `kits` stays per-galaxy rather than collapsing into the range, because the
 * claim §5.6 makes is about *each* pairing, and a min–max across four draws cannot
 * show whether they agreed.
 */
const armStats = (quote: QuoteFn) => {
	const milestone = WORLDS.map(({ world }) => run(world, hours, { quote }));
	const rateRuns = WORLDS.map(({ world }) =>
		run(world, hours, { quote, stopAtKit: false }),
	);
	const kits = milestone
		.map((r) => r.kitAffordableAtMinutes)
		.filter((k): k is number => k !== null);
	const rates = rateRuns.map((r) => r.earnedCr / Math.max(r.minutes, 1e-9));
	const bands = [0, 0, 0];
	let docks = 0;
	let radius = 0;
	let stalled = 0;
	for (const r of rateRuns) {
		for (const tl of r.dockTl) {
			bands[tl <= 5 ? 0 : tl <= 10 ? 1 : 2]++;
			docks++;
		}
		for (const t of r.dockRadius) radius += t;
		// A run that stops hunting has stopped trading, and its share of the mix
		// below is a claim about a halt rather than about an economy.
		if (r.stalled) stalled++;
	}
	return {
		kits,
		kitLabel:
			kits.length === WORLDS.length
				? `${Math.min(...kits).toFixed(0)}-${Math.max(...kits).toFixed(0)} min`
				: `${kits.length}/${WORLDS.length} in cap`,
		rateLabel: `${Math.min(...rates).toFixed(0)}-${Math.max(...rates).toFixed(
			0,
		)}`,
		bandLabel: bands
			.map((n) => ((100 * n) / Math.max(docks, 1)).toFixed(0))
			.join("/"),
		radius: radius / Math.max(docks, 1),
		stalled,
	};
};

type ArmStats = ReturnType<typeof armStats>;

/** The direction table's printer: the arm's name, then everything measured. */
const routeRow = (name: string, quote: QuoteFn): ArmStats => {
	const s = armStats(quote);
	console.log(
		`  ${name}`.padEnd(21) +
			s.kitLabel.padEnd(19) +
			s.rateLabel.padEnd(11) +
			s.bandLabel.padEnd(26) +
			s.radius.toFixed(3) +
			(s.stalled ? `   stalled ${s.stalled}/${WORLDS.length}` : ""),
	);
	return s;
};
routeRow("no wedge (control)", NO_WEDGE);
// The ladder runs to 0.30 rather than stopping at the shipped mean because the
// question this section answers is not only "which direction" but "at what level
// does the honest loop stop being an economy" — the number that decides whether a
// deeper floor is affordable. It is printed at the same matched-mean width as the
// rest, so the last rung is comparable to the rows above it and not a separate
// claim.
const gradeAt = (mean: number): number => {
	// **The mean of the graded table, computed rather than asserted.** With the
	// offset running 0…1 the average of `position` over the domain is 1/2, so a grade
	// of twice the target mean puts the graded table's average cut at that mean —
	// which is what makes the two graded rows the same *level* of spread in opposite
	// directions. It was not exact while the offset was one-based: the average of
	// 1/15…15/15 is 8/15, so every "matched" pair ran 6.7% hot against its own flat
	// control, and the row that said "same mean" did not mean it.
	const meanPosition =
		Array.from({ length: TL_SPAN }, (_, i) => i / (TL_SPAN - 1)).reduce(
			(a, b) => a + b,
			0,
		) / TL_SPAN;
	return mean / meanPosition;
};
const gradedMeanCheck = (mean: number): string => {
	let total = 0;
	for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++)
		total += spreadArm(0, gradeAt(mean), false)(100, tl).sellCr;
	return (1 - total / (100 * TL_SPAN)).toFixed(4);
};
/** Per-galaxy kit for the two graded arms at each rung, kept for the pair table. */
const PAIRS: [number, ArmStats, ArmStats][] = [];
for (const mean of [0.1, 0.15, 0.2, 0.3]) {
	routeRow(`flat ${mean.toFixed(2)}`, uniformCut(mean));
	const narrow = routeRow(
		`narrow at rim ${mean.toFixed(2)}`,
		spreadArm(0, gradeAt(mean), false),
	);
	const wide = routeRow(
		`wide at rim ${mean.toFixed(2)}`,
		spreadArm(0, gradeAt(mean), true),
	);
	PAIRS.push([mean, narrow, wide]);
	// Printed beside the rows it guards, because "matched mean" is an arithmetic
	// claim and arithmetic that is only asserted in a comment goes wrong.
	console.log(
		`      (mean cut of the graded table at this rung: ${gradedMeanCheck(mean)}, ` +
			`target ${mean.toFixed(2)})`,
	);
}
routeRow("shipped table", marketQuote);
console.log(
	"  per galaxy, narrow against wide, so four draws cannot be read as one range:",
);
for (const [mean, narrow, wide] of PAIRS) {
	console.log(
		`      mean ${mean.toFixed(2)}  kit by galaxy (narrow/wide)  ` +
			WORLDS.map(({ g }, i) => {
				const n = narrow.kits[i];
				const w = wide.kits[i];
				return `${g} ${n === undefined ? "—" : n.toFixed(0)}/${w === undefined ? "—" : w.toFixed(0)}`;
			}).join("   "),
	);
}
console.log(
	"  radius is the generator's normalised galactic distance — 0 is the core, 1 the rim — " +
		"averaged over the systems a trader actually docked at.",
);
console.log(
	"  #191 D4's direction is decided off these rows: the mix is the reading, and the hop " +
		"ratio is not (§10.3 — it reports the option pools, not the economy).",
);

/**
 * The grade alone, at the shipped floor.
 *
 * **Why this is a separate ladder and not one more rung of the one above.** Every
 * arm of the matched-mean sweep changes the rim and the core together, so nothing
 * there can attribute anything to the *difference* between them: raising the grade
 * raises the mean with it, and the matched arm re-balances by lowering the base.
 * Holding `BID_CUT_FLOOR` where the game ships it and sweeping only the grade is
 * the one ladder that answers the question `BID_CUT_GRADE`'s docstring asks — what
 * does a wider rim-to-core spread cost a commander who has not been to the core
 * yet — because that commander trades at the rim end, where the floor holds still.
 */
console.log("\n§5.6 — the grade alone, floor held at its shipped value");
console.log(
	"  grade  rim → core      kit affordable     Cr/min   docks by TL 1-5/6-10/11-15   mean radius",
);
for (const grade of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
	const g = armStats(spreadArm(BID_CUT_FLOOR, grade, false));
	console.log(
		`  ${grade.toFixed(2)}`.padEnd(9) +
			`${bidCutAtTl(DISPLAY_TL_MIN).toFixed(3)} → ${(BID_CUT_FLOOR + grade).toFixed(3)}`.padEnd(
				15,
			) +
			g.kitLabel.padEnd(19) +
			g.rateLabel.padEnd(11) +
			g.bandLabel.padEnd(26) +
			g.radius.toFixed(3) +
			(g.stalled ? `   stalled ${g.stalled}/${WORLDS.length}` : ""),
	);
}
console.log(
	"  the shipped rung is 0.15. Every row here trades at the same rim end, so what " +
		"moves down the column is only how much a core market takes off a seller.",
);
