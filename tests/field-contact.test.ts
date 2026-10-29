import { expect, test } from "bun:test";
import {
	fieldCentre,
	fieldCentreVelocity,
	fieldRocks,
	rockPose,
	systemFields,
} from "../src/asteroid-field";
import { fieldContactsAt } from "../src/field-contact";
import { projectScannerContacts } from "../src/cockpit";
import { targetDesignation, isDisplayContact } from "../src/display-contact";
import {
	DEFAULT_CRUISE,
	advanceCruise,
	chargeAfterTravel,
	closestApproachKm,
	exitVelocity,
} from "../src/cruise";
import {
	advanceWorldClock,
	bodyAccelerationBound,
	bodyVelocity,
	jumpWorldTo,
	makeSystem,
	makeWorldAtSystem,
	markShipPlaced,
	stationHostIdOf,
} from "../src/sim";
import { isRockTargetId } from "../src/rock-target";
import { arrivalPoint } from "../src/system";
import { MAX_DT } from "../src/units";
import { add, length, normalizeOr, scale, sub, v3 } from "../src/vec3";
import { gameMethods } from "./lib/game-methods";

function subjectAt(index: number) {
	const world = makeWorldAtSystem(47, index);
	return Object.assign(
		Object.create(
			gameMethods(
				[
					"selectable",
					"masses",
					"targetBody",
					"bodyFor",
					"targetVelocity",
					"velocityOf",
					"targetParentId",
					"stepCruise",
					"dropOut",
				],
				{
					fieldContactsAt,
					isRockTargetId,
					bodyVelocity,
					bodyAccelerationBound,
					isDisplayContact,
					stationHostIdOf,
					advanceCruise,
					advanceWorldClock,
					chargeAfterTravel,
					exitVelocity,
					markShipPlaced,
					scale,
					v3,
				},
			),
		),
		{
			world,
			contacts: [],
			selectableCache: null,
			massesCache: null,
			massesAt: NaN,
			targetId: null,
			cruiseParams: DEFAULT_CRUISE,
			chargeAu: 12,
			throttle: 1,
			regime: "cruise",
			detour: null,
			proximityFrameBodyId: null,
			legStartedAtS: 0,
			stepDetour: () => true,
			saveDirty: () => {},
			nose(this: any) {
				return normalizeOr(
					sub(this.targetBody().pos, this.world.ship.pos),
					v3(1, 0, 0),
				);
			},
		},
	);
}

// Cover both profiles and every rare placement present in one real galaxy.
const fixture = makeWorldAtSystem(47, 0);
const systems = fixture.galaxy.systems.filter(
	(record) => systemFields(record, makeSystem(record, 0).contents).length > 0,
);

test("each generated field is selectable at its current centre, never a body or mass", () => {
	expect(systems.length).toBeGreaterThan(0);
	for (const record of systems) {
		const g = subjectAt(record.index);
		const before = [...g.world.system.bodies];
		const plans = systemFields(record, g.world.system.contents);
		const selected = g.selectable();
		const contacts = selected.filter(
			(c: { kind: string }) => c.kind === "field",
		);
		expect(contacts.map((c: { id: string }) => c.id)).toEqual(
			plans.map((p) => p.id),
		);
		for (const time of [0, 12345.6]) {
			g.world.gameTime = time;
			// Selection membership is cached, but the same objects must move.
			expect(g.selectable()).toBe(selected);
			for (const plan of plans) {
				const c = contacts.find((c: { id: string }) => c.id === plan.id);
				expect(c.pos).toEqual(fieldCentre(plan, time));
				expect(c.velocity).toEqual(fieldCentreVelocity(plan, time));
				expect(c.radiusKm).toBe(0);
				expect(targetDesignation(c)).toBe("FIELD");
				g.targetId = c.id;
				expect(g.targetBody()).toBe(c);
				expect(g.targetVelocity()).toEqual(c.velocity);
				expect(g.targetParentId()).toBeNull();
				expect(g.masses().some((m: { id: string }) => m.id === c.id)).toBe(
					false,
				);
				expect(g.world.system.byId.has(c.id)).toBe(false);
			}
		}
		expect(g.world.system.bodies).toEqual(before);
	}
});

test("real cruise arrivals to both field profiles drop at 50 km outside every rock", () => {
	const covered = new Set<string>();
	const profiles = new Set<string>();
	for (const record of systems) {
		for (const plan of systemFields(record, makeSystem(record, 0).contents)) {
			if (covered.has(plan.kind)) continue;
			covered.add(plan.kind);
			profiles.add(plan.profile);
			const g = subjectAt(record.index);
			g.targetId = plan.id;
			// Off the orbital plane: no unrelated body can occlude this short leg.
			g.world.ship.pos = add(fieldCentre(plan, 0), v3(0, 0, 2000));
			for (let i = 0; i < 100 / MAX_DT && g.regime === "cruise"; i++)
				g.stepCruise(MAX_DT, null);
			expect(g.lastExit).toBe(`arrived at ${plan.id}`);
			expect(
				length(sub(g.world.ship.pos, fieldCentre(plan, g.world.gameTime))),
			).toBeCloseTo(50, 2);
			const rocks = fieldRocks(record, plan);
			expect(rocks.length).toBeGreaterThan(0);
			for (const rock of rocks)
				expect(
					length(
						sub(g.world.ship.pos, rockPose(plan, rock, g.world.gameTime).pos),
					),
				).toBeGreaterThan(rock.radiusKm);
		}
	}
	expect(covered.size).toBeGreaterThanOrEqual(2);
	expect([...profiles].sort()).toEqual(["charted", "rare"]);
});

test("the 50 km drop radius clears the whole field at every rock drift phase", () => {
	for (const record of systems) {
		for (const plan of systemFields(record, makeSystem(record, 0).contents)) {
			const extentKm = plan.profile === "charted" ? 26.5 : 18.9;
			expect(DEFAULT_CRUISE.dropRadiusKm).toBeGreaterThan(extentKm);
			for (const rock of fieldRocks(record, plan))
				expect(
					length(rock.anchor) + rock.driftKm + rock.radiusKm,
				).toBeLessThanOrEqual(extentKm);
		}
	}
});

test("cruise past a field toward another target crosses it without guarding or dropping there", () => {
	const g = subjectAt(systems[0].index);
	const field = g
		.selectable()
		.find((c: { kind: string }) => c.kind === "field");
	const start = add(field.pos, v3(0, 0, -1000));
	const target = { pos: add(field.pos, v3(0, 0, 1000)), radiusKm: 0 };
	// One fast tick crosses the whole field. The target is beyond it; adding
	// fields to the guard masses would stop this leg at the field instead.
	const step = advanceCruise({
		pos: start,
		nose: v3(0, 0, 1),
		throttle: 1,
		dt: MAX_DT,
		masses: g.masses(),
		target,
		targetParentId: null,
		params: {
			...DEFAULT_CRUISE,
			vMinKms: 20000,
			vMaxKms: 20000,
			vicinityKm: 0,
			dropSpeedKms: 20000,
		},
	});
	expect(step.exit).toBe("arrival");
	expect(
		closestApproachKm(
			start,
			v3(0, 0, 1),
			length(sub(step.pos, start)),
			field.pos,
		),
	).toBe(0);
	expect(length(sub(step.pos, target.pos))).toBeCloseTo(50, 4);
	expect(length(sub(step.pos, field.pos))).toBeGreaterThan(50);
});

test("the scanner reads the same field contacts at the current clock", () => {
	const g = subjectAt(systems[0].index);
	const prototype = gameMethods(["refreshScannerContacts"], {
		projectScannerContacts,
		fieldContactsAt,
	});
	g.refreshScannerContacts = prototype.refreshScannerContacts;
	g.scannerContactBuffer = [];
	g.orientation = { x: 0, y: 0, z: 0, w: 1 };
	g.world.gameTime = 23456;
	const field = fieldContactsAt(g.world.system, g.world.gameTime)[0];
	g.world.ship.pos = add(field.pos, v3(0, 0, 50));
	g.targetId = field.id;
	g.refreshScannerContacts();
	expect(
		g.scannerContactBuffer.some(
			(c: { id: string; selected: boolean }) => c.id === field.id && c.selected,
		),
	).toBe(true);
	expect(g.contacts).toHaveLength(0);
});

test("a jump replaces field contacts without changing the canonical arrival position", () => {
	const g = subjectAt(systems[0].index);
	const departed = g
		.selectable()
		.filter((c: { kind: string }) => c.kind === "field");
	const origin = g.world.system.record.pos;
	g.world.gameTime = 12345;
	const to = systems[1];
	jumpWorldTo(g.world, to);
	const arrival = { ...g.world.ship.pos };
	expect(arrival).toEqual(
		arrivalPoint(to, g.world.system.contents, origin, g.world.gameTime),
	);
	// rebuildSystem already invalidates the selection cache on a jump.
	g.selectableCache = null;
	const arrived = g
		.selectable()
		.filter((c: { kind: string }) => c.kind === "field");
	expect(arrived.length).toBeGreaterThan(0);
	expect(arrived.every((c: unknown) => !departed.includes(c))).toBe(true);
	expect(g.world.ship.pos).toEqual(arrival);
});
