/**
 * #887 — the authored hull paints, lifted for legibility.
 *
 * The finding is in the module's docstring: both authored hulls carry materials
 * authored for a viewer with a studio environment, and the game's baked sky lands
 * at `environmentIntensity` 0.15, so a paint at metalness 0.86 renders black except
 * where it mirrors the star. `hull-chase` reads the shipped courier at peak 252.21 /
 * median 37.88 / lower quartile 10.16 of 255.
 *
 * What is here, and why each leg is separate:
 *
 * 1. **The shipped file is the study, lifted by the rule.** Each lifted paint
 *    compared against the study's own factor, through the same loader the browser
 *    uses. This is the row that fails if a prepare script is edited, skipped, or run
 *    against a study that has since moved.
 * 2. **Nothing else moved at all.** Every paint outside the rule is byte-equal to
 *    the study. Without this the lift could quietly repaint the recesses, the
 *    emitters and the pilot along with the hull, and the hull band would not see
 *    the difference — it masks the hull and its own emissives out.
 * 3. **Every paint in both files is classified.** A dark paint added by a later
 *    study is a red row here rather than an unexamined silhouette in the game.
 * 4. **The rule is safe on both assets.** No paint is brightened past
 *    `TINT_LUMA_CEILING`, no metalness is raised, and the study's tonal order
 *    among the lifted paints survives. This is the half that makes a scale chosen
 *    for a paint at 0.057 safe to apply to a name that also exists at 0.640.
 *
 * What is deliberately **not** here: whether the lift is enough. That is a display
 * reading on a rendered frame — the `hull-chase` rows in `probe-light-rig.mjs`, and
 * the contact sheet — and no arithmetic over a factor can decide it.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	AUTHORED_HULL_ASSETS,
	AUTHORED_HULL_PAINT_LIFT,
	appliedMetalness,
	appliedTintScale,
	ceilingedMetalness,
	MAX_DIFFUSE_OF_ROSTER,
	rosterPaintedDiffuse,
	STEEL_WEAR_MEAN_LUMA,
	TINT_LUMA_CEILING,
	tintLuma,
	UNLIFTED_PAINTS,
} from "../scripts/lib/authored-hull-paint.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";

/** The sRGB-to-linear transfer, three's own, for a figure quoted as a hex. */
const srgbToLinear = (channels: number[]): number[] =>
	channels.map((c) =>
		c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);

interface PaintRecord {
	tint: [number, number, number, number];
	metalness: number;
	roughness: number;
}

const EPSILON = 1e-6;

/** Every standard material in a decoded file, by name. */
async function paints(repoPath: string): Promise<Map<string, PaintRecord>> {
	const scene = await decodeShippedGlb(repoPath);
	const out = new Map<string, PaintRecord>();
	scene.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		for (const material of (Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material]) as THREE.MeshStandardMaterial[]) {
			if (!material.isMeshStandardMaterial || out.has(material.name)) continue;
			const tint = material.color.toArray() as [number, number, number];
			out.set(material.name, {
				tint: [tint[0], tint[1], tint[2], material.opacity],
				metalness: material.metalness,
				roughness: material.roughness,
			});
		}
	});
	return out;
}

/** The pair of records for one asset, study and shipped, decoded once. */
const loaded = new Map<
	string,
	Promise<{
		study: Map<string, PaintRecord>;
		shipped: Map<string, PaintRecord>;
	}>
>();
function pair(asset: (typeof AUTHORED_HULL_ASSETS)[number]) {
	let both = loaded.get(asset.shipped);
	if (!both) {
		both = Promise.all([paints(asset.study), paints(asset.shipped)]).then(
			([study, shipped]) => ({ study, shipped }),
		);
		loaded.set(asset.shipped, both);
	}
	return both;
}

/** A name `dedup` may have folded into an identical one before writing (#815). */
const foldedInto = (
	name: string,
	shipped: Map<string, PaintRecord>,
): string => {
	if (shipped.has(name)) return name;
	// `pale-steel-1` into `pale-steel-0`: the family prefix, and the shortest name
	// under it that the shipped file does carry.
	const family = name.replace(/-\d+$/, "");
	const candidates = [...shipped.keys()]
		.filter((candidate) => candidate.startsWith(family))
		.sort((a, b) => a.length - b.length);
	return candidates[0] ?? name;
};

describe("the authored hull lift table", () => {
	test("every rule lifts, caps below where it points, and is not a no-op", () => {
		for (const [name, rule] of Object.entries(AUTHORED_HULL_PAINT_LIFT)) {
			expect([name, rule.tintScale > 1]).toEqual([name, true]);
			expect([name, rule.metalnessCap > 0, rule.metalnessCap < 1]).toEqual([
				name,
				true,
				true,
			]);
		}
	});

	test("the table names nothing that no hull carries", () => {
		const carried = new Set(
			AUTHORED_HULL_ASSETS.flatMap((a) => a.liftedPaints),
		);
		for (const name of Object.keys(AUTHORED_HULL_PAINT_LIFT))
			expect(carried.has(name)).toBe(true);
		for (const asset of AUTHORED_HULL_ASSETS)
			for (const name of asset.liftedPaints)
				expect([asset.shipped, name, name in AUTHORED_HULL_PAINT_LIFT]).toEqual(
					[asset.shipped, name, true],
				);
	});

	test("no rule points above the ceiling it inherits", () => {
		// A rule whose own ceiling is above the global one is expressible but never
		// binds, which reads as a dial that does nothing. The global ceiling is what
		// keeps the miner's bright `pale-steel-0` from going to a white slab, so a
		// rule above it is a rule that is really two rules.
		for (const [name, rule] of Object.entries(AUTHORED_HULL_PAINT_LIFT)) {
			const whitest = { tint: [1, 1, 1] as [number, number, number] };
			expect([name, appliedTintScale(whitest, rule)]).toEqual([name, 1]);
		}
	});

	test("the lift is not applied to a paint and also excused for it", () => {
		const both = Object.keys(AUTHORED_HULL_PAINT_LIFT).filter(
			(name) => name in UNLIFTED_PAINTS,
		);
		expect(both).toEqual([]);
	});
});

describe("the shipped hulls are the study, lifted", () => {
	for (const asset of AUTHORED_HULL_ASSETS) {
		const label = asset.shipped;

		test(`${label}: the study's lifted paints are exactly the record's`, async () => {
			const { study } = await pair(asset);
			const named = [...study.keys()]
				.filter((name) => name in AUTHORED_HULL_PAINT_LIFT)
				.sort();
			expect([label, named]).toEqual([label, [...asset.liftedPaints].sort()]);
		});

		test(`${label}: every paint the asset is expected to carry is the study under the rule`, async () => {
			const { study, shipped } = await pair(asset);
			let moved = 0;
			for (const name of asset.liftedPaints) {
				const rule = AUTHORED_HULL_PAINT_LIFT[name];
				const from = study.get(name);
				// Absent is a red, not a skip: a paint renamed by a later study would
				// otherwise leave its rule matching nothing and its dark self in the game.
				expect([label, name, from !== undefined]).toEqual([label, name, true]);
				if (!from || !rule) continue;
				const scale = appliedTintScale(from, rule);
				const want = {
					tint: from.tint.map((channel, i) =>
						i === 3 ? channel : Math.min(1, channel * scale),
					),
					metalness: ceilingedMetalness(
						from.tint
							.map((channel, i) =>
								i === 3 ? channel : Math.min(1, channel * scale),
							)
							.filter((channel): channel is number => channel !== undefined),
						appliedMetalness(from, rule),
						asset.baseColorLuma[name] ?? 1,
						rosterPaintedDiffuse() * MAX_DIFFUSE_OF_ROSTER,
						from.metalness,
					),
				};
				const got = shipped.get(name) ?? shipped.get(foldedInto(name, shipped));
				expect([label, name, got !== undefined]).toEqual([label, name, true]);
				expect([label, name, got!.metalness]).toEqual([
					label,
					name,
					want.metalness,
				]);
				for (let i = 0; i < 3; i++)
					expect([
						label,
						name,
						Math.abs(got!.tint[i] - (want.tint[i] as number)) < EPSILON,
					]).toEqual([label, name, true]);
				// The lift never takes a paint's diffuse down, whatever it does to either
				// term on its own. `pale-steel-0` on the Longwall B is already inside both
				// bounds and stays exactly where the study put it.
				expect([
					label,
					name,
					tintLuma(got!.tint) * (1 - got!.metalness) >=
						tintLuma(from.tint) * (1 - from.metalness) - EPSILON,
				]).toEqual([label, name, true]);
				if (got!.metalness < from.metalness - EPSILON || scale > 1 + EPSILON)
					moved++;
			}
			// At least one paint on every asset the rule names has to move, or the
			// whole rule is decoration on that hull.
			expect([label, moved > 0]).toEqual([label, true]);
			// And the shipped file carries no lifted paint the record does not name.
			const extra = [...shipped.keys()].filter(
				(name) =>
					name in AUTHORED_HULL_PAINT_LIFT &&
					!asset.liftedPaints.includes(name),
			);
			expect([label, extra]).toEqual([label, []]);
		});

		test(`${label}: nothing the rule does not name moved`, async () => {
			const { study, shipped } = await pair(asset);
			for (const [name, from] of study) {
				if (name in AUTHORED_HULL_PAINT_LIFT) continue;
				const got = shipped.get(name);
				expect([label, name, got !== undefined]).toEqual([label, name, true]);
				expect([label, name, got!.metalness, got!.roughness]).toEqual([
					label,
					name,
					from.metalness,
					from.roughness,
				]);
				for (let i = 0; i < 4; i++)
					expect([
						label,
						name,
						Math.abs(got!.tint[i] - from.tint[i]) < EPSILON,
					]).toEqual([label, name, true]);
			}
		});

		test(`${label}: every paint it carries is classified`, async () => {
			const { shipped } = await pair(asset);
			const unclassified = [...shipped.keys()].filter(
				(name) =>
					!(name in AUTHORED_HULL_PAINT_LIFT) && !(name in UNLIFTED_PAINTS),
			);
			expect([label, unclassified]).toEqual([label, []]);
		});

		test(`${label}: the lift takes no paint past the ceiling it did not start past`, async () => {
			const { study, shipped } = await pair(asset);
			const ceiling = rosterPaintedDiffuse() * MAX_DIFFUSE_OF_ROSTER;
			for (const name of asset.liftedPaints) {
				const paint =
					shipped.get(name) ?? shipped.get(foldedInto(name, shipped));
				const from = (study.get(name) ?? study.get(foldedInto(name, study)))!;
				const before =
					tintLuma(from.tint) *
					(asset.baseColorLuma[name] ?? 1) *
					(1 - from.metalness);
				const after =
					tintLuma(paint!.tint) *
					(asset.baseColorLuma[name] ?? 1) *
					(1 - paint!.metalness);
				// The ceiling bounds the lift, not the asset: the Longwall B's
				// `pale-steel-0` shipped at 1.33× the roster and stays there. See
				// `MAX_DIFFUSE_OF_ROSTER` for why that is a fact rather than a gap.
				expect([
					label,
					name,
					after <= Math.max(ceiling, before) + EPSILON,
				]).toEqual([label, name, true]);
			}
		});

		test(`${label}: the ceiling and the cap both hold on the shipped file`, async () => {
			const { study, shipped } = await pair(asset);
			for (const [name, paint] of shipped) {
				const rule = AUTHORED_HULL_PAINT_LIFT[name];
				if (!rule) continue;
				const from = (study.get(name) ?? study.get(foldedInto(name, study)))!;
				// The ceiling bounds what the lift does, so a study paint already past it
				// stays exactly where it was: the Longwall B's `pale-steel-0` at 0.611.
				expect([
					label,
					name,
					tintLuma(paint.tint) <= TINT_LUMA_CEILING + EPSILON ||
						tintLuma(paint.tint) <= tintLuma(from.tint) + EPSILON,
				]).toEqual([label, name, true]);
				// The cap lowers and the ceiling raises, each bounded: the cap is never
				// exceeded unless the ceiling is pulling back, and neither ever takes
				// metalness above what the study wrote.
				const cap = appliedMetalness(from, rule);
				expect([label, name, paint.metalness >= cap - EPSILON]).toEqual([
					label,
					name,
					true,
				]);
				expect([
					label,
					name,
					paint.metalness <= from.metalness + EPSILON,
				]).toEqual([label, name, true]);
				if (paint.metalness > cap + EPSILON)
					expect([
						label,
						name,
						tintLuma(paint.tint) *
							(asset.baseColorLuma[foldedInto(name, shipped)] ?? 1) *
							(1 - cap) >
							rosterPaintedDiffuse() * MAX_DIFFUSE_OF_ROSTER,
					]).toEqual([label, name, true]);
			}
		});
	}
});

describe("the study's tonal order survives the lift", () => {
	test("dark structure stays the darkest paint a hull is mostly made of", async () => {
		const { shipped } = await pair(AUTHORED_HULL_ASSETS[0]);
		const diffuse = (name: string) => {
			const paint = shipped.get(name);
			expect([name, paint !== undefined]).toEqual([name, true]);
			return tintLuma(paint!.tint) * (1 - paint!.metalness);
		};
		// The claim the whole node rests on, in the direction that matters: the
		// lifted structure is no longer a silhouette, and it still reads as the
		// structure rather than as the hull plating it sits behind. `recess-black` is
		// not lifted, so it is the floor the lifted darks must stay above.
		expect(diffuse("dark-structure")).toBeLessThan(diffuse("blue-grey-0"));
		expect(diffuse("blue-grey-3")).toBeLessThan(diffuse("pale-steel-0"));
		// And the lift does not take the authored hull past what the procedural
		// roster paints. A `worn` courier hull is 0x7a8285 at metalness 0.3, and the
		// authored hull's paints multiply their factors by the `steel-wear` map, so
		// both sides of that comparison are stated in diffuse light reaching a screen.
		const roster =
			tintLuma(srgbToLinear([0x7a / 255, 0x82 / 255, 0x85 / 255])) * (1 - 0.3);
		expect(diffuse("machined-alloy") * STEEL_WEAR_MEAN_LUMA).toBeLessThan(
			roster,
		);
		expect(diffuse("pale-steel-1") * STEEL_WEAR_MEAN_LUMA).toBeLessThan(roster);
	});

	test("every lifted paint on the shipped courier is brighter than it was", async () => {
		const { study, shipped } = await pair(AUTHORED_HULL_ASSETS[0]);
		for (const name of AUTHORED_HULL_ASSETS[0].liftedPaints) {
			const from = study.get(name)!;
			const to = shipped.get(name)!;
			const before = tintLuma(from.tint) * (1 - from.metalness);
			const after = tintLuma(to.tint) * (1 - to.metalness);
			// Every paint moves by at least a half again. The two pale steels move
			// least, by 1.69× each, because they started as the lightest paints on the
			// hull; the dark structure moves 6.9×, which is where the complaint lives.
			expect([name, after > before * 1.5]).toEqual([name, true]);
		}
	});
});
