/**
 * The voice lab, on `?voice-lab&boot=direct`: the formant synthesiser and the
 * radio with the game taken out, for the principal's ear (prototype,
 * 2026-09-30). Type a phrase from the lexicon's words, or phonemes in
 * brackets; pick a voice; hear it dry, through the radio, or far off in the
 * music's echo — played through the engine's own `AudioFX.speak`, on the
 * bus and in the room the game uses, so the lab cannot drift from it.
 */
import { AudioFX } from "./audio";
import { MUSIC_VOICE_SPACE } from "./comms-voice";
import { RADIO, radio } from "./radio";
import { SPEECH_RATE, speak, VOICES } from "./speech";
import { LEXICON, textToTokens } from "./speech-lexicon";
import { speak as speakV1 } from "./speech-v1";

const PRESETS = [
	// Minimal pairs, in the manner of the Modified Rhyme Test: which of each
	// set is heard as another says what to fix.
	"[B EY1] , [D EY1] , [G EY1] . [P AE1 D] , [B AE1 D] , [T AE1 D] . [S IH1 N] , [F IH1 N] , [TH IH1 N] , [SH IH1 N] . [M EY1] , [N EY1] .",
	"Cobra one, clearance granted. Proceed to your berth.",
	"Commander, this is station control. Welcome aboard.",
	"Docking request denied. Hold position.",
	"Hostile contact. Shields up. Weapons in range.",
	"Drop your cargo or die, pilot.",
	"Mayday, mayday. Incoming missile.",
	"Jump drive charging. Good luck, commander.",
	"4 7 3 0. 9 1 5 5. 2 8 6.",
	"[HH EH1 L OW0] [W ER1 L D].",
];

export function mountVoiceLab() {
	document.body.innerHTML = "";
	document.body.style.margin = "0";
	document.body.style.background = "#0b0e12";
	const root = document.createElement("main");
	root.style.cssText =
		"font: 15px/1.5 system-ui, sans-serif; color: #dde3ea; background: #0b0e12; min-height: 100vh; padding: 24px; box-sizing: border-box; max-width: 860px;";
	root.innerHTML = `
<h1 style="margin:0 0 4px;font-size:20px">Voice lab</h1>
<p style="margin:0 0 16px;color:#8a96a3">A formant synthesiser, seelite's own, and a ship's radio. Words from the lexicon, or phonemes in brackets: <code>[K AA1 B R AH0]</code>.</p>
<p><select id="preset" style="width:100%">${PRESETS.map((p) => `<option>${p}</option>`).join("")}</select></p>
<p><textarea id="text" rows="3" style="width:100%;box-sizing:border-box;font:15px ui-monospace,monospace;background:#12171d;color:#dde3ea;border:1px solid #2a323c">${PRESETS[0]}</textarea></p>
<p>
  <label>Voice <select id="voice">${Object.keys(VOICES)
		.map((v) => `<option>${v}</option>`)
		.join("")}</select></label>
  <label style="margin-left:12px">Engine <select id="engine"><option value="locus">locus (second)</option><option value="first">first</option></select></label>
  <label style="margin-left:12px">Rate <input id="rate" type="range" min="0.7" max="1.4" step="0.05" value="1"> <span id="rateV">1.00</span></label>
  <label style="margin-left:12px">Pitch <input id="pitch" type="range" min="0.7" max="1.4" step="0.05" value="1"> <span id="pitchV">1.00</span></label>
</p>
<p>
  <label><input type="radio" name="through" value="radio" checked> Radio</label>
  <label><input type="radio" name="through" value="dry"> Dry</label>
  <label><input type="radio" name="through" value="space"> Radio, far off in the echo (music texture)</label>
  <label style="margin-left:12px"><input id="beep" type="checkbox" checked> Roger beep</label>
</p>
<p>
  <label>Radio band <input id="low" type="range" min="100" max="600" step="50" value="${RADIO.lowHz}"> <span id="lowV">${RADIO.lowHz}</span></label>
  <label style="margin-left:12px">to <input id="high" type="range" min="2000" max="5000" step="100" value="${RADIO.highHz}"> <span id="highV">${RADIO.highHz}</span> Hz</label>
</p>
<p><button id="say" style="font-size:16px;padding:6px 18px">Say it</button></p>
<pre id="info" style="font:13px ui-monospace,monospace;color:#8a96a3;background:#12171d;padding:10px;white-space:pre-wrap"></pre>
<details style="color:#8a96a3"><summary>Words the lexicon knows</summary><p style="font:13px ui-monospace,monospace">${Object.keys(LEXICON).join(" ").toLowerCase()}</p></details>`;
	document.body.appendChild(root);

	const $ = <T extends HTMLElement>(id: string) =>
		root.querySelector(`#${id}`) as T;
	const text = $<HTMLTextAreaElement>("text");
	$<HTMLSelectElement>("preset").onchange = (e) => {
		text.value = (e.target as HTMLSelectElement).value;
		say();
	};
	for (const id of ["rate", "pitch", "low", "high"])
		$<HTMLInputElement>(id).oninput = () => {
			const v = Number($<HTMLInputElement>(id).value);
			$(`${id}V`).textContent =
				id === "low" || id === "high" ? `${v}` : v.toFixed(2);
		};

	const fx = new AudioFX();

	function say() {
		fx.ensure();
		const { tokens, unknown } = textToTokens(text.value);
		const base = VOICES[$<HTMLSelectElement>("voice").value];
		const voice = {
			...base,
			rate: base.rate * Number($<HTMLInputElement>("rate").value),
			f0: base.f0 * Number($<HTMLInputElement>("pitch").value),
		};
		const t0 = performance.now();
		const engine = $<HTMLSelectElement>("engine").value;
		const dry = (engine === "first" ? speakV1 : speak)(tokens, voice);
		const through = (
			root.querySelector("input[name=through]:checked") as HTMLInputElement
		).value;
		const out =
			through === "dry"
				? dry
				: radio(dry, {
						...RADIO,
						lowHz: Number($<HTMLInputElement>("low").value),
						highHz: Number($<HTMLInputElement>("high").value),
						beepHz: $<HTMLInputElement>("beep").checked ? RADIO.beepHz : 0,
					});
		const ms = performance.now() - t0;
		if (through === "space")
			fx.speak(out, SPEECH_RATE, "music", MUSIC_VOICE_SPACE);
		else fx.speak(out, SPEECH_RATE, "console");
		$("info").textContent = [
			`${(out.length / SPEECH_RATE).toFixed(2)} s, rendered in ${ms.toFixed(0)} ms`,
			unknown.length
				? `not in the lexicon, skipped: ${unknown.join(", ")}`
				: "every word known",
			`phonemes: ${tokens.map((t) => ("ph" in t ? t.ph : "|")).join(" ")}`,
		].join("\n");
	}
	$("say").onclick = say;
}
