import { expect, test } from "bun:test";
import * as THREE from "three";
import { reducedLevel, reducedLevelSteps } from "../src/authored-levels";
import { finishHullWork } from "../src/hull-install-work";
import { installPreparedAuthoredHull } from "../src/authored-hull";
import {
	type AuthoredHullBuilder,
	authoredHullBuilder,
	buildShipMesh,
	installAuthoredHull,
} from "../src/ship-mesh";
import { HULL_SPECS } from "../src/hull";
import { ventThroats } from "../src/vent-plumes";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISH_IDS,
	setHullFinish,
} from "../src/ship-surface";

/** Runs fn with every mesh raycast counted, restoring the prototype after. */
function countRaycasts<T>(fn: () => T): { casts: number; value: T } {
	const original = THREE.Mesh.prototype.raycast;
	let casts = 0;
	THREE.Mesh.prototype.raycast = function (...args) {
		casts++;
		return original.apply(this, args);
	};
	try {
		const value = fn();
		return { casts, value };
	} finally {
		THREE.Mesh.prototype.raycast = original;
	}
}

test("reduced geometry yields per mesh and matches the synchronous output", () => {
	const template = new THREE.Group();
	for (let i = 0; i < 3; i++) {
		const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16));
		mesh.position.x = i * 3;
		template.add(mesh);
	}
	const work = reducedLevelSteps(template, 0.05, 0.001, "reduced");
	let steps = 0;
	let result = work.next();
	while (!result.done) {
		steps++;
		result = work.next();
	}
	expect(steps).toBe(3);
	const sync = reducedLevel(template, 0.05, 0.001, "reduced");
	const buffers = (root: THREE.Object3D) =>
		root.children.map((child) => {
			const mesh = child as THREE.Mesh;
			return {
				position: Array.from(mesh.geometry.getAttribute("position").array),
				normal: Array.from(mesh.geometry.getAttribute("normal").array),
				index: Array.from(mesh.geometry.index!.array),
			};
		});
	expect(buffers(result.value)).toEqual(buffers(sync));
	expect(result.value.userData).toEqual(sync.userData);
});

test("installation keeps the previous builder until both glow caches are ready", async () => {
	const old = authoredHullBuilder("tug");
	const builder: AuthoredHullBuilder = (root, exhaust) => {
		root.userData.authoredGlow =
			exhaust.side === THREE.BackSide ? "bowl" : "disc";
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.06));
		root.add(mesh);
		return undefined;
	};
	let slices = 0;
	try {
		await installPreparedAuthoredHull("tug", builder, async (work) => {
			let step = work.next();
			while (!step.done) {
				expect(authoredHullBuilder("tug")).toBe(old);
				slices++;
				await Promise.resolve();
				step = work.next();
			}
			return step.value;
		});
		expect(slices).toBeGreaterThan(HULL_SPECS.tug.vents.length);
		expect(authoredHullBuilder("tug")).toBe(builder);
		const { casts } = countRaycasts(() => {
			for (const finish of HULL_FINISH_IDS) {
				setHullFinish(finish);
				const root = buildShipMesh("tug", HULL_SPECS.tug.variant).root;
				ventThroats(root, "tug");
			}
		});
		expect(casts).toBe(0);
	} finally {
		setHullFinish(DEFAULT_HULL_FINISH);
		installAuthoredHull("tug", old);
	}
});

test("failed preparation leaves the previous builder installed", async () => {
	const old = authoredHullBuilder("tug");
	const geometry = new THREE.BoxGeometry();
	let disposed = 0;
	geometry.addEventListener("dispose", () => disposed++);
	const builder: AuthoredHullBuilder = (root) => {
		root.add(new THREE.Mesh(geometry));
		throw Error("bad model");
	};
	await expect(installPreparedAuthoredHull("tug", builder)).rejects.toThrow(
		"bad model",
	);
	expect(authoredHullBuilder("tug")).toBe(old);
	expect(disposed).toBe(1);
});

test("shipped hulls publish ray-free builds with the measured throats under every finish", async () => {
	try {
		for (const id of ["courier", "tug"] as const) {
			await installPreparedAuthoredHull(id, authoredHullBuilder(id)!);
			for (const finish of HULL_FINISH_IDS) {
				setHullFinish(finish);
				const {
					casts,
					value: { root, cached },
				} = countRaycasts(() => {
					const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
					return { root, cached: ventThroats(root, id) };
				});
				expect([id, finish, casts]).toEqual([id, finish, 0]);
				root.userData.authored = false;
				expect(cached).toEqual(ventThroats(root, id));
			}
		}
	} finally {
		setHullFinish(DEFAULT_HULL_FINISH);
	}
}, 30_000);

test("a failure after the first warmup also leaves the previous builder installed", async () => {
	const old = authoredHullBuilder("tug");
	const builder: AuthoredHullBuilder = (root) => {
		root.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.06)));
		return undefined;
	};
	let phases = 0;
	await expect(
		installPreparedAuthoredHull("tug", builder, async (work) => {
			if (++phases === 2) throw Error("interrupted preparation");
			return finishHullWork(work);
		}),
	).rejects.toThrow("interrupted preparation");
	expect(authoredHullBuilder("tug")).toBe(old);
});
