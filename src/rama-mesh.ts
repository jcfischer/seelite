/**
 * #333 — Rama, the alien vessel of Arthur C. Clarke's *Rendezvous with Rama*
 * (1973), as a drawn model and nothing more.
 *
 * **No role in the simulation, by construction.** This module imports three
 * and the loft and nothing else, and `tests/rama-mesh.test.ts` asserts that:
 * whatever Rama becomes in the game — a body, a contact, a place — is a later
 * node's question, and a type chosen here would answer it by accident. A hull
 * row would invent a mass, a hold and a price for an alien artefact; a station
 * form would owe it an aperture, a berth catalogue and a market.
 *
 * **Kilometres, like every sim-facing mesh.** A later node that places it
 * inherits the distance-layer rule rather than picking a layer: its layer will
 * be its distance from the camera, not its size.
 *
 * **What the novel gives, and what this draws from it.** A cylinder about 50 km
 * long and 20 km across, spinning on its long axis; a hull almost featureless,
 * so its scale reads from its size and from the few things on it; a "north"
 * cap with an axial hub carrying three airlocks; a "south" cap carrying the
 * drive, drawn here as an axial spike ringed by six smaller ones. Nothing on it
 * emits light — no ports, no lamps, no nav lights — because nothing about it
 * was built by anyone who needed them. It is still shaded by the scene's star
 * like every standard material.
 */
import * as THREE from "three";
import { type Ring, hullLoft } from "./loft";

/** The novel's figures, kilometres. North is −Z, south +Z. */
export const RAMA_DIMENSIONS = Object.freeze({ lengthKm: 50, radiusKm: 10 });

/** How far the south collar stands proud of the polar disc, and how long the
 *  axial spike on it is, kilometres. */
const SOUTH_COLLAR_KM = 0.4;
const SOUTH_SPIKE_LENGTH_KM = 2.8;

/** How far the drawn model reaches from its centre, kilometres — the tip of
 *  the axial south spike, which is the one part that stands past a cap. The
 *  workbench frames its orbit, grid and clip planes from it. Derived from the
 *  figures that build the spike, so the two cannot drift apart. */
export const RAMA_REACH_KM =
	RAMA_DIMENSIONS.lengthKm / 2 + SOUTH_COLLAR_KM + SOUTH_SPIKE_LENGTH_KM;

export interface RamaVariant {
	readonly id: "a";
	readonly name: string;
	readonly thesis: string;
}

/** One concept: this is a reference object, not a design round. */
export const RAMA_VARIANTS: readonly RamaVariant[] = [
	{
		id: "a",
		name: "Rama",
		thesis:
			"a featureless 50 km cylinder: three airlocks on the north hub, the drive's spikes on the south cap",
	},
];

/** A hull the colour of old metal that nobody has polished, and not emissive.
 *  One material shared by every build, like the hulls' palettes: the
 *  workbench disposes geometry on a rebuild and not materials. */
const RAMA_MATERIAL = new THREE.MeshStandardMaterial({
	color: 0x8c9095,
	roughness: 0.62,
	metalness: 0.35,
});

const round = (z: number, r: number, hard = false): Ring => ({
	z,
	w: r,
	h: r,
	e: 2,
	hard,
});

function part(
	root: THREE.Group,
	name: string,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	position: [number, number, number] = [0, 0, 0],
) {
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = name;
	mesh.position.set(...position);
	root.add(mesh);
	return mesh;
}

export function buildRamaMesh(variant: RamaVariant["id"] = "a"): {
	root: THREE.Group;
} {
	const root = new THREE.Group();
	root.name = "rama";
	root.userData.variant = variant;
	const material = RAMA_MATERIAL;
	const half = RAMA_DIMENSIONS.lengthKm / 2;
	const r = RAMA_DIMENSIONS.radiusKm;

	// The body: shallow domed caps meeting a true cylinder at hard shoulders, so
	// the spline cannot bulge the barrel between them. Each cap ends in a flat
	// polar disc, which is what the hub and the drive stand on.
	const cap = (sign: -1 | 1) => [
		round(sign * (half - 3), r, true),
		round(sign * (half - 2), r * 0.985),
		round(sign * (half - 1), r * 0.92),
		round(sign * (half - 0.4), r * 0.72),
		round(sign * half, r * 0.32),
	];
	part(
		root,
		"rama-hull",
		hullLoft([...cap(-1).reverse(), ...cap(1)], {
			segments: 64,
			subdivisions: 4,
		}),
		material,
	);

	// North: the axial hub, sunk into the polar disc, and three airlocks on its
	// face a third of a turn apart.
	part(
		root,
		"rama-north-hub",
		hullLoft(
			[
				round(-half - 0.9, 1.3),
				round(-half - 0.7, 1.6, true),
				round(-half + 0.1, 1.6),
			],
			{
				segments: 32,
			},
		),
		material,
	);
	for (let i = 0; i < 3; i++) {
		const theta = Math.PI / 2 + (i / 3) * Math.PI * 2;
		part(
			root,
			`rama-airlock-${i}`,
			hullLoft(
				[
					round(-half - 1.3, 0.28),
					round(-half - 1.2, 0.35, true),
					round(-half - 0.8, 0.35),
				],
				{
					segments: 16,
				},
			),
			material,
			[Math.cos(theta) * 1.1, Math.sin(theta) * 1.1, 0],
		);
	}

	// South: a collar on the polar disc, an axial spike and six around it.
	part(
		root,
		"rama-south-collar",
		hullLoft(
			[
				round(half - 0.1, 3),
				round(half + 0.3, 3, true),
				round(half + 0.4, 2.6),
			],
			{
				segments: 48,
			},
		),
		material,
	);
	const spike = (base: number, length: number): Ring[] => [
		round(half - 0.1, base),
		round(half + SOUTH_COLLAR_KM, base, true),
		round(half + SOUTH_COLLAR_KM + length * 0.6, base * 0.35),
		round(half + SOUTH_COLLAR_KM + length, 0.02),
	];
	part(
		root,
		"rama-south-spike-0",
		hullLoft(spike(0.9, SOUTH_SPIKE_LENGTH_KM), { segments: 16 }),
		material,
	);
	for (let i = 0; i < 6; i++) {
		const theta = (i / 6) * Math.PI * 2;
		part(
			root,
			`rama-south-spike-${i + 1}`,
			hullLoft(spike(0.42, 1.3), { segments: 12 }),
			material,
			[Math.cos(theta) * 2.1, Math.sin(theta) * 2.1, 0],
		);
	}
	// The scale grid, on the principal's call against the first sheet: a
	// featureless hull read as a canister with nothing to judge its size by. A
	// girdle every 5 km round the barrel and a seam every 15° along it — a
	// 20 km ruler in both directions — each standing under 1% of the radius
	// proud, so the outline stays the cylinder's.
	const GIRDLE_PITCH_KM = 5;
	for (
		let i = 0, z = -half + 5;
		z <= half - 5 + 1e-9;
		i++, z += GIRDLE_PITCH_KM
	)
		part(
			root,
			`rama-girdle-${i}`,
			new THREE.TorusGeometry(r + 0.02, 0.05, 6, 160),
			material,
			[0, 0, z],
		);
	const SEAMS = 24;
	for (let i = 0; i < SEAMS; i++) {
		const seam = part(
			root,
			`rama-seam-${i}`,
			hullLoft(
				[
					{ z: -(half - 3.5), w: 0.03, h: 0.02, x: r, e: 4 },
					{ z: half - 3.5, w: 0.03, h: 0.02, x: r, e: 4 },
				],
				{ segments: 6, subdivisions: 1 },
			),
			material,
		);
		seam.rotation.z = (i / SEAMS) * Math.PI * 2;
	}

	return { root };
}
