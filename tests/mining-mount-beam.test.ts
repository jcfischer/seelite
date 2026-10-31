import { expect, test } from "bun:test";
import mounts from "../spikes/longwall-miner/mounts/mounts.json";
import { HULL_SPECS } from "../src/hull";
import { beamClearsCutter } from "../src/mount-beam";
import { shipMuzzlesKm } from "../src/ship-mesh";

import { miningBeamRays } from "../src/laser-modules";
import { makeModule, moduleRow } from "../src/loadout";
import {
	beamHit,
	firedExtraction,
	firstHitExtraction,
} from "../src/rock-extraction";
import { v3 } from "../src/vec3";

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

const lasers = [1, 2].map((muzzleIndex) => ({
	muzzleIndex,
	grade: "E" as const,
	extractionTPerS: moduleRow(makeModule("mining-laser", 3)).output
		.extractionTPerS,
}));
const nose = v3(0, 0, -1);

test("each fired Mining Laser ray starts at its slot muzzle, never the bow, along the nose", () => {
	const rays = miningBeamRays(lasers, muzzles(), nose);
	expect(rays.map((r) => r.origin)).toEqual(muzzles().slice(1));
	for (const ray of rays) {
		expect(ray.origin).not.toEqual(muzzles()[0]);
		expect(ray.aim).toEqual(nose);
	}
	expect(
		miningBeamRays([lasers[1]], muzzles(), nose).map((r) => r.origin),
	).toEqual([muzzles()[2]]);
});

test("only rays meeting the same rock sum their fitted rate: two 3E give provisional 0.45 t/s", () => {
	const rocks = [{ id: "same", pos: v3(0, 0, -1), vel: v3(), radiusKm: 0.1 }];
	const rays = miningBeamRays(lasers, muzzles(), nose).map((ray) => ({
		...ray,
		met: beamHit(ray.origin, ray.aim, rocks, 10),
	}));
	expect(rays.map((r) => r.met?.id)).toEqual(["same", "same"]);
	expect(
		firedExtraction(rays.filter((r) => r.met?.id === "same")).rate,
	).toBeCloseTo(0.45, 12);
	const separate = [
		{ id: "port", pos: v3(-0.0053, 0.00581, -1), vel: v3(), radiusKm: 0.002 },
		{
			id: "starboard",
			pos: v3(0.0053, 0.00581, -1),
			vel: v3(),
			radiusKm: 0.002,
		},
	];
	const split = miningBeamRays(lasers, muzzles(), nose).map((ray) => ({
		...ray,
		met: beamHit(ray.origin, ray.aim, separate, 10),
	}));
	expect(split.map((r) => r.met?.id)).toEqual(["port", "starboard"]);
	expect(
		firedExtraction(split.filter((r) => r.met?.id === "port")).rate,
	).toBeCloseTo(0.225, 12);
	expect(firedExtraction(split.filter((r) => r.met?.id === "miss")).rate).toBe(
		0,
	);
});

test("the first hitting mount chooses the cut rock even when another mount hits a nearer rock", () => {
	const rocks = [
		{ id: "port", pos: v3(-0.0053, 0.00581, -1), vel: v3(), radiusKm: 0.002 },
		{
			id: "starboard",
			pos: v3(0.0053, 0.00581, -0.5),
			vel: v3(),
			radiusKm: 0.002,
		},
	];
	const rays = miningBeamRays(lasers, muzzles(), nose).map((ray) => ({
		...ray,
		met: beamHit(ray.origin, ray.aim, rocks, 10),
	}));
	expect(firstHitExtraction(rays).hit?.id).toBe("port");
	expect(firstHitExtraction([...rays].reverse()).hit?.id).toBe("starboard");
	expect(firstHitExtraction(rays).cutting.rate).toBeCloseTo(0.225, 12);
	const miss = { ...rays[0], met: null };
	expect(firstHitExtraction([miss, rays[1]]).hit?.id).toBe("starboard");
	expect(firstHitExtraction([miss]).hit).toBeNull();
	expect(firstHitExtraction([miss]).cutting.rate).toBe(0);
	expect(firstHitExtraction([]).hit).toBeNull();
	expect(
		firstHitExtraction(rays.map((r) => ({ ...r, met: rays[0].met }))).cutting
			.rate,
	).toBeCloseTo(0.45, 12);
});
