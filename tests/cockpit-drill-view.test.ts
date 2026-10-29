import { afterAll, beforeAll, expect, test } from "bun:test";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import type * as THREE from "three";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { HULL_SPECS } from "../src/hull";
import {
	buildShipMesh,
	cockpitDrillView,
	cockpitOcclusion,
	installLongwallModel,
} from "../src/ship-mesh";
import { v3 } from "../src/vec3";

const COCKPIT_EYE = v3(0, 0, -0.008);
const ABOVE_MOUNTS = v3(0, 0.03, -0.022);
const PARTS = /^(feed|anchor-\d|longwall-mount-)/;

beforeAll(async () => {
	const scene = await decodeShippedGlb("src/models/longwall-miner.glb");
	const mounts = await decodeShippedGlb(
		"spikes/longwall-miner/mounts/longwall-mounts.glb",
	);
	for (const part of [...mounts.children]) scene.add(part);
	await MeshoptSimplifier.ready;
	installLongwallModel(scene);
});
afterAll(installShippedLongwall);

function drawn(root: THREE.Object3D) {
	const out: { mesh: THREE.Object3D; chain: string[] }[] = [];
	const walk = (o: THREE.Object3D, chain: string[]) => {
		if (!o.visible) return;
		const here = [...chain, o.name];
		if ((o as THREE.Mesh).isMesh) out.push({ mesh: o, chain: here });
		for (const c of o.children) walk(c, here);
	};
	walk(root, []);
	return out;
}

const miner = () => buildShipMesh("miner", HULL_SPECS.miner.variant).root;

test("from the cockpit eye the Longwall's hull hides every mount, strut and the drill (F4)", () => {
	const seen = cockpitOcclusion(miner(), COCKPIT_EYE);
	const { fore, up, port, starboard } = seen.axisHitKm;
	for (const hit of [fore, up, port, starboard]) {
		expect(hit).not.toBeNull();
		expect(hit as number).toBeLessThan(0.006);
	}
	const names = seen.parts.map((p) => p.name);
	for (const name of [
		"feed",
		"anchor-0",
		"anchor-3",
		"longwall-mount-port",
		"longwall-mount-starboard",
	])
		expect(names).toContain(name);
	for (const part of seen.parts) expect(part.seen).toBe(false);
});

test("from above the mounts the same rule sees both mounts, so it is not blind (F4 control)", () => {
	const seen = cockpitOcclusion(miner(), ABOVE_MOUNTS);
	for (const side of ["port", "starboard"])
		expect(
			seen.parts.find((p) => p.name === `longwall-mount-${side}`)?.seen,
		).toBe(true);
});

test("the cockpit draws only the parts the hull leaves in view, and leaving puts back what drew (F5)", () => {
	const root = miner();
	const before = drawn(root).map((d) => d.mesh);
	const at = (eye: typeof COCKPIT_EYE) =>
		new Set(
			cockpitOcclusion(root, eye)
				.parts.filter((p) => p.seen)
				.map((p) => p.name),
		);
	cockpitDrillView(root, { seen: at(COCKPIT_EYE) });
	expect(drawn(root)).toEqual([]);
	cockpitDrillView(root, { seen: at(ABOVE_MOUNTS) });
	const shown = drawn(root);
	expect(shown.length).toBeGreaterThan(0);
	for (const d of shown) expect(d.chain.some((n) => PARTS.test(n))).toBe(true);
	cockpitDrillView(root, null);
	expect(drawn(root).map((d) => d.mesh)).toEqual(before);
});
