/**
 * The music lab (#548 D9), on `?music-lab&boot=direct` — a bare `?music-lab`
 * lands on the public page (`entry.ts`): the adaptive music with the game
 * taken out, for the principal's ear. Pick a system, force a level, toggle
 * cruise, dock at a station of any role, and hear the transitions land.
 *
 * It drives the **real director** (`music-director.ts`) through its `force`
 * arm, on the real engine's music bus and the real synth — so a level change
 * rises on the next bar and falls after the hold, exactly as in flight. A
 * listening surface, not a game mode: no world, no render loop.
 */
import { AudioFX } from "./audio";
import { numbersPhrase } from "./comms";
import { renderNumbersAhead, sayNumbers } from "./comms-voice";
import { Music } from "./music";
import {
	DEFAULT_MUSIC_ARMS,
	type MusicBed,
	FALL_HOLD_S,
	initialMusicState,
	type MusicReading,
	type MusicScene,
	QUIET_READING,
	stepMusic,
} from "./music-director";
import { FLIGHT_LEVELS, type MusicLevel, musicTheme } from "./music-generate";
import type { StationType } from "./station";

const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const STEP_S = 0.1;

export function mountMusicLab() {
	document.body.innerHTML = "";
	const root = document.createElement("main");
	root.style.cssText =
		"font: 15px/1.5 system-ui, sans-serif; color: #dde3ea; background: #0b0e12; min-height: 100vh; padding: 24px; box-sizing: border-box;";
	root.innerHTML = `
<h1 style="margin:0 0 4px;font-size:20px">Music lab</h1>
<p style="margin:0 0 16px;color:#8a96a3">#548's adaptive music, through the real director and synth. A rise lands on the next bar; a fall waits ${FALL_HOLD_S} s, one level at a time.</p>
<p><button id="start">Start sound</button></p>
<fieldset style="border:1px solid #2a323c;margin:0 0 12px"><legend>System</legend>
  <label>Seed <input id="seed" type="number" value="1234" style="width:9em"></label>
  <button id="random">Random system</button>
  <span id="theme" style="margin-left:12px;font:13px ui-monospace,monospace;color:#8a96a3"></span>
</fieldset>
<fieldset style="border:1px solid #2a323c;margin:0 0 12px"><legend>Where</legend>
  <label><input type="radio" name="scene" value="flight" checked> Flight</label>
  <label><input type="radio" name="scene" value="docked"> Docked at
    <select id="role"><option>trade</option><option>refinery</option><option>shipyard</option><option>outpost</option></select></label>
  <label><input type="radio" name="scene" value="witchspace"> Witchspace (music yields)</label>
  <label style="margin-left:12px"><input id="cruise" type="checkbox"> Cruise</label>
  <label style="margin-left:12px">Bed <select id="bed"><option value="berlin">Berlin (third)</option><option value="second">second</option><option value="legacy">first (legacy)</option></select></label>
</fieldset>
<fieldset style="border:1px solid #2a323c;margin:0 0 12px"><legend>Danger level</legend>
  ${FLIGHT_LEVELS.map((l, i) => `<label><input type="radio" name="level" value="${l}"${i === 0 ? " checked" : ""}> ${l}</label>`).join(" ")}
</fieldset>
<pre id="state" style="font:13px ui-monospace,monospace;color:#8a96a3;background:#12171d;padding:10px;margin:0"></pre>
<pre id="errors" style="font:13px ui-monospace,monospace;color:#e0a040;margin:8px 0 0"></pre>`;
	document.body.appendChild(root);
	document.body.style.margin = "0";
	document.body.style.background = "#0b0e12";

	const $ = <T extends HTMLElement>(id: string) =>
		root.querySelector(`#${id}`) as T;
	const seedIn = $<HTMLInputElement>("seed");
	const checked = (name: string) =>
		(root.querySelector(`input[name=${name}]:checked`) as HTMLInputElement)
			.value;

	const showTheme = () => {
		const t = musicTheme(Number(seedIn.value) >>> 0);
		$("theme").textContent =
			`${NOTE[t.tonic]} ${t.calmMode}, ${t.bpm} bpm, bell ×${t.bellRatio}`;
	};
	showTheme();
	seedIn.oninput = showTheme;
	$("random").onclick = () => {
		seedIn.value = String(Math.floor(Math.random() * 2 ** 32));
		showTheme();
	};

	const fx = new AudioFX();
	const music = new Music();
	let state = initialMusicState();
	let timer: number | null = null;

	$("start").onclick = () => {
		fx.ensure();
		const ctx = fx.context;
		const bus = fx.musicInput;
		if (!ctx || !bus) return;
		music.attach(ctx, bus).catch(() => {});
		($("start") as HTMLButtonElement).disabled = true;
		timer ??= window.setInterval(tick, STEP_S * 1000);
	};

	function tick() {
		const reading: MusicReading = {
			...QUIET_READING,
			scene: checked("scene") as MusicScene,
			ready: music.ready,
			cruise: $<HTMLInputElement>("cruise").checked,
			systemSeed: Number(seedIn.value) >>> 0,
			stationRole: $<HTMLSelectElement>("role").value as StationType,
		};
		const step = stepMusic(state, reading, STEP_S, {
			...DEFAULT_MUSIC_ARMS,
			force: checked("level") as MusicLevel,
			bed: $<HTMLSelectElement>("bed").value as MusicBed,
		});
		state = step.state;
		for (const cmd of step.commands) music.send(cmd);
		// The numbers station, far off in the music (#600).
		renderNumbersAhead(numbersPhrase(reading.systemSeed, state.voiceN));
		if (step.voice) sayNumbers(fx, step.voice);
		$("state").textContent = [
			`bed      ${state.bed}${state.bed === "flight" ? ` (${state.flightId}, variant ${state.variant})` : ""}`,
			`level    ${state.level}${state.fallS > 0 ? `  falling in ${(FALL_HOLD_S - state.fallS).toFixed(1)} s` : ""}`,
			`cruise   ${state.cruise}`,
			`synth    ${music.ready ? "ready" : "loading"}`,
		].join("\n");
		$("errors").textContent = music.errors.join("\n");
	}
}
