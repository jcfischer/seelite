/**
 * Node #818: the shipyards' written collision proxies (`src/shipyard-proxies.ts`)
 * against the models the game draws.
 *
 * A refit takes minutes, so these rows do not refit. They hold that the boxes
 * were fitted to the models that ship (each model's SHA-256, recorded by the
 * generator), and they measure the boxes as the sim decodes them against the
 * drawn triangles: **at most 10 m of empty space may collide** (principal,
 * 2026-10-12). Every box's faces are sampled every `SAMPLE_SPACING_M` and
 * each sample must have a triangle within `SAMPLE_LIMIT_M`: the limit, less
 * the farthest a face point can lie from its nearest sample. The generator
 * fits with the same `overreaches`, on each box grown as packing grows it.
 * That the boxes hold the model, and keep the bay and the lane clear, is
 * `tests/station-proxy.test.ts`'s.
 */
import { afterAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	shipyardModelHash,
	uninstallShipyards,
} from "../scripts/lib/shipped-shipyards";
import {
	type Obb,
	overreaches,
	shipyardTriangles,
	TriangleGrid,
} from "../scripts/lib/shipyard-proxies";
import { SHIPYARD_FORMS } from "../src/shipyard-flight";
import { SHIPYARD_PROXY_SOURCES } from "../src/shipyard-proxies";
import { type ProxyBox, shipyardProxyBoxes } from "../src/station-proxy";

const ROW_MS = 120_000;

afterAll(uninstallShipyards);

/** A decoded box in metres, as the fitter's boxes are. */
function metres(b: ProxyBox): Obb {
	const axis = (i: number) =>
		b.axes
			? new THREE.Vector3(b.axes[i].x, b.axes[i].y, b.axes[i].z)
			: new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
	return {
		c: new THREE.Vector3(b.cx, b.cy, b.cz).multiplyScalar(1000),
		axes: [axis(0), axis(1), axis(2)],
		half: [b.hx * 1000, b.hy * 1000, b.hz * 1000],
	};
}

/** Each box with a face sample farther than the limit from every triangle. */
function overreaching(boxes: ProxyBox[], grid: TriangleGrid): Obb[] {
	return boxes.map(metres).filter((o) => overreaches(o, grid));
}

describe("node #818: the shipyards' collision proxies", () => {
	test("were fitted to the models that ship", () => {
		for (const form of SHIPYARD_FORMS)
			expect(shipyardModelHash(form)).toBe(SHIPYARD_PROXY_SOURCES[form]);
	});

	for (const form of SHIPYARD_FORMS)
		test(
			`form ${form}: no box stands more than 10 m off the drawn model`,
			async () => {
				const tris = await shipyardTriangles(form);
				const boxes = shipyardProxyBoxes(form);
				const far = [
					...overreaching(boxes.drum, new TriangleGrid(tris.drum)),
					...overreaching(boxes.yard, new TriangleGrid(tris.yard)),
				];
				if (far.length)
					console.log(
						`form ${form}: ${far.length} boxes overreach — ` +
							far
								.slice(0, 4)
								.map(
									(o) =>
										`(${o.c.x.toFixed(1)}, ${o.c.y.toFixed(1)}, ${o.c.z.toFixed(1)}) ` +
										`half ${o.half.map((h) => h.toFixed(1)).join("×")}`,
								)
								.join("; "),
					);
				expect(far.length).toBe(0);
			},
			ROW_MS,
		);
});
