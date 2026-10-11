import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { COCKPIT_CANOPY_LAMPS, COCKPIT_MODEL_EYE_M } from "../src/cockpit-model";
const FRAME = new Set(["weathered-blue-steel", "exposed-machined-edges"]);
const scene = await decodeShippedGlb("src/models/courier-cockpit.glb");
scene.updateMatrixWorld(true);
const meshes = [];
scene.traverse((o) => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material : [o.material]; if (m.some((x) => FRAME.has(x?.name ?? ""))) meshes.push(o); });
const eye = new THREE.Vector3(...COCKPIT_MODEL_EYE_M);
const ray = new THREE.Raycaster();
const MARGIN = 0.015;
for (const lamp of COCKPIT_CANOPY_LAMPS) {
  const from = new THREE.Vector3(...lamp.positionM);
  const dir = eye.clone().sub(from).normalize();
  ray.set(from, dir);
  const clear = ray.intersectObjects(meshes, false).filter((h) => h.distance > 1e-4 && h.distance < 1.5);
  const exit = clear.length ? clear[0].distance : 0;
  const to = from.clone().addScaledVector(dir, exit + MARGIN);
  // Reach back out to the strut the lamp is now mounted in front of.
  ray.set(to, dir.clone().negate());
  const back = ray.intersectObjects(meshes, false).filter((h) => h.distance > 1e-4);
  const reach = back.length ? back[0].distance : Infinity;
  const r = to.distanceTo(eye);
  console.log(`${lamp.name.padEnd(30)} [${to.x.toFixed(3)}, ${to.y.toFixed(3)}, ${to.z.toFixed(3)}]  r ${r.toFixed(3)}  reach ${reach.toFixed(3)}`);
}
