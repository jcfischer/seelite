// Node #1147 (principal, #920 D-D10): the two Mining Laser mounts of the
// approved study (`build_mounts.py`, `longwall-mounts.glb`) grafted into the
// approved Longwall B export, so the shipped file draws them. The mount parts
// go into the export's static `hull` group with the export's own materials of
// the same name, so `batchLongwallHull` merges them into the hull's batches and
// they add no draw. Two empty nodes, `muzzle-h2` (port) and `muzzle-h3`
// (starboard), mark each mount's muzzle tip from `mounts.json`, so the game
// reads the hardpoint order by name (`shipMuzzlesKm`) instead of a name sort.
//
// Both the shipped asset's build (`prepare-flight-asset.mjs`) and its check
// (`verify-flight-asset.mjs`) call this, so they compare the same model.

import { readFile } from "node:fs/promises";

const MOUNTS_GLB = "spikes/longwall-miner/mounts/longwall-mounts.glb";
const MOUNTS_JSON = "spikes/longwall-miner/mounts/mounts.json";

/** The hardpoint each mount carries (D-D10: h2 port, h3 starboard). */
export const MOUNT_SLOTS = { port: "h2", starboard: "h3" };

export async function graftMounts(document, io) {
	const mounts = await io.read(MOUNTS_GLB);
	const { muzzles } = JSON.parse(await readFile(MOUNTS_JSON, "utf8"));
	const root = document.getRoot();
	const scene = root.listScenes()[0];
	const hull = scene.listChildren().find((n) => n.getName() === "hull");
	if (!hull) throw new Error("the Longwall export has no `hull` group");
	const identity = (n) =>
		n.getTranslation().every((v) => v === 0) &&
		n.getRotation().every((v, i) => v === (i === 3 ? 1 : 0)) &&
		n.getScale().every((v) => v === 1);
	if (!identity(hull))
		throw new Error("the export's `hull` group is not at the scene's frame");
	const material = (name) => {
		const found = root.listMaterials().find((m) => m.getName() === name);
		if (!found) throw new Error(`the Longwall export has no ${name} material`);
		return found;
	};
	const buffer = root.listBuffers()[0];
	for (const mount of mounts.getRoot().listScenes()[0].listChildren()) {
		if (!identity(mount))
			throw new Error(`${mount.getName()}: the mount root is not at the frame`);
		for (const part of mount.listChildren()) {
			const source = part.getMesh();
			if (!source || part.listChildren().length)
				throw new Error(`${part.getName()}: expected one mesh and no children`);
			const mesh = document.createMesh(source.getName());
			for (const p of source.listPrimitives()) {
				const primitive = document
					.createPrimitive()
					.setMode(p.getMode())
					.setMaterial(material(p.getMaterial().getName()));
				for (const semantic of p.listSemantics()) {
					const a = p.getAttribute(semantic);
					primitive.setAttribute(
						semantic,
						document
							.createAccessor()
							.setType(a.getType())
							.setArray(a.getArray().slice())
							.setBuffer(buffer),
					);
				}
				const index = p.getIndices();
				if (index)
					primitive.setIndices(
						document
							.createAccessor()
							.setType(index.getType())
							.setArray(index.getArray().slice())
							.setBuffer(buffer),
					);
				mesh.addPrimitive(primitive);
			}
			hull.addChild(
				document
					.createNode(part.getName())
					.setTranslation(part.getTranslation())
					.setRotation(part.getRotation())
					.setScale(part.getScale())
					.setMesh(mesh),
			);
		}
	}
	for (const [side, slot] of Object.entries(MOUNT_SLOTS))
		scene.addChild(
			document.createNode(`muzzle-${slot}`).setTranslation(muzzles[side]),
		);
	return document;
}
