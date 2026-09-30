/**
 * #552: the sim-to-cue seam (#542 D3) and the voice limits (D4), held
 * headless. What a cue *sounds* like is not here and cannot be: that is the
 * offline probe's bands and the principal's ear. What is here is which event
 * earns which cue, and how many of them can sound at once.
 */
import { describe, expect, test } from "bun:test";
import {
	CUE_BUS,
	CUE_VOICE,
	type Cue,
	type CueKind,
	VOICE_CAPS,
	VOICE_MIX_CAP,
	VOICE_PRIORITY,
} from "../src/audio-cue";
import { VoicePool } from "../src/voice-pool";
import {
	QUIET_GUN,
	SHOT_SOUND_GAP_S,
	stepGunFeedback,
} from "../src/gun-feedback";
import { nextScoopNotice } from "../src/cargo-notice";
import {
	WITCHSPACE,
	beginWitchspace,
	idleWitchspace,
	witchspaceCues,
} from "../src/witchspace";

const DT = 1 / 60;

describe("every cue has a bus", () => {
	test("each kind names one of the three cue buses", () => {
		// Master and music carry no cue of their own: master is everything, and
		// music is the synth's input (#543).
		for (const bus of Object.values(CUE_BUS))
			expect(["ship", "combat", "console"]).toContain(bus);
	});

	test("the witchspace cues play through ship, and alert through console", () => {
		// D1: the witchspace groups move off master and under ship, and alert is an
		// instrument speaking rather than a sound in the world.
		expect(CUE_BUS.witchspaceHum).toBe("ship");
		expect(CUE_BUS.witchspaceSweep).toBe("ship");
		expect(CUE_BUS.alert).toBe("console");
		expect(CUE_BUS.laser).toBe("combat");
		expect(CUE_BUS.explosion).toBe("combat");
		expect(CUE_BUS.hullHit).toBe("combat");
		expect(CUE_BUS.ui).toBe("console");
	});
});

describe("the event → cue mapping", () => {
	test("a shot owes a sound, paced so a held trigger is not a buzz", () => {
		// Which voice, or none for a sustained beam, is `weapon-sound.ts`'s (#545).
		const first = stepGunFeedback(QUIET_GUN, true, DT);
		expect(first.sound).toBe(true);
		const held = stepGunFeedback(first.feedback, true, DT);
		expect(held.sound).toBe(false);
		expect(SHOT_SOUND_GAP_S).toBeGreaterThan(DT);
	});

	test("a scoop taken is a scoop cue, a refusal is an alert", () => {
		const quiet = { text: "", left: 0, accepted: false, canisterId: null };
		const took = nextScoopNotice(quiet, {
			canisterId: "a",
			commodity: "Food",
			tonnes: 1,
			accepted: true,
			leftT: 0,
		});
		expect(took.cue).toEqual({ kind: "scoop" });
		const refused = nextScoopNotice(quiet, {
			canisterId: "b",
			commodity: "Food",
			tonnes: 1,
			accepted: false,
		});
		expect(refused.cue).toEqual({ kind: "alert" });
	});

	test("a wind-up is a hum that carries its own length", () => {
		const cues = witchspaceCues(idleWitchspace(), beginWitchspace());
		expect(cues).toEqual([{ kind: "witchspaceHum", seconds: WITCHSPACE.humS }]);
	});

	// The hit delta moved to `weapon-sound.ts` with its gate (#545), and its
	// rows to `tests/weapon-sound.test.ts`.
});

describe("voice classes", () => {
	test("the priority is D4's order, highest first", () => {
		expect(VOICE_PRIORITY).toEqual(["alert", "hits", "weapons", "ui"]);
	});

	test("every class has a cap, and every voiced cue a class", () => {
		for (const cls of VOICE_PRIORITY)
			expect(VOICE_CAPS[cls]).toBeGreaterThan(0);
		for (const cls of Object.values(CUE_VOICE))
			expect(VOICE_PRIORITY).toContain(cls);
	});

	test("the witchspace cues are not pooled", () => {
		// They have their own groups, so a cancelled charge can take them back
		// (#532), and there is only ever one of each.
		const voiced = Object.keys(CUE_VOICE) as CueKind[];
		expect(voiced).not.toContain("witchspaceHum");
		expect(voiced).not.toContain("witchspaceSweep");
		for (const kind of [
			"witchspaceFlash",
			"witchspaceRide",
			"witchspaceRideClose",
			"witchspaceUnfold",
			"witchspaceRift",
		] as const)
			expect(voiced).not.toContain(kind);
		expect(voiced).not.toContain("witchspaceStop");
	});
});

describe("the voice pool", () => {
	const caps = { alert: 2, hits: 3, weapons: 3, ui: 2 };
	const pool = () => new VoicePool(caps, VOICE_PRIORITY, 6);

	test("a burst of one class holds at its cap", () => {
		const p = pool();
		for (let i = 0; i < 40; i++) p.admit("weapons", i * 0.001, 1);
		expect(p.live(0.05).filter((v) => v.cls === "weapons")).toHaveLength(3);
	});

	test("the shipped caps hold a burst of every class", () => {
		const p = new VoicePool(VOICE_CAPS, VOICE_PRIORITY, VOICE_MIX_CAP);
		for (let i = 0; i < 200; i++)
			p.admit(VOICE_PRIORITY[i % VOICE_PRIORITY.length], i * 0.001, 5);
		const live = p.live(0.2);
		expect(live.length).toBeLessThanOrEqual(VOICE_MIX_CAP);
		for (const cls of VOICE_PRIORITY)
			expect(live.filter((v) => v.cls === cls).length).toBeLessThanOrEqual(
				VOICE_CAPS[cls],
			);
	});

	test("over the cap, the oldest of the class is stolen", () => {
		const p = pool();
		const ids = [0, 1, 2].map((i) => p.admit("weapons", i * 0.01, 1).id);
		const fourth = p.admit("weapons", 0.05, 1);
		expect(fourth.admitted).toBe(true);
		expect(fourth.steal).toEqual([ids[0]]);
	});

	test("a voice that has ended frees its place", () => {
		const p = pool();
		for (let i = 0; i < 3; i++) p.admit("weapons", 0, 0.1);
		expect(p.admit("weapons", 0.2, 0.1).steal).toEqual([]);
	});

	test("a full mix takes its place from a lower class", () => {
		const p = pool();
		p.admit("ui", 0, 1);
		p.admit("ui", 0.01, 1);
		for (let i = 0; i < 3; i++) p.admit("weapons", 0.02 + i * 0.01, 1);
		p.admit("alert", 0.06, 1);
		// Six live: the mix is full. A hit takes the oldest UI voice, not a weapon.
		const hit = p.admit("hits", 0.1, 1);
		expect(hit.admitted).toBe(true);
		expect(hit.steal).toHaveLength(1);
		const stolen = hit.steal[0];
		expect(p.live(0.1).some((v) => v.id === stolen)).toBe(false);
		expect(p.live(0.1).filter((v) => v.cls === "ui")).toHaveLength(1);
		expect(p.live(0.1)).toHaveLength(6);
	});

	test("a full mix of higher classes refuses a lower one", () => {
		const p = pool();
		for (let i = 0; i < 2; i++) p.admit("alert", i * 0.01, 1);
		for (let i = 0; i < 3; i++) p.admit("hits", 0.02 + i * 0.01, 1);
		p.admit("weapons", 0.05, 1);
		const ui = p.admit("ui", 0.06, 1);
		expect(ui.admitted).toBe(false);
		expect(ui.steal).toEqual([]);
		expect(p.live(0.06)).toHaveLength(6);
	});
});

test("a cue is a closed union: every kind is listed in CUE_BUS", () => {
	// A compile-time claim held at runtime too: a kind added to `Cue` without a
	// bus fails `tsc` at `CUE_BUS`, and this lists what the table carries.
	const kinds: Cue["kind"][] = [
		"laser",
		"gunLocked",
		"hitLanded",
		"explosion",
		"shieldHit",
		"hullHit",
		"dock",
		"scoop",
		"alert",
		"ui",
		"notify",
		"press",
		"refuse",
		"focus",
		"witchspaceHum",
		"witchspaceSweep",
		"witchspaceFlash",
		"witchspaceRide",
		"witchspaceRideClose",
		"witchspaceUnfold",
		"witchspaceRift",
		"witchspaceStop",
		"cruiseEngage",
		"cruiseDrop",
	];
	expect(Object.keys(CUE_BUS).sort()).toEqual([...kinds].sort());
});
