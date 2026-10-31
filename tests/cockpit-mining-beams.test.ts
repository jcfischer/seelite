import { expect, test } from "bun:test";
import {
	BEAM_CAPACITY,
	BEAM_VERTICES_PER_STROKE,
	newBeamQuads,
	writeBeamQuads,
} from "../src/beam-glass";
import { fireGroups } from "../src/fire-group";
import { HULL_SPECS } from "../src/hull";
import {
	glassTracerIndices,
	groupMuzzleIndices,
	hardpointKeys,
} from "../src/laser-modules";
import { type Loadout, makeModule, stockLoadout } from "../src/loadout";
import { ndcToPx, projectDirection } from "../src/hud";
import { MINING_BEAM_RGB, mountBeamStrokes } from "../src/mining-beam";
import { v3 } from "../src/vec3";

const spec = HULL_SPECS.miner;

const loadout = (h3: boolean): Loadout => ({
	...stockLoadout("miner"),
	h1: makeModule("pulse-laser", 1),
	h2: makeModule("mining-laser", 3, "A"),
	...(h3 ? { h3: makeModule("mining-laser", 3, "A") } : {}),
});

function fireGroupsWith(lo: Loadout) {
	return fireGroups(lo, "miner", true);
}

for (const h3 of [false, true])
	for (const group of fireGroupsWith(loadout(h3)).filter(
		(g) => g.kind === "lasers",
	))
		test(`${h3 ? "h2+h3" : "h2"}, ${group.label}: one cockpit beam per armed laser, a Mining Laser never from the glass (F1)`, () => {
			const lo = loadout(h3);
			const fired = groupMuzzleIndices("miner", group);
			const glass = glassTracerIndices("miner", lo, fired, true);
			const keys = hardpointKeys("miner");
			const mining = fired.filter(
				(i) => lo[keys[i]]?.module === "mining-laser",
			);
			expect(glass.length + mining.length).toBe(group.slots.length);
			for (const i of glass)
				expect(lo[keys[i]]?.module).not.toBe("mining-laser");
		});

test("without mounts a Mining Laser keeps its glass tracer", () => {
	const lo = loadout(false);
	expect(glassTracerIndices("miner", lo, [0, 1], false)).toEqual([0, 1]);
});

test("a mount's beam is drawn in the frame from its muzzle as the cockpit camera sees it (F2)", () => {
	const muzzle = v3(0.0053, 0.00581, -0.0148);
	const end = v3(0.0053, 0.00581, -2.5);
	const fov = Math.PI / 3;
	const strokes = mountBeamStrokes(
		[{ muzzle, end, hit: false }],
		v3(0, 0, 0),
		{ x: 0, y: 0, z: 0, w: 1 },
		fov,
		16 / 10,
		0,
	);
	expect(strokes.length).toBeGreaterThan(0);
	const want = ndcToPx(
		projectDirection(muzzle, { x: 0, y: 0, z: 0, w: 1 }, fov, 16 / 10),
		1,
		1,
	);
	expect(strokes[0].from.x).toBeCloseTo(want.x, 9);
	expect(strokes[0].from.y).toBeCloseTo(want.y, 9);
	expect(want.x).toBeGreaterThan(0.5);
	expect(want.y).toBeLessThan(0.5);
	for (const s of strokes) expect(s.rgb).toEqual(MINING_BEAM_RGB);
	const cores = strokes.filter((s) => s.layer === "core");
	const glows = strokes.filter((s) => s.layer === "glow");
	expect(cores).toHaveLength(16);
	expect(glows).toHaveLength(16);
	for (const [i, core] of cores.entries()) {
		expect(glows[i].from).toEqual(core.from);
		expect(glows[i].to).toEqual(core.to);
		expect(glows[i].widthPx).toBeCloseTo(core.widthPx * 2.5, 12);
		expect(glows[i].alpha).toBeCloseTo(core.alpha * 0.35, 12);
	}
});

test("anchored, a mount's cockpit beam runs the whole way from its muzzle to the rock, not a stub at the bow (F7)", () => {
	const cutter = HULL_SPECS.miner.cutter;
	if (!cutter) throw new Error("the miner carries a cutter");
	const faceZ = -(cutter.bowKm + cutter.feedTravelKm + 0.0003);
	const pxOf = (fromZ: number) => {
		const strokes = mountBeamStrokes(
			[
				{
					muzzle: v3(0.0053, 0.00581, fromZ),
					end: v3(0.0053, 0.00581, faceZ),
					hit: true,
				},
			],
			v3(0, 0, -0.008),
			{ x: 0, y: 0, z: 0, w: 1 },
			Math.PI / 3,
			1280 / 800,
			0,
		).filter((s) => s.layer === "core");
		const seg = strokes.map((s) =>
			Math.hypot((s.to.x - s.from.x) * 1280, (s.to.y - s.from.y) * 800),
		);
		return {
			total: Math.hypot(
				(strokes[strokes.length - 1].to.x - strokes[0].from.x) * 1280,
				(strokes[strokes.length - 1].to.y - strokes[0].from.y) * 800,
			),
			visible: seg.filter((p) => p > 3).length,
		};
	};
	const fromMuzzle = pxOf(-0.0228);
	expect(fromMuzzle.total).toBeGreaterThan(200);
	expect(fromMuzzle.visible).toBeGreaterThanOrEqual(12);
	expect(pxOf(-0.0398).total).toBeLessThan(60);
});

test("the cockpit's beam layer holds both mount beams whole beside every tracer and the raider (F7)", () => {
	const mounts = [-0.0053, 0.0053].map((x) => ({
		muzzle: v3(x, 0.00581, -0.0228),
		end: v3(x, 0.00581, -0.0531),
		hit: true,
	}));
	const mining = mountBeamStrokes(
		mounts,
		v3(0, 0, -0.008),
		{ x: 0, y: 0, z: 0, w: 1 },
		Math.PI / 3,
		1280 / 800,
		0,
	);
	const gun = mining[0];
	const strokes = [
		...mining,
		...Array.from({ length: spec.hardpoints + 1 }, (_, i) => ({
			...gun,
			from: { x: 0.2 + i * 0.1, y: 0.64 },
			to: { x: 0.5, y: 0.5 },
		})),
	];
	const quads = writeBeamQuads(
		strokes,
		1280,
		800,
		1,
		newBeamQuads(BEAM_CAPACITY),
	);
	expect(quads.count).toBe(strokes.length * BEAM_VERTICES_PER_STROKE);
});
