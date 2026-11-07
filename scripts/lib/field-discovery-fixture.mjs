/** Place a real unknown/known field and its existing regional sweep panel. */
export async function placeFieldDiscovery(page, mode = "unknown") {
	const facts = await page.evaluate(async (mode) => {
		const A = await import("/src/asteroid-field.ts");
		const L = await import("/src/loadout.ts");
		const M = await import("/src/market.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		g.keys.clear();
		g.resetDock();
		g.dockingComputer.disengage();
		g.regime = "normal";
		g.spoolLeftS = 0;
		g.setThrottle(0);
		g.assist = false;
		g.targetId = null;
		const plan = A.systemFields(
			g.world.system.record,
			g.world.system.contents,
		).find((p) => p.profile === "rare");
		if (!plan)
			throw new Error("discovery fixture requires a generated rare field");
		const at = g.world.gameTime;
		const centre = A.fieldCentre(plan, at);
		const velocity = A.fieldCentreVelocity(plan, at);
		await window.__placeShipAt(
			{
				x: centre.x,
				y: centre.y,
				z: centre.z + 1001,
			},
			{ ...velocity, z: velocity.z - (mode === "known" ? 60 : 0) },
		);
		g.setAttitude({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
		g.step(g.units.MAX_DT);
		g.leftTab = "Navigation";
		g.setHeadLook("left");
		if (mode === "lead") {
			g.commander.loadout = L.migrateEquipment(g.commander.hull, [
				...L.equipmentNames(g.commander.loadout),
				M.LONG_RANGE_SCANNER,
			]).loadout;
			g.leftTab = "Sweep";
		}
		g.updateCockpit();
		return {
			fieldId: plan.id,
			at: g.world.gameTime,
			known: [
				...(g.commerceWorld.galaxies[g.world.system.record.galaxy]
					.fieldDiscoveries ?? []),
			],
			mode,
		};
	}, mode);
	if (mode === "lead") {
		await page.locator("[data-live-sweep-action]").click();
		await page.evaluate(async () => {
			const { SWEEP_CHARGE_S } = await import("/src/system-sweep.ts");
			const g = window.__seelite;
			for (
				let elapsed = 0;
				elapsed <= SWEEP_CHARGE_S;
				elapsed += g.units.MAX_DT
			)
				g.step(g.units.MAX_DT);
			g.updateCockpit();
		});
	}
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);
	return facts;
}
