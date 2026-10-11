import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { COCKPIT_CANOPY_LAMPS, COCKPIT_MODEL_EYE_M } from "../src/cockpit-model";

const FRAME = new Set(["weathered-blue-steel", "exposed-machined-edges"]);
const scene = await decodeShippedGlb("src/models/courier-cockpit.glb");
scene.updateMatrixWorld(true);
const meshes = [];
scene.traverse((o) => {
	if (!o.isMesh) return;
	const mats = Array.isArray(o.material) ? o.material : [o.material];
	if (mats.some((m) => FRAME.has(m?.name ?? ""))) meshes.push(o);
});
const eye = new THREE.Vector3(...COCKPIT_MODEL_EYE_M);
const ray = new THREE.Raycaster();
for (const lamp of COCKPIT_CANOPY_LAMPS) {
	const from = new THREE.Vector3(...lamp.positionM);
	const dir = eye.clone().sub(from).normalize();
	ray.set(from, dir);
	const hits = ray.intersectObjects(meshes, false);
	// Nearest frame surface between the anchor and the eye: an empty list means the
	// anchor already stands proud of the strut toward the pilot.
	const clear = hits.filter((h) => h.distance > 1e-4 && h.distance < 1.5);
	const first = clear.length ? clear[0].distance : 0;
	// And the same ray the other way, into the strut, to see how deep it is buried.
	ray.set(from, dir.clone().negate());
	const back = ray.intersectObjects(meshes, false).filter((h) => h.distance > 1e-4);
	const depth = back.length ? back[0].distance : 0;
	console.log(
		`${lamp.name.padEnd(30)} exit-to-eye ${first.toFixed(3)} m   depth-into-strut ${depth.toFixed(3)} m`,
	);
}