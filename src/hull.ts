/**
 * What a hull *is*, as opposed to what it looks like.
 *
 * #26 ruled both axes and ruled (D5) that mass and thrust are hull properties,
 * and then recorded that no hull carried a single simulation property: the
 * roster was a role, three dimensions and a display reach, so every ship in the
 * game flew and traded identically. This module is that table.
 *
 * **It imports nothing, and that is the job.** `ship-mesh.ts` imports Three, and
 * `sim.ts` may not (the module docstring there says why); the flight model and
 * the berth's fit predicate both need to know how big and how heavy a ship is,
 * so the answer has to live somewhere neither of them can be poisoned by. It is
 * the third leaf, beside `units.ts` and `vec3.ts`, and `tests/headless.test.ts`
 * asserts it.
 *
 * **Two tables, not one, and the split is #28's.** A station's display reach and
 * its dockable geometry live in separate modules for the reason that a number
 * describing how far a drawn object *reaches* is not the number a fit predicate
 * may read. The same split applies here: `HULL_REACH_KM` in `ship-mesh.ts` is
 * how far the drawn hull reaches and is what lays a gallery out; `HullSpec.env`
 * here is the box a berth has to admit.
 *
 * **The envelope is measured, not declared.** The table this replaces stated one
 * length, beam and height per hull for three meshes that differ by up to 2.78x
 * in beam (the interceptor) and 2.60x in height (the raider), and nothing
 * compared them with any of the three. It matched none. Stated on one basis —
 * the built figure over the declared one — the meshes run from **0.49x to
 * 1.68x** the declared height: the raider was declared 22 m and its `a` variant
 * builds at 10.8, while the courier was declared 14 m and its `c` variant builds
 * at 23.5.
 *
 * The understatement is the direction that mattered, because `berthFits` reads
 * this box and `BERTH_CELL` had been sized from the declaration: against the
 * meshes, `miner/a` and `miner/c` are 40.0 m and 47.5 m tall to a 40 m cell and
 * fit no berth in the game at all. `tests/hull.test.ts` rebuilds each selected
 * variant's mesh and compares.
 *
 * **Mass is a density band, not a density table.** Each row's `massT` is its
 * selected variant's box volume against a role density — a freighter dense for
 * its size because cargo structure is (2.20 t per 1,000 m³), an interceptor
 * light because it is mostly engine (1.38). A *table* of densities would be a
 * third declared number pretending to be a derivation, so what is written down
 * is the band: `tests/hull.test.ts` asserts 1.2 to 2.4 against the mesh's own
 * box, which is what a later editor re-deriving a mass after the envelopes move
 * has to work with.
 */

export const HULL_IDS = [
	"courier",
	"interceptor",
	"freighter",
	"miner",
	"patrol",
	"explorer",
	"raider",
	"carrier",
	"tug",
	"prospector",
	"dreadnought",
	"voyager",
] as const;
export type HullId = (typeof HULL_IDS)[number];

export const HULL_VARIANT_IDS = ["a", "b", "c"] as const;
export type HullVariantId = (typeof HULL_VARIANT_IDS)[number];

export type HullRole =
	| "player-baseline"
	| "fast"
	| "cargo"
	| "industrial"
	| "security"
	| "survey"
	| "outlaw"
	| "capital"
	| "salvage"
	| "prospect"
	| "battle-line"
	| "expedition";

/**
 * A ship's bounding box, kilometres.
 *
 * Here rather than in `station-interior.ts`, where it was: that module needed
 * the shape first, so the canonical description of how big a ship is became a
 * detail of how a berth is allocated. #46's rule — a module that names a shared
 * identity owes a single owner — and the same fix, a leaf both sides import.
 */
export interface HullEnvelope {
	lengthKm: number;
	beamKm: number;
	heightKm: number;
}

export interface HullSpec {
	readonly role: HullRole;
	/**
	 * Which of the three meshes this hull *is*.
	 *
	 * #26's D2 reads the `a`/`b`/`c` meshes as design alternates — three attempts
	 * at one idea, ranked as equals by #35 — the way a station role has three
	 * forms and one is selected. Nothing selected until here, and `PLAYER_HULL`
	 * in `main.ts` was the only place a variant had ever been named.
	 *
	 * Selected by a stated rule rather than by taste, because taste is the
	 * principal's: **the variant admitted by the most station roles, `a` on a
	 * tie.** Measured against the berth catalogue, that keeps `a` everywhere but
	 * the freighter and the miner — `miner/a` and `miner/c` are 40.0 m and 47.5 m
	 * tall against a 40 m cell and fit no berth in the game at all. Any row here
	 * is the principal's to overrule on how it looks; what the rule buys is that
	 * none of them was chosen on how it looks by an agent.
	 */
	readonly variant: HullVariantId;
	/** The selected variant's measured bounding box, rounded **up** to 0.1 m.
	 *  Up, because a berth's fit predicate reads it: rounding down would admit a
	 *  hull that does not fit by up to 5 cm. */
	readonly env: HullEnvelope;
	/**
	 * Mass, tonnes, and thrust, meganewtons — #26's D5, and the two numbers every
	 * handling figure in `sim.ts` derives from.
	 *
	 * Mass is the box volume against a role density (see the module docstring for
	 * the band); thrust is solved for the acceleration the role should feel, and
	 * `sim.ts` divides one by the other. The courier's pair reproduces #5's tuned
	 * 2.0 km/s² exactly, so the baseline hull flies today's ship and the whole
	 * roster hangs off it.
	 */
	readonly massT: number;
	readonly thrustMN: number;
	/** Cargo capacity, tonnes. The courier's is `economy-trade.md` §6's 20 t and
	 *  is the reference the stock deficit's response is stated against — #26's D6
	 *  defers the *multiplier* to the pricing node, not the capacities. */
	readonly holdT: number;
	/** Forward weapon mounts. `combat-model.md` §2 fires one forward weapon
	 *  today, so a second mount is a property #8's build will read rather than
	 *  one anything reads now. */
	readonly hardpoints: number;
	/** Hull integrity, against the 100 the combat prototype gives every ship
	 *  (`combat-prototype.ts`). Set from mass — structure is mass — as
	 *  `100 × (massT / 60) ^ 0.6`, rounded — a law `tests/hull.test.ts` asserts
	 *  every row against, so a hand-edited figure is a deliberate deviation
	 *  rather than a typo. #8's prototype owns retuning any row, and moving one
	 *  means moving the law or the check with it. */
	readonly integrity: number;
	/** Hyperspace tank, light years, and cruise drive charge, AU — both read
	 *  off the **flown** hull (#185, #554). `tankLy` is the hull's jump range
	 *  *and* its fuel capacity, one number, so a short tank flies a fragmented
	 *  jump graph on purpose. The courier's tank equals `galaxy.ts`'s
	 *  `JUMP_RANGE_LY`, the connectivity predicate, and `tests/hull.test.ts`
	 *  asserts that; no other hull's has to. */
	readonly tankLy: number;
	readonly chargeAu: number;
	/**
	 * What a shipyard charges, credits — #26's D4, measured by #182.
	 *
	 * `hullPriceCr(holdT)` below is the law and this is its output, stored for
	 * the reason `integrity` is: a screen reads a row rather than calling a
	 * function, and `tests/hull.test.ts` asserts every row against the law, so a
	 * hand-edited figure is a deliberate deviation rather than a typo.
	 *
	 * **`null` where the law has nothing to say.** The capitals hold 400 t,
	 * 200 t and 240 t, all past `HULL_CEILING_HOLD_T` and outside the hold range the
	 * curve was measured over, and #56 rules that they dock at nothing. A number
	 * there would be an extrapolation wearing a measurement's clothes, which is
	 * the failure `galaxy-generation.md` §2.1 carried for years. Whether a
	 * shipyard *lists* a priced hull is a separate question and
	 * `PURCHASABLE_HULL_IDS` is where it is answered: `patrol` and `raider` hold
	 * 6 t and 10 t, well inside the measured range, so the law answers for them.
	 * #562 put them on the combat ladder at rungs 6 and 7, and neither is sold
	 * until #565 and #566 rule on what flying one means to the law.
	 */
	readonly priceCr: number | null;
}

/**
 * #182's measured price law: what a hull's **hold** is worth, capitalised.
 *
 * `price(hold) = HULL_PRICE_BASELINE_CR x (hold / the baseline hold) ^ exponent`,
 * rounded. The exponent is the fitted elasticity of the greedy trader's Cr/min
 * on the hold; the baseline is that fit's rate at the baseline hull's hold times
 * the measured time it takes to earn `fullKitCr()`. So a hull costs what its
 * hold earns back over one kit — #26's own two anchors, used as anchors.
 *
 * **`economy-trade.md` §7.1 owns the derivation, the figures and the caveats**,
 * and this docstring deliberately carries none of them: a measurement narrative
 * copied into three files diverges, and one copy of this one already did.
 * `scripts/measure-hull-pricing.ts` reprints both constants beside what a fresh
 * run derives, which is the map's #118 rule.
 *
 * **Two decimals is a legible rounding of the fit, not a resolved figure.** The
 * slope's standard error is about a hundredth and a half, so it settles neither
 * the third place nor the second; what §7.1 measures instead is what that
 * uncertainty costs the ladder, and the answer is under a couple of rounding
 * steps everywhere.
 */
export const HULL_PRICE_EXPONENT = 0.61;

/** The baseline hull's price, credits — the law's anchor. See the exponent
 *  above for where both figures come from. */
export const HULL_PRICE_BASELINE_CR = 35_000;

/** Prices are quoted to the nearest hundred credits, like every other figure in
 *  `economy-trade.md` §7. Finer would be false precision against a fitted
 *  exponent; §7.1 there carries the fit's own standard error and the
 *  world-to-world spread, and this file deliberately does not restate either. */
export const HULL_PRICE_STEP_CR = 100;

/**
 * The largest hold that can dock anywhere, tonnes — #26's D7, and the answer is
 * not the economy's.
 *
 * D7 sets the ceiling where the priced curve stops being interesting.
 * **Measured, it never does** — a power law with no knee anywhere in the ladder,
 * with the shelves still filling most of a 200 t hold at the top of it — so the
 * binding limit is geometric, and naming which one it is *is* the answer rather
 * than a substitute for one. §7.2 there carries the measured figures.
 *
 * It is the largest clear berth envelope in the game against the roster's own
 * densest hold: the cargo role's bounding box per tonne, carried out to the
 * berth cell. An upper bound in the safe direction, because it assumes a hull
 * could be a solid box at that density, and #26's constraint that beam and
 * height are nearly spent means growth is in length — the cheapest of the three
 * axes to spend.
 *
 * **Declared here rather than derived here, because this module is a leaf.** It
 * imports nothing and `tests/headless.test.ts` asserts it, so a `BERTH_CELL`
 * import would drag `station-interior.ts` into the third leaf.
 * `tests/hull.test.ts` re-derives it from the berth catalogue and the roster's
 * measured envelopes, which is the same split `integrity` and `env` already
 * use.
 */
export const HULL_CEILING_HOLD_T = 197;

/**
 * Anything that divides by a hold has to refuse a non-positive one.
 *
 * A zero hold gives a non-finite result and a negative one *inverts* every rule
 * built on it — §5.2's response would make a good cheaper the more of it you
 * bought. Neither can come from the roster, but `holdCapacityT` reads a saved
 * commander before anything validates it. **Here because this module is the leaf
 * both `market.ts` and `station-commerce.ts` already import**, so the one guard
 * has one home rather than a copy at each divider.
 */
export const requirePositiveHold = (holdT: number): void => {
	if (!(holdT > 0)) throw new Error(`hold must be positive, got ${holdT}`);
};

/**
 * The law at an arbitrary exponent, and the ceiling check off.
 *
 * Exported for `measure-hull-pricing.ts`, which prints what the fit's own
 * uncertainty costs the ladder by evaluating the same law at the exponent ± its
 * standard error. Without it the instrument had the formula and the rounding
 * step written out a second time, and a step change would have landed in the
 * leaf while the printed band went on rounding the old way.
 */
export const priceAtExponent = (holdT: number, exponent: number): number => {
	requirePositiveHold(holdT);
	const raw =
		HULL_PRICE_BASELINE_CR *
		(holdT / HULL_SPECS[PLAYER_BASELINE_HULL].holdT) ** exponent;
	return Math.round(raw / HULL_PRICE_STEP_CR) * HULL_PRICE_STEP_CR;
};

/**
 * A hull's price from its hold.
 *
 * Anything above `HULL_CEILING_HOLD_T` returns `null`: past the ceiling nothing
 * docks, so there is no price rather than a large one, and a caller has to
 * answer for the case instead of quoting an extrapolation.
 */
export const hullPriceCr = (holdT: number): number | null => {
	requirePositiveHold(holdT);
	if (holdT > HULL_CEILING_HOLD_T) return null;
	return priceAtExponent(holdT, HULL_PRICE_EXPONENT);
};

/**
 * The seven civilian hulls a shipyard sells (#26's D3).
 *
 * `patrol` and `raider` read as NPC identities rather than purchases — selling
 * a police hull or a pirate hull makes #8's legal status and #13's fence
 * geography owe rules they do not have. Each carries a combat rung (#562 D7,
 * `ladder.ts`'s `GATES`), and a rung does not supply those rules, so neither
 * joins this list until #565 and #566 close.
 * The capitals do not dock at all (#56, and `voyager` since #331).
 */
export const PURCHASABLE_HULL_IDS = [
	"courier",
	"interceptor",
	"freighter",
	"miner",
	"explorer",
	"tug",
	"prospector",
] as const satisfies readonly HullId[];

/**
 * The purchasable hull a `?hull=` query names, or `null` for none.
 *
 * One reader for the flight's `PLAYER_HULL` and the chart workbench, so the
 * two cannot accept different sets (#554). What to fly on `null` is the
 * caller's: both fall back to the baseline and say so where they do.
 */
export const purchasableHullNamed = (asked: string | null): HullId | null =>
	asked !== null && (PURCHASABLE_HULL_IDS as readonly string[]).includes(asked)
		? (asked as HullId)
		: null;

/**
 * The roster, all twelve.
 *
 * **Twelve and not the seven**, although only seven are purchasable: the five
 * others are drawn. `patrol` joins #148's station traffic; `raider` and the
 * capital hulls remain available to #8's encounters. A `Partial` record would
 * make every consumer answer for a hull with no mass, and the hole would be
 * found by whichever one forgot. Their figures are provisional in the sense
 * that #8's combat balance may retune them — and a retune of `integrity` moves
 * what a kill of that hull pays, which `kill-credit.ts` reads; the seven
 * civilian rows are this node's answer.
 */
export const HULL_SPECS: Readonly<Record<HullId, HullSpec>> = {
	courier: {
		role: "player-baseline",
		variant: "a",
		env: { lengthKm: 0.0575, beamKm: 0.0513, heightKm: 0.0117 },
		massT: 60,
		thrustMN: 120,
		holdT: 20,
		hardpoints: 1,
		integrity: 100,
		tankLy: 7,
		chargeAu: 12,
		priceCr: 35_000,
	},
	interceptor: {
		role: "fast",
		variant: "a",
		env: { lengthKm: 0.0624, beamKm: 0.0253, heightKm: 0.0252 },
		massT: 55,
		thrustMN: 154,
		holdT: 8,
		hardpoints: 2,
		integrity: 95,
		tankLy: 5,
		chargeAu: 10,
		priceCr: 20_000,
	},
	freighter: {
		role: "cargo",
		variant: "b",
		env: { lengthKm: 0.0697, beamKm: 0.0463, heightKm: 0.0197 },
		massT: 140,
		thrustMN: 168,
		// Three times the reference, which is the case #26's D6 names by number:
		// a 60 t hold leans three times as hard on a market that remembers it.
		holdT: 60,
		hardpoints: 1,
		integrity: 166,
		tankLy: 7,
		chargeAu: 12,
		priceCr: 68_400,
	},
	miner: {
		role: "industrial",
		variant: "b",
		env: { lengthKm: 0.0782, beamKm: 0.0519, heightKm: 0.0332 },
		massT: 215,
		thrustMN: 215,
		holdT: 40,
		hardpoints: 1,
		integrity: 215,
		tankLy: 6,
		chargeAu: 10,
		priceCr: 53_400,
	},
	patrol: {
		role: "security",
		variant: "a",
		env: { lengthKm: 0.0586, beamKm: 0.0385, heightKm: 0.011 },
		massT: 46,
		// Under the interceptor's 2.800 km/s², deliberately: **the `fast` role
		// accelerates hardest**, and a police hull that out-accelerated it would
		// make #8's pursuit unwinnable by design rather than by skill.
		//
		// It still *turns* tighter, and that is not a contradiction: agility is
		// `acceleration / length`, so a hull 6% shorter out-turns one with 2% more
		// thrust-to-mass. The two are different questions, and `security` gets the
		// one its short hull earns.
		thrustMN: 126,
		holdT: 6,
		hardpoints: 2,
		integrity: 85,
		tankLy: 6,
		chargeAu: 12,
		priceCr: 16_800,
	},
	explorer: {
		role: "survey",
		variant: "a",
		env: { lengthKm: 0.0738, beamKm: 0.0385, heightKm: 0.0397 },
		massT: 165,
		thrustMN: 248,
		holdT: 30,
		hardpoints: 1,
		integrity: 183,
		// The one purchasable hull with more range than the baseline, which is
		// what a survey hull is for — see `tankLy` above.
		tankLy: 9,
		chargeAu: 16,
		priceCr: 44_800,
	},
	raider: {
		role: "outlaw",
		variant: "a",
		env: { lengthKm: 0.0635, beamKm: 0.0344, heightKm: 0.0109 },
		massT: 42,
		thrustMN: 113,
		holdT: 10,
		hardpoints: 2,
		integrity: 81,
		tankLy: 6,
		chargeAu: 10,
		priceCr: 22_900,
	},
	carrier: {
		role: "capital",
		variant: "a",
		env: { lengthKm: 0.3797, beamKm: 0.1764, heightKm: 0.145 },
		massT: 14000,
		thrustMN: 8400,
		holdT: 400,
		hardpoints: 6,
		integrity: 2635,
		tankLy: 12,
		chargeAu: 30,
		priceCr: null,
	},
	tug: {
		role: "salvage",
		variant: "a",
		env: { lengthKm: 0.0585, beamKm: 0.0457, heightKm: 0.0257 },
		massT: 120,
		thrustMN: 168,
		holdT: 24,
		hardpoints: 1,
		integrity: 152,
		tankLy: 6,
		chargeAu: 10,
		priceCr: 39_100,
	},
	prospector: {
		role: "prospect",
		variant: "a",
		env: { lengthKm: 0.0665, beamKm: 0.0253, heightKm: 0.0192 },
		massT: 58,
		thrustMN: 110,
		holdT: 12,
		hardpoints: 1,
		integrity: 98,
		tankLy: 6,
		chargeAu: 12,
		priceCr: 25_600,
	},
	dreadnought: {
		role: "battle-line",
		variant: "a",
		env: { lengthKm: 0.4066, beamKm: 0.1331, heightKm: 0.1111 },
		massT: 12000,
		thrustMN: 8400,
		holdT: 200,
		hardpoints: 8,
		integrity: 2402,
		tankLy: 12,
		chargeAu: 30,
		priceCr: null,
	},
	// **#331, the third capital: an expedition hull after 2001's Discovery One.**
	// A capital by the principal's ruling (2026-09-14), with the film's
	// proportions rather than ones compressed into a berth — so it is refused by
	// its **length**, which no berth admits, and not by its section, which a
	// slot would pass (`tests/aperture-fit.test.ts` states both halves). Its
	// hold is above the ceiling for the capitals' reason, and its declared
	// tank and drive charge are the largest in the roster, which is what an
	// expedition hull is for.
	voyager: {
		role: "expedition",
		variant: "a",
		env: { lengthKm: 0.191, beamKm: 0.0295, heightKm: 0.0301 },
		// 2.24 t per 1,000 m³ of its box: a spine and a sphere enclose little of
		// the box they span, so the density sits high in the band.
		massT: 380,
		// 0.5 km/s², under the carrier's 0.6: an expedition hull is not a warship.
		thrustMN: 190,
		holdT: 240,
		hardpoints: 1,
		integrity: 303,
		tankLy: 16,
		chargeAu: 40,
		priceCr: null,
	},
};

/** The hull the player flies until a shipyard sells another: #26's ratified
 *  `player-baseline`, read off the roster rather than restated as a constant in
 *  the renderer, which is where it lived. */
export const PLAYER_BASELINE_HULL: HullId = "courier";

/** The classes that dock at nothing (#56, and `voyager` since #331), named
 *  rather than detected by size so a hull that grows into capital proportions
 *  fails a check instead of joining the exemption. */
export const CAPITAL_HULL_IDS = [
	"carrier",
	"dreadnought",
	"voyager",
] as const satisfies readonly HullId[];

/** Membership in the capital classes, as a predicate. The cast is here once
 *  rather than at each caller: `CAPITAL_HULL_IDS` is a narrow readonly tuple, so
 *  every `includes` against a general `HullId` needs the same widening. */
export const isCapital = (id: HullId): boolean =>
	(CAPITAL_HULL_IDS as readonly HullId[]).includes(id);

/** Every hull that is meant to fit through an aperture — the complement of the
 *  capitals, and the set `tests/aperture-fit.test.ts` and the docking sweep
 *  both run over. */
export const DOCKABLE_HULL_IDS: readonly HullId[] = HULL_IDS.filter(
	(id) => !isCapital(id),
);
