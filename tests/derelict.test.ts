/**
 * Node #731: the derelict row — government-keyed slots, a seeded loss schedule,
 * derived contents pinned on first touch, and the save (`salvage.md` S1, S2, S6,
 * S16, S18's draw, S21).
 *
 * The test seam is the world-state API and the save envelope: what a slot reads
 * at a game time, what the two writers leave on its row, and what survives a
 * round trip or is refused at the parse.
 */
// glossary-ignore: slot

import { describe, expect, test } from "bun:test";
import { type CarrierKey, carrierKey } from "../src/carrier-key";
import {
	DERELICT_FIRST_LOSS_S,
	DERELICT_FITTING_CHANCE,
	DERELICT_FITTINGS,
	DERELICT_GAP_S,
	DERELICT_MAX_CONTAINERS,
	DERELICT_SALVAGER_S,
	derelictContents,
	derelictFirstLossAt,
	derelictGapS,
	derelictSlotCount,
	derelictSlots,
} from "../src/derelict-slots";
import { DOMAIN } from "../src/domains";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import { COMMODITIES, EQUIPMENT } from "../src/market";
import { fnv1a } from "../src/rng";
import {
	LEGACY_SAVE_SCHEMA_VERSIONS,
	newCommanderRecord,
	parseSave,
	SAVE_SCHEMA_VERSION,
	serializeSave,
} from "../src/save-envelope";
import {
	advanceTo,
	type EffectiveDerelict,
	effectiveDerelict,
	enumerateCarriers,
	materializeDerelict,
	newWorld,
	OTHER_SALVAGERS,
	PLAYER_SALVAGE,
	parseWorld,
	scoopDerelict,
	serializeWorld,
	type WorldState,
} from "../src/world-state";

const WORLD = 0x5ee11e;
const G = 0;
const HOUR = 3600;
const SYSTEMS = generateGalaxy(WORLD, G).systems;
const systemOf = (government: number): SystemRecord => {
	const found = SYSTEMS.find((s) => s.government === government);
	if (!found) throw new Error(`no government ${government} system`);
	return found;
};
/** An Anarchy: three slots. */
const ANARCHY = systemOf(0);
const KEY = carrierKey(ANARCHY.index, "derelict-00");

const adrift = (e: EffectiveDerelict) => {
	if (e.condition !== "destroyed")
		throw new Error(`expected an instance adrift, read ${e.condition}`);
	return e;
};

/** The slot's first loss, read off the world rather than restated. */
const firstLoss = (key: CarrierKey = KEY): number => {
	const e = effectiveDerelict(newWorld(WORLD), G, key, 0);
	return e.condition === "empty" ? e.firstLossAt : 0;
};

/** Every container scooped out, one after another, at `at`. */
const strip = (world: WorldState, key: CarrierKey, at: number): WorldState => {
	const e = adrift(effectiveDerelict(world, G, key, at));
	let w = world;
	e.containers.forEach((c, i) => {
		if (c.left > 0) w = scoopDerelict(w, G, key, i, c.left, at);
	});
	return w;
};

const resealedSave = (
	raw: unknown,
	edit: (body: Record<string, any>) => void,
): unknown => {
	const { integrity: _, ...body } = JSON.parse(JSON.stringify(raw));
	edit(body);
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

const resealedWorld = (
	world: WorldState,
	edit: (body: Record<string, any>) => void,
): unknown => resealedSave(serializeWorld(world), edit);

// ---------------------------------------------------------------------------

describe("S21 — the slots", () => {
	test("3 slots for governments 0–2, 2 for 3–5, 1 for 6–7", () => {
		expect([0, 1, 2, 3, 4, 5, 6, 7].map(derelictSlotCount)).toEqual([
			3, 3, 3, 2, 2, 2, 1, 1,
		]);
	});

	test("every system's carrier set yields its government's slots, each with a stable key", () => {
		const bySystem = new Map<number, string[]>();
		for (const c of enumerateCarriers(WORLD, G))
			if (c.kind === "derelict") {
				expect(c.parentId).toBeNull();
				expect(c.key).toBe(carrierKey(c.systemIndex, c.localCarrierId));
				bySystem.set(c.systemIndex, [
					...(bySystem.get(c.systemIndex) ?? []),
					c.localCarrierId,
				]);
			}
		for (const record of SYSTEMS)
			expect(bySystem.get(record.index)).toEqual(
				derelictSlots(record.index, record.government).map(
					(s) => s.localCarrierId,
				),
			);
	});

	test("the persistence ids are pinned", () => {
		// A rename here is a save migration, not a refactor.
		expect(derelictSlots(5, 0).map((s) => s.key)).toEqual([
			"5:derelict-00",
			"5:derelict-01",
			"5:derelict-02",
		] as CarrierKey[]);
		expect(derelictSlots(5, 7).map((s) => s.key)).toEqual([
			"5:derelict-00",
		] as CarrierKey[]);
	});

	test("a key the system does not hold is not a derelict slot", () => {
		const lawful = systemOf(7);
		const world = newWorld(WORLD);
		expect(() =>
			effectiveDerelict(world, G, carrierKey(lawful.index, "derelict-01"), 0),
		).toThrow("is not a derelict slot");
		expect(() =>
			effectiveDerelict(world, G, carrierKey(lawful.index, "raider-00"), 0),
		).toThrow("is not a derelict slot");
	});
});

describe("S16 — the schedule, derived from the clock", () => {
	test("empty before the first loss, adrift from it, salvaged by others at 72 h", () => {
		const world = newWorld(WORLD);
		const lostAt = firstLoss();
		expect(lostAt).toBeGreaterThanOrEqual(0);
		expect(lostAt).toBeLessThan(48 * HOUR);
		expect(effectiveDerelict(world, G, KEY, lostAt - 1e-6).condition).toBe(
			"empty",
		);
		const at = adrift(effectiveDerelict(world, G, KEY, lostAt));
		expect(at.instanceOrdinal).toBe(0);
		expect(at.lostAt).toBe(lostAt);
		expect(at.salvagerAt).toBe(lostAt + 72 * HOUR);
		expect(
			effectiveDerelict(world, G, KEY, lostAt + 72 * HOUR - 1e-6).condition,
		).toBe("destroyed");
		const taken = effectiveDerelict(world, G, KEY, lostAt + 72 * HOUR);
		if (taken.condition !== "salvaged") throw new Error(taken.condition);
		// No player provenance: other salvagers, off the clock.
		expect(taken.cause).toEqual(OTHER_SALVAGERS);
		expect(taken.cause.playerRole).toBe("none");
		expect(taken.salvagedAt).toBe(lostAt + 72 * HOUR);
		const gap = taken.nextLossAt - taken.salvagedAt;
		expect(gap).toBeGreaterThanOrEqual(6 * HOUR);
		expect(gap).toBeLessThanOrEqual(24 * HOUR);
		const next = adrift(effectiveDerelict(world, G, KEY, taken.nextLossAt));
		expect(next.instanceOrdinal).toBe(1);
		expect(next.lostAt).toBe(taken.nextLossAt);
	});

	test("the §5 figures are the named constants", () => {
		expect(DERELICT_FIRST_LOSS_S).toBe(48 * HOUR);
		expect(DERELICT_GAP_S).toEqual([6 * HOUR, 24 * HOUR]);
		expect(DERELICT_SALVAGER_S).toBe(72 * HOUR);
		expect(DERELICT_FITTING_CHANCE).toBe(0.25);
	});

	test("first losses spread over the first 48 h and gaps over 6–24 h, across every slot", () => {
		const first: number[] = [];
		const gaps: number[] = [];
		for (const record of SYSTEMS)
			for (const slot of derelictSlots(record.index, record.government)) {
				first.push(derelictFirstLossAt(record.seed, slot.key));
				for (let k = 0; k < 4; k++)
					gaps.push(derelictGapS(record.seed, slot.key, k));
			}
		expect(Math.min(...first)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...first)).toBeLessThan(48 * HOUR);
		// Spread, not bunched: both halves of the window are used.
		expect(first.filter((t) => t < 24 * HOUR).length).toBeGreaterThan(
			first.length / 3,
		);
		expect(first.filter((t) => t >= 24 * HOUR).length).toBeGreaterThan(
			first.length / 3,
		);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6 * HOUR);
		expect(Math.max(...gaps)).toBeLessThanOrEqual(24 * HOUR);
	});

	test("a read writes nothing, and no tick is needed to reach a later instance", () => {
		const world = newWorld(WORLD);
		const before = JSON.stringify(serializeWorld(world));
		const t = 30 * 24 * HOUR;
		const late = effectiveDerelict(world, G, KEY, t);
		// Thirty days hold several instances' lives, and none was ticked.
		expect(
			late.condition === "empty" ? 0 : late.instanceOrdinal,
		).toBeGreaterThan(3);
		// A clock moved there, with every lazy write `advanceTo` makes, reads the
		// same: the schedule is the clock's, not something a write discovered.
		expect(effectiveDerelict(advanceTo(world, t), G, KEY, t)).toEqual(late);
		expect(JSON.stringify(serializeWorld(world))).toBe(before);
		expect(advanceTo(world, t).galaxies[G].derelicts).toEqual({});
	});
});

describe("S6 — the contents, drawn per instance and stored on first touch", () => {
	test("1–4 manifest lines, at most five containers, a fitting in about 25%", () => {
		const fittings = new Set(DERELICT_FITTINGS);
		let instances = 0;
		let withFitting = 0;
		for (const record of SYSTEMS)
			for (const slot of derelictSlots(record.index, record.government))
				for (let k = 0; k < 4; k++) {
					const c = derelictContents(
						record.seed,
						record.government,
						slot.key,
						k,
					);
					instances++;
					const goods = c.filter((x) => x.kind === "good");
					const fitted = c.filter((x) => x.kind === "fitting");
					expect(goods.length).toBeGreaterThanOrEqual(1);
					expect(goods.length).toBeLessThanOrEqual(4);
					expect(fitted.length).toBeLessThanOrEqual(1);
					expect(c.length).toBeLessThanOrEqual(DERELICT_MAX_CONTAINERS);
					// The fitting, when there is one, is the last container.
					if (fitted.length) {
						withFitting++;
						expect(c[c.length - 1].kind).toBe("fitting");
						expect(fittings.has(fitted[0].id)).toBe(true);
					}
					expect(new Set(goods.map((x) => x.id)).size).toBe(goods.length);
					for (const x of c) expect(x.tonnes).toBeGreaterThan(0);
				}
		const share = withFitting / instances;
		expect(share).toBeGreaterThan(0.22);
		expect(share).toBeLessThan(0.28);
	});

	test("its own DOMAIN tag, distinct from the schedule's", () => {
		expect(DOMAIN.DERELICT_CONTENTS).toBe(32);
		expect(DOMAIN.DERELICT_SCHEDULE).toBe(31);
	});

	test("every fitting is a module the market sells, and the list is append-only", () => {
		const names = new Set(EQUIPMENT.map((e) => e.name));
		for (const id of DERELICT_FITTINGS) expect(names.has(id)).toBe(true);
		// Pinned by position: a stored id must name one module forever. Append
		// below this prefix; never reorder or remove.
		expect(DERELICT_FITTINGS.slice(0, 12)).toEqual([
			"Extra Pulse Laser",
			"E.C.M. System",
			"Extra Beam Laser",
			"Escape Pod",
			"Energy Bomb",
			"Docking Computer",
			"Fuel Scoops",
			"Mining Laser",
			"Extra Energy Unit",
			"Military Laser",
			"Identity Scanner",
			"Long-Range Scanner",
		]);
	});

	test("a loss's contents are stored on the row as (id, tonnes left) per container", () => {
		const lostAt = firstLoss();
		const drawn = adrift(
			effectiveDerelict(newWorld(WORLD), G, KEY, lostAt),
		).containers;
		expect(drawn).toEqual(
			derelictContents(ANARCHY.seed, ANARCHY.government, KEY, 0).map((c) => ({
				...c,
				left: c.tonnes,
			})),
		);
		const world = materializeDerelict(newWorld(WORLD), G, KEY, lostAt + 10);
		const row = world.galaxies[G].derelicts[KEY];
		expect(row.instanceOrdinal).toBe(0);
		expect(row.lostAt).toBe(lostAt);
		expect(row.containers).toEqual(drawn);
		expect(row.salvaged).toBeUndefined();
		const read = adrift(effectiveDerelict(world, G, KEY, lostAt + 20));
		expect(read.stored).toBe(true);
		expect(read.containers).toEqual(drawn);
		// Materializing an empty slot writes nothing.
		expect(
			materializeDerelict(newWorld(WORLD), G, KEY, lostAt / 2).galaxies[G]
				.derelicts,
		).toEqual({});
	});

	test("an appended module or a changed draw never changes a stored instance", () => {
		// Find an instance whose fitting the append would move: the uniform pick
		// over a longer list lands elsewhere for most instances.
		const appended = [...DERELICT_FITTINGS, "A Module Not Yet Written"];
		let key: CarrierKey | undefined;
		let record: SystemRecord | undefined;
		for (const r of SYSTEMS) {
			for (const slot of derelictSlots(r.index, r.government)) {
				const now = derelictContents(r.seed, r.government, slot.key, 0);
				const later = derelictContents(
					r.seed,
					r.government,
					slot.key,
					0,
					appended,
				);
				if (JSON.stringify(now) !== JSON.stringify(later)) {
					key = slot.key;
					record = r;
					break;
				}
			}
			if (key) break;
		}
		if (!key || !record) throw new Error("no instance the append moves");
		// The draw moves under an append: this is what storing protects against.
		const lostAt = firstLoss(key);
		const world = materializeDerelict(newWorld(WORLD), G, key, lostAt);
		const stored = world.galaxies[G].derelicts[key].containers;
		const other = DERELICT_FITTINGS.find((id) => id !== stored.at(-1)?.id);
		if (!other) throw new Error("one fitting on the list");
		// What the read returns is the row, not the draw: a row that differs
		// from every draw — as one would after the draw changed — reads as
		// itself, through a save.
		const edited = resealedWorld(world, (body) => {
			const row = body.galaxies[G].derelicts[key as string];
			const last = String(Object.keys(row.containers).length - 1);
			row.containers[last] = {
				kind: "fitting",
				id: other,
				tonnes: 1,
				left: 1,
			};
		});
		const reloaded = parseWorld(edited);
		const read = adrift(effectiveDerelict(reloaded, G, key, lostAt + 1));
		expect(read.stored).toBe(true);
		expect(read.containers.at(-1)).toEqual({
			kind: "fitting",
			id: other,
			tonnes: 1,
			left: 1,
		});
		expect(read.containers.slice(0, -1)).toEqual(stored.slice(0, -1));
	});
});

describe("S2 — the strip, and the next loss after it", () => {
	test("scooping every container to zero writes salvaged with the pilot's provenance", () => {
		const lostAt = firstLoss();
		const at = lostAt + 5 * HOUR;
		const world = strip(newWorld(WORLD), KEY, at);
		const row = world.galaxies[G].derelicts[KEY];
		expect(row.containers.every((c) => c.left === 0)).toBe(true);
		expect(row.salvaged).toEqual({ at, cause: PLAYER_SALVAGE });
		expect(PLAYER_SALVAGE.playerRole).not.toBe("none");
		const read = effectiveDerelict(world, G, KEY, at);
		if (read.condition !== "salvaged") throw new Error(read.condition);
		expect(read.cause).toEqual(PLAYER_SALVAGE);
		// Scheduled from the strip, not from the salvagers' 72 h.
		expect(read.nextLossAt).toBe(at + derelictGapS(ANARCHY.seed, KEY, 0));
		const next = adrift(effectiveDerelict(world, G, KEY, read.nextLossAt));
		expect(next.instanceOrdinal).toBe(1);
		expect(next.stored).toBe(false);
		expect(next.containers).toEqual(
			derelictContents(ANARCHY.seed, ANARCHY.government, KEY, 1).map((c) => ({
				...c,
				left: c.tonnes,
			})),
		);
	});

	test("a partial scoop leaves the rest, and the salvagers still come at 72 h", () => {
		const lostAt = firstLoss();
		const world = scoopDerelict(newWorld(WORLD), G, KEY, 0, 1, lostAt + 1);
		const row = world.galaxies[G].derelicts[KEY];
		expect(row.containers[0].left).toBe(row.containers[0].tonnes - 1);
		expect(row.salvaged).toBeUndefined();
		const taken = effectiveDerelict(world, G, KEY, lostAt + 72 * HOUR);
		if (taken.condition !== "salvaged") throw new Error(taken.condition);
		expect(taken.cause).toEqual(OTHER_SALVAGERS);
	});

	test("a scoop refuses by name what the instance cannot give", () => {
		const lostAt = firstLoss();
		const world = newWorld(WORLD);
		expect(() => scoopDerelict(world, G, KEY, 0, 1, lostAt / 2)).toThrow(
			"is empty; nothing is adrift",
		);
		const n = adrift(effectiveDerelict(world, G, KEY, lostAt)).containers
			.length;
		expect(() => scoopDerelict(world, G, KEY, n, 1, lostAt)).toThrow(
			`container ${n} is unknown`,
		);
		const first = adrift(effectiveDerelict(world, G, KEY, lostAt))
			.containers[0];
		expect(() =>
			scoopDerelict(world, G, KEY, 0, first.tonnes + 1, lostAt),
		).toThrow(`holds ${first.tonnes} t`);
		expect(() => scoopDerelict(world, G, KEY, 0, 0.5, lostAt)).toThrow(
			"not a whole number",
		);
		const stripped = strip(world, KEY, lostAt);
		expect(() => scoopDerelict(stripped, G, KEY, 0, 1, lostAt)).toThrow(
			"is salvaged; nothing is adrift",
		);
	});
});

describe("§6 — one row per derelict slot, however long the galaxy is played", () => {
	test("a hundred days of meeting and stripping every wreck in five systems", () => {
		const records = SYSTEMS.slice(0, 5);
		const keys = records.flatMap((r) =>
			derelictSlots(r.index, r.government).map((s) => s.key),
		);
		let world = newWorld(WORLD);
		const end = 100 * 24 * HOUR;
		for (let t = 0; t < end; t += 5 * HOUR)
			for (const [i, key] of keys.entries()) {
				const e = effectiveDerelict(world, G, key, t);
				if (e.condition !== "destroyed") continue;
				// Half are stripped, half only met: both writers, many instances.
				world =
					i % 2 === 0
						? strip(world, key, t)
						: materializeDerelict(world, G, key, t);
			}
		const rows = Object.keys(world.galaxies[G].derelicts);
		expect(rows.length).toBeLessThanOrEqual(keys.length);
		for (const key of rows) expect(keys).toContain(key as CarrierKey);
		// Many instances passed through those rows.
		const ordinals = Object.values(world.galaxies[G].derelicts).map(
			(r) => r.instanceOrdinal,
		);
		expect(Math.max(...ordinals)).toBeGreaterThan(10);
	});
});

describe("the save", () => {
	const stripped = () => {
		const lostAt = firstLoss();
		let world = scoopDerelict(newWorld(WORLD), G, KEY, 0, 1, lostAt + 1);
		const other = carrierKey(ANARCHY.index, "derelict-01");
		world = strip(world, other, Math.max(lostAt + 1, firstLoss(other)));
		return world;
	};

	test("every container's id and tonnes left survive the round trip", () => {
		const world = stripped();
		const commander = newCommanderRecord("courier");
		const loaded = parseSave(serializeSave({ world, commander }));
		expect(loaded.world.galaxies[G].derelicts).toEqual(
			world.galaxies[G].derelicts,
		);
		expect(loaded.world).toEqual(world);
		expect(parseWorld(serializeWorld(world))).toEqual(world);
	});

	test("the schema is 12, and 8 is still read", () => {
		// A literal, so the next bump has to come through here.
		expect(SAVE_SCHEMA_VERSION).toBe(12);
		expect([...LEGACY_SAVE_SCHEMA_VERSIONS]).toEqual([
			2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
		]);
	});

	test("an untouched world writes no derelict domain, so an older world's bytes still hash", () => {
		const raw = serializeWorld(newWorld(WORLD)) as { galaxies: object[] };
		for (const g of raw.galaxies) expect("derelicts" in g).toBe(false);
	});

	test("a version 8 save migrates with every slot unvisited", () => {
		const commander = newCommanderRecord("courier");
		const v8 = resealedSave(
			serializeSave({ world: newWorld(WORLD), commander }),
			(body) => {
				body.saveSchemaVersion = 8;
				delete body.commander.sweepReadings;
			},
		);
		const loaded = parseSave(v8);
		for (const g of loaded.world.galaxies) expect(g.derelicts).toEqual({});
		expect(effectiveDerelict(loaded.world, G, KEY, firstLoss()).condition).toBe(
			"destroyed",
		);
	});

	test("a version 8 save carrying a derelict row was assembled, and is refused", () => {
		const v8 = resealedSave(
			serializeSave({
				world: stripped(),
				commander: newCommanderRecord("courier"),
			}),
			(body) => {
				body.saveSchemaVersion = 8;
				delete body.commander.sweepReadings;
			},
		);
		expect(() => parseSave(v8)).toThrow("derelicts is not a version 8 field");
	});
});

describe("a malformed row is refused by name", () => {
	const base = () => scoopDerelict(newWorld(WORLD), G, KEY, 0, 1, firstLoss());
	const edit = (fn: (row: Record<string, any>) => void) =>
		resealedWorld(base(), (body) => fn(body.galaxies[G].derelicts[KEY]));

	test("tonnes left above the drawn line", () => {
		const raw = edit((row) => {
			row.containers["0"].left = row.containers["0"].tonnes + 1;
		});
		expect(() => parseWorld(raw)).toThrow("above the");
	});

	test("an unknown container index", () => {
		const raw = edit((row) => {
			row.containers["7"] = { ...row.containers["0"] };
		});
		expect(() => parseWorld(raw)).toThrow("container index 7 is unknown");
		const spelled = edit((row) => {
			const n = Object.keys(row.containers).length;
			row.containers[`0${n}`] = { ...row.containers["0"] };
		});
		expect(() => parseWorld(spelled)).toThrow("is unknown");
	});

	test("more than five containers", () => {
		const raw = edit((row) => {
			for (let i = 0; i < 6; i++)
				row.containers[String(i)] = {
					kind: "good",
					id: COMMODITIES.find((c) => c.unit === "t")?.name,
					tonnes: 1,
					left: 1,
				};
		});
		expect(() => parseWorld(raw)).toThrow("a row holds 1 to 5");
	});

	test("an id no derelict can hold", () => {
		const good = edit((row) => {
			row.containers["0"].id = "Unobtainium";
		});
		expect(() => parseWorld(good)).toThrow("is not a good a derelict can hold");
		const fitting = edit((row) => {
			row.containers["0"].kind = "fitting";
		});
		expect(() => parseWorld(fitting)).toThrow(
			"is not a fitting a derelict can hold",
		);
	});

	test("a derelict slot its system does not hold", () => {
		const lawful = systemOf(7);
		for (const local of ["derelict-01", "derelict-99"]) {
			const raw = resealedWorld(base(), (body) => {
				const d = body.galaxies[G].derelicts;
				d[`${lawful.index}:${local}`] = d[KEY];
				delete d[KEY];
			});
			expect(() => parseWorld(raw)).toThrow(
				`${lawful.index}:${local} is not a derelict slot in galaxy 0`,
			);
		}
	});

	test("a strip before its loss", () => {
		const early = resealedWorld(
			strip(newWorld(WORLD), KEY, firstLoss()),
			(body) => {
				const row = body.galaxies[G].derelicts[KEY];
				row.salvaged.at = row.lostAt - 1;
			},
		);
		expect(() => parseWorld(early)).toThrow("before its loss at");
	});

	test("a strip later than today's salvager time loads, because that time is tuned", () => {
		// A row the pilot stripped under a longer salvager time must survive the
		// day the figure is shortened, so the parse does not read it.
		const late = resealedWorld(
			strip(newWorld(WORLD), KEY, firstLoss()),
			(body) => {
				const row = body.galaxies[G].derelicts[KEY];
				row.salvaged.at = row.lostAt + DERELICT_SALVAGER_S + 3600;
				body.gameTime = row.salvaged.at;
			},
		);
		const loaded = parseWorld(late);
		const at = firstLoss() + DERELICT_SALVAGER_S + 3600;
		const e = effectiveDerelict(loaded, G, KEY, at);
		expect(e.condition).toBe("salvaged");
		if (e.condition === "salvaged") {
			expect(e.salvagedAt).toBe(at);
			expect(e.cause.playerRole).toBe("direct");
		}
	});

	test("a loss before zero or after the clock", () => {
		const before = edit((row) => {
			row.lostAt = -1;
		});
		expect(() => parseWorld(before)).toThrow("outside the clock's 0 to");
		const ahead = resealedWorld(base(), (body) => {
			body.galaxies[G].derelicts[KEY].lostAt = body.gameTime + 1;
		});
		expect(() => parseWorld(ahead)).toThrow("outside the clock's 0 to");
	});

	test("a strip after the clock", () => {
		const raw = resealedWorld(
			strip(newWorld(WORLD), KEY, firstLoss()),
			(body) => {
				body.galaxies[G].derelicts[KEY].salvaged.at = body.gameTime + 1;
			},
		);
		expect(() => parseWorld(raw)).toThrow("after the clock's");
	});

	test("a key that is not a derelict slot", () => {
		const raw = resealedWorld(base(), (body) => {
			const d = body.galaxies[G].derelicts;
			d[`${ANARCHY.index}:raider-00`] = d[KEY];
			delete d[KEY];
		});
		expect(() => parseWorld(raw)).toThrow("is not a derelict slot");
	});

	test("a stripped row that is not salvaged, and a salvaged one with tonnes left", () => {
		const emptied = edit((row) => {
			for (const c of Object.values(row.containers) as { left: number }[])
				c.left = 0;
		});
		expect(() => parseWorld(emptied)).toThrow("is not salvaged");
		const early = edit((row) => {
			row.salvaged = { at: row.lostAt + 1, cause: { ...PLAYER_SALVAGE } };
		});
		expect(() => parseWorld(early)).toThrow("salvaged with tonnes still");
	});
});
