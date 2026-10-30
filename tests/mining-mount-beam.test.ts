import { expect, test } from "bun:test";
import mounts from "../spikes/longwall-miner/mounts/mounts.json";
import { HULL_SPECS } from "../src/hull";
import { beamClearsCutter } from "../src/mount-beam";
import { shipMuzzlesKm } from "../src/ship-mesh";

const cutter = HULL_SPECS.miner.cutter;
if (!cutter) throw new Error("the miner carries a cutter");
const muzzles = () => shipMuzzlesKm("miner", HULL_SPECS.miner.variant);
const metres = (m: { x: number; y: number; z: number }) =>
	[m.x, m.y, m.z].map((v) => Math.round(v * 1e5) / 100);

test("the shipped Longwall fires h1 from the bow and h2, h3 from the port and starboard mounts, in hardpoint order", () => {
	expect(muzzles().map(metres)).toEqual([
		[0, 0, -39.8],
		[-5.3, 5.81, -22.8],
		[5.3, 5.81, -22.8],
	]);
	expect(muzzles()).toHaveLength(HULL_SPECS.miner.hardpoints);
});

test("the mount muzzles are the approved study's, moved by the export's own offset alone", () => {
	const [, port, starboard] = muzzles();
	const offset = {
		x: port.x * 1000 + mounts.muzzles.port[0],
		y: port.y * 1000 - mounts.muzzles.port[1],
		z: port.z * 1000 + mounts.muzzles.port[2],
	};
	expect(offset.x).toBeCloseTo(0, 6);
	expect(starboard.x * 1000 + mounts.muzzles.starboard[0]).toBeCloseTo(0, 6);
	expect(starboard.y * 1000 - mounts.muzzles.starboard[1]).toBeCloseTo(
		offset.y,
		6,
	);
	expect(starboard.z * 1000 + mounts.muzzles.starboard[2]).toBeCloseTo(
		offset.z,
		6,
	);
});

test("a mount's beam clears the deployed cutter, and a beam from the bow does not (D-D11)", () => {
	const [bow, port, starboard] = muzzles();
	expect(beamClearsCutter(port, cutter)).toBe(true);
	expect(beamClearsCutter(starboard, cutter)).toBe(true);
	expect(beamClearsCutter(bow, cutter)).toBe(false);
});
