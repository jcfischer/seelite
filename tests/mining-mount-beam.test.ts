import { expect, test } from "bun:test";
import mounts from "../spikes/longwall-miner/mounts/mounts.json";
import { HULL_SPECS } from "../src/hull";
import {
	beamClearsCutter,
	miningBeamRays,
	mountMuzzleKm,
} from "../src/rock-drill";
import { v3 } from "../src/vec3";

const cutter = HULL_SPECS.miner.cutter;
if (!cutter) throw new Error("the miner carries a cutter");
const BOW = v3(0, 0, -0.0398);

test("the study's mount muzzles are the slot muzzles D-D11 names: (∓5.3, 5.81, −22.8) m", () => {
	const port = mountMuzzleKm(mounts.muzzles.port, cutter);
	const starboard = mountMuzzleKm(mounts.muzzles.starboard, cutter);
	for (const [m, x] of [
		[port, -5.3],
		[starboard, 5.3],
	] as const) {
		expect(m.x * 1000).toBeCloseTo(x, 6);
		expect(m.y * 1000).toBeCloseTo(5.81, 6);
		expect(m.z * 1000).toBeCloseTo(-22.8, 6);
	}
});

test("a mount's beam clears the deployed drill, and a beam from the bow does not", () => {
	expect(
		beamClearsCutter(mountMuzzleKm(mounts.muzzles.port, cutter), cutter),
	).toBe(true);
	expect(
		beamClearsCutter(mountMuzzleKm(mounts.muzzles.starboard, cutter), cutter),
	).toBe(true);
	expect(beamClearsCutter(BOW, cutter)).toBe(false);
});

test("each Mining Laser's beam starts at its own slot's muzzle, never the bow", () => {
	const muzzles = [BOW, v3(-1, 2, 3), v3(1, 2, 3)];
	const nose = v3(0, 0, -1);
	const rays = miningBeamRays(
		[
			{ slot: "h2", muzzleIndex: 1 },
			{ slot: "h3", muzzleIndex: 2 },
		],
		muzzles,
		nose,
	);
	expect(rays.map((r) => r.origin)).toEqual([muzzles[1], muzzles[2]]);
	for (const r of rays) {
		expect(r.origin).not.toEqual(BOW);
		expect(r.aim).toEqual(nose);
	}
});
