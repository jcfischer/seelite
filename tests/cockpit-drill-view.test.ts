import { expect, test } from "bun:test";
import type * as THREE from "three";
import { HULL_SPECS } from "../src/hull";
import { buildShipMesh, cockpitDrillView } from "../src/ship-mesh";

const DRILL = /^(feed|anchor-\d)/;
const MOUNT = /^longwall-mount-/;

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

const under = (chain: string[], re: RegExp) => chain.some((n) => re.test(n));

test("the cockpit draws the drill and its struts when deployed, and no hull (F3)", () => {
	const root = buildShipMesh("miner", HULL_SPECS.miner.variant).root;
	const before = drawn(root).map((d) => d.mesh);
	cockpitDrillView(root, { drill: true });
	const shown = drawn(root);
	expect(shown.length).toBeGreaterThan(0);
	for (const d of shown)
		expect(under(d.chain, DRILL) || under(d.chain, MOUNT)).toBe(true);
	expect(shown.some((d) => under(d.chain, /^feed$/))).toBe(true);
	expect(shown.some((d) => under(d.chain, /^anchor-\d/))).toBe(true);
	cockpitDrillView(root, { drill: false });
	for (const d of drawn(root)) expect(under(d.chain, DRILL)).toBe(false);
	cockpitDrillView(root, null);
	expect(drawn(root).map((d) => d.mesh)).toEqual(before);
});
