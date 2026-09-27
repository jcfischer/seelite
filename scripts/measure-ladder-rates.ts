/**
 * What each of #183's three ladders earns per hour of play — the **rates** the
 * ladder gate catalogue (#562) turns into thresholds.
 *
 *   bun run scripts/measure-ladder-rates.ts [hours] [seed]
 *
 * Rates, not thresholds: a threshold is a rate times the hours the principal
 * wants a rung to take, and those hours are the principal's answer, not this
 * file's. Sections 1–3 print every rate as a per-galaxy spread over the
 * greedy trader's own `GALAXY_LIST`, never one number; section 5 pools those
 * spreads into one median per ladder, prints the values it pooled, and derives
 * the thresholds from that median.
 *
 * 1. **Trade (D3)** — realised margin: Σ (sale − purchase basis) over market
 *    sales, read hop by hop through the trader's `onHop` observer. The trader's
 *    `earnedCr` is wealth (margin less fuel, plus equipment spent), which D3
 *    says is never read, so it is not used. Losses cannot occur here: the
 *    trader only flies a positive basket. Jobs (D3's second term) are not
 *    flown by this trader and are absent.
 * 2. **Combat (D2)** — raider encounters per hour for a pilot flying the
 *    trader's own legs: each hop is one cruise leg in the destination system,
 *    drawn through `legEncounter` with the game's own seed and ordinal rule.
 *    Two arms: the law alone, and the law with every encounter a kill whose
 *    slot is then down for `RAIDER_WRECK_S + RAIDER_REPAIR_S`. The relay's
 *    watched-route dial is not modelled (it only raises a leg's chance).
 * 3. **Exploration (D4)** — pool sizes per galaxy and first-time kinds per
 *    hour for a pilot who jumps to the nearest unvisited system and docks.
 * 4. **Threat** — three candidate forms off the hull row, and the target ÷ own
 *    ratio D2's credit is built on.
 * 5. **Thresholds** — the principal's ruling on #562 applied to 1–3: the
 *    Elo-style strength and credit-per-kill matrix that replaced D2's clamp,
 *    the rates it pools, and every ladder's eight rung thresholds. The
 *    declared inputs are the constants below; nothing else is typed in.
 */

import {
	stepCombatPrototype,
	createCombatPrototype,
	duelInputs,
} from "../src/combat-prototype";
import {
	type SystemRecord,
	SYSTEMS_PER_GALAXY,
	neighbours,
} from "../src/galaxy";
import {
	DOCKABLE_HULL_IDS,
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
} from "../src/hull";
import { fullKitCr } from "../src/market";
import { PULSE_LASER, SHIELD_POOL } from "../src/ship-condition";
import { ARMED_TRAFFIC_HULLS } from "../src/traffic-engagement";
import { RELAY_INTEGRITY } from "../src/pirate-relay";
import { RAIDER_REPAIR_S, RAIDER_WRECK_S } from "../src/raider-wreck";
import { legEncounter, raiderLegChance } from "../src/raider-slots";
import {
	GALAXY_LIST,
	type HopRecord,
	JUMP_SECONDS,
	type Port,
	type World,
	finite,
	intraSeconds,
	jumpSeconds,
	portsOf,
	run,
	START_CR,
	worldFor,
	DOCK_SECONDS,
} from "./lib/greedy-trader";

// The declared decision inputs — the principal's ruling on #562. Everything
// section 5 prints is computed from these and from sections 1–3.
/** The top rung's index: rungs run 0 to 8, nine per ladder (#183 D5). */
const TOP_RUNG = 8;
/** Each rung costs exactly this multiple of the one below. */
const RATIO = 2;
/** Hours of focused play, on one ladder, from rung 0 to the top. */
const FOCUSED_HOURS_TO_TOP = 40;
/** A declared guess, not a measurement: a human earns this share of the greedy
 *  trader's rate. Recalibrated from #564's play log. */
const HUMAN_FACTOR = 0.5;
/** A kill of an equal-strength target pays 2·S_t/(S_o+S_t) = 1, the most any
 *  kill pays is this. */
const CREDIT_K = 2;

const hours = Number(process.argv[2] ?? 8);
const worldSeed = Number(process.argv[3] ?? 0x5ee11e);
if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours must be > 0");
if (!Number.isInteger(worldSeed))
	throw new Error(`seed must be an integer, got ${process.argv[3]}`);

const WORLDS: World[] = GALAXY_LIST.map((g) => worldFor(worldSeed, g));
const CHECKPOINTS_H = [1, 2, 4, 8].filter((h) => h <= hours);

const median = (xs: readonly number[]): number => {
	const s = [...xs].map((x) => finite("median input", x)).sort((a, b) => a - b);
	if (s.length === 0) throw new Error("median of nothing");
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const range = (xs: number[], digits = 0): string => {
	const f = xs.map((x) => finite("figure", x));
	const lo = Math.min(...f).toFixed(digits);
	const hi = Math.max(...f).toFixed(digits);
	return lo === hi ? lo : `${lo}–${hi}`;
};
const byGalaxy = (xs: number[], digits = 0): string =>
	xs.map((x, i) => `g${GALAXY_LIST[i]} ${x.toFixed(digits)}`).join("  ");

console.log(
	`ladder rates — world 0x${worldSeed.toString(16)}, galaxies ${GALAXY_LIST.join(",")}, ${hours} h window`,
);

// ---------------------------------------------------------------------------
// 1 + 2. Trade margin and the legs it flies
// ---------------------------------------------------------------------------

interface Tally {
	minutes: number;
	marginCr: number;
	/** Cumulative margin at each checkpoint, `null` where the run ended first. */
	atCheckpoint: (number | null)[];
	legs: number;
	/** Σ over legs of the law's chance — the expected encounters. */
	expectedEncounters: number;
	/** Encounters the seeded draw actually gives, slots never down. */
	drawnEncounters: number;
	/** The same draw, with each encounter killing its slot for the lifecycle. */
	drawnWithDowntime: number;
	governments: number[];
}

const DOWNTIME_S = RAIDER_WRECK_S + RAIDER_REPAIR_S;

function flyTrade(world: World, opts: Parameters<typeof run>[2]): Tally {
	const marks: { s: number; margin: number }[] = [];
	let margin = 0;
	const t: Tally = {
		minutes: 0,
		marginCr: 0,
		atCheckpoint: [],
		legs: 0,
		expectedEncounters: 0,
		drawnEncounters: 0,
		drawnWithDowntime: 0,
		governments: [],
	};
	const downUntil = new Map<string, number>();
	const onHop = (h: HopRecord) => {
		margin += h.profitCr;
		marks.push({ s: h.arriveS, margin });
		const r = h.to.record;
		// The leg spools in the destination system: at once for an in-system
		// hop, after the wind-up for a jump. `Game` passes the whole second at
		// spool completion as the ordinal.
		const spoolS = h.departS + (h.kind === "jump" ? JUMP_SECONDS : 0);
		t.legs++;
		t.governments.push(r.government);
		t.expectedEncounters += raiderLegChance(r.government);
		const enc = legEncounter(r.seed, r.government, Math.floor(spoolS));
		if (!enc) return;
		t.drawnEncounters++;
		const slot = `${r.index}:${enc.slotIndex}`;
		if ((downUntil.get(slot) ?? -1) > spoolS) return;
		t.drawnWithDowntime++;
		downUntil.set(slot, spoolS + DOWNTIME_S);
	};
	const result = run(world, hours, { ...opts, stopAtKit: false, onHop });
	t.minutes = result.minutes;
	t.marginCr = margin;
	t.atCheckpoint = CHECKPOINTS_H.map((h) => {
		if (result.minutes < h * 60 - 1) return null;
		let m = 0;
		for (const k of marks) if (k.s <= h * 3600) m = k.margin;
		return m;
	});
	return t;
}

interface TradeArm {
	label: string;
	/** The hull the arm flies — its hold here, and its own strength when
	 *  section 5 prices the arm's kills. */
	hull: HullId;
	opts: Parameters<typeof run>[2];
}
const holdArm = (hull: HullId): TradeArm => ({
	label: `${hull} ${HULL_SPECS[hull].holdT} t, capitalised, no shopping`,
	hull,
	opts: {
		holdT: HULL_SPECS[hull].holdT,
		shop: false,
		startCr: fullKitCr(),
	},
});
const ARMS: TradeArm[] = [
	{
		label: `new pilot: courier ${HULL_SPECS.courier.holdT} t from ${START_CR} Cr, shopping on`,
		hull: PLAYER_BASELINE_HULL,
		opts: { holdT: HULL_SPECS.courier.holdT, shop: true },
	},
	holdArm("courier"),
	holdArm("miner"),
	holdArm("freighter"),
];

console.log("\n1. TRADE — realised margin (D3), shipped market with memory");
console.log(
	`   Cr of margin per hour of play; cumulative margin at ${CHECKPOINTS_H.map((h) => `${h} h`).join(", ")}`,
);
const tallies: Tally[][] = [];
/** Section 5's inputs, per galaxy, collected where each section computes them. */
const tradeRatesByArm: number[][] = [];
/** An arm that earns more on a market with memory than on one without is
 *  riding the round-trip pump `RunOptions.remembers` documents — the memory is
 *  there to close a pair, never to open one. Computed per arm from the two
 *  runs below; section 5 pools no rate from a pumped arm. */
const pumpedByArm: boolean[] = [];
const pulseKillsByArm: number[][] = [];
const exploreRatesByArm: { label: string; perH: number[] }[] = [];
for (const arm of ARMS) {
	const rows = WORLDS.map((w) => flyTrade(w, arm.opts));
	tallies.push(rows);
	const perHour = rows.map((r) => r.marginCr / (r.minutes / 60));
	tradeRatesByArm.push(perHour);
	console.log(`\n   ${arm.label}`);
	console.log(`     margin/h   ${range(perHour)}    (${byGalaxy(perHour)})`);
	console.log(
		`     flew       ${range(rows.map((r) => r.minutes))} min of a ${hours * 60} min window`,
	);
	// The same arm on a market with no memory — `measure-hull-pricing.ts`'s
	// pricing basis, and the control the pump test reads.
	const bare = WORLDS.map((w) =>
		flyTrade(w, { ...arm.opts, remembers: false }),
	);
	const bareH = bare.map((r) => r.marginCr / (r.minutes / 60));
	const pumped = median(perHour) > median(bareH);
	pumpedByArm.push(pumped);
	console.log(
		`     no memory  ${range(bareH)}    (${byGalaxy(bareH)})  — deficit off, for comparison`,
	);
	console.log(
		`     pump       ${pumped ? `yes — memory out-earns no memory (median ${median(perHour).toFixed(0)} against ${median(bareH).toFixed(0)}), so section 5 pools no rate from this arm` : "no"}`,
	);
	CHECKPOINTS_H.forEach((h, i) => {
		const at = rows.map((r) => r.atCheckpoint[i]);
		const flown = at.filter((x): x is number => x !== null);
		console.log(
			`     at ${String(h).padStart(2)} h    ${flown.length ? range(flown) : "—"}${
				flown.length < at.length
					? `  (${at.length - flown.length} run(s) ended first)`
					: ""
			}`,
		);
	});
}

console.log(
	"\n2. COMBAT — raider encounters per hour, on the trader's own legs",
);
console.log(
	`   one hop = one cruise leg in the destination system; slot downtime ${DOWNTIME_S / 60} min (RAIDER_WRECK_S + RAIDER_REPAIR_S)`,
);
ARMS.forEach((arm, i) => {
	const rows = tallies[i];
	const perH = (f: (r: Tally) => number) =>
		rows.map((r) => f(r) / (r.minutes / 60));
	const govs = rows.flatMap((r) => r.governments);
	const meanGov = govs.reduce((a, b) => a + b, 0) / govs.length;
	console.log(`\n   ${arm.label}`);
	console.log(
		`     legs/h                       ${range(
			perH((r) => r.legs),
			1,
		)}`,
	);
	console.log(
		`     mean government of the legs  ${meanGov.toFixed(2)}  (law chance there ${(raiderLegChance(meanGov) * 100).toFixed(0)}%)`,
	);
	console.log(
		`     expected encounters/h (law)  ${range(
			perH((r) => r.expectedEncounters),
			1,
		)}`,
	);
	console.log(
		`     drawn encounters/h           ${range(
			perH((r) => r.drawnEncounters),
			1,
		)}`,
	);
	console.log(
		`     drawn, every one a kill      ${range(
			perH((r) => r.drawnWithDowntime),
			1,
		)}   (slots down after a kill)`,
	);
});

// The duel, flown through the module's own scripted schedule — the pacing
// `tests/combat-prototype.test.ts` asserts. Pulse and beam arms.
const duelSeconds = (weapon: "pulse" | "beam"): number => {
	const dt = 0.05;
	let s = createCombatPrototype();
	while (s.targetHull > 0 && s.playerHull > 0 && s.elapsed < 600)
		s = stepCombatPrototype(s, duelInputs(s, dt, weapon));
	// A loss or the cap is not a time to a kill, and would be priced as one.
	if (s.targetHull > 0)
		throw new Error(
			`${weapon} duel did not kill: target ${s.targetHull}, player ${s.playerHull}, ${s.elapsed.toFixed(1)} s`,
		);
	return s.elapsed;
};
const pulseS = duelSeconds("pulse");
const beamS = duelSeconds("beam");
console.log(
	`\n   scripted duel (combat-prototype duelInputs): pulse ${pulseS.toFixed(1)} s, beam ${beamS.toFixed(1)} s to a kill`,
);
console.log(
	"   kills/h if every encounter is fought and won, the fight's time added to the hour:",
);
ARMS.forEach((arm, i) => {
	const rows = tallies[i];
	const kph = (duel: number) =>
		rows.map((r) => {
			const n = r.drawnWithDowntime;
			const s = r.minutes * 60 + n * duel;
			return n / (s / 3600);
		});
	pulseKillsByArm.push(kph(pulseS));
	console.log(
		`     ${arm.label.padEnd(58)} pulse ${range(kph(pulseS), 1)}  beam ${range(kph(beamS), 1)}`,
	);
});

// ---------------------------------------------------------------------------
// 3. Exploration
// ---------------------------------------------------------------------------

console.log(
	"\n3. EXPLORATION — first-time kinds (D4): first arrival in a system, first dock at a station",
);
console.log(
	"   every station a system generates counts (trade, refinery, shipyard, outpost — `StationType`)",
);

const components = (
	systems: readonly SystemRecord[],
	tankLy: number,
): SystemRecord[][] => {
	const seen = new Set<number>();
	const out: SystemRecord[][] = [];
	for (const s of systems) {
		if (seen.has(s.index)) continue;
		const comp: SystemRecord[] = [];
		const queue = [s];
		seen.add(s.index);
		while (queue.length) {
			const c = queue.pop() as SystemRecord;
			comp.push(c);
			for (const n of neighbours(systems, c, tankLy))
				if (!seen.has(n.index)) {
					seen.add(n.index);
					queue.push(n);
				}
		}
		out.push(comp);
	}
	return out.sort((a, b) => b.length - a.length);
};

const stationsIn = (w: World, rs: readonly SystemRecord[]) =>
	rs.reduce((n, r) => n + w.contentsFor(r).stations.length, 0);

const pool = WORLDS.map((w) => ({
	systems: w.systems.length,
	stations: stationsIn(w, w.systems),
}));
console.log(
	`   per galaxy: ${range(pool.map((p) => p.systems))} systems, ${range(pool.map((p) => p.stations))} stations — first-time kinds available ${range(pool.map((p) => p.systems + p.stations))}`,
);
console.log(
	`   ×8 galaxies (SYSTEMS_PER_GALAXY ${SYSTEMS_PER_GALAXY}): about ${Math.round(
		(8 * pool.reduce((a, p) => a + p.systems + p.stations, 0)) / pool.length,
	)} kinds commander-wide, reachable only with the Galactic Hyperdrive`,
);

console.log(
	"\n   reach by hull tank — the largest jump component, and what it holds:",
);
const purchasable = [...PURCHASABLE_HULL_IDS].sort(
	(a, b) => HULL_SPECS[a].tankLy - HULL_SPECS[b].tankLy,
);
for (const hull of purchasable) {
	const tank = HULL_SPECS[hull].tankLy;
	const comps = WORLDS.map((w) => components(w.systems, tank));
	const main = comps.map((c) => c[0].length);
	const kinds = comps.map((c, i) => c[0].length + stationsIn(WORLDS[i], c[0]));
	console.log(
		`     ${hull.padEnd(11)} ${String(tank).padStart(2)} LY   ${range(main)} systems in the main component, ${range(comps.map((c) => c.length))} components, ${range(kinds)} kinds`,
	);
}

/** Nearest-unvisited explorer: jump to the closest new system in range, dock
 *  at every station there (policy "all") or its first only ("one"), and when
 *  the neighbourhood is exhausted, fly the shortest chain through visited
 *  systems to the nearest new one. A pass-through jump is costed as a docked
 *  jump — a refuel stop — which over-states transit slightly. */
function explore(
	w: World,
	tankLy: number,
	policy: "one" | "all",
	capS: number,
): {
	kinds: number;
	seconds: number;
	exhausted: boolean;
	/** Kinds found by each of `CHECKPOINTS_H`, or null when the run ended first. */
	at: (number | null)[];
} {
	const start = w.systems.find((r) => w.contentsFor(r).stations.length >= 1);
	if (!start) throw new Error("no station in galaxy");
	const visited = new Set<number>([start.index]);
	let here: Port = portsOf(start, w.contentsFor(start))[0];
	let t = 0;
	let kinds = 0;
	const at: (number | null)[] = CHECKPOINTS_H.map(() => null);
	const dockAll = (port: Port) => {
		const ports = portsOf(port.record, w.contentsFor(port.record));
		kinds++; // the first dock, `port`
		if (policy === "one") return port;
		let cur = port;
		for (const p of ports) {
			if (p.station.id === port.station.id) continue;
			t += intraSeconds(cur, p, t, DOCK_SECONDS);
			kinds++;
			cur = p;
		}
		return cur;
	};
	here = dockAll(here);
	kinds++; // the start system's own arrival
	while (t < capS) {
		// BFS over the jump graph from here to the nearest unvisited system.
		const prev = new Map<number, SystemRecord>();
		const queue: SystemRecord[] = [here.record];
		const seen = new Set<number>([here.record.index]);
		let target: SystemRecord | null = null;
		while (queue.length && !target) {
			const c = queue.shift() as SystemRecord;
			for (const n of neighbours(w.systems, c, tankLy)) {
				if (seen.has(n.index)) continue;
				seen.add(n.index);
				prev.set(n.index, c);
				if (!visited.has(n.index)) {
					target = n;
					break;
				}
				queue.push(n);
			}
		}
		if (!target) return { kinds, seconds: t, exhausted: true, at };
		const path: SystemRecord[] = [];
		for (
			let c: SystemRecord | undefined = target;
			c && c.index !== here.record.index;
			c = prev.get(c.index)
		)
			path.unshift(c);
		for (const hop of path) {
			// Every system holds a station today; a generator that drops one must
			// fail here rather than count a dock that never happened.
			const to = portsOf(hop, w.contentsFor(hop))[0];
			if (!to) throw new Error(`system ${hop.index} has no station to dock at`);
			t += jumpSeconds(here, to, t, DOCK_SECONDS);
			here = to;
		}
		visited.add(target.index);
		kinds++; // first arrival
		here = dockAll(here);
		for (const [i, h] of CHECKPOINTS_H.entries())
			if (at[i] === null && t >= h * 3600) at[i] = kinds;
	}
	return { kinds, seconds: t, exhausted: false, at };
}

console.log(
	`\n   explorer flying nearest-unvisited for up to ${hours} h — kinds per hour of play:`,
);
for (const hull of ["courier", "explorer"] as const) {
	for (const policy of ["one", "all"] as const) {
		const rows = WORLDS.map((w) =>
			explore(w, HULL_SPECS[hull].tankLy, policy, hours * 3600),
		);
		const perH = rows.map((r) => r.kinds / (r.seconds / 3600));
		exploreRatesByArm.push({ label: `${hull} ${policy}`, perH });
		const ex = rows.filter((r) => r.exhausted);
		console.log(
			`     ${hull.padEnd(9)} dock ${policy === "one" ? "once per system  " : "at every station "} ${range(perH, 0)} kinds/h, ${range(rows.map((r) => r.kinds))} kinds in ${range(
				rows.map((r) => r.seconds / 3600),
				1,
			)} h${ex.length ? `  (${ex.length}/${rows.length} exhausted the component)` : ""}`,
		);
		// The rate window by window, so section 5's extrapolation past this
		// window rests on a shape that is printed rather than assumed.
		let fromH = 0;
		const windows = CHECKPOINTS_H.map((h, i) => {
			const prior = i === 0 ? rows.map(() => 0) : rows.map((r) => r.at[i - 1]);
			const perWindow = rows.flatMap((r, g) => {
				const a = prior[g];
				const b = r.at[i];
				return a === null || b === null ? [] : [(b - a) / (h - fromH)];
			});
			const label = `${fromH}–${h} h ${perWindow.length ? range(perWindow, 0) : "—"}`;
			fromH = h;
			return label;
		});
		console.log(`       kinds/h by window: ${windows.join("   ")}`);
	}
}

// The bound on section 5's extrapolation: fly the greedy hours the top implies
// (the focused hours at the human factor) and see how far one galaxy gets.
const greedyHoursToTop = FOCUSED_HOURS_TO_TOP * HUMAN_FACTOR;
console.log(
	`\n   the explorer docking at every station, flown for ${greedyHoursToTop} h — the greedy hours section 5's top implies:`,
);
for (const hull of ["courier", "explorer"] as const) {
	const rows = WORLDS.map((w) =>
		explore(w, HULL_SPECS[hull].tankLy, "all", greedyHoursToTop * 3600),
	);
	const ex = rows.filter((r) => r.exhausted);
	console.log(
		`     ${hull.padEnd(9)} ${range(rows.map((r) => r.kinds))} kinds; ${ex.length}/${rows.length} galaxies exhausted${
			ex.length
				? `, at ${range(
						ex.map((r) => r.seconds / 3600),
						1,
					)} h`
				: ""
		}`,
	);
}

// ---------------------------------------------------------------------------
// 4. Threat
// ---------------------------------------------------------------------------

console.log("\n4. THREAT — candidate forms off the hull row (D2)");
const FORMS: { name: string; of: (h: HullId) => number }[] = [
	{
		name: "integrity × hardpoints",
		of: (h) => HULL_SPECS[h].integrity * HULL_SPECS[h].hardpoints,
	},
	{ name: "integrity", of: (h) => HULL_SPECS[h].integrity },
	{
		name: "integrity × √hardpoints",
		of: (h) => HULL_SPECS[h].integrity * Math.sqrt(HULL_SPECS[h].hardpoints),
	},
];
console.log(
	`   ${"hull".padEnd(12)}${"integ".padStart(6)}${"hp".padStart(4)}${FORMS.map((f) => f.name.padStart(26)).join("")}`,
);
for (const h of HULL_IDS)
	console.log(
		`   ${h.padEnd(12)}${String(HULL_SPECS[h].integrity).padStart(6)}${String(HULL_SPECS[h].hardpoints).padStart(4)}${FORMS.map((f) => f.of(h).toFixed(0).padStart(26)).join("")}`,
	);
console.log(
	`   pirate relay: integrity ${RELAY_INTEGRITY}, no hardpoints — a declared weight, not a row`,
);

for (const form of FORMS) {
	console.log(
		`\n   target ÷ own, ${form.name} (rows: own hull, columns: target), unclamped`,
	);
	const ids = DOCKABLE_HULL_IDS;
	console.log(
		`   ${"".padEnd(12)}${ids.map((c) => c.slice(0, 7).padStart(8)).join("")}`,
	);
	for (const own of ids)
		console.log(
			`   ${own.padEnd(12)}${ids.map((tg) => (form.of(tg) / form.of(own)).toFixed(2).padStart(8)).join("")}`,
		);
}

// ---------------------------------------------------------------------------
// 5. Thresholds
// ---------------------------------------------------------------------------

console.log(
	"\n5. THRESHOLDS — the principal's ruling on #562, computed from 1–3",
);
console.log(
	`   declared: TOP_RUNG ${TOP_RUNG} (rungs 0–${TOP_RUNG}), RATIO ${RATIO}, FOCUSED_HOURS_TO_TOP ${FOCUSED_HOURS_TO_TOP}, HUMAN_FACTOR ${HUMAN_FACTOR} (a declared guess, recalibrated from #564's play log), CREDIT_K ${CREDIT_K}`,
);

const list = (xs: readonly number[], digits = 0) =>
	xs.map((x) => x.toFixed(digits)).join(", ");

// Combat strength. Hardpoints have no behaviour yet, so every armed hull fires
// one pulse laser: DPS is `PULSE_LASER.damagePerS`, a single constant in
// `ship-condition.ts`. A hull is armed if Traffic arms it
// (`ARMED_TRAFFIC_HULLS`), if it is the raider (raiders fire) or if it is the
// player's hull; every other hull never fires and has S = 0.
const AI_SKILL = 1;
const isArmed = (h: HullId): boolean =>
	ARMED_TRAFFIC_HULLS.has(h) || h === "raider" || h === PLAYER_BASELINE_HULL;
const dps = (h: HullId, armed = isArmed(h)): number =>
	armed ? PULSE_LASER.damagePerS : 0;
const strength = (h: HullId, armed = isArmed(h)): number =>
	(SHIELD_POOL + HULL_SPECS[h].integrity) * dps(h, armed) * AI_SKILL;
const credit = (own: HullId, target: HullId): number => {
	const so = strength(own, true);
	const st = strength(target);
	return (CREDIT_K * st) / (so + st);
};

console.log(
	`\n   strength S = (SHIELD_POOL ${SHIELD_POOL} + integrity) × DPS × aiSkill ${AI_SKILL}; DPS = PULSE_LASER.damagePerS ${PULSE_LASER.damagePerS} if armed, else 0`,
);
for (const h of DOCKABLE_HULL_IDS)
	console.log(
		`     ${h.padEnd(12)} integrity ${String(HULL_SPECS[h].integrity).padStart(4)}  ${isArmed(h) ? "armed  " : "unarmed"}  DPS ${dps(h)}  S ${strength(h)}`,
	);

const OWN_ROWS: HullId[] = [...PURCHASABLE_HULL_IDS, "patrol", "raider"];
const TARGET_COLS: HullId[] = DOCKABLE_HULL_IDS.filter((h) => isArmed(h));
console.log(
	`\n   credit per kill = ${CREDIT_K}·S_t / (S_o + S_t); rows: own hull, flown armed; columns: armed targets`,
);
console.log(
	`   ${"".padEnd(12)}${TARGET_COLS.map((c) => c.slice(0, 11).padStart(12)).join("")}`,
);
for (const own of OWN_ROWS)
	console.log(
		`   ${own.padEnd(12)}${TARGET_COLS.map((t) => credit(own, t).toFixed(3).padStart(12)).join("")}`,
	);
const courierVsRaider = credit(PLAYER_BASELINE_HULL, "raider");
console.log(
	`   courier kills raider: ${courierVsRaider.toFixed(3)} credit; any unarmed target: 0`,
);

// The three rates. Trade and combat pool the same arms, and neither takes one
// the round-trip pump inflates (section 1: it earns more with memory than
// without) — combat's legs are the trader's legs, so a pumped route is a
// pumped leg count too. Each arm's kills are priced at that arm's own hull
// against a raider, so no kill is credited as a hull that did not fly it.
const pooled = ARMS.flatMap((arm, i) => (pumpedByArm[i] ? [] : [{ arm, i }]));
const tradeIn = pooled.map(({ arm, i }) => ({
	arm: arm.label,
	v: tradeRatesByArm[i],
}));
const combatIn = pooled.map(({ arm, i }) => {
	const perKill = credit(arm.hull, "raider");
	return {
		arm: arm.label,
		perKill,
		kills: pulseKillsByArm[i],
		v: pulseKillsByArm[i].map((k) => k * perKill),
	};
});
const tradeRate = median(tradeIn.flatMap((a) => a.v));
const combatRate = median(combatIn.flatMap((a) => a.v));
const exploreRate = median(exploreRatesByArm.flatMap((a) => a.perH));

console.log(
	"\n   rates (per hour of greedy play), medians over every galaxy of the arms named:",
);
console.log(
	"     trade — with-memory arms, the capitalised courier excluded (the pump):",
);
for (const a of tradeIn) console.log(`       ${a.arm.padEnd(58)} ${list(a.v)}`);
console.log(`       median ${tradeRate.toFixed(0)} Cr/h`);
console.log(
	"     combat — pulse kills/h × the arm's own hull-vs-raider credit, the same arms:",
);
for (const a of combatIn)
	console.log(
		`       ${a.arm.padEnd(58)} ${list(a.kills, 2)}  × ${a.perKill.toFixed(3)} = ${list(a.v, 2)}`,
	);
console.log(`       median ${combatRate.toFixed(2)} credit/h`);
console.log("     exploration — kinds/h, the four explorer arms:");
for (const a of exploreRatesByArm)
	console.log(`       ${a.label.padEnd(58)} ${list(a.perH, 1)}`);
console.log(`       median ${exploreRate.toFixed(1)} kinds/h`);

const LADDERS = [
	{ name: "trade", unit: "Cr", rate: tradeRate, digits: 0 },
	{ name: "combat", unit: "credit", rate: combatRate, digits: 1 },
	{ name: "exploration", unit: "kinds", rate: exploreRate, digits: 0 },
];
const tops = LADDERS.map((l) => l.rate * HUMAN_FACTOR * FOCUSED_HOURS_TO_TOP);
const rungs = Array.from({ length: TOP_RUNG }, (_, i) => i + 1);
const atRung = (top: number, n: number) => top / RATIO ** (TOP_RUNG - n);

console.log(
	`\n   top = rate × HUMAN_FACTOR × FOCUSED_HOURS_TO_TOP; rung n = top / ${RATIO}^(${TOP_RUNG} − n)`,
);
console.log(
	`   ${"rung".padEnd(6)}${"focused h".padStart(11)}${LADDERS.map((l) => `${l.name} (${l.unit})`.padStart(22)).join("")}`,
);
for (const n of rungs)
	console.log(
		`   ${String(n).padEnd(6)}${atRung(FOCUSED_HOURS_TO_TOP, n).toFixed(2).padStart(11)}${LADDERS.map((l, i) => atRung(tops[i], n).toFixed(l.digits).padStart(22)).join("")}`,
	);
const kindsPerGalaxy = median(pool.map((p) => p.systems + p.stations));
const exploreTop = tops[LADDERS.findIndex((l) => l.name === "exploration")];
const galaxiesToTop = exploreTop / kindsPerGalaxy;
console.log(
	`\n   exploration top ÷ kinds per galaxy (median ${kindsPerGalaxy}) = ${galaxiesToTop.toFixed(2)} galaxies`,
);
const firstOutOfReach = rungs.find(
	(n) => atRung(exploreTop, n) > kindsPerGalaxy,
);
if (firstOutOfReach !== undefined)
	console.log(
		`   ${firstOutOfReach === TOP_RUNG ? `the top rung (${TOP_RUNG}) is` : `rungs ${firstOutOfReach}–${TOP_RUNG} are`} past one galaxy's pool: out of reach without the Galactic Hyperdrive (section 3), since a hull's tank never leaves its galaxy`,
	);
