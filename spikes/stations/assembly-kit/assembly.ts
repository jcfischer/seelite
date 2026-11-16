import type * as THREE from "three";
import { createAssemblyBlocks, assemblyInstances } from "../../../src/assembly-flight";
import { buildStationForm, installAssemblyBlocks } from "../../../src/station-mesh";
import { modularPlacements } from "../../../src/station-modular";

export function buildSpike(seed: number, kit?: THREE.Object3D) {
	const { placements } = modularPlacements(seed);
	installAssemblyBlocks(kit ? createAssemblyBlocks(kit) : null);
	try {
		const mesh = buildStationForm("trade", "d", 0xa6adb0, 0, seed);
		return { mesh, placements, instances: kit ? assemblyInstances(placements) : [] };
	} finally {
		installAssemblyBlocks(null);
	}
}
