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

import { HOLD_REFERENCE_T } from "../src/market";
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
