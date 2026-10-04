/** Seed 47/system 0/first hauler, shared by live probe and canonical ring views. */
export async function installHaulerFixture() {
	const g = window.__seelite;
	cancelAnimationFrame(g.animationFrame);
	g.clockHeld = true;
	const traffic = await import("/src/inter-system-traffic.ts");
	const system = await import("/src/system.ts");
	const sim = await import("/src/sim.ts");
	const witch = await import("/src/witchspace.ts");
	const contents = new Map();
	const get = (i) => {
		if (!contents.has(i))
			contents.set(
				i,
				system.generateContents(
					g.world.galaxy.systems.find((r) => r.index === i),
				),
			);
		return contents.get(i);
	};
	const plan = traffic
		.buildHaulerPlans(g.world.galaxy, 0, get)
		.find((p) => p.vocation === "hauler");
	if (!plan) throw new Error("missing named hauler fixture");
	const voyage = traffic.haulerVoyage(plan, 0);
	const sample = (at, frame = true, framing = "ring") => {
		g.world.gameTime = at;
		sim.advanceSystem(g.world.system, at);
		let tries = 0;
		do {
			g.trafficTick = Number.NaN;
			g.updateTrafficAuthority();
			if (++tries > 10000) throw new Error("hauler warm-up did not finish");
		} while (!g.trafficAuthorityReady());
		const route = g.trafficRoutes.find((r) => r.key === plan.actor.key);
		if (!route) throw new Error("fixture route absent");
		if (frame) {
			const activeJump =
				route.jump &&
				at >= route.jump.atS &&
				at < route.jump.atS + witch.WITCHSPACE.riftEndS;
			const nose = (activeJump ? route.jump.nose : route.nose) ?? {
				x: 0,
				y: 0,
				z: -1,
			};
			const up = route.up ?? { x: 0, y: 1, z: 0 };
			const pos = activeJump ? route.jump.pos : route.pos;
			// Exterior camera near the ring, with no cabin or player hull in its way.
			const range = 0.24;
			g.world.ship.pos = {
				x: pos.x - nose.x * range + up.x * range * 0.25,
				y: pos.y - nose.y * range + up.y * range * 0.25,
				z: pos.z - nose.z * range + up.z * range * 0.25,
			};
			if (framing === "player-lane-point") {
				const current = g.world.system.record,
					other =
						current.index === plan.homeRecord.index
							? g.world.galaxy.systems.find(
									(r) => r.index === voyage.destinationSystemIndex,
								)
							: plan.homeRecord;
				g.world.ship.pos = system.arrivalPoint(
					current,
					get(current.index),
					other.pos,
					route.jump?.atS ?? at,
				);
			}
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			g.frameBody = null;
			const target = {
				x: pos.x - g.world.ship.pos.x,
				y: pos.y - g.world.ship.pos.y,
				z: pos.z - g.world.ship.pos.z,
			};
			g.setAttitude(target, up);
			g.view = "cockpit";
			g.setHeadLook("forward");
			g.targetId = plan.actor.key;
			g.cockpit.mesh.visible = false;
			// Hide cabin descendants: render owns the roots' flags on each frame.
			window.__haulerCabinVisibility ??= g.cockpit.mesh.children.map(
				(child) => [child, child.visible],
			);
			for (const [child, visible] of window.__haulerCabinVisibility)
				child.visible = framing === "player-lane-point" ? visible : false;
			for (const child of g.shipMesh.children) child.visible = false;
			// Clock sampling is discontinuous; presentation interpolation is meaningful
			// only between adjacent authority ticks.
			g.trafficPreviousRoutes.clear();
			g.trafficPreviousProjectionAtS = g.trafficProjectionAtS;
			let faces = 0;
			while (g.bakeQueue.length) {
				if (++faces > 1000)
					throw new Error("hauler fixture bake did not settle");
				g.stepBakes();
			}
			g.render(0);
		}
		const contact = g.trafficContacts.get(plan.actor.key);
		const id = route.key + "|" + route.jump?.kind + "|" + route.jump?.atS;
		return {
			at,
			key: plan.actor.key,
			name: g.drawnName(plan.actor),
			hull: plan.actor.hullId,
			phase: route.phase,
			pos: route.pos,
			chargeAu: route.chargeAu,
			contact: !!contact,
			jump: route.jump ?? null,
			rift: g.trafficRifts.get(id)?.strength ?? 0,
			berthId: route.berthId,
			queue: route.queueRequest,
			terminal: route.terminalStationId,
			cameraRangeKm: Math.hypot(
				route.pos.x - g.world.ship.pos.x,
				route.pos.y - g.world.ship.pos.y,
				route.pos.z - g.world.ship.pos.z,
			),
		};
	};
	const follow = () => {
		const dest = g.world.galaxy.systems.find(
			(r) => r.index === voyage.destinationSystemIndex,
		);
		g.performJump(dest);
		if (g.world.system.record.index !== dest.index)
			throw new Error("player follow jump refused: " + g.jumpNotice);
		g.setWitchspace(witch.idleWitchspace());
		g.clearArrivalRift();
	};
	window.__haulerFixture = { plan, voyage, sample, follow };
	return {
		key: plan.actor.key,
		name: g.drawnName(plan.actor),
		hull: plan.actor.hullId,
		home: 0,
		to: voyage.destinationSystemIndex,
		departure: plan.actor.schedule.departureAtS,
		tOut: voyage.tOut,
		tBack: voyage.tBack,
	};
}
