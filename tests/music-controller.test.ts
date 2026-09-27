/**
 * The music controller's two contracts that are a property of its source
 * (#560): bun cannot load `src/music.ts`, because its worklet import is vite's
 * `?worker&url`, so these read the file. What it does in a browser is
 * `probe-music.mjs`'s.
 */
import { expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";
import { VOICE_PRIORITY } from "../src/audio-cue";
import { MUSIC_VOICE_CAP } from "../src/music-score";

test("the controller creates no gain: the music bus is the only level (#542 D1)", () => {
	// #543 D5 puts every fade inside the worklet; a gain here would be a
	// second music level beside the bus row the player sets.
	const code = codeOf("src/music.ts");
	expect(code).not.toMatch(/createGain|new\s+GainNode|\.gain\b/);
	// And it connects to what it is handed, which is `AudioFX.musicInput`.
	expect(code).toMatch(/node\.connect\(out\)/);
});

test("music has its own voice budget, outside the cue pool (#543 D7)", () => {
	// No voice class of the cue pool is music's, so a cue cannot steal a music
	// voice, and the music cap is its own figure rather than a class cap.
	expect(VOICE_PRIORITY as readonly string[]).not.toContain("music");
	expect(MUSIC_VOICE_CAP).toBeGreaterThan(0);
	expect(codeOf("src/music-engine.ts")).not.toMatch(/voice-pool|audio-cue/);
});
