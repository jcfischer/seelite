import { afterEach, expect, test } from "bun:test";
import * as THREE from "three";
import { runInteriorSlices } from "../src/interior-install";
import {
	buildStationInterior,
	installInteriorKitBuilder,
	refreshStationInteriorKitAsync,
	NAMEPLATE_NAME,
} from "../src/station-interior-mesh";
import { stationInterior } from "../src/station-interior";
import { STATION_GEOMETRY } from "../src/station";

afterEach(() => installInteriorKitBuilder(null));

test("slice budget yields to the next frame, closes cancelled work, and propagates failure", async () => {
	let time = 0,
		frames = 0,
		closed = 0;
	function* work() {
		try {
			for (let i = 0; i < 9; i++) {
				time += 2;
				yield;
			}
			return 42;
		} finally {
			closed++;
		}
	}
	const options = {
		now: () => time,
		yieldFrame: async () => {
			frames++;
		},
		budgetMs: 4,
	};
	expect(await runInteriorSlices(work(), options)).toBe(42);
	expect(frames).toBe(4);
	expect(closed).toBe(1);
	frames = 0;
	expect(
		await runInteriorSlices(work(), { ...options, live: () => frames < 1 }),
	).toBeUndefined();
	expect(closed).toBe(2);
	function* broken() {
		yield;
		throw Error("bad fitting");
	}
	await expect(runInteriorSlices(broken(), options)).rejects.toThrow(
		"bad fitting",
	);
});

test("async replacement retains the stand-in until complete and coalesces concurrent calls", async () => {
	const root = buildStationInterior(
		"trade",
		stationInterior("trade", STATION_GEOMETRY.trade.aperturePlaneKm, 47),
	);
	const before = [...root.children];
	let builds = 0;
	const kit = new THREE.Group();
	kit.name = "authored-interior";
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	installInteriorKitBuilder(
		() => kit,
		async () => {
			builds++;
			await gate;
			return kit;
		},
	);
	const first = refreshStationInteriorKitAsync(root);
	const second = refreshStationInteriorKitAsync(root);
	expect(root.children).toEqual(before);
	expect(root.userData.interiorStandIn).toBeDefined();
	release();
	expect(await first).toBe(true);
	await second;
	expect(builds).toBe(1);
	expect(root.children).toEqual([
		...before.filter((c) => c.name === NAMEPLATE_NAME),
		kit,
	]);
	expect(root.userData.interiorStandIn).toBeUndefined();
	expect(await refreshStationInteriorKitAsync(root)).toBe(false);
});

test("a failed or obsolete build retains the stand-in and frees the uninstalled kit", async () => {
	const root = buildStationInterior(
		"trade",
		stationInterior("trade", STATION_GEOMETRY.trade.aperturePlaneKm, 47),
	);
	const before = [...root.children];
	installInteriorKitBuilder(
		() => new THREE.Group(),
		async () => {
			throw Error("bad fitting");
		},
	);
	await expect(refreshStationInteriorKitAsync(root)).rejects.toThrow(
		"bad fitting",
	);
	expect(root.children).toEqual(before);
	const kit = new THREE.Group();
	const geometry = new THREE.BoxGeometry();
	let disposed = 0;
	geometry.addEventListener("dispose", () => disposed++);
	kit.add(new THREE.Mesh(geometry));
	let live = true;
	installInteriorKitBuilder(
		() => kit,
		async () => {
			live = false;
			return kit;
		},
	);
	expect(await refreshStationInteriorKitAsync(root, () => live)).toBe(false);
	expect(root.children).toEqual(before);
	expect(disposed).toBe(1);
});

test("shader preparation finishes before replacement, and a preparation failure frees the kit", async () => {
	const root = buildStationInterior(
		"trade",
		stationInterior("trade", STATION_GEOMETRY.trade.aperturePlaneKm, 47),
	);
	const before = [...root.children];
	const kit = new THREE.Group();
	const geometry = new THREE.BoxGeometry();
	let disposed = 0;
	geometry.addEventListener("dispose", () => disposed++);
	kit.add(new THREE.Mesh(geometry));
	installInteriorKitBuilder(
		() => kit,
		async () => kit,
	);
	await expect(
		refreshStationInteriorKitAsync(
			root,
			() => true,
			async () => {
				expect(root.children).toEqual(before);
				throw Error("shader failed");
			},
		),
	).rejects.toThrow("shader failed");
	expect(root.children).toEqual(before);
	expect(disposed).toBe(1);
	const replacement = new THREE.Group();
	installInteriorKitBuilder(
		() => replacement,
		async () => replacement,
	);
	let warmed = false;
	expect(
		await refreshStationInteriorKitAsync(
			root,
			() => true,
			async () => {
				expect(root.children).toEqual(before);
				await Promise.resolve();
				warmed = true;
			},
		),
	).toBe(true);
	expect(warmed).toBe(true);
	expect(root.children).toContain(replacement);
});
