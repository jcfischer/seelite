import { decodeShippedGlb } from "../../scripts/lib/shipped-glb";

/** Decode the shipped geometry through the same loader as the browser.
 * Remove only texture references: Bun has no image decoder. Materials, names,
 * compressed vertex buffers and node transforms are retained, including normals.
 */
/** Each name's file, written out: `tests/spike-binaries-lfs.test.ts` finds a
 *  spike binary a test reads by its literal path. */
const CORIOLIS_GLBS = {
	"coriolis-industrial-flight.glb": "src/models/coriolis.glb",
	"coriolis-detail.glb": "src/models/coriolis-detail.glb",
	"coriolis-industrial.glb": "spikes/coriolis/coriolis-industrial.glb",
} as const;

export async function readCoriolisGlb(name: keyof typeof CORIOLIS_GLBS) {
	const scene = await decodeShippedGlb(CORIOLIS_GLBS[name]);
	scene.scale.setScalar(0.001);
	scene.updateMatrixWorld(true);
	return scene;
}

export async function readShippedCoriolisBuilder() {
	const { createIndustrialCoriolisBuilder } = await import(
		"../../src/coriolis-flight"
	);
	const template = await readCoriolisGlb("coriolis-industrial-flight.glb");
	const detail = await readCoriolisGlb("coriolis-detail.glb");
	const build = createIndustrialCoriolisBuilder(template);
	build.addDetail(detail);
	return { template, detail, build };
}
