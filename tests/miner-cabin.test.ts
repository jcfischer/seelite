import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { cabinForHull, cockpitEyeKm } from "../src/cockpit-eye";
import {
	adoptCockpitTemplate,
	buildAuthoredCabin,
	cabinConsoleLamps,
	COCKPIT_MODEL_KM_PER_M,
	cockpitModelReady,
	MINER_SEAT_OFFSET_M,
} from "../src/cockpit-model";
import {
	COCKPIT_OCCLUSION,
	cockpitSeenParts,
} from "../src/cockpit-occlusion-table";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { bootModelIds, systemModelIds } from "../src/system-models";
import { CockpitReadouts } from "../src/cockpit-text";
import { MINER_FACE_SCREENS } from "../src/miner-faces";
import { buildShipMesh, installLongwallModel } from "../src/ship-mesh";
import { makeWorld } from "../src/sim";

const ASSET = "src/models/miner-cockpit.glb";
const HOST_LIMIT_BYTES = 25 * 1024 * 1024;

function withCanvasStub<T>(
	body: () => T,
	ctx: object = { fillRect: () => {}, fillText: () => {} },
): T {
	const previous = (globalThis as { document?: unknown }).document;
	(globalThis as { document?: unknown }).document = {
		createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
	};
	try {
		return body();
	} finally {
		(globalThis as { document?: unknown }).document = previous;
	}
}

let scene: THREE.Group;
beforeAll(async () => {
	scene = await decodeShippedGlb(ASSET);
});

describe("the cabin follows the flown hull", () => {
	test("the miner flies the bridge and every other hull the courier's cabin", () => {
		for (const hull of HULL_IDS)
			expect(cabinForHull(hull)).toBe(hull === "miner" ? "miner" : "courier");
	});

	test("a hull with no cabin of its own keeps the eye it has today", () => {
		for (const hull of HULL_IDS.filter((h) => h !== "miner")) {
			expect(cabinForHull(hull)).toBe("courier");
		}
		expect(cockpitEyeKm("courier", "pilot")).toEqual({ x: 0, y: 0, z: -0.008 });
	});

	test("only the flown miner adds the bridge to a system's models, and never to the boot set", () => {
		const { system } = makeWorld(42);
		expect(systemModelIds(system, [], "miner")).toContain("cockpit/miner");
		expect(systemModelIds(system, ["miner"], "courier")).not.toContain(
			"cockpit/miner",
		);
		expect(bootModelIds(system, null)).not.toContain("cockpit/miner");
	});
});

describe("the shipping asset", () => {
	test("its size is inside the host's limit and its bytes are the prepared ones", () => {
		expect(statSync(ASSET).size).toBeLessThan(HOST_LIMIT_BYTES);
		expect(createHash("sha256").update(readFileSync(ASSET)).digest("hex")).toBe(
			"69cea9109535eaa071ac908aeb45ae170578741ca0903008937062e11ed6e861",
		);
	});

	test("decoded by the production loader it holds the study's screens and both seats", () => {
		const names: string[] = [];
		scene.traverse((o) => {
			if ((o as THREE.Mesh).isMesh) names.push(o.name);
		});
		for (const screen of [
			"anchor",
			"drill",
			"drillcam",
			"flight",
			"lasers",
			"notices",
			"ore",
			"radar",
			"stance",
			"status",
			"survey",
			"target",
		])
			expect(names).toContain(`screen-${screen}`);
		for (const seat of ["00", "12"])
			expect(names).toContain(`seat-shell-back-${seat}`);
	});

	test("the bridge is authored around the eye: unit metres, one hull width, level", () => {
		const box = new THREE.Box3().setFromObject(scene);
		expect(box.max.x - box.min.x).toBeGreaterThan(4);
		expect(box.max.x - box.min.x).toBeLessThan(8);
		expect(box.containsPoint(new THREE.Vector3())).toBe(true);
	});

	test("the second seat is the seat offset to starboard of the pilot's", () => {
		const seatX = (name: string) =>
			new THREE.Box3()
				.setFromObject(scene.getObjectByName(name) as THREE.Object3D)
				.getCenter(new THREE.Vector3()).x;
		expect(
			seatX("seat-shell-back-12") - seatX("seat-shell-back-00"),
		).toBeCloseTo(MINER_SEAT_OFFSET_M, 2);
	});
});

describe("the installed bridge", () => {
	test("the cabin has no adopted template until its load finishes, then builds at scale with no offset", () => {
		expect(cockpitModelReady("miner")).toBe(false);
		adoptCockpitTemplate(scene, "miner");
		expect(cockpitModelReady("miner")).toBe(true);
		const cabin = withCanvasStub(() => buildAuthoredCabin(scene, "miner"));
		expect(cabin.modelSpace.position.length()).toBe(0);
		expect(cabin.root.rotation.x).toBeCloseTo(0.12, 6);
		expect(cabin.modelSpace.scale.x).toBe(COCKPIT_MODEL_KM_PER_M);
		for (const name of MINER_FACE_SCREENS)
			expect(cabin.screens[name]).toBeDefined();
		expect(cabinConsoleLamps("miner")[0].positionM).not.toEqual(
			cabinConsoleLamps("courier")[0].positionM,
		);
	});

	test("a face-owned source is never drawn on the fallback console", () => {
		const root = new THREE.Group();
		const frame = {
			center: new THREE.Vector3(),
			right: new THREE.Vector3(1, 0, 0),
			up: new THREE.Vector3(0, 1, 0),
			normal: new THREE.Vector3(0, 0, 1),
			widthKm: 1,
			heightKm: 0.5,
		};
		const painted: string[] = [];
		const ctx = {
			canvas: { width: 512, height: 256 },
			save() {},
			restore() {},
			clearRect() {},
			fillRect() {},
			beginPath() {},
			rect() {},
			clip() {},
			strokeRect() {},
			measureText: () => ({ width: 1 }),
			fillText: (text: string) => painted.push(text),
		};
		withCanvasStub(() => {
			const readouts = new CockpitReadouts(root, {}, frame, new Set(["ore"]));
			readouts.write("ore", [{ text: "ORE LINE" }]);
			readouts.write("course", [{ text: "COURSE LINE" }]);
			readouts.flush();
			expect(painted).toContain("COURSE LINE");
			expect(painted).not.toContain("ORE LINE");
			expect(readouts.readings.get("ore")?.[0].text).toBe("ORE LINE");
		}, ctx);
	});
});

describe("the bridge eye in the production hull", () => {
	beforeAll(async () => {
		const hull = await decodeShippedGlb("src/models/longwall-miner.glb");
		await MeshoptSimplifier.ready;
		installLongwallModel(hull, { posableStruts: true });
	}, 60_000);

	const hullRoot = () => {
		const root = buildShipMesh("miner", HULL_SPECS.miner.variant).root;
		root.updateMatrixWorld(true);
		return root;
	};

	test("both seats sit inside the hull's bridge glazing, 0.6 m either side of the centre line", () => {
		let glazing: THREE.Object3D | undefined;
		const root = hullRoot();
		root.traverse((o) => {
			if ((o as THREE.Mesh).isMesh && /bridge-glazing/.test(o.name))
				glazing ??= o;
		});
		const box = new THREE.Box3().setFromObject(glazing as THREE.Object3D);
		for (const seat of ["pilot", "miner"] as const) {
			const eye = cockpitEyeKm("miner", seat);
			expect(box.containsPoint(new THREE.Vector3(eye.x, eye.y, eye.z))).toBe(
				true,
			);
			expect(Math.abs(eye.x)).toBeCloseTo(0.0006, 9);
		}
		expect(
			cockpitEyeKm("miner", "miner").x - cockpitEyeKm("miner", "pilot").x,
		).toBeCloseTo(MINER_SEAT_OFFSET_M / 1000, 9);
	}, 60_000);

	test("the eye is the study's (0.6, 5.21, 20.2) m carried through the hull's export frame", () => {
		const root = hullRoot();
		const exterior = root.getObjectByName(
			"longwall-exterior",
		) as THREE.Object3D;
		const eye = cockpitEyeKm("miner", "pilot");
		const study = new THREE.Vector3(0.6, 5.21, 20.2).applyMatrix4(
			exterior.matrixWorld,
		);
		expect(study.x).toBeCloseTo(eye.x, 5);
		expect(study.y).toBeCloseTo(eye.y, 5);
		expect(study.z).toBeCloseTo(eye.z, 5);
	}, 60_000);

	test("the table holds a row for each seat at the bridge eye, kept apart from the courier's", () => {
		const row = (seat: "pilot" | "miner") =>
			COCKPIT_OCCLUSION.find((r) => r.cabin === "miner" && r.seat === seat);
		expect(row("pilot")?.eyeKm).toEqual(cockpitEyeKm("miner", "pilot"));
		expect(row("miner")?.eyeKm).toEqual(cockpitEyeKm("miner", "miner"));
		expect(cockpitSeenParts(0, "courier", "pilot")).toEqual(["anchor-3-elbow"]);
	});
});
