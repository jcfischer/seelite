import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { COCKPIT_CANOPY_LAMPS, COCKPIT_MODEL_EYE_M } from "../src/cockpit-model";
const FRAME = new Set(["weathered-blue-steel", "exposed-machined-edges"]);
const scene = await decodeShippedGlb("src/models/courier-cockpit.glb");
scene.updateMatrixWorld(true);
const meshes = [];
scene.traverse((o) => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material : [o.material]; if (m.some((x) => FRAME.has(x?.name ?? ""))) meshes.push(o); });
const ray = new THREE.Raycaster();
for (const lamp of COCKPIT_CANOPY_LAMPS) {
  const from = new THREE.Vector3(...lamp.positionM);
  const outward = from.clone().sub(new THREE.Vector3(...COCKPIT_MODEL_EYE_M)).normalize();
  ray.set(from, outward);
  const hits = ray.intersectObjects(meshes, false).filter(h => h.distance > 1e-4 && h.distance < 1.5).slice(0,2);
  const p = hits[0];
  console.log(lamp.name.padEnd(30), "lampx", from.x.toFixed(3), "-> hit", p ? `${p.distance.toFixed(3)} at x ${p.point.x.toFixed(2)} y ${p.point.y.toFixed(2)} (${p.object.name || p.object.material?.name})` : "nothing");
}
