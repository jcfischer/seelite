/**
 * How often a pilot with the Long-Range Scanner finds a live derelict — node
 * #775, `salvage.md` S16.
 *
 *   bun run scripts/measure-derelict-pacing.ts              # seeds 42, 47, 7
 *   bun run scripts/measure-derelict-pacing.ts 42 47 7 56
 *
 * The principal's figure (2026-10-07) is a wreck on about 20% of system visits,
 * from a new commander's first visit on. The Sweep reads every derelict slot
 * with no distance gate (`sweepSources`), so the share of galaxy 0's systems
 * holding at least one `destroyed` derelict at a game time **is** the per-visit
 * sweep rate at that time, on the node's assumption that visits are spread
 * uniformly over game time. The tables:
 *
 * - **The share by game time**, per seed, read through `effectiveDerelict` on
 *   an untouched world, beside the expectation the S16 figures give for that
 *   seed's slot counts. The node gates every cell at 0, 1, 4, 24, 100 and 300 h
 *   on 20% ± 5 points; the other columns are context. At 256 systems one cell's
 *   sampling spread is about 2.5 points, so a cell is a draw and the
 *   expectation is the figure the tuning aims at.
 * - **The first session**: the share averaged over the first 2 h, every five
 *   minutes — the figure that read 5–7% before this node.
 * - **A return visit**: the share holding a wreck a day or two after a visit
 *   that found one, against the share at all. Close together is what O2's
 *   "close to an independent roll" means.
 * - **The passive cue**, reported and not gated: whether an arrive-and-dock
 *   visit passes within `RELAY_SIGNAL_RANGE_KM` of a live wreck. The visit is
 *   the straight segment from the new-game arrival point to the trade station,
 *   with every body where it is at the visit's time — a real flight takes
 *   minutes and does not fly straight, so this is the geometry of the visit,
 *   not a flown one.
 *
 * Headless: no renderer, no browser. Every figure goes through `finite`, which
 * throws on a non-finite value (#7).
 */
// glossary-ignore: slot
import {
	DERELICT_GAP_S,
	DERELICT_SALVAGER_S,
	derelictSlots,
} from "../src/derelict-slots";
import { derelictPose } from "../src/derelict";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import { RELAY_SIGNAL_RANGE_KM } from "../src/pirate-relay";
import { makeSystem, type System } from "../src/sim";
import { arrivalPoint, placeBodies } from "../src/system";
import { add, dot, length, scale, sub, type Vec3 } from "../src/vec3";
import {
	effectiveDerelict,
	newWorld,
	type WorldState,
} from "../src/world-state";

const HOUR = 3600;
const G = 0;
const GATED_H = [0, 1, 4, 24, 100, 300];
const TIMES_H = [0, 1, 2, 4, 8, 24, 48, 100, 200, 300];
const RETURN_H = [24, 48];

const finite = (n: number, what: string): number => {
	if (!Number.isFinite(n)) throw new Error(`${what} is ${n}`);
	return n;
};
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

const seeds = (
	process.argv.length > 2 ? process.argv.slice(2) : ["42", "47", "7"]
).map((s) => finite(Number(s), `seed ${s}`));

/** One slot's long-run share adrift, from the S16 figures alone. */
const slotShare = finite(
	DERELICT_SALVAGER_S /
		(DERELICT_SALVAGER_S + (DERELICT_GAP_S[0] + DERELICT_GAP_S[1]) / 2),
	"slot share",
);

const liveKeys = (world: WorldState, record: SystemRecord, at: number) =>
	derelictSlots(record.index, record.government).flatMap(({ key }) => {
		const e = effectiveDerelict(world, G, key, at);
		return e.condition === "destroyed"
			? [{ key, ordinal: e.instanceOrdinal }]
			: [];
	});

const segmentKm = (p: Vec3, a: Vec3, b: Vec3): number => {
	const ab = sub(b, a);
	const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
	return length(sub(p, add(a, scale(ab, t))));
};

interface SeedRun {
	seed: number;
	expected: number;
	byTime: number[];
	firstSession: number;
	returning: { base: number; again: number[] };
	cue: { visits: number; withWreck: number; cued: number };
	adriftAtZero: { slots: number; adrift: number; lostBeforeZero: number };
}

function measure(seed: number): SeedRun {
	const world = newWorld(seed);
	const records = generateGalaxy(seed, G).systems;
	const has = (record: SystemRecord, at: number) =>
		liveKeys(world, record, at).length > 0;
	const share = (at: number) =>
		finite(
			records.filter((r) => has(r, at)).length / records.length,
			`share at ${at}`,
		);

	const expected = finite(
		records.reduce(
			(sum, r) =>
				sum +
				1 -
				(1 - slotShare) ** derelictSlots(r.index, r.government).length,
			0,
		) / records.length,
		"expected",
	);

	const byTime = TIMES_H.map((h) => share(h * HOUR));

	const session: number[] = [];
	for (let m = 0; m <= 120; m += 5) session.push(share(m * 60));
	const firstSession = session.reduce((a, b) => a + b, 0) / session.length;

	// A visit every ten hours over the first 300; each that finds a wreck is
	// read again a day and two days on.
	let found = 0;
	let visits = 0;
	const again = RETURN_H.map(() => 0);
	for (let h = 0; h < 300; h += 10)
		for (const r of records) {
			visits++;
			if (!has(r, h * HOUR)) continue;
			found++;
			RETURN_H.forEach((d, i) => {
				if (has(r, (h + d) * HOUR)) again[i]++;
			});
		}

	const cue = { visits: 0, withWreck: 0, cued: 0 };
	const systems = new Map<number, System>();
	for (const h of TIMES_H)
		for (const r of records) {
			const at = h * HOUR;
			const trade = makeSystemOnce(systems, r).contents.stations.find(
				(s) => s.type === "trade",
			);
			if (!trade) continue;
			cue.visits++;
			const live = liveKeys(world, r, at);
			if (!live.length) continue;
			cue.withWreck++;
			const system = makeSystemOnce(systems, r);
			const from = arrivalPoint(r, system.contents, null, at);
			const dock = placeBodies(system.contents, at).find(
				(b) => b.id === trade.id,
			);
			if (!dock)
				throw new Error(`${r.name}: trade station ${trade.id} is not placed`);
			if (
				live.some(
					({ key, ordinal }) =>
						segmentKm(
							derelictPose(system, key, ordinal, at).pos,
							from,
							dock.pos,
						) <= RELAY_SIGNAL_RANGE_KM,
				)
			)
				cue.cued++;
		}

	const adriftAtZero = { slots: 0, adrift: 0, lostBeforeZero: 0 };
	for (const r of records)
		for (const { key } of derelictSlots(r.index, r.government)) {
			adriftAtZero.slots++;
			const e = effectiveDerelict(world, G, key, 0);
			if (e.condition !== "destroyed") continue;
			adriftAtZero.adrift++;
			if (e.lostAt < 0) adriftAtZero.lostBeforeZero++;
		}

	return {
		seed,
		expected,
		byTime,
		firstSession: finite(firstSession, "first session"),
		returning: {
			base: finite(found / visits, "base"),
			again: again.map((n, i) => finite(n / found, `again ${RETURN_H[i]}`)),
		},
		cue,
		adriftAtZero,
	};
}

function makeSystemOnce(
	cache: Map<number, System>,
	record: SystemRecord,
): System {
	let system = cache.get(record.index);
	if (!system) {
		system = makeSystem(record, 0);
		cache.set(record.index, system);
	}
	return system;
}

const runs = seeds.map(measure);

console.log(
	`S16: adrift ${DERELICT_SALVAGER_S / HOUR} h, gap ${DERELICT_GAP_S[0] / HOUR}–${DERELICT_GAP_S[1] / HOUR} h → one slot adrift ${pct(slotShare)} of the time`,
);
console.log("");
console.log(
	"Systems in galaxy 0 holding a live derelict (the per-visit sweep rate)",
);
console.log(
	`seed  expected  ${TIMES_H.map((h) => `${h} h`.padStart(6)).join(" ")}   first 2 h`,
);
for (const r of runs)
	console.log(
		`${String(r.seed).padStart(4)}  ${pct(r.expected).padStart(8)}  ${r.byTime.map((x) => pct(x).padStart(6)).join(" ")}   ${pct(r.firstSession).padStart(9)}`,
	);
const pooled = TIMES_H.map(
	(_, i) => runs.reduce((sum, r) => sum + r.byTime[i], 0) / runs.length,
);
console.log(
	`${"pooled".padStart(4)}  ${pct(runs.reduce((s, r) => s + r.expected, 0) / runs.length).padStart(8)}  ${pooled.map((x) => pct(x).padStart(6)).join(" ")}   ${pct(runs.reduce((s, r) => s + r.firstSession, 0) / runs.length).padStart(9)}`,
);
// One cell's binomial spread at the target, so a cell outside the band can be
// read as a draw or as a bias.
const sigma = (n: number) => Math.sqrt((0.2 * 0.8) / n);
console.log(
	`one cell's sampling spread at 20%: ${(100 * sigma(256)).toFixed(1)} points per seed, ${(100 * sigma(256 * runs.length)).toFixed(1)} pooled over ${runs.length}`,
);
const band = (x: number) => Math.abs(x - 0.2) <= 0.05;
const cells = runs.flatMap((r) =>
	GATED_H.map((h) => ({ seed: r.seed, h, x: r.byTime[TIMES_H.indexOf(h)] })),
);
const outside = cells.filter(({ x }) => !band(x));
console.log(
	`gate per seed (${GATED_H.join(", ")} h, 20% ± 5 points): ${outside.length === 0 ? `all ${cells.length} cells inside` : `${outside.length} of ${cells.length} cells OUTSIDE — ${outside.map(({ seed, h, x }) => `seed ${seed} at ${h} h reads ${pct(x)}`).join("; ")}`}`,
);
const pooledOutside = GATED_H.filter((h) => !band(pooled[TIMES_H.indexOf(h)]));
console.log(
	`gate pooled: ${pooledOutside.length === 0 ? `all ${GATED_H.length} times inside` : `OUTSIDE at ${pooledOutside.map((h) => `${h} h`).join(", ")}`}`,
);

console.log("");
console.log("No ramp: slots adrift as the clock starts");
for (const r of runs) {
	const z = r.adriftAtZero;
	console.log(
		`${String(r.seed).padStart(4)}  ${z.adrift} of ${z.slots} slots adrift at 0 h (${pct(z.adrift / z.slots)}), ${z.lostBeforeZero} of them lost before the clock started`,
	);
}

console.log("");
console.log(
	"A return visit: a wreck found, read again later (visits every 10 h over 300 h)",
);
console.log(
	`seed  any visit  ${RETURN_H.map((d) => `+${d} h`.padStart(7)).join("  ")}`,
);
for (const r of runs)
	console.log(
		`${String(r.seed).padStart(4)}  ${pct(r.returning.base).padStart(9)}  ${r.returning.again.map((x) => pct(x).padStart(7)).join("  ")}`,
	);

console.log("");
console.log(
	`The passive cue on an arrive-and-dock visit (within ${RELAY_SIGNAL_RANGE_KM.toLocaleString("en")} km of the arrival-to-trade-station segment; reported, not gated)`,
);
console.log(
	"seed  visits  with a wreck  cued   of all visits  of visits with a wreck",
);
for (const r of runs) {
	const c = r.cue;
	console.log(
		`${String(r.seed).padStart(4)}  ${String(c.visits).padStart(6)}  ${String(c.withWreck).padStart(12)}  ${String(c.cued).padStart(5)}  ${pct(c.cued / c.visits).padStart(13)}  ${(c.withWreck ? pct(c.cued / c.withWreck) : "—").padStart(23)}`,
	);
}
