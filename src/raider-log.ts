/**
 * The Communications log's lifecycle lines (node #324 part d, and the pirate
 * relay's in #43).
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
import { raiderRegistry } from "./carrier-name";
import { raiderSlots } from "./raider-slots";
import type { GalaxyEnvelope } from "./world-state";

export interface RaiderLogLine {
	at: number;
	key: CarrierKey;
	text: string;
}

/**
 * One carrier's destroyed → under repair → back in service lines at
 * `gameTime`, oldest first, or none if it was never destroyed. One derivation
 * for every carrier the log names, so the relay's lines cannot read a
 * different schedule from the raider's.
 */
export function lifecycleLines(
	env: GalaxyEnvelope,
	key: CarrierKey,
	name: string,
	gameTime: number,
): RaiderLogLine[] {
	const episode = env.episodes[key];
	if (!episode || episode.initiating.kind !== "destroy") return [];
	const destroyedAt = episode.initiating.occurredAt;
	if (gameTime < destroyedAt) return [];
	const delta = env.objective[key];
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
	const lines: RaiderLogLine[] = [
		{ at: destroyedAt, key, text: `${name} destroyed` },
	];
	if (startsAt !== undefined && gameTime >= startsAt)
		lines.push({ at: startsAt, key, text: `${name} under repair` });
	if (completesAt !== undefined && gameTime >= completesAt)
		lines.push({ at: completesAt, key, text: `${name} back in service` });
	return lines;
}

/** Newest first; a tie keeps the order the lines were given in. */
export const newestFirst = (lines: RaiderLogLine[]): RaiderLogLine[] =>
	lines
		.map((line, i) => ({ line, i }))
		.sort((a, b) => b.line.at - a.line.at || a.i - b.i)
		.map(({ line }) => line);

/** The raider lines for one system at `gameTime`, newest first. */
export function raiderLog(
	env: GalaxyEnvelope,
	systemIndex: number,
	government: number,
	gameTime: number,
): RaiderLogLine[] {
	const lines: RaiderLogLine[] = [];
	for (const [ordinal, slot] of raiderSlots(systemIndex, government).entries())
		lines.push(...lifecycleLines(env, slot.key, raiderRegistry(ordinal), gameTime));
	return newestFirst(lines);
}

/** A log line as the console prints it: the game clock as `mm:ss`, then the
 *  text. Minutes are not wrapped at the hour. */
export function formatRaiderLogLine(line: RaiderLogLine): string {
	const m = Math.floor(line.at / 60);
	const s = Math.floor(line.at % 60);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}  ${line.text}`;
}
