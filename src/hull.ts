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

/**
 * Where a hull's box is centred, kilometres, in the ship's body frame:
 * starboard (`cross(nose, up)`), dorsal (`up`) and forward (`nose`).
 *
 * `collision.md` §2.3 (P1) puts the box on the ship, and a selected mesh is not
 * built about its origin: the carrier's box sits 13.5 m above the ship's sim
 * position and the freighter's 3 m to starboard. A box centred on the origin
 * would leave that much hull outside it, so the box carries the offset
 * (§9.1.10). Measured off the selected variant's built mesh, as `env` is, and
 * rounded to the nearest 0.1 m; `tests/collision.test.ts` rebuilds every mesh
 * and holds the posed box around its vertices.
 */
export interface HullBoxCentre {
	rightKm: number;
	upKm: number;
	foreKm: number;
}

/**
 * The vent slots every hull is described in (`flight-model.md` §3.4.1).
 *
 * **One vocabulary across the roster**, so a binding (§3.5) or a health factor
 * (§3.7) names the same vent on every hull. A hull fills a slot or leaves it
 * empty; today every hull fills all of them.
 *
 * **Two families, by the principal's ruling on #619 (2026-10-02).** One
 * fore/aft pair cannot carry both of #5's figures: sized to remove drift at the
 * cap it turns the courier at ~97 rad/s², and sized to turn it at 3 it removes
 * drift ~30x slower than #5 does. So a *translation* pair (`strafe-*`, a short
 * arm either side of the centre of mass) does the strafing and the assist's
 * drift removal, and an *attitude* pair toward the extremities (`*-lateral`,
 * `*-vertical`, `*-roll`) makes the couples. Fired the same way a pair is pure
 * force and fired opposite it is a pure couple, in both families (§3.2).
 * Where on the hull each pair stands is `VentPlacement`'s (§3.2.1).
 */
export const VENT_SLOTS = [
	"main",
	"retro-port",
	"retro-starboard",
	"strafe-fore-port",
	"strafe-aft-port",
	"strafe-fore-starboard",
	"strafe-aft-starboard",
	"strafe-fore-dorsal",
	"strafe-aft-dorsal",
	"strafe-fore-ventral",
	"strafe-aft-ventral",
	"fore-port-lateral",
	"fore-starboard-lateral",
	"aft-port-lateral",
	"aft-starboard-lateral",
	"fore-dorsal-vertical",
	"fore-ventral-vertical",
	"aft-dorsal-vertical",
	"aft-ventral-vertical",
	"port-dorsal-roll",
	"port-ventral-roll",
	"starboard-dorsal-roll",
	"starboard-ventral-roll",
] as const;
export type VentSlot = (typeof VENT_SLOTS)[number];

/** Which share a slot draws: the main drive, the retro pair, the translation
 *  pairs, or the attitude pair for one axis. */
export type VentFamily = "main" | "retro" | "strafe" | "pitch" | "yaw" | "roll";

/**
 * One vent, in the **hull frame**: kilometres from the centre of the envelope,
 * which is taken as the centre of mass; `x` to starboard, `y` dorsal, `z` aft
 * (the mesh's nose is `-Z`, `ship-mesh.ts`). `dir` is the unit direction of the
 * force the vent puts on the hull, so its exhaust points the other way.
 */
export interface VentRow {
	readonly slot: VentSlot;
	readonly family: VentFamily;
	readonly posKm: readonly [number, number, number];
	readonly dir: readonly [number, number, number];
	/** Thrust as a share of the hull's `thrustMN` (§3.4). */
	readonly share: number;
}

/**
 * A hull's shares, one per family — the per-hull **shape** §3.4 adds to the one
 * magnitude dial `thrustMN`.
 *
 * Each is the thrust of **one** vent as a share of `thrustMN`. They are solved,
 * not chosen: `scripts/measure-vent-shares.ts` derives each row from #181's
 * handling law so that every hull flies exactly as it did before vents (the
 * principal's ruling on #619: no retune), prints them, and
 * `tests/vents.test.ts` holds every row to that law.
 */
export interface VentShares {
	readonly main: number;
	readonly retro: number;
	readonly strafe: number;
	readonly pitch: number;
	readonly yaw: number;
	readonly roll: number;
}

/**
 * Where a hull's vent pairs sit (#636, `flight-model.md` §3.2.1), as fractions
 * of the envelope's half-extents (`x` half-beam, `y` half-height, `z`
 * half-length).
 *
 * A pair may move in any direction that leaves it pure — a translation pair
 * force and no torque, an attitude pair a couple about its own axis alone — so
 * these are the only freedoms a pair has. A vent's place *along* its own line
 * of action changes nothing it does, so the table keeps it on the box face and
 * the display slides it to the metal (`vent-plumes.ts`).
 *
 * **Measured, not chosen.** `scripts/measure-vent-placement.ts` finds each row
 * on the selected variant's mesh so every line of action meets metal, and
 * `tests/vent-placement.test.ts` holds the stored row to it. A moved attitude
 * pair moves its arm, so the shares are solved against `coupleArms` rather
 * than against the envelope.
 */
export interface VentPlacement {
	/** The retro pair's lines, either side of the centreline: half-beam. */
	readonly retroX: number;
	/** The translation pairs, either side of the centre of mass: half-length. */
	readonly strafeZ: number;
	/** The yaw lines' height (half-height), and how far fore and aft their two
	 *  ends stand (half-length). */
	readonly yaw: {
		readonly y: number;
		readonly fore: number;
		readonly aft: number;
	};
	/** The pitch lines' offset to starboard (half-beam), and their two ends. */
	readonly pitch: {
		readonly x: number;
		readonly fore: number;
		readonly aft: number;
	};
	/** The roll lines' station fore and aft (half-length; aft positive), and
	 *  how far out to port and to starboard they stand (half-beam). */
	readonly roll: {
		readonly z: number;
		readonly port: number;
		readonly starboard: number;
	};
}

/** The envelope's own box: the placement every hull had before #636, the
 *  attitude pairs at the extremities and the translation pairs a quarter of
 *  the half-length either side of the centre of mass. What a measured arm is
 *  read against. */
export const BOX_PLACEMENT: VentPlacement = {
	retroX: 0.5,
	strafeZ: 0.25,
	yaw: { y: 0, fore: 1, aft: 1 },
	pitch: { x: 0, fore: 1, aft: 1 },
	roll: { z: 0, port: 1, starboard: 1 },
};

/** Each couple's arm, kilometres. */
export interface CoupleArms {
	readonly pitch: number;
	readonly yaw: number;
	readonly roll: number;
}

/** Each couple's arm, kilometres: the torque one attitude pair makes per unit
 *  thrust of one vent. What `scripts/measure-vent-shares.ts` solves against. */
export const coupleArms = (
	env: HullEnvelope,
	p: VentPlacement,
): CoupleArms => ({
	pitch: ((p.pitch.fore + p.pitch.aft) * env.lengthKm) / 2,
	yaw: ((p.yaw.fore + p.yaw.aft) * env.lengthKm) / 2,
	roll: ((p.roll.port + p.roll.starboard) * env.beamKm) / 2,
});

type Fractions = readonly [number, number, number];
type SlotGeometry = { family: VentFamily; at: Fractions; dir: Fractions };

/** The six pushes, by the axis and sense of the force on the hull. */
const PUSH = {
	fore: [0, 0, -1],
	aft: [0, 0, 1],
	starboard: [1, 0, 0],
	port: [-1, 0, 0],
	up: [0, 1, 0],
	down: [0, -1, 0],
} as const satisfies Record<string, Fractions>;

/** Where each slot sits under a placement, and which way it pushes. A vent's
 *  coordinate along its own push is the box face's; see `VentPlacement`. */
const slotGeometry = (
	p: VentPlacement,
): Readonly<Record<VentSlot, SlotGeometry>> => {
	const { retroX: r, strafeZ: s, yaw: w, pitch: h, roll: o } = p;
	const v = (family: VentFamily, at: Fractions, dir: Fractions) => ({
		family,
		at,
		dir,
	});
	const { fore, aft, starboard, port, up, down } = PUSH;
	return {
		main: v("main", [0, 0, 1], fore),
		"retro-port": v("retro", [-r, 0, -1], aft),
		"retro-starboard": v("retro", [r, 0, -1], aft),
		"strafe-fore-port": v("strafe", [-1, 0, -s], starboard),
		"strafe-aft-port": v("strafe", [-1, 0, s], starboard),
		"strafe-fore-starboard": v("strafe", [1, 0, -s], port),
		"strafe-aft-starboard": v("strafe", [1, 0, s], port),
		"strafe-fore-dorsal": v("strafe", [0, 1, -s], down),
		"strafe-aft-dorsal": v("strafe", [0, 1, s], down),
		"strafe-fore-ventral": v("strafe", [0, -1, -s], up),
		"strafe-aft-ventral": v("strafe", [0, -1, s], up),
		"fore-port-lateral": v("yaw", [-1, w.y, -w.fore], starboard),
		"fore-starboard-lateral": v("yaw", [1, w.y, -w.fore], port),
		"aft-port-lateral": v("yaw", [-1, w.y, w.aft], starboard),
		"aft-starboard-lateral": v("yaw", [1, w.y, w.aft], port),
		"fore-dorsal-vertical": v("pitch", [h.x, 1, -h.fore], down),
		"fore-ventral-vertical": v("pitch", [h.x, -1, -h.fore], up),
		"aft-dorsal-vertical": v("pitch", [h.x, 1, h.aft], down),
		"aft-ventral-vertical": v("pitch", [h.x, -1, h.aft], up),
		"port-dorsal-roll": v("roll", [-o.port, 0, o.z], down),
		"port-ventral-roll": v("roll", [-o.port, 0, o.z], up),
		"starboard-dorsal-roll": v("roll", [o.starboard, 0, o.z], down),
		"starboard-ventral-roll": v("roll", [o.starboard, 0, o.z], up),
	};
};

/** A hull's vent table, as plain data: its placement scaled to its envelope,
 *  each vent carrying its family's share. */
export const ventTable = (
	env: HullEnvelope,
	shares: VentShares,
	placement: VentPlacement,
): readonly VentRow[] => {
	const half = [env.beamKm / 2, env.heightKm / 2, env.lengthKm / 2] as const;
	const geometry = slotGeometry(placement);
	return VENT_SLOTS.map((slot) => {
		const { family, at, dir } = geometry[slot];
		return {
			slot,
			family,
			posKm: [at[0] * half[0], at[1] * half[1], at[2] * half[2]] as const,
			dir,
			share: shares[family],
		};
	});
};

export interface HullSpec {
	readonly role: HullRole;
	/**
	 * Which of the three meshes this hull *is*.
	 *
	 * #26's D2 reads the `a`/`b`/`c` meshes as design alternates — three attempts
	 * at one idea, ranked as equals by #35 — the way a station role has three
	 * forms and one is selected. Nothing selected until here, and a constant in
	 * `main.ts` was the only place a variant had ever been named.
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
	/** Where that box is centred in the ship's body frame (`HullBoxCentre`). */
	readonly envCentre: HullBoxCentre;
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
	/** The hull's vent shares (§3.4) — see `VentShares`. */
	readonly ventShares: VentShares;
	/** Where the hull's vent pairs sit (§3.2.1) — see `VentPlacement`. */
	readonly ventPlacement: VentPlacement;
	/** The hull's vent table, built from `env`, `ventShares` and
	 *  `ventPlacement` by `ventTable`: plain data, one row per filled slot (§3.3). */
	readonly vents: readonly VentRow[];
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
 * #383's price law: what a hull's **hold** is worth, capitalised, with §5.6's
 * spread live.
 *
 * `price(hold) = HULL_PRICE_BASELINE_CR x (hold / the baseline hold) ^ exponent`
 * up to `HULL_PRICE_KNEE_HOLD_T`, and the same figure at the knee carried on at
 * `HULL_PRICE_UPPER_EXPONENT` above it, rounded. The two exponents are the
 * fitted elasticities of the greedy trader's Cr/min on the hold, one fit per
 * segment; the baseline is the measured rate at the baseline hull's hold times
 * the measured time it takes to earn `fullKitCr()`. So a hull costs what its
 * hold earns back over one kit — #26's own two anchors, used as anchors.
 *
 * **`economy-trade.md` §7.1 owns the derivation, the figures and the caveats**,
 * and this docstring deliberately carries none of them: a measurement narrative
 * copied into three files diverges, and one copy of this one already did.
 * `scripts/measure-hull-pricing.ts` reprints every constant here beside what a
 * fresh run derives, which is the map's #118 rule.
 */
export interface HullPriceLaw {
	/** The baseline hull's price, credits — the law's anchor. */
	readonly baselineCr: number;
	/** The elasticity at and below the knee. */
	readonly exponent: number;
	/** Where the second segment starts, tonnes. `Infinity` is one power law. */
	readonly kneeHoldT: number;
	/** The elasticity above the knee. */
	readonly upperExponent: number;
}

/** The lower segment's elasticity. See `HullPriceLaw` for where it comes from. */
export const HULL_PRICE_EXPONENT = 1;

/** The baseline hull's price, credits. */
export const HULL_PRICE_BASELINE_CR = 23_000;

/** Where the curve bends, tonnes — placed at the freighter's hold, which was
 *  the largest hold the roster sold when #383 measured the bend there. It is a
 *  constant, not a rule: a rung sold above it later does not move it, and only
 *  a re-measured bend does. */
export const HULL_PRICE_KNEE_HOLD_T = 60;

/** The upper segment's elasticity, from the knee to past the ceiling. */
export const HULL_PRICE_UPPER_EXPONENT = 0.52;

/** Prices are quoted to the nearest hundred credits, like every other figure in
 *  `economy-trade.md` §7. Finer would be false precision against a fitted
 *  exponent; §7.1 there carries the fit's own standard error and the
 *  world-to-world spread, and this file deliberately does not restate either. */
export const HULL_PRICE_STEP_CR = 100;

/** The shipped law as one value, so the instrument can evaluate a variant of it
 *  through the same function rather than beside it. */
export const HULL_PRICE_LAW: HullPriceLaw = {
	baselineCr: HULL_PRICE_BASELINE_CR,
	exponent: HULL_PRICE_EXPONENT,
	kneeHoldT: HULL_PRICE_KNEE_HOLD_T,
	upperExponent: HULL_PRICE_UPPER_EXPONENT,
};

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
 * Any law of `HullPriceLaw`'s shape, and the ceiling check off.
 *
 * Exported for `measure-hull-pricing.ts`, which prints what the fits' own
 * uncertainty costs the ladder and what a fresh run would derive, by evaluating
 * a variant of the shipped law. Without it the instrument had the formula and
 * the rounding step written out a second time, and a step change would have
 * landed in the leaf while the printed band went on rounding the old way.
 */
export const priceUnderLaw = (holdT: number, law: HullPriceLaw): number => {
	requirePositiveHold(holdT);
	const ref = HULL_SPECS[PLAYER_BASELINE_HULL].holdT;
	const lowerAt = (h: number) => law.baselineCr * (h / ref) ** law.exponent;
	const raw =
		holdT <= law.kneeHoldT
			? lowerAt(holdT)
			: lowerAt(law.kneeHoldT) * (holdT / law.kneeHoldT) ** law.upperExponent;
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
	return priceUnderLaw(holdT, HULL_PRICE_LAW);
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
 * One reader for a fresh game's first hull (`bootHull` in `flown-hull.ts`)
 * and the chart workbench, so the two cannot accept different sets (#554).
 * What to fly on `null` is the caller's: both fall back to the baseline and
 * say so where they do.
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
const HULL_ROWS: Readonly<Record<HullId, Omit<HullSpec, "vents">>> = {
	courier: {
		role: "player-baseline",
		variant: "a",
		env: { lengthKm: 0.0575, beamKm: 0.0513, heightKm: 0.0117 },
		envCentre: { rightKm: 0, upKm: 0.001, foreKm: 0.0018 },
		massT: 60,
		thrustMN: 120,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00756069,
			yaw: 0.0129409,
			roll: 0.00676296,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: -0.05, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9825 },
			roll: { z: 0.325, port: 0.9975, starboard: 0.9975 },
		},
		holdT: 20,
		hardpoints: 1,
		integrity: 100,
		tankLy: 7,
		chargeAu: 12,
		priceCr: 23_000,
	},
	interceptor: {
		role: "fast",
		variant: "a",
		env: { lengthKm: 0.0624, beamKm: 0.0253, heightKm: 0.0252 },
		envCentre: { rightKm: 0, upKm: 0, foreKm: 0.0013 },
		massT: 55,
		thrustMN: 154,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00838067,
			yaw: 0.00839002,
			roll: 0.00593896,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
			roll: { z: 0.725, port: 0.9775, starboard: 0.9775 },
		},
		holdT: 8,
		hardpoints: 2,
		integrity: 95,
		tankLy: 5,
		chargeAu: 10,
		priceCr: 9_200,
	},
	freighter: {
		role: "cargo",
		variant: "b",
		// The authored O2 Porter's box (node #813). It is a third smaller by
		// volume than the procedural Porter it replaced, so the mass is
		// re-derived at the role's 2.20 t per 1,000 m³ and the thrust scaled
		// with it: the acceleration a freighter flies at is unchanged.
		env: { lengthKm: 0.0672, beamKm: 0.0424, heightKm: 0.0147 },
		envCentre: { rightKm: 0.0005, upKm: 0.0004, foreKm: -0.0016 },
		massT: 92,
		thrustMN: 110.4,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00755031,
			yaw: 0.010074,
			roll: 0.00513139,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: -0.2, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0.575, fore: 0.9975, aft: 0.9975 },
			roll: { z: -0.225, port: 0.9825, starboard: 0.9975 },
		},
		// Three times the reference, which is the case #26's D6 names by number:
		// a 60 t hold leans three times as hard on a market that remembers it.
		holdT: 60,
		hardpoints: 1,
		integrity: 129,
		tankLy: 7,
		chargeAu: 12,
		priceCr: 69_000,
	},
	miner: {
		role: "industrial",
		variant: "b",
		env: { lengthKm: 0.0782, beamKm: 0.0519, heightKm: 0.0332 },
		envCentre: { rightKm: 0, upKm: -0.0062, foreKm: -0.0017 },
		massT: 215,
		thrustMN: 215,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00850427,
			yaw: 0.0103794,
			roll: 0.00673907,
		},
		ventPlacement: {
			retroX: 0.4225,
			strafeZ: 0.22,
			yaw: { y: 0.125, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
			roll: { z: 0.75, port: 0.9975, starboard: 0.9975 },
		},
		holdT: 40,
		hardpoints: 1,
		integrity: 215,
		tankLy: 6,
		chargeAu: 10,
		priceCr: 46_000,
	},
	patrol: {
		role: "security",
		variant: "a",
		env: { lengthKm: 0.0586, beamKm: 0.0385, heightKm: 0.011 },
		envCentre: { rightKm: 0, upKm: 0.0009, foreKm: 0.0002 },
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
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00745941,
			yaw: 0.0103157,
			roll: 0.00519862,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: -0.025, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
			roll: { z: 0.625, port: 0.9825, starboard: 0.9825 },
		},
		holdT: 6,
		hardpoints: 2,
		integrity: 85,
		tankLy: 6,
		chargeAu: 12,
		priceCr: 6_900,
	},
	explorer: {
		role: "survey",
		variant: "a",
		env: { lengthKm: 0.0738, beamKm: 0.0385, heightKm: 0.0397 },
		envCentre: { rightKm: 0, upKm: 0.0008, foreKm: -0.0044 },
		massT: 165,
		thrustMN: 248,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00929064,
			yaw: 0.0091665,
			roll: 0.00777541,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
			roll: { z: -0.125, port: 0.995, starboard: 0.995 },
		},
		holdT: 30,
		hardpoints: 1,
		integrity: 183,
		// The one purchasable hull with more range than the baseline, which is
		// what a survey hull is for — see `tankLy` above.
		tankLy: 9,
		chargeAu: 16,
		priceCr: 34_500,
	},
	raider: {
		role: "outlaw",
		variant: "a",
		env: { lengthKm: 0.0635, beamKm: 0.0344, heightKm: 0.0109 },
		envCentre: { rightKm: 0, upKm: 0.0005, foreKm: 0.0027 },
		massT: 42,
		thrustMN: 113,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00741782,
			yaw: 0.00932014,
			roll: 0.00429537,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0.075, fore: 0.9975, aft: 0.9975 },
			roll: { z: 0.7, port: 0.9975, starboard: 0.9975 },
		},
		holdT: 10,
		hardpoints: 2,
		integrity: 81,
		tankLy: 6,
		chargeAu: 10,
		priceCr: 11_500,
	},
	carrier: {
		role: "capital",
		variant: "a",
		env: { lengthKm: 0.3797, beamKm: 0.1764, heightKm: 0.145 },
		envCentre: { rightKm: 0, upKm: 0.0135, foreKm: -0.0048 },
		massT: 14000,
		thrustMN: 8400,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00825631,
			yaw: 0.00876069,
			roll: 0.00568054,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: -0.05, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
			roll: { z: 0.775, port: 0.985, starboard: 0.985 },
		},
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
		envCentre: { rightKm: 0, upKm: 0, foreKm: -0.0005 },
		massT: 120,
		thrustMN: 168,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00859617,
			yaw: 0.0116028,
			roll: 0.00740908,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0, fore: 0.9975, aft: 0.9975 },
			pitch: { x: -0.425, fore: 0.9975, aft: 0.9975 },
			roll: { z: -0.225, port: 0.9975, starboard: 0.9975 },
		},
		holdT: 24,
		hardpoints: 1,
		integrity: 152,
		tankLy: 6,
		chargeAu: 10,
		priceCr: 27_600,
	},
	prospector: {
		role: "prospect",
		variant: "a",
		env: { lengthKm: 0.0665, beamKm: 0.0253, heightKm: 0.0192 },
		envCentre: { rightKm: 0, upKm: -0.0023, foreKm: 0.0013 },
		massT: 58,
		thrustMN: 110,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00810055,
			yaw: 0.00899218,
			roll: 0.00433099,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0.075, fore: 0.8325, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.925 },
			roll: { z: 0.5, port: 0.995, starboard: 0.995 },
		},
		holdT: 12,
		hardpoints: 1,
		integrity: 98,
		tankLy: 6,
		chargeAu: 12,
		priceCr: 13_800,
	},
	dreadnought: {
		role: "battle-line",
		variant: "a",
		env: { lengthKm: 0.4066, beamKm: 0.1331, heightKm: 0.1111 },
		envCentre: { rightKm: 0, upKm: 0.0091, foreKm: 0.0007 },
		massT: 12000,
		thrustMN: 8400,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00774348,
			yaw: 0.00797764,
			roll: 0.00406323,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0, fore: 0.9975, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
			roll: { z: 0.775, port: 0.9825, starboard: 0.9825 },
		},
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
		envCentre: { rightKm: 0, upKm: 0.002, foreKm: 0.002 },
		// 2.24 t per 1,000 m³ of its box: a spine and a sphere enclose little of
		// the box they span, so the density sits high in the band.
		massT: 380,
		// 0.5 km/s², under the carrier's 0.6: an expedition hull is not a warship.
		thrustMN: 190,
		ventShares: {
			main: 1,
			retro: 0.5,
			strafe: 0.416667,
			pitch: 0.00743102,
			yaw: 0.00740524,
			roll: 0.00227722,
		},
		ventPlacement: {
			retroX: 0.5,
			strafeZ: 0.25,
			yaw: { y: 0, fore: 0.99, aft: 0.9975 },
			pitch: { x: 0, fore: 0.9975, aft: 0.985 },
			roll: { z: 0.7, port: 0.995, starboard: 0.995 },
		},
		holdT: 240,
		hardpoints: 1,
		integrity: 303,
		tankLy: 16,
		chargeAu: 40,
		priceCr: null,
	},
};

/** The roster with each hull's vent table built from its envelope and
 *  shares: plain data by the time anything reads it (§3.3). */
export const HULL_SPECS: Readonly<Record<HullId, HullSpec>> =
	Object.fromEntries(
		HULL_IDS.map((id) => {
			const row = HULL_ROWS[id];
			return [
				id,
				{
					...row,
					vents: ventTable(row.env, row.ventShares, row.ventPlacement),
				},
			];
		}),
	) as Record<HullId, HullSpec>;

/** The hull a new game flies until a shipyard sells another: #26's ratified
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
