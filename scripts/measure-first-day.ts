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
import { makeWorld } from "../src/sim";
import { generateContents } from "../src/system";
import { AU_KM } from "../src/units";
import { boardAt } from "../tests/helpers/job-board";

const SEEDS = Number(process.argv[2] ?? 200);

const composition = new Map<string, number>();
const arrivalToTradeAu: number[] = [];
let floorInSystem = 0;
let localPosted = 0;
const localPay = new Set<number>();

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
console.log(
	`start trade station posts a Local run: ${localPosted} of ${SEEDS}; pays ${[...localPay].join(", ")} Cr`,
);
