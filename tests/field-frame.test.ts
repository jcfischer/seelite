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
import { add, length, sub } from "../src/vec3";

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

test("the field frame holds out to the field's ellipsoid, and a body beyond it keeps its own frame", () => {
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
	const body = { id: "planet-x", velocityAt: () => ({ x: 9, y: 9, z: 9 }) };
	const inside = localFrameAt({
		fields: [plan],
		shipPos: at(a * 0.9),
		gameTime: t,
		body,
	});
	expect(inside.kind).toBe("field");
	const outside = localFrameAt({
		fields: [plan],
		shipPos: at(a * 3),
		gameTime: t,
		body,
	});
	expect(outside.kind).toBe("body");
	const star = localFrameAt({
		fields: [plan],
		shipPos: at(a * 3),
		gameTime: t,
		body: null,
	});
	expect(star.kind).toBe("star");
});
