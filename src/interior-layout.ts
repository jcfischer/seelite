import {
	stationInterior,
	type InteriorFace,
	type StationInterior,
} from "./station-interior";
import { STATION_GEOMETRY } from "./station";
export const THEMES = [
	{
		id: "civic",
		name: "Civic Exchange",
		code: "O1",
		accent: 0x548b83,
		light: 0xffe4bb,
	},
	{
		id: "works",
		name: "Heavy Works",
		code: "O2",
		accent: 0xb87822,
		light: 0xffe0ad,
	},
	{
		id: "frontier",
		name: "Frontier Anchorage",
		code: "O3",
		accent: 0x847353,
		light: 0xffc482,
	},
	{
		id: "survey",
		name: "Survey Institute",
		code: "O4",
		accent: 0x708d9d,
		light: 0xfff0db,
	},
] as const;
export type Theme = (typeof THEMES)[number]["id"];
export type V3 = [number, number, number];
export type Bounds = { min: V3; max: V3 };
export type Kind =
	| "command"
	| "loading"
	| "gangway"
	| "utility"
	| "crane"
	| "airlock"
	| "service-civic"
	| "service-works"
	| "service-frontier"
	| "service-survey";
export const MODULE_SIZE: Record<Kind, V3> = {
	command: [37, 18, 29],
	loading: [41, 20, 49],
	gangway: [8, 7, 101],
	utility: [15, 14, 33],
	crane: [25, 32, 41],
	airlock: [19, 9, 25],
	"service-civic": [31, 9, 22],
	"service-works": [31, 9, 22],
	"service-frontier": [31, 9, 22],
	"service-survey": [31, 9, 22],
};
export const FACE_ROLL: Record<InteriorFace, number> = {
	deck: 0,
	port: -Math.PI / 2,
	starboard: Math.PI / 2,
	overhead: Math.PI,
};
export const overlaps = (a: Bounds, b: Bounds) =>
	a.min.every((v, i) => v < b.max[i] - 0.001 && a.max[i] > b.min[i] + 0.001);
export function worldPoint(
	face: InteriorFace,
	s: number,
	h: number,
	z: number,
	halfX: number,
	halfY: number,
): V3 {
	const a = FACE_ROLL[face],
		n: [number, number] = [-Math.sin(a), Math.cos(a)];
	const base: V3 =
		face === "deck"
			? [0, -halfY, 0]
			: face === "overhead"
				? [0, halfY, 0]
				: face === "port"
					? [-halfX, 0, 0]
					: [halfX, 0, 0];
	return [
		base[0] + Math.cos(a) * s + n[0] * h,
		base[1] + Math.sin(a) * s + n[1] * h,
		z,
	];
}
function boundsOf(
	face: InteriorFace,
	s: number,
	z: number,
	size: V3,
	hx: number,
	hy: number,
): Bounds {
	const points: V3[] = [];
	for (const x of [-1, 1])
		for (const y of [0, 1])
			for (const zz of [-1, 1])
				points.push(
					worldPoint(
						face,
						s + (x * size[0]) / 2,
						y * size[1],
						z + (zz * size[2]) / 2,
						hx,
						hy,
					),
				);
	return {
		min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))) as V3,
		max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) as V3,
	};
}
export function planInterior(
	theme: Theme,
	role: "trade" | "shipyard",
	seed: number,
	interior?: StationInterior,
) {
	const g =
			interior ??
			stationInterior(role, STATION_GEOMETRY[role].aperturePlaneKm, seed),
		hx = g.halfAcrossKm * 1000,
		hy = g.halfUpKm * 1000,
		depth = (g.mouthAxialKm - g.endAxialKm) * 1000;
	let state = seed >>> 0;
	const rand = () =>
		(state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
	const berths = g.berths.map((b) => {
		const centre: V3 = [
			b.centre.across * 1000,
			b.centre.up * 1000,
			(b.centre.axial - g.mouthAxialKm) * 1000,
		];
		const size: V3 = [
			b.clearBeamKm * 1000,
			b.clearHeightKm * 1000,
			b.clearLengthKm * 1000,
		];
		return {
			id: b.id,
			face: b.face,
			centre,
			normal: [b.normal.across, b.normal.up, b.normal.axial] as V3,
			nose: [b.parkedNose.across, b.parkedNose.up, b.parkedNose.axial] as V3,
			size,
			roll: FACE_ROLL[b.face],
			bounds: boundsOf(b.face, 0, centre[2], size, hx, hy),
		};
	});
	const fittings: {
		id: string;
		kind: Kind;
		face: InteriorFace;
		position: V3;
		roll: number;
		bounds: Bounds;
		size: V3;
	}[] = [];
	const faces: InteriorFace[] = ["deck", "port", "overhead", "starboard"];
	const add = (
		kind: Kind,
		face: InteriorFace,
		s: number,
		z: number,
		optional = false,
	) => {
		const size = MODULE_SIZE[kind];
		for (const shift of optional
			? [0]
			: [0, 55, -55, 110, -110, 165, -165, 220, -220]) {
			const axial = z + shift,
				bounds = boundsOf(face, s, axial, size, hx, hy);
			if (bounds.min[2] < -depth || bounds.max[2] > 0) continue;
			if (fittings.some((f) => overlaps(f.bounds, bounds))) continue;
			fittings.push({
				id: `${face}-${kind}-${fittings.length}`,
				kind,
				face,
				position: worldPoint(face, s, 0, axial, hx, hy),
				roll: FACE_ROLL[face],
				bounds,
				size,
			});
			return;
		}
		if (!optional) throw Error(`No fitting socket for ${kind} on ${face}`);
	};
	const commandFace = faces[Math.floor(rand() * 4)];
	for (const face of faces) {
		const half = face === "deck" || face === "overhead" ? hx : hy;
		const sign = rand() < 0.5 ? -1 : 1;
		add(
			face === commandFace ? "command" : "airlock",
			face,
			sign * (half - 28),
			-65,
		);
		add(
			theme === "survey" && face !== commandFace ? "utility" : "loading",
			face,
			-sign * (half - 28),
			-205,
		);
		add(
			theme === "works"
				? "crane"
				: theme === "frontier"
					? "utility"
					: "command",
			face,
			sign * (half - 28),
			-345,
		);
		for (const side of [-1, 1]) {
			for (const z of [-75, -185, -295])
				add("gangway", face, side * (half - 56), z);
			add("utility", face, side * (half - 24), -125 - (rand() < 0.5 ? 0 : 145));
		}
	}
	// Berth-side service cassettes sit outside the full roll envelope.
	for (const berth of berths) {
		const s =
			Math.hypot(berth.size[0], berth.size[1]) / 2 +
			MODULE_SIZE.utility[0] / 2 +
			2;
		for (const sign of [-1, 1])
			add("utility", berth.face, sign * s, berth.centre[2], true);
	}
	// Fill shoulder recesses with role-specific equipment, respecting occupied sockets.
	for (const face of faces) {
		const half = face === "deck" || face === "overhead" ? hx : hy;
		for (const side of [-1, 1])
			for (const z of [-35, -115, -145, -175, -245, -275, -300, -360])
				add(`service-${theme}`, face, side * (half - 32), z, true);
	}
	// A loading cassette is useful even in a research station; its wall changes with identity.
	return {
		theme,
		role,
		seed,
		hx,
		hy,
		depth,
		stagingZ: (g.stagingAxialKm - g.mouthAxialKm) * 1000,
		berths,
		fittings,
		volume: { min: [-hx, -hy, -depth] as V3, max: [hx, hy, 0] as V3 },
		lane: {
			min: [-g.laneHalfAcrossKm * 1000, -g.laneHalfUpKm * 1000, -depth] as V3,
			max: [g.laneHalfAcrossKm * 1000, g.laneHalfUpKm * 1000, 0] as V3,
		},
	};
}
