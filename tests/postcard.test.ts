/**
 * The postcard's scene recipe ([#406](https://github.com/jcfischer/seelite/issues/406)).
 *
 * A postcard link carries a **recipe** in its fragment: enough to rebuild a
 * frozen view of one place at one moment, and nothing a Commander owns. This
 * file holds the recipe's arithmetic — the canonical spelling, the strict
 * parse, and the allowlist — because all three are decidable without a
 * browser, and `src/postcard.ts` is a leaf so they can be.
 *
 * What it cannot reach is the viewer: that a page opened on a recipe boots the
 * named place, writes nothing and advances nothing is a browser claim, and
 * `scripts/probe-postcard.mjs` reads it off a running page.
 */
import { describe, expect, test } from "bun:test";
import { GALAXY_COUNT, SYSTEMS_PER_GALAXY } from "../src/galaxy";
import {
	POSTCARD_FRAGMENT_PREFIX,
	POSTCARD_GALAXIES,
	POSTCARD_GENERATORS,
	POSTCARD_KEYS,
	POSTCARD_MAX_CHARS,
	POSTCARD_SCHEMA,
	POSTCARD_SYSTEMS,
	type PostcardRecipe,
	decodePostcard,
	encodePostcard,
	isPostcardFragment,
	POSTCARD_HEIGHT,
	POSTCARD_WIDTH,
	postcardCaption,
	postcardFileName,
	postcardRecipe,
	postcardRefusalText,
} from "../src/postcard";
import {
	LEGACY_WORLD_GENERATOR_VERSIONS,
	WORLD_GENERATOR_VERSION,
} from "../src/world-state";

/** A scene as the game would hand it over: float noise and all. */
const scene = {
	seed: 47,
	galaxy: 0,
	system: 12,
	timeS: 1234.5678901234,
	pos: [149_597_870.123456789, -2_345.00012, 8_765_432.1] as const,
	orientation: [0.1, -0.2, 0.3, 0.9273618495495703] as const,
	mode: "cockpit" as const,
	head: "forward" as const,
};

const canonical = () => encodePostcard(postcardRecipe(scene));

/** The payload of a fragment, with one `name=value` pair replaced. */
function withPair(name: string, value: string): string {
	return canonical()
		.split("&")
		.map((pair) => (pair.startsWith(`${name}=`) ? `${name}=${value}` : pair))
		.join("&");
}

function refused(fragment: string): string {
	const result = decodePostcard(fragment);
	if (result.ok) throw new Error(`accepted ${fragment}`);
	return result.reason;
}

describe("the recipe's constants agree with the modules that own them", () => {
	test("the galaxy's shape", () => {
		expect(POSTCARD_GALAXIES).toBe(GALAXY_COUNT);
		expect(POSTCARD_SYSTEMS).toBe(SYSTEMS_PER_GALAXY);
	});

	test("the generators a recipe may name are the ones a save may", () => {
		// The current one first: that is the one a new recipe is written with.
		expect(POSTCARD_GENERATORS).toEqual([
			WORLD_GENERATOR_VERSION,
			...LEGACY_WORLD_GENERATOR_VERSIONS,
		]);
	});
});

describe("canonical serialization", () => {
	test("the spelling is pinned", () => {
		expect(canonical()).toBe(
			`postcard=${POSTCARD_SCHEMA}&gen=${WORLD_GENERATOR_VERSION}` +
				"&seed=47&galaxy=0&system=12&t=1234.56789" +
				"&pos=149597870.1235,-2345.0001,8765432.1" +
				"&q=0.1,-0.2,0.3,0.9273618&mode=cockpit&head=forward",
		);
	});

	test("noise below the quantum does not change the string", () => {
		const nudged = postcardRecipe({
			...scene,
			timeS: scene.timeS + 1e-9,
			pos: [scene.pos[0] + 1e-7, scene.pos[1], scene.pos[2] - 1e-7],
		});
		expect(encodePostcard(nudged)).toBe(canonical());
	});

	test("the order a scene's fields arrive in does not change the string", () => {
		const reversed = Object.fromEntries(
			Object.entries(scene).reverse(),
		) as unknown as typeof scene;
		expect(encodePostcard(postcardRecipe(reversed))).toBe(canonical());
	});

	test("a negative zero is spelled as zero", () => {
		const recipe = postcardRecipe({ ...scene, pos: [-0, -0.00001, 0] });
		expect(encodePostcard(recipe)).toContain("&pos=0,0,0&");
	});
});

describe("round trip", () => {
	for (const pose of [
		{ mode: "clear", head: "left" },
		{ mode: "cockpit", head: "right" },
		{ mode: "exterior", yawRad: -0.785398 },
	] as const) {
		test(`${pose.mode}: parse(encode(r)) is r, and encode(parse(s)) is s`, () => {
			const { mode: _m, head: _h, ...rest } = scene;
			const recipe = postcardRecipe({ ...rest, ...pose });
			const text = encodePostcard(recipe);
			const back = decodePostcard(text);
			expect(back).toEqual({ ok: true, recipe });
			if (back.ok) expect(encodePostcard(back.recipe)).toBe(text);
		});
	}

	test("a leading # and the prefix are both accepted", () => {
		expect(decodePostcard(`#${canonical()}`).ok).toBe(true);
		expect(isPostcardFragment(`#${canonical()}`)).toBe(true);
		expect(POSTCARD_FRAGMENT_PREFIX).toBe("#postcard=");
	});

	test("every legacy generator a save may name is accepted as written", () => {
		for (const gen of POSTCARD_GENERATORS) {
			const back = decodePostcard(withPair("gen", String(gen)));
			expect(back.ok && back.recipe.generator).toBe(gen);
		}
	});
});

describe("what is not a postcard fragment", () => {
	test("routing reads the prefix and nothing else", () => {
		expect(isPostcardFragment("")).toBe(false);
		expect(isPostcardFragment("#")).toBe(false);
		expect(isPostcardFragment("#about")).toBe(false);
		expect(isPostcardFragment("#postcards=1")).toBe(false);
		// A fragment that *claims* to be a postcard routes to the viewer, which
		// then refuses it: a broken link should say it is broken, not open the
		// public site as though nothing had been asked.
		expect(isPostcardFragment("#postcard=garbage")).toBe(true);
	});
});

describe("version rejection", () => {
	test("a schema this build does not read", () => {
		expect(refused(withPair("postcard", "2"))).toBe("unsupported-schema");
		expect(refused(withPair("postcard", "0"))).toBe("unsupported-schema");
	});

	test("a generator this build cannot rebuild the place from", () => {
		expect(refused(withPair("gen", "5"))).toBe("other-build");
		expect(refused(withPair("gen", String(WORLD_GENERATOR_VERSION + 1)))).toBe(
			"other-build",
		);
	});
});

describe("oversized input", () => {
	test("is refused before anything is parsed", () => {
		const long = `${canonical()}&${"x".repeat(POSTCARD_MAX_CHARS)}`;
		expect(refused(long)).toBe("too-long");
		// Even a string whose every other fault would name something else.
		expect(refused(`postcard=9${"%".repeat(POSTCARD_MAX_CHARS)}`)).toBe(
			"too-long",
		);
	});

	test("the ceiling is well above what a real recipe spells", () => {
		const widest = postcardRecipe({
			...scene,
			seed: 0xffff_ffff,
			galaxy: POSTCARD_GALAXIES - 1,
			system: POSTCARD_SYSTEMS - 1,
			timeS: 999_999_999.999999,
			pos: [-9_999_999_999.9999, -9_999_999_999.9999, -9_999_999_999.9999],
			orientation: [-0.5000001, -0.4999999, -0.5, -0.5],
			mode: "exterior",
			yawRad: -3.141592,
		});
		const text = encodePostcard(widest);
		expect(decodePostcard(text).ok).toBe(true);
		expect(text.length).toBeLessThan(POSTCARD_MAX_CHARS / 2);
	});
});

describe("malformed input", () => {
	const cases: [string, string][] = [
		["empty", ""],
		["only the prefix", "postcard="],
		["a missing pair", canonical().replace(/&galaxy=0/, "")],
		["an unknown pair", `${canonical()}&credits=100`],
		["a duplicated pair", `${canonical()}&seed=48`],
		["an empty segment", canonical().replace("&seed", "&&seed")],
		[
			"pairs out of order",
			canonical().replace("seed=47&galaxy=0", "galaxy=0&seed=47"),
		],
		["an exponent", withPair("seed", "4.7e1")],
		["a hex number", withPair("seed", "0x2f")],
		["a leading zero", withPair("seed", "047")],
		["a trailing zero", withPair("t", "1234.567890")],
		["a fractional seed", withPair("seed", "47.5")],
		["a negative seed", withPair("seed", "-47")],
		["a seed past uint32", withPair("seed", "4294967296")],
		["NaN", withPair("t", "NaN")],
		["Infinity", withPair("t", "Infinity")],
		["a negative time", withPair("t", "-1")],
		["a galaxy that does not exist", withPair("galaxy", "8")],
		["a system that does not exist", withPair("system", "256")],
		["two position components", withPair("pos", "1,2")],
		["a position past the ceiling", withPair("pos", "10000000000,0,0")],
		["a quaternion that is not a rotation", withPair("q", "0,0,0,2")],
		["a zero quaternion", withPair("q", "0,0,0,0")],
		["an unknown mode", withPair("mode", "selfie")],
		["exterior with a head", withPair("mode", "exterior")],
		["a head the cockpit has not got", withPair("head", "up")],
		["upper case", canonical().replace("mode=cockpit", "mode=Cockpit")],
		["percent-encoding", canonical().replace("mode=cockpit", "mode=cock%70it")],
		["whitespace", canonical().replace("&seed=47", "& seed=47")],
	];
	for (const [name, text] of cases) {
		test(`${name} is refused`, () => {
			const result = decodePostcard(text);
			expect(result.ok).toBe(false);
		});
	}

	test("a clear view with a yaw is refused", () => {
		const exterior = encodePostcard(
			postcardRecipe({
				...scene,
				mode: "exterior",
				yawRad: 0.5,
				head: undefined,
			}),
		);
		expect(refused(exterior.replace("mode=exterior", "mode=clear"))).toBe(
			"malformed",
		);
	});

	test("the decoder never throws, whatever it is handed", () => {
		const alphabet = "postcard=&,.-0123456789gensqmxyzt#";
		let state = 406;
		const next = () => {
			state = (state * 1_103_515_245 + 12_345) >>> 0;
			return state;
		};
		for (let i = 0; i < 2000; i++) {
			const length = next() % 120;
			let text = "";
			for (let j = 0; j < length; j++)
				text += alphabet[next() % alphabet.length];
			expect(() => decodePostcard(text)).not.toThrow();
		}
	});
});

describe("the allowlist", () => {
	/**
	 * A save-shaped object, fed where a scene is expected. `postcardRecipe`
	 * takes a structural type, so TypeScript would let a whole Commander
	 * through; the invariant is that the recipe *picks* rather than copies.
	 */
	const commander = {
		...scene,
		name: "JAMESON",
		credits: 918_273,
		cargo: { food: 17 },
		equipment: ["beam-laser"],
		hull: "freighter",
		discoveries: ["rama"],
		requests: [{ id: "req-1" }],
		journal: [{ kind: "strike" }],
		legalStatus: "fugitive",
		world: { seed: 47, deficits: {} },
	};

	test("the recipe's own keys are the allowlist and nothing else", () => {
		const recipe = postcardRecipe(commander) as unknown as Record<
			string,
			unknown
		>;
		expect(Object.keys(recipe).sort()).toEqual(
			[
				"schema",
				"generator",
				"seed",
				"galaxy",
				"system",
				"timeS",
				"pos",
				"orientation",
				"mode",
				"head",
			].sort(),
		);
	});

	test("no Commander field reaches the link", () => {
		const text = encodePostcard(postcardRecipe(commander));
		expect(text).toBe(canonical());
		for (const leak of [
			"JAMESON",
			"918273",
			"food",
			"beam",
			"freighter",
			"rama",
		])
			expect(text).not.toContain(leak);
	});

	test("the link's names are the declared set, in the declared order", () => {
		const names = canonical()
			.split("&")
			.map((pair) => pair.split("=")[0]);
		expect(names).toEqual(
			POSTCARD_KEYS.filter((key) => key !== "yaw") as unknown as string[],
		);
	});
});

/** A recipe the type admits must be one the parse admits. */
test("a hand-built recipe of the declared type round-trips", () => {
	const recipe: PostcardRecipe = {
		schema: POSTCARD_SCHEMA,
		generator: WORLD_GENERATOR_VERSION,
		seed: 1,
		galaxy: 3,
		system: 200,
		timeS: 0,
		pos: [0, 0, 0],
		orientation: [0, 0, 0, 1],
		mode: "clear",
		head: "forward",
	};
	expect(decodePostcard(encodePostcard(recipe))).toEqual({ ok: true, recipe });
});

describe("the caption", () => {
	const base = { system: "ANLEONOR", galaxy: 0, seed: 47 };

	test("a star, a planet and a moon carry their system already", () => {
		for (const place of ["ANLEONOR", "ANLEONOR II", "ANLEONOR IV a"])
			expect(postcardCaption({ ...base, place }).place).toBe(place);
	});

	test("a station is placed in its system", () => {
		expect(postcardCaption({ ...base, place: "INBIAGE" }).place).toBe(
			"INBIAGE · ANLEONOR",
		);
		// A station whose name merely begins with the system's letters is not
		// one of its bodies.
		expect(postcardCaption({ ...base, place: "ANLEONORIS" }).place).toBe(
			"ANLEONORIS · ANLEONOR",
		);
	});

	test("deep space is the system", () => {
		expect(postcardCaption({ ...base, place: null }).place).toBe("ANLEONOR");
	});

	test("the title and the inscription", () => {
		expect(postcardCaption({ ...base, place: null })).toMatchObject({
			title: "The Far Between",
			inscription: "GALAXY 1 · SEED 47",
		});
		expect(
			postcardCaption({ ...base, place: null, galaxy: 7 }).inscription,
		).toBe("GALAXY 8 · SEED 47");
	});

	test("the file name is a place and a seed", () => {
		const caption = postcardCaption({ ...base, place: "INBIAGE" });
		expect(postcardFileName(caption, 47)).toBe(
			"the-far-between-inbiage-anleonor-47.png",
		);
	});

	test("the card is 3:2", () => {
		expect(POSTCARD_WIDTH / POSTCARD_HEIGHT).toBe(3 / 2);
	});
});

describe("a refusal says what it kept", () => {
	const reasons = [
		"too-long",
		"malformed",
		"unsupported-schema",
		"other-build",
		"out-of-range",
		"not-canonical",
	] as const;
	for (const reason of reasons)
		test(`${reason}`, () => {
			const text = postcardRefusalText(reason);
			expect(text.title.length).toBeGreaterThan(0);
			expect(text.dek).toContain("nothing on this device was changed");
		});
});
