import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	installShippedTrades,
	tradeModelHash,
	uninstallTrades,
} from "../scripts/lib/shipped-trades";
import { stationModel } from "../src/model-catalog";
import { TRADE_FORMS } from "../src/trade-flight";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { buildStationForm, stationSilhouetteKm } from "../src/station-mesh";
import {
	isAuthoredStation,
	AUTHORED_FIXTURE_NAMES,
	SPEC_FIXTURE_NAMES,
} from "../src/station-visuals";
import { forEachWorldTriangle } from "./helpers/world-triangles";
import { corridorIntrusions } from "./helpers/aperture-opening";
import { inOpening, openingOf } from "./helpers/station-proxy-measure";
import {
	overreaches,
	TriangleGrid,
	tradeTriangles,
	type Obb,
} from "../scripts/lib/shipyard-proxies";
import { TRADE_PROXY_SOURCES } from "../src/trade-proxies";
import {
	proxyContains,
	stationProxy,
	stationProxyOf,
	tradeProxyBoxes,
	type ProxyBox,
} from "../src/station-proxy";

beforeAll(installShippedTrades);
afterAll(uninstallTrades);
describe("authored trade forms, node #1033", () => {
	for (const form of TRADE_FORMS) {
		test(`${form}: model, bay and navigation turn together, within the declared reach`, () => {
			const mesh = buildStationForm("trade", form, 0x888888, 7, 7);
			expect(isAuthoredStation(mesh.root)).toBe(true);
			expect(mesh.formId).toBe(form);
			expect(stationModel({ type: "trade", formId: form })).toBe(
				`trade/${form}`,
			);
			const mark = mesh.root.getObjectByName("aperture-plane")!;
			const interior = stationInterior(
				"trade",
				STATION_GEOMETRY.trade.aperturePlaneKm,
				7,
			);
			for (const berth of interior.berths)
				expect(mesh.root.getObjectByName(`berth-${berth.id}`)).toBeDefined();
			expect(corridorIntrusions(mesh.root, "trade").size).toBe(0);
			mesh.root.updateMatrixWorld(true);
			const light = mesh.root.getObjectByName("aperture-light")!;
			const before = light.getWorldPosition(new THREE.Vector3());
			mesh.spinner.rotation.z = 0.7;
			mesh.root.updateMatrixWorld(true);
			expect(
				light
					.getWorldPosition(new THREE.Vector3())
					.distanceTo(before.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.7)),
			).toBeLessThan(1e-6);
			expect(
				mark
					.getWorldPosition(new THREE.Vector3())
					.multiplyScalar(0.6)
					.distanceTo(new THREE.Vector3(0, 0, 0.428)),
			).toBeLessThan(1e-6);
			let reach = 0;
			mesh.root.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					const p = o.geometry.getAttribute("position");
					const v = new THREE.Vector3();
					for (let i = 0; i < p.count; i++)
						reach = Math.max(
							reach,
							v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).length() *
								0.6,
						);
				}
			});
			expect(reach).toBeLessThanOrEqual(stationSilhouetteKm("trade", form));
			expect(mesh.fixtures.length).toBeGreaterThan(0);
			expect(AUTHORED_FIXTURE_NAMES.trade).toEqual(SPEC_FIXTURE_NAMES.trade);
			for (const name of AUTHORED_FIXTURE_NAMES.trade!)
				expect(mesh.root.getObjectByName(name)).toBeDefined();
			const core = mesh.root.getObjectByName("core");
			expect(core).toBeInstanceOf(THREE.Mesh);
			expect(
				(core as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>)
					.material.color,
			).toBeInstanceOf(THREE.Color);
			mesh.dispose();
		});
		test(`${form}: the mouth nameplate is the first surface seen from the approach axis`, () => {
			const mesh = buildStationForm("trade", form, 0x888888, 7, 7);
			mesh.root.updateMatrixWorld(true);
			const plate = mesh.nameplates[0]!;
			const eye = new THREE.Vector3(
				0,
				0,
				STATION_GEOMETRY.trade.aperturePlaneKm * 3,
			).applyMatrix4(mesh.spinner!.matrixWorld);
			plate.geometry.computeBoundingBox();
			const box = plate.geometry.boundingBox!;
			for (const fx of [0.25, 0.5, 0.75])
				for (const fy of [0.25, 0.5, 0.75]) {
					const target = new THREE.Vector3(
						THREE.MathUtils.lerp(box.min.x, box.max.x, fx),
						THREE.MathUtils.lerp(box.min.y, box.max.y, fy),
						box.max.z,
					).applyMatrix4(plate.matrixWorld);
					const first = new THREE.Raycaster(
						eye,
						target.sub(eye).normalize(),
					).intersectObject(mesh.root, true)[0];
					expect(first?.object).toBe(plate);
				}
			mesh.dispose();
		});
		test(`${form}: the sim uses the shipped authored proxy with its stand-in too`, async () => {
			expect(tradeModelHash(form)).toBe(TRADE_PROXY_SOURCES[form]);
			const plan = {
				type: "trade" as const,
				formId: form,
				berthSeed: 7,
				assemblySeed: 7,
			};
			const installed = stationProxyOf(plan);
			uninstallTrades();
			expect(stationProxyOf(plan)).toBe(installed);
			await installShippedTrades();
			expect(installed.static).toEqual([]);
		});
		test(`${form}: every hull box meets the 10 m empty-space rule`, async () => {
			const grid = new TriangleGrid(await tradeTriangles(form));
			const metres = (b: ProxyBox): Obb => ({
				c: new THREE.Vector3(b.cx, b.cy, b.cz).multiplyScalar(1000),
				axes: b.axes!.map(
					(a) => new THREE.Vector3(a.x, a.y, a.z),
				) as Obb["axes"],
				half: [b.hx * 1000, b.hy * 1000, b.hz * 1000],
			});
			expect(
				tradeProxyBoxes(form).filter((b) => overreaches(metres(b), grid)),
			).toEqual([]);
		}, 120000);
		test(`${form}: every exterior vertex outside the sim opening is held within 1.5 m`, async () => {
			const proxy = stationProxy("trade", form, 7, 7)!;
			const opening = openingOf("trade", form);
			let missed = 0;
			for (const tri of await tradeTriangles(form))
				for (const vertex of tri) {
					const v = vertex.clone().multiplyScalar(0.001);
					if (
						!inOpening(opening, v) &&
						!proxyContains(proxy.spinning, v.x, v.y, v.z, 0.0015)
					)
						missed++;
				}
			expect(missed).toBe(0);
		}, 120000);
		test(`${form}: the final composed proxy adds no wall more than 10 m from drawn surfaces`, () => {
			const built = buildStationForm("trade", form, 0x888888, 7, 7);
			built.root.updateMatrixWorld(true);
			const triangles: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
			forEachWorldTriangle(built.root, (triangle) => {
				triangles.push(
					[triangle.a, triangle.b, triangle.c].map((v) =>
						v
							.clone()
							.multiplyScalar(STATION_GEOMETRY.trade.coreRadiusKm * 1000),
					) as [THREE.Vector3, THREE.Vector3, THREE.Vector3],
				);
			});
			const grid = new TriangleGrid(triangles);
			const proxy = stationProxy("trade", form, 7, 7)!;
			const far = proxy.spinning.filter((p) => {
				if (p.kind !== "box") throw Error("expected authored box");
				const axes = p.axes?.map((a) => new THREE.Vector3(a.x, a.y, a.z)) ?? [
					new THREE.Vector3(1, 0, 0),
					new THREE.Vector3(0, 1, 0),
					new THREE.Vector3(0, 0, 1),
				];
				return overreaches(
					{
						c: new THREE.Vector3(p.cx, p.cy, p.cz).multiplyScalar(1000),
						half: [p.hx * 1000, p.hy * 1000, p.hz * 1000],
						axes: axes as Obb["axes"],
					},
					grid,
				);
			});
			built.dispose();
			expect(far.length).toBe(0);
		}, 120000);
	}
	test("uninstalled trade forms stay procedural; Assembly is never an authored model", async () => {
		uninstallTrades();
		for (const form of TRADE_FORMS) {
			const mesh = buildStationForm("trade", form, 0x888888, 7, 7);
			expect(isAuthoredStation(mesh.root)).toBe(false);
			mesh.dispose();
		}
		expect(stationModel({ type: "trade", formId: "d" })).toBeNull();
		await installShippedTrades();
		const assembly = buildStationForm("trade", "d", 0x888888, 7, 7);
		expect(isAuthoredStation(assembly.root)).toBe(false);
		assembly.dispose();
	});
});
