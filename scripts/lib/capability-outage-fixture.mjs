/** Place the real docked console at a naturally disabled market, retaining an unrelated notice. */
export async function placeCapabilityOutage(page, recovered = false) {
	const fixture = await page.evaluate(async (recovered) => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const C = await import("/src/capability-slots.ts");
		g.clockHeld = true;
		const record = g.world.system.record;
		const station = g.world.system.contents.stations.find(
			(s) => s.type === "refinery",
		);
		if (!station)
			throw new Error("outage fixture requires its generated refinery");
		await window.__parkInBerth(station.id, g.berthIdsOfStation(station.id)[0], {
			headLook: "right",
		});
		const key = C.capabilitySlots(record.index, station).find(
			(s) => s.service === "market",
		).key;
		let at = g.world.gameTime;
		for (
			let attempts = 0;
			W.capabilityAvailability(g.commerceWorld, record.galaxy, key, at)
				.operational;
			attempts++
		) {
			if (attempts > 10000)
				throw new Error("outage fixture found no natural market outage");
			at += 100;
		}
		g.world.gameTime = at;
		g.commerceWorld = W.advanceTo(g.commerceWorld, at);
		if (recovered) {
			at = W.capabilityAvailability(
				g.commerceWorld,
				record.galaxy,
				key,
				at,
			).naturalEnd;
			g.world.gameTime = at;
			g.commerceWorld = W.advanceTo(g.commerceWorld, at);
		}
		(await import("/scripts/lib/commander-fixture.ts")).setCommanderFixture(g, {
			credits: 100000,
			cargo: { Food: 1 },
			fuelLy: 0,
		});
		g.stationConsoleMessage = "Cargo scoop fitted.";
		g.stationConsoleTab = "Market";
		g.stationConsoleRevision++;
		g.updateCockpit();
		return {
			key,
			stationId: station.id,
			at,
			availability: W.capabilityAvailability(
				g.commerceWorld,
				record.galaxy,
				key,
				at,
			),
		};
	}, recovered);
	await page.waitForFunction(
		() => (window.__seelite?.bakeQueue?.length ?? 0) === 0,
		undefined,
		{ timeout: 60_000 },
	);
	await page.evaluate(() => {
		window.__seelite.setHeadLook("forward");
		window.__seelite.updateCockpit();
	});
	return fixture;
}
