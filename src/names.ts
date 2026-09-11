/**
 * System names and planet descriptions — Ian Bell's data, ported.
 *
 * ## Provenance
 *
 * The digram table and the "goat soup" description grammar below are **copied
 * data, not just copied technique**. Both come from Ian Bell's `txtelite.c`
 * v1.4, the author's own published reference implementation of Elite's
 * generator; the goat-soup tables are themselves adapted in that file from
 * Christian Pinder's reverse-engineered sources. Recorded in
 * `docs/reuse-manifest.md`, per the galaxy spec §4.5 — the one thing that must
 * not happen is this appearing in a source file unattributed.
 *
 * Mirror the port was read from (Bell's own domain 404'd at fetch time):
 * <https://github.com/richcarl/txtelite> (`txtelite-1.4.c`), lines 140–144 for
 * the digrams and 805–916 for the grammar.
 *
 * ## Why copied rather than rewritten
 *
 * The 32-entry digram table is tuned so that *any* sequence of pairs is
 * pronounceable — that tuning is the entire value, it is invisible in the data,
 * and it is exactly what a hand-rolled replacement loses. The same holds for
 * the grammar: its charm is in the word lists, not in the recursion.
 *
 * ## What is seelite's, and what is Bell's
 *
 * Bell's: the tables, the recursion, the 5-way option pick at the 0x33/0x66/
 * 0x99/0xCC thresholds, the `.`-stripping, the trailing-vowel rule in the
 * `<name>ian` form.
 *
 * Ours: where the randomness comes from. `txtelite` drives all of this from the
 * 48-bit chain seed being advanced in place; we pass in a stream drawn from the
 * system's own `NAME` / `DESC` domain (`galaxy.ts`), because the chain is the
 * one thing the hash-per-system substrate exists to be rid of.
 */

/**
 * Bell's `pairs0` — the digrams the *random name* token (0xB2) indexes into.
 *
 * In C this is a 24-character array immediately followed in memory by `pairs`,
 * and the grammar reads `pairs0[rnd & 0x3e]` — indices up to 62, which run off
 * the end of `pairs0` and into `pairs`. Bell's comment on the declaration says
 * so outright: "must continue into ..". So the table the token actually reads is
 * the concatenation, and joining them here is the port of that adjacency, not a
 * liberty taken with it.
 */
const PAIRS0 = "ABOUSEITILETSTONLONUTHNO";

/**
 * Bell's `pairs` — 32 digrams, the table system names are built from.
 *
 * `.` entries are null characters and are stripped on emit, which is how names
 * come out 2–8 letters long rather than a fixed 6 or 8.
 */
const PAIRS =
	"..LEXEGEZACEBISO" +
	"USESARMAINDIREA." +
	"ERATENBERALAVETI" +
	"EDORQUANTEISRION";

/** What the 0xB2 random-name token indexes — see `PAIRS0`. */
const RANDOM_NAME_TABLE = PAIRS0 + PAIRS;

/** An integer in `[0, 256)` from a stream, which is the width Bell's grammar
 *  thresholds are written against. */
const randByte = (rand: () => number): number => Math.floor(rand() * 256);

/**
 * A system name, from four (or three) digrams.
 *
 * The seeded bit deciding 3-vs-4 pairs is drawn first, so that adding a draw to
 * the name generator later moves the pair draws rather than silently changing
 * which systems have short names.
 *
 * **The redraw loop is ours, and it closes a hole in the spec.** §4.5 describes
 * the emit rule and §9.6 requires every name to be 2–8 characters, and those two
 * do not quite agree: the table contains `..` (emits nothing) and `A.` (emits
 * one character), so three unlucky draws produce an empty name.
 *
 * The rate, enumerated rather than estimated. Each pair contributes 0 characters
 * (`..`, 1 way), 1 character (`A.`, 1 way) or 2 (the other 30), and the guard
 * fires on `length < 2` — so a short name is *any* combination summing under
 * two, not only the all-`..` one:
 *
 * ```
 * 3 pairs: 4 / 32³   = 1.221e-4     (one all-`..`, three with a single `A.`)
 * 4 pairs: 5 / 32⁴   = 4.768e-6
 * overall: ½·both    = 6.342e-5     → 0.130 expected per 2048-system world
 *                                   → 12.2% of worlds carry at least one
 * ```
 *
 * **This paragraph has been wrong twice**, in both directions: first ~6% from
 * `2048·(1/32)³` (ignoring that 4-pair names are near-immune), then ~3% (fixing
 * that and dropping the `A.` paths, which are 3× the all-`..` term). The
 * enumeration is now in `tests/galaxy.test.ts`, computed by the same recurrence
 * and compared against a measured sample — so the next reader gets a checked
 * number instead of a third plausible one.
 */
export function systemName(rand: () => number): string {
	const pairCount = rand() < 0.5 ? 3 : 4;
	let name = "";
	const appendPair = () => {
		const i = 2 * Math.floor(rand() * 32);
		if (PAIRS[i] !== ".") name += PAIRS[i];
		if (PAIRS[i + 1] !== ".") name += PAIRS[i + 1];
	};
	for (let i = 0; i < pairCount; i++) appendPair();
	// Bounded so this is a function rather than a gamble. The cap is unreachable
	// in practice — an iteration fails to end the loop only on `..` (always) or
	// `A.` (when the name is still empty), so its worst-case exit chance is
	// 30/32 — and exists so that a future table edit cannot turn this into a
	// hang.
	for (let guard = 0; name.length < 2 && guard < 16; guard++) appendPair();
	return name.length >= 2 ? name : "AB";
}

/**
 * The longest name `systemName` can return, and the shortest.
 *
 * **Derived from the draw rather than measured off a galaxy.** A name is 3 or 4
 * pairs, each contributing at most two characters, so four pairs of two is the
 * ceiling; the guard loop below runs only while the name is still under two
 * characters, so it can never extend a name that already has its pairs. §9.6 of
 * `galaxy-generation.md` states the same 2-8 band from the other direction.
 *
 * It is exported because a *presentation* tier needs it: `hud-and-scanner.md`
 * §5.1 lays an instrument out against its widest reachable reading, and a cell
 * carrying a system name has no such reading without this. `tests/course-cue.test.ts`
 * sweeps every system in all eight galaxies against it, and asserts the ceiling
 * is actually reached — a bound nothing touches is a bound nobody checked.
 */
export const SYSTEM_NAME_MAX_CHARS = 8;
export const SYSTEM_NAME_MIN_CHARS = 2;

/**
 * Bell's `desc_list`, indices 0x81–0xA4.
 *
 * Entry *i* here is token `0x81 + i`. The escape codes inside the strings are
 * recursive references to other entries (0x81–0xA4) or to the three name tokens
 * (0xB0 planet name, 0xB1 `<name>ian`, 0xB2 random name).
 */
const DESC_LIST: readonly (readonly string[])[] = [
	/* 81 */ ["fabled", "notable", "well known", "famous", "noted"],
	/* 82 */ ["very", "mildly", "most", "reasonably", ""],
	/* 83 */ ["ancient", "\x95", "great", "vast", "pink"],
	/* 84 */ [
		"\x9E \x9D plantations",
		"mountains",
		"\x9C",
		"\x94 forests",
		"oceans",
	],
	/* 85 */ [
		"shyness",
		"silliness",
		"mating traditions",
		"loathing of \x86",
		"love for \x86",
	],
	/* 86 */ ["food blenders", "tourists", "poetry", "discos", "\x8E"],
	/* 87 */ ["talking tree", "crab", "bat", "lobst", "\xB2"],
	/* 88 */ ["beset", "plagued", "ravaged", "cursed", "scourged"],
	/* 89 */ [
		"\x96 civil war",
		"\x9B \x98 \x99s",
		"a \x9B disease",
		"\x96 earthquakes",
		"\x96 solar activity",
	],
	/* 8A */ [
		"its \x83 \x84",
		"the \xB1 \x98 \x99",
		"its inhabitants' \x9A \x85",
		"\xA1",
		"its \x8D \x8E",
	],
	/* 8B */ ["juice", "brandy", "water", "brew", "gargle blasters"],
	/* 8C */ ["\xB2", "\xB1 \x99", "\xB1 \xB2", "\xB1 \x9B", "\x9B \xB2"],
	/* 8D */ ["fabulous", "exotic", "hoopy", "unusual", "exciting"],
	/* 8E */ ["cuisine", "night life", "casinos", "sit coms", " \xA1 "],
	/* 8F */ [
		"\xB0",
		"The planet \xB0",
		"The world \xB0",
		"This planet",
		"This world",
	],
	/* 90 */ ["n unremarkable", " boring", " dull", " tedious", " revolting"],
	/* 91 */ ["planet", "world", "place", "little planet", "dump"],
	/* 92 */ ["wasp", "moth", "grub", "ant", "\xB2"],
	/* 93 */ ["poet", "arts graduate", "yak", "snail", "slug"],
	/* 94 */ ["tropical", "dense", "rain", "impenetrable", "exuberant"],
	/* 95 */ ["funny", "wierd", "unusual", "strange", "peculiar"],
	/* 96 */ ["frequent", "occasional", "unpredictable", "dreadful", "deadly"],
	/* 97 */ [
		"\x82 \x81 for \x8A",
		"\x82 \x81 for \x8A and \x8A",
		"\x88 by \x89",
		"\x82 \x81 for \x8A but \x88 by \x89",
		"a\x90 \x91",
	],
	/* 98 */ ["\x9B", "mountain", "edible", "tree", "spotted"],
	/* 99 */ ["\x9F", "\xA0", "\x87oid", "\x93", "\x92"],
	/* 9A */ ["ancient", "exceptional", "eccentric", "ingrained", "\x95"],
	/* 9B */ ["killer", "deadly", "evil", "lethal", "vicious"],
	/* 9C */ [
		"parking meters",
		"dust clouds",
		"ice bergs",
		"rock formations",
		"volcanoes",
	],
	/* 9D */ ["plant", "tulip", "banana", "corn", "\xB2weed"],
	/* 9E */ ["\xB2", "\xB1 \xB2", "\xB1 \x9B", "inhabitant", "\xB1 \xB2"],
	/* 9F */ ["shrew", "beast", "bison", "snake", "wolf"],
	/* A0 */ ["leopard", "cat", "monkey", "goat", "fish"],
	/* A1 */ [
		"\x8C \x8B",
		"\xB1 \x9F \xA2",
		"its \x8D \xA0 \xA2",
		"\xA3 \xA4",
		"\x8C \x8B",
	],
	/* A2 */ ["meat", "cutlet", "steak", "burgers", "soup"],
	/* A3 */ ["ice", "mud", "Zero-G", "vacuum", "\xB1 ultra"],
	/* A4 */ ["hockey", "cricket", "karate", "polo", "tennis"],
];

/** The sentence every planet description expands from — `txtelite.c`'s
 *  `"\x8F is \x97."`, unchanged. */
const DESC_ROOT = "\x8F is \x97.";

/** `Lave` from `LAVE`. The generator emits upper case; prose wants a name. */
const titled = (name: string): string => name[0] + name.slice(1).toLowerCase();

/**
 * `Lavian` from `LAVE` — Bell's adjectival form, trailing vowel dropped.
 *
 * The rule is exactly his: every character after the first is lowercased and
 * kept, *except* a final `E` or `I`, which is dropped before `ian` is appended.
 */
function ianForm(name: string): string {
	let out = name[0];
	for (let i = 1; i < name.length; i++) {
		const last = i === name.length - 1;
		if (!last || (name[i] !== "E" && name[i] !== "I"))
			out += name[i].toLowerCase();
	}
	return `${out}ian`;
}

/** The 0xB2 token: a throwaway name built from the digrams, 1–4 pairs. */
function randomName(rand: () => number): string {
	let out = "";
	const len = randByte(rand) & 3;
	for (let i = 0; i <= len; i++) {
		const x = randByte(rand) & 0x3e;
		if (RANDOM_NAME_TABLE[x] !== ".") out += RANDOM_NAME_TABLE[x];
		if (i && RANDOM_NAME_TABLE[x + 1] !== ".") out += RANDOM_NAME_TABLE[x + 1];
	}
	return out;
}

/**
 * Expand one grammar string. Recursive, exactly as `goat_soup` is.
 *
 * The draw order matters and is Bell's: the option index is drawn *before*
 * descending into the option, so a change to the tables shifts the text and a
 * change to the traversal shifts every description in the galaxy.
 */
function expand(source: string, name: string, rand: () => number): string {
	let out = "";
	for (let i = 0; i < source.length; i++) {
		const c = source.charCodeAt(i);
		if (c < 0x80) {
			out += source[i];
		} else if (c <= 0xa4) {
			const rnd = randByte(rand);
			const pick =
				Number(rnd >= 0x33) +
				Number(rnd >= 0x66) +
				Number(rnd >= 0x99) +
				Number(rnd >= 0xcc);
			out += expand(DESC_LIST[c - 0x81][pick], name, rand);
		} else if (c === 0xb0) {
			out += titled(name);
		} else if (c === 0xb1) {
			out += ianForm(name);
		} else if (c === 0xb2) {
			out += randomName(rand);
		}
		// No `default` branch. `txtelite` prints `<bad char in data>` and bails;
		// here the tables are the only source of these codes and they are frozen,
		// so an unknown code is a typo in this file rather than a runtime case.
	}
	return out;
}

/** One planet description, from the system's `DESC` stream. */
export function planetDescription(name: string, rand: () => number): string {
	return expand(DESC_ROOT, name, rand);
}
