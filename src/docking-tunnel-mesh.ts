/**
 * The docking corridor as world lines in the near layer.
 *
 * The corridor was drawn on the 2D overlay, which has no depth buffer, so the
 * station, the traffic in its lane and the cabin itself could hide none of it:
 * from behind a station the throat and the rings were painted over its hull.
 * Here it is two `LineSegments` that depth-test against the near layer and
 * write no depth of their own, so anything solid in front of a line hides it
 * and nothing is hidden by a line.
 *
 * `docking-tunnel.ts` stays the one source of the shape. This module copies its
 * corners into a buffer each frame and authors no dimension except
 * `THROAT_STANDOFF_KM`. Positions are **station-relative kilometres**, and the
 * caller moves `root` to the station's camera-relative position, which is how
 * every near-layer object is placed.
 */

import * as THREE from "three";
import type { TunnelGeometry } from "./docking-tunnel";
import type { Vec3 } from "./vec3";

/**
 * How far the throat is drawn outward of the aperture plane, km.
 *
 * The throat lies exactly on the aperture frame's face, and a line has no
 * `polygonOffset`, so on the plane it z-fights the face it outlines. Five
 * metres is under a pixel at any range the corridor is drawn at, and far more
 * than the depth buffer resolves at that range.
 */
export const THROAT_STANDOFF_KM = 0.005;

export interface TunnelLineStyle {
	/** sRGB hex. */
	color: number;
	opacity: number;
}

export interface TunnelLines {
	/** Moved to the station's camera-relative position by the caller. */
	root: THREE.Group;
	/** The aperture's outline: four segments. */
	throat: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
	/** The outer rings and the four rails from the throat to the mouth. */
	corridor: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

const lineMaterial = () =>
	new THREE.LineBasicMaterial({
		transparent: true,
		// Tested, so the hull and the cabin hide it; not written, so a line
		// never hides what is behind it.
		depthTest: true,
		depthWrite: false,
	});

const segments = (name: string, vertexCount: number) => {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3),
	);
	const lines = new THREE.LineSegments(geometry, lineMaterial());
	lines.name = name;
	// Rewritten every frame, so a bounding sphere would be stale or recomputed
	// each frame for a test that saves nothing at this vertex count.
	lines.frustumCulled = false;
	return lines;
};

/** Vertex counts for a corridor of `rings` rings: each segment is two. */
export function tunnelLineCounts(rings: number) {
	const outer = Math.max(0, rings - 1);
	return {
		throat: 4 * 2,
		// Four edges per outer ring, and four rails of `outer` segments each.
		corridor: (outer * 4 + 4 * outer) * 2,
	};
}

export function buildTunnelLines(rings: number): TunnelLines {
	const counts = tunnelLineCounts(rings);
	const root = new THREE.Group();
	root.name = "docking-tunnel";
	const throat = segments("docking-throat", counts.throat);
	const corridor = segments("docking-corridor", counts.corridor);
	root.add(throat, corridor);
	root.visible = false;
	return { root, throat, corridor };
}

const put = (array: Float32Array, at: number, p: Vec3) => {
	array[at] = p.x;
	array[at + 1] = p.y;
	array[at + 2] = p.z;
	return at + 3;
};

/** Two corners of a ring, in drawing order: edge `k` runs from `k` to `k+1`. */
const edge = (corners: readonly Vec3[], k: number): [Vec3, Vec3] => [
	corners[k],
	corners[(k + 1) % 4],
];

/**
 * Copy `tunnel` into the line buffers, the throat stood `THROAT_STANDOFF_KM`
 * outward along `axisOut`, and apply the two styles.
 */
export function writeTunnelLines(
	lines: TunnelLines,
	tunnel: TunnelGeometry,
	axisOut: Vec3,
	style: { throat: TunnelLineStyle; corridor: TunnelLineStyle },
): void {
	const counts = tunnelLineCounts(tunnel.rings.length);
	const throatAttr = lines.throat.geometry.getAttribute(
		"position",
	) as THREE.BufferAttribute;
	const corridorAttr = lines.corridor.geometry.getAttribute(
		"position",
	) as THREE.BufferAttribute;
	if (
		throatAttr.count !== counts.throat ||
		corridorAttr.count !== counts.corridor
	)
		throw new Error(
			`docking-tunnel-mesh: built for ${throatAttr.count}/${corridorAttr.count} vertices, ` +
				`the corridor needs ${counts.throat}/${counts.corridor}`,
		);

	const s = THROAT_STANDOFF_KM;
	const throatCorners = tunnel.throat.corners.map((c) => ({
		x: c.x + axisOut.x * s,
		y: c.y + axisOut.y * s,
		z: c.z + axisOut.z * s,
	}));

	const t = throatAttr.array as Float32Array;
	let at = 0;
	for (let k = 0; k < 4; k++)
		for (const p of edge(throatCorners, k)) at = put(t, at, p);

	const c = corridorAttr.array as Float32Array;
	at = 0;
	for (const ring of tunnel.rings.slice(1))
		for (let k = 0; k < 4; k++)
			for (const p of edge(ring.corners, k)) at = put(c, at, p);
	// The rails start at the drawn throat, not at the plane, so they meet it.
	for (let k = 0; k < 4; k++) {
		let from = throatCorners[k];
		for (const ring of tunnel.rings.slice(1)) {
			at = put(c, at, from);
			at = put(c, at, ring.corners[k]);
			from = ring.corners[k];
		}
	}

	throatAttr.needsUpdate = true;
	corridorAttr.needsUpdate = true;
	lines.throat.material.color.setHex(style.throat.color);
	lines.throat.material.opacity = style.throat.opacity;
	lines.corridor.material.color.setHex(style.corridor.color);
	lines.corridor.material.opacity = style.corridor.opacity;
}
