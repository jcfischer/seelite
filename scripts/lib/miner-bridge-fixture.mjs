/**
 * The Longwall in the view it mines from, for the bridge's probe and views
 * (https://github.com/jcfischer/seelite/issues/1198): a large deep-deposit
 * rock's mouth ahead, at half the struts' reach, with the drill stowed.
 */
export const placeAtRockFace = (page) =>
	page.evaluate(async () => {
		const { rockPose } = await import("/src/asteroid-field.ts");
		const { rockDirectionNow } = await import("/src/rock-target.ts");
		const { HULL_SPECS } = await import("/src/hull.ts");
		const { beamHit } = await import("/src/rock-extraction.ts");
		const { ANCHOR, seatPose } = await import("/src/rock-drill.ts");
		const { add, scale } = await import("/src/vec3.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const draw = g.fields[0];
		const rock = draw?.rocks.find(
			(r) =>
				g.rockContentsOf({ plan: draw.plan, rock: r }).deepT > 0 &&
				r.radiusKm > ANCHOR.gripRadiusKm,
		);
		if (!rock) throw new Error("the fixture needs a large deep-deposit rock");
		const id = `rock:${draw.plan.id}:${rock.slot}`;
		const ref = {
			id,
			plan: draw.plan,
			rock,
			...rockPose(draw.plan, rock, g.world.gameTime),
			distKm: 0,
		};
		const mouth = rockDirectionNow(
			ref,
			g.rockContentsOf(ref).deepDir,
			g.world.gameTime,
		);
		const hit = beamHit(
			add(ref.pos, scale(mouth, rock.radiusKm * 2)),
			scale(mouth, -1),
			g.rockTargets([ref]),
			rock.radiusKm * 3,
		);
		if (!hit) throw new Error("no mouth hit");
		const seat = seatPose(
			hit.point,
			hit.normal,
			{ x: 0, y: 1, z: 0 },
			HULL_SPECS.miner.cutter,
		);
		await window.__placeShipAt(
			add(seat.pos, scale(hit.normal, ANCHOR.reachKm * 0.5)),
			rockPose(draw.plan, rock, g.world.gameTime).vel,
		);
		g.setAttitude(seat.nose, seat.up);
		g.throttle = 0;
		g.view = "cockpit";
		g.targetId = id;
		return g.fireGroups.map((group) => group.label);
	});

/** Arm the drill on the real key and step the sim until it has deployed. */
export async function deployDrill(page, groupLabels) {
	for (let i = 0; i < groupLabels.length - 1; i++)
		await page.keyboard.press("b");
	await page.evaluate(async () => {
		const { DRILL } = await import("/src/rock-drill.ts");
		const g = window.__seelite;
		for (let t = 0; t < DRILL.deployS + 0.2; t += g.units.MAX_DT)
			g.step(g.units.MAX_DT);
	});
}
