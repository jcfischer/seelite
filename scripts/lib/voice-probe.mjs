/**
 * What the two voice scripts share (#604): `probe-neural-voice.mjs` (the
 * gate, no model) and `measure-neural-voice.mjs` (the voice itself, by
 * hand). One copy each, so a change to `speak`'s signature or the question's
 * markup is made once.
 */

/**
 * An init script: `window.__spySpeak(on)` reports every line handed to the
 * engine — its length, its bus and whether it has a room — and returns a
 * restore. Pass it to `context.addInitScript` before the page loads.
 */
export const installSpeakSpy = () => {
	window.__spySpeak = (on) => {
		const audio = window.__seelite.audio;
		const speak = audio.speak.bind(audio);
		audio.speak = (x, rate, bus, space) => {
			on({ n: x.length, bus: bus ?? "console", space: !!space });
			return speak(x, rate, bus, space);
		};
		return () => {
			audio.speak = speak;
		};
	};
};

/** The question's Download row names its size: it arrives after the view. */
export const waitForVoiceSize = (page, timeout = 30000) =>
	page.waitForFunction(
		() =>
			/\d MB/.test(
				document.querySelector('#seelite-commander [data-row="0"]')
					?.textContent ?? "",
			),
		null,
		{ timeout },
	);
