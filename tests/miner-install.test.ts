import { expect, test } from "bun:test";
import type * as THREE from "three";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { drainWith } from "./helpers/drain-steps";
import { HULL_SPECS } from "../src/hull";
import {
	buildShipMesh,
	rebuildAuthoredStandIn,
	installLongwallModel,
	installLongwallModelSliced,
} from "../src/ship-mesh";

test("a miner can draw before its template arrives and replaces its stand-in once", async () => {
	installLongwallModel(null);
	try {
		const root = buildShipMesh("miner", HULL_SPECS.miner.variant).root;
		expect(root.userData.authored).not.toBe(true);
		expect(root.children.length).toBeGreaterThan(0);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		await installShippedLongwall();
		expect(rebuildAuthoredStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
	} finally {
		await installShippedLongwall();
	}
});

const drawn = (root: THREE.Object3D) => {
	const rows: string[] = [];
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		const position = mesh.geometry?.getAttribute("position");
		if (position)
			rows.push(
				`${o.name} ${position.count} ${mesh.geometry.index?.count ?? 0} ${[...(position.array as Float32Array).slice(0, 12)].map((v) => v.toFixed(6)).join(",")}`,
			);
	});
	return rows;
};

test("the loader installs the miner in slices, publishing the synchronous template only at the end (node #907)", async () => {
	try {
		installLongwallModel(null);
		let yields = 0;
		let authoredMidway = false;
		await installLongwallModelSliced(
			await decodeShippedGlb("src/models/longwall-miner.glb"),
			{},
			drainWith(() => {
				if (++yields === 1)
					authoredMidway = !!buildShipMesh("miner", HULL_SPECS.miner.variant)
						.root.userData.authored;
			}),
		);
		expect(authoredMidway).toBe(false);
		expect(yields).toBeGreaterThan(10);
		const sliced = drawn(buildShipMesh("miner", HULL_SPECS.miner.variant).root);
		expect(sliced.length).toBeGreaterThan(10);
		await installShippedLongwall();
		expect(sliced).toEqual(
			drawn(buildShipMesh("miner", HULL_SPECS.miner.variant).root),
		);
	} finally {
		await installShippedLongwall();
	}
});
