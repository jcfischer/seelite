/**
 * The cue vocabulary: what the game can ask the sound engine to play (#552,
 * after #542's D1, D3 and D4).
 *
 * **A leaf that imports nothing**, and `tests/headless.test.ts` holds it. Step
 * modules return these cues and `audio.ts` plays them, so both sides read this
 * file and neither reads the other. `sim.ts` and every step module stay free of
 * the audio layer, as they are free of Three.js: a cue is pushed to the engine,
 * never pulled by it.
 *
 * What a cue *sounds* like is not here. That is `audio.ts`, and whether it
 * sounds right is the principal's ear (#542 D7).
 */

/** Which side of the ship a shield pool covers. `ShieldSide`'s shape, restated
 *  so this file imports nothing. */
export type HitPool = "fore" | "aft";

/**
 * What a console message means, to the ear (#546): news, a thing done for the
 * pilot, or a thing gone wrong. `alert` is none of these: it is the ship
 * saying something is wrong with the ship.
 */
export type NotifyTone = "message" | "good" | "bad";

/**
 * A closed union of every cue, with the data a cue needs.
 *
 * `shieldHit` and `hullHit` are emitted by `hitCues` below and are **not yet
 * played**: hits are silent on the build this replaced, and #545 decides what
 * they sound like and how often, by ear. `Game.play` says so at the arm.
 */
export type Cue =
	| { kind: "laser" }
	| { kind: "explosion" }
	| { kind: "shieldHit"; pool: HitPool }
	| { kind: "hullHit" }
	| { kind: "dock" }
	| { kind: "scoop" }
	| { kind: "alert" }
	| { kind: "ui" }
	| { kind: "notify"; tone: NotifyTone }
	| { kind: "press" }
	| { kind: "refuse" }
	| { kind: "focus" }
	| { kind: "witchspaceHum"; seconds: number }
	| { kind: "witchspaceSweep" }
	| { kind: "witchspaceStop" }
	| { kind: "cruiseEngage" }
	| { kind: "cruiseDrop" };

export type CueKind = Cue["kind"];

/**
 * The five buses (#542 D1). `master` carries everything through the limiter;
 * `music` is the synth's one input (#543) and carries no cue of this file's.
 */
export const BUSES = ["master", "ship", "combat", "console", "music"] as const;
export type Bus = (typeof BUSES)[number];

/** The buses a cue can play through. */
export type CueBus = Exclude<Bus, "master" | "music">;

/**
 * Which bus each cue plays through (D1).
 *
 * The witchspace cues are on **ship**, no longer straight to master; #534 still
 * owns what they sound like. `alert` is on **console**, because it is an
 * instrument speaking and not a sound in the world. `scoop` and `dock` are the
 * ship's own machinery.
 */
export const CUE_BUS: Record<CueKind, CueBus> = {
	laser: "combat",
	explosion: "combat",
	shieldHit: "combat",
	hullHit: "combat",
	dock: "ship",
	scoop: "ship",
	alert: "console",
	ui: "console",
	notify: "console",
	press: "console",
	refuse: "console",
	focus: "console",
	witchspaceHum: "ship",
	witchspaceSweep: "ship",
	witchspaceStop: "ship",
	cruiseEngage: "ship",
	cruiseDrop: "ship",
};

/**
 * Voice classes, highest priority first (D4). When the mix is full, a lower
 * class yields its place to a higher one.
 */
export const VOICE_PRIORITY = ["alert", "hits", "weapons", "ui"] as const;
export type VoiceClass = (typeof VOICE_PRIORITY)[number];

/** The cues that take a voice from the pool. */
export type VoicedCueKind = Exclude<
	CueKind,
	| "witchspaceHum"
	| "witchspaceSweep"
	| "witchspaceStop"
	| "cruiseEngage"
	| "cruiseDrop"
>;

/**
 * Each pooled cue's class.
 *
 * The witchspace cues are not pooled: each has one group of its own, which a
 * new cue of the same name replaces and a cancelled charge takes back (#532).
 * Nor are the cruise cues (#544): one plays per regime change, so there is no
 * burst for a cap to hold, and in the lowest class a UI click could take the
 * engage's place.
 *
 * D4 names four classes, and `scoop` and `dock` are in none of them by name.
 * They go in **ui**, the lowest: neither is urgent, and a fight that fills the
 * mix should take their place before it takes a weapon's.
 */
export const CUE_VOICE: Record<VoicedCueKind, VoiceClass> = {
	alert: "alert",
	shieldHit: "hits",
	hullHit: "hits",
	explosion: "hits",
	laser: "weapons",
	ui: "ui",
	// #546: a message outranks a click, and a fight should not take a
	// message's voice. Put to the principal's ear as a question.
	notify: "alert",
	press: "ui",
	refuse: "ui",
	focus: "ui",
	scoop: "ui",
	dock: "ui",
};

/**
 * The most voices of each class that sound at once, and of all classes
 * together.
 *
 * **Placeholders, set to be out of the way**: the figures are a mix decision
 * that the prototype nodes (#544, #545, #546) set by ear (D4). What they must
 * not do today is change a sound, and at the rates the game fires cues now
 * (a shot every `SHOT_SOUND_GAP_S`, a laser ringing under 0.2 s) no class
 * reaches its cap in play.
 */
export const VOICE_CAPS: Record<VoiceClass, number> = {
	alert: 2,
	hits: 6,
	weapons: 4,
	ui: 3,
};
export const VOICE_MIX_CAP = 12;

/** The fade on a stolen voice, s: short, and not a cut, so a steal is not a
 *  click (D4). A time constant for `setTargetAtTime`. */
export const VOICE_STEAL_FADE_S = 0.01;

/** What `hitCues` compares: the shield pools and the hull. `ShipCondition`
 *  satisfies it. */
export interface HitReading {
	readonly fore: number;
	readonly aft: number;
	readonly hull: number;
}

/** Seconds since each pool last cued a hit. */
export interface HitArm {
	readonly fore: number;
	readonly aft: number;
	readonly hull: number;
}

/** Nothing has hit yet: the first fall cues at once. */
export const QUIET_HITS: HitArm = {
	fore: Number.POSITIVE_INFINITY,
	aft: Number.POSITIVE_INFINITY,
	hull: Number.POSITIVE_INFINITY,
};

/**
 * The shortest gap between two hit cues on one pool, s.
 *
 * F3: enemy fire is continuous — `pulseDamagePerSecond × dt` every frame — so a
 * held beam lowers a pool on every frame. Without a re-arm that is a cue per
 * frame. **A placeholder**: the interval, and whether a held beam is one
 * sustained voice instead, are #545's to decide by ear.
 */
export const HIT_REARM_S = 0.25;

/**
 * The hit cues a step from `prev` to `next` owes (D3).
 *
 * A fall in a shield pool is a `shieldHit` naming the pool; a fall in hull is a
 * `hullHit`. A rise — recharge, repair, a new ship — is nothing. Each of the
 * three re-arms on its own, so a hit aft is not swallowed by a beam fore.
 */
export function hitCues(
	arm: HitArm,
	prev: HitReading,
	next: HitReading,
	dt: number,
): { arm: HitArm; cues: Cue[] } {
	const cues: Cue[] = [];
	const step = (key: keyof HitArm): number => {
		const since = arm[key] + Math.max(0, dt);
		if (!(next[key] < prev[key])) return since;
		// Measured from the last cue, so the gap is `HIT_REARM_S` whatever the
		// frame rate; the first fall after a quiet spell cues at once.
		if (since < HIT_REARM_S) return since;
		cues.push(
			key === "hull" ? { kind: "hullHit" } : { kind: "shieldHit", pool: key },
		);
		return 0;
	};
	const fore = step("fore");
	const aft = step("aft");
	const hull = step("hull");
	return { arm: { fore, aft, hull }, cues };
}

/** The cruise bed's two candidate voices (#544), picked by ear. */
export type CruiseVoice = "shimmer" | "throb";

/**
 * The ship's loops for one frame (#544): what `flight-sound.ts` computes from
 * flight state and `AudioFX.flight` plays. Every level is `0`..`1`; a loop
 * at 0 is silent. Here rather than in either module because `audio.ts` may
 * import only this leaf and the voice pool (`tests/headless.test.ts`).
 */
export interface FlightMix {
	/** The always-on hull hum. */
	readonly hum: number;
	/** The main drive: louder and brighter together. */
	readonly drive: number;
	/** The manoeuvring thrusters. */
	readonly rcs: number;
	/** The cruise wind-up, rising with its share done. */
	readonly spool: number;
	/** The sustained cruise bed. */
	readonly cruise: number;
	/** Cruise speed, `0`..`1` of its log range: the bed's pitch, brightness
	 *  and pace follow it. */
	readonly cruiseSpeed: number;
	readonly cruiseVoice: CruiseVoice;
	/** Mean loud hull clicks per second; `audio.ts` places them at random (D6). */
	readonly clickRate: number;
	/** Mean faint clicks per second: the sparse steady layer under the loud. */
	readonly faintClickRate: number;
}
