/**
 * The figures behind a new pilot's first useful day (#408).
 *
 * `docs/specs/first-useful-day.md` quotes these; **this file owns them**, so a
 * figure there is a pointer here rather than a third copy. Each is computed
 * through the game's own modules — `startSystem`, `generateContents`,
 * `makeWorld`, the job binders — and none is restated.
 *
 * Over `SEEDS` world seeds (`seed × 7919`, galaxy 0, the start system):
 *
 * - which stations the start system has, and how many have only one;
 * - how far the start trade station is from a new game's arrival point, which
 *   is where a free new game starts and why its first act is a cruise leg;
 * - how often the floor courier's first offer at the start trade station is
 *   in-system — the gap the Local run was added for;
 * - how often the start trade station posts a Local run, and what it pays.
 *
 * Run: `bun scripts/measure-first-day.ts [seeds]` (default 200).
 */
import { generateGalaxy, startSystem } from "../src/galaxy";
import { LOCAL_RUN_ROW_ID } from "../src/jobs";
import { V_GATE_KMS } from "../src/docking";
import { flightPerformance, makeWorld } from "../src/sim";
import { generateContents } from "../src/system";
import { AU_KM } from "../src/units";
import { boardAt } from "../tests/helpers/job-board";

const SEEDS = Number(process.argv[2] ?? 200);

const composition = new Map<string, number>();
const arrivalToTradeAu: number[] = [];
let floorInSystem = 0;
let localPosted = 0;
const localPay = new Set<number>();
// A station's acceleration is its orbit's r·(2π/T)²: what the assist must match
// to hold a ship at rest beside it, which it does not yet (#529).
const accelOf = (s: { orbit: { radiusKm: number; periodS: number } }) =>
	s.orbit.radiusKm * ((2 * Math.PI) / s.orbit.periodS) ** 2 * 1000;
// The steady lag a ship at rest in a station's frame keeps is about a × τ, the
// assist's lateral damping time; "hard" is a lag over half the gate speed.
const TAU_S = flightPerformance("courier").assistLateralTauS;
const HARD_LAG_MS = (V_GATE_KMS / 2) * 1000;
const yardAccels: number[] = [];
let localToYard = 0;
let localToHardYard = 0;

for (let n = 1; n <= SEEDS; n++) {
	const worldSeed = n * 7919;
	const galaxy = generateGalaxy(worldSeed, 0);
	const start = startSystem(galaxy);
	const stations = generateContents(start).stations;
	const key = stations
		.map((s) => s.type)
		.sort()
		.join("+");
	composition.set(key, (composition.get(key) ?? 0) + 1);

	const yard = stations.find((s) => s.type === "shipyard");
	if (yard?.parentId) yardAccels.push(accelOf(yard));
	const trade = stations.find((s) => s.type === "trade");
	if (!trade) continue;
	const board = boardAt(galaxy.systems, start, trade);
	const floor = board.find(
		(o) => o.family === "courier" && o.rowId !== LOCAL_RUN_ROW_ID,
	);
	if (floor?.distanceLy === 0) floorInSystem++;
	const local = board.find((o) => o.rowId === LOCAL_RUN_ROW_ID);
	if (local) {
		localPosted++;
		localPay.add(local.rewardCr);
		const dest = stations.find((s) =>
			local.reportAt.carrierKey.endsWith(`:${s.localCarrierId}`),
		);
		if (dest?.type === "shipyard") {
			localToYard++;
			// Lag ≈ a × the courier's assist τ; "hard" is over half the gate speed.
			if (accelOf(dest) * TAU_S > HARD_LAG_MS) localToHardYard++;
		}
	}

	const world = makeWorld(worldSeed);
	const at = world.system.byId.get(trade.id)?.pos;
	if (at) {
		const p = world.ship.pos;
		arrivalToTradeAu.push(
			Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) / AU_KM,
		);
	}
}

const single = composition.get("trade") ?? 0;
arrivalToTradeAu.sort((a, b) => a - b);
const q = (f: number) =>
	arrivalToTradeAu[Math.floor(f * (arrivalToTradeAu.length - 1))].toFixed(2);

console.log(`start systems over ${SEEDS} seeds (seed × 7919, galaxy 0)`);
for (const [kind, count] of [...composition].sort((a, b) => b[1] - a[1]))
	console.log(`  ${kind.padEnd(28)} ${count}`);
console.log(
	`  only a trade station: ${single} of ${SEEDS} (${((100 * single) / SEEDS).toFixed(1)}%)`,
);
console.log(
	`arrival point to start trade station, AU: min ${q(0)} p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)} max ${q(1)}`,
);
console.log(
	`floor courier's first offer in-system: ${floorInSystem} of ${SEEDS}`,
);
yardAccels.sort((a, b) => a - b);
const qa = (f: number) =>
	yardAccels[Math.floor(f * (yardAccels.length - 1))].toFixed(1);
console.log(
	`shipyard acceleration, m/s² (#529): median ${qa(0.5)} p90 ${qa(0.9)} max ${qa(1)} over ${yardAccels.length}`,
);
console.log(
	`start trade station posts a Local run: ${localPosted} of ${SEEDS}; pays ${[...localPay].join(", ")} Cr`,
);
console.log(
	`Local run to the shipyard: ${localToYard}; to one whose lag is over ${HARD_LAG_MS} m/s: ${localToHardYard}`,
);
