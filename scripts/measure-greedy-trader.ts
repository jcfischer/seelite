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
	bidCutLadder,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	PRICE_STEP_CR,
	type MarketQuote,
	type QuoteFn,
	quantizeToDisplayStepCr,
	bidCutAtTl,
	HOLD_REFERENCE_T,
	marketQuote,
	quoteWithCut,
} from "../src/market";
import {
	type WorstCycle,
	type CycleSurvey,
	MIRRORED_SHIPPED,
	NO_WEDGE,
	mirroredBidCut,
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
	(
		eachSide: number,
		{ quantize = true }: { quantize?: boolean } = {},
	): QuoteFn =>
	(mid, tl) => {
		// The same step `quoteWithCut` applies — or its absence, on both sides of a
		// comparison, never one arm with it and the other without. The survey counts
		// cycles that only the tenth-credit quote closes, so a wedge comparison that
		// gives one arm the rounding and not the other is measuring the rounding.
		const step = (cr: number) => (quantize ? quantizeToDisplayStepCr(cr) : cr);
		return {
			buyCr: step(mid * (1 + eachSide)),
			sellCr: step(Math.max(PRICE_STEP_CR, mid * (1 - eachSide))),
		};
	};

/**
 * An arm of the graded family: the **law's own** parametric ladder, through the
 * **law's own** quote builder.
 *
 * Both halves matter. The offset used to be re-typed here, which made the guard that
 * checks an arm against "the law" a comparison of two copies of one formula; and an
 * arm that built its own quote could differ from the shipped law in anything except
 * the dial its name advertises, which turns a report into a comparison of two
 * implementations rather than two spreads.
 */
const spreadArm = (base: number, grade: number, mirrored = false): QuoteFn =>
	quoteWithCut(
		mirrored ? mirroredBidCut(base, grade) : bidCutLadder(base, grade),
	);

/**
 * The arm names, spelled the way the *decision* is phrased.
 *
 * "Narrow at rim" and "wide at rim" describe where the table is thin, which is the
 * inverse of the #191 D4 question — "does the spread widen or narrow with tech level" —
 * and the two phrasings got crossed in prose, and then again in a variable name, in the
 * space of two rounds of this node. A spread that is cheap at the rim and dear in the
 * core is **wide at high TL**, and that is the arm the game ships. Nothing in this file
 * is allowed to say `narrow` or `wide` about an arm except through these two names.
 */
const SHIPPED_ARM = "wide at high TL (shipped)";
const OPPOSING_ARM = "narrow at high TL";

/**
 * The label column's width, derived from the longest label the report can print.
 *
 * **Not a literal, and that has been the bug twice.** The column was 27 characters
 * until the arms were renamed to spell the decision out; the shipped arm's row — name
 * plus its rung — then ran four characters past it and printed the kit figure against
 * the name. A width taken from the names cannot go stale when a name grows, which is
 * the same reason the names are constants.
 */
/** The rung an arm's label carries. One owner, because the column width reads it. */
const armRung = (floor: number, grade: number): string =>
	` @ ${floor.toFixed(3)}/${grade.toFixed(3)}`;

/** The suffix the developed-start rows append to an arm's name. One owner, because the
 *  column width has to account for it or the label runs into the count. */
const DEVELOPED_SUFFIX = " from a developed start";

const ARM_LABEL_COL =
	Math.max(
		SHIPPED_ARM.length,
		OPPOSING_ARM.length,
		SHIPPED_ARM.length + DEVELOPED_SUFFIX.length,
		OPPOSING_ARM.length + DEVELOPED_SUFFIX.length,
	) +
	armRung(0, 0.20047).length + // the suffix the graded rows append
	2 + // the two-space indent
	2; // slack, so no label ever touches the count

const MID_PROBE = 100;
/**
 * The three expectations one arm has to meet at one tech level: the two columns it
 * quotes, each through the tenth-credit step the shipped law applies.
 *
 * Comparing a *realized* spread against a declared cut is the mistake this guard
 * caught on its first run — at TL 2 the shipped law spreads 0.1110 where
 * `bidCutAtTl` says 0.1107, because 88.9286 Cr becomes 88.9 Cr on the way out. That
 * difference is the quote step and not a drift, so the guard asks the question the
 * law actually answers: given the factor this arm means to apply, what figure comes
 * off the quote?
 */
/**
 * The one quote-equality guard every arm check goes through.
 *
 * **Both directions and both sides, in one place.** Three guards used to spell the same
 * `quantizeToDisplayStepCr(Math.max(PRICE_STEP_CR, mid × factor))` expression
 * independently, and a guard that drifts from the law it guards is worse than no guard —
 * it reports an arm as shipped when only the guard changed. `want` says what a mid *must*
 * be quoted as; everything else here is plumbing.
 */
const assertQuote = (
	name: string,
	quote: QuoteFn,
	want: (midCr: number, tl: number) => MarketQuote,
	mids: readonly number[] = [MID_PROBE],
): void => {
	for (const midCr of mids)
		for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
			const got = quote(midCr, tl);
			const wantQ = want(midCr, tl);
			if (got.buyCr !== wantQ.buyCr || got.sellCr !== wantQ.sellCr)
				throw new Error(
					`arm "${name}" is not the law at ${midCr} TL ${tl}: it quotes ` +
						`${got.buyCr}/${got.sellCr} against ${wantQ.buyCr}/${wantQ.sellCr}`,
				);
		}
};

/** The floor-and-step law applied to a factor per side — what every arm claims. */
const quoteOf =
	(factors: (tl: number) => { buy: number; sell: number }) =>
	(midCr: number, tl: number): MarketQuote => ({
		buyCr: quantizeToDisplayStepCr(
			Math.max(PRICE_STEP_CR, midCr * factors(tl).buy),
		),
		sellCr: quantizeToDisplayStepCr(
			Math.max(PRICE_STEP_CR, midCr * factors(tl).sell),
		),
	});

const assertArm = (
	name: string,
	quote: QuoteFn,
	factors: (tl: number) => { buy: number; sell: number },
): void => assertQuote(name, quote, quoteOf(factors));
const bidArmFactors = (cut: (tl: number) => number) => (tl: number) => ({
	buy: 1,
	sell: 1 - cut(tl),
});
/**
 * Fly an arm, and prove the arm the report *names* is the arm it *flies*.
 *
 * Written once because the call was copied four times with its dials typed twice each
 * — and a copy that gets one argument mismatched checks a different arm from the one
 * the table prints, which is the failure this guard exists to catch.
 */
const assertLadderArm = (
	name: string,
	base: number,
	grade: number,
	mirrored = false,
) =>
	assertArm(
		name,
		spreadArm(base, grade, mirrored),
		bidArmFactors(
			mirrored ? mirroredBidCut(base, grade) : bidCutLadder(base, grade),
		),
	);

const assertFlownArms = () => {
	assertArm("shipped law", marketQuote, bidArmFactors(bidCutAtTl));
	// The shipped arm, checked twice over: once against the parameters it was built from, which
	// catches a mis-typed `spreadArm`, and once against `bidCutAtTl` itself, which is
	// what makes the report's "shipped" row the shipped table rather than a close
	// relative of it.
	// **The guard that can actually fail, and what it is for.** `bidCutAtTl` *is*
	// `bidCutLadder` at the shipped constants, so a loop comparing those two could not
	// throw and a comment calling it the one independent check was wrong — sage caught it,
	// and it caught nothing for two rounds. What can fail is the *direction*: this is the
	// check that would have caught round 4, where the arm named `wide at high TL` was
	// built from the mirrored table. The game's own `marketQuote` is the oracle, so the
	// comparison is against what ships rather than against a copy of a formula.
	assertQuote(
		`report's ${SHIPPED_ARM} arm`,
		spreadArm(BID_CUT_FLOOR, BID_CUT_GRADE, false),
		marketQuote,
		[1.4, 12, 100, 786],
	);
	// **And the rejected direction is the mirror of the shipped dials, at the same two
	// constants.** Checked against `marketQuote` reflected on the tech level, because the
	// arm's whole claim is that its dear end is where the shipped law's cheap end is.
	assertQuote(
		"MIRRORED_SHIPPED as the shipped law reflected",
		MIRRORED_SHIPPED,
		(midCr, tl) => marketQuote(midCr, DISPLAY_TL_MAX + DISPLAY_TL_MIN - tl),
		[12, 100],
	);
	// The mirrored arm, checked against its own stated dials. Graded rungs scale the
	// mirror by their own mean; `routeRow` checks each one as it is flown, since a
	// check at the shipped depth cannot cover a dial the loop turns later.
	assertLadderArm(OPPOSING_ARM, 0, BID_CUT_GRADE, true);
	assertArm(
		"flat 0.10",
		uniformCut(0.1),
		bidArmFactors(() => 0.1),
	);
	// The split wedge moves both columns, so its ask is above the mid and a guard that
	// assumed the mid on that side would be wrong in the same way twice.
	assertArm("split 0.05", quoteSplitting(0.05), () => ({
		buy: 1.05,
		sell: 0.95,
	}));
};
/**
 * The claim that the quote the trader *flies* is the cut the row *claims*, in the one
 * quote-equality guard every other arm check also goes through.
 *
 * The arm-rebuilding guards (`assertLadderArm`) compare a formula to itself, which can
 * only agree; this compares a `QuoteFn` against a cut function at four mids and all
 * fifteen tech levels, and it is what round 4's crossed bindings would have tripped.
 */
const assertFlownArmCut = (
	name: string,
	quote: QuoteFn,
	cut: (tl: number) => number,
): void =>
	assertQuote(
		name,
		quote,
		quoteOf((tl) => ({ buy: 1, sell: 1 - cut(tl) })),
		[1, 2.37, 100, 632.4],
	);

const bindingRow = (row: WorstCycle): string =>
	`${row.cycle.good.name}/${row.cycle.hull} e${row.cycle.economy} ` +
	`${row.cycle.type} TL${row.cycle.displayTL} ${row.cycle.arm} ` +
	`(${row.units} u @ ${row.midCr.toFixed(2)} Cr)`;

/**
 * One row of the closure ladder.
 *
 * **Written once because the shipped row was a copy of the loop row with different
 * padding** — `padStart(22)` against `padStart(21)` — which put the shipped row's counts
 * one column left of the header's. Same file, same table, and the fix `formatArmStats`
 * was extracted for in the first place.
 */
const ladderRow = (label: string, survey: CycleSurvey): string =>
	`${label}`.padStart(7) +
	`${survey.positiveByTonnage.tonnage}`.padStart(22) +
	`${survey.positiveByTonnage.subTonnes}`.padStart(23) +
	`   ${survey.positiveRows === 0 ? "—" : bindingRow(survey.worst)}`;

console.log("\n§5.6 — the console round trip, cut swept");
assertFlownArms();
console.log(
	"  cut     tonnage cycles open   sub-tonne cycles open   best surviving cycle",
);
for (const cut of [0, 0.05, 0.075, 0.09, 0.1, 0.15, 0.2, 0.315])
	console.log(ladderRow(cut.toFixed(3), surveyConsoleCycles(uniformCut(cut))));
const shippedSurvey = surveyConsoleCycles(marketQuote);
console.log(ladderRow("shipped", shippedSurvey));
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
// The rows behind that count, a few of them. A number said in the abstract is a
// number nobody can check; these are the cycles a reader can go and fly.
for (const row of shippedSurvey.zeroOffFloor.rescuedByRounding.rows.slice(0, 3))
	console.log(`      ${row}`);

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
	// **Tonnage only, and no zero classification.** This predicate reads one counter,
	// and it is called about forty-four times per report. Flying the metals and re-flying
	// every netting-nothing cycle unquantized — which is what the attribution needs and
	// a boolean does not — bought nothing here.
	const closes = (x: number): boolean =>
		surveyConsoleCycles(arm(x), {
			tonnageOnly: true,
			classifyZeros: false,
		}).positiveByTonnage.tonnage === 0;
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
// **Both arms unquantized, because the question is about the wedge's shape.** The
// shipped ladder above runs on the law as it ships, tenth-credit step included. This
// one asks how much margin a split wedge costs for the same closure, and the survey
// counts cycles that only the quote's precision closes — so giving one arm the
// rounding and the other arm none measures the rounding. The two rows below are a
// matched pair in that respect, and the line says which mode it ran in.
const oneSidedClosing = closingCut((x) =>
	quoteWithCut(() => x, { quantize: false }),
);
const splitClosing = closingCut((x) => quoteSplitting(x, { quantize: false }));
console.log(
	"  (both arms with the tenth-credit quote step off, so the difference is the shape " +
		"of the wedge and not its precision)",
);
console.log(
	`  one-sided, cut on the bid alone: closes at ${oneSidedClosing.cr.toFixed(3)} ` +
		`(±${oneSidedClosing.width.toFixed(3)}) — total wedge ${oneSidedClosing.cr.toFixed(3)}`,
);
console.log(
	`  split across both columns: closes at ${splitClosing.cr.toFixed(3)} each side ` +
		`(±${splitClosing.width.toFixed(3)}) — total wedge ${(2 * splitClosing.cr).toFixed(3)}`,
);
// The shipped, quantized pair, printed beside it rather than merged into it: the
// rounded arm is the law the game runs, and where the two differ is the quote step's
// own contribution to closure.
const oneSidedShipped = closingCut((x) => uniformCut(x));
const splitShipped = closingCut((x) => quoteSplitting(x));
console.log(
	`  as shipped, with both columns quantized: one-sided ${oneSidedShipped.cr.toFixed(3)} ` +
		`against split ${(2 * splitShipped.cr).toFixed(3)} total`,
);
console.log(
	"  so the split form costs more of the player's margin for the same closure, and it " +
		"raises what the BUY column charges, which #191 D1 declined to do.",
);

console.log("\n§5.6 — direction, at matched mean cut");
console.log(
	// Built at the same width the rows are printed at, so the header cannot sit over
	// the wrong column when a name changes length.
	`  ${"arm"}`.padEnd(ARM_LABEL_COL) +
		"kit affordable     Cr/min   docks by TL 1-5/6-10/11-15   mean radius",
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
const armStats = (
	quote: QuoteFn,
	startPolicy: "first" | "developed" | "rim" = "first",
) => {
	// **One run per galaxy, not two.** `kitAffordableAtMinutes` is latched the first
	// time the balance crosses the kit, so the run that stops there records the same
	// minute as the one that keeps flying to measure a rate — and the duplicate was
	// forty extra sessions per report for a figure already in hand.
	const rateRuns = WORLDS.map(({ world }) =>
		run(world, hours, { quote, stopAtKit: false, startPolicy }),
	);
	// **One entry per galaxy, including the galaxies that never got there.** A
	// previous revision dropped the nulls and let the printer index by galaxy, so on
	// exactly the stalled rungs this table exists to show, every later galaxy's figure
	// moved one place left and the dash landed on the wrong session.
	const kits = rateRuns.map((r) => r.kitAffordableAtMinutes);
	const achieved = kits.filter((k): k is number => k !== null);
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
			achieved.length === WORLDS.length
				? `${Math.min(...achieved).toFixed(0)}-${Math.max(...achieved).toFixed(0)} min`
				: `${achieved.length}/${WORLDS.length} in cap`,
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

/** The columns every arm row prints, in the one place they are specified. */
const formatArmStats = (s: ArmStats): string =>
	s.kitLabel.padEnd(19) +
	s.rateLabel.padEnd(11) +
	s.bandLabel.padEnd(26) +
	s.radius.toFixed(3) +
	(s.stalled ? `   stalled ${s.stalled}/${WORLDS.length}` : "");

/**
 * One arm, named and flown from the same three dials.
 *
 * **The name is derived, not typed.** Every directional row in this report used to be
 * written as `routeRow("wide at high TL (shipped)", spreadArm(f, g, mirrored))`, where
 * those two arguments were independent — so flipping `mirrored` changed what the trader
 * experienced while leaving the row claiming the other law. Rounds 3, 4 and 5 each
 * caught a variant of that. Here the label comes out of the flag that builds the quote,
 * so the same flip *renames* the row: a mislabelled arm stops being a silent defect.
 *
 * The row also carries the cut it claims, so the guard below checks the quote the trader
 * will actually fly rather than a fresh arm built from the numbers the guard already has.
 */
const armFor = (floor: number, grade: number, mirrored: boolean) => ({
	name: `${mirrored ? OPPOSING_ARM : SHIPPED_ARM}${armRung(floor, grade)}`,
	quote: spreadArm(floor, grade, mirrored),
	cut: mirrored ? mirroredBidCut(floor, grade) : bidCutLadder(floor, grade),
});

type Arm = {
	name: string;
	quote: QuoteFn;
	cut?: (tl: number) => number;
	startPolicy?: "first" | "developed" | "rim";
};

/** The direction table's printer. With an `armFor` arm, its two claims are checked. */
const routeRow = (arm: Arm, labelWidth = ARM_LABEL_COL): ArmStats => {
	// **Checked on the object being flown.** Where the arm carries a cut, the quote's bid
	// has to land on it at every tech level; and every arm here is one-sided, which in
	// this repo's names means `buyCr` — what the station charges — stays at the mid.
	if (arm.cut) assertFlownArmCut(arm.name, arm.quote, arm.cut);
	for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++)
		if (Math.abs(arm.quote(100, tl).buyCr - 100) > 1e-9)
			throw new Error(
				`arm "${arm.name}" is not one-sided: it charges ${arm.quote(100, tl).buyCr.toFixed(2)} at TL ${tl}`,
			);
	const s = armStats(arm.quote, arm.startPolicy ?? "first");
	console.log(`  ${arm.name}`.padEnd(labelWidth) + formatArmStats(s));
	return s;
};
routeRow({ name: "no wedge (control)", quote: NO_WEDGE });
// The ladder runs to 0.30 rather than stopping at the shipped mean because the
// question this section answers is not only "which direction" but "at what level
// does the honest loop stop being an economy" — the number that decides whether a
// deeper floor is affordable. It is printed at the same matched-mean width as the
// rest, so the last rung is comparable to the rows above it and not a separate
// claim.
// **The ladder holds the start fixed, on purpose.** Sweeping `startPolicy` alongside
// every rung would give each row two moving dials at once, and this ladder's whole claim
// is a comparison across rungs — which is the comparison that took three review rounds to
// make honest. The start is swept where the start *is* the question, in §5.6's D4 section,
// and the band that sweep prints is quoted there as the reason the rate columns anywhere
// else in this file are read as agreement rather than as proof.
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
	// Both graded arms are guarded by `routeRow` on the quote they actually fly — the
	// cut it claims at every tech level, and the one-sided ask. A second check built
	// from the same dials would compare a formula to itself, so it is not here twice.

	routeRow({ name: `flat ${mean.toFixed(2)}`, quote: uniformCut(mean) });
	// **Named by arm, not by where they are thin.** These two bindings are the reason
	// this file has constants for the names: a previous revision bound the wide arm to
	// `const narrow` and the narrow arm to `const wide`, and the per-galaxy table below
	// printed each galaxy's shipped figure under the other arm's label. Nothing in the
	// type system notices, and the prose that read the table said the opposite of the
	// sweep.
	const shipped = routeRow(armFor(0, gradeAt(mean), false));
	const opposing = routeRow(armFor(0, gradeAt(mean), true));
	PAIRS.push([mean, shipped, opposing]);
	// Printed beside the rows it guards, because "matched mean" is an arithmetic
	// claim and arithmetic that is only asserted in a comment goes wrong.
	console.log(
		`      (mean cut of the graded table at this rung: ${gradedMeanCheck(mean)}, ` +
			`target ${mean.toFixed(2)})`,
	);
}
routeRow({ name: "shipped table", quote: marketQuote, cut: bidCutAtTl });
/** A session that never reached the kit is `null`, and the dash is the report's claim. */
const kit = (minutes: number | null): string =>
	minutes === null ? "—" : minutes.toFixed(0);

/**
 * One galaxy per column, the two arms' kit times paired.
 *
 * Written once because the same loop was being pasted a third time for the developed-start
 * rows, and a formatter copied per table is a figure that can be re-ordered in one table
 * without the others noticing.
 */
const kitPairLine = (prefix: string, left: ArmStats, right: ArmStats): string =>
	prefix +
	WORLDS.map(
		({ g }, i) => `${g} ${kit(left.kits[i])}/${kit(right.kits[i])}`,
	).join("   ");
console.log(
	`  per galaxy, ${SHIPPED_ARM} first, so four draws cannot be read as one range:`,
);
for (const [mean, shipped, opposing] of PAIRS) {
	console.log(
		kitPairLine(
			`      mean ${mean.toFixed(2)}  kit by galaxy (${SHIPPED_ARM} / ${OPPOSING_ARM})  `,
			shipped,
			opposing,
		),
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
 * **D4's question, at the level the game actually runs at.**
 *
 * The matched-mean sweep above cannot answer it. Its graded arms are built at floor 0
 * so that their multiset of cuts can equal a flat arm's, which leaves *both* of them
 * charging nothing at the rim — and 50-93% of the shipped arm's docks are at the rim.
 * #191 D4 asked what a commander who starts somewhere developed pays, and an arm with a
 * free rim has no developed market to pay it in. Reporting that sweep as a refutation of
 * D4's concern was answering a question the concern did not ask, and it took a review
 * round to notice.
 *
 * **These two arms have the same two dials.** Shipped: `BID_CUT_FLOOR` at the rim,
 * `+BID_CUT_GRADE` at the core. Mirrored: the same floor and grade with the ends
 * swapped. Same mean, same spread between the ends, same quote step, same trader, same
 * worlds — so the only difference is which end of the galaxy is dear, which is exactly
 * the axis D4 left open.
 */
console.log(
	"\n§5.6 — D4's question at the shipped dials: the law, and the same two constants mirrored",
);
{
	const arms: [string, QuoteFn][] = [
		[SHIPPED_ARM, marketQuote],
		["mirror of the shipped dials", MIRRORED_SHIPPED],
	];
	const stats = arms.map(([name, quote]) => routeRow({ name, quote }));
	console.log(
		"  same floor and grade, ends swapped, so the mean is identical by construction: " +
			`shipped pays ${(BID_CUT_FLOOR + BID_CUT_GRADE / 2).toFixed(3)} ` +
			`at TL ${(DISPLAY_TL_MIN + DISPLAY_TL_MAX) / 2} either way`,
	);
	console.log(
		kitPairLine(
			`  kit by galaxy (${arms.map(([name]) => name).join(" / ")})  `,
			stats[0],
			stats[1],
		),
	);
	// **The start is a variable, and #191 D4's concern was about it.** Every row above
	// drops the trader at the first multi-station system the generator lists, whatever its
	// tech level — so none of them flew "a commander who starts somewhere developed". Both
	// arms are flown again from the galaxy's **highest-tech** berth, identical in every
	// other respect, and then the *same* arm is flown from each of the three start rules so
	// the start's own contribution is visible as a spread rather than smuggled into the
	// arms as a constant.
	console.log(
		"  the same pair from a DEVELOPED start (highest-tech berth), which is the start " +
			"D4's concern was actually about:",
	);
	const devShipped = routeRow({
		name: `${SHIPPED_ARM}${DEVELOPED_SUFFIX}`,
		quote: marketQuote,
		startPolicy: "developed",
	});
	const devMirror = routeRow({
		name: `${OPPOSING_ARM}${DEVELOPED_SUFFIX}`,
		quote: MIRRORED_SHIPPED,
		startPolicy: "developed",
	});
	console.log(
		kitPairLine(
			`  kit by galaxy, developed start (${SHIPPED_ARM} / ${OPPOSING_ARM})  `,
			devShipped,
			devMirror,
		),
	);
	console.log(
		"  how much of any of this is the start rather than the law — the shipped arm alone, " +
			"from each start rule:",
	);
	for (const startPolicy of ["first", "developed", "rim"] as const)
		console.log(
			`      start ${startPolicy}`.padEnd(22) +
				formatArmStats(armStats(marketQuote, startPolicy)),
		);
	console.log(
		"  what a commander who starts somewhere developed pays for one hop: the core end " +
			`costs ${((BID_CUT_FLOOR + BID_CUT_GRADE) * 100).toFixed(1)}% of a sale under the shipped law, ` +
			`${(BID_CUT_FLOOR * 100).toFixed(1)}% under the mirror; the rim end is the other way round.`,
	);
	console.log(
		"  D4's concern was the core end, and that much of the answer is in the constants, " +
			"not in the sweep: shipping this direction charges a developed start the wider cut.",
	);
}

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
			// The same printer the direction table uses. This tail was a second copy of
			// those columns, which is how two tables that are supposed to be comparable
			// quietly stop lining up: a column change had to be made in both.
			formatArmStats(g),
	);
}
console.log(
	"  the shipped rung is 0.15. Every row here trades at the same rim end, so what " +
		"moves down the column is only how much a core market takes off a seller.",
);
