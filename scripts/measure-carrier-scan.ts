/**
 * The instrument `src/carrier-scan.ts` promises, and `carrier-identity.md` §9's
 * "The scan's feel" row requires: the three feel figures reprinted beside what
 * they mean in flight — the lateral room the cone admits at the range ceiling,
 * and the distance a target crosses while the charge runs.
 *
 *   bun run scripts/measure-carrier-scan.ts
 *
 * **What may be believed from it.** Every figure is `src/carrier-scan.ts`'s own
 * or arithmetic on it — that module's rule, since a figure written beside a
 * spec is later read as a measurement. The arms are *flown*, through
 * `scanConeHeld`, `scanInRange` and `stepScanHold` at the game's own `MAX_DT`,
 * so B and C print the module's behaviour and not a closed form's opinion of
 * it. Speeds are the roster's mass and thrust through `flightPerformance`
 * against `ASSIST_CAP_KMS` (the game's one combat speed) and `DEFAULT_CRUISE`;
 * this file names no speed.
 *
 * **What it cannot show.** Whether the hold *feels* like a cost. Section F
 * prints the figure that looks like an answer and why it is not one: at combat
 * speed the cone asks a fraction of a per cent of a hull's turn authority, so
 * nothing kinematic refuses a pilot who chooses to track — what the verb costs
 * is paid in attention, and that is §9's row, which belongs to a person.
 */
import { SCANNER_RANGE_KM } from "../src/cockpit";
import { DEFAULT_CRUISE, cruiseSpeed } from "../src/cruise";
import {
	CARRIER_SCAN_FIGURES,
	beginScanHold,
	scanConeHeld,
	scanInRange,
	stepScanHold,
} from "../src/carrier-scan";
import { HULL_IDS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import {
	INTERDICTION_CHARGE_S,
	INTERDICTION_LOCK_DEG,
	INTERDICTION_RANGE_KM,
	INTERDICTION_TURN_FACTOR,
	cruiseTurnRate,
	interdictionTurnRate,
} from "../src/interdiction";
import { ASSIST_CAP_KMS, flightPerformance } from "../src/sim";
import { MAX_DT } from "../src/units";
import { v3 } from "../src/vec3";

const FIG = CARRIER_SCAN_FIGURES;
const CONE = FIG.coneDeg;
const CHARGE = FIG.chargeS;
const RANGE = FIG.rangeKm;
const RAD = (d: number) => (d * Math.PI) / 180;
const DEG = 180 / Math.PI;
/** The game's own worst-case frame delta: a hold that breaks between two frames
 *  of flight breaks here too. */
const DT = MAX_DT;
/** One charge of straight flying at the game's one combat speed. */
const DRIFT = ASSIST_CAP_KMS * CHARGE;
/** B and C's start range: the ladder's mid rung, not the boundary rung. */
const MID = RANGE / 2;
const BASE = flightPerformance(PLAYER_BASELINE_HULL);
const say = (...lines: string[]) => console.log(lines.join("\n"));
const f = (v: number, dp = 1) => v.toFixed(dp);
const col = (v: number, n: number, dp = 1) => f(v, dp).padStart(n);
const mult = (v: number) => `${v < 1 ? f(v, 3) : f(v)}x`;
/** Lateral room the cone admits: a full width, both sides of the nose. */
const roomKm = (r: number) => 2 * r * Math.tan(RAD(CONE));
const roomS = (r: number, kms: number) => (r * Math.tan(RAD(CONE))) / kms;
const bearingDps = (kms: number, r: number) => (kms / r) * DEG;
const authDps = (id: HullId) => cruiseTurnRate(flightPerformance(id)) * DEG;
const ROOM_TOP = roomKm(RANGE);
const USED_DEG = Math.atan2(DRIFT, RANGE) * DEG;
/** Range at which straight flying at combat speed outruns the cone. */
const CLOSE_KM = DRIFT / Math.tan(RAD(CONE));
const CONTEST_DRIFT = ASSIST_CAP_KMS * INTERDICTION_CHARGE_S;
const ASK = bearingDps(ASSIST_CAP_KMS, RANGE);
const HOLD = authDps(PLAYER_BASELINE_HULL);
const CRUISE = cruiseSpeed(DEFAULT_CRUISE.dRefKm, DEFAULT_CRUISE);

/** Opening sightline dead ahead, the ship flying straight, the target crossing
 *  at `kms` from a start range of `r`. The module's own answer: null when the
 *  charge completes first, else when it broke and on which of the two gates. */
function flyStraight(
	r: number,
	kms: number,
): { t: number; why: string } | null {
	let hold = beginScanHold();
	for (let t = 0; t < CHARGE / DT + 2; t += DT) {
		const cross = kms * t;
		if (!scanConeHeld(v3(0, 0, -1), v3(cross, 0, -r)))
			return { t, why: "the cone" };
		if (!scanInRange(Math.hypot(r, cross))) return { t, why: "the range" };
		hold = stepScanHold(hold, true, DT);
		if (hold.chargeS >= CHARGE) return null;
	}
	return null;
}

/** The speed a hull holds when a charge ends — full thrust from rest, capped by
 *  the assist — and the ground it covered getting there. */
function chargeRun(id: HullId, chargeS: number): { kms: number; km: number } {
	const a = flightPerformance(id).thrustKms2;
	const toCap = Math.min(chargeS, ASSIST_CAP_KMS / a);
	const kms = Math.min(ASSIST_CAP_KMS, a * chargeS);
	return { kms, km: (a * toCap ** 2) / 2 + kms * (chargeS - toCap) };
}

const RUNS = HULL_IDS.map((id) => {
	const scan = chargeRun(id, CHARGE);
	return {
		id,
		a: flightPerformance(id).thrustKms2,
		scan,
		contestKm: chargeRun(id, INTERDICTION_CHARGE_S).km,
		broke: flyStraight(MID, scan.kms),
	};
});
const DONE = RUNS.filter((r) => !r.broke).length;
const span = (pick: (r: (typeof RUNS)[number]) => number) =>
	`${f(Math.min(...RUNS.map(pick)))}–${f(Math.max(...RUNS.map(pick)))}`;
const EDGE = flyStraight(RANGE, ASSIST_CAP_KMS);

say(
	"carrier scan — the three figures `src/carrier-scan.ts` owns, beside what they mean in play",
	`  shipped: range ${RANGE} km · cone ${CONE}° · charge ${CHARGE} s  (CARRIER_SCAN_FIGURES — that module owns all three)`,
	`  interdiction: lock ${INTERDICTION_LOCK_DEG}° · charge ${INTERDICTION_CHARGE_S} s · contest range ${INTERDICTION_RANGE_KM} km`,
);

say(
	"\n== A. the room the cone admits ==",
	"  Full width is 2·R·tan(cone): how far off the nose a target may be and still be scannable. Room in hand is how long a target crossing at the assist cap may run before its bearing leaves the cone.",
	"  range km   full width km   room in hand s",
);
for (const r of [
	INTERDICTION_RANGE_KM,
	...[2, 3, 4, 6, 8].map((k) => (RANGE * k) / 8),
	SCANNER_RANGE_KM,
])
	say(
		`${col(r, 7)} km${col(roomKm(r), 14)}${col(roomS(r, ASSIST_CAP_KMS), 14)} s` +
			(scanInRange(r) ? "" : "   refused: outside the scan range"),
	);
console.log(
	`  At the ceiling the cone is ${f(ROOM_TOP)} km across, ${f(ROOM_TOP / 2)} km either side, and one charge of straight flying at the cap crosses ${f(DRIFT)} km of that: ${f(ROOM_TOP / 2 / DRIFT)}x the room the drift needs, using ${f(USED_DEG, 2)}° of the ${CONE}° — not a hair trigger at distance.`,
);

say(
	"\n== B. is a scan completable while flying? one charge per hull ==",
	"  Speed is the hull's own — thrustMN/massT pushed from rest for one charge, capped at ASSIST_CAP_KMS — and the hold is flown through the module's own predicates, nose held on the opening sightline, from half the ceiling.",
	`  hull          km/s²  to cap s   km/s   scan charge km   contest charge km   flown, from half the ceiling`,
);
for (const r of RUNS)
	say(
		`  ${r.id.padEnd(13)}${col(r.a, 6, 2)}${col(ASSIST_CAP_KMS / r.a, 10)}${col(r.scan.kms, 7)}` +
			`${col(r.scan.km, 17)}${col(r.contestKm, 19)}  ` +
			`${r.broke ? `breaks at ${f(r.broke.t)} s, ${r.broke.why}` : "completes"}`,
	);
say(
	`  Straight flying is not what breaks a scan: ${DONE} of ${RUNS.length} hulls complete the charge, with ${f(roomS(MID, ASSIST_CAP_KMS), 0)} s of room in hand against a ${CHARGE} s charge at the mid rung — the same for every hull, because the whole roster is at the cap inside one charge (${span((r) => ASSIST_CAP_KMS / r.a)} s to get there). What differs is the ground covered getting there: ${span((r) => r.scan.km)} km of scan charge, ${span((r) => r.contestKm)} km of contest charge.`,
	`  What does break a scan is closeness: at combat speed the cone runs out at ${f(CLOSE_KM, 0)} km, inside interdiction's own contest range of ${INTERDICTION_RANGE_KM} km — where a scan would be flown during a fight, which is F4's point. And a scan refused for range is refused ${f(SCANNER_RANGE_KM / RANGE, 0)}x short of what the passive display admits (${SCANNER_RANGE_KM} km), §4's bound.`,
	`  The ceiling itself is a different arm: flown from exactly ${RANGE} km the hold breaks at ${f(EDGE?.t ?? 0)} s on ${EDGE?.why}, a crossing target adding hypotenuse to its slant range while the range is checked every frame here. The ${f(ROOM_TOP / 2)} km of room is a target's *inside* the ceiling, not at it.`,
);

say(
	"\n== C. the same charge paid at cruise ==",
	"  Range is checked every frame here, where a contest checks it once — so cruise is the arm that decides when the verb is available at all. Same hold, same arm, flown from half the ceiling.",
	"  arm                              km/s   drift in a charge km   x scan range   straight flight",
);
for (const [label, kms] of [
	["deep cruise (vMaxKms)", CRUISE],
	["cruise floor (vMinKms)", DEFAULT_CRUISE.vMinKms],
	["drop-out speed (dropSpeedKms)", DEFAULT_CRUISE.dropSpeedKms],
	["the assist cap (§1's exit)", ASSIST_CAP_KMS],
] as const) {
	const broke = flyStraight(MID, kms);
	say(
		`  ${label.padEnd(32)}${col(kms, 10)}${col(kms * CHARGE, 23)}` +
			`${mult((kms * CHARGE) / RANGE).padStart(15)}  ` +
			`${broke ? `breaks at ${f(broke.t)} s, ${broke.why}` : "completes"}`,
	);
}
console.log(
	`  Only the last arm is scannable, and it is the one §1's exit drops a ship into: at cruise a target crosses ${f((CRUISE * CHARGE) / RANGE)} whole scan ranges while the charge runs, and even cruise's own safety floor outruns the ceiling. Dropping out is not courtesy to the instrument — it is the price of the verb.`,
);

say(
	"\n== D. the two holds, read side by side ==",
	`  scan          cone ${CONE}° · charge ${CHARGE} s · range ${RANGE} km`,
	`  interdiction  lock ${INTERDICTION_LOCK_DEG}° · charge ${INTERDICTION_CHARGE_S} s · contest range ${INTERDICTION_RANGE_KM} km`,
	`  The scan bills ${mult(CHARGE / INTERDICTION_CHARGE_S)} the seconds at ${mult(RANGE / INTERDICTION_RANGE_KM)} the distance: ${f(DRIFT)} km of crossing against ${f(CONTEST_DRIFT)} km — §4's same unbroken attention, bought from a verb with no opponent in it.`,
	`  The angles are not the same kind of angle. A contest's ${INTERDICTION_LOCK_DEG}° is a *heading* separation (O1), so it buys no lateral width; what it bills is turn authority — ${f(INTERDICTION_TURN_FACTOR * 100, 0)}% of it, so the baseline hull keeps ${f(interdictionTurnRate(BASE))} rad/s of its ${f(cruiseTurnRate(BASE))} while a lock is held.`,
	`  A scan bills none of that authority, and nothing in the module touches it: holding the nose on a target crossing at the cap asks ${f(ASK, 3)}°/s against the baseline hull's ${f(HOLD)}°/s — ${f((ASK / HOLD) * 100, 2)}% of it. The geometry never refuses a pilot who chooses to track.`,
);

say(
	"\n== E. how to tune this ==",
	`  charge — the attention bill, and linear in it: the drift a pilot holds against is ${f(DRIFT)} km today and halves with the dial, while the room in hand per hull doubles beside it. It sets what a scan costs, never what it admits.`,
	`  cone — the room, and the only dial that answers whether the lock is a hair trigger: ${f(ROOM_TOP)} km across at the ceiling, with a ${f(USED_DEG, 2)}° crossing inside it today. Widening it admits targets the nose is *not* on, which is the sightline F4's cost is about.`,
	`  range — availability rather than feel: how many contacts are scannable at all, how much of the passive display the verb reaches (${f(RANGE / SCANNER_RANGE_KM, 2)} of it today), and how much room in hand every hull gets, a crossing subtending less bearing further out.`,
	"\n  All three belong to `src/carrier-scan.ts`. They are reprinted here, not owned here: neither this file nor a spec restates them, and tuning means changing the module and re-running this.",
);

say(
	"\n== F. what this instrument cannot show ==",
	`  None of the above shows whether the hold *feels* like a cost, and none of it can. The figure that looks most like an answer — that ${f((ASK / HOLD) * 100, 2)}% of authority — is the shape of the gap and not its size: the verb's price is attention, the nose not on the vector you are flying and the fight you are not in. §9's "The scan's feel" row is the principal flying it, and no printout stands in for that.`,
);
