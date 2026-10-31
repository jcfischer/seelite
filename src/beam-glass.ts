/**
 * The cockpit's laser beams as strokes in the frame (node #806), and the quads
 * that draw them.
 *
 * **Why the beams left the overlay.** In cockpit view the player's tracer and
 * the raider's beam were stroked on `#overlay`, the 2D canvas the page stacks
 * over the WebGL canvas, clipped at the old procedural cabin's glass line. The
 * authored cabin (#794) reaches above that line — its dash top on the centre
 * line is at 0.600 of the frame height as node #806 placed it, against a line
 * at 0.66 (`tests/cockpit-model.test.ts`) — and nothing on another canvas can be hidden
 * by #651's cabin pass, so a fired laser was drawn over the dash and the canopy
 * struts. The strokes are now drawn into the frame by a pass of their own
 * between the near layer and the cabin (`beam-layer.ts`), so the cabin pass
 * draws over them wherever a fitting is in front: the cabin is the occluder,
 * and no glass line is needed.
 *
 * Chase view keeps its beams on the overlay: it has no cabin, so nothing there
 * can be in front of them.
 *
 * Positions are fractions of the frame, x right and y down, as the overlay's
 * `TRACER_PORTS` are; a width is in CSS pixels, as the overlay's line widths
 * were. No Three.js here: what is decided is arithmetic, and it is tested
 * headless.
 */

/** A point on the frame, as fractions of its width and height, y down. */
export interface FramePoint {
	readonly x: number;
	readonly y: number;
}

/** The shared cockpit stroke capacity, including mining beams. */
export const BEAM_CAPACITY = 128;

/** One beam: a line across the frame, its width and its colour. */
export interface BeamStroke {
	readonly from: FramePoint;
	readonly to: FramePoint;
	/** Full width, CSS pixels. */
	readonly widthPx: number;
	/** Linear working-space colour, before the output stage's tone mapping. */
	readonly rgb: readonly [number, number, number];
	readonly alpha: number;
}

/**
 * The player's beam colour, in linear working space.
 *
 * **The beam is tone-mapped now, so its colour is chosen through ACES.** On
 * the overlay it was `TRACER_COLOUR`, a display-space cyan; in the frame it
 * goes through the output stage's ACES filmic curve at exposure 1
 * (`LIGHT_RIG.quality`, both rows). That curve desaturates, and the overlay's
 * cyan itself is out of its reach: carried in as plain linear it would display
 * about (170, 220, 225), grey-cyan. This triple displays about (169, 230, 240)
 * by three's `ACESFilmicToneMapping` formula, with a luminance of 0.912 —
 * under `EXPOSURE.bloom.threshold`, so the beam raises no halo that could
 * spill over a fitting's edge. Those display figures are computed from the
 * shader's formula, not read off a screen; the frame is the principal's to
 * judge.
 */
export const PLAYER_BEAM_RGB = [0, 1.09, 1.83] as const;
/** The overlay tracer's alpha and width (`TRACER_COLOUR`, 3 px). */
export const PLAYER_BEAM_ALPHA = 0.98;
export const PLAYER_BEAM_WIDTH_PX = 3;

/**
 * The raider's beam colour, in linear working space: `ENEMY_BEAM_COLOUR`'s
 * (255, 140, 90) carried back through the same ACES curve, which reaches it
 * (luminance 0.405, under the bloom threshold).
 */
export const RAIDER_BEAM_RGB = [1.364, 0.154, 0.068] as const;
/** The overlay beam's alpha and width (`ENEMY_BEAM_COLOUR`, 2.5 px). */
export const RAIDER_BEAM_ALPHA = 0.95;
export const RAIDER_BEAM_WIDTH_PX = 2.5;

/**
 * Where the raider's beam ends in the cockpit: the pilot, below the frame's
 * bottom edge on its centre line. The overlay ended it on the glass line,
 * which is now on the dash; ended below the frame, the dash hides the part of
 * the beam that would reach the pilot through it.
 */
export const RAIDER_BEAM_END: FramePoint = { x: 0.5, y: 1 };

/** The player's tracer, one stroke per gun port, each to where the beam meets
 *  the glass. */
export function tracerStrokes(
	ports: readonly FramePoint[],
	aim: FramePoint,
): BeamStroke[] {
	return ports.map((port) => ({
		from: port,
		to: aim,
		widthPx: PLAYER_BEAM_WIDTH_PX,
		rgb: PLAYER_BEAM_RGB,
		alpha: PLAYER_BEAM_ALPHA,
	}));
}

/** The raider's beam, from its point on the frame to the pilot. */
export function raiderBeamStroke(from: FramePoint): BeamStroke {
	return {
		from,
		to: RAIDER_BEAM_END,
		widthPx: RAIDER_BEAM_WIDTH_PX,
		rgb: RAIDER_BEAM_RGB,
		alpha: RAIDER_BEAM_ALPHA,
	};
}

/** How far past a stroke's half width its quad reaches, buffer pixels: room
 *  for the one-pixel ramp that antialiases the edge. */
export const BEAM_FEATHER_PX = 1;

/** Vertices per stroke: two triangles, unindexed. */
export const BEAM_VERTICES_PER_STROKE = 6;

/** Attribute arrays for `strokes`, sized for at most `capacity` strokes. */
export interface BeamQuads {
	/** Clip-space x, y per vertex. */
	readonly position: Float32Array;
	/** Per vertex: signed distance across the stroke from its centre line, and
	 *  its half width, both in buffer pixels. The fragment's coverage is
	 *  `clamp(half + 0.5 − |across|, 0, 1)`. */
	readonly edge: Float32Array;
	/** Linear rgb and alpha per vertex. */
	readonly colour: Float32Array;
	/** Vertices written. */
	count: number;
}

export function newBeamQuads(capacity: number): BeamQuads {
	const n = capacity * BEAM_VERTICES_PER_STROKE;
	return {
		position: new Float32Array(n * 2),
		edge: new Float32Array(n * 2),
		colour: new Float32Array(n * 4),
		count: 0,
	};
}

/**
 * Write `strokes` into `out` as clip-space quads for a drawing buffer of
 * `bufferW` × `bufferH` pixels at `pxPerCss` buffer pixels per CSS pixel.
 *
 * Widths are scaled by `pxPerCss` so a beam is as wide on screen whatever the
 * buffer's resolution: the overlay is a CSS-pixel canvas, and the drawing
 * buffer is the device's ratio times the adaptive resolution's (#352). A
 * stroke with no length draws nothing, and strokes past the capacity are
 * dropped rather than overrunning the arrays. Returns `out`.
 */
export function writeBeamQuads(
	strokes: readonly BeamStroke[],
	bufferW: number,
	bufferH: number,
	pxPerCss: number,
	out: BeamQuads,
): BeamQuads {
	const capacity = out.position.length / (2 * BEAM_VERTICES_PER_STROKE);
	let v = 0;
	for (const s of strokes) {
		if (v / BEAM_VERTICES_PER_STROKE >= capacity) break;
		const ax = s.from.x * bufferW;
		const ay = s.from.y * bufferH;
		const bx = s.to.x * bufferW;
		const by = s.to.y * bufferH;
		const len = Math.hypot(bx - ax, by - ay);
		if (!(len > 0)) continue;
		// The unit normal, in buffer pixels.
		const nx = -(by - ay) / len;
		const ny = (bx - ax) / len;
		const half = (s.widthPx * pxPerCss) / 2;
		const reach = half + BEAM_FEATHER_PX;
		const corner = (px: number, py: number, side: number) => {
			const x = px + nx * reach * side;
			const y = py + ny * reach * side;
			out.position[v * 2] = (x / bufferW) * 2 - 1;
			out.position[v * 2 + 1] = 1 - (y / bufferH) * 2;
			out.edge[v * 2] = reach * side;
			out.edge[v * 2 + 1] = half;
			out.colour[v * 4] = s.rgb[0];
			out.colour[v * 4 + 1] = s.rgb[1];
			out.colour[v * 4 + 2] = s.rgb[2];
			out.colour[v * 4 + 3] = s.alpha;
			v++;
		};
		corner(ax, ay, -1);
		corner(bx, by, -1);
		corner(bx, by, 1);
		corner(ax, ay, -1);
		corner(bx, by, 1);
		corner(ax, ay, 1);
	}
	out.count = v;
	return out;
}
