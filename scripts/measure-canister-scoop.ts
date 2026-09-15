/**
 * Reprints how long a pilot takes to scoop a kill's cargo (node #324).
 *
 * Flies `scripts/lib/scoop-pilot.ts`'s pilot — stop, face, creep, with only a
 * pilot's information — over 200 kills at the assist cap, in two arms: the
 * canister rules as shipped, and the same rules with the fade to rest switched
 * off. It prints how many canisters were scooped and the seconds from the kill
 * to the last one. The rules are the module's own.
 *
 * **Read the second arm for what it is.** This pilot cannot chase a moving
 * canister, so a low count there shows that the fade is what puts the cargo
 * in its reach, not that no pilot could scoop a drifting canister.
 *
 *   bun scripts/measure-canister-scoop.ts
 */
import { flyToCargo } from "./lib/scoop-pilot";

const KILLS = 200;

function arm(label: string, drifting: boolean) {
	const times: number[] = [];
	let dropped = 0;
	let scooped = 0;
	let incomplete = 0;
	for (let seed = 1; seed <= KILLS; seed++) {
		const run = flyToCargo(seed, 120, drifting);
		dropped += run.dropped;
		scooped += run.scooped;
		if (run.allScoopedS === null) incomplete++;
		else times.push(run.allScoopedS);
	}
	times.sort((a, b) => a - b);
	const at = (p: number) =>
		times.length ? times[Math.floor((times.length - 1) * p)].toFixed(1) : "-";
	console.log(
		`${label}: ${scooped} of ${dropped} canisters scooped over ${KILLS} kills, ${incomplete} kills left cargo behind`,
	);
	console.log(
		`  seconds from the kill to the last canister: p10 ${at(0.1)}, p50 ${at(0.5)}, p90 ${at(0.9)}, max ${at(1)}`,
	);
}

arm("as shipped", false);
arm("fade switched off", true);
