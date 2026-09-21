/**
 * `docs/specs/persistent-world-state.md` §9 — the nine headless obligations the
 * implementation node ([#46](https://github.com/jcfischer/seelite/issues/46))
 * owes.
 *
 * One `describe` per obligation, numbered as the spec numbers them, so a
 * failing run names the clause it broke rather than a function.
 *
 * **What this file is not.** It does not test the save *encoding* — slots,
 * bytes, migration and autosave are §10's deferred decisions, and the model
 * boundary is the furthest this node reaches. `deficits.test.ts` owns the
 * deficit domain's own arithmetic — `market-state.test.ts` did until #67 split
 * the map out of the pricing module; here it appears only as one of the seven
 * typed domains the envelope must carry through a round trip.
 */

import { describe, expect, test } from "bun:test";
import { carrierKey, compareCarrierKeys } from "../src/carrier-key";
import { carrierStanding } from "../src/carrier-standing";
import { type DeficitMap, recordTrade } from "../src/deficits";
import { generateGalaxy } from "../src/galaxy";
import { HOLD_REFERENCE_T } from "../src/market";
import { raiderSlotCount } from "../src/raider-slots";
import { fnv1a } from "../src/rng";
import { LOCAL_CARRIER_ID } from "../src/station";
import { generateContents } from "../src/system";
import {
	advanceTo,
	applyTransition,
	canonicalSnapshot,
	carrierBaselineFingerprint,
	compactWorld,
	effectiveCarrier,
	enumerateCarriers,
	type GalaxyEnvelope,
	type KnowledgeRow,
	materializeDue,
	newWorld,
	observe,
	observeDocking,
	observeScan,
	observeSystemRelay,
	type Provenance,
	parseWorld,
	readKnowledge,
	recoveryProcessId,
	serializeWorld,
	setDeficits,
	setLegalAssaulted,
	setLegalHeat,
	setLegalWitnesses,
	visit,
	WORLD_GENERATOR_VERSION,
	WORLD_SCHEMA_VERSION,
	type WorldState,
} from "../src/world-state";

const WORLD = 0x5ee11e;

/** The trade station of system 3, galaxy 0 — one carrier slot, used wherever a
 *  test needs *a* slot rather than a particular one. */
const KEY = carrierKey(3, LOCAL_CARRIER_ID.trade);
const OTHER = carrierKey(11, LOCAL_CARRIER_ID.refinery);

const PLAYER: Provenance = {
	causeKind: "player-weapons",
	actorId: "player",
	playerRole: "direct",
};
const PIRATE: Provenance = {
	causeKind: "pirate-raid",
	actorId: "pirate-band-4",
	playerRole: "none",
};

/** A world with one disabled carrier under repair, the shape most obligations
 *  need. Repair opens at t=10 and closes at t=70. */
const underRepair = (): WorldState => {
	let w = newWorld(WORLD);
	w = applyTransition(w, 0, KEY, {
		kind: "disable",
		occurredAt: 10,
		cause: PLAYER,
	});
	return applyTransition(w, 0, KEY, {
		kind: "repair-start",
		occurredAt: 10,
		cause: PIRATE,
		consequenceArea: "system:3",
		completesAt: 70,
	});
};

// ---------------------------------------------------------------------------

describe("§9.1 namespace and baseline stability", () => {
	test("every generated carrier in all eight galaxies has one unique key", () => {
		let carriers = 0;
		for (let galaxy = 0; galaxy < 8; galaxy++) {
			const seen = new Set<string>();
			for (const c of enumerateCarriers(WORLD, galaxy)) {
				expect(seen.has(c.key)).toBe(false);
				seen.add(c.key);
				carriers++;
			}
		}
		// **Pinned, not bounded** — the same rule `market-state.test.ts` states
		// for its 117-station corpus. A `>` here leaves a generator change that
		// halves the galaxy green.
		//
		// A pin is a regression check, not a proof the number is *right*, so it
		// is bracketed by the generated station plus one Traffic Carrier per
		// berth Traffic may call home — the catalogue minus #277's visitor
		// berth. The mandatory trade station contributes eight carriers (its own
		// plus seven of eight berths) and a three-role system at most eighteen.
		// It read 24932 while Traffic held every berth.
		//
		// #324 added the raider encounter slots, one to four per system by law,
		// and left the station and Traffic slots exactly where they were: 21736
		// of these are still those, and the rest are raiders.
		expect(carriers).toBe(27802);
		let raiders = 0;
		let expectedRaiders = 0;
		for (let galaxy = 0; galaxy < 8; galaxy++) {
			for (const c of enumerateCarriers(WORLD, galaxy))
				if (c.kind === "raider") raiders++;
			for (const record of generateGalaxy(WORLD, galaxy).systems)
				expectedRaiders += raiderSlotCount(record.government);
		}
		expect(raiders).toBe(expectedRaiders);
		expect(carriers - raiders).toBe(21736);
		let systemsWithStations = 0;
		let widest = 0;
		for (let galaxy = 0; galaxy < 8; galaxy++) {
			const perSystem = new Map<number, number>();
			for (const c of enumerateCarriers(WORLD, galaxy))
				perSystem.set(c.systemIndex, (perSystem.get(c.systemIndex) ?? 0) + 1);
			systemsWithStations += perSystem.size;
			widest = Math.max(widest, ...perSystem.values());
		}
		expect(widest).toBe(21);
		expect(systemsWithStations).toBe(8 * 256);
		// Eight station and Traffic carriers at the least plus one raider slot;
		// eighteen at the most plus four.
		expect(carriers).toBeGreaterThanOrEqual(8 * 256 * (8 + 1));
		expect(carriers).toBeLessThanOrEqual(8 * 256 * (18 + 4));
	});

	test("a local id repeats across systems and never inside one", () => {
		const perSystem = new Map<number, Set<string>>();
		let repeatsAcrossSystems = 0;
		const globalIds = new Set<string>();
		for (const c of enumerateCarriers(WORLD, 0)) {
			const bucket = perSystem.get(c.systemIndex) ?? new Set<string>();
			expect(bucket.has(c.localCarrierId)).toBe(false);
			bucket.add(c.localCarrierId);
			perSystem.set(c.systemIndex, bucket);
			if (globalIds.has(c.localCarrierId)) repeatsAcrossSystems++;
			globalIds.add(c.localCarrierId);
		}
		// The whole reason the key is composite: `station-trade` names one
		// station in nearly every system.
		expect(repeatsAcrossSystems).toBeGreaterThan(200);
		// Three station carriers and fifteen Traffic ones — the widest system's
		// roster since #277 reserved a visitor berth at each of its stations —
		// and #324's four raider slots.
		expect(globalIds.size).toBe(22);
	});

	test("station and Traffic carrier metadata stay structurally discriminated", () => {
		const carriers = [...enumerateCarriers(WORLD, 0)];
		const station = carriers.find((carrier) => carrier.kind === "station");
		const traffic = carriers.find((carrier) => carrier.kind === "traffic");
		if (!station || !traffic) throw new Error("missing generated carrier kind");
		expect(station.kind).toBe("station");
		if (station.kind === "station") expect(station.stationType).toBeDefined();
		expect(traffic.kind).toBe("traffic");
		if (traffic.kind === "traffic") {
			expect(traffic.homeStationType).toBeDefined();
			expect(traffic.hullId).toBeDefined();
		}
		const raider = carriers.find((carrier) => carrier.kind === "raider");
		if (!raider) throw new Error("missing raider carrier kind");
		if (raider.kind === "raider") expect(raider.hullId).toBe("raider");
		// A raider slot belongs to its system, not to a station.
		expect(raider.parentId).toBeNull();
	});

	test("market rows key on the same composite namespace", () => {
		const record = generateGalaxy(WORLD, 0).systems[3];
		const station = generateContents(record).stations.find(
			(s) => s.type === "trade",
		);
		expect(station).toBeDefined();
		expect(carrierKey(3, station?.localCarrierId ?? "")).toBe(KEY);
	});

	test("the golden persistence-ID table is pinned", () => {
		// A rename here is a save migration, not a refactor.
		expect(LOCAL_CARRIER_ID).toEqual({
			trade: "station-trade",
			refinery: "station-refinery",
			shipyard: "station-shipyard",
			outpost: "station-outpost",
		});
	});

	test("the station and Traffic slots are version 5's, identity and placement", () => {
		// #324 added raider slots and was to move nothing else. A count cannot
		// show that — two generators with the same number of slots in different
		// places agree on it (sage round 1). Hashing the station and Traffic slots
		// alone, in version 5's line format, against version 5's golden
		// fingerprints shows identity, type, parent and placement unmoved.
		//
		// **The line format is restated here on purpose.** It is pinned to a
		// version that no longer exists; if `carrierBaselineFingerprint`'s format
		// changes, these goldens cannot match and the row says so.
		const V5_GOLDEN = [
			3533000626, 1070577234, 2722668670, 3149233322, 2273383725, 63070487,
			656005811, 694742327,
		];
		const withoutRaiders = (galaxy: number) => {
			const parts: string[] = [];
			for (const c of enumerateCarriers(WORLD, galaxy)) {
				if (c.kind === "raider") continue;
				const generatedType =
					c.kind === "station"
						? c.stationType
						: `traffic:${c.homeStationType}:${c.hullId}`;
				parts.push(
					`${c.systemIndex}|${c.localCarrierId}|${generatedType}|${c.parentId ?? "-"}|${c.orbitRadiusKm.toFixed(6)}|${c.orbitTheta0.toFixed(6)}`,
				);
			}
			return fnv1a(parts.join("\n"));
		};
		expect([0, 1, 2, 3, 4, 5, 6, 7].map(withoutRaiders)).toEqual(V5_GOLDEN);
	});

	test("the carrier baseline fingerprint is pinned per galaxy", () => {
		// Identity, type, parent and generated placement, hashed. It goes red on
		// any generator change that moves a station — which is exactly when
		// `WORLD_GENERATOR_VERSION` owes a bump and a migration.
		expect(WORLD_GENERATOR_VERSION).toBe(6);
		const fingerprints = [0, 1, 2, 3, 4, 5, 6, 7].map((g) =>
			carrierBaselineFingerprint(WORLD, g),
		);
		expect(fingerprints).toEqual(GOLDEN_FINGERPRINTS);
		expect(new Set(fingerprints).size).toBe(8);
	});
});

/**
 * Pinned at `WORLD_GENERATOR_VERSION` 4 against world seed `0x5ee11e`.
 *
 * - 1 → 2: node #32's orbit floor moved every floored station's generated
 *   placement — the set this hashes — so the baseline moved with it.
 * - 2 → 3: #118 reshaped the galaxy to a q = 0.7 disc and re-derived the
 *   radius, which moved every position and so re-rolled the layout `attempt`
 *   for three of these eight galaxies. An attempt is part of a system's seed,
 *   so those galaxies re-generated whole.
 * - 3 → 4: #148/#266 added one home-owned Traffic Carrier per generated berth.
 * - 4 → 5: #277 reserved a visitor berth at every station, so the roster is the
 *   catalogue minus one and every station loses its highest-ordinal Traffic
 *   slot.
 * - 5 → 6: #324 added one to four raider encounter slots to every system, by
 *   the principal's ruling that raiders are enumerated carriers. The station
 *   and Traffic slots did not move, and the row above holds that against
 *   version 5's own fingerprints rather than against a count.
 *
 * Version 4 changed all eight hashes because every generated station gained
 * Traffic Carrier slots; version 5 changes all eight again because every one of
 * them loses a slot. At version 3, five were unchanged by #118's scale-only
 * polity effect and only galaxies 1, 2 and 6 re-rolled their layout attempt.
 *
 * **The bump is the point, not the paperwork.** This row's own rule is that a
 * moved carrier set owes a version bump and a migration; #89 still owns the
 * save, so today the bump is what makes a version-4 snapshot fail its load
 * check loudly instead of silently pointing at a carrier that no longer
 * exists.
 *
 * These are not arbitrary numbers to re-bless when the suite goes red. Each one
 * is a hash of every carrier slot's identity, type, parent and generated
 * placement in one galaxy, so a change here means a saved market deficit or a
 * saved wreck now points at a different station than it did — which is a
 * migration, and §2 says so.
 */
const GOLDEN_FINGERPRINTS = [
	1163913307, 3856323717, 2679409367, 1183764877, 1701938284, 3786678530,
	2605068771, 239491612,
];

// ---------------------------------------------------------------------------

describe("§9.2 baseline purity and exclusion", () => {
	test("an empty overlay leaves generated records structurally identical", () => {
		const record = generateGalaxy(WORLD, 0).systems[3];
		const stations = generateContents(record).stations;
		const before = JSON.parse(JSON.stringify(stations));
		const world = newWorld(WORLD);
		for (const s of stations) {
			const key = carrierKey(3, s.localCarrierId);
			const eff = effectiveCarrier(world.galaxies[0], key, 0);
			expect(eff.condition).toBe("operational");
			expect(eff.instanceOrdinal).toBe(0);
			expect(eff.recovery).toBeUndefined();
		}
		expect(stations).toEqual(before);
	});

	test("an untouched carrier has no rows at all", () => {
		const world = newWorld(WORLD);
		expect(Object.keys(world.galaxies[0].objective)).toEqual([]);
		expect(Object.keys(world.galaxies[0].episodes)).toEqual([]);
		expect(Object.keys(world.galaxies[0].knowledge)).toEqual([]);
	});

	test("the serialized model carries no generated geometry or projection", () => {
		// **Field names, not substrings.** The first version searched the JSON
		// text for `"pos"`, which is inside `opposed` — a legal `PlayerRole` — so
		// the first fixture to use that role would have turned a geometry check
		// red with no geometry in sight. Every key in the tree is collected and
		// compared exactly instead.
		const keys = new Set<string>();
		const walk = (value: unknown): void => {
			if (Array.isArray(value)) return value.forEach(walk);
			if (value === null || typeof value !== "object") return;
			for (const [k, v] of Object.entries(value)) {
				keys.add(k);
				walk(v);
			}
		};
		// A world using every `PlayerRole`, so the check is exercised against the
		// vocabulary it has to coexist with.
		let w = underRepair();
		w = applyTransition(w, 0, KEY, {
			kind: "recovery-change",
			occurredAt: 20,
			cause: {
				causeKind: "blockade",
				actorId: "pirate",
				playerRole: "opposed",
			},
			completesAt: 400,
		});
		w = applyTransition(w, 0, OTHER, {
			kind: "disable",
			occurredAt: 21,
			cause: { causeKind: "escort", actorId: "player", playerRole: "assisted" },
		});
		walk(serializeWorld(w));
		for (const forbidden of [
			"orbit",
			"radiusKm",
			"parentId",
			"spinRpm",
			"blackMarket",
			"aAu",
			"theta0",
			"periodS",
			"inclination",
			"pos",
			"radius",
			"capabilities",
			"stationType",
			"type",
			"id",
		])
			expect(keys.has(forbidden), forbidden).toBe(false);
		// The control: the walk found something, so an empty set cannot pass.
		expect(keys.has("playerRole")).toBe(true);
		expect(keys.size).toBeGreaterThan(15);
	});

	test("an undeclared state domain is rejected", () => {
		const raw = serializeWorld(newWorld(WORLD)) as {
			galaxies: Record<string, unknown>[];
		};
		raw.galaxies[0].factionInfluence = { "3": 0.4 };
		expect(() => parseWorld(raw)).toThrow(/domain/i);
	});
});

// ---------------------------------------------------------------------------

describe("§9.3 the transition table", () => {
	const at = (w: WorldState, t: number) =>
		effectiveCarrier(w.galaxies[0], KEY, t);

	test("every allowed transition works", () => {
		let w = newWorld(WORLD);
		w = applyTransition(w, 0, KEY, {
			kind: "disable",
			occurredAt: 1,
			cause: PLAYER,
		});
		expect(at(w, 1).condition).toBe("disabled");
		w = applyTransition(w, 0, KEY, {
			kind: "restore",
			occurredAt: 2,
			cause: PLAYER,
		});
		expect(at(w, 2).condition).toBe("operational");
		w = applyTransition(w, 0, KEY, {
			kind: "destroy",
			occurredAt: 3,
			cause: PIRATE,
		});
		expect(at(w, 3).condition).toBe("destroyed");
		w = applyTransition(w, 0, KEY, {
			kind: "replacement-start",
			occurredAt: 4,
			cause: PLAYER,
			consequenceArea: "system:3",
			completesAt: 100,
		});
		expect(at(w, 4).condition).toBe("repairing");
		w = applyTransition(w, 0, KEY, {
			kind: "recovery-change",
			occurredAt: 5,
			cause: PLAYER,
			completesAt: 80,
		});
		expect(at(w, 5).recovery?.completesAt).toBe(80);
		w = applyTransition(w, 0, KEY, {
			kind: "replacement-complete",
			occurredAt: 6,
			cause: PLAYER,
		});
		expect(at(w, 6).condition).toBe("operational");
		expect(at(w, 6).instanceOrdinal).toBe(1);
	});

	test("repair completes a repair and keeps the instance ordinal", () => {
		let w = underRepair();
		expect(at(w, 10).condition).toBe("repairing");
		w = applyTransition(w, 0, KEY, {
			kind: "repair-complete",
			occurredAt: 40,
			cause: PIRATE,
		});
		expect(at(w, 40).condition).toBe("operational");
		expect(at(w, 40).instanceOrdinal).toBe(0);
	});

	test("a recovery that takes no time is refused", () => {
		const w = applyTransition(newWorld(WORLD), 0, KEY, {
			kind: "disable",
			occurredAt: 10,
			cause: PLAYER,
		});
		// `completesAt === occurredAt` returned a world whose clock already
		// equalled the deadline with the row still `repairing` — the one state
		// the writers' clock rule says no verb can produce, and `serializeWorld`
		// would have written it down.
		expect(() =>
			applyTransition(w, 0, KEY, {
				kind: "repair-start",
				occurredAt: 10,
				cause: PLAYER,
				consequenceArea: "system:3",
				completesAt: 10,
			}),
		).toThrow(/no later/);
		expect(() =>
			applyTransition(underRepair(), 0, KEY, {
				kind: "recovery-change",
				occurredAt: 20,
				cause: PLAYER,
				completesAt: 20,
			}),
		).toThrow(/no later/);
	});

	test("every invalid transition fails loudly", () => {
		const fresh = newWorld(WORLD);
		// Operational cannot be restored, repaired, completed or interrupted.
		for (const kind of [
			"restore",
			"repair-complete",
			"replacement-complete",
			"interrupt",
			"recovery-change",
			"repair-start",
			"replacement-start",
		] as const)
			expect(() =>
				applyTransition(fresh, 0, KEY, {
					kind,
					occurredAt: 1,
					cause: PLAYER,
					consequenceArea: "system:3",
					completesAt: 9,
					resulting: "disabled",
				} as never),
			).toThrow();
		// A destroyed carrier cannot be repaired in place.
		const dead = applyTransition(fresh, 0, KEY, {
			kind: "destroy",
			occurredAt: 1,
			cause: PIRATE,
		});
		expect(() =>
			applyTransition(dead, 0, KEY, {
				kind: "repair-start",
				occurredAt: 2,
				cause: PLAYER,
				consequenceArea: "system:3",
				completesAt: 9,
			}),
		).toThrow(/repair/i);
		// A repair episode cannot close as a replacement, nor the reverse.
		expect(() =>
			applyTransition(underRepair(), 0, KEY, {
				kind: "replacement-complete",
				occurredAt: 20,
				cause: PLAYER,
			}),
		).toThrow();
	});

	test("a destroyed-origin replacement rejects a repair completion", () => {
		let w = applyTransition(newWorld(WORLD), 0, KEY, {
			kind: "destroy",
			occurredAt: 1,
			cause: PIRATE,
		});
		w = applyTransition(w, 0, KEY, {
			kind: "replacement-start",
			occurredAt: 1,
			cause: PLAYER,
			consequenceArea: "system:3",
			completesAt: 50,
		});
		expect(() =>
			applyTransition(w, 0, KEY, {
				kind: "repair-complete",
				occurredAt: 20,
				cause: PLAYER,
			}),
		).toThrow(/replacement/i);
	});

	test("knowledge combines independently with every objective condition", () => {
		let w = newWorld(WORLD);
		// Observed operational at t=0, then wrecked out of sight.
		w = observe(w, 0, KEY, 0, "visit");
		w = applyTransition(w, 0, KEY, {
			kind: "destroy",
			occurredAt: 5,
			cause: PIRATE,
		});
		expect(at(w, 6).condition).toBe("destroyed");
		const known = readKnowledge(w.galaxies[0], KEY);
		expect(known?.observedCondition).toBe("operational");
		expect(known?.observedAt).toBe(0);
	});

	test("every objective/observed pair is reachable and independent", () => {
		// **Built, not asserted into existence.** The first version of this was a
		// 4x4 loop over `condition === observed || condition !== observed`, which
		// is true for every input and would have passed on an implementation that
		// overwrote knowledge on every transition — the exact defect the matrix
		// was there to rule out. Each cell now drives the objective axis to one
		// condition and the knowledge axis to another, through the shipped verbs.
		const CONDITIONS = [
			"operational",
			"disabled",
			"destroyed",
			"repairing",
		] as const;
		/** Drives one carrier to `want`, unwitnessed, from a fresh world. */
		const driveTo = (
			want: (typeof CONDITIONS)[number],
			t: number,
		): WorldState => {
			let w = newWorld(WORLD);
			if (want === "operational") return w;
			w = applyTransition(w, 0, KEY, {
				kind: want === "destroyed" ? "destroy" : "disable",
				occurredAt: t,
				cause: PIRATE,
			});
			if (want === "repairing")
				w = applyTransition(w, 0, KEY, {
					kind: "repair-start",
					occurredAt: t,
					cause: PIRATE,
					consequenceArea: "system:3",
					completesAt: 1_000_000,
				});
			return w;
		};
		for (const observed of CONDITIONS)
			for (const condition of CONDITIONS) {
				// Observe the carrier while it is in `observed`, then move it to
				// `condition` out of sight — so the two axes hold different values
				// at the same instant wherever they can.
				let w = driveTo(observed, 1);
				w = observe(w, 0, KEY, 2, "visit");
				expect(readKnowledge(w.galaxies[0], KEY)?.observedCondition).toBe(
					observed,
				);
				const target = driveTo(condition, 1);
				w = {
					...w,
					galaxies: w.galaxies.map((g, i) =>
						i === 0 ? { ...g, objective: target.galaxies[0].objective } : g,
					),
				};
				expect(effectiveCarrier(w.galaxies[0], KEY, 3).condition).toBe(
					condition,
				);
				expect(readKnowledge(w.galaxies[0], KEY)?.observedCondition).toBe(
					observed,
				);
				expect(readKnowledge(w.galaxies[0], KEY)?.observedAt).toBe(2);
			}
	});

	test("repeated destroy/replace cycles preserve instance ordinals", () => {
		let w = newWorld(WORLD);
		let t = 0;
		for (let cycle = 1; cycle <= 4; cycle++) {
			w = applyTransition(w, 0, KEY, {
				kind: "destroy",
				occurredAt: ++t,
				cause: PIRATE,
			});
			w = applyTransition(w, 0, KEY, {
				kind: "replacement-start",
				occurredAt: ++t,
				cause: PLAYER,
				consequenceArea: "system:3",
				completesAt: t + 1_000,
			});
			w = applyTransition(w, 0, KEY, {
				kind: "replacement-complete",
				occurredAt: ++t,
				cause: PLAYER,
			});
			expect(at(w, t).instanceOrdinal).toBe(cycle);
		}
	});

	test("repeated interrupt/restart cycles produce distinct process identities", () => {
		let w = newWorld(WORLD);
		w = applyTransition(w, 0, KEY, {
			kind: "disable",
			occurredAt: 1,
			cause: PLAYER,
		});
		const ids = new Set<string>();
		let t = 1;
		for (let cycle = 0; cycle < 4; cycle++) {
			w = applyTransition(w, 0, KEY, {
				kind: "repair-start",
				occurredAt: ++t,
				cause: PLAYER,
				consequenceArea: "system:3",
				completesAt: 10_000,
			});
			ids.add(String(at(w, t).recovery?.processId));
			w = applyTransition(w, 0, KEY, {
				kind: "interrupt",
				occurredAt: ++t,
				cause: PIRATE,
				resulting: "disabled",
			});
		}
		expect(ids.size).toBe(4);
	});

	test("destroy → repairing → rescheduled → complete keeps one episode and the first attribution", () => {
		let w = newWorld(WORLD);
		w = applyTransition(w, 0, KEY, {
			kind: "destroy",
			occurredAt: 1,
			cause: PLAYER,
		});
		const opened = w.galaxies[0].episodes[KEY]?.ordinal;
		w = applyTransition(w, 0, KEY, {
			kind: "replacement-start",
			occurredAt: 2,
			cause: PIRATE,
			consequenceArea: "system:3",
			completesAt: 90,
		});
		w = applyTransition(w, 0, KEY, {
			kind: "recovery-change",
			occurredAt: 3,
			cause: PIRATE,
			completesAt: 60,
		});
		// The completion is **lazy** (§4): at `completesAt` it materializes
		// itself, and an explicit event at that instant would arrive after it.
		w = advanceTo(w, 60);
		const episode = w.galaxies[0].episodes[KEY];
		expect(episode?.ordinal).toBe(opened);
		expect(episode?.initiating.cause.playerRole).toBe("direct");
		expect(episode?.initiating.cause.actorId).toBe("player");
		expect(episode?.latest.kind).toBe("replacement-complete");
		expect(episode?.intervention?.kind).toBe("replacement-start");
	});

	test("a restore after an interruption opens the next episode", () => {
		let w = newWorld(WORLD);
		w = applyTransition(w, 0, KEY, {
			kind: "disable",
			occurredAt: 1,
			cause: PLAYER,
		});
		w = applyTransition(w, 0, KEY, {
			kind: "repair-start",
			occurredAt: 2,
			cause: PLAYER,
			consequenceArea: "system:3",
			completesAt: 900,
		});
		w = applyTransition(w, 0, KEY, {
			kind: "interrupt",
			occurredAt: 3,
			cause: PIRATE,
			resulting: "disabled",
		});
		const interrupted = w.galaxies[0].episodes[KEY];
		expect(interrupted?.closed).toBe(true);
		w = applyTransition(w, 0, KEY, {
			kind: "restore",
			occurredAt: 4,
			cause: PLAYER,
		});
		const after = w.galaxies[0].episodes[KEY];
		// Folding into the closed episode overwrote the interruption and credited
		// the restoration to the disable that opened it.
		expect(after?.ordinal).toBe((interrupted?.ordinal ?? 0) + 1);
		expect(after?.initiating.kind).toBe("restore");
	});

	test("every recovery outcome records the process it touched", () => {
		// Reading the identity off the *resulting* delta dropped it from every
		// completion and interrupt, so one outcome serialized two ways depending
		// on whether it materialized lazily or arrived as an event.
		const lazy = advanceTo(underRepair(), 70);
		const processId = recoveryProcessId(KEY, 1, "repair");
		expect(lazy.galaxies[0].episodes[KEY]?.latest.processId).toBe(processId);

		const explicit = applyTransition(underRepair(), 0, KEY, {
			kind: "repair-complete",
			occurredAt: 40,
			cause: PIRATE,
		});
		expect(explicit.galaxies[0].episodes[KEY]?.latest.processId).toBe(
			processId,
		);

		const stopped = applyTransition(underRepair(), 0, KEY, {
			kind: "interrupt",
			occurredAt: 40,
			cause: PIRATE,
			resulting: "disabled",
		});
		expect(stopped.galaxies[0].episodes[KEY]?.latest.processId).toBe(processId);
	});

	test("a later unrelated episode replaces the summary, role `none` included", () => {
		let w = advanceTo(underRepair(), 70);
		const first = w.galaxies[0].episodes[KEY]?.ordinal ?? 0;
		w = applyTransition(w, 0, KEY, {
			kind: "disable",
			occurredAt: 80,
			cause: PIRATE,
		});
		const next = w.galaxies[0].episodes[KEY];
		expect(next?.ordinal).toBe(first + 1);
		expect(next?.initiating.cause.playerRole).toBe("none");
	});
});

// ---------------------------------------------------------------------------

describe("§9.4 lazy recovery boundaries", () => {
	test("before, at and after `completesAt`, without a tick loop", () => {
		const w = underRepair();
		expect(effectiveCarrier(w.galaxies[0], KEY, 69.999).condition).toBe(
			"repairing",
		);
		expect(effectiveCarrier(w.galaxies[0], KEY, 70).condition).toBe(
			"operational",
		);
		expect(effectiveCarrier(w.galaxies[0], KEY, 70).instanceOrdinal).toBe(0);
		expect(effectiveCarrier(w.galaxies[0], KEY, 10_000).condition).toBe(
			"operational",
		);
	});

	test("a replacement materializes with the next instance ordinal", () => {
		let w = applyTransition(newWorld(WORLD), 0, KEY, {
			kind: "destroy",
			occurredAt: 1,
			cause: PIRATE,
		});
		w = applyTransition(w, 0, KEY, {
			kind: "replacement-start",
			occurredAt: 1,
			cause: PLAYER,
			consequenceArea: "system:3",
			completesAt: 50,
		});
		expect(effectiveCarrier(w.galaxies[0], KEY, 49).instanceOrdinal).toBe(0);
		expect(effectiveCarrier(w.galaxies[0], KEY, 50).instanceOrdinal).toBe(1);
		expect(effectiveCarrier(w.galaxies[0], KEY, 50).condition).toBe(
			"operational",
		);
	});

	test("`occurredAt` is `completesAt` whenever it is first read", () => {
		const base = underRepair();
		const early = advanceTo(base, 70);
		const late = advanceTo(base, 9_999);
		expect(early.galaxies[0].episodes[KEY]?.latest.occurredAt).toBe(70);
		expect(late.galaxies[0].episodes[KEY]?.latest.occurredAt).toBe(70);
	});

	test("different access times give identical canonical snapshots", () => {
		const base = underRepair();
		const a = canonicalSnapshot(advanceTo(base, 70), 10_000);
		const b = canonicalSnapshot(advanceTo(advanceTo(base, 500), 1_200), 10_000);
		const c = canonicalSnapshot(base, 10_000);
		expect(a).toBe(b);
		expect(a).toBe(c);
	});

	test("an explicit completion at `completesAt` arrives after the lazy one", () => {
		// §4 materializes the due completion *before* a new event at the same
		// timestamp, so by the time this is validated there is nothing left to
		// complete. The PR states the behaviour; this is what holds it.
		expect(() =>
			applyTransition(underRepair(), 0, KEY, {
				kind: "repair-complete",
				occurredAt: 70,
				cause: PIRATE,
			}),
		).toThrow(/nothing to complete/);
		// One instant earlier it is an ordinary early completion.
		const early = applyTransition(underRepair(), 0, KEY, {
			kind: "repair-complete",
			occurredAt: 69.999,
			cause: PIRATE,
		});
		expect(effectiveCarrier(early.galaxies[0], KEY, 70).condition).toBe(
			"operational",
		);
	});

	test("a lazy completion does not update knowledge", () => {
		let w = observe(underRepair(), 0, KEY, 10, "visit");
		expect(readKnowledge(w.galaxies[0], KEY)?.observedCondition).toBe(
			"repairing",
		);
		w = advanceTo(w, 500);
		expect(effectiveCarrier(w.galaxies[0], KEY, 500).condition).toBe(
			"operational",
		);
		// The player knew the schedule, not its outcome.
		expect(readKnowledge(w.galaxies[0], KEY)?.observedCondition).toBe(
			"repairing",
		);
		expect(
			readKnowledge(w.galaxies[0], KEY)?.observedRecovery?.completesAt,
		).toBe(70);
	});

	test("a player-caused explicit transition updates knowledge immediately", () => {
		const w = applyTransition(newWorld(WORLD), 0, KEY, {
			kind: "disable",
			occurredAt: 4,
			cause: PLAYER,
		});
		expect(readKnowledge(w.galaxies[0], KEY)?.observedCondition).toBe(
			"disabled",
		);
		expect(readKnowledge(w.galaxies[0], KEY)?.observedAt).toBe(4);
	});

	test("an unwitnessed transition does not", () => {
		const w = applyTransition(newWorld(WORLD), 0, KEY, {
			kind: "destroy",
			occurredAt: 4,
			cause: PIRATE,
		});
		expect(readKnowledge(w.galaxies[0], KEY)).toBeUndefined();
	});

	/**
	 * **A destruction may schedule its own replacement** (#324 part d, the
	 * principal's ruling). The start materializes lazily at `startsAt`, as the
	 * completion does at `completesAt`, so a raider killed before the player
	 * leaves the system starts its repair on time wherever the player is. An
	 * explicit start could not: `applyTransition` refuses a time before the
	 * clock.
	 */
	describe("a scheduled replacement", () => {
		const NETWORK: Provenance = {
			causeKind: "raider-replacement",
			actorId: "raider-network-3",
			playerRole: "none",
		};
		const destroyed = (): WorldState =>
			applyTransition(newWorld(WORLD), 0, KEY, {
				kind: "destroy",
				occurredAt: 100,
				cause: PLAYER,
				schedule: {
					startsAt: 700,
					completesAt: 1900,
					consequenceArea: "system:3",
					cause: NETWORK,
				},
			});

		test("destroyed until `startsAt`, repairing until `completesAt`, then replaced", () => {
			const env = destroyed().galaxies[0];
			expect(effectiveCarrier(env, KEY, 699.999).condition).toBe("destroyed");
			const started = effectiveCarrier(env, KEY, 700);
			expect(started.condition).toBe("repairing");
			expect(started.recovery?.kind).toBe("replacement");
			expect(started.recovery?.startedAt).toBe(700);
			expect(started.recovery?.completesAt).toBe(1900);
			expect(started.recovery?.initiatedBy).toEqual(NETWORK);
			expect(effectiveCarrier(env, KEY, 1899.999).condition).toBe("repairing");
			const done = effectiveCarrier(env, KEY, 1900);
			expect(done.condition).toBe("operational");
			expect(done.instanceOrdinal).toBe(1);
		});

		test("the process identity is the destruction's episode", () => {
			const w = destroyed();
			const ordinal = w.galaxies[0].episodes[KEY]?.ordinal;
			expect(ordinal).toBeDefined();
			expect(
				effectiveCarrier(w.galaxies[0], KEY, 800).recovery?.processId,
			).toBe(recoveryProcessId(KEY, ordinal ?? -1, "replacement"));
		});

		test("materializing writes the start and the completion at their own times, in one episode", () => {
			for (const t of [1900, 50_000]) {
				const env = advanceTo(destroyed(), t).galaxies[0];
				const episode = env.episodes[KEY];
				expect(episode?.initiating.kind).toBe("destroy");
				expect(episode?.intervention?.kind).toBe("replacement-start");
				expect(episode?.intervention?.occurredAt).toBe(700);
				expect(episode?.intervention?.cause).toEqual(NETWORK);
				expect(episode?.intervention?.episodeOrdinal).toBe(episode?.ordinal);
				expect(episode?.latest.kind).toBe("replacement-complete");
				expect(episode?.latest.occurredAt).toBe(1900);
				expect(episode?.closed).toBe(true);
				expect(env.objective[KEY]?.instanceOrdinal).toBe(1);
				expect(env.objective[KEY]?.condition).toBe("operational");
			}
			// Between the two: the start is written and the completion is not.
			const mid = advanceTo(destroyed(), 1000).galaxies[0];
			expect(mid.objective[KEY]?.condition).toBe("repairing");
			expect(mid.objective[KEY]?.scheduled).toBeUndefined();
			expect(mid.episodes[KEY]?.latest.kind).toBe("replacement-start");
			expect(mid.episodes[KEY]?.closed).toBe(false);
		});

		test("different access times give identical canonical snapshots", () => {
			const base = destroyed();
			const a = canonicalSnapshot(advanceTo(base, 700), 10_000);
			const b = canonicalSnapshot(
				advanceTo(advanceTo(base, 1000), 1_900),
				10_000,
			);
			const c = canonicalSnapshot(base, 10_000);
			expect(a).toBe(b);
			expect(a).toBe(c);
			// And before the start, too.
			expect(canonicalSnapshot(advanceTo(base, 699), 700)).toBe(
				canonicalSnapshot(base, 700),
			);
		});

		test("a lazy start does not update knowledge", () => {
			// The player saw the kill; the start happened out of sight.
			const w = advanceTo(destroyed(), 1000);
			expect(readKnowledge(w.galaxies[0], KEY)?.observedCondition).toBe(
				"destroyed",
			);
		});

		test("an explicit start before `startsAt` replaces the schedule", () => {
			const w = applyTransition(destroyed(), 0, KEY, {
				kind: "replacement-start",
				occurredAt: 300,
				cause: PIRATE,
				consequenceArea: "system:3",
				completesAt: 400,
			});
			const env = w.galaxies[0];
			expect(env.objective[KEY]?.scheduled).toBeUndefined();
			expect(effectiveCarrier(env, KEY, 350).recovery?.startedAt).toBe(300);
			expect(effectiveCarrier(env, KEY, 400).instanceOrdinal).toBe(1);
			// Nothing starts again at 700.
			expect(effectiveCarrier(env, KEY, 800).condition).toBe("operational");
			expect(effectiveCarrier(env, KEY, 2000).instanceOrdinal).toBe(1);
		});

		test("a schedule starts after the destruction and completes after it starts", () => {
			const at = (startsAt: number, completesAt: number) => () =>
				applyTransition(newWorld(WORLD), 0, KEY, {
					kind: "destroy",
					occurredAt: 100,
					cause: PLAYER,
					schedule: {
						startsAt,
						completesAt,
						consequenceArea: "system:3",
						cause: NETWORK,
					},
				});
			expect(at(100, 200)).toThrow(/starts no later than the destruction/);
			expect(at(200, 200)).toThrow(/completes no later than it starts/);
			expect(at(Number.NaN, 200)).toThrow();
			expect(at(200, 300)).not.toThrow();
		});

		test("a scheduled row survives the round trip, and compaction keeps it", () => {
			const before = destroyed();
			const after = parseWorld(serializeWorld(before));
			expect(after).toEqual(before);
			expect(effectiveCarrier(after.galaxies[0], KEY, 700).condition).toBe(
				"repairing",
			);
			expect(compactWorld(before, 100).galaxies[0].objective[KEY]).toEqual(
				before.galaxies[0].objective[KEY],
			);
		});

		test("a schedule on any row but a destroyed one is refused on parse", () => {
			const raw = serializeWorld(destroyed()) as {
				galaxies: Array<{ objective: Record<string, Record<string, unknown>> }>;
			};
			raw.galaxies[0].objective[KEY].condition = "disabled";
			expect(() => parseWorld(raw)).toThrow(/schedule/);
		});
	});
});

// ---------------------------------------------------------------------------

describe("§9.5 order independence", () => {
	test("insertion order does not change the canonical snapshot", () => {
		const keys = [OTHER, KEY, carrierKey(200, LOCAL_CARRIER_ID.shipyard)];
		const build = (order: number[]): WorldState => {
			let w = newWorld(WORLD);
			for (const i of order)
				w = applyTransition(w, 0, keys[i], {
					kind: "disable",
					occurredAt: 5,
					cause: PIRATE,
				});
			return w;
		};
		expect(canonicalSnapshot(build([0, 1, 2]), 100)).toBe(
			canonicalSnapshot(build([2, 0, 1]), 100),
		);
		expect(canonicalSnapshot(build([0, 1, 2]), 100)).toBe(
			canonicalSnapshot(build([1, 2, 0]), 100),
		);
	});

	test("a key with no separator is refused, not silently mis-sorted", () => {
		// `NaN - NaN` is not less, not greater and not equal, so a comparator
		// that let one through fell back to arbitrary order — the exact failure
		// the numeric sort exists to prevent, and one §4 orders completions by.
		expect(() =>
			compareCarrierKeys("station-trade", "2:station-trade"),
		).toThrow(/carrier key/);
	});

	test("carrier keys sort numerically by system, not lexically", () => {
		const sorted = [
			carrierKey(11, "station-trade"),
			carrierKey(2, "station-trade"),
			carrierKey(2, "station-refinery"),
		].sort(compareCarrierKeys);
		expect(sorted).toEqual([
			carrierKey(2, "station-refinery"),
			carrierKey(2, "station-trade"),
			carrierKey(11, "station-trade"),
		]);
	});

	test("same-timestamp completions materialize in canonical key order", () => {
		const keys = [
			carrierKey(11, "station-trade"),
			carrierKey(2, "station-trade"),
		];
		let w = newWorld(WORLD);
		for (const k of keys) {
			w = applyTransition(w, 0, k, {
				kind: "disable",
				occurredAt: 1,
				cause: PIRATE,
			});
			w = applyTransition(w, 0, k, {
				kind: "repair-start",
				occurredAt: 1,
				cause: PIRATE,
				consequenceArea: "system:x",
				completesAt: 50,
			});
		}
		const { order } = materializeDue(w.galaxies[0], 50);
		expect(order).toEqual([keys[1], keys[0]]);
	});

	test("a due completion resolves before a new event at the same instant", () => {
		const w = applyTransition(underRepair(), 0, KEY, {
			kind: "disable",
			occurredAt: 70,
			cause: PIRATE,
		});
		// The repair landed first, so the disable had an operational carrier to
		// act on rather than being rejected as illegal from `repairing`.
		expect(effectiveCarrier(w.galaxies[0], KEY, 70).condition).toBe("disabled");
		expect(w.galaxies[0].episodes[KEY]?.ordinal).toBe(2);
	});
});

// ---------------------------------------------------------------------------

/** A world exercising all six typed domains at once. `galaxyIndex` is the
 *  envelope's own identity, not a seventh domain. */
const populated = (): WorldState => {
	let w = underRepair();
	w = observe(w, 0, KEY, 12, "visit");
	w = applyTransition(w, 0, OTHER, {
		kind: "destroy",
		occurredAt: 20,
		cause: PIRATE,
	});
	w = visit(w, 0, 3);
	w = visit(w, 0, 11);
	w = setLegalHeat(w, 0, 42, 20);
	w = applyTransition(w, 3, carrierKey(7, LOCAL_CARRIER_ID.shipyard), {
		kind: "disable",
		occurredAt: 21,
		cause: PLAYER,
	});
	const deficits: DeficitMap = recordTrade({}, KEY, {
		goodName: "Food",
		units: 12,
		gameTimeMin: 20,
		holdT: HOLD_REFERENCE_T,
	});
	w = {
		...w,
		galaxies: w.galaxies.map((g, i) =>
			i === 0 ? { ...g, deficits } : g,
		) as WorldState["galaxies"],
	};
	return w;
};

describe("§9.6 round trip", () => {
	test("every domain survives serialize → parse", () => {
		const before = populated();
		const after = parseWorld(serializeWorld(before));
		expect(after.worldSchemaVersion).toBe(WORLD_SCHEMA_VERSION);
		expect(after.worldGeneratorVersion).toBe(WORLD_GENERATOR_VERSION);
		expect(after.seed).toBe(before.seed);
		expect(after.gameTime).toBe(before.gameTime);
		expect(after.galaxies.length).toBe(8);
		expect(after).toEqual(before);
	});

	test("the round trip preserves `observedRecovery` in full", () => {
		const after = parseWorld(serializeWorld(populated()));
		const known = readKnowledge(after.galaxies[0], KEY);
		expect(known?.observedRecovery).toEqual({
			processId: recoveryProcessId(KEY, 1, "repair"),
			kind: "repair",
			consequenceArea: "system:3",
			startedAt: 10,
			completesAt: 70,
		});
	});

	test("the round trip preserves a learned black-market marker, never its generated value", () => {
		const before = observeDocking(newWorld(WORLD), 0, OTHER, 12, true);
		const raw = serializeWorld(before) as {
			galaxies: Array<{ knowledge: Record<string, unknown> }>;
		};
		const row = raw.galaxies[0].knowledge[OTHER] as Record<string, unknown>;
		expect(row).toHaveProperty("knownPrivateFacts.blackMarket.learnedAt", 12);
		expect(parseWorld(raw)).toEqual(before);
	});

	test("all eight galaxy namespaces stay separate", () => {
		const after = parseWorld(serializeWorld(populated()));
		expect(Object.keys(after.galaxies[0].objective).sort()).toEqual(
			[KEY, OTHER].sort(),
		);
		expect(Object.keys(after.galaxies[3].objective)).toEqual([
			carrierKey(7, LOCAL_CARRIER_ID.shipyard),
		]);
		for (const g of [1, 2, 4, 5, 6, 7])
			expect(Object.keys(after.galaxies[g].objective)).toEqual([]);
		expect(after.galaxies[0].visited).toEqual([3, 11]);
		expect(after.galaxies[0].legalStatus).toEqual({
			heat: 42,
			updatedAt: 20,
			witnesses: [],
			assaulted: [],
		});
		expect(after.galaxies[3].visited).toEqual([]);
	});

	test("the deficit domain round-trips through the model boundary", () => {
		const after = parseWorld(serializeWorld(populated()));
		expect(after.galaxies[0].deficits[KEY]?.goods.Food).toBe(12);
		expect(after.galaxies[0].deficits[KEY]?.updatedAt).toBe(20);
	});
});

/** Re-hash a hand-edited body, which is the only way to speak as an older build
 *  did: the integrity field covers the canonical body, so a save whose
 *  `legalStatus` never held a `witnesses` or an `assaulted` member has to be
 *  *hashed* without one to be the artefact a player actually has. Shared by both
 *  of the list describes below — it was declared twice, and a helper that exists
 *  twice is a helper that drifts. */
const rehash = (raw: unknown): unknown => {
	const body = { ...(raw as Record<string, unknown>) };
	delete body.integrity;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

const legalOf = (raw: unknown, galaxy = 0) =>
	(raw as { galaxies: Array<{ legalStatus: Record<string, unknown> }> })
		.galaxies[galaxy].legalStatus;

describe("#366 H6: `witnesses` across the save boundary", () => {
	test("an empty list is not written at all", () => {
		// `knownPrivateFacts` is omitted when absent for the same reason. Written
		// as `"witnesses": []` on every row, the canonical body changes bytes for
		// every save the game has ever taken — and the FNV-1a over that body then
		// refuses a save written before the field existed. That is a worse
		// failure than the schema bump H6 declined, because it says "integrity".
		const before = setLegalHeat(newWorld(WORLD), 0, 42, 20);
		const raw = serializeWorld(before);
		expect(legalOf(raw)).not.toHaveProperty("witnesses");
		expect(parseWorld(raw)).toEqual(before);
	});

	test("a save written before the field existed parses to an empty list", () => {
		// Stripped and re-hashed: the bytes the previous build actually wrote.
		const raw = rehash(serializeWorld(setLegalHeat(newWorld(WORLD), 2, 40, 5)));
		delete legalOf(raw, 2).witnesses;
		delete legalOf(raw, 2).assaulted;
		expect(parseWorld(raw).galaxies[2].legalStatus).toEqual({
			heat: 40,
			updatedAt: 5,
			witnesses: [],
			assaulted: [],
		});
	});

	test("a witnessed list round-trips, in the canonical carrier order", () => {
		let world = setLegalHeat(newWorld(WORLD), 0, 40, 0);
		world = setLegalWitnesses(world, 0, [OTHER, KEY], 0);
		const raw = serializeWorld(world);
		// Canonical order, not the order the offences happened in: two pilots who
		// offended in opposite orders write the same bytes.
		expect(legalOf(raw).witnesses).toEqual(
			[KEY, OTHER].sort(compareCarrierKeys),
		);
		expect(parseWorld(raw)).toEqual(world);
	});

	test("a witness that is not a carrier key is refused, not quietly dropped", () => {
		// A bare `Station.id` in this list would read as "this system's station"
		// in every system, which is the corruption the `CarrierKey` brand exists
		// to stop — and a parse that filtered it would pass the save through with
		// the wrong station cleared.
		let world = setLegalHeat(newWorld(WORLD), 0, 40, 0);
		world = setLegalWitnesses(world, 0, [KEY], 0);
		const raw = rehash(serializeWorld(world));
		legalOf(raw).witnesses = ["station-trade"];
		expect(() => parseWorld(raw)).toThrow(/witness/i);
	});

	test("a duplicated witness is refused at the write and at the parse", () => {
		// The writer holds each station once and says so; a parse that folded a
		// duplicate would hide a writer that had stopped holding them, which is
		// H6's bound on the list's size and the reason it can be bounded at all.
		const world = setLegalHeat(newWorld(WORLD), 0, 40, 0);
		expect(() => setLegalWitnesses(world, 0, [KEY, KEY], 0)).toThrow(
			/witness/i,
		);
		const raw = rehash(serializeWorld(setLegalWitnesses(world, 0, [KEY], 0)));
		legalOf(raw).witnesses = [KEY, KEY];
		expect(() => parseWorld(raw)).toThrow(/witness/i);
	});

	test("a witness list out of canonical order is refused, not re-sorted", () => {
		// The order is the writer's to establish. A parse that quietly sorted
		// would accept a body the canonicaliser could never have produced, and
		// the save would then re-hash to different bytes than it arrived with.
		const world = setLegalWitnesses(
			setLegalHeat(newWorld(WORLD), 0, 40, 0),
			0,
			[KEY, OTHER],
			0,
		);
		const raw = rehash(serializeWorld(world));
		legalOf(raw).witnesses = [OTHER, KEY];
		expect(() => parseWorld(raw)).toThrow(/witness/i);
	});
});

describe("§9.10 facility knowledge", () => {
	test("the relay observes every supplied station while preserving private facts", () => {
		const refinery = OTHER;
		const trade = KEY;
		let world = observeDocking(newWorld(WORLD), 0, refinery, 10, true);
		world = observeSystemRelay(world, 0, [trade, refinery], 20);
		expect(readKnowledge(world.galaxies[0], trade)).toMatchObject({
			observedAt: 20,
			source: "system-relay",
		});
		expect(readKnowledge(world.galaxies[0], refinery)).toMatchObject({
			observedAt: 20,
			source: "system-relay",
			knownPrivateFacts: { blackMarket: { learnedAt: 10, source: "docking" } },
		});
	});

	test("docking a non-refinery does not manufacture a private-fact marker", () => {
		const world = observeDocking(newWorld(WORLD), 0, KEY, 10, false);
		expect(
			readKnowledge(world.galaxies[0], KEY)?.knownPrivateFacts,
		).toBeUndefined();
	});
	/**
	 * §9.10: "the marker survives replacement of the carrier instance". The
	 * black-market flag is generated baseline data about the persisted carrier
	 * identity — `persistent-world-state.md` §2's `localCarrierId`, the thing
	 * `carrierKey` files a save row under — and not about the instance standing
	 * in it. So blowing the refinery up and rebuilding it cannot un-learn where
	 * the fence is.
	 */
	test("the marker survives a destroy and replacement of the carrier", () => {
		let world = observeDocking(newWorld(WORLD), 0, OTHER, 10, true);
		world = applyTransition(world, 0, OTHER, {
			kind: "destroy",
			occurredAt: 20,
			cause: PIRATE,
		});
		world = applyTransition(world, 0, OTHER, {
			kind: "replacement-start",
			occurredAt: 20,
			cause: PLAYER,
			consequenceArea: "system:11",
			completesAt: 80,
		});
		world = observeSystemRelay(world, 0, [OTHER], 90);
		const row = readKnowledge(world.galaxies[0], OTHER);
		// A new instance, a fresh condition reading — and the same learned fact.
		expect(row?.observedInstanceOrdinal).toBe(1);
		expect(row?.observedAt).toBe(90);
		expect(row?.knownPrivateFacts?.blackMarket).toEqual({
			learnedAt: 10,
			source: "docking",
		});
	});

	/**
	 * §3.1 names `learnedAt` for when the fact was *learned*. Re-docking is a
	 * fresh condition reading and not a fresh discovery, so the marker it finds
	 * is the one it keeps — written unconditionally it moved forward on every
	 * return trip, and a fact learned at the first visit reported the last.
	 */
	test("re-docking refreshes the condition and leaves learnedAt where it was", () => {
		let world = observeDocking(newWorld(WORLD), 0, OTHER, 10, true);
		world = observeDocking(world, 0, OTHER, 400, true);
		const row = readKnowledge(world.galaxies[0], OTHER);
		expect(row?.observedAt).toBe(400);
		expect(row?.knownPrivateFacts?.blackMarket).toEqual({
			learnedAt: 10,
			source: "docking",
		});
	});

	/**
	 * §9.10: "the snapshot never persists the generated black-market boolean
	 * itself".
	 *
	 * **The first version of this check could not fail.** It asserted the
	 * serialized row did not contain the string `blackMarketValue`, and nothing
	 * anywhere in the repository is named that — a tautology, whatever the
	 * marker held. This enumerates the marker's keys instead, so a build that
	 * copied the generated flag in under any name goes red.
	 */
	test("the serialized marker carries when and from whom, and nothing else", () => {
		const world = observeDocking(newWorld(WORLD), 0, OTHER, 12, true);
		const raw = serializeWorld(world) as {
			galaxies: Array<{
				knowledge: Record<
					string,
					{ knownPrivateFacts?: Record<string, Record<string, unknown>> }
				>;
			}>;
		};
		const marker = raw.galaxies[0].knowledge[OTHER].knownPrivateFacts
			?.blackMarket as Record<string, unknown>;
		expect(Object.keys(marker).sort()).toEqual(["learnedAt", "source"]);
		expect(Object.values(marker).some((v) => typeof v === "boolean")).toBe(
			false,
		);
	});

	/**
	 * §9.10: "A generated false flag with a marker is known-absent; the same
	 * flag without a marker is unchecked." The knowledge row is identical in
	 * both cases bar the marker — the *value* never enters the save, so the
	 * only thing distinguishing known-absent from unchecked is the marker's
	 * presence. This is the model half; `galaxy-finder.test.ts` holds the half
	 * that reads the generated flag back.
	 */
	test("checked and unchecked differ by the marker alone", () => {
		const unchecked = observe(newWorld(WORLD), 0, OTHER, 5, "system-relay");
		const checked = observeDocking(newWorld(WORLD), 0, OTHER, 5, true);
		const strip = (world: WorldState) => {
			const row = readKnowledge(world.galaxies[0], OTHER);
			if (!row) throw new Error("no row");
			const { knownPrivateFacts, source, ...rest } = row;
			return rest;
		};
		expect(strip(unchecked)).toEqual(strip(checked));
		expect(
			readKnowledge(unchecked.galaxies[0], OTHER)?.knownPrivateFacts,
		).toBeUndefined();
		expect(
			readKnowledge(checked.galaxies[0], OTHER)?.knownPrivateFacts,
		).toBeDefined();
	});

	/**
	 * §9.10: adding the marker changed the row shape, so the parser "does not
	 * silently accept a version-1 snapshot as though the new field had always
	 * been present". The neighbouring §9.9 check covers a *later* version; this
	 * is the prior one, which is the direction a real save file comes from.
	 */
	test("a version-1 snapshot is refused rather than read as markerless", () => {
		const raw = serializeWorld(
			observe(newWorld(WORLD), 0, OTHER, 5, "system-relay"),
		) as Record<string, unknown>;
		raw.worldSchemaVersion = 1;
		expect(() => parseWorld(raw)).toThrow(
			/worldSchemaVersion 1 needs a migration/,
		);
	});
});
describe("#396: the sustained-fire charge across the save boundary", () => {
	/** The `witnesses` rows above are the model for everything here, and the
	 *  second list is held to every one of them — including the old-save row
	 *  there, which strips and re-hashes *both* members and so is this list's
	 *  "a save predating it parses empty" row as much as the first one's. A copy
	 *  of it here would be a second row that can only go red when the first does.
	 *
	 *  The list is a *second* list rather than a field on the carrier's row
	 *  because an assault has no transition to write — H3c's `disable` is the
	 *  only mark a traffic carrier ever gets from the player's fire, and this
	 *  charge lands before the hull gives way. */

	test("an empty charge list is not written at all", () => {
		// Same reason as the witnesses, and it is the reason the schema version
		// did not move: an unwitnessed, uncharged row writes the bytes it wrote
		// before either member existed, and the integrity hash over them still
		// matches a save the game has been taking for months.
		expect(
			legalOf(serializeWorld(setLegalHeat(newWorld(WORLD), 0, 42, 20))),
		).not.toHaveProperty("assaulted");
	});

	test("a charge list round-trips, in the canonical carrier order", () => {
		let world = setLegalHeat(newWorld(WORLD), 0, 13, 0);
		world = setLegalAssaulted(world, 0, [OTHER, KEY], 0);
		const raw = serializeWorld(world);
		expect(legalOf(raw).assaulted).toEqual(
			[KEY, OTHER].sort(compareCarrierKeys),
		);
		expect(parseWorld(raw)).toEqual(world);
	});

	test("the two lists are written independently of each other", () => {
		// A charge filed with no hearers, and a killing heard with nothing
		// charged: both are ordinary (H5 files hearers whatever the offence
		// cost; a target Wanted at the tick makes the charge free). A writer
		// that stored them as one row could not express either.
		let heard = setLegalHeat(newWorld(WORLD), 0, 13, 0);
		heard = setLegalWitnesses(heard, 0, [KEY], 0);
		expect(legalOf(serializeWorld(heard))).not.toHaveProperty("assaulted");
		expect(legalOf(serializeWorld(heard)).witnesses).toEqual([KEY]);
		let charged = setLegalHeat(newWorld(WORLD), 0, 13, 0);
		charged = setLegalAssaulted(charged, 0, [KEY], 0);
		expect(legalOf(serializeWorld(charged))).not.toHaveProperty("witnesses");
		expect(legalOf(serializeWorld(charged)).assaulted).toEqual([KEY]);
	});

	test("a charge that is not a carrier key is refused, not quietly dropped", () => {
		let world = setLegalAssaulted(
			setLegalHeat(newWorld(WORLD), 0, 13, 0),
			0,
			[KEY],
			0,
		);
		const raw = rehash(serializeWorld(world));
		legalOf(raw).assaulted = ["station-trade"];
		expect(() => parseWorld(raw)).toThrow(/assaulted/i);
	});

	test("a duplicated charge is refused at the write and at the parse", () => {
		const world = setLegalHeat(newWorld(WORLD), 0, 13, 0);
		expect(() => setLegalAssaulted(world, 0, [KEY, KEY], 0)).toThrow(
			/assaulted/i,
		);
		const raw = rehash(serializeWorld(setLegalAssaulted(world, 0, [KEY], 0)));
		legalOf(raw).assaulted = [KEY, KEY];
		expect(() => parseWorld(raw)).toThrow(/assaulted/i);
	});

	test("a charge cleared across a save stays cleared", () => {
		// The incident ends when the heat decays below Wanted, and a list that
		// came back from a save it was cleared out of would re-pardon a carrier
		// whose incident the law has already closed.
		let world = setLegalAssaulted(
			setLegalHeat(newWorld(WORLD), 0, 13, 0),
			0,
			[KEY],
			0,
		);
		world = setLegalAssaulted(world, 0, [], 1e6);
		expect(
			parseWorld(serializeWorld(world)).galaxies[0].legalStatus.assaulted,
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------

describe("§3.1 the scan record", () => {
	/** A Traffic-scale reading: the scan fixes the instance and the voyage it
	 *  looked at, which is all §5 allows the row to hold. */
	const scan = (world: WorldState, at: number, voyage = 4): WorldState =>
		observeScan(world, 0, OTHER, at, {
			instanceOrdinal: 1,
			voyageOrdinal: voyage,
		});

	test("a scan writes when, from where, and the two ordinals — nothing else", () => {
		const row = readKnowledge(scan(newWorld(WORLD), 100).galaxies[0], OTHER);
		expect(row).toEqual({
			observedAt: 100,
			source: "scan",
			scan: {
				observedAt: 100,
				source: "scan",
				observedInstanceOrdinal: 1,
				observedVoyageOrdinal: 4,
			},
		});
		// **No condition, and that is the row's whole shape.** §5's other option
		// was a scan that also recorded a condition observation; F5 does not
		// reveal one, so writing `operational` because the ship is visibly
		// flying would put knowledge on the galaxy map the verb never granted.
		expect(row?.observedCondition).toBeUndefined();
		expect(row?.observedRecovery).toBeUndefined();
	});

	test("a scanned carrier is known, which is what the row was unreachable for", () => {
		// §3.1's "no row means undiscovered" is the predicate a scan has to flip,
		// and the required condition fields are what stopped a Traffic actor ever
		// having a row at all.
		const before = newWorld(WORLD);
		expect(readKnowledge(before.galaxies[0], OTHER)).toBeUndefined();
		expect(
			readKnowledge(scan(before, 100).galaxies[0], OTHER)?.observedAt,
		).toBe(100);
	});

	test("a scan keeps a condition observation, and a condition keeps the scan", () => {
		// Two observations, one row, in either order. A pilot who docked at a
		// carrier in repair does not un-know it because they later scanned it,
		// and a scanned carrier they then docked at has not been un-scanned.
		const docked = scan(newWorld(WORLD), 100);
		const after = observeDocking(docked, 0, OTHER, 200, false);
		const row = readKnowledge(after.galaxies[0], OTHER);
		expect(row?.observedCondition).toBeDefined();
		expect(row?.observedAt).toBe(200);
		expect(row?.source).toBe("docking");
		expect(row?.scan?.observedAt).toBe(100);

		const rescanned = scan(
			observe(newWorld(WORLD), 0, OTHER, 50, "system-relay"),
			120,
		);
		const back = readKnowledge(rescanned.galaxies[0], OTHER);
		expect(back?.observedCondition).toBeDefined();
		expect(back?.observedInstanceOrdinal).toBeDefined();
		// The row's own stamp is the *last contact*, which is what the record
		// card prints beside the condition; the condition's age is not stored
		// separately, and never was.
		expect(back?.observedAt).toBe(120);
		expect(back?.source).toBe("scan");
		expect(back?.scan?.observedAt).toBe(120);
	});

	test("a re-scan replaces the reading rather than adding a second one", () => {
		// §6's one row per carrier, and the reason a stale reading cannot
		// accumulate behind a fresher one.
		const twice = scan(scan(newWorld(WORLD), 100, 4), 300, 5);
		expect(readKnowledge(twice.galaxies[0], OTHER)?.scan).toEqual({
			observedAt: 300,
			source: "scan",
			observedInstanceOrdinal: 1,
			observedVoyageOrdinal: 5,
		});
	});

	test("the record ages and does not repair itself", () => {
		const row = readKnowledge(
			advanceTo(scan(newWorld(WORLD), 100), 6_000).galaxies[0],
			OTHER,
		);
		expect(row?.scan?.observedAt).toBe(100);
		// §3.1: objective events outside the player's channels update nothing,
		// so the world moving on is exactly what makes a reading go stale.
		expect(6_000 - (row?.observedAt ?? 0)).toBe(5_900);
	});

	test("the record survives a save", () => {
		const before = scan(newWorld(WORLD), 100);
		const raw = serializeWorld(before) as {
			galaxies: Array<{ knowledge: Record<string, Record<string, unknown>> }>;
		};
		expect(raw.galaxies[0].knowledge[OTHER].scan).toEqual({
			observedAt: 100,
			source: "scan",
			observedInstanceOrdinal: 1,
			observedVoyageOrdinal: 4,
		});
		expect(parseWorld(serializeWorld(before))).toEqual(before);
	});

	test("the reading a row points at does not move when the world does", () => {
		// §5's display rule: standing is re-derived from the row's own terms, so
		// what the pilot was shown stays what they were shown while the carrier
		// rotates under F2. The age is what changes.
		const scanRow = readKnowledge(
			scan(newWorld(WORLD), 100).galaxies[0],
			OTHER,
		)?.scan;
		if (!scanRow) throw new Error("the scan wrote no record");
		// The row's terms are the whole input, so the answer cannot drift as the
		// session runs. This is what the display has to pass — the row's clock,
		// never `gameTime`.
		const at = (t: number) =>
			carrierStanding(0x5ee11e, OTHER, scanRow.observedInstanceOrdinal, t);
		expect(at(scanRow.observedAt)).toBe(
			carrierStanding(0x5ee11e, OTHER, 1, scanRow.observedAt),
		);
		// And the two clocks do answer differently for some carrier. The shares
		// and the rotation are #362's own rows; this one only needs the fact that
		// they move, which is what makes an ageing reading load-bearing rather
		// than decorative.
		let moved = false;
		for (let i = 0; i < 400 && !moved; i++) {
			const key = carrierKey(
				3,
				`station-trade/traffic-${String(i).padStart(3, "0")}`,
			);
			const atClock = (t: number) => carrierStanding(0x5ee11e, key, 0, t);
			if (atClock(100) !== atClock(100 + 40 * 3600)) moved = true;
		}
		expect(moved).toBe(true);
	});

	test("a carrier that has not flown yet is recorded as such, and loads back", () => {
		// `trafficVoyage` answers -1 for a carrier that has not departed, and
		// `carrierManifest` is already asked with it on the Flight console. The
		// record stores what was read rather than a 0 that was never read —
		// otherwise the console and the glass would be two answers to one
		// question — and the parser admits that one value below zero and no other.
		const never = observeScan(newWorld(WORLD), 0, OTHER, 100, {
			instanceOrdinal: 0,
			voyageOrdinal: -1,
		});
		expect(readKnowledge(never.galaxies[0], OTHER)?.scan).toMatchObject({
			observedInstanceOrdinal: 0,
			observedVoyageOrdinal: -1,
		});
		expect(parseWorld(serializeWorld(never))).toEqual(never);
		const raw = serializeWorld(never) as {
			galaxies: Array<{ knowledge: Record<string, Record<string, unknown>> }>;
		};
		const scan = raw.galaxies[0].knowledge[OTHER].scan as Record<
			string,
			unknown
		>;
		expect(() =>
			parseWorld({
				...raw,
				galaxies: raw.galaxies.map((g, i) =>
					i === 0
						? {
								...g,
								knowledge: {
									[OTHER]: {
										...raw.galaxies[0].knowledge[OTHER],
										scan: { ...scan, observedVoyageOrdinal: -2 },
									},
								},
							}
						: g,
				),
			}),
		).toThrow(/neither a voyage count nor the sentinel/);
	});

	test("a snapshot from before the scan member refuses, not reinterprets", () => {
		// §9.6's rule and §9.10's precedent: the shape changed, so a v2 body is
		// refused with the migration named rather than read as though no carrier
		// had ever been scanned.
		const raw = serializeWorld(newWorld(WORLD)) as Record<string, unknown>;
		raw.worldSchemaVersion = 2;
		expect(() => parseWorld(raw)).toThrow(
			/worldSchemaVersion 2 needs a migration/,
		);
	});

	test("half an observation is refused by name", () => {
		const body = (knowledge: unknown) => {
			const raw = serializeWorld(scan(newWorld(WORLD), 100)) as {
				galaxies: Record<string, unknown>[];
			};
			raw.galaxies[0].knowledge = { [OTHER]: knowledge };
			return raw;
		};
		expect(() => parseWorld(body({ observedAt: 1, source: "scan" }))).toThrow(
			/carries a condition observation, a scan, or both/,
		);
		expect(() =>
			parseWorld(
				body({
					observedAt: 1,
					source: "scan",
					observedCondition: "operational",
				}),
			),
		).toThrow(/are one observation; one was absent/);
		expect(() =>
			parseWorld(
				body({
					observedAt: 1,
					source: "scan",
					observedRecovery: {
						processId: "p",
						kind: "repair",
						consequenceArea: "system:3",
						startedAt: 1,
						completesAt: 2,
					},
				}),
			),
		).toThrow(/observedRecovery belongs to a condition observation/);
	});

	test("the serializer emits no member that is not there", () => {
		// A row whose private-facts container was empty serialized as
		// `{"blackMarket":{}}` and then failed its own parser on the missing
		// `learnedAt`: a shape the model calls legal that could not be loaded.
		// The scan record makes a half-filled row ordinary, so the rule is
		// checked at the boundary rather than left to the next hand-edited save.
		const empty = newWorld(WORLD);
		const record: KnowledgeRow = {
			observedAt: 100,
			source: "scan",
			scan: {
				observedAt: 100,
				source: "scan",
				observedInstanceOrdinal: 1,
				observedVoyageOrdinal: 4,
			},
			knownPrivateFacts: {},
		};
		const half: WorldState = {
			...empty,
			galaxies: empty.galaxies.map((g, i) =>
				i === 0 ? { ...g, knowledge: { [OTHER]: record } } : g,
			),
		};
		const raw = serializeWorld(half) as {
			galaxies: Array<{ knowledge: Record<string, Record<string, unknown>> }>;
		};
		expect(Object.keys(raw.galaxies[0].knowledge[OTHER]).sort()).toEqual([
			"observedAt",
			"scan",
			"source",
		]);
		// **An empty container carries no information, so it is not written**: the
		// parsed row is the same row with the member absent, which is exactly the
		// meaning `learnedAt` and a source are there to carry. The defect this row
		// is about was the opposite — the container was serialized *with a member
		// invented inside it* and then refused by its own parser, so a row the
		// model called legal could not be loaded back.
		const parsed: KnowledgeRow = parseWorld(serializeWorld(half)).galaxies[0]
			.knowledge[OTHER];
		expect(parsed.knownPrivateFacts).toBeUndefined();
		const rebuilt: KnowledgeRow = { ...parsed, knownPrivateFacts: {} };
		expect(rebuilt).toEqual(record);
	});
});

describe("§9.7 compaction equivalence", () => {
	test("compaction changes no effective capability or attribution", () => {
		const before = populated();
		const after = compactWorld(before, before.gameTime);
		for (const g of [0, 3])
			for (const key of Object.keys(before.galaxies[g].objective))
				expect(effectiveCarrier(after.galaxies[g], key as never, 500)).toEqual(
					effectiveCarrier(before.galaxies[g], key as never, 500),
				);
		expect(after.galaxies[0].episodes[KEY]?.latest).toEqual(
			before.galaxies[0].episodes[KEY]?.latest,
		);
		expect(readKnowledge(after.galaxies[0], KEY)).toEqual(
			readKnowledge(before.galaxies[0], KEY),
		);
	});

	test("an original carrier back to operational drops its objective row", () => {
		let w = underRepair();
		w = advanceTo(w, 70);
		expect(w.galaxies[0].objective[KEY]).toBeDefined();
		w = compactWorld(w, 70);
		expect(w.galaxies[0].objective[KEY]).toBeUndefined();
		// The episode and the knowledge stay: only the delta is derivable.
		expect(w.galaxies[0].episodes[KEY]).toBeDefined();
		expect(effectiveCarrier(w.galaxies[0], KEY, 70).condition).toBe(
			"operational",
		);
	});

	test("a replacement keeps its objective row for the ordinal", () => {
		let w = applyTransition(newWorld(WORLD), 0, KEY, {
			kind: "destroy",
			occurredAt: 1,
			cause: PIRATE,
		});
		w = applyTransition(w, 0, KEY, {
			kind: "replacement-start",
			occurredAt: 1,
			cause: PLAYER,
			consequenceArea: "system:3",
			completesAt: 10,
		});
		w = compactWorld(advanceTo(w, 10), 10);
		expect(w.galaxies[0].objective[KEY]?.instanceOrdinal).toBe(1);
	});

	test("a carrier with an active recovery keeps its row", () => {
		const w = compactWorld(underRepair(), 20);
		expect(w.galaxies[0].objective[KEY]?.recovery?.completesAt).toBe(70);
	});

	test("disabled state never expires to save space", () => {
		const w = compactWorld(
			applyTransition(newWorld(WORLD), 0, KEY, {
				kind: "disable",
				occurredAt: 1,
				cause: PIRATE,
			}),
			100_000,
		);
		expect(w.galaxies[0].objective[KEY]?.condition).toBe("disabled");
	});
});

// ---------------------------------------------------------------------------

describe("§9.8 hard bounds", () => {
	test("cycles never grow past one row of each kind per carrier", () => {
		let w = newWorld(WORLD);
		let t = 0;
		for (let cycle = 0; cycle < 50; cycle++) {
			w = applyTransition(w, 0, KEY, {
				kind: "destroy",
				occurredAt: ++t,
				cause: PIRATE,
			});
			w = applyTransition(w, 0, KEY, {
				kind: "replacement-start",
				occurredAt: ++t,
				cause: PLAYER,
				consequenceArea: "system:3",
				completesAt: t + 5,
			});
			w = applyTransition(w, 0, KEY, {
				kind: "interrupt",
				occurredAt: ++t,
				cause: PIRATE,
				resulting: "destroyed",
			});
			w = applyTransition(w, 0, KEY, {
				kind: "replacement-start",
				occurredAt: ++t,
				cause: PLAYER,
				consequenceArea: "system:3",
				completesAt: t + 1_000,
			});
			w = applyTransition(w, 0, KEY, {
				kind: "replacement-complete",
				occurredAt: ++t,
				cause: PLAYER,
			});
			w = observe(w, 0, KEY, t, "visit");
		}
		w = compactWorld(w, t);
		expect(Object.keys(w.galaxies[0].objective).length).toBe(1);
		expect(Object.keys(w.galaxies[0].episodes).length).toBe(1);
		expect(Object.keys(w.galaxies[0].knowledge).length).toBe(1);
		expect(effectiveCarrier(w.galaxies[0], KEY, t).instanceOrdinal).toBe(50);
		// The whole save is one row per kind per carrier, whatever the play time.
		expect(JSON.stringify(serializeWorld(w)).length).toBeLessThan(4_000);
	});

	test("rows never exceed the generated carrier count", () => {
		let w = newWorld(WORLD);
		let touched = 0;
		for (const c of enumerateCarriers(WORLD, 0)) {
			if (touched >= 40) break;
			w = applyTransition(w, 0, c.key, {
				kind: "disable",
				occurredAt: 1,
				cause: PIRATE,
			});
			touched++;
		}
		expect(Object.keys(w.galaxies[0].objective).length).toBe(touched);
		expect(Object.keys(w.galaxies[0].episodes).length).toBe(touched);
	});
});

// ---------------------------------------------------------------------------

describe("§7 the envelope's writers", () => {
	test("every writer refuses a galaxy index outside 0..7", () => {
		const w = newWorld(WORLD);
		expect(() => setLegalHeat(w, 8, 1, 1)).toThrow(/galaxy/);
		expect(() => setLegalHeat(w, -1, 1, 1)).toThrow(/galaxy/);
		expect(() => visit(w, 8, 3)).toThrow(/galaxy/);
		expect(() => observe(w, 8, KEY, 1, "visit")).toThrow(/galaxy/);
		expect(() =>
			applyTransition(w, 8, KEY, {
				kind: "disable",
				occurredAt: 1,
				cause: PLAYER,
			}),
		).toThrow(/galaxy/);
		// The failure the guard prevents, on a world a *permitted* writer touched:
		// asserting on the untouched `w` could not have failed even with every
		// guard removed, because every call above threw before returning.
		expect(visit(w, 7, 3).galaxies.length).toBe(8);
		expect(visit(w, 7, 3).galaxies[7].visited).toEqual([3]);
	});

	test("no writer moves the clock past a completion without materializing it", () => {
		// The state no verb may produce: clock ahead of a `completesAt` that
		// nothing has written down. `observe` bumped the clock on its own and
		// made exactly that reachable, and `advanceTo` then materialized against
		// its raw argument rather than the clamped clock, so asking for an
		// earlier time left the row behind for good.
		const observed = observe(underRepair(), 0, KEY, 500, "visit");
		expect(observed.gameTime).toBe(500);
		expect(observed.galaxies[0].objective[KEY]?.condition).toBe("operational");
		expect(advanceTo(observed, 5).galaxies[0].objective[KEY]?.condition).toBe(
			"operational",
		);
		expect(advanceTo(observed, 5).gameTime).toBe(500);
		// And an `advanceTo` short of the deadline still leaves it repairing.
		expect(
			advanceTo(underRepair(), 50).galaxies[0].objective[KEY]?.condition,
		).toBe("repairing");
	});

	test("every writer refuses a value the parser would reject", () => {
		const w = newWorld(WORLD);
		expect(() => visit(w, 0, -1)).toThrow(/system index/);
		expect(() => visit(w, 0, 256)).toThrow(/system index/);
		expect(() => visit(w, 0, 3.5)).toThrow(/system index/);
		expect(() => setLegalHeat(w, 0, Number.NaN, 1)).toThrow(/finite/);
		expect(() => setLegalHeat(w, 0, 1, Number.POSITIVE_INFINITY)).toThrow(
			/finite/,
		);
	});

	test("observe refuses an observation from the past", () => {
		const w = observe(newWorld(WORLD), 0, KEY, 500, "visit");
		// `advanceTo`'s `Math.max` clamped the clock and let this through, so a
		// stale reading overwrote fresher intelligence with an older
		// `observedAt`.
		expect(() => observe(w, 0, KEY, 5, "relay")).toThrow(/before the clock/);
		expect(readKnowledge(w.galaxies[0], KEY)?.observedAt).toBe(500);
	});

	test("every writer refuses a malformed carrier key", () => {
		const w = newWorld(WORLD);
		// `carrierKey(3, "")` is `"3:"` — the type accepts it, every writer stored
		// it, and `splitCarrierKey` then fed `NaN` into the canonical order. The
		// damage only showed up as a save that would not load.
		const empty = carrierKey(3, "");
		expect(() =>
			applyTransition(w, 0, empty, {
				kind: "disable",
				occurredAt: 1,
				cause: PLAYER,
			}),
		).toThrow(/carrier key/);
		expect(() => observe(w, 0, empty, 1, "visit")).toThrow(/carrier key/);
	});

	test("setLegalHeat refuses a stamp from the past", () => {
		const w = setLegalHeat(newWorld(WORLD), 0, 10, 500);
		expect(() => setLegalHeat(w, 0, 3, 5)).toThrow(/before the clock/);
	});

	test("setDeficits writes through the envelope, and the clock stays in seconds", () => {
		// The unit trap this writer exists to close. A deficit row's `updatedAt`
		// is game *minutes* (`deficits.ts`), and the world clock is **seconds**
		// (`sim.ts`'s `World.gameTime`). A caller holding both and spreading a
		// new `gameTime` in by hand has to convert one of them, and the fifth
		// writer converted the wrong one.
		const at = 6000;
		const map = recordTrade({}, KEY, {
			goodName: "Food",
			units: 20,
			gameTimeMin: at / 60,
			holdT: HOLD_REFERENCE_T,
		});
		const w = setDeficits(newWorld(WORLD), 0, map, at);
		expect(w.gameTime).toBe(at);
		expect(w.galaxies[0].deficits[KEY]?.updatedAt).toBe(at / 60);
		expect(w.galaxies[0].deficits[KEY]?.goods.Food).toBeCloseTo(20, 10);
		// Every other envelope is untouched, and the snapshot still loads.
		expect(w.galaxies[1].deficits).toEqual({});
		expect(parseWorld(serializeWorld(w)).galaxies[0].deficits[KEY]).toEqual(
			w.galaxies[0].deficits[KEY],
		);
	});

	test("setDeficits refuses what every other writer refuses", () => {
		const w = newWorld(WORLD);
		expect(() => setDeficits(w, 8, {}, 0)).toThrow(/galaxy/);
		expect(() => setDeficits(w, -1, {}, 0)).toThrow(/galaxy/);
		expect(() => setDeficits(w, 0, {}, Number.NaN)).toThrow(/finite/);
		const later = setDeficits(w, 0, {}, 500);
		expect(() => setDeficits(later, 0, {}, 5)).toThrow(/before the clock/);
		// And it materializes a due completion rather than stepping over it,
		// which is the bug the `withEnvelope` comment records against writer #3.
		expect(
			setDeficits(underRepair(), 0, {}, 500).galaxies[0].objective[KEY]
				?.condition,
		).toBe("operational");
	});

	test("a save listing one system twice is rejected", () => {
		const raw = serializeWorld(visit(visit(newWorld(WORLD), 0, 3), 0, 11)) as {
			galaxies: Record<string, unknown>[];
		};
		raw.galaxies[0].visited = [3, 3, 11];
		expect(() => parseWorld(raw)).toThrow(/twice/i);
	});
});

describe("§9.9 atomicity and integrity", () => {
	test("a snapshot whose clock came from elsewhere fails validation", () => {
		const raw = serializeWorld(populated()) as Record<string, unknown>;
		expect(() => parseWorld({ ...raw, gameTime: 999 })).toThrow(/integrity/i);
	});

	test("an envelope grafted from another snapshot fails validation", () => {
		const mine = serializeWorld(populated()) as {
			galaxies: Record<string, unknown>[];
		};
		const theirs = serializeWorld(underRepair()) as {
			galaxies: Record<string, unknown>[];
		};
		const grafted = {
			...mine,
			galaxies: mine.galaxies.map((g, i) => (i === 0 ? theirs.galaxies[0] : g)),
		};
		expect(() => parseWorld(grafted)).toThrow(/integrity/i);
	});

	test("an embedded galaxy index must match its slot", () => {
		const raw = serializeWorld(newWorld(WORLD)) as {
			galaxies: Record<string, unknown>[];
		};
		raw.galaxies[2].galaxyIndex = 5;
		expect(() => parseWorld(raw)).toThrow(/galaxyIndex/i);
	});

	test("a truncated domain fails rather than reading as absent rows", () => {
		const raw = serializeWorld(populated()) as {
			galaxies: Record<string, unknown>[];
		};
		delete raw.galaxies[0].knowledge;
		expect(() => parseWorld(raw)).toThrow(/knowledge/i);
	});

	test("visited out of ascending order is rejected, not normalised", () => {
		const raw = serializeWorld(visit(visit(newWorld(WORLD), 0, 3), 0, 11)) as {
			galaxies: Record<string, unknown>[];
		};
		raw.galaxies[0].visited = [11, 3];
		// Silently re-sorting is what made the integrity hash agree with itself:
		// the check ran over what parsing produced rather than what arrived.
		expect(() => parseWorld(raw)).toThrow(/ascending/i);
	});

	test("a re-ordered carrier map fails the hash rather than being re-sorted", () => {
		const raw = serializeWorld(populated()) as {
			galaxies: { objective: Record<string, unknown> }[];
		};
		const objective = raw.galaxies[0].objective;
		const keys = Object.keys(objective);
		expect(keys).toEqual([KEY, OTHER]);
		raw.galaxies[0].objective = {
			[OTHER]: objective[OTHER],
			[KEY]: objective[KEY],
		};
		// Nothing about this save is malformed — it is the same state written in
		// a different order. Hashing the *re-canonicalised* model could not see
		// it, because canonicalisation sorted it back before the hash ran: the
		// check agreed with itself by construction. Hashing what arrived is what
		// makes it visible.
		expect(() => parseWorld(raw)).toThrow(/integrity/i);
	});

	test("an operational row carrying a live recovery is rejected", () => {
		const raw = serializeWorld(underRepair()) as {
			galaxies: { objective: Record<string, { condition: string }> }[];
		};
		// `isDue` can never fire a descriptor on an operational carrier, so the
		// recovery would be immortal and `effectiveCarrier` would keep handing
		// it back.
		raw.galaxies[0].objective[KEY].condition = "operational";
		expect(() => parseWorld(raw)).toThrow(/recovery descriptor/);
	});

	test("an ordinal that is not a count is rejected", () => {
		const raw = serializeWorld(populated()) as {
			galaxies: { objective: Record<string, { instanceOrdinal: number }> }[];
		};
		// `num` alone took `-2.5`, and `materialized` then handed back `-1.5` —
		// an instance ordinal no writer can produce.
		raw.galaxies[0].objective[OTHER].instanceOrdinal = -2.5;
		expect(() => parseWorld(raw)).toThrow(/non-negative integer/);
	});

	test("a recovery that completes before it starts is rejected", () => {
		const raw = serializeWorld(underRepair()) as {
			galaxies: {
				objective: Record<string, { recovery: { completesAt: number } }>;
			}[];
		};
		raw.galaxies[0].objective[KEY].recovery.completesAt = 5;
		expect(() => parseWorld(raw)).toThrow(/started at/);
	});

	test("a missing integrity field is named, not diagnosed as a mismatch", () => {
		const raw = serializeWorld(populated()) as Record<string, unknown>;
		// §7 asks truncation to be reported as truncation. Reporting it as
		// "re-encoded, re-ordered, or assembled from more than one save" sends
		// whoever debugs the save after the wrong fault.
		delete raw.integrity;
		expect(() => parseWorld(raw)).toThrow(/integrity field is missing/);
	});

	test("a malformed row fails loudly", () => {
		const raw = serializeWorld(populated()) as {
			galaxies: { objective: Record<string, unknown> }[];
		};
		raw.galaxies[0].objective[KEY] = { condition: "melted" };
		expect(() => parseWorld(raw)).toThrow(/condition/i);
	});

	test("an objective row with no causal episode is rejected", () => {
		const raw = serializeWorld(underRepair()) as {
			galaxies: { episodes: Record<string, unknown> }[];
		};
		// Materializing the completion would have produced no transition fact and
		// no closure — the row would go operational and the causal summary §6
		// promises would simply be absent.
		raw.galaxies[0].episodes = {};
		expect(() => parseWorld(raw)).toThrow(/no causal episode/);
	});

	test("a version mismatch names the migration, not the shape", () => {
		const raw = serializeWorld(newWorld(WORLD)) as Record<string, unknown> & {
			galaxies: Record<string, unknown>[];
		};
		// A *later* save adds a domain — the next version number rather than a
		// literal one, because #364's scan record moved this constant to 3 and a
		// fixture hardcoding "the future" goes stale the moment the shape does.
		// Checking the shape first made it die as "factionInfluence is not a
		// declared state domain", which tells the save/load node nothing about
		// what to run.
		const next = WORLD_SCHEMA_VERSION + 1;
		raw.worldSchemaVersion = next;
		raw.galaxies[0].factionInfluence = { "3": 0.4 };
		expect(() => parseWorld(raw)).toThrow(
			new RegExp(`worldSchemaVersion ${next} needs a migration`),
		);
		// **And at the top level.** The first fix moved the version read ahead of
		// the *envelope* loops only, leaving the declared-field loop in front of
		// it — so a v3 save adding a top-level field still died with exactly the
		// error the move was meant to stop. This is the case that check missed.
		const topLevel = serializeWorld(newWorld(WORLD)) as Record<string, unknown>;
		topLevel.worldSchemaVersion = next;
		topLevel.shipLog = [];
		expect(() => parseWorld(topLevel)).toThrow(
			new RegExp(`worldSchemaVersion ${next} needs a migration`),
		);
		const older = serializeWorld(newWorld(WORLD)) as Record<string, unknown>;
		older.worldGeneratorVersion = 0;
		expect(() => parseWorld(older)).toThrow(
			/worldGeneratorVersion 0 needs a migration/,
		);
	});

	test("a truncated galaxy list fails", () => {
		const raw = serializeWorld(newWorld(WORLD)) as { galaxies: unknown[] };
		raw.galaxies = raw.galaxies.slice(0, 7);
		expect(() => parseWorld(raw)).toThrow(/eight|8/i);
	});
});
