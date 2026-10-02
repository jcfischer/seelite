/**
 * What the pilot's hands ask of the translation vents (#620,
 * `flight-model.md` §3.5 and §3.6).
 *
 * `main.ts` reads the held commands and the pad; this turns them into the
 * `LinearDemand` the sim composes into vent firings, and the single vents a
 * bound slot command fires directly. Pure, so the two regimes' meanings are
 * checked headless rather than read off a flown frame.
 *
 * The slot commands themselves are the registry's (`VENT_COMMANDS` in
 * `commands.ts`): this module reads the registry and the registry reads
 * nothing of it.
 *
 * Headless, and on the list in `tests/headless.test.ts`.
 */
import { type CommandId, VENT_COMMANDS } from "./commands";
import type { LinearDemand, VentLevels } from "./sim";

/** The four strafe commands, on the arrows on the shipped layout (§3.5). */
export const STRAFE_COMMANDS = [
	"fly.strafePort",
	"fly.strafeStarboard",
	"fly.strafeDorsal",
	"fly.strafeVentral",
] as const satisfies readonly CommandId[];

/** The vents whose commands are held this frame, each at full (§3.5). A slot
 *  the flown hull leaves empty does nothing in the sim. */
export function heldVents(held: (id: CommandId) => boolean): VentLevels {
	const out: VentLevels = {};
	for (const { slot, id } of VENT_COMMANDS) if (held(id)) out[slot] = 1;
	return out;
}

/**
 * What the hands hold this frame. `throttle` is the speed lever, 0…1; the
 * pad's two figures are already deadzoned and suspended where the context
 * does not fly (#283's F3, `padFlightAxes`).
 */
export interface PilotHands {
	readonly assist: boolean;
	readonly throttle: number;
	/** `fly.throttleUp` held: `shift` on the shipped layout. */
	readonly fore: boolean;
	/** `fly.throttleDown` held: `control` on the shipped layout. */
	readonly aft: boolean;
	readonly port: boolean;
	readonly starboard: boolean;
	readonly dorsal: boolean;
	readonly ventral: boolean;
	/** The triggers, `r2 − l2`. */
	readonly padTrim: number;
	/** The left stick's vertical axis, positive up. */
	readonly padHeave: number;
}

/**
 * The hands as the layout holds them: one predicate per command, the same
 * one `heldVents` takes, so the command-to-field table is here once rather
 * than in `main.ts` beside a gate on every field.
 */
export function pilotHands(
	held: (id: CommandId) => boolean,
	rest: Pick<PilotHands, "assist" | "throttle" | "padTrim" | "padHeave">,
): PilotHands {
	return {
		...rest,
		fore: held("fly.throttleUp"),
		aft: held("fly.throttleDown"),
		port: held("fly.strafePort"),
		starboard: held("fly.strafeStarboard"),
		dorsal: held("fly.strafeDorsal"),
		ventral: held("fly.strafeVentral"),
	};
}

const unit = (x: number) => Math.max(-1, Math.min(1, x));
const pair = (plus: boolean, minus: boolean) =>
	(plus ? 1 : 0) - (minus ? 1 : 0);

/**
 * §3.6's two meanings, by the principal's ruling:
 *
 * - **Assist on**: `surge` is the speed lever, which the held keys and the
 *   triggers move in `main.ts` as before; a held strafe is a lateral velocity
 *   demand.
 * - **Assist off**: every held key is a force on its axis. `shift` fires the
 *   main drive and `control` the retro vents while held, and released the
 *   drive stops — the lever is not a force.
 *
 * **Not ruled, and taken here as the conservative reading (#620):** with the
 * assist off the lever does not move, so turning the assist back on resumes
 * the speed it was set to; and the triggers are an analog force on the same
 * axis as the keys, because a trim of a lever that does not act would be an
 * input that visibly does nothing.
 */
export function pilotDemand(h: PilotHands): LinearDemand {
	return {
		surge: h.assist ? unit(h.throttle) : unit(pair(h.fore, h.aft) + h.padTrim),
		sway: unit(pair(h.starboard, h.port)),
		heave: unit(pair(h.dorsal, h.ventral) + h.padHeave),
	};
}
