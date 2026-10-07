/** Owned wreck recovery: one row and hold change through the shared scoop gate. */
import { scoops } from "./raider-wreck";
import {
	type CommanderState,
	commanderHold,
	scoopCargo,
} from "./station-commerce";
import { type DerelictRow, PLAYER_SALVAGE } from "./world-state";
import type { Vec3 } from "./vec3";

export function scoopWreckContainer(
	row: DerelictRow,
	index: number,
	commander: CommanderState,
	entrustedT: number,
	container: { pos: Vec3; vel: Vec3 },
	ship: { pos: Vec3; vel: Vec3 },
	at: number,
) {
	const hold = commanderHold(commander, entrustedT);
	const freeT = hold.capacityT - hold.usedT;
	const unchanged = (refusal: string | null = null) => ({
		row,
		commander,
		tonnes: 0,
		freeT,
		refusal,
	});
	const item = row.containers[index];
	if (row.salvaged || !item || item.left <= 0 || !scoops(container, ship))
		return unchanged();
	if (item.kind === "fitting" && freeT < item.left)
		return unchanged(
			`Hold full: ${freeT} t free; ${item.left} t ${item.id} must be recovered whole.`,
		);
	const took = Math.max(
		0,
		item.kind === "fitting"
			? item.left
			: Math.min(item.left, Math.floor(freeT)),
	);
	if (took <= 0)
		return unchanged(
			"Hold full: " + freeT + " t free; " + item.id + " left in space.",
		);
	const next =
		item.kind === "good"
			? scoopCargo(commander, item.id, took, entrustedT).commander
			: {
					...commander,
					recoveredFittings: [
						...(commander.recoveredFittings ?? []),
						{ id: item.id, tonnes: took },
					],
				};
	const containers = row.containers.map((c, i) =>
		i === index ? { ...c, left: c.left - took } : { ...c },
	);
	return {
		row: {
			...row,
			containers,
			...(containers.every((c) => c.left === 0)
				? { salvaged: { at, cause: PLAYER_SALVAGE } }
				: {}),
		},
		commander: next,
		tonnes: took,
		freeT,
		refusal: null,
	};
}
