import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { interiorOfStation } from "../src/dock-session";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import {
	clearancePromotion,
	compareStationTurns,
	laneWinner,
	playerWinsLane,
	materializeTrafficContact,
	stationTrafficRoster,
	TRAFFIC_HULL_POOLS,
	TRAFFIC_ROLE,
	trafficScheduleAt,
} from "../src/station-traffic";
import { trafficBerths } from "../src/station-interior";
import { generateContents } from "../src/system";
import { enumerateCarriers, WORLD_GENERATOR_VERSION } from "../src/world-state";

const WORLD = 0x5ee11e;

const required = <T>(value: T | undefined, label: string): T => {
	if (value === undefined) throw new Error(`missing ${label}`);
	return value;
};

const stations = () => {
	const galaxy = generateGalaxy(WORLD, 0);
	return galaxy.systems.flatMap((record) =>
		generateContents(record).stations.map((station) => ({ record, station })),
	);
};

describe("station Traffic roster", () => {
	test("Traffic slots join the version-4 persistence Carrier namespace", () => {
		expect(WORLD_GENERATOR_VERSION).toBe(5);
		const generated = [...enumerateCarriers(WORLD, 0)];
		const traffic = generated.filter((carrier) =>
			carrier.localCarrierId.includes("/traffic-"),
		);
		expect(traffic.length).toBeGreaterThan(0);
		expect(new Set(generated.map((carrier) => carrier.key)).size).toBe(
			generated.length,
		);
	});

	test("one stable, fitting actor per Traffic berth with each role signature", () => {
		for (const { record, station } of stations().slice(0, 200)) {
			const interior = interiorOfStation(station);
			const roster = stationTrafficRoster(record.index, station);
			// Per berth Traffic may call home, which is the catalogue minus the
			// visitor berth (#277). `tests/visitor-berth.test.ts` owns the share
			// itself; this row only needs the roster to match whatever it is.
			expect(roster).toHaveLength(trafficBerths(interior).length);
			expect(new Set(roster.map((actor) => actor.key)).size).toBe(
				roster.length,
			);
			expect(
				roster.some(
					(actor) => actor.hullId === TRAFFIC_ROLE[station.type].signature,
				),
			).toBe(true);
			for (const actor of roster) {
				expect(TRAFFIC_HULL_POOLS[station.type]).toContain(actor.hullId);
				expect(
					interior.berths.some((berth) => {
						const env = HULL_SPECS[actor.hullId].env;
						return (
							env.lengthKm <= berth.clearLengthKm &&
							env.beamKm <= berth.clearBeamKm &&
							env.heightKm <= berth.clearHeightKm
						);
					}),
				).toBe(true);
				expect(actor.key).toBe(
					carrierKey(
						record.index,
						`${station.localCarrierId}/traffic-${String(actor.ordinal).padStart(2, "0")}`,
					),
				);
			}
		}
	});

	test("identity and schedule do not depend on collection order", () => {
		const { record, station } = required(
			stations().find((row) => row.station.type === "trade"),
			"trade station",
		);
		const a = stationTrafficRoster(record.index, station);
		const b = stationTrafficRoster(record.index, { ...station });
		expect(b).toEqual(a);
		for (const actor of [...a].reverse()) {
			expect(trafficScheduleAt(actor, 86_401.25)).toEqual(
				trafficScheduleAt(a[actor.ordinal], 86_401.25),
			);
		}
	});

	test("parked duty stays in-band and full occupancy exposes a departure within 60 s", () => {
		for (const { record, station } of stations().slice(0, 120)) {
			const roster = stationTrafficRoster(record.index, station);
			const band = TRAFFIC_ROLE[station.type].parkedDuty;
			for (const actor of roster) {
				expect(actor.schedule.parkedDuty).toBeGreaterThanOrEqual(band[0]);
				expect(actor.schedule.parkedDuty).toBeLessThanOrEqual(band[1]);
			}
			for (let t = 0; t < 7200; t += 5) {
				if (
					!roster.every(
						(actor) => trafficScheduleAt(actor, t).desired === "parked",
					)
				)
					continue;
				let wait = 0;
				while (
					wait <= 60 &&
					roster.every(
						(actor) => trafficScheduleAt(actor, t + wait).desired === "parked",
					)
				)
					wait += 0.5;
				expect(wait).toBeLessThanOrEqual(60.5);
			}
		}
	});
});

describe("shared station arbitration", () => {
	test("clearance promotes the oldest request a currently free berth fits", () => {
		const { record, station } = required(
			stations().find((row) => row.station.type === "trade"),
			"trade station",
		);
		const roster = stationTrafficRoster(record.index, station);
		const interior = interiorOfStation(station);
		// Every Traffic berth but the last, so exactly one berth this allocator
		// may reach is free. **Not `interior.berths.slice(0, -1)`**: that left
		// the *visitor* berth as the only free one, and since #277 Traffic's
		// allocator cannot reach it — the promotion would be null for a reason
		// that has nothing to do with what this row is about.
		const allowed = trafficBerths(interior);
		const occupied = new Set(allowed.slice(0, -1).map((berth) => berth.id));
		const promoted = clearancePromotion(
			[
				{
					participant: { kind: "carrier", key: roster[1].key },
					readyAt: 20,
					hull: HULL_SPECS.freighter.env,
				},
				{
					participant: { kind: "carrier", key: roster[0].key },
					readyAt: 10,
					hull: HULL_SPECS.courier.env,
				},
			],
			interior,
			occupied,
			100,
		);
		// The older compatible request wins, even when input order is reversed.
		expect(promoted?.participant).toEqual({
			kind: "carrier",
			key: roster[0].key,
		});
		expect(promoted?.berthId).toBe(allowed.at(-1)?.id);
	});

	test("lane uses oldest ready, CarrierKey, and launch-first only on an exact tie", () => {
		const arrival = carrierKey(7, "station-trade/traffic-01");
		const launch = carrierKey(7, "station-trade/traffic-02");
		expect(
			laneWinner([
				{
					participant: { kind: "carrier", key: arrival },
					readyAt: 10,
					kind: "arrival",
				},
				{
					participant: { kind: "carrier", key: launch },
					readyAt: 10,
					kind: "launch",
				},
			]),
		).toEqual({
			participant: { kind: "carrier", key: launch },
			readyAt: 10,
			kind: "launch",
		});
		expect(
			laneWinner([
				{
					participant: { kind: "carrier", key: launch },
					readyAt: 11,
					kind: "launch",
				},
				{
					participant: { kind: "carrier", key: arrival },
					readyAt: 10,
					kind: "arrival",
				},
			]),
		).toEqual({
			participant: { kind: "carrier", key: arrival },
			readyAt: 10,
			kind: "arrival",
		});
	});

	test("frame commitment orders an exact-tie launch before an arrival", () => {
		const arrival = carrierKey(7, "station-trade/traffic-00");
		const launch = carrierKey(7, "station-trade/traffic-99");
		const ordered = [
			{
				participant: { kind: "carrier" as const, key: arrival },
				readyAt: 10,
				kind: "arrival" as const,
			},
			{
				participant: { kind: "carrier" as const, key: launch },
				readyAt: 10,
				kind: "launch" as const,
			},
		].sort(compareStationTurns);
		expect(ordered.map((turn) => turn.kind)).toEqual(["launch", "arrival"]);
	});

	test("player lane arbitration includes an older queued Traffic launch", () => {
		const launch = carrierKey(7, "station-trade/traffic-02");
		expect(
			playerWinsLane(
				[
					{
						participant: { kind: "carrier", key: launch },
						readyAt: 9,
						kind: "launch",
					},
				],
				10,
				"launch",
			),
		).toBe(false);
		expect(playerWinsLane([], 10, "launch")).toBe(true);
	});
});

test("materialization is inclusive at 10,000 km and preserves contact identity", () => {
	const { record, station } = stations()[0];
	const actor = stationTrafficRoster(record.index, station)[0];
	const projection = {
		key: actor.key,
		pos: { x: 10_000, y: 0, z: 0 },
		vel: { x: 1, y: 2, z: 3 },
	};
	const atEdge = materializeTrafficContact(actor, projection, {
		x: 0,
		y: 0,
		z: 0,
	});
	expect(atEdge?.id).toBe(actor.key);
	expect(atEdge?.name).toBe(actor.callsign);
	expect(atEdge?.shipType).toBe(actor.hullId);
	expect(
		materializeTrafficContact(actor, projection, { x: -0.001, y: 0, z: 0 }),
	).toBeNull();
	expect(
		materializeTrafficContact(actor, projection, { x: 0, y: 0, z: 0 }),
	).toEqual(atEdge);
	expect(
		materializeTrafficContact(
			actor,
			projection,
			{ x: -1_999.999, y: 0, z: 0 },
			12_000,
		),
	).toEqual(atEdge);
	expect(
		materializeTrafficContact(
			actor,
			projection,
			{ x: -2_000.001, y: 0, z: 0 },
			12_000,
		),
	).toBeNull();
});
