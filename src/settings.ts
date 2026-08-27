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
	 * frame time: halving it in each axis quarters the work. Measured on the
	 * principal's machine over a venusian planet filling the view — 17 fps on a
	 * retina laptop panel against 70 on an external display, which is exactly
	 * the ratio of their pixel counts.
	 */
	renderScale: {
		fallback: 1,
		allowed: [1, 0.75, 0.5] as const,
		label: "Resolution",
		describe: (v: number) => `${Math.round(v * 100)}%`,
		/** Why someone would move it, in the words of what they would see. */
		note: "Lower is faster and softer. Below 100% the cockpit's glow thins, because bloom has fewer bright pixels to find.",
	},
} as const;

export type Settings = { renderScale: number };

export const SETTING_KEYS = Object.keys(SCHEMA) as (keyof typeof SCHEMA)[];
export const settingSpec = (key: keyof typeof SCHEMA) => SCHEMA[key];

export const DEFAULT_SETTINGS: Settings = {
	renderScale: SCHEMA.renderScale.fallback,
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
	for (const key of SETTING_KEYS) {
		const value = (parsed as Record<string, unknown>)[key];
		const allowed = SCHEMA[key].allowed as readonly number[];
		if (typeof value === "number" && allowed.includes(value)) out[key] = value;
	}
	return out;
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
