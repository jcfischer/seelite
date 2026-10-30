import * as THREE from "three";
import { TextRaster } from "./text-raster";
import { screenMount, type ScreenFrame } from "./cockpit-model";

export interface CockpitTextLine {
	text: string;
	fill?: string;
	alpha?: number;
	at?: { x: number; y: number; size: number };
	runs?: readonly { text: string; fill: string }[];
}

export const emergencyConsoleFrame = (): ScreenFrame => ({
	center: new THREE.Vector3(0, -0.125, -0.3),
	right: new THREE.Vector3(1, 0, 0),
	up: new THREE.Vector3(0, 1, 0),
	normal: new THREE.Vector3(0, 0, 1),
	widthKm: 0.18,
	heightKm: 0.045,
});

/** The screen a source draws on: `screen-<source>`, or a shared `screen-<a>+<b>` that names it; a shared screen stacks its sources in the order they are written. */
export function cockpitScreenFor(
	screens: Readonly<Record<string, ScreenFrame>>,
	source: string,
): string | undefined {
	if (screens[source]) return source;
	return Object.keys(screens).find((name) => name.split("+").includes(source));
}

/** Match live source names, and divide one physical fallback among missing sources. */
export function routeCockpitSources(
	screens: Readonly<Record<string, ScreenFrame>>,
	sources: readonly string[],
) {
	const result = new Map<
		string,
		{ kind: "named" | "fallback"; frame: ScreenFrame }
	>();
	const unique = [...new Set(sources)];
	const missing = unique.filter(
		(name) => name === "fallback" || !cockpitScreenFor(screens, name),
	);
	const fallback = screens.fallback ?? emergencyConsoleFrame();
	for (const source of unique) {
		const screen =
			source === "fallback" ? undefined : cockpitScreenFor(screens, source);
		const named = screen === undefined ? undefined : screens[screen];
		if (named) result.set(source, { kind: "named", frame: named });
		else {
			const heightKm = fallback.heightKm / missing.length;
			result.set(source, {
				kind: "fallback",
				frame: {
					...fallback,
					center: fallback.center
						.clone()
						.addScaledVector(
							fallback.up,
							fallback.heightKm / 2 -
								heightKm * (missing.indexOf(source) + 0.5),
						),
					heightKm,
				},
			});
		}
	}
	return result;
}

/** Use square texels at the model surface's aspect. */
export function textSurfaceSize(
	frame: Pick<ScreenFrame, "widthKm" | "heightKm">,
) {
	const aspect = frame.widthKm / frame.heightKm;
	return aspect >= 1
		? { width: 1024, height: Math.max(1, Math.round(1024 / aspect)) }
		: { width: Math.max(1, Math.round(1024 * aspect)), height: 1024 };
}

/** One face construction path for the scanner, instruments and text readouts. */
export function cockpitCanvasFace({
	frame,
	name,
	width,
	height,
}: {
	frame: ScreenFrame;
	name: string;
	width?: number;
	height?: number;
}) {
	const size = textSurfaceSize(frame);
	const canvas = document.createElement("canvas");
	canvas.width = width ?? size.width;
	canvas.height = height ?? size.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Cockpit text requires a 2D canvas");
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const mount = screenMount(frame);
	mount.name = `${name}-mount`;
	const face = new THREE.Mesh(
		new THREE.PlaneGeometry(frame.widthKm, frame.heightKm),
		new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
	);
	face.name = name;
	face.rotation.x = -Math.PI / 2;
	face.position.y = 0.00002;
	mount.add(face);
	return { ctx, texture, mount, frame, key: "" };
}

/** Break at word boundaries; an indivisible word remains available to the fitter. */
export function wrapCockpitText(
	text: string,
	width: number,
	measure: (text: string) => number,
): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.trim().split(/\s+/)) {
		const candidate = line ? `${line} ${word}` : word;
		if (line && measure(candidate) > width) {
			lines.push(line);
			line = word;
		} else line = candidate;
	}
	if (line) lines.push(line);
	return lines;
}

/** Fit and clip all readout lines to their own face, including long notices. */
export function paintCockpitText(
	ctx: CanvasRenderingContext2D,
	lines: readonly CockpitTextLine[],
	style: { background?: string; border?: string; padding?: number } = {},
) {
	const { width, height } = ctx.canvas;
	ctx.save();
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = style.background ?? "#01080b";
	ctx.fillRect(0, 0, width, height);
	ctx.beginPath();
	ctx.rect(0, 0, width, height);
	ctx.clip();
	if (style.border) {
		ctx.strokeStyle = style.border;
		ctx.globalAlpha = 0.72;
		ctx.lineWidth = 4;
		ctx.strokeRect(12, 12, width - 24, height - 24);
		ctx.globalAlpha = 1;
	}
	const fonts: string[] = [];
	const pad = style.padding ?? Math.min(width, height) * 0.08;
	if (height > width) {
		ctx.font = "42px ui-monospace, monospace";
		lines = lines.flatMap((line) =>
			line.at || line.runs
				? [line]
				: wrapCockpitText(
						line.text,
						width - 2 * pad,
						(text) => ctx.measureText(text).width,
					).map((text) => ({ ...line, text })),
		);
	}
	const rowHeight = (height - 2 * pad) / Math.max(1, lines.length);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	for (const [i, line] of lines.entries()) {
		let size = line.at?.size ?? Math.min(42, rowHeight * 0.85);
		ctx.font = `${size}px ui-monospace, monospace`;
		const measured = ctx.measureText(line.text).width;
		size *= Math.min(1, (width - 2 * pad) / Math.max(1, measured));
		ctx.font = `${size}px ui-monospace, monospace`;
		ctx.fillStyle = line.fill ?? "#96cdf0";
		ctx.globalAlpha = line.alpha ?? 1;
		const y = line.at?.y ?? pad + (i + 0.5) * rowHeight;
		const startX = line.at?.x ?? pad;
		ctx.textBaseline = line.at ? "alphabetic" : "middle";
		fonts.push(ctx.font);
		if (line.runs) {
			let x = startX;
			for (const run of line.runs) {
				ctx.fillStyle = run.fill;
				ctx.fillText(run.text, x, y);
				x += ctx.measureText(run.text).width;
			}
		} else ctx.fillText(line.text, startX, y);
	}
	ctx.restore();
	return fonts;
}

export type CockpitTextFace = ReturnType<typeof cockpitCanvasFace>;

/** Named faces plus one model-owned fallback for every unmatched text source. */
export class CockpitReadouts {
	readonly faces = new Map<string, CockpitTextFace>();
	readonly readings = new Map<string, readonly CockpitTextLine[]>();
	private readonly shared = new Map<string, CockpitTextFace>();
	private readonly reserved = new Set([
		"radar",
		"flight",
		"target",
		"fallback",
	]);

	constructor(
		readonly root: THREE.Group,
		readonly screens: Readonly<Record<string, ScreenFrame>>,
		fallbackFrame: ScreenFrame,
	) {
		const fallback = cockpitCanvasFace({
			frame: fallbackFrame,
			name: "readout-fallback",
		});
		this.faces.set("fallback", fallback);
		root.add(fallback.mount);
	}

	begin() {
		this.readings.clear();
	}

	write(source: string, lines: readonly CockpitTextLine[]) {
		lines = lines.filter((line) => line.text);
		if (!lines.length) return;
		this.readings.set(source, lines);
	}

	append(source: string, lines: readonly CockpitTextLine[]) {
		this.write(source, [...(this.readings.get(source) ?? []), ...lines]);
	}

	flush() {
		const fallbackLines: CockpitTextLine[] = [];
		for (const [source, lines] of this.readings) {
			const screen = cockpitScreenFor(this.screens, source);
			if (screen === undefined || this.reserved.has(source)) {
				fallbackLines.push(...lines);
				continue;
			}
			if (!this.faces.has(source)) {
				const shared = this.shared.get(screen);
				const face =
					shared ??
					cockpitCanvasFace({
						frame: this.screens[screen],
						name: `readout-${screen}`,
					});
				if (!shared) {
					this.shared.set(screen, face);
					this.root.add(face.mount);
				}
				this.faces.set(source, face);
			}
		}
		const screenLines = (screen: string) =>
			[...this.readings].flatMap(([source, lines]) =>
				!this.reserved.has(source) &&
				cockpitScreenFor(this.screens, source) === screen
					? lines
					: [],
			);
		const faces: [CockpitTextFace, readonly CockpitTextLine[]][] = [
			[this.faces.get("fallback") as CockpitTextFace, fallbackLines],
			...[...this.shared].map(
				([screen, face]): [CockpitTextFace, readonly CockpitTextLine[]] => [
					face,
					screenLines(screen),
				],
			),
		];
		for (const [face, lines] of faces) {
			const key = JSON.stringify(lines);
			if (key === face.key) continue;
			paintCockpitText(face.ctx, lines);
			face.texture.needsUpdate = true;
			face.key = key;
		}
	}
}

/** Paint the flight and target grammar through the shared cockpit text path. */
export function paintCockpitInstrument(
	instrument: {
		ctx: CanvasRenderingContext2D;
		primaryText: string;
		secondaryText: TextRaster;
	},
	title: string,
	primary: string,
	secondary: string,
	accent: string,
	designation = "",
) {
	const { ctx, secondaryText: raster } = instrument;
	const { width, height } = ctx.canvas;
	raster.setInstrumentSecondary(secondary, accent, width, height);
	const row = (
		text: string,
		y: number,
		size: number,
		fill: string,
	): CockpitTextLine => ({ text, fill, at: { x: 28, y, size } });
	const scale = Math.min(1, height / 256);
	const lines = [row(title, (height * 46) / 256, 22 * scale, accent)];
	if (designation)
		lines.push(row(designation, (height * 78) / 256, 22 * scale, accent));
	lines.push(
		row(primary, height / 2, 42 * scale, "#e7f6ff"),
		row(secondary, raster.y, 24 * scale, accent),
	);
	const fonts = paintCockpitText(ctx, lines, {
		background: "rgba(1, 8, 11, .9)",
		border: accent,
		padding: 28,
	});
	raster.font = fonts[fonts.length - 1];
	instrument.primaryText = primary;
}
