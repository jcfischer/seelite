import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { COCKPIT_OCCLUSION } from "../src/cockpit-occlusion-table";
import { HULL_SPECS, withPrototypeMountHardpoints } from "../src/hull";
import {
	buildShipMesh,
	cockpitOcclusion,
	installLongwallModel,
} from "../src/ship-mesh";
import { v3 } from "../src/vec3";

const TABLE = "src/cockpit-occlusion-table.ts";
const stock = HULL_SPECS.miner;
const specs = HULL_SPECS as Record<string, typeof stock>;

beforeAll(async () => {
	specs.miner = withPrototypeMountHardpoints(stock);
	const scene = await decodeShippedGlb("src/models/longwall-miner.glb");
	const mounts = await decodeShippedGlb(
		"spikes/longwall-miner/mounts/longwall-mounts.glb",
	);
	for (const part of [...mounts.children]) scene.add(part);
	await MeshoptSimplifier.ready;
	installLongwallModel(scene);
});
afterAll(async () => {
	specs.miner = stock;
	await installShippedLongwall();
});

function cockpitEyeKm() {
	const forward = /const COCKPIT_FORWARD_KM = ([\d.]+);/.exec(
		readFileSync("src/main.ts", "utf8"),
	);
	if (!forward) throw new Error("main.ts no longer states COCKPIT_FORWARD_KM");
	return v3(0, 0, -Number(forward[1]));
}

function measured() {
	const eyeKm = cockpitEyeKm();
	const result = cockpitOcclusion(
		buildShipMesh("miner", HULL_SPECS.miner.variant).root,
		eyeKm,
	);
	return {
		eyeKm,
		seen: result.parts
			.filter((p) => p.seen)
			.map((p) => p.name)
			.sort(),
	};
}

test("the shipped cockpit occlusion is what the ray rule measures now on the shipped hull and eye (D-D20)", () => {
	const now = measured();
	if (process.env.WRITE_COCKPIT_OCCLUSION === "1")
		writeFileSync(
			TABLE,
			`/**
 * https://github.com/jcfischer/seelite/issues/920
 * What the Longwall's hull hides from the cockpit eye (D-D20), measured by
 * \`cockpitOcclusion\` and written by \`WRITE_COCKPIT_OCCLUSION=1 bun test
 * tests/cockpit-occlusion-table.test.ts\`; that test fails when it is stale.
 */
import type { Vec3 } from "./vec3";

export const COCKPIT_OCCLUSION: {
	readonly eyeKm: Vec3;
	readonly seen: readonly string[];
} = ${JSON.stringify(now, null, "\t")};
`,
		);
	expect(COCKPIT_OCCLUSION.eyeKm).toEqual(now.eyeKm);
	expect([...COCKPIT_OCCLUSION.seen]).toEqual(now.seen);
});
