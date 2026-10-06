import { expect, test } from "bun:test";
import type { HullId } from "../src/hull";
import type { FleetShip, HullControl } from "../src/sim";
import type { Vec3 } from "../src/vec3";
import { hullBox, shipPose, pairSeparation } from "../src/collision.ts";
import { HULL_SPECS } from "../src/hull.ts";
import {
	makeWorld,
	stepWorld,
	flightPerformance,
	speedDemand,
	PLAYER_SHIP_ID,
} from "../src/sim.ts";
import { v3, add, sub, scale } from "../src/vec3.ts";
const dt = 0.1,
	nose = v3(0, 0, -1),
	up = v3(0, 1, 0),
	dir = v3(0, 0, 1);
const box = (h: HullId) => [
	hullBox(HULL_SPECS[h].env, HULL_SPECS[h].envCentre),
];
const motion = (h: HullId, pos: Vec3, vel: Vec3) => ({
	massT: HULL_SPECS[h].massT,
	primitives: box(h),
	start: shipPose(pos, nose, up),
	end: shipPose(add(pos, scale(vel, dt)), nose, up),
	velStart: vel,
	velEnd: vel,
});
const ahead = (h: HullId, otherHull: HullId, otherPos: Vec3, gapKm: number) => {
	const probe = add(otherPos, scale(dir, 0.2));
	const gap = pairSeparation(
		box(h)[0],
		shipPose(probe, nose, up),
		box(otherHull)[0],
		shipPose(otherPos, nose, up),
	);
	if (gap.overlap || !Number.isFinite(gap.distanceKm))
		throw new Error("invalid probe gap");
	return sub(probe, scale(dir, gap.distanceKm - gapKm));
};
for (const thirdGap of [null, 0.0003, 0.0001, -0.005])
	for (const reverse of [false, true])
		test(`a player ram resolves new fleet eligibility (thirdGap=${thirdGap}, reverse=${reverse})`, () => {
			const world = makeWorld(47);
			world.ship.pos = add(world.ship.pos, v3(50, 50, 50));
			world.ship.vel = v3(0, 0, 0.1);
			const a = ahead("freighter", "courier", world.ship.pos, 0.001),
				b = ahead("freighter", "freighter", a, 0.001);
			const fleet: FleetShip[] = [
				{ id: "a", projected: true, motion: motion("freighter", a, v3()) },
				{ id: "b", projected: true, motion: motion("freighter", b, v3()) },
			];
			const c =
				thirdGap === null ? null : ahead("freighter", "freighter", b, thirdGap);
			if (c) {
				const initial = pairSeparation(
					box("freighter")[0],
					shipPose(b, nose, up),
					box("freighter")[0],
					shipPose(c, nose, up),
				);
				expect(initial.overlap).toBe(thirdGap! < 0);
				if (!initial.overlap)
					expect(initial.distanceKm).toBeCloseTo(thirdGap!, 6);
			}
			if (c)
				fleet.push({
					id: "c",
					projected: true,
					motion: motion("freighter", c, v3()),
				});
			const control: HullControl = {
				stick: { pitch: 0, yaw: 0, roll: 0 },
				turnAssist: true,
				translation: { demand: speedDemand(0), assist: false },
			};
			const attitude = () => ({
				nose,
				up,
				rates: { pitch: 0, yaw: 0, roll: 0 },
			});
			if (reverse) fleet.reverse();
			const first = stepWorld(
				world,
				attitude(),
				control,
				dt,
				flightPerformance("courier"),
				box("courier"),
				[],
				fleet,
			);
			const fa = first.fleet.find((s) => s.id === "a")!;
			const fb = first.fleet.find((s) => s.id === "b")!;
			const gap = pairSeparation(
				box("freighter")[0],
				shipPose(fa.pos, nose, up),
				box("freighter")[0],
				shipPose(fb.pos, nose, up),
			);
			if (
				!fa.impacts.some((i) => i.with === PLAYER_SHIP_ID) ||
				first.impacts.length ||
				first.ghosts.length
			)
				throw new Error("fixture did not produce an isolated player ram");
			expect(first.impacts).toEqual([]);
			expect(first.ghosts).toEqual([]);
			expect(
				fa.impacts.find((i) => i.with === PLAYER_SHIP_ID)!.damage,
			).toBeGreaterThan(0);
			expect(gap.overlap).toBe(false);
			expect(fb.impacts.filter((i) => i.with === "a")).toHaveLength(1);
			expect(fa.impacts.filter((i) => i.with === "b")).toHaveLength(1);
			if (c) {
				const fc = first.fleet.find((s) => s.id === "c")!;
				const swept = thirdGap === 0.0003;
				expect(fc.impacts.filter((i) => i.with === "b")).toHaveLength(
					swept ? 1 : 0,
				);
				expect(fb.impacts.filter((i) => i.with === "c")).toHaveLength(
					swept ? 1 : 0,
				);
				if (!swept) expect(fc.pos).toEqual(c);
				expect(
					pairSeparation(
						box("freighter")[0],
						shipPose(fb.pos, nose, up),
						box("freighter")[0],
						shipPose(fc.pos, nose, up),
					).overlap,
				).toBe(thirdGap! < 0);
			}
		});
