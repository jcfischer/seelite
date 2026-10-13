import * as THREE from "three";
import { installShippedLongwall } from "../../scripts/lib/install-longwall";
import { buildShipMesh } from "../../src/ship-mesh";
await installShippedLongwall();
const ship = buildShipMesh("miner", "b" as never).root;
ship.updateMatrixWorld(true);
const names: string[] = [];
ship.traverse((o) => { if (/cutter|anchor|rotor|drill|ring/i.test(o.name)) names.push(o.name); });
console.log([...new Set(names)].slice(0, 60).join("\n"));
const box = new THREE.Box3().setFromObject(ship);
console.log("ship box km", box.min.toArray(), box.max.toArray());
for (const n of ["rotor", "cutter", "cutter-head", "cutter-boom"]) {
	const o = ship.getObjectByName(n);
	if (!o) { console.log(n, "absent"); continue; }
	const b = new THREE.Box3().setFromObject(o);
	console.log(n, "min", b.min.toArray().map((x) => (x * 1000).toFixed(2)), "max", b.max.toArray().map((x) => (x * 1000).toFixed(2)), "m");
	let p = o.parent; const chain = []; while (p) { chain.push(p.name); p = p.parent; } console.log("  chain", chain.join(" < "));
}
