import { expect, test } from "bun:test";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import {
	ASSEMBLY_BLOCKS,
	assemblyInstances,
	ASSEMBLY_CELL_KM,
} from "../src/assembly-plan";
import { ASSEMBLY_PROXY_SOURCE } from "../src/assembly-proxies";
import {
	assemblyProxyBoxes,
	stationProxyOf,
	proxyContains,
	proxyListDistanceKm,
} from "../src/station-proxy";
import { modularPlacements } from "../src/station-modular";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	assemblyBlockParts,
	overreaches,
	TriangleGrid,
} from "../scripts/lib/shipyard-proxies";
import { ASSEMBLY_SEEDS } from "./helpers/solved-forms";
import {
	inOpening,
	openingOf,
	sampleCylinder,
	spinningOpeningPoints,
} from "./helpers/station-proxy-measure";

test("each written block proxy fits the shipping surface within 10 m", async () => {
	const bytes = readFileSync("src/models/trade-assembly.glb");
	expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
		ASSEMBLY_PROXY_SOURCE,
	);
	const root = await decodeShippedGlb("src/models/trade-assembly.glb");
	for (const block of ASSEMBLY_BLOCKS) {
		const triangles = assemblyBlockParts(root, block).flat();
		const grid = new TriangleGrid(triangles);
		const boxes = assemblyProxyBoxes(block);
		expect(boxes.length).toBeGreaterThan(0);
		for (const b of boxes) {
			const obb = {
				c: new THREE.Vector3(b.cx, b.cy, b.cz).multiplyScalar(1000),
				axes: b.axes!.map((a) => new THREE.Vector3(a.x, a.y, a.z)) as [
					THREE.Vector3,
					THREE.Vector3,
					THREE.Vector3,
				],
				half: [b.hx * 1000, b.hy * 1000, b.hz * 1000] as [
					number,
					number,
					number,
				],
			};
			expect([block, overreaches(obb, grid)]).toEqual([block, false]);
		}
		const opening = openingOf("trade", "d");
		let worst = 0;
		for (const tri of triangles)
			for (const v of tri) {
				const km = v.clone().multiplyScalar(0.001);
				if (block === "HUB" && inOpening(opening, km)) continue;
				worst = Math.max(worst, proxyListDistanceKm(boxes, km.x, km.y, km.z));
			}
		expect([block, worst < 0.001]).toEqual([block, true]);
	}
}, 120_000);

test("seeded proxies place each fitted kind in its own cell and leave the approach clear", () => {
	const opening = openingOf("trade", "d");
	const spinningPoints = spinningOpeningPoints(opening);
	const staticPoints = opening.sweptCylinders.flatMap(sampleCylinder);
	for (const seed of ASSEMBLY_SEEDS) {
		const proxy = stationProxyOf({
			type: "trade",
			formId: "d",
			berthSeed: 0,
			assemblySeed: seed,
		});
		const instances = assemblyInstances(modularPlacements(seed).placements);
		expect(proxy.static.length).toBeGreaterThan(100);
		for (const i of instances.filter((i) => i.block !== "HUB")) {
			const b = assemblyProxyBoxes(i.block)[0];
			const x =
				i.dx * ASSEMBLY_CELL_KM +
				b.cx * Math.cos(i.turn) -
				b.cy * Math.sin(i.turn);
			const y =
				i.dy * ASSEMBLY_CELL_KM +
				b.cx * Math.sin(i.turn) +
				b.cy * Math.cos(i.turn);
			if (Math.abs(x) > 0.19 || Math.abs(y) > 0.19 || b.cz < 0.02)
				expect(proxyContains(proxy.static, x, y, b.cz, 0)).toBe(true);
		}
		expect(
			spinningPoints.some((p) =>
				proxyContains(proxy.spinning, p.x, p.y, p.z, -1e-9),
			),
		).toBe(false);
		expect(
			staticPoints.some((p) =>
				proxyContains(proxy.static, p.x, p.y, p.z, -1e-9),
			),
		).toBe(false);
	}
}, 120_000);
