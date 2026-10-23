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
	type ProxyBox,
	type ProxyPrimitive,
} from "../src/station-proxy";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { MODULAR_CENTRE, modularPlacements } from "../src/station-modular";
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

function placedBoxes(seed: number): ProxyBox[] {
	return assemblyInstances(modularPlacements(seed).placements)
		.filter((i) => i.block !== "HUB")
		.flatMap((i) => {
			const rotation = new THREE.Matrix4().makeRotationZ(i.turn);
			const rotate = (a: NonNullable<ProxyBox["axes"]>[number]) =>
				new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(rotation);
			const placement = rotation
				.clone()
				.setPosition(i.dx * ASSEMBLY_CELL_KM, i.dy * ASSEMBLY_CELL_KM, 0);
			return assemblyProxyBoxes(i.block).map((b) => {
				const center = new THREE.Vector3(b.cx, b.cy, b.cz).applyMatrix4(
					placement,
				);
				return {
					...b,
					cx: center.x,
					cy: center.y,
					cz: center.z,
					axes: [
						rotate(b.axes![0]),
						rotate(b.axes![1]),
						rotate(b.axes![2]),
					] as const,
				};
			});
		});
}

function boxSamples(b: ProxyBox): THREE.Vector3[] {
	return [-1, 0, 1].flatMap((x) =>
		[-1, 0, 1].flatMap((y) =>
			[-1, 0, 1].map((z) => {
				const p = new THREE.Vector3(b.cx, b.cy, b.cz);
				for (const [i, scale] of [x * b.hx, y * b.hy, z * b.hz].entries()) {
					const a = b.axes![i];
					p.addScaledVector(new THREE.Vector3(a.x, a.y, a.z), scale);
				}
				return p;
			}),
		),
	);
}

function boxKey(b: ProxyBox): string {
	return [
		b.cx,
		b.cy,
		b.cz,
		b.hx,
		b.hy,
		b.hz,
		...b.axes!.flatMap((a) => [a.x, a.y, a.z]),
	]
		.map((n) => Math.round(n * 1e12))
		.join(",");
}

function checkCellProxies(
	seed: number,
	actual: readonly ProxyPrimitive[],
): void {
	const expected = placedBoxes(seed);
	const bay = stationInterior("trade", STATION_GEOMETRY.trade.aperturePlaneKm);
	const radius = Math.hypot(bay.halfAcrossKm, bay.halfUpKm);
	const keepOut = new THREE.Box3(
		new THREE.Vector3(-radius, -radius, bay.endAxialKm),
		new THREE.Vector3(radius, radius, Infinity),
	);
	const allowedCut = keepOut.clone().expandByScalar(2 * Math.sqrt(3) * 0.001);
	const retained = new Map<string, number>();
	const actualBoxes = new Map<string, ProxyBox>();
	const boundary: ProxyBox[] = [];
	for (const b of actual) {
		expect(b.kind).toBe("box");
		const box = b as ProxyBox;
		const key = boxKey(box);
		actualBoxes.set(key, box);
		retained.set(key, (retained.get(key) ?? 0) + 1);
		for (const p of boxSamples(box))
			expect(proxyContains(expected, p.x, p.y, p.z, 1e-9)).toBe(true);
	}
	for (const b of expected) {
		const samples = boxSamples(b);
		const bounds = new THREE.Box3().setFromPoints(samples);
		if (!bounds.intersectsBox(keepOut)) {
			const key = boxKey(b);
			const count = retained.get(key) ?? 0;
			expect(count).toBeGreaterThan(0);
			retained.set(key, count - 1);
		} else boundary.push(b);
		for (const p of samples) {
			if (keepOut.containsPoint(p)) {
				expect(proxyContains(actual, p.x, p.y, p.z, -1e-9)).toBe(false);
			} else if (!allowedCut.containsPoint(p)) {
				expect(proxyContains(actual, p.x, p.y, p.z, 1e-9)).toBe(true);
			}
		}
	}
	for (const [key, count] of retained) {
		if (count === 0) continue;
		const box = actualBoxes.get(key)!;
		const samples = boxSamples(box);
		expect(
			boundary.some((source) =>
				samples.every((p) => proxyContains([source], p.x, p.y, p.z, 1e-9)),
			),
		).toBe(true);
	}
	for (let dx = -MODULAR_CENTRE; dx <= MODULAR_CENTRE; dx++)
		for (let dy = -MODULAR_CENTRE; dy <= MODULAR_CENTRE; dy++)
			for (const z of [-0.1, 0, 0.1, 0.2]) {
				const p = new THREE.Vector3(
					dx * ASSEMBLY_CELL_KM,
					dy * ASSEMBLY_CELL_KM,
					z,
				);
				expect(proxyContains(actual, p.x, p.y, p.z, 1e-9)).toBe(
					!keepOut.containsPoint(p) &&
						proxyContains(expected, p.x, p.y, p.z, 1e-9),
				);
			}
}

test("seeded proxies place every fitted box in its cell without phantom collision", () => {
	for (const seed of ASSEMBLY_SEEDS) {
		const proxy = stationProxyOf({
			type: "trade",
			formId: "d",
			berthSeed: 0,
			assemblySeed: seed,
		});
		checkCellProxies(seed, proxy.static);
	}
}, 120_000);

test("seeded proxies leave the rotating and static approach clear", () => {
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
