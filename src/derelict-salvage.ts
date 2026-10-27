/** Owned wreck recovery: one row and hold change through the shared scoop gate. */
import { scoopAttempt, type ScoopGear } from "./raider-wreck";
import { SCOOP_REFUSAL_TEXT } from "./cargo-notice";
import {
	type CommanderState,
	commanderHold,
	recoverWreckCargo,
} from "./station-commerce";
import { type DerelictRow, PLAYER_SALVAGE } from "./world-state";
import type { Vec3 } from "./vec3";

export function scoopWreckContainer({
	row,
	index,
	commander,
	entrustedT,
	container,
	ship,
	gear,
	bankE,
	at,
	entrusted = false,
}: {
	row: DerelictRow;
	index: number;
	commander: CommanderState;
	entrustedT: number;
	container: { pos: Vec3; vel: Vec3 };
	ship: { pos: Vec3; vel: Vec3 };
	gear: ScoopGear;
	bankE: number;
	at: number;
	/** A named job item stays separate from every owned-cargo path. */
	entrusted?: boolean;
}) {
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
	if (row.salvaged || !item || item.left <= 0) return unchanged();
	const attempt = scoopAttempt(container, ship, gear, bankE);
	if (attempt === "out") return unchanged();
	if (attempt !== "take") return unchanged(SCOOP_REFUSAL_TEXT[attempt]);
	if ((entrusted || item.kind === "fitting") && freeT < item.left)
		return unchanged(
			`Hold full: ${freeT} t free; ${item.left} t ${item.id} must be recovered whole.`,
		);
	const recovery = entrusted
		? { tonnes: item.left, commander }
		: item.kind === "good"
			? recoverWreckCargo(commander, item.id, item.left, entrustedT)
			: {
					tonnes: item.left,
					commander: {
						...commander,
						recoveredFittings: [
							...(commander.recoveredFittings ?? []),
							{ id: item.id, tonnes: item.left, ...item.fitting },
						],
					},
				};
	const took = recovery.tonnes;
	if (took <= 0)
		return unchanged(
			"Hold full: " + freeT + " t free; " + item.id + " left in space.",
		);
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
		commander: recovery.commander,
		tonnes: took,
		freeT,
		refusal: null,
	};
}
