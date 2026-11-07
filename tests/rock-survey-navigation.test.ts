import { describe, expect, test } from "bun:test";
import { fieldCentre, fieldRocks, systemFields } from "../src/asteroid-field";
import { projectNavTargets } from "../src/cockpit";
import { type DepositRow, SURVEY_LIFETIME_H } from "../src/deposit-state";
import { generateGalaxy } from "../src/galaxy";
import { rockContents, surveyReading } from "../src/rock-survey";
import {
	isRockTargetId,
	nearRocks,
	resolveRock,
	ROCK_DROP_KM,
	rockContact,
	type RockRef,
} from "../src/rock-target";
import { generateContents } from "../src/system";
import { add, v3 } from "../src/vec3";
import { gameMethods } from "./lib/game-methods";

const record = generateGalaxy(0x5ee11e, 0).systems[173];
const plan = systemFields(record, generateContents(record))[0];
const rocks = fieldRocks(record, plan);
const otherPlan = { ...plan, id: "field-01", slot: 1 };
const fields = [
	{ plan, rocks },
	{ plan: otherPlan, rocks },
];
const now = 100_000;
const centre = fieldCentre(plan, now);
const shipPos = [30, 35, 40]
	.map((offset) => add(centre, v3(offset, 0, 0)))
	.find((pos) => {
		const refs = nearRocks([fields[0]], pos, now, Infinity);
		return (
			refs.filter((ref) => ref.distKm <= ROCK_DROP_KM).length >= 5 &&
			refs.some((ref) => ref.distKm > ROCK_DROP_KM)
		);
	});
if (!shipPos) throw new Error("No near/far survey Navigation fixture");
const current = nearRocks([fields[0]], shipPos, now, Infinity);
const near = current.filter((ref) => ref.distKm <= ROCK_DROP_KM);
const far = current.find((ref) => ref.distKm > ROCK_DROP_KM)!;

function subject(mining = true) {
	const rows = new Map<string, DepositRow>();
	const ordinary = [
		{
			id: "station",
			name: "Home",
			kind: "station",
			stationType: "refinery",
			pos: add(shipPos!, v3(100, 0, 0)),
		},
	];
	const presses: boolean[] = [];
	const g = Object.assign(
		Object.create(
			gameMethods(
				[
					"navigationTargets",
					"selectNavigationTarget",
					"navRows",
					"surveyDesignation",
				],
				{
					MINING_ON: mining,
					nearRocks,
					rockContact,
					isRockTargetId,
					ROCK_DROP_KM,
					surveyReading,
					SURVEY_LIFETIME_H,
					SURVEY_GRADE_SHORT: {
						poor: "POOR",
						standard: "STD",
						rich: "RICH",
					},
					projectNavTargets,
					ETA_INTERVAL_S: 1,
				},
			),
		),
		{
			world: { ship: { pos: shipPos }, gameTime: now },
			frameField: plan,
			headLook: "left",
			leftTab: "Navigation",
			targetId: near[4].id,
			navFilter: { kinds: [], query: "" },
			navOrder: [],
			navEtaAt: now,
			navEtaCache: new Map(),
			selectable: () => ordinary,
			fieldRockSets: () => fields,
			rockRef: (id: string) => {
				const ref = resolveRock(fields, id, shipPos!, now);
				return ref && ref.distKm <= ROCK_DROP_KM ? ref : null;
			},
			rockContentsOf: (ref: RockRef) =>
				rockContents(record.seed, ref.plan.slot, ref.plan.profile, ref.rock),
			rockDepositRow: (ref: RockRef) => rows.get(ref.id),
			surveyFiguresFitted: () => null,
			surveyHold: { key: null, chargeS: 0 },
			surveyBlock: () => "NO MINING LASER",
			bodyFor: () => null,
			timeToBody: () => null,
			consolePress: (accepted: boolean) => presses.push(accepted),
			updateCockpit() {},
		},
	);
	return { g, rows, ordinary, presses };
}

describe("surveyed rocks in Navigation (node #1148)", () => {
	test("does not generate contents for unsurveyed unselected rocks", () => {
		const { g } = subject();
		const contentsOf = g.rockContentsOf;
		g.rockContentsOf = (ref: RockRef) => {
			if (ref.id !== g.targetId)
				throw new Error("unsurveyed rock contents should not be generated");
			return contentsOf(ref);
		};
		expect(
			g.navigationTargets().filter((row: any) => row.kind === "rock"),
		).toHaveLength(1);
	});

	test("only current-field readings and the selected rock appear, nearest first", () => {
		const { g, rows } = subject();
		rows.set(near[0].id, { surveyedAt: now });
		rows.set(near[1].id, { surveyedAt: now });
		rows.set(near[2].id, { surveyedAt: now - SURVEY_LIFETIME_H * 3600 });
		rows.set(`rock:${otherPlan.id}:${near[3].rock.slot}`, { surveyedAt: now });
		const listed = g.navRows().filter((row: any) => row.kind === "rock");
		expect(listed.map((row: any) => row.id)).toEqual([
			near[0].id,
			near[1].id,
			near[4].id,
		]);
		expect(listed[2].selected).toBe(true);
		expect(listed[0].detail).toContain(" T");
		expect(listed[0].distanceKm).toBe(near[0].distKm);
		g.navOrder = [near[4].id, near[1].id, near[0].id];
		expect(near[1].distKm - near[0].distKm).toBeLessThan(2);
		expect(
			g
				.navRows()
				.filter((row: any) => row.kind === "rock")
				.map((row: any) => row.id),
		).toEqual([near[0].id, near[1].id, near[4].id]);
	});

	test("expired readings disappear unless that valid rock is selected", () => {
		const { g, rows } = subject();
		for (const ref of [near[0], near[4]])
			rows.set(ref.id, { surveyedAt: now - SURVEY_LIFETIME_H * 3600 });
		const listed = g.navRows().filter((row: any) => row.kind === "rock");
		expect(listed.map((row: any) => row.id)).toEqual([near[4].id]);
		expect(listed[0].selected).toBe(true);
		expect(listed[0].detail).toBe("ROCK · NO MINING LASER");
	});

	test("known far rocks remain readable and cannot change the target", () => {
		const { g, rows, presses } = subject();
		rows.set(far.id, { surveyedAt: now });
		const row = g.navRows().find((item: any) => item.id === far.id);
		expect(row).toBeDefined();
		expect(row.distanceKm).toBe(far.distKm);
		expect(row.detail).toContain(" T");
		expect(row.disabledReason).toContain("40");
		const selected = g.targetId;
		expect(g.selectNavigationTarget(far.id)).toBe(false);
		expect(g.targetId).toBe(selected);
		expect(presses).toEqual([false]);
		rows.set(near[0].id, { surveyedAt: now });
		expect(g.selectNavigationTarget(near[0].id)).toBe(true);
		expect(g.targetId).toBe(near[0].id);
		expect(presses).toEqual([false, true]);
	});

	test("without a current field only the valid selected rock remains", () => {
		const { g, rows } = subject();
		g.frameField = null;
		rows.set(near[0].id, { surveyedAt: now });
		expect(
			g
				.navRows()
				.filter((row: any) => row.kind === "rock")
				.map((row: any) => row.id),
		).toEqual([near[4].id]);
	});

	test("flag-off Navigation retains the ordinary projection and does not read rock state", () => {
		const { g, ordinary } = subject(false);
		g.fieldRockSets = () => {
			throw new Error("Flag-off rock lookup");
		};
		expect(g.navigationTargets()).toBe(ordinary);
		expect(g.navRows()).toEqual(
			projectNavTargets(shipPos!, ordinary, g.targetId),
		);
		expect(g.selectNavigationTarget(near[0].id)).toBe(false);
	});
});

test("Navigation projection preserves owned range, reading and refusal without changing ordinary rows", () => {
	const ordinary = {
		id: "station",
		name: "Home",
		kind: "station",
		pos: v3(3, 0, 0),
	};
	const rock = {
		id: "rock:field-00:7",
		name: "Rock 7",
		kind: "rock",
		pos: v3(100, 0, 0),
		distanceKm: 2,
		detail: "GOLD RICH · 12 T",
		disabledReason: "OUT OF RANGE · 40 KM LIMIT",
	};
	const rows = projectNavTargets(v3(), [ordinary, rock], null);
	expect(rows[0]).toMatchObject({
		id: rock.id,
		distanceKm: 2,
		detail: rock.detail,
		disabledReason: rock.disabledReason,
	});
	expect(rows[1]).toEqual(projectNavTargets(v3(), [ordinary], null)[0]);
	expect(
		projectNavTargets(v3(), [rock], null, {
			filter: { kinds: [], query: "gold" },
		}),
	).toHaveLength(1);
	expect(
		projectNavTargets(v3(), [{ ...rock, distanceKm: 0 }], null)[0].distanceKm,
	).toBe(0);
});
