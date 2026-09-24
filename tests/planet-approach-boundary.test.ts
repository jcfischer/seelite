import { expect, test } from "bun:test";
import { planetApproachEntryTime } from "../src/planet-approach-boundary";

test("a stationary ship inside the approach boundary is not stopped", () => {
	expect(
		planetApproachEntryTime({
			from: { x: 110, y: 0, z: 0 },
			velocity: { x: 3, y: 0, z: 0 },
			duration: 1,
			centre: { x: 0, y: 0, z: 0 },
			centreVelocity: { x: 3, y: 0, z: 0 },
			radiusKm: 100,
		}),
	).toBeNull();
});
