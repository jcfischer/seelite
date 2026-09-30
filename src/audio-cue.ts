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

/** The pulse laser's discrete shot voices (#545): a discharge crack, or the
 *  descending zap before #545. The sustained beam is a loop (`WeaponMix`). */
export type LaserVoice = "crack" | "pew";

/** A hull hit's voice (#545): metal struck, or the thud before #545. */
export type HullHitVoice = "clang" | "thud";

/** How much weight the one-shots carry (#577): a body under every impact,
 *  or the sound before #577. The engine's setting, not a cue's field. */
export type PunchVoice = "heavy" | "thin";

/** The flash on the cut, by ear (#534): a low impact, or a bright ring. */
export type FlashVoice = "boom" | "glass";

/** The ride through the tunnel (#534): a rushing that pulses with its rings,
 *  or a steady low drone. */
export type RideVoice = "rings" | "bed";

/**
 * The sweep drawn down into silence as the dark closes to a point (#534's
 * `swallow` arm): seconds from the cue's start. The schedule works them out
 * from the dark's own timing, so the engine never reads it. Only a risen
 * sweep carries one: the sweep before #534 has died away before the dark
 * closes, so there is nothing left of it to swallow.
 */
export interface SweepSwallow {
	fromS: number;
	toS: number;
}

/**
 * A closed union of every cue, with the data a cue needs.
 *
 * The combat cues carry what `weapon-sound.ts` decided from its arms (#545),
 * so the engine plays what it is told and never reads an arm: a shield hit's
 * pool, what is left of it (`share`, `0`..`1`) and whether the side is
 * heard; a landed hit's surface.
 */
export type Cue =
	| { kind: "laser"; voice: LaserVoice }
	| { kind: "gunLocked" }
	| { kind: "explosion" }
	| { kind: "shieldHit"; pool: HitPool; share: number; sided: boolean }
	| { kind: "hullHit"; voice: HullHitVoice }
	| { kind: "hitLanded"; on: "shield" | "hull" }
	| { kind: "dock" }
	| { kind: "scoop" }
	| { kind: "alert" }
	| { kind: "ui" }
	| { kind: "notify"; tone: NotifyTone }
	| { kind: "press" }
	| { kind: "refuse" }
	| { kind: "focus" }
	| { kind: "witchspaceHum"; seconds: number }
	| { kind: "witchspaceSweep"; riseS?: number; swallow?: SweepSwallow }
	| { kind: "witchspaceFlash"; voice: FlashVoice }
	| {
			kind: "witchspaceRide";
			voice: RideVoice;
			seconds: number;
			openS: number;
			ringHz: number;
	  }
	| { kind: "witchspaceRideClose"; seconds: number }
	| { kind: "witchspaceUnfold"; seconds: number }
	| { kind: "witchspaceRift"; seconds: number }
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
	gunLocked: "combat",
	explosion: "combat",
	shieldHit: "combat",
	hullHit: "combat",
	hitLanded: "combat",
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
	witchspaceFlash: "ship",
	witchspaceRide: "ship",
	witchspaceRideClose: "ship",
	witchspaceUnfold: "ship",
	witchspaceRift: "ship",
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
	| "witchspaceFlash"
	| "witchspaceRide"
	| "witchspaceRideClose"
	| "witchspaceUnfold"
	| "witchspaceRift"
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
	// #545: a hit landed is the player's own act and lower than one taken, so
	// a full mix yields it first; the dry click is the gun's.
	hitLanded: "weapons",
	explosion: "hits",
	laser: "weapons",
	gunLocked: "weapons",
	ui: "ui",
	// #546: in the highest class (#542 D4's order), so a full mix yields a
	// click or a weapon before a message. A default, not a ruling: the
	// principal's listen did not ask it.
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

/**
 * The combat loops for one step (#545): what `weapon-sound.ts` computes and
 * `AudioFX.weapons` plays. Every level is `0`..`1`; a loop at 0 is silent.
 */
export interface WeaponMix {
	/** The sustained beam, while the gun fires (`beam` arm). */
	readonly beam: number;
	/** The gun's heat, which lifts the beam's whine (`heatrise`). */
	readonly heat: number;
	/** A held enemy beam sizzling on the fore shield (`sizzle`). */
	readonly sizzleFore: number;
	/** And on the aft. */
	readonly sizzleAft: number;
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
