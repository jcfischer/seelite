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
	 * There is no frame-time floor in this game and deliberately so (#98): the
	 * target is Apple Silicon, the expensive part is gated, and a probe's frame
	 * cost is a SwiftShader number that is nobody's. So this is the gate rather
	 * than a budget.
	 *
	 * Low drops the baked lighting environment (#99) and the hulls' seam normal
	 * map (#101), and keeps every other term. The hemisphere costs what the flat
	 * ambient it replaced cost, so dropping it would buy nothing and lose the
	 * gradient; the two that go are the ones with a per-fragment texture sample
	 * — the environment on every standard material in the frame, the seam map on
	 * every plated hull surface, which also carries a tangent frame behind it.
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
		note: "High reflects the star off every hull, plate and cockpit surface, and cuts the panel lines into the hulls so a moving sun breaks across them. Low drops both and keeps the sun, the star-side gradient and the cockpit fill; the picture stays lit, the panel lines stay painted, and the metal stops reading as metal.",
	},
} as const;

export type Quality = (typeof SCHEMA.quality.allowed)[number];
export type Settings = { renderScale: number; quality: Quality };

export const SETTING_KEYS = Object.keys(SCHEMA) as (keyof typeof SCHEMA)[];
export const settingSpec = (key: keyof typeof SCHEMA) => SCHEMA[key];

export const DEFAULT_SETTINGS: Settings = {
	renderScale: SCHEMA.renderScale.fallback,
	quality: SCHEMA.quality.fallback,
};

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

	set<K extends keyof Settings>(key: K, value: Settings[K]) {
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
