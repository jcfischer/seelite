import { afterAll, beforeAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	COCKPIT_OCCLUSION,
	cockpitSeenParts,
} from "../src/cockpit-occlusion-table";
import { poseLongwallDrill } from "../src/drill-pose";
import { HULL_SPECS } from "../src/hull";
import {
	buildShipMesh,
	cockpitOcclusion,
	installLongwallModel,
} from "../src/ship-mesh";
import {
	type BridgeSeat,
	type CabinId,
	cockpitEyeKm,
} from "../src/cockpit-eye";

const TABLE = "src/cockpit-occlusion-table.json";
const POSES = [0, 0.25, 0.5, 0.75, 1];
const EYES: readonly { cabin: CabinId; seat: BridgeSeat }[] = [
	{ cabin: "courier", seat: "pilot" },
	{ cabin: "miner", seat: "pilot" },
	{ cabin: "miner", seat: "miner" },
];

beforeAll(async () => {
	const scene = await decodeShippedGlb("src/models/longwall-miner.glb");
	await MeshoptSimplifier.ready;
	installLongwallModel(scene, { posableStruts: true });
});
afterAll(async () => {
	await installShippedLongwall();
});

function measured() {
	const cutter = HULL_SPECS.miner.cutter;
	if (!cutter) throw new Error("the miner carries a cutter");
	const root = buildShipMesh("miner", HULL_SPECS.miner.variant).root;
	return EYES.map(({ cabin, seat }) => {
		const eyeKm = cockpitEyeKm(cabin, seat);
		return {
			cabin,
			seat,
			eyeKm,
			poses: POSES.map((extension) => {
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
	});
}

test("the table holds all five required poses for each eye", () => {
	expect(COCKPIT_OCCLUSION.map((row) => [row.cabin, row.seat])).toEqual(
		EYES.map(({ cabin, seat }) => [cabin, seat]),
	);
	for (const row of COCKPIT_OCCLUSION)
		expect(row.poses.map((pose) => pose.extension)).toEqual(POSES);
});

test("the shipped cockpit occlusion is what the ray rule measures now, for every pose the drill takes and every eye (D-D20)", () => {
	const now = measured();
	if (process.env.WRITE_COCKPIT_OCCLUSION === "1")
		writeFileSync(TABLE, `${JSON.stringify(now, null, "\t")}\n`);
	expect(COCKPIT_OCCLUSION).toEqual(now);
}, 120_000);

test("the cockpit reads the row of the pose nearest the drill's extension", () => {
	for (const row of COCKPIT_OCCLUSION)
		for (const pose of row.poses) {
			expect(cockpitSeenParts(pose.extension, row.cabin, row.seat)).toEqual(
				pose.seen,
			);
			expect(
				cockpitSeenParts(pose.extension + 0.05, row.cabin, row.seat),
			).toEqual(pose.seen);
		}
});
