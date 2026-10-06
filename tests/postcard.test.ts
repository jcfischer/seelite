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
	POSTCARD_READ_SCHEMAS,
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
	postcardPose,
	postcardRecipe,
	postcardRefusalText,
} from "../src/postcard";
import { clampElevation, clampZoom } from "../src/chase-orbit";
import { gameMethods } from "./lib/game-methods";
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

	test("a recipe may name only the current visual generator", () => {
		expect(POSTCARD_GENERATORS).toEqual([WORLD_GENERATOR_VERSION]);
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
		{ mode: "exterior", yawRad: -0.785398, elevationRad: 0 },
		{ mode: "exterior", yawRad: 2.5, elevationRad: -0.61 },
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

	test("legacy scene recipes are refused when their geometry has changed", () => {
		for (const gen of LEGACY_WORLD_GENERATOR_VERSIONS)
			expect(decodePostcard(withPair("gen", String(gen))).ok).toBe(false);
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
		expect(POSTCARD_READ_SCHEMAS).toEqual([1, POSTCARD_SCHEMA, 3]);
		expect(refused(withPair("postcard", "4"))).toBe("unsupported-schema");
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
			elevationRad: -1.570796,
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
			POSTCARD_KEYS.filter(
				(key) => key !== "yaw" && key !== "elev" && key !== "zoom",
			) as unknown as string[],
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

describe("a refusal says what went wrong", () => {
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
			expect(text.dek.length).toBeGreaterThan(0);
			// The principal cut the device sentence from the viewer and the
			// refusal alike; the promise is the probe's to hold, not the page's.
			expect(`${text.title} ${text.dek}`).not.toMatch(/device/i);
		});

	test("the three families read differently", () => {
		const said = new Set(
			(["malformed", "unsupported-schema", "other-build"] as const).map(
				(reason) => postcardRefusalText(reason).title,
			),
		);
		expect(said.size).toBe(3);
	});
});

describe("the chase yaw at its ends (sage round 1)", () => {
	for (const yawRad of [Math.PI, -Math.PI, 3 * Math.PI])
		test(`a yaw of ${yawRad.toFixed(4)} spells a link the parse accepts`, () => {
			const recipe = postcardRecipe({ ...scene, mode: "exterior", yawRad });
			const back = decodePostcard(encodePostcard(recipe));
			expect(back).toEqual({ ok: true, recipe });
		});

	// The viewer rebuilds a card from `postcardPose` of the parsed recipe; an
	// accepted end yaw must spell back as itself (sage round 6 found
	// `yaw=3.141593` wrapped to `-3.141592`).
	for (const end of ["3.141593", "-3.141593"])
		test(`an accepted yaw of ${end} rebuilds to the same link`, () => {
			const text = encodePostcard(
				postcardRecipe({ ...scene, mode: "exterior", yawRad: 0.5 }),
			).replace("yaw=0.5", `yaw=${end}`);
			const back = decodePostcard(text);
			if (!back.ok) throw new Error(`refused ${end}`);
			expect(
				encodePostcard(
					postcardRecipe({ ...scene, ...postcardPose(back.recipe) }),
				),
			).toBe(text);
		});

	// The viewer's own chain, not the recipe's: the link's pose stood on the
	// shipped `composePostcard` and read back by the shipped `postcardScene`,
	// at both yaw ends and both poles, spells the link it was opened on.
	test("the viewer's compose-then-scene chain spells an end-pose link back", () => {
		const proto = gameMethods(
			["composePostcard", "postcardScene", "chaseYaw", "chaseElevation"],
			{ clampElevation, clampZoom },
		);
		for (const yaw of ["3.141593", "-3.141593"])
			for (const elev of ["1.570796", "-1.570796", "0.3"]) {
				const text = encodePostcard(
					postcardRecipe({ ...scene, mode: "exterior", yawRad: 0.5 }),
				)
					.replace("yaw=0.5", `yaw=${yaw}`)
					.replace("elev=0", `elev=${elev}`);
				const back = decodePostcard(text);
				if (!back.ok) throw new Error(`refused ${yaw}, ${elev}`);
				const r = back.recipe;
				const g = Object.assign(Object.create(proto), {
					view: "cockpit",
					headLook: "forward",
					chaseOrbit: { yawRad: 0, elevationRad: 0 },
					orientation: {
						x: r.orientation[0],
						y: r.orientation[1],
						z: r.orientation[2],
						w: r.orientation[3],
					},
					world: {
						seed: r.seed,
						gameTime: r.timeS,
						ship: { pos: { x: r.pos[0], y: r.pos[1], z: r.pos[2] } },
						system: { record: { galaxy: r.galaxy, index: r.system } },
					},
				});
				g.composePostcard(postcardPose(r));
				expect({
					yaw,
					elev,
					text: encodePostcard(postcardRecipe(g.postcardScene("exterior"))),
				}).toEqual({ yaw, elev, text });
			}
	});

	test("past the quantised end is still refused", () => {
		const exterior = encodePostcard(
			postcardRecipe({ ...scene, mode: "exterior", yawRad: 0 }),
		);
		expect(refused(exterior.replace("yaw=0", "yaw=3.141594"))).toBe(
			"out-of-range",
		);
	});
});

test("a recipe's pose is its camera half", () => {
	expect(
		postcardPose(postcardRecipe({ ...scene, mode: "clear", head: "left" })),
	).toEqual({
		mode: "clear",
		head: "left",
	});
	expect(
		postcardPose(postcardRecipe({ ...scene, mode: "exterior", yawRad: 0.5 })),
	).toEqual({ mode: "exterior", yawRad: 0.5, elevationRad: 0 });
	expect(
		postcardPose(
			postcardRecipe({
				...scene,
				mode: "exterior",
				yawRad: -2.9,
				elevationRad: 1.2,
			}),
		),
	).toEqual({ mode: "exterior", yawRad: -2.9, elevationRad: 1.2 });
});

describe("the full exterior pose (node #691)", () => {
	const exterior = (yawRad: number, elevationRad: number) =>
		encodePostcard(
			postcardRecipe({
				...scene,
				head: undefined,
				mode: "exterior",
				yawRad,
				elevationRad,
			}),
		);
	/** A link as a build before node #691 wrote it: schema 1, yaw alone. */
	const LEGACY =
		`postcard=1&gen=${WORLD_GENERATOR_VERSION}&seed=47&galaxy=0&system=12` +
		"&t=1234.56789&pos=149597870.1235,-2345.0001,8765432.1" +
		"&q=0.1,-0.2,0.3,0.9273618&mode=exterior&yaw=0.7";

	test("an exterior spells its yaw and its elevation, the elevation always", () => {
		expect(exterior(0.7, -0.4)).toMatch(/&mode=exterior&yaw=0\.7&elev=-0\.4$/);
		// Level is written, not left out: a missing height is never a level one.
		expect(exterior(0.7, 0)).toMatch(/&yaw=0\.7&elev=0$/);
		expect(exterior(0, 0)).toMatch(/^postcard=2&/);
	});

	test("a pose off the level survives the parse, and the parse its spelling", () => {
		for (const [yaw, elev] of [
			[2.4, 1.1],
			[-0.3, -1.4],
			[Math.PI, Math.PI / 2],
			[-Math.PI, -Math.PI / 2],
		]) {
			const text = exterior(yaw, elev);
			const back = decodePostcard(text);
			expect(back.ok).toBe(true);
			if (!back.ok || back.recipe.mode !== "exterior") continue;
			expect(back.recipe.elevationRad).toBeCloseTo(elev, 6);
			expect(encodePostcard(back.recipe)).toBe(text);
			expect(postcardPose(back.recipe).elevationRad).toBe(
				back.recipe.elevationRad,
			);
		}
	});

	test("a schema-1 link keeps its framing: level, and its own bytes back", () => {
		const back = decodePostcard(LEGACY);
		expect(back).toEqual({
			ok: true,
			recipe: {
				schema: 1,
				generator: WORLD_GENERATOR_VERSION,
				seed: 47,
				galaxy: 0,
				system: 12,
				timeS: 1234.56789,
				pos: [149597870.1235, -2345.0001, 8765432.1],
				orientation: [0.1, -0.2, 0.3, 0.9273618],
				mode: "exterior",
				yawRad: 0.7,
				elevationRad: 0,
			},
		});
		if (back.ok) expect(encodePostcard(back.recipe)).toBe(LEGACY);
	});

	test("a schema-1 cockpit link still opens, and still spells itself", () => {
		const legacy = withPair("postcard", "1");
		const back = decodePostcard(legacy);
		expect(back.ok).toBe(true);
		if (back.ok) expect(encodePostcard(back.recipe)).toBe(legacy);
	});

	test("an elevation in the wrong schema or the wrong mode is malformed", () => {
		// Schema 1 could not carry one; schema 2 must.
		expect(refused(`${LEGACY}&elev=0.3`)).toBe("malformed");
		expect(refused(LEGACY.replace("postcard=1", "postcard=2"))).toBe(
			"malformed",
		);
		expect(refused(`${canonical()}&elev=0`)).toBe("malformed");
		expect(
			refused(exterior(0.5, 0.2).replace("mode=exterior", "mode=clear")),
		).toBe("malformed");
	});

	test("past a pole, non-finite or misspelled, an elevation is refused", () => {
		const at = (value: string) =>
			exterior(0.5, 0.25).replace("elev=0.25", `elev=${value}`);
		expect(refused(at("1.570797"))).toBe("out-of-range");
		expect(refused(at("-2"))).toBe("out-of-range");
		expect(refused(at("NaN"))).toBe("malformed");
		expect(refused(at("Infinity"))).toBe("malformed");
		expect(refused(at("1e-1"))).toBe("malformed");
		expect(refused(at("0.250"))).toBe("not-canonical");
		expect(refused(at("-0"))).toBe("not-canonical");
		expect(decodePostcard(at("1.570796")).ok).toBe(true);
		expect(decodePostcard(at("-1.570796")).ok).toBe(true);
	});

	test("a schema-1 recipe with a height is refused at the encode, not flattened", () => {
		const parsed = decodePostcard(LEGACY);
		if (!parsed.ok) throw new Error("legacy fixture refused");
		const legacy = parsed.recipe;
		if (legacy.mode !== "exterior") throw new Error("legacy fixture mode");
		expect(() => encodePostcard({ ...legacy, elevationRad: 0.4 })).toThrow();
	});

	test("a cockpit composition carries no orbit, whatever the scene holds", () => {
		const recipe = postcardRecipe({
			...scene,
			yawRad: 1,
			elevationRad: 1,
		}) as unknown as Record<string, unknown>;
		expect("elevationRad" in recipe || "yawRad" in recipe).toBe(false);
	});
});

describe("a rebuilt recipe spells the link it was opened on (node #691)", () => {
	/**
	 * The viewer hands `postcardRecipe` the quaternion the link carried. That
	 * quaternion is quantised, so its norm is off one by up to ~2e-7, and the
	 * division this function used to apply moved the last digit of about one
	 * orientation in three hundred — 56 of this row's 20,000, run against the
	 * old division — after `probe-chase-orbit.mjs` went red on one.
	 */
	test("over a sweep of orientations, scene → link → recipe → link is the identity", () => {
		let state = 691;
		const next = () => {
			state = (state * 1_103_515_245 + 12_345) >>> 0;
			return (state / 2 ** 32) * 2 - 1;
		};
		let moved = 0;
		for (let i = 0; i < 20_000; i++) {
			const q = [next(), next(), next(), next()];
			const n = Math.hypot(...q);
			const sent = encodePostcard(
				postcardRecipe({
					...scene,
					mode: "exterior",
					head: undefined,
					yawRad: 0.3,
					elevationRad: -0.2,
					orientation: q.map((c) => c / n),
				}),
			);
			const read = decodePostcard(sent);
			if (!read.ok) throw new Error(read.reason);
			const rebuilt = encodePostcard(
				postcardRecipe({
					...scene,
					mode: "exterior",
					head: undefined,
					yawRad: 0.3,
					elevationRad: -0.2,
					orientation: read.recipe.orientation,
				}),
			);
			if (rebuilt !== sent) moved++;
		}
		expect(moved).toBe(0);
	});

	test("a link's quaternion at the edge of the parse's tolerance rebuilds as it was sent", () => {
		// Sage round 2: a slack tighter than the parse's normalised this one to
		// `q=0,0,0,1`, one accepted link the viewer spelled back differently.
		for (const q of ["0,0,0,0.999991", "0,0,0,1.000009", "0,0,-0.999991,0"]) {
			const sent = withPair("q", q);
			const read = decodePostcard(sent);
			if (!read.ok) throw new Error(read.reason);
			const rebuilt = encodePostcard(
				postcardRecipe({ ...scene, orientation: read.recipe.orientation }),
			);
			expect(rebuilt).toBe(sent);
		}
	});

	test("a scene's quaternion that is not a rotation is still normalised", () => {
		const doubled = postcardRecipe({
			...scene,
			orientation: scene.orientation.map((c) => c * 2),
		});
		expect(encodePostcard(doubled)).toBe(canonical());
	});
});
