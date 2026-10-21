import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import * as THREE from "three";
import { installTradeBuilder } from "../../src/station-mesh";
import { AUTHORED_EXTERIOR_NAME } from "../../src/station-visuals";

mock.module("../../scripts/lib/shipped-trades", () => ({
	installShippedTrades: async () => {},
}));

let disposed = 0;
for (const form of ["b", "c", "e"] as const) {
	installTradeBuilder(form, () => {
		const root = new THREE.Group();
		const exterior = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01));
		exterior.name = AUTHORED_EXTERIOR_NAME;
		exterior.position.x = 1;
		root.add(exterior);
		return {
			root,
			spinner: root,
			type: "trade",
			formId: form,
			silhouetteKm: 1,
			detail: "full",
			fixtures: [],
			accessories: [],
			nameplates: [],
			greebles: [],
			dispose: () => {
				disposed++;
				exterior.geometry.dispose();
			},
		};
	});
}

const { fitTradeProxies } = await import("../../scripts/lib/shipyard-proxies");
const log = console.log;
const failure = new Error("interrupted fit");
process.env.SHIPYARD_PROXY_LOG = "1";
console.log = () => {
	throw failure;
};
try {
	await assert.rejects(fitTradeProxies(), (error) => error === failure);
} finally {
	console.log = log;
	delete process.env.SHIPYARD_PROXY_LOG;
}
assert.equal(disposed, 1);
const fitted = await fitTradeProxies();
assert.deepEqual(Object.keys(fitted), ["b", "c", "e"]);
for (const { hull } of Object.values(fitted)) assert.equal(hull.length, 1);
assert.equal(disposed, 4);
