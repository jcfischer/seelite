/**
 * The docking corridor as world lines in the near layer.
 *
 * The corridor was drawn on the 2D overlay, which has no depth buffer, so
 * nothing could hide any of it: from behind a station the throat and the rings
 * were painted over its hull. Here it is two `LineSegments` that depth-test
 * against the near layer and write no depth of their own, so whatever that
 * layer has already written in front of a line hides it, and a line hides
 * nothing. `probe-docking` measures the station's hull doing that; the cabin
 * and traffic are near-layer meshes under the same depth test and are not
 * measured.
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
 * metres lifts it clear of that face; at the last tens of metres of an
 * approach, seen off the axis, the lift is visible as an outline standing just
 * proud of the frame. Neither the depth resolution nor the visible lift has
 * been measured.
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

/** The throat's corners stood off the plane, rewritten in place each frame. */
const lifted: Vec3[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0 }));

/**
 * Copy `tunnel` into the line buffers, the throat stood `THROAT_STANDOFF_KM`
 * outward along `axisOut`, and apply the two styles.
 *
 * Runs every frame the director is up, so it writes straight into the buffers
 * and allocates nothing. Edge `k` of a ring runs from corner `k` to `k + 1`.
 */
export function writeTunnelLines(
	lines: TunnelLines,
	tunnel: TunnelGeometry,
	axisOut: Vec3,
	style: { throat: TunnelLineStyle; corridor: TunnelLineStyle },
): void {
	const rings = tunnel.rings;
	const counts = tunnelLineCounts(rings.length);
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

	for (let k = 0; k < 4; k++) {
		const corner = tunnel.throat.corners[k];
		lifted[k].x = corner.x + axisOut.x * THROAT_STANDOFF_KM;
		lifted[k].y = corner.y + axisOut.y * THROAT_STANDOFF_KM;
		lifted[k].z = corner.z + axisOut.z * THROAT_STANDOFF_KM;
	}
	const t = throatAttr.array as Float32Array;
	let at = 0;
	for (let k = 0; k < 4; k++) {
		at = put(t, at, lifted[k]);
		at = put(t, at, lifted[(k + 1) % 4]);
	}

	const c = corridorAttr.array as Float32Array;
	at = 0;
	for (let r = 1; r < rings.length; r++) {
		const corners = rings[r].corners;
		for (let k = 0; k < 4; k++) {
			at = put(c, at, corners[k]);
			at = put(c, at, corners[(k + 1) % 4]);
		}
	}
	// The rails start at the drawn throat, not at the plane, so they meet it.
	for (let k = 0; k < 4; k++)
		for (let r = 1; r < rings.length; r++) {
			at = put(c, at, r === 1 ? lifted[k] : rings[r - 1].corners[k]);
			at = put(c, at, rings[r].corners[k]);
		}

	throatAttr.needsUpdate = true;
	corridorAttr.needsUpdate = true;
	lines.throat.material.color.setHex(style.throat.color);
	lines.throat.material.opacity = style.throat.opacity;
	lines.corridor.material.color.setHex(style.corridor.color);
	lines.corridor.material.opacity = style.corridor.opacity;
}
