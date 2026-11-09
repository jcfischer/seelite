/** Stand the camera at a canonical view of the production field (#1209): the
 * approved study's far, side, overview and dense stands, in the field's own
 * frame, with the hull hidden so the arrangement is what the frame shows. */
export async function placeAsteroidField(page, profile, stand, view = "chase") {
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 180000,
		},
	);
	return page.evaluate(
		async ({ profile, stand, view }) => {
			const A = await import("/src/asteroid-field.ts");
			const F = await import("/scripts/lib/field-stands.mjs");
			const g = window.__seelite;
			const draw = g.fields.find((d) => d.plan.profile === profile);
			if (!draw) throw new Error(`system has no ${profile} field`);
			if (draw.shapes !== "authored")
				throw new Error(`field is drawing ${draw.shapes} rocks`);
			g.clockHeld = true;
			g.chaseYaw = 0;
			g.chaseElevation = 0;
			g.targetId = null;
			g.setHeadLook("forward");
			const close = stand === "close";
			g.view = close ? view : "chase";
			if (!close)
				for (const child of g.shipMesh.children) child.visible = false;
			const { plan, rocks } = draw;
			const at = (rock) => A.rockLocal(rock, g.world.gameTime);
			const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			let target = { x: 0, y: 0, z: 0 };
			let local = {
				far: { x: -224, y: 0, z: 0 },
				side: { x: 0, y: -160, z: 0 },
				overview: { x: -110, y: -90, z: 70 },
			}[stand];
			if (close) {
				const big = rocks.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));
				target = at(big);
				local = { ...target, x: target.x - 2.5 * big.radiusKm };
			}
			if (stand === "dense") {
				target = at(F.densestRock(rocks).rock);
				local = F.clearStandBeside(target, (p) =>
					rocks.every((r) => dist(p, at(r)) > r.radiusKm + 0.1),
				);
				if (!local) throw new Error("no clear dense stand");
			}
			const span = dist(target, local);
			const direction = A.rotateByQuat(plan.rotation, {
				x: (target.x - local.x) / span,
				y: (target.y - local.y) / span,
				z: (target.z - local.z) / span,
			});
			const V = g.nearScene.position.constructor;
			g.orientation.setFromUnitVectors(
				new V(0, 0, -1),
				new V(direction.x, direction.y, direction.z),
			);
			for (let i = 0; i < 40; i++) {
				const centre = A.fieldCentre(plan, g.world.gameTime);
				const offset = A.rotateByQuat(plan.rotation, local);
				const have = g.cameraPos();
				g.world.ship.pos = {
					x: g.world.ship.pos.x + centre.x + offset.x - have.x,
					y: g.world.ship.pos.y + centre.y + offset.y - have.y,
					z: g.world.ship.pos.z + centre.z + offset.z - have.z,
				};
				g.render(0);
			}
			return {
				shadowGate: g.occlusionState.open,
				aoGate: g.occlusionState.aoOpen,
				fieldId: plan.id,
				rocks: rocks.length,
				within8Km: rocks.filter((r) => dist(at(r), local) < 8).length,
				levels: [...draw.perLevel],
			};
		},
		{ profile, stand, view },
	);
}
