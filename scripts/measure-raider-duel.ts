/**
 * Reprints the duel figures `tests/combat-prototype.test.ts` is tuned against,
 * on whichever raider controller the tree has (node #324).
 *
 * Each seed flies two fights through the module's own `createCombatEnemy`,
 * `stepCombatEnemy` and `stepCombatPrototype`, the way the test's `flyDuel`
 * does: a pressed fight for 40 s with the player still, and a tracked fight for
 * 45 s with the player's nose kept on the raider. Nothing is restated: the gun
 * range and the merge distance are the module's.
 *
 * Run it at two refs to compare two controllers. #345 ran it on `main` (the
 * slew controller) and on the `stepAngular` controller, and its test comment
 * quotes the firing shares both printed.
 *
 *   bun scripts/measure-raider-duel.ts
 */
import {
	createCombatPrototype,
	stepCombatPrototype,
} from "../src/combat-prototype";
import {
	GUN_RANGE_KM,
	MERGE_BREAK_KM,
	createCombatEnemy,
	stepCombatEnemy,
} from "../src/combat-enemy";
import { dot, length, scale, sub, v3 } from "../src/vec3";

/** The seeds the test's duel rows use, then four more. */
const SEEDS = [1, 99, 777, 12345, 2, 3, 4, 5];
const DT = 0.05;

function fly(seed: number, seconds: number, tracking: boolean) {
	const player = { pos: v3(), vel: v3() };
	let playerNose = v3(0, 0, -1);
	let enemy = createCombatEnemy(player, playerNose, seed);
	let combat = createCombatPrototype();
	let frames = 0;
	let shooting = 0;
	let inGun = 0;
	let closest = Number.POSITIVE_INFINITY;
	let bestAspect = -1;
	let lowest = 0;
	let highest = 0;
	for (let t = 0; t < seconds; t += DT) {
		const toPlayer = sub(player.pos, enemy.ship.pos);
		const range = length(toPlayer);
		const bearing = scale(toPlayer, 1 / range);
		if (tracking) playerNose = scale(bearing, -1);
		// The accepted shot, not the trigger, as the test's harness feeds it.
		const step = stepCombatEnemy(
			enemy,
			player,
			playerNose,
			combat,
			combat.firing !== null,
			DT,
		);
		enemy = step.state;
		combat = stepCombatPrototype(combat, {
			dt: DT,
			firing: undefined,
			targetInCone: step.targetInCone,
			enemyFiring: step.enemyFiring,
			enemyHitAft: step.enemyHitAft,
		});
		frames++;
		if (step.enemyFiring) shooting++;
		if (range <= GUN_RANGE_KM) inGun++;
		closest = Math.min(closest, range);
		bestAspect = Math.max(bestAspect, dot(enemy.nose, bearing));
		lowest = Math.min(lowest, enemy.ship.pos.y);
		highest = Math.max(highest, enemy.ship.pos.y);
	}
	return {
		firingShare: (shooting / frames).toFixed(3),
		inGunShare: (inGun / frames).toFixed(3),
		closestKm: closest.toFixed(2),
		bestAspectDeg: (
			(Math.acos(Math.min(1, bestAspect)) * 180) /
			Math.PI
		).toFixed(2),
		verticalKm: (highest - lowest).toFixed(1),
	};
}

console.log(`gun range ${GUN_RANGE_KM} km, merge break ${MERGE_BREAK_KM} km`);
console.log(
	"seed    pressed 40 s: firing gun closest aspect vertical | tracked 45 s: firing gun closest aspect vertical",
);
for (const seed of SEEDS) {
	const p = fly(seed, 40, false);
	const t = fly(seed, 45, true);
	console.log(
		`${String(seed).padEnd(6)}  ${p.firingShare} ${p.inGunShare} ${p.closestKm} ${p.bestAspectDeg} ${p.verticalKm} | ${t.firingShare} ${t.inGunShare} ${t.closestKm} ${t.bestAspectDeg} ${t.verticalKm}`,
	);
}
