import { describe, expect, test } from "bun:test";
import {
	BEAM_FEATHER_PX,
	BEAM_VERTICES_PER_STROKE,
	newBeamQuads,
	PLAYER_BEAM_RGB,
	PLAYER_BEAM_WIDTH_PX,
	RAIDER_BEAM_END,
	RAIDER_BEAM_RGB,
	raiderBeamStroke,
	tracerStrokes,
	writeBeamQuads,
} from "../src/beam-glass";
import { TRACER_AIM, tracerPorts } from "../src/gun-feedback";
import { EXPOSURE } from "../src/light-rig";

const luminance = (c: readonly number[]) =>
	0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Vertex `i`'s clip-space position back in buffer pixels, y down. */
const px = (
	q: { position: Float32Array },
	i: number,
	w: number,
	h: number,
) => ({
	x: ((q.position[i * 2] + 1) / 2) * w,
	y: ((1 - q.position[i * 2 + 1]) / 2) * h,
});

describe("the cockpit's beam strokes", () => {
	test("one tracer stroke per gun, each from its port to the aim", () => {
		for (const guns of [0, 1, 2, 3]) {
			const ports = tracerPorts(guns);
			const strokes = tracerStrokes(ports, TRACER_AIM);
			expect(strokes).toHaveLength(guns);
			strokes.forEach((s, i) => {
				expect(s.from).toEqual(ports[i]);
				expect(s.to).toEqual(TRACER_AIM);
			});
		}
	});

	test("the raider's beam ends below the frame, where the dash can hide it", () => {
		const s = raiderBeamStroke({ x: 0.3, y: 0.2 });
		expect(s.to).toEqual(RAIDER_BEAM_END);
		expect(RAIDER_BEAM_END.y).toBeGreaterThanOrEqual(1);
	});

	test("neither beam is bright enough to raise a bloom halo over a fitting", () => {
		for (const rgb of [PLAYER_BEAM_RGB, RAIDER_BEAM_RGB])
			expect(luminance(rgb)).toBeLessThan(EXPOSURE.bloom.threshold);
	});
});

describe("a stroke's quad", () => {
	const W = 1600;
	const H = 1000;

	test("covers the segment at its width, in buffer pixels", () => {
		const q = newBeamQuads(4);
		const stroke = tracerStrokes([{ x: 0.25, y: 0.75 }], { x: 0.5, y: 0.5 })[0];
		writeBeamQuads([stroke], W, H, 2, q);
		expect(q.count).toBe(BEAM_VERTICES_PER_STROKE);
		const half = (PLAYER_BEAM_WIDTH_PX * 2) / 2;
		const reach = half + BEAM_FEATHER_PX;
		const a = { x: 0.25 * W, y: 0.75 * H };
		const b = { x: 0.5 * W, y: 0.5 * H };
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		for (let i = 0; i < q.count; i++) {
			const p = px(q, i, W, H);
			// Distance from the segment's line equals the stroke's reach.
			const cross =
				((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
			// Float32 clip coordinates hold a pixel to about 1e-4 at this size.
			expect(Math.abs(cross)).toBeCloseTo(reach, 3);
			expect(Math.abs(q.edge[i * 2])).toBeCloseTo(reach, 6);
			expect(Math.sign(q.edge[i * 2])).toBe(Math.sign(cross));
			expect(q.edge[i * 2 + 1]).toBeCloseTo(half, 9);
			// And its ends are the segment's ends.
			const along =
				((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
			expect(Math.min(Math.abs(along), Math.abs(along - len))).toBeLessThan(
				1e-3,
			);
		}
	});

	test("both triangles face the same way and together span the quad", () => {
		const q = newBeamQuads(1);
		writeBeamQuads([raiderBeamStroke({ x: 0.7, y: 0.1 })], W, H, 1, q);
		const area = (i: number) => {
			const [p0, p1, p2] = [0, 1, 2].map((k) => px(q, i + k, W, H));
			return (
				((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2
			);
		};
		const a0 = area(0);
		const a1 = area(3);
		expect(Math.sign(a0)).toBe(Math.sign(a1));
		const s = raiderBeamStroke({ x: 0.7, y: 0.1 });
		const len = Math.hypot((s.to.x - s.from.x) * W, (s.to.y - s.from.y) * H);
		const reach = s.widthPx / 2 + BEAM_FEATHER_PX;
		expect(Math.abs(a0) + Math.abs(a1)).toBeCloseTo(len * 2 * reach, 1);
	});

	test("a width is held on screen whatever the buffer's resolution", () => {
		const stroke = tracerStrokes([{ x: 0.2, y: 0.6 }], TRACER_AIM)[0];
		for (const ratio of [0.5, 1, 2]) {
			const q = writeBeamQuads(
				[stroke],
				W * ratio,
				H * ratio,
				ratio,
				newBeamQuads(1),
			);
			expect(q.edge[1]).toBeCloseTo((PLAYER_BEAM_WIDTH_PX * ratio) / 2, 9);
		}
	});

	test("carries each stroke's colour and alpha to every vertex", () => {
		const q = writeBeamQuads(
			[
				...tracerStrokes([{ x: 0.2, y: 0.6 }], TRACER_AIM),
				raiderBeamStroke({ x: 0.6, y: 0.3 }),
			],
			W,
			H,
			1,
			newBeamQuads(2),
		);
		expect(q.count).toBe(2 * BEAM_VERTICES_PER_STROKE);
		for (let i = 0; i < q.count; i++) {
			const rgb =
				i < BEAM_VERTICES_PER_STROKE ? PLAYER_BEAM_RGB : RAIDER_BEAM_RGB;
			for (let c = 0; c < 3; c++)
				expect(q.colour[i * 4 + c]).toBeCloseTo(rgb[c], 6);
			expect(q.colour[i * 4 + 3]).toBeGreaterThan(0.9);
		}
	});

	test("a stroke with no length draws nothing, and the capacity is not overrun", () => {
		const still = tracerStrokes([TRACER_AIM], TRACER_AIM);
		expect(writeBeamQuads(still, W, H, 1, newBeamQuads(1)).count).toBe(0);
		const many = tracerStrokes(tracerPorts(5), TRACER_AIM);
		const q = writeBeamQuads(many, W, H, 1, newBeamQuads(2));
		expect(q.count).toBe(2 * BEAM_VERTICES_PER_STROKE);
	});
});
