/**
 * The record of one string as it was painted on the glass.
 *
 * **A leaf, and it has to be.** The cockpit prompt, the flight instruments and
 * `#48`'s combat rig all publish one of these for the browser probes to read,
 * and the rig now lives in its own removable module (`combat-rig.ts`). Left in
 * `main.ts`, the rig would have had to import the renderer to get at it, which
 * closes an import cycle around the one file the extraction exists to thin.
 *
 * It touches no DOM and no Three.js: it is what the draw *decided*, recorded so
 * a probe can compare rendered glyphs against the renderer's own placement
 * contract rather than reading them back off a rescaled canvas.
 */

const INSTRUMENT_SECONDARY_FONT = "20px ui-monospace, monospace";
export const PROMPT_FONT = "13px ui-monospace, Menlo, monospace";
export const PROMPT_FILL = "rgba(255, 214, 120, 0.9)";
const TEXT_RASTER_DEFAULTS: Readonly<{
	text: string;
	font: string;
	fillStyle: string;
	textAlign: CanvasTextAlign;
	x: number;
	y: number;
	background: string | undefined;
}> = Object.freeze({
	text: "",
	font: "",
	fillStyle: "",
	textAlign: "left" as CanvasTextAlign,
	x: 0,
	y: 0,
	background: undefined as string | undefined,
});
const TEXT_RASTER_BOUNDS_DEFAULTS: Readonly<{
	left: number;
	top: number;
	width: number;
	height: number;
}> = Object.freeze({
	left: 0,
	top: 0,
	width: 0,
	height: 0,
});

export class TextRaster {
	text = TEXT_RASTER_DEFAULTS.text;
	font = TEXT_RASTER_DEFAULTS.font;
	fillStyle = TEXT_RASTER_DEFAULTS.fillStyle;
	textAlign = TEXT_RASTER_DEFAULTS.textAlign;
	x = TEXT_RASTER_DEFAULTS.x;
	y = TEXT_RASTER_DEFAULTS.y;
	bounds = { ...TEXT_RASTER_BOUNDS_DEFAULTS };
	background = TEXT_RASTER_DEFAULTS.background;

	reset() {
		Object.assign(this, TEXT_RASTER_DEFAULTS);
		Object.assign(this.bounds, TEXT_RASTER_BOUNDS_DEFAULTS);
	}

	setInstrumentSecondary(
		text: string,
		accent: string,
		canvasWidth: number,
		canvasHeight = 256,
	) {
		this.reset();
		this.text = text;
		const scale = Math.min(1, canvasHeight / 256);
		this.font =
			canvasHeight === 256
				? INSTRUMENT_SECONDARY_FONT
				: `${24 * scale}px ui-monospace, monospace`;
		this.fillStyle = accent;
		this.textAlign = "left";
		this.x = 28;
		this.y = canvasHeight * 0.75;
		this.bounds.left = 28;
		this.bounds.top = this.y - 24 * scale;
		this.bounds.width = canvasWidth - 56;
		this.bounds.height = 30 * scale;
		this.background = "rgba(1, 8, 11, .9)";
	}

	setCenteredPrompt(
		text: string,
		x: number,
		y: number,
		width: number,
		font = PROMPT_FONT,
	) {
		this.reset();
		this.text = text;
		this.font = font;
		this.fillStyle = PROMPT_FILL;
		this.textAlign = "center";
		this.x = x;
		this.y = y;
		this.bounds.left = Math.floor(x - width / 2);
		this.bounds.top = Math.floor(y - 14);
		this.bounds.width = Math.ceil(width);
		this.bounds.height = 18;
		this.background = undefined;
	}
}
