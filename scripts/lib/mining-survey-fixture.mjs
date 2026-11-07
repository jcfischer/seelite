/** Place the actual survey cue or Navigation readings for node #1148 review. */
export async function placeMiningSurvey(page, mode = "navigation") {
	return page.evaluate(async (mode) => {
		const A = await import("/src/asteroid-field.ts");
		const S = await import("/src/rock-survey.ts");
		const T = await import("/src/rock-target.ts");
		const D = await import("/src/deposit-state.ts");
		const Sim = await import("/src/sim.ts");
		const W = await import("/src/world-state.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const time = Math.max(g.world.gameTime, D.SURVEY_LIFETIME_H * 3600 + 100);
		Sim.advanceWorldClock(g.world, time - g.world.gameTime);
		g.commerceWorld = W.advanceTo(g.commerceWorld, time);
		g.keys.clear();
		g.view = "cockpit";
		g.setHeadLook("forward");
		g.fitPrototypeMiningLaser(true);
		g.targetId = null;
		g.stepSurvey(g.surveyFiguresFitted().dwellS);
		const draw = g.fields.find((field) => field.plan.profile === "charted");
		if (!draw) throw new Error("survey review requires a charted field");
		const contents = (rock) =>
			S.rockContents(
				g.world.system.record.seed,
				draw.plan.slot,
				draw.plan.profile,
				rock,
			);
		const rock = draw.rocks
			.filter((rock) => contents(rock).deepDir)
			.sort((a, b) => b.radiusKm - a.radiusKm)[0];
		if (!rock) throw new Error("survey review requires a deep deposit");
		const selectedId = T.rockTargetId(draw.plan, rock.slot);
		const selected = T.resolveRock(
			[draw],
			selectedId,
			g.world.ship.pos,
			g.world.gameTime,
		);
		const direction = T.rockDirectionNow(
			selected,
			contents(rock).deepDir,
			g.world.gameTime,
		);
		await window.__placeShipAt(
			{
				x: selected.pos.x + direction.x * (rock.radiusKm + 2),
				y: selected.pos.y + direction.y * (rock.radiusKm + 2),
				z: selected.pos.z + direction.z * (rock.radiusKm + 2),
			},
			selected.vel,
		);
		const V = g.nearScene.position.constructor;
		g.orientation.setFromUnitVectors(
			new V(0, 0, -1),
			new V(-direction.x, -direction.y, -direction.z),
		);
		g.targetId = selectedId;
		const dwell = g.surveyFiguresFitted().dwellS;
		const surveyStartedAt = g.world.gameTime;
		for (
			let elapsed = 0;
			elapsed < dwell + g.units.MAX_DT;
			elapsed += g.units.MAX_DT
		)
			g.step(g.units.MAX_DT);
		const surveyed = g.surveyState();
		if (
			surveyed.row?.surveyedAt === undefined ||
			surveyed.row.surveyedAt < surveyStartedAt ||
			!S.surveyReading(
				surveyed.contents,
				surveyed.row,
				g.world.gameTime,
				D.SURVEY_LIFETIME_H,
			)
		)
			throw new Error("survey review did not complete the held survey");
		const result = {
			selectedId,
			fieldId: draw.plan.id,
			nearIds: [],
			farId: null,
			expiredId: null,
			dropKm: T.ROCK_DROP_KM,
		};
		if (mode === "navigation") {
			const at = g.world.gameTime;
			const fresh = T.resolveRock([draw], selectedId, g.world.ship.pos, at);
			const refs = T.nearRocks([draw], fresh.pos, at, Infinity);
			const far = refs[refs.length - 1];
			const span = Math.hypot(
				fresh.pos.x - far.pos.x,
				fresh.pos.y - far.pos.y,
				fresh.pos.z - far.pos.z,
			);
			const offset = T.ROCK_DROP_KM - span / 2;
			if (!(span > 0 && offset > 0))
				throw new Error("survey review has no near/far pair");
			await window.__placeShipAt(
				{
					x: fresh.pos.x + ((fresh.pos.x - far.pos.x) / span) * offset,
					y: fresh.pos.y + ((fresh.pos.y - far.pos.y) / span) * offset,
					z: fresh.pos.z + ((fresh.pos.z - far.pos.z) / span) * offset,
				},
				fresh.vel,
			);
			g.updateLocalFrameBody();
			const near = T.nearRocks(
				[draw],
				g.world.ship.pos,
				at,
				T.ROCK_DROP_KM,
			).filter((ref) => ref.id !== selectedId && ref.id !== far.id);
			if (near.length < 3)
				throw new Error("survey review needs three nearby rocks");
			for (const ref of [...near.slice(0, 2), far])
				g.putDepositRow(ref, { ...g.rockDepositRow(ref), surveyedAt: at });
			g.putDepositRow(near[2], {
				...g.rockDepositRow(near[2]),
				surveyedAt: at - D.SURVEY_LIFETIME_H * 3600,
			});
			result.nearIds = near.slice(0, 2).map((ref) => ref.id);
			result.farId = far.id;
			result.expiredId = near[2].id;
			g.leftTab = "Navigation";
			g.setHeadLook("left");
		}
		g.updateCockpit();
		for (let i = 0; i < 2; i++)
			await new Promise((resolve) => requestAnimationFrame(resolve));
		return {
			...result,
			at: g.world.gameTime,
			deep: g.deepCueRender,
			rows: g.navRows(),
		};
	}, mode);
}
