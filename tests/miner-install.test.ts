import { expect, test } from "bun:test";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { HULL_SPECS } from "../src/hull";
import {
	buildShipMesh,
	rebuildAuthoredStandIn,
	installLongwallModel,
} from "../src/ship-mesh";

test("a miner can draw before its template arrives and replaces its stand-in once", async () => {
	installLongwallModel(null);
	try {
		const root = buildShipMesh("miner", HULL_SPECS.miner.variant).root;
		expect(root.userData.authored).not.toBe(true);
		expect(root.children.length).toBeGreaterThan(0);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		await installShippedLongwall();
		expect(rebuildAuthoredStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
	} finally {
		await installShippedLongwall();
	}
});
