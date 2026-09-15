/**
 * The relay's before/after, as an instrument (node #43).
 *
 * Over many cruise legs in one system, how often does a leg meet a raider —
 * on the route the relay watches with the relay up, on that route with the
 * relay down, and on every other route either way? The headless rows in
 * `tests/pirate-relay.test.ts` and `tests/encounter.test.ts` assert the
 * shape; this prints the figures beside the law, so a claim like "certain
 * before, none after, the control route untouched" has a run behind it rather
 * than a sentence.
 *
 *   bun run scripts/measure-relay-route.ts            # seed 42, 2,000 legs
 *   bun run scripts/measure-relay-route.ts 47 5000
 *
 * Every figure goes through `finite`, which throws on a non-finite value —
 * an instrument that quietly prints NaN is worse than one that dies (#7).
 */
import { scheduleEncounter } from "../src/encounter";
import { relayDetection, relayPlan } from "../src/pirate-relay";
import { raiderLegChance } from "../src/raider-slots";
import { makeWorld } from "../src/sim";

const finite = (n: number, what: string): number => {
	if (!Number.isFinite(n)) throw new Error(`${what} is ${n}`);
	return n;
};

const seed = finite(Number(process.argv[2] ?? 42), "seed");
const legs = finite(Number(process.argv[3] ?? 2000), "legs");

const world = makeWorld(seed);
const { record, contents } = world.system;
const plan = relayPlan(contents, record.seed);
if (!plan) throw new Error(`seed ${seed}: the start system has no station`);
const watched = plan.watchedStationId;
const control = contents.stations.find((s) => s.id !== watched)?.id ?? null;
const ALL_UP = () => true;

const rate = (targetId: string | null, relayUp: boolean): number => {
	let met = 0;
	for (let leg = 0; leg < legs; leg++) {
		const detection = relayDetection(plan, targetId, relayUp);
		if (scheduleEncounter(ALL_UP, record.index, record, leg, 0, detection))
			met++;
	}
	return finite(met / legs, `rate(${targetId}, ${relayUp})`);
};

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(
	`seed ${seed} · ${record.name} (system ${record.index}, government ${record.government}) · ${legs} legs per arm`,
);
console.log(
	`law for this government: ${pct(finite(raiderLegChance(record.government), "law"))} of legs`,
);
console.log(
	`relay watches ${watched}, standing ${Math.abs(plan.leadKm).toFixed(0)} km ${plan.leadKm > 0 ? "ahead of" : "behind"} it and ${plan.offPlaneKm} km off its plane`,
);
console.log("");
console.log("route                       relay up   relay down");
console.log(
	`to ${watched.padEnd(22)} ${pct(rate(watched, true)).padStart(8)}   ${pct(rate(watched, false)).padStart(8)}`,
);
if (control)
	console.log(
		`to ${control.padEnd(22)} ${pct(rate(control, true)).padStart(8)}   ${pct(rate(control, false)).padStart(8)}`,
	);
else console.log("(no second station in this system: no control route)");
console.log("");
console.log(
	"A leg meets a raider only if the drawn slot is operational; every arm above has every slot up.",
);
