/**
 * The galaxy: where 2048 systems sit, and what each one is.
 *
 * Built from `docs/specs/galaxy-generation.md` (node
 * [#6](https://github.com/jcfischer/seelite/issues/6)). Every constant and
 * every formula here is that spec's; where a figure was derived rather than
 * chosen, the spec shows the derivation and this file points at the section
 * rather than repeating it.
 *
 * ## The one structural idea
 *
 * **A system is a hash of its identity, not a step in a chain.** Elite advanced
 * a 48-bit seed four times per system, so system *N* existed only because
 * 0…*N*−1 had been iterated first. That coupling is precisely what `rng.ts` was
 * vendored to prevent, and dropping it is what lets `systemAt` generate one
 * system in isolation and get the same record the full table holds. The price
 * was the only correctness oracle available — with Bell's seed, `txtelite`
 * output is a byte-exact golden file — so verification here is property-based
 * (`tests/galaxy.test.ts`), which is weaker and was accepted deliberately.
 *
 * ## Where the randomness comes from
 *
 * Two levels of split. `layoutSeed` fixes a galaxy *and an attempt* (see
 * `layoutGalaxy` on why an attempt number is part of a system's identity);
 * `systemSeedFor` fixes a system inside it; `stream` splits that by **domain**,
 * so adding a draw to the station generator moves no name and no position.
 * Adding a domain tag is safe. Renumbering one changes every seed's output.
 *
 * ## What this module does not own
 *
 * What a system physically contains — star, planets, stations, orbits — is
 * `system.ts`. This file stops at the record: position, polity, name,
 * description. The split is the spec's §4 / §6 line, and it is what keeps a
 * galaxy-wide sweep (2048 records, for connectivity or the start system) from
 * having to build 2048 solar systems.
 */

import { DOMAIN } from "./domains";
import { mix, seedFor, seededRand } from "./rng";
import { planetDescription, systemName } from "./names";
import { type Vec3, lengthSq } from "./vec3";

/** All eight exist from the start; switching galaxy changes an index and
 *  nothing else (spec §2). The consequence is a save obligation: per-galaxy
 *  visited flags, market state and legal status, not one global set. */
export const GALAXY_COUNT = 8;
export const SYSTEMS_PER_GALAXY = 256;

/**
 * How far the cluster is flattened on **y** — the oblate-spheroid ratio of its
 * through-plane extent to its in-plane one (spec §2).
 *
 * Ratified in #107 on 2026-08-28, reversing §2's earlier "globular volume".
 * `galaxy-map.md` §2's reference plane is `y = 0`, so the disc's plane *is* the
 * plane the chart's drop-lines already fall to — which is the second reason the
 * disc was taken, the first being that a galaxy is expected to look like one.
 *
 * **It was taken against a measured cost, not for one.** The node's own
 * hypothesis was that a disc spreads the same 256 points over a larger projected
 * area and so makes finding easier. It is refuted: holding ~8-in-range forces R
 * upward as the volume flattens, the framing grows with R, and flattening then
 * concentrates the points toward a plane — whose nearest-neighbour distances are
 * shorter than a ball's at equal projected extent. The ball is the least crowded
 * shape at every viewing angle including face-on — measured on a q x pitch grid
 * by `bun scripts/measure-galaxy-shape.ts grid`, which asserts it cell for cell
 * rather than only printing it, so a later retune cannot leave §2 stating a
 * refuted claim.
 *
 * **0.7 and not Elite's 0.5.** §2 declined Elite's 2:1 y-compression for a good
 * reason — it was a screen-aspect hack imported as a physical law — and adopting
 * that number now, on looks, would invite the reading that the argument was
 * wrong. 0.7 flattens visibly and costs 8 points of desktop crowding against
 * the ball, where 0.5 costs 13, both at the shipped 40° pitch.
 *
 * Sweep it with `bun scripts/measure-galaxy-shape.ts sweep`. Changing it means
 * re-solving `GALAXY_RADIUS_LY` — the two are one derivation, and a q moved
 * without it silently changes how many systems a tank reaches.
 */
export const GALAXY_FLATTENING_Q = 0.7;

/**
 * The cluster radius in light years — **derived, not chosen** (spec §2.1).
 *
 * Elite's 7 LY tank put ≈8 systems in range of a typical world, and that number
 * is the actual design constant: enough choice to plan a route, few enough that
 * a distant system is a project. Holding it fixes the density, and the density
 * fixes the radius.
 *
 * This is the in-plane radius: the cluster reaches `R` across and
 * `GALAXY_FLATTENING_Q · R` through. It was 22 while the cluster was a ball and
 * is **solved at q = 0.7** here, over *connected* layouts, to hold a mean of
 * ~8 systems inside the 7 LY tank. Measured at **7.97** over the instrument's 24
 * connected layouts (seeds 1, 47, 12345) and **8.00** over the 32 the suite
 * gates (those three plus the test file's own) — two seed sets, not two
 * quantities, and the galaxy-to-galaxy spread is 7.04-9.02, so a mean quoted to
 * three digits is a mean of a sample. Against the ball's 7.88 at 22 LY on the
 * first of those sets: the reshape preserved the reach it was solved for.
 * Re-solve with `bun scripts/measure-galaxy-shape.ts solve 0.7 8`, and read the
 * shipped figures with `bun scripts/measure-galaxy-shape.ts shipped`.
 *
 * **8.25 is not that number and never was.** `galaxy-generation.md` §2.1 quoted
 * it as the mean in range, but it is the prediction of a *uniform-ball* closed
 * form; the generator is 3:1 concentrated and re-rolls fragmented layouts, and
 * the ball it described actually held 7.88. #107 carried 8.25 forward as
 * though it were measured. Corrected in the spec under #118.
 *
 * **Over connected layouts, because that filter is not neutral.** `layoutGalaxy`
 * rejects a fragmented draw and re-rolls, which selects denser layouts. #107's
 * first solve measured first-pass draws, landed at R = 23.9 with a mean of 8.76,
 * and reported 1.13 isolated systems in the arm that reproduces the shipped
 * ball — which has none. Both faults are one mistake: measuring galaxies the
 * game would never ship.
 *
 * **Beware r³ when changing this.** 35 LY reads as a modest increase and drops
 * the same tank to ~2 systems in range, which near-certainly fragments the
 * graph.
 */
export const GALAXY_RADIUS_LY = 24.53;

/** The density profile's core radius, `R/√2`, which is what makes the core:rim
 *  ratio exactly 3 (spec §3). */
export const CORE_RADIUS_LY = GALAXY_RADIUS_LY / Math.SQRT2;

/** Jump range and fuel price (spec §2, §8). The range is also the edge
 *  predicate for the connectivity graph. */
export const JUMP_RANGE_LY = 7.0;

/**
 * **2 Cr per LY, not 0.2** — Elite's PRXS table charges 0.2 Cr per *0.1* LY, so
 * a full 7 LY tank is 14 Cr (`economy-trade.md` §6.1, `galaxy-generation.md`
 * §8).
 *
 * This read `0.2` until #11. The specs were corrected under #7 and the check
 * that correction named was a repo-wide grep for `0.2 Cr` — which is a search
 * for *prose*, and finds nothing in a module whose copy of the figure is a bare
 * literal on a differently-named constant. `market.ts` declares the same price
 * as `FUEL_CR_PER_LY = 2`; the two disagreed by a factor of ten for six weeks,
 * unnoticed because nothing imported `jumpCost` until the route panel did.
 * `tests/galaxy-route.test.ts` now asserts they agree, which is the check a
 * grep could not be.
 */
export const FUEL_COST_PER_LY = 2;

/** Bisection steps used to invert the radial CDF. **Fixed, not a tolerance** —
 *  a convergence-dependent count would make the layout a function of the
 *  floating-point path taken rather than of the seed (spec §3). */
const CDF_BISECTION_STEPS = 40;

/**
 * How many layouts to try before giving up (see `layoutGalaxy`).
 *
 * **Measured, and the spec's expectation was optimistic.** §5 says "a handful
 * of attempts is free", which reads as single digits and is right about the
 * cost but not about the count: over 1,600 galaxies (200 world seeds × 8) the
 * mean is 4.63, the median 3, the 95th percentile 16 and the worst seen **52**.
 * Roughly four layouts in five strand at least one system, which is what a 3:1
 * concentrated 24.53 LY disc against a 7 LY jump actually costs at the rim.
 *
 * (The ball cost slightly more — mean 6.0, p95 19, same worst case of 52. The
 * disc lays out marginally easier at the radius §2.1 solves for it, which was
 * not a goal and is not a reason: #107 measured it at 7.3 re-rolls against 5.3
 * over three seeds, the opposite ordering, so the two figures are inside each
 * other's seed-to-seed noise and neither is a claim about the shape.)
 *
 * Re-run that measurement with `bun scripts/measure-layout-attempts.ts` (~5 s at
 * the default 200 seeds). It is a script rather than a test because it asserts
 * nothing; §10 says a sharp rise in these counts is the signal to revisit the
 * profile or the radius, and a reader acting on that needs to be able to
 * reproduce the baseline they are comparing against rather than trust a number
 * in a comment.
 *
 * So this is a ceiling with real margin rather than a plausible-looking round
 * number. A first pass used 64, which sits *below* an observed value: the
 * failure that produces is a thrown error on somebody's world seed and a game
 * that will not start, and it would have been rare enough to ship. One attempt
 * measures at 0.38 ms, so the impossible worst case is **~195 ms** of pure
 * arithmetic, once, at galaxy generation. (An earlier version of this line said
 * ~50 ms, which was a guess and was out by 4×.)
 *
 * If a change ever pushes the *distribution* up rather than the tail, the fix is
 * the density profile (§3) or the radius (§2.1) — not this number.
 */
export const MAX_LAYOUT_ATTEMPTS = 512;

/** The root of all galaxy-level derivation. */
export const galaxyRoot = (worldSeed: number): number =>
	seedFor(worldSeed, "galaxy");

/** Positions belong to a (galaxy, attempt) pair — see `layoutGalaxy`. */
export const layoutSeed = (
	worldSeed: number,
	galaxy: number,
	attempt: number,
): number => mix(mix(galaxyRoot(worldSeed), galaxy), attempt);

/** One system's identity within a laid-out galaxy. */
export const systemSeedFor = (
	worldSeed: number,
	galaxy: number,
	attempt: number,
	index: number,
): number => mix(layoutSeed(worldSeed, galaxy, attempt), index);

/** A system's stream for one domain. */
export const stream = (systemSeed: number, domain: number): (() => number) =>
	seededRand(mix(systemSeed, domain));

export const GOVERNMENT_NAMES = [
	"Anarchy",
	"Feudal",
	"Multi-gov",
	"Dictatorship",
	"Communist",
	"Confederacy",
	"Democracy",
	"Corporate State",
] as const;

export const ECONOMY_NAMES = [
	"Rich Ind",
	"Average Ind",
	"Poor Ind",
	"Mainly Ind",
	"Mainly Agri",
	"Rich Agri",
	"Average Agri",
	"Poor Agri",
] as const;

/** One system, as the galaxy knows it. What is *in* it is `system.ts`. */
export interface SystemRecord {
	galaxy: number;
	/** 0…255 within its galaxy. */
	index: number;
	/** Which layout attempt produced this galaxy — part of the system's seed,
	 *  so it has to travel with the record. */
	attempt: number;
	seed: number;
	/** Light years, galaxy-centred, true 3D. */
	pos: Vec3;
	/** Distance from the cluster centre, light years. */
	radiusLy: number;
	/** `radiusLy / GALAXY_RADIUS_LY` — 0 at the core, 1 at the rim. The one
	 *  input every radial bias in §4 reads. */
	t: number;
	name: string;
	government: number;
	economy: number;
	tech: number;
	/** `tech + 1`, the 1–15 figure Elite shows and equipment gates on. */
	displayTL: number;
	population: number;
	productivity: number;
	description: string;
}

export interface Galaxy {
	index: number;
	/** The attempt that produced a connected layout. Asserted in the suite: a
	 *  generator change that suddenly needs 40 attempts should show up in a diff
	 *  rather than as a slow start-up (spec §5). */
	attempt: number;
	systems: SystemRecord[];
}

/** Distance in light years between two galaxy-space points. */
export const distanceLy = (a: Vec3, b: Vec3): number =>
	Math.sqrt(squaredDistanceLy(a, b));

/**
 * The same distance, unrooted — what the two O(n²) sweeps in this module
 * actually need.
 *
 * `isConnected` runs up to 256² pairs per attempt, at a mean of 6 attempts per
 * galaxy, so the square root alone is 400k–1.2M calls per galaxy at start-up
 * and every one of them feeds a comparison that does not need it.
 *
 * The two forms are not bit-identical: `√(d²) ≤ 7` and `d² ≤ 49` can disagree
 * for a pair sitting within an ulp of the jump range. Both are equally valid
 * readings of "within 7 LY" and the generator only owes determinism, so the
 * squared form is the definition — with the pinned attempt counts in the suite
 * as the record of what it produces.
 */
export const squaredDistanceLy = (a: Vec3, b: Vec3): number => {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return dx * dx + dy * dy + dz * dz;
};

/**
 * The volume-weighted radial CDF of the spec's density profile (§3).
 *
 * ρ(r) ∝ 1/(1 + (r/r_c)²), so the mass inside radius *x* integrates to
 * `x − r_c·atan(x/r_c)`, normalised at `R`.
 */
/**
 * `radius` defaults to the shipped `R`, and the profile's core radius is always
 * `radius/√2` — which is what makes this scale-free in `x/radius` (§2.1).
 *
 * The parameter exists so `positionForShape` can draw galaxies at radii the game
 * does not ship without a second copy of this arithmetic. A copy is what the
 * sweep instrument used to hold, and two 40-step bisections that must stay in
 * step is exactly the shape of drift this file keeps being bitten by.
 */
export function radialCdf(x: number, radius = GALAXY_RADIUS_LY): number {
	const core = radius / Math.SQRT2;
	return (
		(x - core * Math.atan(x / core)) /
		(radius - core * Math.atan(radius / core))
	);
}

/**
 * Invert `radialCdf` by bisection, at a fixed step count.
 *
 * There is no closed form, and a `while (err > tol)` loop would make the galaxy
 * depend on the arithmetic rather than on the seed. Forty halvings of a 24.5 LY
 * interval leave ~2·10⁻¹¹ LY of uncertainty, which is far below anything the
 * simulation can see.
 */
export function radiusForQuantile(
	u: number,
	radius = GALAXY_RADIUS_LY,
): number {
	let lo = 0;
	let hi = radius;
	for (let i = 0; i < CDF_BISECTION_STEPS; i++) {
		const mid = (lo + hi) / 2;
		if (radialCdf(mid, radius) < u) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

/**
 * One system's position, drawn from its own `POS` stream.
 *
 * Radius by inverse transform on the concentrated profile; direction uniform on
 * the sphere (`cosθ = 2u−1` rather than `θ = πu`, which would pile systems at
 * the poles); then **y scaled by `GALAXY_FLATTENING_Q`** to make the oblate
 * spheroid of §2.
 *
 * **Three draws, in this order, and the squash is the last thing that happens.**
 * A flattening that changed the *sampling* — drawing `cosθ` from a non-uniform
 * distribution, say — would move every galaxy for a second reason on top of the
 * shape, and no sweep comparing the two shapes would be comparing only the
 * shape. `scripts/measure-galaxy-shape.ts control` asserts the parameterised
 * replica reproduces this function exactly, which is what the whole instrument
 * rests on.
 */
export const systemPosition = (systemSeed: number): Vec3 =>
	positionForShape(systemSeed, GALAXY_FLATTENING_Q, GALAXY_RADIUS_LY);

/**
 * `systemPosition` with the shape as parameters — the generator every sweep in
 * `scripts/measure-galaxy-shape.ts` runs.
 *
 * **Exported rather than re-implemented there**, which is the point. The
 * instrument needs to draw galaxies at shapes the game does not ship, and a
 * private copy of this function is a copy that stops matching the day
 * `radiusForQuantile` or the draw order changes — leaving a sweep that measures
 * a generator nobody runs, with nothing going red. Here there is one body, so
 * the sweep is the shipped draw by construction rather than by a control that
 * has to be remembered.
 *
 * There is one bisection body: `radiusForQuantile` takes the radius as a
 * parameter, so this is the shipped inverse rather than a copy of it that has to
 * be kept in step.
 */
export function positionForShape(
	systemSeed: number,
	q: number,
	radius: number,
): Vec3 {
	const rand = stream(systemSeed, DOMAIN.POS);
	const r = radiusForQuantile(rand(), radius);
	const cosTheta = 2 * rand() - 1;
	const phi = 2 * Math.PI * rand();
	const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
	return {
		x: r * sinTheta * Math.cos(phi),
		y: q * r * sinTheta * Math.sin(phi),
		z: r * cosTheta,
	};
}

/**
 * The **profile radius** — the spheroidal coordinate the density profile of §3
 * is defined on, `√(x² + (y/q)² + z²)`, which is exactly the radius
 * `systemPosition` drew before the squash.
 *
 * **This is not `radiusLy`, and the difference is load-bearing.** `radiusLy` is
 * the plain Euclidean distance from the centre and is what `startSystem` means
 * by "most central". The *profile* radius is what §3's `ρ(r)` and §4's radial
 * gradients are written against, and it runs 0…`GALAXY_RADIUS_LY` by
 * construction on any axis, where the Euclidean distance only reaches
 * `q · GALAXY_RADIUS_LY` at the poles.
 *
 * Reading the gradients off the Euclidean distance instead was the alternative,
 * and it is worse in both directions: a rim system above the plane would read as
 * mid-disc, the core:rim ratio would stop being the 3.0 §3 quotes, and the whole
 * polity distribution would shift toward the core for no reason anybody chose.
 * A disc's outskirts include its halo — being far above the plane *is* being far
 * out — so the ellipsoidal shell is also the truer reading of "how far out".
 *
 * Decided under #118; #107 ratified only that "the 3:1 ratio holds", which this
 * is what it takes to be true.
 */
export const profileRadiusLy = (pos: Vec3): number =>
	Math.sqrt(
		pos.x * pos.x +
			(pos.y / GALAXY_FLATTENING_Q) * (pos.y / GALAXY_FLATTENING_Q) +
			pos.z * pos.z,
	);

/** Whether a jump graph at `maxJump` has exactly one component. Plain BFS from
 *  system 0; 256 nodes makes the O(n²) adjacency scan cheaper than building an
 *  index for it. */
export function isConnected(
	positions: readonly Vec3[],
	maxJump = JUMP_RANGE_LY,
): boolean {
	const n = positions.length;
	if (n === 0) return true;
	const seen = new Uint8Array(n);
	const queue = [0];
	seen[0] = 1;
	let reached = 1;
	const maxJumpSq = maxJump * maxJump;
	while (queue.length > 0) {
		const i = queue.pop() as number;
		for (let j = 0; j < n; j++) {
			if (seen[j]) continue;
			if (squaredDistanceLy(positions[i], positions[j]) <= maxJumpSq) {
				seen[j] = 1;
				reached++;
				queue.push(j);
			}
		}
	}
	return reached === n;
}

/**
 * Lay a galaxy out, resampling until the jump graph is one component.
 *
 * **Guarantee by resampling, not by repair** (spec §5). A 3:1 concentrated
 * sphere leaves only ~3 systems in range at the rim, and a stranded pocket
 * containing the start system is an unwinnable save. Rejecting a whole layout
 * moves no individual system, which is what pulling stragglers inward would
 * have done — and would have done exactly where the profile is most fragile.
 *
 * **It does not leave the profile untouched, though, and §5 says it does.**
 * Rejection conditions the *joint* distribution: layouts survive because of
 * where all 256 systems landed together, so the surviving population is not the
 * unconditioned one. Measured over 3,200 galaxies (`bun
 * scripts/measure-rejection-bias.ts 400`, ~8 s), accepted layouts run **+0.36%
 * in mean radius**: the innermost shell is 3.7% under-occupied, the next two
 * 2.6%, and the 0.75–0.88 R shell 2.4% over. The direction is the intuitive one
 * on reflection — a layout with a little more mass in the outer-middle shells
 * bridges the rim, and one that piles into the core strands its outliers.
 *
 * That is far below anything a player could perceive and it is not nothing, so
 * it is written down rather than waved off. The suite's KS test cannot see it —
 * a 0.4% shift needs on the order of 10⁵ samples to separate from noise, and
 * the test has 2,048 — which is exactly why the figure lives in a script whose
 * sample size is large enough to mean something.
 *
 * The attempt number goes into the seed, so a resampled galaxy is a *different*
 * galaxy rather than the same one nudged, and it stays a pure function of the
 * world seed.
 *
 * **Memoised**, because a layout is expensive and asking for one twice is the
 * normal case rather than the exception: `systemAt` needs a layout to place one
 * system, and a galaxy map hovering system by system would otherwise pay a mean
 * of 6 full resamples — 256 positions × 40 bisection steps each, plus the
 * connectivity scan — per lookup. Being a pure function of `(worldSeed, galaxy)`
 * is what makes caching it sound; the cache is keyed on exactly those two.
 *
 * The cache changes *when* work happens and never *what is returned*, so the
 * module's contract is unchanged — but an unbounded map keyed on world seed is
 * a leak for any caller that iterates seeds (the measurement scripts do exactly
 * that), so it is bounded and evicts oldest-first. Eight galaxies is one world,
 * and two worlds in flight is the realistic maximum: a running game and a
 * preview.
 */
const LAYOUT_CACHE_LIMIT = 16;
const layoutCache = new Map<string, { positions: Vec3[]; attempt: number }>();

export function layoutGalaxy(
	worldSeed: number,
	galaxy: number,
): { positions: Vec3[]; attempt: number } {
	const key = `${worldSeed >>> 0}:${galaxy}`;
	const cached = layoutCache.get(key);
	if (cached) return cached;
	for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
		const positions: Vec3[] = [];
		for (let n = 0; n < SYSTEMS_PER_GALAXY; n++) {
			positions.push(
				systemPosition(systemSeedFor(worldSeed, galaxy, attempt, n)),
			);
		}
		if (isConnected(positions)) {
			const result = { positions, attempt };
			if (layoutCache.size >= LAYOUT_CACHE_LIMIT) {
				// Insertion-ordered, so the first key is the oldest.
				const oldest = layoutCache.keys().next().value;
				if (oldest !== undefined) layoutCache.delete(oldest);
			}
			layoutCache.set(key, result);
			return result;
		}
	}
	// Deliberately fatal. If this ever fires, the fix is the density profile
	// (§3) or the radius (§2.1) — not a bigger retry budget.
	throw new Error(
		`galaxy ${galaxy}: no connected layout in ${MAX_LAYOUT_ATTEMPTS} attempts`,
	);
}

/** Drop the memoised layouts. Nothing about correctness depends on it — the
 *  cached value is the value — but a benchmark that means to time a layout has
 *  to be able to say "not from the cache". */
export const clearLayoutCache = (): void => layoutCache.clear();

const clamp = (x: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, x));

/**
 * One system record, from its position in the cluster.
 *
 * Separate from `layoutGalaxy` because the position is a galaxy-level fact
 * (it depends on the attempt) while everything below is a system-level one. It
 * takes the position rather than re-deriving it so that a caller holding a
 * layout does not pay for the bisection twice.
 *
 * Draw order inside `POLITY` is fixed: government jitter, then economy. Both
 * come from the same stream, so inserting a draw between them moves every
 * economy in the galaxy.
 */
export function systemFromPosition(
	worldSeed: number,
	galaxy: number,
	attempt: number,
	index: number,
	pos: Vec3,
): SystemRecord {
	const seed = systemSeedFor(worldSeed, galaxy, attempt, index);
	const radiusLy = Math.sqrt(lengthSq(pos));
	// **The profile coordinate, not the Euclidean distance.** See
	// `profileRadiusLy`: §4's gradients are written against the shape's own
	// shells, and only that coordinate spans 0…1 on every axis.
	const t = profileRadiusLy(pos) / GALAXY_RADIUS_LY;

	const polity = stream(seed, DOMAIN.POLITY);

	// Government: mean 6 at the core, 1 at the rim, ±2 of jitter (§4.1). This is
	// what makes the frontier feel like a frontier without inventing a mechanic —
	// Elite's hostile-spawn rule reads `government` directly, so danger becomes a
	// function of position.
	const government = clamp(Math.round(6 - 5 * t + (polity() * 4 - 2)), 0, 7);

	// Economy: deliberately **not** radial (§4.2), and the load-bearing asymmetry
	// of the whole spec. Elite's starter loop was two adjacent systems with
	// opposite economies; if economy tracked radius, neighbours would share one,
	// local margins would collapse, and profit would need long radial hauls. The
	// `|= 2` is Elite's anarchy-isn't-rich clamp, retained.
	let economy = Math.floor(polity() * 8);
	if (government <= 1) economy |= 2;

	// Tech: Elite's formula with its random 0–3 term replaced by a radial one, so
	// the gradient arrives twice — directly, and through `government` (§4.3).
	// Equipment is tech-gated, which is what makes the rim the place you cannot
	// buy the ECM you need to survive it.
	const techBonus = Math.round(3 * (1 - t));
	const tech = techBonus + (economy ^ 7) + (government >> 1) + (government & 1);
	const displayTL = tech + 1;

	// Elite's derived fields, unchanged (§4.4).
	const population = 4 * tech + economy + government + 1;
	const productivity = ((economy ^ 7) + 3) * (government + 4) * population * 8;

	const name = systemName(stream(seed, DOMAIN.NAME));
	const description = planetDescription(name, stream(seed, DOMAIN.DESC));

	return {
		galaxy,
		index,
		attempt,
		seed,
		pos,
		radiusLy,
		t,
		name,
		government,
		economy,
		tech,
		displayTL,
		population,
		productivity,
		description,
	};
}

/**
 * One system on its own — the property the hash-per-system substrate exists to
 * provide, and the one that would have failed under Bell's chain.
 *
 * It still needs the galaxy's layout, because a system's *position* is a
 * galaxy-level fact: the attempt number is part of its seed. What it does not
 * do is generate any other system's *record* — no name, no polity, no
 * description is computed for a system nobody asked for.
 *
 * The layout itself is memoised (see `layoutGalaxy`), so the first call in a
 * session pays for it and the rest do not. Without that this function reads as
 * per-system and behaves as per-galaxy, which is the more expensive kind of
 * wrong: the cost is invisible at the call site.
 */
export function systemAt(
	worldSeed: number,
	galaxy: number,
	index: number,
): SystemRecord {
	const { positions, attempt } = layoutGalaxy(worldSeed, galaxy);
	return systemFromPosition(
		worldSeed,
		galaxy,
		attempt,
		index,
		positions[index],
	);
}

/** A whole galaxy: a connected layout, and a record per system. */
export function generateGalaxy(worldSeed: number, galaxy: number): Galaxy {
	const { positions, attempt } = layoutGalaxy(worldSeed, galaxy);
	const systems = positions.map((pos, index) =>
		systemFromPosition(worldSeed, galaxy, attempt, index, pos),
	);
	return { index: galaxy, attempt, systems };
}

/**
 * Where a new game starts (spec §5.1).
 *
 * Galaxy 0, the most central system that is both well-stocked (`displayTL ≥ 8`)
 * and orderly (`gov ≥ 5`), ties broken by lowest index. That puts the player in
 * the safe core with the frontier outward — the direction of increasing profit
 * and increasing danger — and it is deterministic, which a "pick a nice-looking
 * one" rule would not be.
 */
export function startSystem(galaxy: Galaxy): SystemRecord {
	let best: SystemRecord | null = null;
	for (const s of galaxy.systems) {
		if (s.displayTL < 8 || s.government < 5) continue;
		if (best === null || s.radiusLy < best.radiusLy) best = s;
	}
	if (best === null) {
		throw new Error(
			`galaxy ${galaxy.index}: no system with displayTL >= 8 and gov >= 5`,
		);
	}
	return best;
}

/**
 * Systems reachable in one jump from `from`, nearest first.
 *
 * Identity is `(galaxy, index)`, not `index`: an index is only unique *within*
 * its galaxy, so filtering on it alone would drop `from`'s seven cross-galaxy
 * twins from any multi-galaxy list and keep `from` itself. Galaxies are a
 * namespace (spec §2) and nothing stops two of them being held in one array.
 */
export function neighbours(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): SystemRecord[] {
	// Squared first, rooted only for the ~8 survivors — the same reason
	// `isConnected` does it, and the sort is what needs the true distance.
	const maxJumpSq = maxJump * maxJump;
	return systems
		.filter(
			(s) =>
				(s.galaxy !== from.galaxy || s.index !== from.index) &&
				squaredDistanceLy(from.pos, s.pos) <= maxJumpSq,
		)
		.map((s) => ({ s, d: distanceLy(from.pos, s.pos) }))
		.sort((a, b) => a.d - b.d)
		.map(({ s }) => s);
}

/** Credits to jump a given distance (spec §8). The wind-up, the vulnerability
 *  window and what happens if it is interrupted are combat's business (#8). */
export const jumpCost = (ly: number): number => ly * FUEL_COST_PER_LY;
