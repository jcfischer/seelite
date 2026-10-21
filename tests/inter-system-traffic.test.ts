import { describe, expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { generateContents, arrivalPoint, placeBodies } from "../src/system";
import { stationTrafficRoster } from "../src/station-traffic";
import { AU_KM } from "../src/units";
import { length, sub, dot } from "../src/vec3";
import type { Vec3 } from "../src/vec3";
import {
	buildHaulerPlans,
	inboundHaulers,
	haulerVoyage,
	arrivalRadiusBoundAu,
	HAULER_SLACK_S,
	LANE_POINT_ANNULUS_KM,
	lanePoint,
} from "../src/inter-system-traffic";
import {
	projectSystemTrafficActor,
	projectSystemTrafficAuthority,
} from "../src/station-route";
import { routeVoyages } from "../src/inter-system-traffic";
import { trafficIdentityRecord } from "../src/inter-system-traffic";
import { carrierName } from "../src/carrier-name";
import { carrierManifest } from "../src/carrier-manifest";
import { carrierStanding } from "../src/carrier-standing";
import {
	newWorld,
	parseWorld,
	canonicalSnapshot,
	WORLD_GENERATOR_VERSION,
	haulerAvailability,
} from "../src/world-state";
import { nextTrafficDepartureAtS } from "../src/station-traffic";
import { readFileSync } from "node:fs";
import { runTrafficControl } from "./inter-system-traffic-mutations";
import { JUMP_CHARGE_S } from "../src/hyperspace";
import { WITCHSPACE } from "../src/witchspace";
import {
	CROSSING,
	npcRiftStrength,
	npcRiftVisible,
} from "../src/witchspace-crossing";

const galaxy = generateGalaxy(47, 0);
const contents = new Map(
	galaxy.systems.map((r) => [r.index, generateContents(r)]),
);
const getContents = (index: number) => contents.get(index)!;
const home = galaxy.systems.find((r) =>
	buildHaulerPlans(galaxy, r.index, getContents).some(
		(p) => p.vocation === "hauler",
	),
)!;
const plans = () => buildHaulerPlans(galaxy, home.index, getContents);
const hauler = () => plans().find((p) => p.vocation === "hauler")!;

test("jump arrival charge comes from the static departure bound without foreign flight replay", () => {
	const p = hauler(),
		v = haulerVoyage(p, 0);
	const outbound = routeVoyages(
		galaxy,
		p,
		v.destinationSystemIndex,
		v.tOut,
		getContents,
	)[0];
	expect(outbound.arrival.chargeAu).toBe(
		HULL_SPECS[p.actor.hullId].chargeAu - p.homeBounds.distanceAu,
	);
	const destination = p.eligible.find(
		(d) =>
			d.systemIndex === v.destinationSystemIndex &&
			d.stationId === v.destinationStationId,
	)!;
	const returning = routeVoyages(
		galaxy,
		p,
		home.index,
		v.tBack,
		getContents,
	).find((r) => r.awayOrdinal === 0)!;
	expect(returning.arrival.chargeAu).toBe(
		HULL_SPECS[p.actor.hullId].chargeAu - destination.bounds.distanceAu,
	);
	// A value import of the route projector could put an unbudgeted foreign
	// replay back on the frame path even if the returned budget stayed correct.
	expect(
		readFileSync(
			new URL("../src/inter-system-traffic.ts", import.meta.url),
			"utf8",
		),
	).not.toMatch(
		/import\s*{(?!\s*type\b)[^}]*}\s*from ["']\.\/station-route["']/s,
	);
});

describe("inter-system Traffic static contract", () => {
	test("vocation and destinations ignore collection order; signature and empty sets are local", () => {
		expect(plans()).toEqual(
			buildHaulerPlans(
				{ ...galaxy, systems: [...galaxy.systems].reverse() },
				home.index,
				getContents,
			),
		);
		expect(
			plans()
				.filter((p) => p.actor.ordinal === 0)
				.every((p) => p.vocation === "local"),
		).toBe(true);
		expect(
			buildHaulerPlans(
				{ ...galaxy, systems: [home] },
				home.index,
				getContents,
			).every((p) => p.vocation === "local"),
		).toBe(true);
	});
	test("cycle is the smallest grid multiple fitting both bounds, with the original phase", () => {
		for (const p of plans().filter((p) => p.vocation === "hauler")) {
			const station = getContents(home.index).stations.find(
				(s) => s.id === p.actor.homeStationId,
			)!;
			const base = stationTrafficRoster(home.index, station)[p.actor.ordinal]
				.schedule;
			expect(p.actor.schedule.departureAtS).toBe(base.departureAtS);
			expect(p.actor.schedule.cycleS).toBe(p.cycleMultiple * base.cycleS);
			const awayNeed =
				p.homeBounds.nominalOutS +
				HAULER_SLACK_S +
				Math.max(...p.eligible.map((d) => d.bounds.nominalInS)) +
				30;
			const parkedNeed =
				Math.max(...p.eligible.map((d) => d.bounds.nominalOutS)) +
				HAULER_SLACK_S +
				p.homeBounds.nominalInS +
				30;
			expect(p.actor.schedule.awayS).toBeGreaterThanOrEqual(awayNeed);
			expect(p.actor.schedule.cycleS * base.parkedDuty).toBeGreaterThanOrEqual(
				parkedNeed,
			);
			expect(
				(p.cycleMultiple - 1) * base.cycleS * (1 - base.parkedDuty) <
					awayNeed ||
					(p.cycleMultiple - 1) * base.cycleS * base.parkedDuty < parkedNeed,
			).toBe(true);
			expect(
				p.eligible.every(
					(d) =>
						p.homeBounds.distanceAu + d.bounds.distanceAu <=
						HULL_SPECS[p.actor.hullId].chargeAu,
				),
			).toBe(true);
		}
	});
	test("arrival radius bound holds over seeds and clocks; lane offset is perpendicular and in annulus", () => {
		for (const seed of [1, 47, 1234])
			for (const r of generateGalaxy(seed, 0).systems.slice(0, 30)) {
				const c = generateContents(r);
				for (const t of [0, 86400, 365 * 86400])
					for (const origin of [home.pos, { x: 0, y: 0, z: 0 }]) {
						expect(
							length(arrivalPoint(r, c, origin, t)) / AU_KM,
						).toBeLessThanOrEqual(arrivalRadiusBoundAu(c) + 1e-10);
						expect(
							placeBodies(c, t).every((b) => Number.isFinite(length(b.pos))),
						).toBe(true);
					}
			}
		const p = hauler(),
			v = haulerVoyage(p, 0),
			d = galaxy.systems.find((r) => r.index === v.destinationSystemIndex)!;
		const point = lanePoint(
			home,
			getContents(home.index),
			d.pos,
			v.tOut,
			p.actor.key,
			0,
		);
		const exact = arrivalPoint(home, getContents(home.index), d.pos, v.tOut);
		const offset = sub(point.pos, exact);
		expect(length(offset)).toBeGreaterThanOrEqual(
			LANE_POINT_ANNULUS_KM[0] - 1e-7,
		);
		expect(length(offset)).toBeLessThanOrEqual(LANE_POINT_ANNULUS_KM[1] + 1e-7);
		expect(Math.abs(dot(offset, sub(d.pos, home.pos)))).toBeLessThan(1e-5);
	});
	test("inbound derives schedule alone and rejects destroyed and repairing home rows", () => {
		const p = hauler(),
			v = haulerVoyage(p, 0),
			at = v.tOut + 0.1;
		const query = () =>
			inboundHaulers(
				galaxy,
				v.destinationSystemIndex,
				at,
				getContents,
				() => "operational",
			);
		expect(query().some((x) => x.actor.key === p.actor.key)).toBe(true);
		expect(query()).toEqual(query());
		for (const condition of ["destroyed", "repairing"] as const)
			expect(
				inboundHaulers(
					galaxy,
					v.destinationSystemIndex,
					at,
					getContents,
					(key) => (key === p.actor.key ? condition : "operational"),
				).some((x) => x.actor.key === p.actor.key),
			).toBe(false);
	});
});

describe("hauler physical legs", () => {
	test("early holds then jumps on anchor; actual contention delays only the observed side", () => {
		const p = hauler(),
			v = haulerVoyage(p, 0);
		const route = (t: number, timeline: any[] = []) =>
			projectSystemTrafficActor({
				record: home,
				actor: p.actor,
				gameTime: t,
				playerTimeline: timeline,
				haulerVoyages: routeVoyages(galaxy, p, home.index, t, getContents),
			});
		expect(route(v.tOut - 3.1).phase).toBe("lane-point-hold");
		expect(route(v.tOut - 0.1).phase).toBe("jump-windup");
		expect(route(v.tOut).phase).toBe("hyperspace-away");
		const contention = [
			{
				stationId: p.actor.homeStationId,
				kind: "lane",
				fromS: v.awayBoundaryS,
				toS: v.tOut + 30,
				participant: { kind: "player" },
				movement: "launch",
				committed: true,
			},
		];
		expect(route(v.tOut, contention).phase).toBe("launch-queued");
		expect(
			inboundHaulers(
				galaxy,
				v.destinationSystemIndex,
				v.tOut,
				getContents,
				() => "operational",
			).some((x) => x.actor.key === p.actor.key),
		).toBe(true);
		const late = route(v.tOut + 800, contention);
		expect(late.phase).toBe("hyperspace-away");
		expect(late.jump?.atS).toBeGreaterThan(v.tOut);
	});
	test("direct and cached canonical projections agree across both jumps", () => {
		const p = hauler(),
			v = haulerVoyage(p, 0);
		for (const [index, at] of [
			[home.index, v.tBack],
			[v.destinationSystemIndex, v.tOut],
		]) {
			const record = galaxy.systems.find((r) => r.index === index)!;
			const cache = new Map();
			const arrivals = new Map();
			for (const t of [at, at + 0.1, at + 1, at + 10, at + 100]) {
				const input = {
					record,
					actor: p.actor,
					gameTime: t,
					haulerVoyages: routeVoyages(galaxy, p, index, t, getContents),
				};
				const cached = projectSystemTrafficAuthority({
						...input,
						cruiseCache: cache,
						lanePointArrivalCache: arrivals,
					}),
					direct = projectSystemTrafficActor(input);
				expect(cached.phase).toBe(direct.phase);
				expect(length(sub(cached.pos, direct.pos))).toBeLessThan(1e-5);
				expect(cached.chargeAu).toBeCloseTo(direct.chargeAu, 9);
				expect(cached.workTicks).toBe(direct.workTicks);
			}
			// One held start per arrival leg, reused by every later tick of it.
			expect(arrivals.size).toBe(1);
		}
	});
	test("a hauler in another system says so instead of standing at the origin", () => {
		const p = hauler(),
			v = haulerVoyage(p, 0);
		const destination = galaxy.systems.find(
			(r) => r.index === v.destinationSystemIndex,
		)!;
		const at = (record: typeof home, t: number) =>
			projectSystemTrafficActor({
				record,
				actor: p.actor,
				gameTime: t,
				haulerVoyages: routeVoyages(galaxy, p, record.index, t, getContents),
			});
		const notYetArrived = at(destination, v.tOut - 1);
		expect(notYetArrived.phase).toBe("hyperspace-away");
		expect(notYetArrived.present).toBe(false);
		expect(at(destination, v.tOut + 1).present).toBeUndefined();
		expect(at(home, v.awayBoundaryS - 1).present).toBeUndefined();
	});
	test("the crossing never moves a hauler further in one 10 Hz tick than probe-traffic-continuity allows", () => {
		// #1006: a departure ends a crossing ahead of its lane point, and the
		// absent pose that followed stood on the point — a 0.084 km step at the
		// instant, and the same step back when the return came through.
		const p = hauler(),
			v = haulerVoyage(p, 0);
		const route = (t: number) =>
			projectSystemTrafficActor({
				record: home,
				actor: p.actor,
				gameTime: t,
				haulerVoyages: routeVoyages(galaxy, p, home.index, t, getContents),
			});
		const speed = (u: Vec3) => length(u);
		const steps: { t: number; from: string; to: string; km: number }[] = [];
		let prior = route(v.tOut - 5);
		for (const [fromS, toS] of [
			[v.tOut - 5, v.tOut + 2],
			[v.tBack - 2, v.tBack + 6],
		])
			for (let tick = Math.round(fromS * 10); tick <= toS * 10; tick++) {
				const now = route(tick / 10);
				const km = length(sub(now.pos, prior.pos));
				const allowed = Math.max(
					0.05,
					(speed(prior.vel) + speed(now.vel)) * 0.1,
				);
				if (km > allowed)
					steps.push({ t: tick / 10, from: prior.phase, to: now.phase, km });
				prior = now;
			}
		expect(steps).toEqual([]);
	});
});

describe("identity persistence and query cost", () => {
	test("home identity reads one seed, government and voyage at either end", () => {
		const p = hauler(),
			v = haulerVoyage(p, 0);
		const reading = (current: number) => {
			const r = trafficIdentityRecord(
				galaxy,
				p.actor.key,
				galaxy.systems.find((r) => r.index === current),
			);
			expect(r.index).toBe(home.index);
			expect(galaxy.systems.some((r) => r.index === current)).toBe(true);
			return {
				name: carrierName(r.seed, p.actor.key, 0),
				manifest: carrierManifest(r.seed, p.actor.key, 0, 0, {
					holdT: HULL_SPECS[p.actor.hullId].holdT,
					government: r.government,
				}),
				standing: carrierStanding(r.seed, p.actor.key, 0, v.tOut),
			};
		};
		expect(reading(home.index)).toEqual(reading(v.destinationSystemIndex));
		const main = readFileSync(
			new URL("../src/main.ts", import.meta.url),
			"utf8",
		);
		for (const name of [
			"trafficManifest",
			"recordedReading",
			"recordedStanding",
			"drawnName",
		]) {
			const start = main.indexOf(`private ${name}(`),
				end = main.indexOf("\n\tprivate ", start + 10);
			expect(main.slice(start, end)).toContain("this.trafficHomeRecord(actor)");
		}
	});
	test("routine projections save nothing; a pre-implementation repair resumes on the next hauler departure", () => {
		const p = hauler();
		const before = canonicalSnapshot(newWorld(47), 1000);
		routeVoyages(galaxy, p, home.index, 1000, getContents);
		expect(canonicalSnapshot(newWorld(47), 1000)).toBe(before);
		expect(WORLD_GENERATOR_VERSION).toBe(10);
		const fixture = JSON.parse(
			readFileSync(
				new URL("./fixtures/inter-system-old-repair.json", import.meta.url),
				"utf8",
			),
		);
		const loaded = parseWorld(fixture);
		expect(loaded.worldGeneratorVersion).toBe(10);
		const plan = buildHaulerPlans(galaxy, 0, getContents).find(
			(p) => p.actor.key === "0:station-refinery/traffic-01",
		)!;
		expect(plan.vocation).toBe("hauler");
		const recovery = loaded.galaxies[0].objective[plan.actor.key].recovery!;
		const rejoin = nextTrafficDepartureAtS(
			plan.actor.schedule,
			recovery.completesAt,
		);
		const availability = haulerAvailability(
			plan.actor,
			loaded.galaxies[0],
			recovery.completesAt,
		);
		expect(availability.condition).toBe("operational");
		expect(availability.rejoinsAtS).toBe(rejoin);
		expect(
			routeVoyages(
				galaxy,
				plan,
				0,
				rejoin - 0.1,
				getContents,
				undefined,
				rejoin,
			),
		).toEqual([]);
		const at = rejoin + plan.homeBounds.nominalOutS + HAULER_SLACK_S;
		const voyage = haulerVoyage(
			plan,
			Math.round(
				(rejoin - plan.actor.schedule.departureAtS) /
					plan.actor.schedule.cycleS,
			),
		);
		expect(
			inboundHaulers(
				galaxy,
				voyage.destinationSystemIndex,
				at,
				getContents,
				(key) =>
					key === plan.actor.key
						? haulerAvailability(plan.actor, loaded.galaxies[0], at)
						: "operational",
			).some((p) => p.actor.key === plan.actor.key),
		).toBe(true);
	});
	test("offset lane distances fit the actual eligible charge pairs", () => {
		for (const p of plans().filter((p) => p.vocation === "hauler"))
			for (let ordinal = 0; ordinal < p.eligible.length; ordinal++) {
				const v = haulerVoyage(p, ordinal),
					dest = galaxy.systems.find(
						(r) => r.index === v.destinationSystemIndex,
					)!;
				const homeLane = lanePoint(
					home,
					getContents(home.index),
					dest.pos,
					v.tOut,
					p.actor.key,
					ordinal,
				).pos;
				const awayLane = lanePoint(
					dest,
					getContents(dest.index),
					home.pos,
					v.tOut,
					p.actor.key,
					ordinal,
				).pos;
				const h = placeBodies(getContents(home.index), v.tOut).find(
					(b) => b.id === p.actor.homeStationId,
				)!;
				const d = placeBodies(getContents(dest.index), v.tOut).find(
					(b) => b.id === v.destinationStationId,
				)!;
				expect(
					(length(sub(homeLane, h.pos)) + length(sub(awayLane, d.pos))) / AU_KM,
				).toBeLessThanOrEqual(HULL_SPECS[p.actor.hullId].chargeAu);
				const hOff = sub(
					homeLane,
					arrivalPoint(home, getContents(home.index), dest.pos, v.tOut),
				);
				const dOff = sub(
					awayLane,
					arrivalPoint(dest, getContents(dest.index), home.pos, v.tOut),
				);
				expect(length(sub(hOff, dOff))).toBeLessThan(1e-6);
			}
	});
	test("cold inbound queries include two hops with identical generation work at 1 and 365 days", () => {
		const counts: number[] = [];
		for (const days of [1, 365]) {
			const generated = new Map<number, ReturnType<typeof generateContents>>();
			const start = performance.now();
			inboundHaulers(
				galaxy,
				0,
				days * 86400,
				(i) => {
					if (!generated.has(i))
						generated.set(
							i,
							generateContents(galaxy.systems.find((r) => r.index === i)!),
						);
					return generated.get(i)!;
				},
				() => "operational",
			);
			console.log(
				`cold inbound ${days} days: ${(performance.now() - start).toFixed(2)} ms, ${generated.size} generated systems`,
			);
			counts.push(generated.size);
		}
		expect(counts).toEqual([33, 33]);
	});
	test("three real failing control runs are rejected by the same acceptance assertions", () => {
		const baseline = runTrafficControl("baseline");
		expect(baseline.status).toBe(0);
		expect(baseline.stderr).toContain("3 pass");
		for (const control of ["crossing", "identity", "late"] as const) {
			const child = runTrafficControl(control);
			expect(child.status).toBe(1);
			expect(child.stderr).toContain("1 fail");
			expect(child.stderr).toContain("error: expect");
		}
	});
	test("local consumers cannot read another system or import the inter-system module", () => {
		for (const file of ["station-traffic.ts", "station-route.ts"])
			expect(
				readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"),
			).not.toMatch(/from ["']\.\/inter-system-traffic/);
		expect(
			readFileSync(
				new URL("../src/inter-system-traffic.ts", import.meta.url),
				"utf8",
			),
		).not.toMatch(/from ["']three["']/);
	});
});

test("the ring a watcher sees is published by the route, on both ends", () => {
	// The timeline itself — opening, flare, seal — is `witchspace-crossing`'s and
	// `tests/witchspace-crossing.test.ts` holds it. What this row holds is that
	// the route actually publishes the jump across the whole visible window, and
	// that the window is signed: it used to open only at a non-negative age, so
	// an NPC's ring could not announce the ship coming.
	expect(npcRiftStrength(-CROSSING.openS + 0.2)).toBeGreaterThan(0);
	expect(npcRiftStrength(-CROSSING.openS - 0.1)).toBe(0);
	expect(npcRiftStrength(0)).toBe(1);
	expect(npcRiftStrength(CROSSING.windowEndS)).toBe(0);
	expect(WITCHSPACE.riftEndS).toBeGreaterThan(CROSSING.windowS);
});

describe("the crossing a watcher sees (node #1006)", () => {
	const plan = () => hauler();
	const voyage = () => haulerVoyage(plan(), 0);
	const at = (record: typeof home, t: number) =>
		projectSystemTrafficActor({
			record,
			actor: plan().actor,
			gameTime: t,
			haulerVoyages: routeVoyages(galaxy, plan(), record.index, t, getContents),
		});
	const destination = () =>
		galaxy.systems.find((r) => r.index === voyage().destinationSystemIndex)!;
	const destLeg = (t: number) =>
		routeVoyages(galaxy, plan(), destination().index, t, getContents).find(
			(r) => !r.home && r.awayOrdinal === 0,
		)!.arrival;
	const homeLeg = (t: number) =>
		routeVoyages(galaxy, plan(), home.index, t, getContents).find(
			(r) => r.home && r.awayOrdinal === 0,
		)!.departure;

	test("the arrival ring opens while the hauler is still in another system", () => {
		const v = voyage(),
			dest = destination(),
			t = v.tOut - CROSSING.openS + 0.2;
		const route = at(dest, t);
		// A ring with no ship in it yet: that is the build-up the capture had
		// none of. `present: false` is what keeps the hull, its contact and its
		// collision out of this system until it has actually crossed.
		expect(route.phase).toBe("hyperspace-away");
		expect(route.present).toBe(false);
		expect(route.jump?.kind).toBe("arrival");
		expect(route.jump?.atS).toBe(v.tOut);
		expect(route.jump?.pos).toEqual(destLeg(t).pos);
		const age = t - v.tOut;
		expect(npcRiftStrength(age)).toBeGreaterThan(0);
		expect(npcRiftStrength(age)).toBeLessThan(1);
		expect(npcRiftStrength(t + 0.5 - v.tOut)).toBeGreaterThan(
			npcRiftStrength(age),
		);
	});

	test("and no ring is promised before its window opens", () => {
		const v = voyage();
		const route = at(destination(), v.tOut - CROSSING.openS - 0.2);
		expect(route.jump).toBeUndefined();
		expect(npcRiftVisible(-CROSSING.openS - 0.2)).toBe(false);
	});

	test("the arriving hull comes through the plane and settles on the lane point", () => {
		const t0 = voyage().tOut,
			leg = destLeg(t0),
			nose = leg.nose;
		const entering = at(destination(), t0 + 0.05);
		expect(entering.phase).toBe("lane-point-hold");
		// Aft of the point it will rest at, so a watcher sees it cross the ring's
		// plane rather than find it already standing there.
		const aft = -dot(sub(entering.pos, leg.pos), nose);
		expect(aft).toBeGreaterThan(0);
		const settled = at(destination(), t0 + CROSSING.crossS);
		expect(length(sub(settled.pos, leg.pos))).toBeLessThan(1e-9);
		expect(length(settled.vel)).toBeLessThan(1e-9);
		expect(settled.phase).toBe("lane-point-hold");
		// And it is still a held ship, not a flying one: the crossing has not
		// taken the leg's start away from it.
		expect(settled.jump?.kind).toBe("arrival");
		expect(settled.chargeAu).toBe(leg.chargeAu);
	});

	test("the hold hands the next leg exactly the state it always handed it", () => {
		// A1: no schedule, lane point, wind-up or arrival time moves. The leg
		// after the hold begins at `atS + JUMP_CHARGE_S` from the lane point at
		// rest (`lanePointArrivalStart`), and the crossing ends on exactly that.
		const t0 = voyage().tOut,
			leg = destLeg(t0);
		const handed = at(destination(), t0 + JUMP_CHARGE_S - 0.05);
		expect(length(sub(handed.pos, leg.pos))).toBeLessThan(1e-9);
		expect(length(handed.vel)).toBeLessThan(1e-9);
		expect(handed.phase).toBe("lane-point-hold");
		expect(handed.jump?.atS).toBe(t0);
	});

	test("a departing hull is swallowed rather than deleted", () => {
		const t0 = voyage().tOut,
			leg = homeLeg(t0 - 0.05);
		const late = at(home, t0 - 0.05);
		expect(late.phase).toBe("jump-windup");
		// Ahead of the point it stood at, into the ring that stands ahead of it.
		const ahead = dot(
			sub(late.pos, leg.pos),
			late.jump?.nose ?? (late.nose as Vec3),
		);
		expect(ahead).toBeGreaterThan(0);
		const waiting = at(home, t0 - CROSSING.crossS - 0.05);
		expect(waiting.phase).toBe("jump-windup");
		expect(length(sub(waiting.pos, leg.pos))).toBeLessThan(1e-9);
	});

	test("and its ring is open before it has gone", () => {
		const v = voyage(),
			t = v.tOut - CROSSING.openS + 0.2;
		const route = at(home, t);
		expect(route.phase).toBe("jump-windup");
		expect(route.jump?.kind).toBe("departure");
		const age = t - v.tOut;
		expect(npcRiftStrength(age)).toBeGreaterThan(0);
		// …and it seals behind the ship instead of being found still open.
		expect(npcRiftStrength(CROSSING.windowEndS - 0.01)).toBeGreaterThan(0);
		expect(npcRiftStrength(CROSSING.windowEndS)).toBe(0);
	});
});
test("the inbound steering/powered boundary agrees with a direct canonical replay", () => {
	const g = generateGalaxy(54, 0),
		c = new Map(g.systems.map((r) => [r.index, generateContents(r)])),
		get = (i: number) => c.get(i)!;
	const p = buildHaulerPlans(g, 232, get).find((p) =>
		p.actor.key.endsWith("trade/traffic-05"),
	)!;
	const cache = new Map();
	let prior: ReturnType<typeof projectSystemTrafficAuthority> | undefined;
	for (let tick = 13060; tick <= 13573; tick++) {
		const t = tick / 10,
			input = {
				record: p.homeRecord,
				actor: p.actor,
				gameTime: t,
				haulerVoyages: routeVoyages(g, p, 232, t, get),
			};
		const live = projectSystemTrafficAuthority({
			...input,
			cruiseCache: cache,
		});
		if (prior?.phase === "cruise" && live.phase === "cruise") {
			expect(Number.isFinite(live.cruisePathKm)).toBe(true);
		}
		prior = live;
		if (tick >= 13570) {
			const direct = projectSystemTrafficActor(input);
			expect(length(sub(live.pos, direct.pos))).toBeLessThan(1e-5);
			expect(live.phase).toBe(direct.phase);
		}
	}
});
test("uncontended worst-bound destinations fit the away and parked intervals with dwell", () => {
	for (const p of plans().filter((p) => p.vocation === "hauler")) {
		const worst = [...p.eligible].sort(
			(a, b) =>
				b.bounds.nominalInS +
				b.bounds.nominalOutS -
				(a.bounds.nominalInS + a.bounds.nominalOutS),
		)[0];
		const n =
				(p.eligible.indexOf(worst) - p.actor.ordinal + p.eligible.length) %
				p.eligible.length,
			v = haulerVoyage(p, n);
		const dest = galaxy.systems.find((r) => r.index === worst.systemIndex)!;
		const atAway = v.parkedBoundaryS - 30,
			input = {
				record: dest,
				actor: p.actor,
				gameTime: atAway,
				haulerVoyages: routeVoyages(galaxy, p, dest.index, atAway, getContents),
			};
		const away = projectSystemTrafficActor(input);
		expect(away.phase).toBe("docked-away");
		expect(away.completedAtS! + 30).toBeLessThanOrEqual(v.parkedBoundaryS);
		const atHome = v.awayBoundaryS + p.actor.schedule.cycleS - 30;
		const returned = projectSystemTrafficActor({
			record: p.homeRecord,
			actor: p.actor,
			gameTime: atHome,
			haulerVoyages: routeVoyages(galaxy, p, home.index, atHome, getContents),
		});
		expect(returned.phase).toBe("parked-home");
		expect(returned.completedAtS! + 30).toBeLessThanOrEqual(
			v.awayBoundaryS + p.actor.schedule.cycleS,
		);
	}
});

test("inbound set is identical after an unvisited, visited, or contended home projection", () => {
	const p = hauler(),
		v = haulerVoyage(p, 0),
		query = () =>
			inboundHaulers(
				galaxy,
				v.destinationSystemIndex,
				v.tOut,
				getContents,
				() => "operational",
			).map((p) => p.actor.key);
	const unvisited = query();
	const input = {
		record: p.homeRecord,
		actor: p.actor,
		gameTime: v.tOut,
		haulerVoyages: routeVoyages(galaxy, p, home.index, v.tOut, getContents),
	};
	projectSystemTrafficActor(input);
	expect(query()).toEqual(unvisited);
	projectSystemTrafficActor({
		...input,
		playerTimeline: [
			{
				stationId: p.actor.homeStationId,
				kind: "lane",
				fromS: v.awayBoundaryS,
				toS: v.tOut + 60,
				participant: { kind: "player" },
				movement: "launch",
				committed: true,
			},
		],
	});
	expect(query()).toEqual(unvisited);
});
