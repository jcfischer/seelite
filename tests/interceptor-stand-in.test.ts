import { expect, test } from "bun:test";
import { HULL_SPECS } from "../src/hull";
import { authoredHullBuilder, buildShipMesh } from "../src/ship-mesh";

test("a file without Lance setup keeps the procedural interceptor", () => {
	expect(authoredHullBuilder("interceptor")).toBeUndefined();
	const root = buildShipMesh(
		"interceptor",
		HULL_SPECS.interceptor.variant,
	).root;
	expect(root.userData.authored).not.toBe(true);
	expect(root.getObjectByName("interceptor-fuselage")).toBeDefined();
});
