/**
 * What a hull is worth, and where the ladder's rungs and its top go — #182,
 * executing #26's D4, D6 and D7.
 *
 *   bun run scripts/measure-hull-pricing.ts [hours]
 *
 * #26 deferred three figures on purpose rather than inventing them: the hull
 * prices, the hold multiplier, and the ceiling. All three are a measurement,
 * and D4 and D7 rule that the rung *count* and the top of the ladder come out
 * of the measured curve rather than being chosen and then justified.
 *
 * ## The trap this file is built around
 *
 * A hold sweep compares arms by construction, and that is exactly where #25's
 * economy measurement went wrong four times: the clock, the option set or the
 * price table differed between the two arms, and every difference flattered the
 * arm the claim was about. The measured tail went 1.326x -> 1.785x -> 4.679x as
 * the riggings came out, and **every correction moved the answer in the same
 * direction** — which is the tell.
 *
 * So the check is not *is the arithmetic right* but **could the losing side
 * have been given what the winning side had**, and it is answered here
 * mechanically rather than argued:
 *
 * - **One engine.** `scripts/lib/greedy-trader.ts` is the trader; this file
 *   only calls it. There is no second loop that could be built differently, and
 *   `RunOptions` is the complete list of what a sweep may vary. Everything not
 *   in it — the galaxy, the generator, the starting port, the clock model, the
 *   neighbour limit, the option builders — is the same code with the same
 *   inputs in every arm.
 * - **One clock.** Every arm flies the same `hours` of game time
 *   (`stopAtKit: false`). A run that stops at its own milestone flies a
 *   different window, over a different stretch of the galaxy, at different
 *   epochs — so the arms would see different price tables, which is #25's
 *   fault three arrived at from a new direction.
 * - **One hold for the whole window** (`shop: false`). With shopping on the
 *   Large Cargo Bay's +15 t is a 75% boost to a 20 t hold and 25% to a 60 t
 *   one, so the swept variable would be the hold plus a hold-dependent increment;
 *   and the shopping list runs out sooner at a large hold, ending the run
 *   early and shortening that arm's window.
 * - **One corpus.** Every hold is flown over every world, and the fit below is
 *   taken **per world and then pooled**, so the world's own richness cancels
 *   instead of being sampled independently for each arm.
 * - **Both arms of the response** — the shipped one and the one it replaced —
 *   run through the same `runsToExhaustion` and the same `surveyResiduals`,
 *   which take the response as a parameter for this reason.
 *
 * **Two of this file's own corrections moved the answer the same way**, which is
 * #25's tell and is reported in section I rather than argued away: turning the
 * shopping pass off and turning the market's memory off both *steepened* the
 * curve. So the next correction in that direction is measured too — a capital
 * cap, the one remaining known bias that flatters a large hold — and the
 * exponent this file ships is stated as the upper end of what the sweep can
 * support rather than as its centre.
 *
 * ## The defect the sweep found, and did not fix
 *
 * The price curve is measured against a market with **no memory**
 * (`remembers: false`). That is not a simplification: measured with memory on,
 * a *stronger* deficit response makes the greedy trader earn *more*, which
 * inverts everything §5.4 says the deficit is for. The cause is a round trip
 * through one station — a sale is priced at the pre-trade mark and the buy-back
 * at the post-trade one, with no slippage inside a transaction (§10.1, ratified
 * by #7) — so selling a hold and buying it straight back nets
 * `PRICE_ELASTICITY` of the cargo's value, repeatably. It is a defect of the
 * shipped rules rather than of this sim; `transactAtStation` does it too, on
 * `main` as here. #182 does not fix it, because pricing the marginal unit
 * reverses #7's ruling and moves every figure §5.4 was ratified on. What it
 * does is refuse to price a hull through it, and measure what it is worth.
 */

import {
	CAPITAL_HULL_IDS,
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
	hullPriceCr,
	HULL_PRICE_EXPONENT,
	HULL_PRICE_BASELINE_CR,
	HULL_CEILING_HOLD_T,
} from "../src/hull";
import {
	HOLD_REFERENCE_T,
	PRICE_ELASTICITY,
	fullKitCr,
	stockResponse,
} from "../src/market";
import { BERTH_CELL } from "../src/station-interior";
import { derivedCeiling, m3PerTonneOfHold } from "../tests/helpers/hull-math";
import {
	CLOSABLE_RATIO,
	fixedReferenceResponse,
	richestClosablePair,
	runsToExhaustion,
	RUN_MINUTES,
	saturatedDeficitT,
	type StockResponse,
	surveyResiduals,
} from "../tests/helpers/market-math";
import { GALAXY_COUNT } from "../src/galaxy";
import {
	DOCK_SECONDS,
	JUMP_SECONDS,
	type Result,
	type RunOptions,
	finite,
	DEFAULT_NEIGHBOUR_LIMIT,
	run,
	worldFor,
} from "./lib/greedy-trader";

const hours = Number(process.argv[2] ?? 2);
if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours must be > 0");

/**
 * Four world seeds, eight galaxies each.
 *
 * **Thirty-two and not four**, which is #28's rule applied to a sweep rather
 * than to a distribution: the bucket the claim rests on here is one *hold*, and
 * a hold's rate varies from world to world by more than the step between two
 * adjacent rungs. Four worlds cannot separate two rungs; the spread at each
 * hold is printed so a reader can see how far it goes.
 */
const WORLD_SEEDS = [0x5ee11e, 0x1e11ee, 0xc0ffee, 0x5eed01];
/** **All eight galaxies, not `GALAXY_LIST`'s four.** That list is §5.5's, sized
 *  for a claim about a *rate* of winning waits; the bucket a rung rests on here
 *  is one hold, whose Cr/min varies from world to world by more than the step
 *  between two adjacent rungs. #28's rule is that a corpus is sized by the
 *  bucket the claim rests on. */
const ALL_GALAXIES = Array.from({ length: GALAXY_COUNT }, (_, i) => i);
const WORLDS = WORLD_SEEDS.flatMap((seed) =>
	ALL_GALAXIES.map((g) => worldFor(seed, g)),
);

/** The ladder the curve is measured on: every purchasable hull's own hold,
 *  plus the rungs between and above them out to the geometric ceiling. */
const HOLD_LADDER = [
	4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 60, 80, 100, 120, 160, 200,
];

/** Section I's arm: what one hop may spend on cargo. The top of the sweep is
 *  `fullKitCr()` because that is the capital a player has before any hull in
 *  section F is affordable. */
const CAPITAL_CAPS: readonly number[] = [
	500,
	1_000,
	2_000,
	5_000,
	fullKitCr(),
	Number.POSITIVE_INFINITY,
];

const quantile = (xs: readonly number[], q: number): number => {
	if (xs.length === 0) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
/** A real median, averaged across the middle pair on an even count. `quantile`
 *  returns the upper-middle sample, which is fine for a p10/p90 and wrong for a
 *  figure the baseline price is derived from. */
const median = (xs: readonly number[]): number => {
	if (xs.length === 0) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	const n = s.length;
	return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const mean = (xs: readonly number[]): number =>
	xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

const rightAlign = (v: string | number, n: number) => String(v).padStart(n);

console.log(
	`hull pricing — ${WORLDS.length} worlds (${WORLD_SEEDS.length} seeds x ` +
		`${ALL_GALAXIES.length} galaxies), ${hours} h per arm, neighbour limit ` +
		`${DEFAULT_NEIGHBOUR_LIMIT}, jump ${JUMP_SECONDS}s, dock ${DOCK_SECONDS}s`,
);

// ---------------------------------------------------------------------------
// A. The clamp bite: why the response had to change at all
// ---------------------------------------------------------------------------

console.log(
	"\n== A. one run's price move, shipped response against the one it replaced ==",
);
console.log(
	"  A per-hull scaling on a bounded index gets clamped away where that type",
	"\n  lives (the map's #13). `DEFICIT_MAX` is 63 *tonnes*, so under the old",
	"\n  expression a 63 t hull and a 200 t hull leave an identical mark.",
);
console.log("\n  hold t   shipped   pre-#182   clamped away");
for (const holdT of [8, 20, 40, 60, 63, 80, 120, 200]) {
	const shipped = finite("shipped", stockResponse(100, holdT, holdT) / 100 - 1);
	const before = finite(
		"pre-#182",
		fixedReferenceResponse(100, holdT, holdT) / 100 - 1,
	);
	// How much of one run's mark the old ±63 t clamp discarded.
	const lost = Math.max(0, holdT - 63) / holdT;
	console.log(
		`${rightAlign(holdT, 8)}${rightAlign(`${(100 * shipped).toFixed(1)}%`, 10)}` +
			`${rightAlign(`${(100 * before).toFixed(1)}%`, 11)}${rightAlign(`${(100 * lost).toFixed(0)}%`, 15)}`,
	);
}

// ---------------------------------------------------------------------------
// B. #26's D6: what the multiplier does to §5.4's brake
// ---------------------------------------------------------------------------

console.log("\n== B. #26's D6: the hold multiplier, swept against §5.4 ==");
console.log(
	"  Both arms are the same search over the same pairs and the same byte set;",
	"\n  they differ in the response function and in nothing else.",
);
console.log(
	"\n  arm         hold   sat.factor   closable   runs   farm take   residual/run",
);
const ARMS: { label: string; response: StockResponse }[] = [
	{ label: "shipped", response: stockResponse },
	{ label: "pre-#182", response: fixedReferenceResponse },
];
const D6_HOLDS = [20, 60, 200];
for (const arm of ARMS)
	for (const holdT of D6_HOLDS) {
		const sat = finite(
			"sat",
			arm.response(100, -saturatedDeficitT(holdT), holdT) / 100,
		);
		// The ratio the deficit can drive to zero, on this arm's own saturation.
		const up = finite(
			"up",
			arm.response(100, saturatedDeficitT(holdT), holdT) / 100,
		);
		const closable = up / sat;
		const pair = richestClosablePair(holdT, arm.response);
		const ex = runsToExhaustion({
			buyBaseCr: pair.buyCr,
			sellBaseCr: pair.sellCr,
			holdT,
			response: arm.response,
			maxRuns: 20,
		});
		const survey = surveyResiduals(holdT, arm.response);
		console.log(
			`  ${arm.label.padEnd(10)}${rightAlign(holdT, 5)}` +
				`${rightAlign(sat.toFixed(3), 13)}${rightAlign(closable.toFixed(3), 11)}` +
				`${rightAlign(ex.runs, 7)}${rightAlign(`${finite("take", ex.profitCr).toFixed(0)} Cr`, 12)}` +
				`${rightAlign(`${finite("residual", survey.worst.runCr).toFixed(0)} Cr`, 15)}`,
		);
	}
console.log(
	"\n  The steady state does not move: the saturated factor, the closable ratio",
	"\n  and the residual *per tonne* are the same on both arms at every hold,",
	"\n  because the cap and the reference scale together. What moves is the",
	"\n  transient — how many runs the brake takes to bite — and the pre-#182 arm",
	"\n  loses the distinction between hulls entirely above 63 t.",
);

// ---------------------------------------------------------------------------
// C. The hold curve
// ---------------------------------------------------------------------------

/**
 * One arm of the sweep: every world flown at one hold, same options.
 *
 * **It opens with a hull buyer's own capital, not §6's 100 Cr.** From 100 the
 * first minutes of any window earn almost nothing — §6's capital-limited
 * opening — and that dead time is amortised over the window, so `earnedCr /
 * minutes` climbs with `hours`: measured over these worlds the 20 t rate went
 * 474 -> 613 -> 690 -> 736 Cr/min at 1, 2, 4 and 8 h, and a price derived from
 * it would move 23,099 -> 35,840 Cr with an instrument parameter that means
 * nothing in the game. Opening at `fullKitCr()` removes the transient instead
 * of averaging over it, and section I sweeps what is left.
 *
 * The *exponent* barely noticed either way — 0.621 / 0.613 / 0.605 / 0.609
 * across the same four windows — which is why the ladder's shape survived the
 * correction and its level did not.
 */
let flightsFlown = 0;
const armAt = (holdT: number, opts: RunOptions = {}): Result[] =>
	WORLDS.map((world) => {
		flightsFlown++;
		return run(world, hours, {
			holdT,
			stopAtKit: false,
			shop: false,
			remembers: false,
			startCr: fullKitCr(),
			...opts,
		});
	});

const rateOf = (r: Result) => finite("Cr/min", r.earnedCr / r.minutes);

/** Section C's stored arm, and a throw rather than `mean([])` if a caller asks
 *  for a hold the ladder does not carry — `finite`'s rule applied to a lookup:
 *  an instrument that quietly averages nothing is worse than one that dies. */
const curveAt = (holdT: number): number[] => {
	const rates = curve.get(holdT);
	if (!rates) throw new Error(`no arm was flown at ${holdT} t`);
	return rates;
};

console.log(
	`\n== C. the hold curve: Cr/min against hold, ${WORLDS.length} worlds, no market memory ==`,
);
console.log("\n  hold t     mean      p10      p90    t lifted/hop    fill");
const curve = new Map<number, number[]>();
/** Arms that ended before the window did — a stance with no profitable hop at
 *  all breaks the loop, which `RunOptions.shop` cannot suppress. A short arm
 *  has a shorter denominator, so the count is reported rather than left to be
 *  assumed away. */
let shortArms = 0;
for (const holdT of HOLD_LADDER) {
	const arm = armAt(holdT);
	shortArms += arm.filter((r) => r.minutes < hours * 60 - 1).length;
	const rates = arm.map(rateOf);
	curve.set(holdT, rates);
	const lifted =
		arm.reduce((a, r) => a + r.tonnesLifted, 0) /
		Math.max(
			arm.reduce((a, r) => a + r.ladenHops, 0),
			1,
		);
	console.log(
		`${rightAlign(holdT, 6)}${rightAlign(mean(rates).toFixed(0), 9)}` +
			`${rightAlign(quantile(rates, 0.1).toFixed(0), 9)}${rightAlign(quantile(rates, 0.9).toFixed(0), 9)}` +
			`${rightAlign(finite("lifted", lifted).toFixed(1), 15)}${rightAlign(`${((100 * lifted) / holdT).toFixed(0)}%`, 8)}`,
	);
}

/**
 * Least squares on `log(rate) = log A + b log(hold)`, over one world.
 *
 * **Per world and then pooled**, which is the paired design: a world's own
 * richness is a common factor on every hold it is flown at, so it cancels out
 * of the slope instead of adding variance to it. Pooling the raw rates first
 * and fitting once would mix the two.
 */
function fitPower(points: { h: number; r: number }[]): {
	a: number;
	b: number;
	/** The slope's own standard error. Printed because it is what the third
	 *  digit of the shipped exponent rests on — the world-to-world spread is far
	 *  wider and is a different quantity, and quoting the wide one as the reason
	 *  for three places was a non sequitur a draft of §7.1 carried. */
	se: number;
} {
	const n = points.length;
	const x = points.map((p) => Math.log(p.h));
	const y = points.map((p) => Math.log(p.r));
	const sx = x.reduce((a, c) => a + c, 0);
	const sy = y.reduce((a, c) => a + c, 0);
	const sxx = x.reduce((a, c) => a + c * c, 0);
	const sxy = x.reduce((a, c, i) => a + c * y[i], 0);
	const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
	const a = Math.exp((sy - b * sx) / n);
	const rss = y.reduce(
		(sum, c, i) => sum + (Math.log(a) + b * x[i] - c) ** 2,
		0,
	);
	const sxxCentred = sxx - (sx * sx) / n;
	return { a, b, se: Math.sqrt(rss / (n - 2) / sxxCentred) };
}

const perWorld = WORLDS.map((_, wi) =>
	fitPower(HOLD_LADDER.map((h) => ({ h, r: curveAt(h)[wi] }))),
);
const pooled = fitPower(HOLD_LADDER.map((h) => ({ h, r: mean(curveAt(h)) })));
const betas = perWorld.map((f) => f.b);
console.log(
	`\n  arms that ended before the ${hours} h window: ${shortArms} of ` +
		`${HOLD_LADDER.length * WORLDS.length} — the one terminal state left when` +
		"\n  shopping is off is a stance with no profitable hop at all, and a short" +
		"\n  arm divides by a shorter clock.",
);
console.log(
	`\n  fitted rate = A x hold^b over ${HOLD_LADDER[0]}-${HOLD_LADDER[HOLD_LADDER.length - 1]} t`,
);
console.log(
	`    pooled on the mean curve: A ${finite("A", pooled.a).toFixed(2)}, ` +
		`b ${finite("b", pooled.b).toFixed(3)} ± ${finite("se", pooled.se).toFixed(3)} (the slope's own standard error)`,
);
console.log(
	`    per world (n=${WORLDS.length}): b median ${median(betas).toFixed(3)}, ` +
		`p10 ${quantile(betas, 0.1).toFixed(3)}, p90 ${quantile(betas, 0.9).toFixed(3)}`,
);
{
	const resid = HOLD_LADDER.map((h) => {
		const obs = mean(curveAt(h));
		return Math.abs(pooled.a * h ** pooled.b - obs) / obs;
	});
	console.log(
		`    fit residual against the mean curve: median ${(100 * quantile(resid, 0.5)).toFixed(1)}%, ` +
			`worst ${(100 * Math.max(...resid)).toFixed(1)}% (at ${HOLD_LADDER[resid.indexOf(Math.max(...resid))]} t)`,
	);
	console.log(
		"    **b is well under 1, and that is the finding #26's D6 assumed away**:",
		"\n    tripling the hold does not triple the income, because the marginal",
		"\n    tonne has to be filled with a worse good than the one before it.",
	);
}

// ---------------------------------------------------------------------------
// D. What the market's memory is worth to a greedy trader
// ---------------------------------------------------------------------------

console.log("\n== D. the same sweep with §5.2's memory on ==");
console.log(
	"  A brake should cost a trader money. It pays instead, and the payment grows",
	"\n  with the strength of the response — which is the round-trip pump the",
	"\n  module docstring names. Reported rather than fixed: the fix reverses #7.",
);
console.log("\n  hold t   no memory   remembering   memory is worth");
for (const holdT of [8, 20, 60, 200]) {
	// Section C already flew this arm; re-flying it would be 32 identical
	// two-hour runs per row for a figure already in hand.
	const off = mean(curveAt(holdT));
	const on = mean(armAt(holdT, { remembers: true }).map(rateOf));
	console.log(
		`${rightAlign(holdT, 6)}${rightAlign(off.toFixed(0), 12)}${rightAlign(on.toFixed(0), 14)}` +
			`${rightAlign(`${(on / off).toFixed(2)}x`, 18)}`,
	);
}
{
	// The pump, isolated: sell a hold and buy it straight back at one station.
	const gain =
		1 - stockResponse(100, -HOLD_REFERENCE_T, HOLD_REFERENCE_T) / 100;
	console.log(
		`\n  the round trip itself: sell a full hold, buy it back — ${(100 * gain).toFixed(1)}% ` +
			`of the cargo's value, per cycle, unbounded (PRICE_ELASTICITY is ${PRICE_ELASTICITY}).`,
	);
}

// ---------------------------------------------------------------------------
// E. The payback window
// ---------------------------------------------------------------------------

console.log(
	"\n== E. the payback window: the economy's own progression unit ==",
);
const kitWindow = (() => {
	// **This arm keeps §6's 100 Cr opening, and that is not the curve's clock
	// twice.** The window is a *unit of time* — how long the economy takes to
	// yield one kit at its own opening pace — and it is measured from the
	// opening because that is what the unit means. The curve is a *rate*, and a
	// rate taken across the opening measures the opening. Two different
	// quantities, each measured on the arm it is about.
	const arm = WORLDS.map((world) =>
		run(world, Math.max(hours, 4), {
			holdT: HOLD_REFERENCE_T,
			stopAtKit: true,
			shop: false,
			remembers: false,
		}),
	);
	const kits = arm
		.map((r) => r.kitAffordableAtMinutes)
		.filter((k): k is number => k !== null);
	return {
		n: kits.length,
		of: arm.length,
		median: median(kits),
		lo: Math.min(...kits),
		hi: Math.max(...kits),
	};
})();
console.log(
	`  time for the baseline hull to earn fullKitCr() = ${fullKitCr()} Cr, ` +
		`from §6's 100 Cr opening:\n    ${kitWindow.n}/${kitWindow.of} worlds, ` +
		`median ${finite("kit", kitWindow.median).toFixed(1)} min, ` +
		`${kitWindow.lo.toFixed(1)}-${kitWindow.hi.toFixed(1)}`,
);
console.log(
	"  #26 gives the kit and the ceiling as the two anchors a hull price has to",
	"\n  sit against — under that scale it is bought before the player has flown,",
	"\n  far over it and it is scenery.",
	"\n",
	"\n  **This arm opens at 100 Cr and section C's does not, and that is not the",
	"\n  clock counted twice.** The window is a *unit of time* — how long the",
	"\n  economy takes to yield one kit at its own opening pace — so it is measured",
	"\n  from the opening, because that is what the unit means. The curve is a",
	"\n  *rate*, and a rate averaged across the opening measures the opening: it",
	"\n  climbs with the window and would carry an instrument parameter into every",
	"\n  price. Two different quantities, each measured on the arm it is about.",
);

// ---------------------------------------------------------------------------
// F. The prices
// ---------------------------------------------------------------------------

console.log("\n== F. the seven civilian hulls, priced ==");
console.log(
	`  price(hold) = ${HULL_PRICE_BASELINE_CR} Cr x (hold / ${HOLD_REFERENCE_T})^${HULL_PRICE_EXPONENT}, ` +
		"rounded — `hullPriceCr` in `src/hull.ts`.",
);
console.log(
	`  The baseline is the measured rate at ${HOLD_REFERENCE_T} t times the window above;`,
	"\n  the exponent is the fitted b. What is being capitalised is the *hold*, and",
	"\n  the trading economy prices nothing else — **which is a concession rather",
	"\n  than a measurement**. A trader that fears no pirate and does not route was",
	"\n  never handed a hardpoint, a point of integrity or a light year of tank to",
	"\n  vary, so the sweep measured the hold and conceded the rest. #8 and #183",
	"\n  own those axes and this node invents no figure for them.",
);
{
	// **The #118 loop, closed.** A figure a spec states as measured owes a mode
	// in a shipped instrument that reprints it — so this run re-derives the two
	// declared constants and says how far it has drifted from them.
	// **The baseline is derived at the *shipped* exponent, not the fitted one.**
	// The law carries two decimals because that is what the fit resolves, so a
	// baseline computed at the raw slope would be compared against a constant
	// nobody derived that way and the printed drift would be meaningless.
	const derivedBaseline =
		pooled.a * HOLD_REFERENCE_T ** HULL_PRICE_EXPONENT * kitWindow.median;
	console.log(
		`\n  declared: exponent ${HULL_PRICE_EXPONENT}, baseline ${HULL_PRICE_BASELINE_CR} Cr`,
	);
	console.log(
		`  this run's fit: slope ${finite("b", pooled.b).toFixed(3)} ± ` +
			`${finite("se", pooled.se).toFixed(3)} — the standard error is over a` +
			`\n  hundredth, so it settles neither the third digit nor the second, and the` +
			`\n  declared ${HULL_PRICE_EXPONENT} is the mean-curve fit rounded rather than a resolved` +
			"\n  figure. What that uncertainty costs the ladder:",
	);
	for (const holdT of [8, HOLD_REFERENCE_T, 60, HULL_CEILING_HOLD_T]) {
		const at = (b: number) =>
			Math.round(
				(HULL_PRICE_BASELINE_CR * (holdT / HOLD_REFERENCE_T) ** b) / 100,
			) * 100;
		const mid = at(HULL_PRICE_EXPONENT);
		const lo = at(HULL_PRICE_EXPONENT - pooled.se);
		const hi = at(HULL_PRICE_EXPONENT + pooled.se);
		console.log(
			`    ${rightAlign(holdT, 5)} t: ${rightAlign(mid.toLocaleString("en-GB"), 8)} Cr, ` +
				`±1σ ${Math.min(lo, hi).toLocaleString("en-GB")}-${Math.max(lo, hi).toLocaleString("en-GB")} ` +
				// The magnitude, because a larger exponent *lowers* every price below
				// the anchor and a signed spread there reads as a shrinking band.
				`(${(100 * Math.max(Math.abs(hi / mid - 1), Math.abs(lo / mid - 1))).toFixed(1)}%)`,
		);
	}
	console.log();
	console.log(
		`  this run derives the baseline at the declared exponent: ` +
			`${finite("baseline", derivedBaseline).toFixed(0)} Cr ` +
			`(${(100 * (derivedBaseline / HULL_PRICE_BASELINE_CR - 1)).toFixed(1)}% off the declared, ` +
			"which is a price rounded to a legible figure)",
	);
}
console.log("\n  hull          hold   measured Cr/min   price      vs kit");
const sortedByHold = [...PURCHASABLE_HULL_IDS].sort(
	(a, b) => HULL_SPECS[a].holdT - HULL_SPECS[b].holdT,
);
for (const id of sortedByHold) {
	const holdT = HULL_SPECS[id].holdT;
	const observed = curve.has(holdT)
		? mean(curveAt(holdT))
		: mean(armAt(holdT).map(rateOf));
	const price = hullPriceCr(holdT);
	console.log(
		`  ${id.padEnd(13)}${rightAlign(holdT, 4)}${rightAlign(observed.toFixed(0), 18)}` +
			`${rightAlign(`${finite("price", price as number).toLocaleString("en-GB")} Cr`, 11)}` +
			`${rightAlign(`${((price as number) / fullKitCr()).toFixed(2)}x`, 12)}`,
	);
}

// ---------------------------------------------------------------------------
// G. The ceiling
// ---------------------------------------------------------------------------

console.log("\n== G. the ceiling ==");
console.log(
	"  #26's D7 sets it where the curve stops being interesting. **Measured, the",
	"\n  curve never does**: section C is a power law with no knee anywhere in the",
	"\n  ladder, and the fill column shows the shelves still filling the hold at",
	"\n  the top of it. So the ceiling is not the economy's, and saying which one",
	"\n  it is instead is the answer rather than a substitute for one.",
);
{
	// **Through `derivedCeiling`, which is the gate's own derivation.** Section G
	// used to repeat the max-over-types and min-over-hulls steps, so a retune
	// that changed which berth is largest had two places to agree in — and it
	// printed a rounded quotient beside a floored constant, which reads as drift
	// the gate cannot see.
	const { largestType, boxM3, densestHull, m3PerT, holdT } = derivedCeiling();
	const cell = BERTH_CELL[largestType];
	console.log(
		`\n  largest berth cell (${largestType}, and every type is checked): ` +
			`${(1000 * cell.lengthKm).toFixed(0)} x ${(1000 * cell.beamKm).toFixed(0)} x ` +
			`${(1000 * cell.heightKm).toFixed(0)} m = ${finite("box", boxM3).toFixed(0)} m3`,
	);
	console.log("\n  hull          m3 of box per tonne of hold");
	for (const id of [...PURCHASABLE_HULL_IDS].sort(
		(a, b) => m3PerTonneOfHold(HULL_SPECS[a]) - m3PerTonneOfHold(HULL_SPECS[b]),
	))
		console.log(
			`  ${id.padEnd(13)}${rightAlign(finite(id, m3PerTonneOfHold(HULL_SPECS[id])).toFixed(0), 8)}`,
		);
	console.log(
		`\n  the cargo role is the densest at ${m3PerT.toFixed(0)} m3/t (${densestHull}), so the largest`,
		`\n  hold a berth can admit is ${finite("ceiling", holdT)} t — ` +
			`declared as HULL_CEILING_HOLD_T = ${HULL_CEILING_HOLD_T} t,`,
		`\n  priced at ${(hullPriceCr(HULL_CEILING_HOLD_T) as number).toLocaleString("en-GB")} Cr.`,
	);
	console.log(
		"\n  It is an upper bound in the safe direction: it assumes a hull can be a",
		"\n  solid box at the best hold density the roster has measured, and #26's",
		"\n  own constraint says beam and height are nearly spent so growth is in",
		"\n  length. Nothing may put a rung above it, because nothing above it docks.",
	);
}

// ---------------------------------------------------------------------------
// H. The rungs — a count, not a choice
// ---------------------------------------------------------------------------

console.log("\n== H. where the rungs go ==");
{
	const prices = sortedByHold.map(
		(id) => hullPriceCr(HULL_SPECS[id].holdT) as number,
	);
	const steps = prices.slice(1).map((p, i) => p / prices[i]);
	const typical = median(steps);
	const widest = Math.max(...steps);
	console.log(
		`  the roster's own price steps: ${steps.map((x) => x.toFixed(2)).join(", ")}`,
	);
	console.log(
		`  typical (median) ${typical.toFixed(2)}x, widest ${widest.toFixed(2)}x`,
	);
	// **The criterion is the median squared, and it is not the maximum.** An
	// earlier version asked whether any step exceeded the widest step, which no
	// step can and which therefore reported "no interior gap" on any roster
	// whatever — a check derived from its own subject. A gap is an interval with
	// room for a rung *at the ladder's own spacing*, so the threshold is one
	// typical step squared, and an interior step can exceed it.
	const gapThreshold = typical * typical;
	const interior = steps.filter((x) => x > gapThreshold + 1e-9).length;
	console.log(
		`\n  a gap is a step wider than one typical step squared, ` +
			`${gapThreshold.toFixed(2)}x — room for a rung at the ladder's own`,
		"\n  spacing. It is not the maximum of the steps, which nothing could exceed.",
	);
	const top = prices[prices.length - 1];
	const topHoldT = HULL_SPECS[sortedByHold[sortedByHold.length - 1]].holdT;
	const ceiling = hullPriceCr(HULL_CEILING_HOLD_T) as number;
	const gap = ceiling / top;
	// The *count* is bounded by the roster's widest existing step rather than by
	// its typical one, which is the weaker and safer claim: it is the smallest
	// number of rungs that leaves the ladder no coarser anywhere than it already
	// is. At the typical step it would be one more.
	const rungs = Math.ceil(Math.log(gap) / Math.log(widest));
	const atTypical = Math.ceil(Math.log(gap) / Math.log(typical));
	console.log(
		`\n  interior gaps: ${interior} of ${steps.length} — the priced roster has ` +
			`${interior === 0 ? "none" : `${interior}`}.`,
	);
	console.log(
		`  the one gap is above it: ${top.toLocaleString("en-GB")} Cr to the ceiling's ` +
			`${ceiling.toLocaleString("en-GB")} Cr is ${gap.toFixed(2)}x,`,
	);
	console.log(
		`  which holds ${rungs} steps of at most ${widest.toFixed(2)}x — so **${rungs} new rungs**, ` +
			`the top one being the ceiling hull itself (${atTypical} at the typical step):`,
	);
	// Holds spaced evenly in the log between the roster's top and the ceiling,
	// and each rung's price read back off the same law section F prices the
	// roster with — not a second interpolation that could disagree with it.
	const holdStep = (HULL_CEILING_HOLD_T / topHoldT) ** (1 / rungs);
	for (let k = 1; k <= rungs; k++) {
		const holdT = Math.min(
			HULL_CEILING_HOLD_T,
			Math.round(topHoldT * holdStep ** k),
		);
		console.log(
			`    rung ${k}: hold ${rightAlign(holdT, 3)} t, ` +
				`${rightAlign((hullPriceCr(holdT) as number).toLocaleString("en-GB"), 8)} Cr` +
				(k === rungs ? "  (the ceiling)" : ""),
		);
	}
	console.log(
		"\n  The count is an output of the two measured endpoints and the roster's",
		"\n  own widest step. Nothing here chose it, and a retune of the curve or of",
		"\n  the berth cell moves it without anybody editing a number.",
	);
}

// ---------------------------------------------------------------------------
// I. Where this measurement is still biased, and which way
// ---------------------------------------------------------------------------

console.log("\n== I. the remaining bias, measured rather than conceded ==");
console.log(
	"  #25's tell is that every correction moves the answer the same way. Two of",
	"\n  this sweep's did: turning the shopping pass off and turning the market's",
	"\n  memory off both steepened the curve. So the next known bias in that",
	"\n  direction gets measured rather than argued away.",
);
console.log(
	"\n  With no shopping the wallet compounds without limit, so a large hold is",
	"\n  never capital-limited late in the window while a player always is —",
	"\n  exactly the shape that flatters the arm the exponent is about. Swept over",
	"\n  what one hop may spend on cargo:",
);
console.log("\n  working capital     b   rate at 20 t   rate at 200 t");
for (const cap of CAPITAL_CAPS) {
	const points = HOLD_LADDER.map((h) => ({
		h,
		// The uncapped row *is* section C's arm — same options, same worlds — so
		// it is read back rather than re-flown, which is 512 two-hour runs saved
		// on a figure that would be identical by construction.
		r: Number.isFinite(cap)
			? mean(armAt(h, { capitalCapCr: cap }).map(rateOf))
			: mean(curveAt(h)),
	}));
	const f = fitPower(points);
	const at = (h: number) => (points.find((p) => p.h === h) as { r: number }).r;
	console.log(
		`${rightAlign(Number.isFinite(cap) ? `${cap.toLocaleString("en-GB")} Cr` : "uncapped", 17)}` +
			`${rightAlign(finite("b", f.b).toFixed(3), 6)}${rightAlign(at(20).toFixed(0), 15)}${rightAlign(at(200).toFixed(0), 16)}`,
	);
}
console.log(
	`\n  **The bias is real and it is exhausted before a hull is affordable.** Below`,
	`\n  a few thousand credits the exponent collapses — a hold you cannot fill is`,
	`\n  worth nothing, which is §6's capital-limited opening said in a second way —`,
	`\n  and it has stopped moving by ${fullKitCr().toLocaleString("en-GB")} Cr, where it equals the uncapped`,
	`\n  arm to three decimals. That is the kit's own total, and the cheapest hull`,
	`\n  in section F costs more than it: a player who can buy a hull at all is`,
	`\n  already past the range where this bias bites, so the third correction moved`,
	"\n  the answer by nothing and the run of same-direction corrections is broken",
	"\n  by a measurement rather than by a claim.",
);
console.log(
	"\n  One known bias is left and it is #7's ruling rather than this file's: a hop",
	"\n  buys its whole basket at one price, with no slippage inside a transaction",
	"\n  (§10.1), which flatters a hold big enough to move the marginal unit. It",
	"\n  runs the same way as the two above, so the exponent here is the upper end",
	"\n  of what the sweep supports. **That is not the same as every price being an",
	"\n  upper bound**, and a draft of this line said it was: the law is a ratio",
	`\n  against the ${HOLD_REFERENCE_T} t baseline, so a larger exponent *lowers* every price under`,
	"\n  it. Above the baseline these prices are upper bounds; below it they are",
	"\n  lower ones, and the baseline itself is fixed by the anchor rather than b.",
);

console.log("\n== what is gated and what is not ==");
console.log(
	"  `npm test` gates: the response's hold-invariance and its ratchet, every",
	"\n  row against `hullPriceCr`, the exponent and baseline being the figures",
	"\n  quoted here, the ceiling against the berth cell and the roster's own",
	"\n  densities, and that no priced hull sits above the ceiling.",
);
console.log(
	`  run by hand, this file: the ${WORLDS.length}-world curve, its fit, the payback`,
	"\n  window, the memory arm, the capital sweep, and the rung count derived from",
	`\n  them — ${flightsFlown} flights of ${hours} h each, counted rather than`,
	"\n  computed from a formula: a draft's formula charged the sweep for the arms",
	"\n  it reads back instead of re-flying. Not a suite's work, and #28's",
	"\n  rule is that the split be said out loud rather than left to be discovered.",
);
console.log(
	`\n  hulls priced: ${PURCHASABLE_HULL_IDS.length} of ${HULL_IDS.length}. ` +
		`Not priced: ${CAPITAL_HULL_IDS.join(", ")} — past the ceiling and`,
	"\n  outside the measured domain, so `priceCr` is null rather than an",
	"\n  extrapolation wearing a measurement's clothes (#118).",
);
{
	const gated: HullId[] = HULL_IDS.filter(
		(id) =>
			!(PURCHASABLE_HULL_IDS as readonly HullId[]).includes(id) &&
			!(CAPITAL_HULL_IDS as readonly HullId[]).includes(id),
	);
	console.log(
		`  priced but not sold: ${gated.join(", ")} — inside the measured domain, so` +
			"\n  the law answers for them; whether a shipyard lists them is #183's (D3).",
	);
}
console.log(
	`\n  baseline hull: ${PLAYER_BASELINE_HULL}, ${HOLD_REFERENCE_T} t, ` +
		`${(hullPriceCr(HOLD_REFERENCE_T) as number).toLocaleString("en-GB")} Cr.`,
);
console.log(
	`\n  a run is ${RUN_MINUTES} min in §5.4's arithmetic; ` +
		`CLOSABLE_RATIO ${CLOSABLE_RATIO.toFixed(3)} at every hold.`,
);
