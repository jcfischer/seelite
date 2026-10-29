import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	COCKPIT_OCCLUSION,
	cockpitSeenParts,
} from "../src/cockpit-occlusion-table";
import { poseLongwallDrill } from "../src/drill-pose";
import { HULL_SPECS, withPrototypeMountHardpoints } from "../src/hull";
import {
	buildShipMesh,
	cockpitOcclusion,
	installLongwallModel,
	keepLongwallStrutsPosable,
} from "../src/ship-mesh";
import { v3 } from "../src/vec3";

const TABLE = "src/cockpit-occlusion-table.ts";
const POSES = [0, 0.25, 0.5, 0.75, 1];
const stock = HULL_SPECS.miner;
const specs = HULL_SPECS as Record<string, typeof stock>;

beforeAll(async () => {
	specs.miner = withPrototypeMountHardpoints(stock);
	keepLongwallStrutsPosable();
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
	keepLongwallStrutsPosable(false);
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
	const cutter = HULL_SPECS.miner.cutter;
	if (!cutter) throw new Error("the miner carries a cutter");
	return {
		eyeKm,
		poses: POSES.map((extension) => {
			const root = buildShipMesh("miner", HULL_SPECS.miner.variant).root;
			poseLongwallDrill(root, cutter, extension);
			return {
				extension,
				seen: cockpitOcclusion(root, eyeKm)
					.parts.filter((p) => p.seen)
					.map((p) => p.name)
					.sort(),
			};
		}),
	};
}

test("the shipped cockpit occlusion is what the ray rule measures now, for every pose the drill takes (D-D20)", () => {
	const now = measured();
	if (process.env.WRITE_COCKPIT_OCCLUSION === "1")
		writeFileSync(
			TABLE,
			`/**
 * https://github.com/jcfischer/seelite/issues/920
 * What the Longwall's hull hides from the cockpit eye (D-D20), for the drill
 * posed by \`poseLongwallDrill\` at each extension, measured by
 * \`cockpitOcclusion\` and written by \`WRITE_COCKPIT_OCCLUSION=1 bun test
 * tests/cockpit-occlusion-table.test.ts\`; that test fails when it is stale.
 */
import type { Vec3 } from "./vec3";

export const COCKPIT_OCCLUSION: {
	readonly eyeKm: Vec3;
	readonly poses: readonly {
		readonly extension: number;
		readonly seen: readonly string[];
	}[];
} = ${JSON.stringify(now, null, "\t")};

/** The parts the cockpit sees with the drill at \`extension\`: the row of the nearest measured pose. */
export function cockpitSeenParts(extension: number): readonly string[] {
	let best = COCKPIT_OCCLUSION.poses[0];
	for (const pose of COCKPIT_OCCLUSION.poses)
		if (
			Math.abs(pose.extension - extension) <
			Math.abs(best.extension - extension)
		)
			best = pose;
	return best?.seen ?? [];
}
`,
		);
	expect(COCKPIT_OCCLUSION.eyeKm).toEqual(now.eyeKm);
	expect(COCKPIT_OCCLUSION.poses).toEqual(now.poses);
}, 120_000);

test("the cockpit reads the row of the pose nearest the drill's extension", () => {
	for (const pose of COCKPIT_OCCLUSION.poses) {
		expect(cockpitSeenParts(pose.extension)).toEqual(pose.seen);
		expect(cockpitSeenParts(pose.extension + 0.05)).toEqual(pose.seen);
	}
});
