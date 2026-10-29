import { expect, test } from "bun:test";
import {
	type FieldPlan,
	FIELD_PROFILE,
	fieldCentre,
	fieldCentreVelocity,
	rotateByQuat,
	systemFields,
} from "../src/asteroid-field";
import { localFrameAt } from "../src/field-frame";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import { NEAR_FAR_KM } from "../src/units";
import { add, length, sub, v3 } from "../src/vec3";

const rareField = (): FieldPlan => {
	for (const record of generateGalaxy(0x5ee11e, 0).systems) {
		const rare = systemFields(record, generateContents(record)).find(
			(p) => p.profile === "rare",
		);
		if (rare) return rare;
	}
	throw new Error("no rare field in galaxy 0");
};

test("inside a rare field with no body near, the local frame is the field's centre motion, not the star's (#920 flight)", () => {
	const plan = rareField();
	const t = 1234;
	const frame = localFrameAt({
		fields: [plan],
		shipPos: fieldCentre(plan, t),
		gameTime: t,
		body: null,
	});
	expect(frame.kind).toBe("field");
	const want = fieldCentreVelocity(plan, t);
	expect(length(sub(frame.velocityAt(t), want))).toBeLessThan(1e-12);
	expect(length(want)).toBeGreaterThan(1);
});

test("a ship at the cruise arrival point, 50 km outside the field, is in the field frame", () => {
	const plan = rareField();
	const t = 50;
	const [a] = FIELD_PROFILE.rare.semiKm;
	const along = rotateByQuat(plan.rotation, { x: 1, y: 0, z: 0 });
	const at = (km: number) =>
		add(fieldCentre(plan, t), {
			x: along.x * km,
			y: along.y * km,
			z: along.z * km,
		});
	const arrival = localFrameAt({
		fields: [plan],
		shipPos: at(a + 50),
		gameTime: t,
		body: null,
	});
	expect(arrival.kind).toBe("field");
	expect(arrival.id).toBe(plan.id);
});

test("the field frame holds within NEAR_FAR_KM of the field's centre, like a body's, and the nearer wins (#1139)", () => {
	const plan = rareField();
	const t = 50;
	const along = rotateByQuat(plan.rotation, { x: 1, y: 0, z: 0 });
	const at = (km: number) =>
		add(fieldCentre(plan, t), {
			x: along.x * km,
			y: along.y * km,
			z: along.z * km,
		});
	const frame = (km: number, body: { distKm: number } | null) =>
		localFrameAt({
			fields: [plan],
			shipPos: at(km),
			gameTime: t,
			body: body && {
				id: "planet-x",
				distKm: body.distKm,
				velocityAt: () => v3(9, 9, 9),
			},
		}).kind;
	expect(frame(NEAR_FAR_KM * 0.99, null)).toBe("field");
	expect(frame(NEAR_FAR_KM * 1.01, null)).toBe("star");
	expect(frame(1000, { distKm: 5000 })).toBe("field");
	expect(frame(1000, { distKm: 500 })).toBe("body");
});
