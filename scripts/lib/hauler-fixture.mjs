/** Seed 47/system 0/first hauler, shared by live probe and canonical ring views. */
export async function installHaulerFixture() {
	const g = window.__seelite;
	cancelAnimationFrame(g.animationFrame);
	g.clockHeld = true;
	const traffic = await import("/src/inter-system-traffic.ts");
	const system = await import("/src/system.ts");
	const sim = await import("/src/sim.ts");
	const witch = await import("/src/witchspace.ts");
	const crossing = await import("/src/witchspace-crossing.ts");
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
		// The ring's window is signed (#1006): it opens `openS` before the crossing,
		// so a frame taken before the instant is framed on the ring it is watching,
		// not on a hull that has not arrived — and not on the origin placeholder an
		// absent hauler carries in `route.pos`, which would point the camera at the
		// star. Both the framing and the caption read off this one anchor.
		const anchor =
			route.jump && crossing.npcRiftVisible(at - route.jump.atS)
				? route.jump.pos
				: route.pos;
		if (frame) {
			const activeJump = anchor === route.jump?.pos;
			const nose = (activeJump ? route.jump.nose : route.nose) ?? {
				x: 0,
				y: 0,
				z: -1,
			};
			const up = route.up ?? { x: 0, y: 1, z: 0 };
			const pos = anchor;
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
		const rift = g.trafficRifts.get(id);
		const alongNoseFrom = (origin) => {
			if (!contact || !route.jump || !origin) return null;
			const nose = route.jump.nose;
			return (
				((contact.pos.x - origin.x) * nose.x +
					(contact.pos.y - origin.y) * nose.y +
					(contact.pos.z - origin.z) * nose.z) /
				Math.hypot(nose.x, nose.y, nose.z)
			);
		};
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
			rift: rift?.strength ?? 0,
			flare: rift?.flare ?? 0,
			riftRadiusKm: rift?.radiusKm ?? 0,
			// The drawn hull's sim origin relative to the actual ring plane, along
			// the ship's nose: negative behind it, positive through it (#1006 C2).
			// The ring is offset from the lane point in opposite directions for an
			// arrival and a departure; only the rendered anchor owns that placement.
			// Null without both a contact and a ring to measure.
			hullThroughPlaneKm: alongNoseFrom(rift?.anchor),
			// Settling at the lane point is a different claim from passing the ring.
			hullFromLanePointKm: alongNoseFrom(route.jump?.pos),
			berthId: route.berthId,
			queue: route.queueRequest,
			terminal: route.terminalStationId,
			// Measured to what the camera was framed on — the ring while one is
			// open, the hull otherwise — because for an absent hauler those are
			// 150 million km apart and only one of them is on the frame.
			cameraRangeKm: Math.hypot(
				anchor.x - g.world.ship.pos.x,
				anchor.y - g.world.ship.pos.y,
				anchor.z - g.world.ship.pos.z,
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
		// The crossing's own clock, handed back rather than re-typed by the caller:
		// a probe that wrote 1.5 by hand would keep passing if the dial moved.
		crossing: { ...crossing.CROSSING },
	};
}
