/**
 * Postcards from The Far Between: the scene recipe
 * ([#406](https://github.com/jcfischer/seelite/issues/406)).
 *
 * A postcard link carries a **recipe** in its URL fragment — which place, which
 * moment, where the eye stands and which way it looks — and a page opened on
 * one rebuilds that frozen view from the seeded baseline. It is not a save, a
 * replay, or a promise of the same pixels on another GPU or a later build.
 *
 * ## What a recipe may carry, and why the list is short
 *
 * The node's contract names the fields, and this module is where they are
 * enforced rather than described: schema and generator versions, seed, galaxy
 * and system, game time, viewpoint and orientation, and the composition mode.
 * **Nothing a Commander owns** — no name, credits, cargo, equipment, hull,
 * discoveries, requests or world journal. `postcardRecipe` *picks* those fields
 * off whatever it is handed rather than copying, because TypeScript's structural
 * typing would let a whole Commander through a parameter typed as a scene, and
 * `tests/postcard.test.ts` feeds it one to prove the link comes out the same.
 *
 * ## The spelling
 *
 * `postcard=2&gen=9&seed=47&galaxy=0&system=12&t=…&pos=x,y,z&q=x,y,z,w&mode=…`
 * then `head=…` for the two cockpit-eye modes or `yaw=…&elev=…` for the
 * exterior — the chase orbit's two angles (node #691, `chase-orbit.ts`). It is
 * readable on purpose: a person looking at a link can see that it carries a
 * place and a camera and nothing else. It rides the **fragment**, which the
 * browser never sends to a server, so the static host learns nothing either.
 *
 * **One recipe has one spelling.** Every number is quantised on the way in and
 * printed without trailing zeros or a negative zero, and the parse re-encodes
 * what it read and refuses any input that does not come back byte for byte. So
 * key order, `1.50`, `-0`, `047` and `4.7e1` are all refusals rather than
 * aliases, and `encode(parse(s)) === s` for every `s` the parse accepts, spelled
 * without the leading `#` a `location.hash` carries (the parse takes either).
 *
 * ## Compatible camera schemas
 *
 * Schema 1 spelled the exterior by its yaw alone, because the chase camera then
 * orbited only about the ship's up axis. Node #691 gave it an elevation, and
 * schema 2 is what carries it: `elev` is required on every schema-2 exterior,
 * zero included, so a reader can never mistake a level card for one whose
 * height was dropped.
 *
 * **A schema-1 link still opens, at its own framing.** Its exterior is level by
 * construction — there was no other kind — so it parses with an elevation of
 * zero, which is exactly the orbit it was taken at (`chase-orbit.ts` holds
 * that zero elevation is the old yaw-only rig). It keeps `schema: 1`, so it
 * re-encodes to its own bytes and the round-trip rule holds for it too; a
 * schema-1 link carrying `elev` is malformed, not a schema-2 one misnumbered.
 * `encodePostcard` refuses to write a schema-1 recipe with a non-zero
 * elevation rather than drop it.
 *
 * Newly composed cards without a distance multiplier use schema 2, introduced
 * by node #691 for elevation; this includes clear and cockpit compositions.
 * They do not preserve the schema-1 spelling written by the previous build.
 * A composition carrying zoom uses schema 3 and requires `zoom`, including an
 * explicit multiplier of one. Received schema-1 and schema-2 links keep their
 * framing. Encoding the decoded recipe preserves its original spelling;
 * composing a new link from the viewer uses this build's writing schema, so
 * a schema-1 exterior becomes schema 2 with `elev=0` and the same level view.
 * Compatibility is backward reading: a build that reads only schema 1 refuses
 * new schema-2 and schema-3 links, and a schema-2 reader refuses schema 3.
 *
 * ## Why this is a leaf
 *
 * `entry.ts` validates a fragment **before** it imports the game, because a
 * refused capsule must not boot a game or touch storage — and constructing a
 * `Game` already reads `localStorage`. So this module is in the entry chunk and
 * imports nothing: the galaxy's shape and the generator versions are restated
 * here and `tests/postcard.test.ts` asserts they agree with `galaxy.ts` and
 * `world-state.ts`, which is the repo's rule for one quantity named twice.
 */

/** The schema used to compose new cards without zoom. */
export const POSTCARD_SCHEMA = 2;
/** Newly composed zoomed exterior cards use schema 3. */
export const POSTCARD_ZOOM_SCHEMA = 3;
export const POSTCARD_ZOOM_MIN = 0.25;
export const POSTCARD_ZOOM_MAX = 8;

/** Every schema this build reads: the yaw-only one as well (see above). */
export const POSTCARD_READ_SCHEMAS: readonly number[] = [1, 2, 3];

/**
 * Generator versions whose scene layout this build can reproduce. Saves can
 * rebase persistent state onto the current generator, but a scene recipe asks
 * to rebuild its original view. Version 8 changed some planets and shipyard
 * placements, and version 9 put a raider outpost in every lawless system
 * (node #491) — a body the old view did not hold, and one that can push the
 * arrival point — so older links are refused rather than silently
 * reinterpreted. The test holds this version against `world-state.ts`'s
 * current version.
 */
export const POSTCARD_GENERATORS: readonly number[] = [9];

/** `GALAXY_COUNT` and `SYSTEMS_PER_GALAXY`, restated for the leaf's reason. */
export const POSTCARD_GALAXIES = 8;
export const POSTCARD_SYSTEMS = 256;

/** What `location.hash` starts with when it carries a recipe. */
export const POSTCARD_FRAGMENT_PREFIX = "#postcard=";

/**
 * The longest fragment the parse will look at. A real recipe spells well under
 * half of it; the test builds the widest one the ranges admit and checks.
 */
export const POSTCARD_MAX_CHARS = 512;

/** The link's names, in the one order they are written. */
export const POSTCARD_KEYS = [
	"postcard",
	"gen",
	"seed",
	"galaxy",
	"system",
	"t",
	"pos",
	"q",
	"mode",
	"head",
	"yaw",
	"elev",
	"zoom",
] as const;

export const POSTCARD_MODES = ["clear", "cockpit", "exterior"] as const;
export type PostcardMode = (typeof POSTCARD_MODES)[number];

/** `cockpit.ts`'s `HeadLook`, restated for the leaf's reason. */
export const POSTCARD_HEADS = ["forward", "left", "right"] as const;
export type PostcardHead = (typeof POSTCARD_HEADS)[number];

/** A game time past this is refused: about 31 years of unbroken play. */
const MAX_TIME_S = 1e9;
/** A position component past this, in km, is refused: about 67 AU. */
const MAX_POS_KM = 1e10;

/**
 * Decimal places kept, per field. Time to a microsecond, because a station
 * moves ~30 km/s and the eye beside it must not slide off its berth; position
 * to 10 cm; the quaternion to seven places, which moves a direction by well
 * under a pixel at the canonical size; the chase yaw and elevation to a
 * microradian.
 */
const PLACES = { t: 6, pos: 4, q: 7, yaw: 6, elev: 6, zoom: 6 } as const;

/**
 * The largest chase yaw a recipe spells. Not `Math.PI`: a wrapped yaw of π
 * quantises to 3.141593, which is past it, and the parse refused the exterior
 * card of a pilot looking straight back at the ship's nose (sage round 1).
 */
const YAW_LIMIT = 3.141593;

/**
 * The largest chase elevation a recipe spells: π/2 quantised, which rounds
 * *down* (1.5707963… to 1.570796), so a camera standing exactly at a pole —
 * where `chase-orbit.ts` clamps it — spells a link the parse accepts.
 */
const ELEV_LIMIT = 1.570796;

interface RecipeBase {
	schema: number;
	generator: number;
	seed: number;
	galaxy: number;
	system: number;
	/** Seconds since the new game began: `World.gameTime`. */
	timeS: number;
	/** The ship, in km, star-centred: `Ship.pos`. */
	pos: [number, number, number];
	/** The ship's orientation as `[x, y, z, w]`: `Game.orientation`. */
	orientation: [number, number, number, number];
}

/**
 * The composed view. `clear` and `cockpit` stand at the cockpit eye and differ
 * only in whether the cabin is drawn; `head` is which way it is turned.
 * `exterior` is the chase camera, orbited by `yawRad` about the ship's up
 * axis and raised by `elevationRad` above its horizontal plane — zero on a
 * schema-1 link, which could not carry one.
 */
export type PostcardRecipe = RecipeBase &
	(
		| { mode: "clear" | "cockpit"; head: PostcardHead }
		| {
				mode: "exterior";
				yawRad: number;
				elevationRad: number;
				zoomScale?: number;
		  }
	);

/** What the game hands over. Anything else on the object is ignored. */
export interface PostcardScene {
	seed: number;
	galaxy: number;
	system: number;
	timeS: number;
	pos: ArrayLike<number>;
	orientation: ArrayLike<number>;
	mode: PostcardMode;
	head?: PostcardHead;
	yawRad?: number;
	elevationRad?: number;
	zoomScale?: number;
}

export type PostcardRefusal =
	| "too-long"
	| "malformed"
	| "unsupported-schema"
	| "other-build"
	| "out-of-range"
	| "not-canonical";

export type PostcardParse =
	| { ok: true; recipe: PostcardRecipe }
	| { ok: false; reason: PostcardRefusal };

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** How far from one a link's quaternion norm may be: the parse's tolerance. */
const UNIT_TOLERANCE = 1e-5;

/** Whether a link's quaternion is a rotation: the parse's test, and the one
 *  `postcardRecipe` asks before it divides. */
const isRotation = (q: readonly number[]): boolean =>
	Math.abs(Math.hypot(...q) - 1) <= UNIT_TOLERANCE;

const quantise = (x: number, places: number): number => {
	const scale = 10 ** places;
	const q = Math.round(x * scale) / scale;
	return q === 0 ? 0 : q;
};

/** The one printed form of a quantised number. */
const spell = (x: number, places: number): string => {
	const fixed = quantise(x, places).toFixed(places);
	const trimmed = fixed.includes(".")
		? fixed.replace(/0+$/, "").replace(/\.$/, "")
		: fixed;
	return trimmed === "-0" ? "0" : trimmed;
};

const INTEGER = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

const integer = (text: string): number | null =>
	INTEGER.test(text) && text.length <= 10 ? Number(text) : null;

const decimal = (text: string): number | null =>
	DECIMAL.test(text) && text.length <= 24 ? Number(text) : null;

const decimals = (text: string, count: number): number[] | null => {
	const parts = text.split(",");
	if (parts.length !== count) return null;
	const values = parts.map(decimal);
	return values.every((v) => v !== null) ? (values as number[]) : null;
};

// ---------------------------------------------------------------------------
// Scene → recipe → text
// ---------------------------------------------------------------------------

const wrapAngle = (rad: number): number =>
	Math.atan2(Math.sin(rad), Math.cos(rad));

/**
 * A yaw the parse would accept is kept as it stands and only one past it is
 * wrapped. Wrapping every yaw turned a link's accepted `yaw=3.141593` — a hair
 * past π — into `-3.141592` on rebuild, so a current link of a pilot looking
 * straight back at the nose spelled back a different fragment (sage round 6).
 */
const canonicalYaw = (rad: number): number =>
	Math.abs(rad) <= YAW_LIMIT ? rad : wrapAngle(rad);

/**
 * A recipe from a scene: the allowlisted fields picked, and every number
 * quantised to what the link will carry, so a recipe and its parse are equal.
 */
export function postcardRecipe(scene: PostcardScene): PostcardRecipe {
	const [qx, qy, qz, qw] = [0, 1, 2, 3].map((i) => scene.orientation[i]);
	// **Divided only when the parse would refuse it undivided.** A quaternion
	// read back off a link is quantised, so its norm is off one by up to ~2e-7;
	// a division that moved each component by that fraction crossed a quantum's
	// half step for about one orientation in three hundred, and the viewer then
	// spelled back a link one digit away from the one it was opened on (node
	// #691's probe found it; `tests/postcard.test.ts` sweeps it). So the
	// components are quantised as they stand, and kept whenever the result is
	// one `decodePostcard` accepts — the same test on the same numbers — which
	// makes every accepted link's quaternion its own rebuild, out to the
	// tolerance's edge (sage round 2 found `0.999991` normalised to `1` by a
	// tighter slack).
	const asTaken = [qx, qy, qz, qw].map((c) => quantise(c, PLACES.q));
	const norm = isRotation(asTaken) ? 1 : Math.hypot(qx, qy, qz, qw) || 1;
	const base: RecipeBase = {
		schema: POSTCARD_SCHEMA,
		generator: POSTCARD_GENERATORS[0],
		seed: scene.seed >>> 0,
		galaxy: scene.galaxy,
		system: scene.system,
		timeS: quantise(scene.timeS, PLACES.t),
		pos: [0, 1, 2].map((i) => quantise(scene.pos[i], PLACES.pos)) as [
			number,
			number,
			number,
		],
		orientation: [qx, qy, qz, qw].map((c) => quantise(c / norm, PLACES.q)) as [
			number,
			number,
			number,
			number,
		],
	};
	if (scene.mode === "exterior")
		return {
			...base,
			...(scene.zoomScale !== undefined
				? {
						schema: POSTCARD_ZOOM_SCHEMA,
						zoomScale: quantise(scene.zoomScale, PLACES.zoom),
					}
				: {}),
			mode: "exterior",
			yawRad: quantise(canonicalYaw(scene.yawRad ?? 0), PLACES.yaw),
			elevationRad: quantise(scene.elevationRad ?? 0, PLACES.elev),
		};
	return { ...base, mode: scene.mode, head: scene.head ?? "forward" };
}

/** A recipe's one spelling, without the leading `#`. */
export function encodePostcard(recipe: PostcardRecipe): string {
	if (recipe.schema >= POSTCARD_ZOOM_SCHEMA && recipe.mode !== "exterior")
		throw new Error("postcard: zoom schema requires an exterior composition");
	const pairs: [string, string][] = [
		["postcard", String(recipe.schema)],
		["gen", String(recipe.generator)],
		["seed", String(recipe.seed)],
		["galaxy", String(recipe.galaxy)],
		["system", String(recipe.system)],
		["t", spell(recipe.timeS, PLACES.t)],
		["pos", recipe.pos.map((c) => spell(c, PLACES.pos)).join(",")],
		["q", recipe.orientation.map((c) => spell(c, PLACES.q)).join(",")],
		["mode", recipe.mode],
	];
	if (recipe.mode === "exterior") {
		pairs.push(["yaw", spell(recipe.yawRad, PLACES.yaw)]);
		if (recipe.schema >= 2)
			pairs.push(["elev", spell(recipe.elevationRad, PLACES.elev)]);
		else if (recipe.elevationRad !== 0)
			// Never a link that quietly flattens the camera it was asked for.
			throw new Error("postcard: a schema-1 recipe cannot carry an elevation");
		if (recipe.schema >= POSTCARD_ZOOM_SCHEMA)
			pairs.push(["zoom", spell(recipe.zoomScale ?? 1, PLACES.zoom)]);
		else if ((recipe.zoomScale ?? 1) !== 1)
			throw new Error("postcard: this schema cannot carry zoom");
	} else pairs.push(["head", recipe.head]);
	return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

// ---------------------------------------------------------------------------
// Text → recipe
// ---------------------------------------------------------------------------

/** Whether a `location.hash` claims to carry a recipe. The parse decides if it does. */
export function isPostcardFragment(hash: string): boolean {
	return hash.startsWith(POSTCARD_FRAGMENT_PREFIX);
}

const ALPHABET = /^[a-z0-9.,=&-]*$/;

/**
 * The recipe a fragment carries, or why it carries none. Never throws.
 *
 * The length is checked before anything else is looked at, the schema before
 * the rest of the key set (a later schema may name other keys), and the
 * canonical spelling last, by re-encoding what was read.
 */
export function decodePostcard(fragment: string): PostcardParse {
	const text = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	if (text.length > POSTCARD_MAX_CHARS)
		return { ok: false, reason: "too-long" };
	const malformed: PostcardParse = { ok: false, reason: "malformed" };
	if (text === "" || !ALPHABET.test(text)) return malformed;

	const fields = new Map<string, string>();
	for (const segment of text.split("&")) {
		const [name, value, ...rest] = segment.split("=");
		if (rest.length > 0 || !name || !value || fields.has(name))
			return malformed;
		fields.set(name, value);
	}

	const schema = integer(fields.get("postcard") ?? "");
	if (schema === null || [...fields.keys()][0] !== "postcard") return malformed;
	if (!POSTCARD_READ_SCHEMAS.includes(schema))
		return { ok: false, reason: "unsupported-schema" };
	const generator = integer(fields.get("gen") ?? "");
	if (generator === null) return malformed;
	if (!POSTCARD_GENERATORS.includes(generator))
		return { ok: false, reason: "other-build" };

	const mode = fields.get("mode");
	if (!(POSTCARD_MODES as readonly string[]).includes(mode ?? ""))
		return malformed;
	const exterior = mode === "exterior";
	if (schema >= POSTCARD_ZOOM_SCHEMA && !exterior) return malformed;
	// A schema-1 exterior is yaw alone; schema 2 adds the elevation.
	const expected = POSTCARD_KEYS.filter((key) =>
		exterior
			? key !== "head" &&
				(key !== "elev" || schema >= 2) &&
				(key !== "zoom" || schema >= POSTCARD_ZOOM_SCHEMA)
			: key !== "yaw" && key !== "elev" && key !== "zoom",
	);
	if (
		fields.size !== expected.length ||
		!expected.every((key) => fields.has(key))
	)
		return malformed;

	const seed = integer(fields.get("seed") as string);
	const galaxy = integer(fields.get("galaxy") as string);
	const system = integer(fields.get("system") as string);
	const timeS = decimal(fields.get("t") as string);
	const pos = decimals(fields.get("pos") as string, 3);
	const q = decimals(fields.get("q") as string, 4);
	if (
		seed === null ||
		galaxy === null ||
		system === null ||
		timeS === null ||
		pos === null ||
		q === null
	)
		return malformed;

	const outOfRange: PostcardParse = { ok: false, reason: "out-of-range" };
	if (seed > 0xffff_ffff || galaxy >= POSTCARD_GALAXIES) return outOfRange;
	if (system >= POSTCARD_SYSTEMS) return outOfRange;
	if (!(timeS >= 0 && timeS < MAX_TIME_S)) return outOfRange;
	if (!pos.every((c) => Math.abs(c) < MAX_POS_KM)) return outOfRange;
	if (!isRotation(q)) return outOfRange;

	const base: RecipeBase = {
		schema,
		generator,
		seed,
		galaxy,
		system,
		timeS,
		pos: pos as [number, number, number],
		orientation: q as [number, number, number, number],
	};
	let recipe: PostcardRecipe;
	if (exterior) {
		const yawRad = decimal(fields.get("yaw") as string);
		if (yawRad === null) return malformed;
		if (!(Math.abs(yawRad) <= YAW_LIMIT)) return outOfRange;
		let elevationRad = 0;
		if (schema >= 2) {
			const elev = decimal(fields.get("elev") as string);
			if (elev === null) return malformed;
			if (!(Math.abs(elev) <= ELEV_LIMIT)) return outOfRange;
			elevationRad = elev;
		}
		recipe = { ...base, mode: "exterior", yawRad, elevationRad };
		if (schema >= POSTCARD_ZOOM_SCHEMA) {
			const zoom = decimal(fields.get("zoom") as string);
			if (zoom === null) return malformed;
			if (zoom < POSTCARD_ZOOM_MIN || zoom > POSTCARD_ZOOM_MAX)
				return outOfRange;
			recipe.zoomScale = zoom;
		}
	} else {
		const head = fields.get("head") as string;
		if (!(POSTCARD_HEADS as readonly string[]).includes(head)) return malformed;
		recipe = {
			...base,
			mode: mode as "clear" | "cockpit",
			head: head as PostcardHead,
		};
	}

	if (encodePostcard(recipe) !== text)
		return { ok: false, reason: "not-canonical" };
	return { ok: true, recipe };
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * The canonical card: 3:2, the printed postcard's ratio (the principal's
 * choice on #406). Every export is drawn at this size whatever the window is,
 * because the field of view is vertical and the aspect decides what it covers.
 */
export const POSTCARD_WIDTH = 1800;
export const POSTCARD_HEIGHT = 1200;

/** The name on every card. */
export const POSTCARD_TITLE = "The Far Between";

export interface PostcardCaption {
	title: string;
	/** The generated place: the nearest named body, placed in its system. */
	place: string;
	/** The understated line: which galaxy, which seed. */
	inscription: string;
}

/**
 * What a card says. A planet's or a moon's generated name already carries its
 * system's (`ANLEONOR II a`), and the star is named for it, so those stand
 * alone; a station's name does not (`INBIAGE`), so it is placed in its system.
 * Galaxies are counted from one on the card, as a pilot counts them.
 */
export function postcardCaption(input: {
	place: string | null;
	system: string;
	galaxy: number;
	seed: number;
}): PostcardCaption {
	const { place, system } = input;
	const named =
		place === null || place === system || place.startsWith(`${system} `)
			? (place ?? system)
			: `${place} · ${system}`;
	return {
		title: POSTCARD_TITLE,
		place: named,
		inscription: `GALAXY ${input.galaxy + 1} · SEED ${input.seed >>> 0}`,
	};
}

/** The card's file name: a place and a seed, and nothing a Commander owns. */
export function postcardFileName(
	caption: PostcardCaption,
	seed: number,
): string {
	const slug = caption.place
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `the-far-between-${slug || "deep-space"}-${seed >>> 0}.png`;
}

/**
 * What a refused link says: which of three things went wrong, and nothing
 * more. It said what the refusal had *not* done to the device, too, until the
 * principal cut that sentence from the viewer and from here — the promise is
 * held by `probe-postcard.mjs`, not by the page telling a reader about it.
 */
export function postcardRefusalText(reason: PostcardRefusal): {
	title: string;
	dek: string;
} {
	switch (reason) {
		case "unsupported-schema":
			return {
				title: "This postcard was written by another edition of the game.",
				dek: "Its link is in a form this build does not read.",
			};
		case "other-build":
			return {
				title: "This postcard is from another build of the universe.",
				dek: "The place it shows was generated by a different version of the game, so it cannot be rebuilt here.",
			};
		default:
			return {
				title: "This postcard did not survive the journey.",
				dek: "Its link is damaged or incomplete, so there is no scene to rebuild.",
			};
	}
}

/** The camera half of a scene: the composition, and the head or the orbit. */
export type PostcardPose = Pick<
	PostcardScene,
	"mode" | "head" | "yawRad" | "elevationRad" | "zoomScale"
>;

/** The camera half of a recipe: what `Game.capturePostcardFrame` is posed by. */
export function postcardPose(recipe: PostcardRecipe): PostcardPose {
	return recipe.mode === "exterior"
		? {
				mode: recipe.mode,
				yawRad: recipe.yawRad,
				elevationRad: recipe.elevationRad,
				...(recipe.zoomScale !== undefined
					? { zoomScale: recipe.zoomScale }
					: {}),
			}
		: { mode: recipe.mode, head: recipe.head };
}
