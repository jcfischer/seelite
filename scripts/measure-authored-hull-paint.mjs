/**
 * What each authored hull paint actually returns to the screen, before and after
 * the lift (node #887).
 *
 * `hull-chase` reads one hull from one angle in one light and prints three display
 * codes. That is the right instrument for the band, and the wrong one for asking
 * *which paint* is dark: on the shipped courier 39% of the triangles are one paint
 * and 33% are another, and a single median cannot say whether the dark is the
 * structure, the alloy, or the light.
 *
 * This prints the arithmetic instead, per paint and per asset: the study's factor,
 * the mean luma of the base colour map it multiplies (read off the shipped file's
 * pixels, not assumed), the metallic factor, and the **diffuse** luma that survives
 * at a viewing angle where nothing mirrors the star — which is every angle but one,
 * and the reason a hull at metalness 0.86 reads as a silhouette. The study's own
 * figures are read from beside the spike's README so the lift's effect is the row's
 * subject rather than something a reader has to subtract by hand. The roster's
 * painted hull is printed above both assets as the comparison the lift is sized
 * against, and each paint's share of the hull's triangles is printed with it,
 * because a dark paint over 1% of a hull is a detail and a dark paint over 39% *is*
 * the hull.
 *
 *   node scripts/measure-authored-hull-paint.mjs
 */

import assert from "node:assert/strict";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import {
	AUTHORED_HULL_ASSETS,
	AUTHORED_HULL_PAINT_LIFT,
	ceilingFailures,
	MAX_DIFFUSE_OF_ROSTER,
	rosterPaintedDiffuse,
	tintLuma,
	UNLIFTED_PAINTS,
} from "./lib/authored-hull-paint.mjs";
import { textureMeanLuma } from "./lib/texture-luma.mjs";

const finite = (label, value) => {
	assert(Number.isFinite(value), `${label} is not finite: ${value}`);
	return value;
};

/** Surface share per paint, from the triangles each primitive draws. */
function shares(document) {
	const tris = new Map();
	let total = 0;
	for (const mesh of document.getRoot().listMeshes())
		for (const primitive of mesh.listPrimitives()) {
			const count =
				primitive.getIndices()?.getCount() ??
				primitive.getAttribute("POSITION")?.getCount() ??
				0;
			const triangles = count / 3;
			const name = primitive.getMaterial()?.getName() ?? "(none)";
			tris.set(name, (tris.get(name) ?? 0) + triangles);
			total += triangles;
		}
	return { tris, total };
}

/** Per-paint diffuse luma and surface share, from a loaded document. */
async function paintRows(document, tris, total) {
	const lumaByTexture = new Map();
	for (const texture of document.getRoot().listTextures()) {
		if (!lumaByTexture.has(texture))
			lumaByTexture.set(texture, await textureMeanLuma(texture));
	}
	const rows = new Map();
	for (const material of document.getRoot().listMaterials()) {
		const tint = material.getBaseColorFactor();
		const metalness = material.getMetallicFactor();
		const map = finite(
			`${material.getName()} map luma`,
			lumaByTexture.get(material.getBaseColorTexture()) ?? 1,
		);
		rows.set(material.getName(), {
			share: ((tris.get(material.getName()) ?? 0) / total) * 100,
			factor: tintLuma(tint),
			map,
			metalness,
			diffuse: finite(
				`${material.getName()} diffuse`,
				tintLuma(tint) * map * (1 - metalness),
			),
		});
	}
	return rows;
}

const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const roster = finite("roster diffuse", rosterPaintedDiffuse());
const ceiling = rosterPaintedDiffuse() * MAX_DIFFUSE_OF_ROSTER;
console.log(
	`roster painted hull (worn): diffuse ${roster.toFixed(3)} of full white`,
);

for (const asset of AUTHORED_HULL_ASSETS) {
	const study = await io.read(asset.study);
	const shipped = await io.read(asset.shipped);
	const { tris, total } = shares(shipped);
	const before = await paintRows(study, tris, total);
	const after = await paintRows(shipped, tris, total);

	console.log(`\n== ${asset.shipped} (${total.toLocaleString()} triangles)`);
	console.log(
		"  paint".padEnd(34) + "  share    study   lifted  metal   ratio  bound",
	);
	const ranked = [...after.keys()]
		.map((name) => ({ name, ...after.get(name) }))
		.sort((a, b) => b.share - a.share);
	const moved = [];
	for (const row of ranked.slice(0, 14)) {
		const lift = before.get(row.name);
		const lifted = row.name in AUTHORED_HULL_PAINT_LIFT;
		moved.push({
			name: row.name,
			ceiling,
			diffuse: row.diffuse,
			fromDiffuse: lift?.diffuse ?? row.diffuse,
		});
		console.log(
			`  ${row.name}`.padEnd(34) +
				`${row.share.toFixed(1).padStart(5)}%  ` +
				`${(lift?.diffuse ?? NaN).toFixed(3).padStart(6)}  ` +
				`${row.diffuse.toFixed(3).padStart(6)}  ` +
				`${row.metalness.toFixed(2).padStart(5)}  ` +
				`${(row.diffuse / (lift?.diffuse ?? NaN)).toFixed(1).padStart(5)}x  ` +
				`${lifted ? (row.name in UNLIFTED_PAINTS ? "BOTH?!" : "lift") : "kept"}` +
				(lifted &&
				row.diffuse > ceiling + 1e-9 &&
				row.diffuse > (lift?.diffuse ?? 0) + 1e-9
					? " OVER CEILING"
					: ""),
		);
	}
	// Every paint on the hull must be classified somewhere, whatever its share.
	const unclassified = [...after.keys()].filter(
		(name) => !(name in AUTHORED_HULL_PAINT_LIFT) && !(name in UNLIFTED_PAINTS),
	);
	assert.deepEqual(
		unclassified,
		[],
		`${asset.shipped} carries paints no record classifies`,
	);
	// And no paint the lift brightened may end above the ceiling. A paint that
	// shipped above it is a different question — see `MAX_DIFFUSE_OF_ROSTER`.
	assert.deepEqual(
		ceilingFailures(moved),
		[],
		`${asset.shipped} has a paint the lift brightened past the ceiling`,
	);
}
