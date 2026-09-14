/**
 * The Communications log's raider lines (node #324 part d).
 *
 * **Shown in the Communications log, by the principal's ruling**, so recovery
 * is visible and caused rather than a silent respawn (#41). Each line is
 * derived from world state: the slot's causal episode and its objective row.
 * The log keeps no store of its own (`persistent-world-state.md` §6). A kill
 * reads as three lines over its lifecycle: destroyed, under repair, and back
 * in service.
 *
 * The lines do not depend on whether world state has materialized the lazy
 * steps yet. Before materialization the destroyed row still carries its
 * schedule, and after it the episode carries the facts. Both give the same
 * times.
 */
import type { CarrierKey } from "./carrier-key";
import { raiderName, raiderSlots } from "./raider-slots";
import type { GalaxyEnvelope } from "./world-state";

export interface RaiderLogLine {
	at: number;
	key: CarrierKey;
	text: string;
}

/** The raider lines for one system at `gameTime`, newest first. */
export function raiderLog(
	env: GalaxyEnvelope,
	systemIndex: number,
	government: number,
	gameTime: number,
): RaiderLogLine[] {
	const lines: RaiderLogLine[] = [];
	for (const [ordinal, slot] of raiderSlots(
		systemIndex,
		government,
	).entries()) {
		const episode = env.episodes[slot.key];
		if (!episode || episode.initiating.kind !== "destroy") continue;
		const destroyedAt = episode.initiating.occurredAt;
		if (gameTime < destroyedAt) continue;
		const name = raiderName(ordinal);
		const delta = env.objective[slot.key];
		const startsAt =
			delta?.scheduled?.startsAt ??
			(episode.intervention?.kind === "replacement-start"
				? episode.intervention.occurredAt
				: undefined);
		const completesAt =
			delta?.scheduled?.completesAt ??
			(delta?.recovery?.kind === "replacement"
				? delta.recovery.completesAt
				: undefined) ??
			(episode.latest.kind === "replacement-complete"
				? episode.latest.occurredAt
				: undefined);
		lines.push({ at: destroyedAt, key: slot.key, text: `${name} destroyed` });
		if (startsAt !== undefined && gameTime >= startsAt)
			lines.push({ at: startsAt, key: slot.key, text: `${name} under repair` });
		if (completesAt !== undefined && gameTime >= completesAt)
			lines.push({
				at: completesAt,
				key: slot.key,
				text: `${name} back in service`,
			});
	}
	return lines.sort((a, b) => b.at - a.at);
}
