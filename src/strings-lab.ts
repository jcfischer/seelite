/**
 * The strings lab (#547 D15), on `?strings-lab&boot=direct`: every knob of the
 * `strings` voice as a slider, on the real synth and the real music bus, for
 * the principal to tune a desk by ear and copy the result into
 * `music-danube.ts`.
 *
 * **The sliders are built from `STRINGS_PARAMS`**, so a knob added to that
 * table appears here with no code in this file. Pick a voicing and one of its
 * strings desks, and the sliders show that desk; play a note, a chord or a
 * legato phrase at any pitch, or the waltz itself with the edited desk in it.
 * A/B swaps in the shipped desk; Reset drops the edits; Copy as source gives
 * a `PartSpec` literal. Edits are kept in `localStorage`.
 *
 * A listening surface, not a game mode: no world, no render loop, and nothing
 * here reaches the network.
 */
import { AudioFX } from "./audio";
import { Music } from "./music";
import {
	DANUBE_VOICINGS,
	type DanubePart,
	type DanubeVoicing,
} from "./music-danube";
import type { PartSpec, Song } from "./music-score";
import {
	fmt,
	labSong,
	labWaltz,
	noteName,
	slidersHtml,
	sourceLiteral,
	stringsDesks,
} from "./strings-lab-model";
import { STRINGS_PARAMS, type StringsKey } from "./strings-params";

const STORE = "seelite.strings-lab.v1";

interface Stored {
	voicing: DanubeVoicing;
	desk: DanubePart;
	pitch: number;
	/** Whether the desk was picked by hand. A stored desk that was only the
	 *  old default is not kept: the lab opens on the horn call (D16). */
	deskChosen?: boolean;
	edits: Record<string, Partial<Record<StringsKey, number>>>;
}

function readStore(): Stored {
	const fresh: Stored = {
		voicing: "orchestra",
		desk: "horn",
		pitch: 57,
		edits: {},
	};
	try {
		const raw = localStorage.getItem(STORE);
		if (!raw) return fresh;
		const s = JSON.parse(raw) as Partial<Stored>;
		const voicing = (s.voicing ?? fresh.voicing) as DanubeVoicing;
		if (!DANUBE_VOICINGS[voicing]) return fresh;
		const desks = stringsDesks(voicing);
		return {
			voicing,
			desk:
				s.deskChosen && desks.includes(s.desk as DanubePart)
					? (s.desk as DanubePart)
					: desks.includes(fresh.desk)
						? fresh.desk
						: desks[0],
			deskChosen: s.deskChosen === true,
			pitch: typeof s.pitch === "number" ? s.pitch : fresh.pitch,
			edits: s.edits && typeof s.edits === "object" ? s.edits : {},
		};
	} catch {
		return fresh;
	}
}

function writeStore(s: Stored) {
	try {
		localStorage.setItem(STORE, JSON.stringify(s));
	} catch {
		// A private window or a full store: the lab still works, unsaved.
	}
}

export function mountStringsLab() {
	document.body.innerHTML = "";
	document.body.style.margin = "0";
	document.body.style.background = "#0b0e12";
	const root = document.createElement("main");
	root.style.cssText =
		"font: 14px/1.4 system-ui, sans-serif; color: #dde3ea; background: #0b0e12; min-height: 100vh; padding: 20px; box-sizing: border-box; max-width: 980px";
	document.body.appendChild(root);

	const state = readStore();
	let ab: "edited" | "shipped" = "edited";
	let waltzOn = false;
	let ids = 0;
	let pending: number | null = null;

	const key = () => `${state.voicing}/${state.desk}`;
	const shipped = (): PartSpec => DANUBE_VOICINGS[state.voicing][state.desk];
	const edited = (): PartSpec =>
		({ ...shipped(), ...(state.edits[key()] ?? {}) }) as PartSpec;
	const current = (): PartSpec => (ab === "shipped" ? shipped() : edited());

	root.innerHTML = `
<h1 style="margin:0 0 4px;font-size:20px">Strings lab</h1>
<p style="margin:0 0 12px;color:#8a96a3">#547's bowed strings, through the real synth and music bus. Edits apply from the next note; while the waltz plays, a change restarts it from the top of the waltz on the next bar.</p>
<p><button id="start">Start sound</button>
  <span id="meter" style="display:inline-block;width:160px;height:8px;background:#1b222a;vertical-align:middle;margin-left:12px"><span id="bar" style="display:block;height:100%;width:0;background:#4f9d69"></span></span>
  <span id="status" style="margin-left:8px;color:#8a96a3"></span></p>
<fieldset style="border:1px solid #2a323c;margin:0 0 10px"><legend>Desk</legend>
  <label>Voicing <select id="voicing">${Object.keys(DANUBE_VOICINGS)
		.map((v) => `<option>${v}</option>`)
		.join("")}</select></label>
  <label style="margin-left:12px">Desk <select id="desk"></select></label>
  <button id="reset" style="margin-left:12px">Reset desk</button>
  <button id="ab">A/B: edited</button>
  <button id="copy">Copy as source</button>
</fieldset>
<fieldset style="border:1px solid #2a323c;margin:0 0 10px"><legend>Play</legend>
  <label>Pitch <input id="pitch" type="range" min="24" max="96" step="1" style="width:18em"> <output id="pitchOut"></output></label><br>
  <button id="note">Held note</button>
  <button id="chord">Held chord</button>
  <button id="phrase">Legato phrase</button>
  <button id="waltz">Play the waltz</button>
  <button id="stop">Stop</button>
</fieldset>
<div id="sliders"></div>
<textarea id="source" rows="10" style="width:100%;font:12px ui-monospace,monospace;background:#12171d;color:#dde3ea;border:1px solid #2a323c"></textarea>
<pre id="errors" style="font:12px ui-monospace,monospace;color:#e0a040"></pre>`;

	const $ = <T extends HTMLElement>(id: string) =>
		root.querySelector(`#${id}`) as T;
	const voicingIn = $<HTMLSelectElement>("voicing");
	const deskIn = $<HTMLSelectElement>("desk");
	const pitchIn = $<HTMLInputElement>("pitch");

	const fx = new AudioFX();
	const music = new Music();
	let analyser: AnalyserNode | null = null;
	const samples = new Float32Array(2048);

	const level = () => {
		if (!analyser) return 0;
		analyser.getFloatTimeDomainData(samples);
		let s = 0;
		for (const v of samples) s += v * v;
		return Math.sqrt(s / samples.length);
	};
	(window as unknown as { __stringsLab: unknown }).__stringsLab = {
		level,
		ready: () => music.ready,
		errors: music.errors,
		params: STRINGS_PARAMS.length,
	};

	const showSource = () => {
		$<HTMLTextAreaElement>("source").value = sourceLiteral(edited());
	};
	const renderSliders = () => {
		$("sliders").innerHTML = slidersHtml(current());
		showSource();
	};
	const renderDesks = () => {
		deskIn.innerHTML = stringsDesks(state.voicing)
			.map((d) => `<option${d === state.desk ? " selected" : ""}>${d}</option>`)
			.join("");
	};
	const save = () => writeStore(state);

	const send = (song: Song, section?: string, fade = false) => {
		const id = `lab-${++ids}`;
		music.load(id, song);
		if (fade)
			music.send({
				type: "crossfade",
				to: id,
				section,
				at: "bar",
				fadeS: 0.25,
			});
		else music.send({ type: "play", id, section, at: "bar" });
	};
	const playWaltz = (fade: boolean) =>
		send(
			labWaltz(state.voicing, state.desk, current()),
			fade ? "waltz" : undefined,
			fade,
		);
	const changed = () => {
		save();
		showSource();
		if (!waltzOn) return;
		if (pending !== null) window.clearTimeout(pending);
		pending = window.setTimeout(() => {
			pending = null;
			playWaltz(true);
		}, 400);
	};

	voicingIn.value = state.voicing;
	pitchIn.value = String(state.pitch);
	$("pitchOut").textContent = noteName(state.pitch);
	renderDesks();
	renderSliders();

	$("start").onclick = () => {
		fx.ensure();
		const ctx = fx.context;
		const bus = fx.musicInput;
		if (!ctx || !bus) return;
		analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		analyser.connect(bus);
		music.attach(ctx, analyser).catch(() => {});
		($("start") as HTMLButtonElement).disabled = true;
		const tick = () => {
			const v = level();
			$("bar").style.width = `${Math.min(100, v * 600)}%`;
			$("status").textContent = music.ready ? "ready" : "loading";
			$("errors").textContent = music.errors.join("\n");
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};

	voicingIn.onchange = () => {
		state.voicing = voicingIn.value as DanubeVoicing;
		const desks = stringsDesks(state.voicing);
		if (!desks.includes(state.desk)) state.desk = desks[0];
		renderDesks();
		renderSliders();
		changed();
	};
	deskIn.onchange = () => {
		state.desk = deskIn.value as DanubePart;
		state.deskChosen = true;
		renderSliders();
		changed();
	};
	$("sliders").addEventListener("input", (e) => {
		const el = e.target as HTMLInputElement;
		const k = el.dataset.param as StringsKey | undefined;
		if (!k) return;
		const p = STRINGS_PARAMS.find((x) => x.key === k);
		if (!p) return;
		const v = Number(el.value);
		const edits = { ...(state.edits[key()] ?? {}), [k]: v };
		state.edits[key()] = edits;
		if (ab === "shipped") {
			// Back to the edited desk: every slider shows it, not only this one
			// (sage round 1 — the others went on showing the shipped values).
			ab = "edited";
			$("ab").textContent = "A/B: edited";
			renderSliders();
		}
		const out = root.querySelector(`output[data-out="${k}"]`);
		if (out) out.textContent = fmt(p, v);
		changed();
	});
	pitchIn.oninput = () => {
		state.pitch = Number(pitchIn.value);
		$("pitchOut").textContent = noteName(state.pitch);
		save();
	};
	$("reset").onclick = () => {
		delete state.edits[key()];
		renderSliders();
		changed();
	};
	$("ab").onclick = () => {
		ab = ab === "edited" ? "shipped" : "edited";
		$("ab").textContent = `A/B: ${ab}`;
		renderSliders();
		changed();
	};
	$("copy").onclick = () => {
		const text = sourceLiteral(edited());
		$<HTMLTextAreaElement>("source").value = text;
		try {
			void navigator.clipboard?.writeText(text).catch(() => {});
		} catch {
			// No clipboard here: the text is in the box below, to copy by hand.
		}
	};
	for (const kind of ["note", "chord", "phrase"] as const)
		$(kind).onclick = () => {
			waltzOn = false;
			send(labSong(current(), kind, state.pitch));
		};
	$("waltz").onclick = () => {
		waltzOn = true;
		playWaltz(false);
	};
	$("stop").onclick = () => {
		waltzOn = false;
		music.send({ type: "stop", at: "now", fadeS: 0.3 });
	};
}
