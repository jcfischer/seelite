/**
 * Player settings: what they are, where they live, and who hears about a
 * change.
 *
 * **Separate from world state on purpose.** `persistent-world-state.md` (#45)
 * governs what a *galaxy* remembers — carrier condition, knowledge, provenance
 * — and is keyed per galaxy and versioned. A preference is none of those: it
 * belongs to the person at the keyboard, survives every galaxy they ever start,
 * and is meaningless to anyone else. Storing the two together would put a
 * display choice inside a save file and make a save file a thing that carries
 * display choices.
 *
 * **Validated on read, not trusted.** `localStorage` is a string store that
 * anything can write, including an older build of this game. Every field is
 * checked against what it is allowed to be, and anything that fails falls back
 * to the default rather than reaching the renderer — a stored `renderScale` of
 * `0` would otherwise ask for a zero-sized drawing buffer.
 */

/**
 * The two values every on/off row takes.
 *
 * Named once and shared, rather than each row spelling its own pair and an
 * exported alias being derived from whichever happened to be first. That was
 * the arrangement for a round: the alias read `SCHEMA.dither.allowed`, so
 * editing the dither's values silently retyped the vignette. The alias is gone
 * now that `Settings` is derived from the schema — every row's type comes from
 * its own `allowed`, and nothing outside this file needed a name for the pair.
 */
const TOGGLE = ["on", "off"] as const;

/** One place for the schema, because the default and the validator drift apart
 *  when they are written separately. */
const SCHEMA = {
	/**
	 * A multiplier on the device pixel ratio.
	 *
	 * The renderer is fill-rate bound, so this is the largest single lever on
	 * frame time: halving it in each axis quarters the work, and that part is
	 * arithmetic rather than measurement.
	 *
	 * The observation behind it — 17 fps on a retina laptop panel against 70 on
	 * an external display, over a venusian filling the view — is consistent
	 * with the 4:1 pixel ratio and is not a controlled test of it. `main.ts`
	 * carries what that does and does not license.
	 */
	renderScale: {
		fallback: 1,
		allowed: [1, 0.75, 0.5] as const,
		label: "Resolution",
		describe: (v: number) => `${Math.round(v * 100)}%`,
		/** Why someone would move it, in the words of what they would see. */
		note: "Lower is faster and softer. Below 100% the cockpit's glow thins: bloom's own chain is a fixed size, but it reads a smaller frame, so fine highlights are averaged away before they can pass its brightness threshold.",
	},
	/**
	 * Which lighting terms the frame gets — #98's quality key, and #99's answer
	 * to what "low" drops.
	 *
	 * **#200's antialiasing is deliberately *not* here**, though it was for a
	 * round. It is a fill-rate cost paid on the same buffer, so folding it in
	 * looked like one question rather than two — and then it was flown. 4x is
	 * six times the frame cost of the whole rest of the frame on the machine
	 * this targets, which is a different order of decision from *does metal read
	 * as metal*, and a player who wants smooth edges at low lighting cannot ask
	 * for that through one key. It has its own row below.
	 *
	 * There is no frame-time floor in this game and deliberately so (#98): the
	 * target is Apple Silicon, the expensive part is gated, and a probe's frame
	 * cost is a SwiftShader number that is nobody's. So this is the gate rather
	 * than a budget.
	 *
	 * Low drops the baked lighting environment (#99) and the seam normal map on
	 * every plated surface — the hulls' (#101) and the cabin's (#105) — and
	 * keeps every other term. The hemisphere costs what the flat ambient it
	 * replaced cost, so dropping it would buy nothing and lose the gradient; the
	 * ones that go are the ones with a per-fragment texture sample — the
	 * environment on every standard material in the frame, the seam map on every
	 * plated surface, which also carries a tangent frame behind it.
	 *
	 * **One rule for every plated surface, not one per surface.** #105 could
	 * have gated the cabin on its own terms; it inherits the hull's instead, so
	 * a player moving this setting gets one answer rather than a list.
	 *
	 * **The cabin's lamps and its two interior lights stay on at both settings,
	 * and that is a declaration rather than an omission** (#98: every expensive
	 * visual term must say which side of this it is on). The lamps are
	 * `MeshBasicMaterial` and genuinely free. The lights are **not**: a
	 * `PointLight` parented to the cockpit group is still a light in
	 * `nearScene`, so three evaluates it for every `MeshStandardMaterial` in
	 * that scene — hulls and station plating included — and `distance` clamps
	 * the contribution rather than the arithmetic. An earlier version of this
	 * paragraph said they "cost nothing per fragment", which was simply wrong.
	 *
	 * So the two are split. **Low drops #105's key light** — the term this node
	 * added, and an ungated one would make every hull and station fragment in
	 * the game pay for a cabin gradient. Dropping it returns low to the light
	 * count that shipped before.
	 *
	 * **Low keeps the pre-existing interior fill**, because dropping that is not
	 * a degraded cabin but an unlit one: #105's finding is that the cabin is lit
	 * almost entirely through the canopy, so that light *is* the interior
	 * lighting, and the sentence below promises the player it stays.
	 *
	 * **#201's two occlusion passes are here, and one of them is the expensive
	 * one.** Measured headed on an M1 Pro at 1440x900 and device scale 2, over
	 * two runs, against a `cockpit-arrival` frame that costs 1.85–2.03 ms
	 * without them: the shadow map adds **0.59 ms** and the ambient occlusion
	 * **1.76–1.84 ms**, for **2.32–2.46 ms** together — a little over #201's own
	 * estimate of one to two, and a third of what the pair cost before the AO
	 * pass was moved to half the drawing buffer.
	 * `scripts/measure-occlusion-cost.mjs` is the instrument and
	 * `occlusion.ts` carries the resolution table.
	 *
	 * **Those figures are the pair at the default sample count, and they were
	 * the wrong half of the question — #241.** The principal flew this build at
	 * antialias 2x and reported empty space falling from a comfortable 60 fps to
	 * around 40. Re-measured on the same machine, same design, three framings and
	 * both sample counts, in milliseconds a frame:
	 *
	 * | framing | pair off | pair on | pair off, 2x | pair on, 2x |
	 * |---|---|---|---|---|
	 * | empty space | 3.740 | 7.303 | 11.552 | 18.681 |
	 * | `cockpit-arrival` | 3.784 | 7.403 | 11.650 | 18.519 |
	 * | `berth-free-look` | 38.861 | 41.909 | 48.025 | 54.228 |
	 *
	 * Two things fall out of it. **The pair doubles the open-space frame**, not
	 * the fifth the `cockpit-arrival` reading above suggested. And
	 * **multisampling multiplies the pair rather than adding beside it**:
	 * +3.563 ms at 0 samples against +7.130 at 2, a factor of 2.00. A term
	 * priced only at the default understates a 2x player's cost by half, which
	 * is how this shipped.
	 *
	 * What that frame buys is **two** answers. The shadow darkens 0.002–0.003%
	 * of an exterior frame; the ambient occlusion darkens 22.5% of a
	 * `cockpit-arrival` one, nearly all of it the cabin's corners. So the gate
	 * below trades a shadow nobody can see *and* a cabin term the player can,
	 * and the note this row shows them says so.
	 *
	 * So #241 put a gate in front of both passes rather than a row here: they
	 * draw when a station is close enough to be worth them and not otherwise,
	 * and `occlusion.ts` owns the predicate and the thresholds. This key still
	 * decides whether the player wants them at all.
	 *
	 * That is a *different order* from the antialiasing row below, which is
	 * four to six times the whole frame — so this stays one key rather than
	 * becoming two rows on #200's argument.
	 *
	 * The other framing the instrument takes, `berth-free-look`, is **not a
	 * measurement and is not quoted**: its own frame is 44 ms with a 39–54 ms
	 * spread, and the two single-term arms separate at 56% and 63% of pairings,
	 * which is a coin toss. A bay at device scale 2 is expensive before either
	 * of these passes touches it.
	 *
	 * **Every later expensive visual term declares which side of this it is on**
	 * (#98, #99). A term added without an answer here has not been gated, it has
	 * merely not been asked.
	 *
	 * A string rather than a number, which is why the loader below reads
	 * `allowed` as `unknown[]`: a lighting mode has no scale to be a point on,
	 * and `0` and `1` in a save file would say nothing about which is which.
	 */
	quality: {
		fallback: "high" as const,
		allowed: ["high", "low"] as const,
		label: "Lighting",
		describe: (v: string) => (v === "high" ? "High" : "Low"),
		note: "High reflects the star off every hull, plate and cockpit surface, cuts the panel lines into the hulls and the cabin so a moving sun breaks across them, lights the console from above, and — once a station is close enough to be worth the frame it costs — casts the star's shadow across whatever is nearest and darkens the corners and the contact where surfaces meet. Low drops all five and keeps the sun, the star-side gradient and the cockpit fill; the picture stays lit, the panel lines stay painted, the metal stops reading as metal and nothing casts or catches a shadow.",
	},
	/**
	 * How many samples the composed frame is drawn with — #200.
	 *
	 * **Its own row, and it defaults to off.** `antialias: true` on the
	 * `WebGLRenderer` was inert from the first frame this game drew, because
	 * every frame is rendered into the `EffectComposer`'s targets and that flag
	 * configures the default framebuffer. Multisampling the composer's own
	 * target fixes it and the sheet says so — and then it was priced, and it is
	 * the most expensive thing in this renderer by a factor of five.
	 * **`setComposerSamples` in `output-stage.ts` owns the table**, and the
	 * short version is that turning the count down does not rescue it: the cost
	 * is a full-buffer resolve paid once per layer pass, so the lever is #15's
	 * render ladder rather than this row.
	 *
	 * So the default is **off**: the game a player starts is the one that runs,
	 * and the smoother one is a row away for anyone whose machine can carry it.
	 * A number rather than a mode name, unlike `quality`, because a sample count
	 * *is* a point on a scale and the renderer takes it as one.
	 */
	antialias: {
		fallback: 0,
		allowed: [0, 2, 4] as const,
		label: "Antialiasing",
		describe: (v: number) => (v === 0 ? "Off" : `${v}x`),
		note: "Smooths the stair-stepping on rails, hull edges and station plating. It is the most expensive setting in this game by a wide margin — on an M1 Pro at full resolution, 2x costs about four times the frame and 4x about six. Turn it up only if the frame meter says you can afford it, and turn Resolution down first if it is close.",
	},
	/**
	 * Whether the output stage stipples the last bit — #200.
	 *
	 * A row of its own because #98's rule runs both ways: a term the player can
	 * see is a term the player should be able to turn off and look at. An earlier
	 * An earlier revision justified the row by asserting the term "cannot be
	 * measured against the noise of a frame". Two instruments later that is
	 * still where it stands — the difference is that it has now been looked for
	 * and not found, rather than assumed. **`setDither` in `output-stage.ts`
	 * owns what it costs and the three wrong answers on the way there**; the
	 * note below stays qualitative on purpose, because a number in a
	 * player-facing string is one more copy of a measurement and this entry
	 * already carried two that drifted apart from each other. What it fixes is banding in the
	 * dark — space and a planet's terminator cross a handful of eight-bit codes
	 * over hundreds of pixels — and the only honest way to judge that is to
	 * switch it.
	 */
	dither: {
		fallback: "on" as const,
		allowed: TOGGLE,
		label: "Dither",
		describe: (v: string) => (v === "on" ? "On" : "Off"),
		note: "Breaks up the banding in dark gradients — empty space, and the shadow side of a planet — by moving each pixel less than one shade at random. Its cost is too small for this game's own frame-cost instrument to separate from noise; leave it on unless you want to see the bands the eight-bit screen actually has.",
	},
	/**
	 * Whether the cockpit's corners fall off — #200.
	 *
	 * Never applied outside cockpit view whatever this says: a vignette is a
	 * lens artefact, and on an exterior shot with no lens in the fiction it
	 * reads as a photograph of a spaceship. `main.ts` owns that half; this row
	 * is whether the player wants it at all.
	 */
	vignette: {
		fallback: "on" as const,
		allowed: TOGGLE,
		label: "Vignette",
		describe: (v: string) => (v === "on" ? "On" : "Off"),
		note: "Darkens the corners of the cockpit view by up to 15%, so the frame's edges stop competing with the instruments. Never applied in the chase view. Off is the flat frame.",
	},
} as const;

export type Quality = (typeof SCHEMA.quality.allowed)[number];

/**
 * One row per schema entry, each typed as **its own allowed set**.
 *
 * Derived rather than written out, which was worth the mapped type: the hand-
 * written version repeated every key a third time beside `SCHEMA` and
 * `DEFAULT_SETTINGS`, so adding a row meant three synchronised edits — and it
 * silently widened as it went. `antialias` was declared `number` there, so
 * `store.set("antialias", 3)` type-checked and was refused only at runtime.
 * Here it is `0 | 2 | 4` and the compiler says so.
 */
export type Settings = {
	[K in keyof typeof SCHEMA]: (typeof SCHEMA)[K]["allowed"][number];
};

export const SETTING_KEYS = Object.keys(SCHEMA) as (keyof typeof SCHEMA)[];
export const settingSpec = (key: keyof typeof SCHEMA) => SCHEMA[key];

/**
 * Every row's fallback, taken from the schema.
 *
 * Also derived, for the same reason and with the same cast as `allowed`:
 * building an object whose value type varies by key cannot be expressed while
 * the key is a union, and `settings.test.ts` round-trips a legal value of each
 * kind, which is what actually holds it. What this buys is that a row added to
 * `SCHEMA` with no default here is now impossible rather than a `undefined`
 * reaching the renderer.
 */
export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
	SETTING_KEYS.map((key) => [key, SCHEMA[key].fallback]),
) as Settings;

const STORAGE_KEY = "seelite:settings:v1";

/**
 * Read what is stored, keeping only fields that are still allowed.
 *
 * Never throws. A private-mode browser refuses `localStorage` outright, and a
 * game that cannot start because it cannot read a preference would be a poor
 * trade for a preference.
 */
export function loadSettings(): Settings {
	const out: Settings = { ...DEFAULT_SETTINGS };
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(STORAGE_KEY);
	} catch {
		return out;
	}
	if (!raw) return out;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return out;
	}
	if (!parsed || typeof parsed !== "object") return out;
	const stored = parsed as Record<string, unknown>;
	for (const key of SETTING_KEYS) {
		// `key` here is the *union* of the setting keys, so `Settings[key]` is the
		// intersection of their value types — `number & Quality`, which is `never`
		// — and no assignment can satisfy it. That is a limitation of indexing by
		// a union and not of this validation: `accept` below is generic and fully
		// checked at any call site that names a key, and `assign` is the one place
		// the union is widened, with nothing else in it to hide a mistake.
		assign(out, key, accept(key, stored[key]));
	}
	return out;
}

/** Write one accepted value, or leave the default in place. Three lines with a
 *  cast in them, kept apart from the loop so that the cast is the whole of what
 *  is unchecked rather than one clause of a longer statement. */
function assign<K extends keyof Settings>(
	into: Settings,
	key: K,
	value: Settings[K] | undefined,
) {
	if (value !== undefined) (into as Record<K, Settings[K]>)[key] = value;
}

/**
 * The stored value for one key, or `undefined` if it is not one this schema
 * allows.
 *
 * Membership of the allowed set is the whole validation, and it carries the
 * type check with it: `allowed` holds literals, so `"0.5"` is not in a set of
 * numbers and `0` is not in a set of mode names. Testing `typeof` first — as
 * this did while every setting was a number — would have to grow a branch per
 * kind the moment a second one arrived.
 *
 * **Generic, and that is the point rather than decoration.** The form this
 * replaces was one line in the loop ending `out[key] = value as never`, where
 * the cast sat on the assignment and erased the link between what was validated
 * and where it landed. Here the assertion is on the *return*, so every caller
 * naming a key gets `Settings[K]` and the compiler checks the assignment for
 * them.
 *
 * What it still does not check, stated rather than implied: that
 * `SCHEMA[key].allowed` is a set of `Settings[K]` values. Indexing `Settings` by
 * the union of its keys collapses to `never` (see `loadSettings`), so no
 * signature written here recovers that, and a schema whose set stopped matching
 * its field's type would compile. What catches that is `settings.test.ts`, which
 * round-trips a legal value of each kind.
 */
function accept<K extends keyof Settings>(
	key: K,
	value: unknown,
): Settings[K] | undefined {
	const allowed = SCHEMA[key].allowed as readonly unknown[];
	return allowed.includes(value) ? (value as Settings[K]) : undefined;
}

/** Write, and say nothing if the browser refuses. A rejected write is a lost
 *  preference, not a lost session. */
export function saveSettings(settings: Settings) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		/* private mode, quota, or a disabled store */
	}
}

type Listener = (settings: Settings) => void;

/**
 * The live settings, and a way to hear about changes.
 *
 * A store rather than a value passed around, because a setting is read by
 * whoever cares — the renderer today, audio and controls later — and threading
 * it through every constructor would make adding the second setting a change
 * to every one of them.
 */
export class SettingsStore {
	private current: Settings;
	private listeners = new Set<Listener>();

	constructor(initial: Settings = loadSettings()) {
		this.current = initial;
	}

	get value(): Settings {
		return this.current;
	}

	/**
	 * What the settings screen may offer for one key — and what a script driving
	 * this store from outside is allowed to ask for.
	 *
	 * On the store rather than only as `settingSpec`, because the readers that
	 * need it most are `.mjs`: `scripts/probe-output-stage.mjs` and
	 * `scripts/measure-light-cost.mjs` reach the game through
	 * `window.__seelite` and cannot import a TypeScript module. Both used to
	 * carry their own `[0, 2, 4]`, which is the copied-constant trap
	 * `CLAUDE.md` names — and the instrument's copy was `[0, 2, 4, 8, 16]`,
	 * which `set` accepted and reported as a measurement of a count no player
	 * can choose.
	 */
	allowed<K extends keyof Settings>(key: K): readonly Settings[K][] {
		// Through `unknown`, for the reason `accept` below states at length:
		// indexing `Settings` by the union of its keys collapses to `never`, so
		// no signature written here recovers the link between a key and its set.
		// `settings.test.ts` round-trips a legal value of each kind, which is what
		// actually holds it.
		return SCHEMA[key].allowed as unknown as readonly Settings[K][];
	}

	/**
	 * Change one setting, or refuse.
	 *
	 * **Validated here as well as on load**, which it was not: `loadSettings`
	 * guarded the boundary with `localStorage` and nothing guarded the boundary
	 * with code. A caller could write any value at all, and it was saved — so
	 * the illegal value survived until a reload cleaned it up. That is not
	 * theoretical: `measure-light-cost.mjs` swept `antialias` over a list of its
	 * own and set 16, the composer allocated a 16x target, and the instrument
	 * printed a frame cost for a setting the screen does not offer. A count
	 * reaches `WebGLRenderTarget({ samples })`, so the failure mode above that
	 * is a target that will not allocate at all.
	 */
	set<K extends keyof Settings>(key: K, value: Settings[K]) {
		// Through `accept`, which is the loader's own membership check — the
		// first version of this line reimplemented it, and two paths that must
		// agree about what a legal value is are two paths that will not.
		if (accept(key, value) === undefined) return;
		if (this.current[key] === value) return;
		this.current = { ...this.current, [key]: value };
		saveSettings(this.current);
		for (const listener of this.listeners) listener(this.current);
	}

	subscribe(listener: Listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
