/**
 * Reprints how long a pilot takes to scoop a kill's cargo (node #324).
 *
 * Flies `scripts/lib/scoop-pilot.ts`'s pilot — stop, face, creep, with only a
 * pilot's information — over 200 kills at the assist cap, and prints how many
 * canisters it scooped and the seconds from the kill to the last one. The
 * canister rules are the module's own, so this prints what the shipped figures
 * do; run it at two refs to compare two rules.
 *
 *   bun scripts/measure-canister-scoop.ts
 */
import { flyToCargo } from "./lib/scoop-pilot";

const KILLS = 200;
const times: number[] = [];
let dropped = 0;
let scooped = 0;
let incomplete = 0;
for (let seed = 1; seed <= KILLS; seed++) {
	const run = flyToCargo(seed);
	dropped += run.dropped;
	scooped += run.scooped;
	if (run.allScoopedS === null) incomplete++;
	else times.push(run.allScoopedS);
}
times.sort((a, b) => a - b);
const at = (p: number) =>
	times.length ? times[Math.floor((times.length - 1) * p)].toFixed(1) : "-";
console.log(
	`${KILLS} kills: ${scooped} of ${dropped} canisters scooped, ${incomplete} kills left cargo behind`,
);
console.log(
	`seconds from the kill to the last canister: p10 ${at(0.1)}, p50 ${at(0.5)}, p90 ${at(0.9)}, max ${at(1)}`,
);
