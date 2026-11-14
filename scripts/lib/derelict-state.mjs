/** Natural next loss, framed through the production pose. */
export async function placeDerelict(page) {
	return page.evaluate(async () => {
		const g = window.__seelite;
		const { nextDerelictViewWreck } = await import(
			"/scripts/lib/derelict-view-fixture.ts"
		);
		const { advanceTo } = await import("/src/world-state.ts");
		const { advanceSystem } = await import("/src/sim.ts");
		const { tetherPose } = await import("/src/derelict.ts");
		g.resetFlightToStart();
		g.clockHeld = true;
		g.photoMode = false;
		g.keys.clear();
		const system = g.world.system;
		const { key, at } = nextDerelictViewWreck(system);
		g.world.gameTime = at;
		advanceSystem(system, at);
		g.commerceWorld = advanceTo(g.commerceWorld, at);
		const wreck = g.derelictsAt().find((w) => w.key === key);
		if (!wreck) throw Error("no derelict at its next loss");
		const pose = wreck.pose;
		g.world.ship.pos = {
			x: pose.pos.x + 0.5,
			y: pose.pos.y + 0.15,
			z: pose.pos.z + 0.7,
		};
		g.world.ship.vel = { ...pose.vel };
		const dir = {
			x: pose.pos.x - g.world.ship.pos.x,
			y: pose.pos.y - g.world.ship.pos.y,
			z: pose.pos.z - g.world.ship.pos.z,
		};
		g.orientation.copy(
			g.shotRotation({ forward: dir, up: { x: 0, y: 1, z: 0 } }),
		);
		g.proximityFrameBodyId = pose.bodyId;
		g.assist = true;
		g.throttle = 0;

		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		g.view = "cockpit";
		g.headLook = "forward";
		g.render(0);
		return {
			key,
			hull: pose.hull,
			bodyId: pose.bodyId,
			at,
			instanceOrdinal: wreck.row.instanceOrdinal,
			containers: wreck.row.containers.map((c, i) => ({
				...c,
				...tetherPose(pose, i),
			})),
		};
	});
}
