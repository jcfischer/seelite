/**
 * The world seed, split into one stream per system.
 *
 * Vendored from seekolous (`src/rng.ts`, its #159) and diverging: the
 * generator, the avalanche step and the derivation are copied unchanged, the
 * stream table is seelite's own.
 *
 * ## Why streams and not one generator
 *
 * A seed that reaches exactly one consumer pins one thing and leaves the rest
 * of the world unseeded — which is how "seed 42" becomes two different galaxies
 * on two runs.
 *
 * The obvious fix — one seeded generator shared by everybody — trades a loud
 * problem for a quiet one. A shared stream couples every system to every other
 * system's *draw count*: add one jitter to the star-field scatter and every
 * subsequent draw everywhere shifts, so market prices move, pirate spawns move,
 * and every recorded expectation in the probe suite rots for a reason nobody
 * can see in the diff.
 *
 * So each system gets its own stream, derived from the world seed by a distinct
 * offset. A stream only moves when its own system changes.
 *
 * ## What this does *not* buy
 *
 * A seeded stream is necessary for a reproducible session and nowhere near
 * sufficient. A simulation that integrates over a frame delta taken from wall
 * time is not reproducible however well-seeded it is: reproducibility means the
 * same seed **and** the same sequence of `dt` **and** the same clock, which a
 * probe can have and the live game cannot. Nothing in this repo has a
 * frame-stepped simulation yet; when one arrives, that is the point at which
 * seekolous's `scripts/lib/deterministic-clock.mjs` is worth vendoring too.
 */

/**
 * The LCG seekolous uses — `noise.ts` shuffles its permutation table with
 * exactly this recurrence. Numerical Recipes' constants; not cryptographic,
 * not meant to be, and the point is that two runs agree rather than that an
 * observer cannot predict it.
 */
export function seededRand(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

/**
 * One offset per system that draws.
 *
 * Arbitrary constants, but **not** interchangeable ones: two systems sharing a
 * value share a stream, which is the coupling this whole file exists to avoid.
 * `tests/rng.test.ts` asserts they are pairwise distinct so a copy-pasted entry
 * fails a test rather than being found six months later.
 *
 * The names are seelite's decisions-not-yet-made made concrete only as far as
 * the scaffold needs them. Adding a stream is cheap and safe — a new offset
 * perturbs no existing one, which is the property being bought. Renaming or
 * removing one is not: it changes what every existing seed produces.
 */
export const STREAMS = {
	/** Where the systems sit on the galaxy map, and what they are called. */
	galaxy: 0x9e3779b9,
	/** One system's contents: star, planets, station placement. */
	system: 0x51eec0,
	/** Commodity prices and station stock. */
	market: 0x1d0f5e2b,
	/** Who is flying out there: traders, pirates, police, and their loadouts. */
	traffic: 0x7a3c19d7,
	/** Combat rolls — scatter, damage variance, wreckage. */
	combat: 0x2f6b8c41,
	/** The background: star-field point scatter and nebula/skybox inputs. */
	backdrop: 0x4e91d3a5,
} as const;

export type StreamName = keyof typeof STREAMS;

/**
 * Murmur3's 32-bit finalizer — an avalanche step, not a generator.
 *
 * It exists here because XOR alone does **not** separate streams, and
 * seekolous's first version of this file claimed it did.
 *
 * The problem is the **first draw** specifically. This LCG's first output is
 * `(s * 1664525 + 1013904223) / 2^32`, so two seeds one apart give first draws
 * differing by `1664525 / 2^32` ≈ 3.9e-4: seeds 1000 and 1001 open with
 * 0.623620 and 0.624008. Their *second* draws diverge properly, so this is not
 * a weak generator — it is a bad neighbourhood, and the first draw of a stream
 * is the load-bearing one.
 *
 * `worldSeed ^ offset` does not keep two streams out of that neighbourhood.
 * XOR-distance is not arithmetic distance: for the right world seed, two
 * offsets that differ wildly in their high bits still land on states a few
 * apart. Measured over seekolous's table, sweeping 300000 world seeds and all
 * fifteen stream pairs, the closest opening was **9.7e-6**.
 *
 * Avalanching the derived seed removes the structure: the same sweep gives
 * 9.3e-9, and it is coincidence rather than a pattern — two streams are close
 * only as often as two random numbers are.
 */
function avalanche(x: number): number {
	let h = x >>> 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** The stream a system draws from in this world. */
export function streamFor(worldSeed: number, system: StreamName): () => number {
	return seededRand(seedFor(worldSeed, system));
}

/**
 * The same derivation, as a **number** rather than a generator.
 *
 * For the consumers that seed themselves: `SimplexNoise` takes a seed and
 * builds its own LCG inside. Without this they would need a naked
 * `seed ^ 0x51eec0` at the call site — which is where all of these used to live
 * in seekolous, and where two of them can quietly become the same constant
 * without anything noticing. Two doors, one table.
 */
export function seedFor(worldSeed: number, system: StreamName): number {
	return avalanche((worldSeed >>> 0) ^ STREAMS[system]);
}

/**
 * Hash two integers into a third — the same avalanche, taking a second term.
 *
 * The other way to derive a seed, and the one a per-system generator will want:
 * where `seedFor` splits the world seed by *system*, this splits a system's
 * seed by *identity*, so a thing's seed is a function of which thing it is
 * rather than of when it was drawn. A star system generated from
 * `mix(seedFor(world, "system"), systemId)` does not move when a neighbouring
 * system gains a planet.
 *
 * `seedFor(s, k)` is exactly `avalanche(s ^ STREAMS[k])`, and this is
 * `avalanche(a ^ b·golden)`: one primitive, two entry points.
 */
export function mix(a: number, b: number): number {
	return avalanche((a ^ Math.imul(b, 0x9e3779b9)) >>> 0);
}

/**
 * FNV-1a, 32-bit — the hash every text-keyed draw and the save's integrity
 * field are built from. A hash, not a checksum with any cryptographic claim:
 * what it has to do is change when its input does.
 *
 * **It is here rather than in the save model that first used it, and the reason
 * is a cycle.** `world-state.ts` exported it and `station-traffic.ts` carried a
 * private copy; meanwhile a naming or standing module that seeds from a carrier
 * key needs it, and the model imports the roster module — which composes
 * carrier identity — so importing the hash back from the model closes a cycle
 * through it. A leaf has no such edge. Both former homes read this one now, and
 * `tests/carrier-name.test.ts` pins the values so a change to the hash is a
 * deliberate act rather than an edit that quietly re-names every carrier.
 */
export const fnv1a = (text: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
};
