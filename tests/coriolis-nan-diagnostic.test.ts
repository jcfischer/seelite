import { expect, test } from "bun:test";
import * as THREE from "three";
import { setStationDetail } from "../src/station-mesh";
import {
	readCoriolisGlb,
	readShippedCoriolisBuilder,
} from "./helpers/read-coriolis-glb";

const bad = (a: ArrayLike<number>) => {
	let n = 0;
	for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) n++;
	return n;
};

test("diagnose the CI-only NaN in the Coriolis detail", async () => {
	const decoded = await readCoriolisGlb("coriolis-detail.glb");
	decoded.traverse((o) => {
		if (o instanceof THREE.Mesh)
			console.log(
				"DIAG decoded",
				o.name,
				"pos",
				bad(o.geometry.getAttribute("position").array),
				"matrix",
				bad(o.matrixWorld.elements),
			);
	});
	const { build } = await readShippedCoriolisBuilder();
	for (const seed of [0, 1, 7]) {
		const station = build(seed, 0x9aa6b2);
		setStationDetail(station, "full");
		station.root.updateMatrixWorld(true);
		station.root.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || !o.name.startsWith("scale-detail-"))
				return;
			const p = o.geometry.getAttribute("position");
			const first = [p.getX(0), p.getY(0), p.getZ(0)];
			console.log(
				"DIAG built",
				seed,
				o.name,
				"pos",
				bad(p.array),
				"matrix",
				bad(o.matrixWorld.elements),
				"first",
				first.join(","),
				"chain",
				(() => {
					const names: string[] = [];
					for (let a: THREE.Object3D | null = o; a; a = a.parent)
						if (bad(a.matrix.elements)) names.push(a.name || a.type);
					return names.join("<");
				})(),
			);
		});
		station.dispose();
	}
	expect(true).toBe(true);
});
