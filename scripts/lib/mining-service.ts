import {
	capabilityIdentity,
	capabilitySlots,
} from "../../src/capability-slots";
import {
	capabilityRates,
	initialCapabilityTime,
	projectCapabilityTime,
} from "../../src/capability-time";
import { raiderSlots } from "../../src/raider-slots";
import { newWorld, operationalDuration } from "../../src/world-state";
import type { Port } from "./greedy-trader";

/** Undamaged-world service calendar; every boundary is checked against production world queries. */
export function serviceCalendar(
	seed: number,
	galaxy: number,
	port: Port,
	end: number,
) {
	if (!Number.isFinite(end) || end < 0)
		throw new Error("mining service: invalid horizon");
	const slot = capabilitySlots(port.record.index, port.station).find(
		(s) => s.service === "exclusive",
	);
	if (!slot) throw new Error("mining service: no refinery capability");
	const identity = capabilityIdentity(seed, galaxy, slot.key);
	const total = raiderSlots(identity.systemIndex, identity.government).length;
	const context = {
		seed: identity.seed,
		government: identity.government,
		total,
		active: total,
	};
	const world = newWorld(seed);
	world.gameTime = end;
	let state = initialCapabilityTime(context, 0),
		sum = 0;
	const intervals: { from: number; to: number; operational: boolean }[] = [];
	while (state.at < end) {
		const from = state.at;
		const to = Math.min(
			end,
			state.phase === "down"
				? state.endsAt!
				: state.at + state.left / capabilityRates(context).multiplier,
		);
		const projection = projectCapabilityTime(context, state, to);
		intervals.push({
			from,
			to,
			operational: state.phase === "up" || state.repaired,
		});
		sum += projection.operational;
		if (
			Math.abs(sum - operationalDuration(world, galaxy, slot.key, 0, to)) > 1e-6
		)
			throw new Error(
				"mining service: calendar disagrees with production world",
			);
		if (to <= from) throw new Error("mining service: non-progressing calendar");
		state = projection.state;
	}
	return (from: number, to: number) => {
		if (
			!Number.isFinite(from) ||
			!Number.isFinite(to) ||
			from < 0 ||
			to < from ||
			to > end
		)
			throw new Error("mining service: invalid interval");
		return intervals.reduce(
			(n, i) =>
				n +
				(i.operational
					? Math.max(0, Math.min(to, i.to) - Math.max(from, i.from))
					: 0),
			0,
		);
	};
}
