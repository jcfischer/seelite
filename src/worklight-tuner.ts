/**
 * A dev panel for the principal's work-light comparison (node #818,
 * 2026-10-12): sliders that move the baked lights' gain and the real-time
 * arm — intensity, how many lights, how many cast shadows — while flying.
 * Its buttons switch the mode itself — baked, real-time or off — in place.
 * Mounted by `shipyard-flight.ts` only on a URL that names `worklights`; the
 * game never shows it. A slider gives the keyboard back to the game as soon as
 * it is let go, so flight keys are not swallowed by a focused input.
 */
import {
	setRealtimeWorkLights,
	setWorkLightGain,
	setWorkLightMode,
	type WorkLightMode,
	workLightTuning,
} from "./shipyard-flight";

interface Slider {
	label: string;
	min: number;
	max: number;
	step: number;
	value: number;
	apply: (value: number) => void;
}

export function mountWorkLightTuner(): void {
	if (document.getElementById("worklight-tuner")) return;
	const panel = document.createElement("div");
	panel.id = "worklight-tuner";
	panel.style.cssText =
		"position:fixed;top:12px;right:12px;z-index:10000;padding:10px 12px;" +
		"background:rgba(8,12,18,.82);color:#cfe3f0;font:12px/1.4 ui-monospace,monospace;" +
		"border:1px solid #2c4a5c;border-radius:6px;min-width:240px";
	const title = document.createElement("div");
	title.textContent = "work lights";
	title.style.cssText = "margin-bottom:6px;color:#ffd38a";
	const modes = document.createElement("div");
	modes.style.cssText = "display:flex;gap:4px;margin-bottom:8px";
	const body = document.createElement("div");
	panel.append(title, modes, body);
	const buttons = (["baked", "realtime", "off"] as const).map((mode) => {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = mode;
		button.style.cssText =
			"flex:1;padding:3px 6px;font:inherit;color:inherit;cursor:pointer;" +
			"background:#13202b;border:1px solid #2c4a5c;border-radius:4px";
		button.addEventListener("click", () => {
			setWorkLightMode(mode);
			show(mode);
			button.blur();
		});
		modes.append(button);
		return { mode, button };
	});
	const show = (mode: WorkLightMode) => {
		for (const b of buttons)
			b.button.style.background = b.mode === mode ? "#2c5a73" : "#13202b";
		body.replaceChildren(...rows(mode));
	};
	show(workLightTuning.mode);
	document.body.append(panel);
}

function rows(mode: WorkLightMode): HTMLElement[] {
	const realtime = workLightTuning.realtime;
	const sliders: Slider[] =
		mode === "baked"
			? [
					{
						label: "gain",
						min: 0,
						max: 40,
						step: 0.5,
						value: workLightTuning.gain,
						apply: setWorkLightGain,
					},
					{
						label: "ship gain",
						min: 0,
						max: 20,
						step: 0.1,
						value: workLightTuning.shipGain,
						apply: (v) => {
							workLightTuning.shipGain = v;
						},
					},
				]
			: mode === "realtime"
				? [
						{
							label: "intensity",
							min: 0,
							max: 400,
							step: 5,
							value: realtime.intensity ?? 50,
							apply: (v) =>
								setRealtimeWorkLights({
									...workLightTuning.realtime,
									intensity: v,
								}),
						},
						{
							label: "lights",
							min: 0,
							max: 16,
							step: 1,
							value: realtime.count,
							apply: (v) =>
								setRealtimeWorkLights({
									...workLightTuning.realtime,
									count: v,
								}),
						},
						{
							label: "shadowed",
							min: 0,
							max: 8,
							step: 1,
							value: realtime.shadows,
							apply: (v) =>
								setRealtimeWorkLights({
									...workLightTuning.realtime,
									shadows: v,
								}),
						},
					]
				: [];
	const out: HTMLElement[] = [];
	for (const s of sliders) {
		const row = document.createElement("label");
		row.style.cssText =
			"display:grid;grid-template-columns:70px 1fr 44px;gap:6px;align-items:center";
		const name = document.createElement("span");
		name.textContent = s.label;
		const input = document.createElement("input");
		input.type = "range";
		input.min = String(s.min);
		input.max = String(s.max);
		input.step = String(s.step);
		input.value = String(s.value);
		const value = document.createElement("span");
		value.textContent = String(s.value);
		value.style.textAlign = "right";
		input.addEventListener("input", () => {
			value.textContent = input.value;
			s.apply(Number(input.value));
		});
		// Let go of the keyboard: the game's flight keys must not move a slider.
		const release = () => input.blur();
		input.addEventListener("change", release);
		input.addEventListener("pointerup", release);
		input.addEventListener("keydown", (e) => e.stopPropagation());
		row.append(name, input, value);
		out.push(row);
	}
	if (!sliders.length) {
		const note = document.createElement("div");
		note.textContent = "no work lights";
		out.push(note);
	}
	return out;
}
