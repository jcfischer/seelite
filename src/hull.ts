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
 * length, beam and height per hull for three meshes that differ by up to 2.2x in
 * beam and 4x in height, and nothing compared them with any of the three. It
 * matched none: measured, the declaration **understated** height by up to 40%
 * (the courier declared 14 m against its `c` variant's 23.5) and **overstated**
 * it by up to 2x (the raider declared 22 m against its `a` variant's 10.8).
 *
 * The understatement is the direction that mattered, because `berthFits` reads
 * this box and `BERTH_CELL` had been sized from the declaration: against the
 * meshes, `miner/a` and `miner/c` are 40.0 m and 47.5 m tall to a 40 m cell and
 * fit no berth in the game at all. `tests/hull.test.ts` rebuilds each selected
 * variant's mesh and compares.
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
	| "battle-line";

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
	 * Mass is set from the selected variant's box volume against a role density:
	 * a freighter is dense for its size because cargo structure is (2.20 t per
	 * 1,000 m³), an interceptor light because it is mostly engine (1.38). The
	 * density is a **band and not a table** — a table would be a third declared
	 * number pretending to be a derivation — and `tests/hull.test.ts` states it
	 * as 1.2 to 2.4, which is what a later editor re-deriving a mass after the
	 * envelopes move has to work with. Thrust is then solved for the acceleration
	 * the role should feel, and `sim.ts` divides one by the other. The courier's pair reproduces #5's tuned 2.0 km/s² exactly, so the
	 * baseline hull flies today's ship and the whole roster hangs off it.
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
	 *  `100 × (massT / 60) ^ 0.6`, rounded. #8's prototype owns retuning any row. */
	readonly integrity: number;
	/** Hyperspace tank, light years, and cruise drive charge, AU. The courier's
	 *  are the game's `JUMP_RANGE_LY` and `CHARGE_CAPACITY_AU`; `tests/hull.test.ts`
	 *  asserts that, which is what stops the two copies drifting. Nothing reads
	 *  the other rows yet — the router and the chart take a jump range as a
	 *  parameter but are handed the constant. */
	readonly tankLy: number;
	readonly chargeAu: number;
}

/**
 * The seven civilian hulls a shipyard sells (#26's D3).
 *
 * `patrol` and `raider` read as NPC identities rather than purchases — selling
 * a police hull or a pirate hull makes #8's legal status and #13's fence
 * geography owe rules they do not have — and are gated behind the rating node.
 * The two capitals do not dock at all (#56).
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
 * The roster, all eleven.
 *
 * **Eleven and not the seven**, although only seven are purchasable: the four
 * others are drawn, and `patrol` and `raider` will be flown by #8's traffic. A
 * `Partial` record would make every consumer answer for a hull with no mass,
 * and the hole would be found by whichever one forgot. Their figures are
 * provisional in the sense that #183's rating and #8's combat balance may retune
 * them; the seven civilian rows are this node's answer.
 */
export const HULL_SPECS: Record<HullId, HullSpec> = {
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
		// The one hull with more range than the baseline, which is what a survey
		// hull is for. Nothing reads it yet — see `tankLy` above.
		tankLy: 9,
		chargeAu: 16,
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
	},
};

/** The hull the player flies until a shipyard sells another: #26's ratified
 *  `player-baseline`, read off the roster rather than restated as a constant in
 *  the renderer, which is where it lived. */
export const PLAYER_BASELINE_HULL: HullId = "courier";

/** The two classes that dock at nothing (#56), named rather than detected by
 *  size so a hull that grows into capital proportions fails a check instead of
 *  joining the exemption. */
export const CAPITAL_HULL_IDS = [
	"carrier",
	"dreadnought",
] as const satisfies readonly HullId[];

/** Every hull that is meant to fit through an aperture — the complement of the
 *  capitals, and the set `tests/aperture-fit.test.ts` and the docking sweep
 *  both run over. */
export const DOCKABLE_HULL_IDS: readonly HullId[] = HULL_IDS.filter(
	(id) => !(CAPITAL_HULL_IDS as readonly HullId[]).includes(id),
);
