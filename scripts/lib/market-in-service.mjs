/**
 * Move the clock to the end of a station's market outage, when one is running.
 * Since mining's release a generated outage can have a market down at boot (the
 * seed-42 trade station's is, until t≈228 s), and a probe that trades there
 * would read "The market service is damaged." in place of what it measures.
 * The clock stops at the outage's natural end, never past it. With no
 * `stationId`, the system's first trade station.
 */
export function marketInService(page, stationId = null) {
	return page.evaluate(async (id) => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const C = await import("/src/capability-slots.ts");
		const Sim = await import("/src/sim.ts");
		const record = g.world.system.record;
		const station = g.world.system.contents.stations.find((s) =>
			id === null ? s.type === "trade" : s.id === id,
		);
		if (!station) throw new Error(`market-in-service: no station ${id}`);
		const key = C.capabilitySlots(record.index, station).find(
			(slot) => slot.service === "market",
		)?.key;
		if (!key) throw new Error(`market-in-service: ${id} has no market`);
		const availability = () =>
			W.capabilityAvailability(
				g.commerceWorld,
				record.galaxy,
				key,
				g.world.gameTime,
			);
		const from = g.world.gameTime;
		const outage = availability();
		if (!outage.operational) {
			Sim.advanceWorldClock(g.world, outage.naturalEnd - from);
			g.adoptWorld(W.advanceTo(g.commerceWorld, g.world.gameTime));
		}
		if (!availability().operational)
			throw new Error(`market-in-service: ${id}'s market is still down`);
		return { stationId: station.id, waitedS: g.world.gameTime - from };
	}, stationId);
}
