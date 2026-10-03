// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.

/**
 * The framing vocabulary the canonical view set is aimed with.
 *
 * `probe-guard.mjs` owns the two placers with more than one consumer —
 * `__placeShipAt` and `__viewAlongAxis`. Everything here has exactly one, and
 * putting it beside them made `probe-station-visuals.mjs` inject a
 * Fibonacci-sphere search and sun-angle trigonometry into every page it opens,
 * none of which it calls. So the split follows the consumers rather than the
 * subject matter, and this file builds on that one.
 *
 * Install after `installViewPlacement` and before `page.goto`; both re-run on
 * every navigation, and `__sunOffset` calls `__placeShipAt` across the seam.
 */
export async function installViewFraming(page) {
	await page.addInitScript(() => {
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
		const norm = (v) => {
			const l = Math.hypot(v.x, v.y, v.z);
			return { x: v.x / l, y: v.y / l, z: v.z / l };
		};

		/**
		 * Start both runs of a before/after pair from the same world clock.
		 *
		 * One assignment, not a standing hold. Holding it every frame was tried
		 * first and is worse than not pinning at all: with the clock nailed down
		 * the bodies are re-placed at the same `t` each frame while the ship keeps
		 * its own state, and a camera placed 7.44 km off a station ended up 0.66 km
		 * off it — on its hull — in four frames. What actually holds a framing is
		 * placing the camera *co-moving* with its subject; the clock only has to
		 * start in the same place.
		 *
		 * So the clock runs during a capture, and each shot records the time it was
		 * taken at rather than the sheet claiming a time none of them has.
		 */
		/**
		 * Dock at one station, in one **named** berth, and stop at a named point
		 * of the traversal (`docking.md` §13).
		 *
		 * **The berth is forced through the traffic seam, not through a back
		 * door.** §13.2 allocates the least spare free berth and rotates equal
		 * fits by request time, so a capture that merely asked for clearance
		 * would get a different berth every run and a before/after pair would
		 * compare two rooms. `berthOccupancy` is the injected map §6.1 left for
		 * exactly this — filling it with every *other* berth leaves the wanted
		 * one as the only thing that fits, and the grant comes out of the same
		 * allocation a player's does.
		 *
		 * **Flown by the docking computer**, not teleported into the berth: the
		 * frames are of the arrival the game runs. `stopAtArrivalFraction`
		 * freezes part-way through the traversal; `launch` runs the dock and then
		 * leaves again.
		 */
		window.__parkInBerth = async (stationId, berthId, opts = {}) => {
			const g = window.__seelite;
			// Canonical visual fixtures own their berth layout. Dynamic Traffic is
			// verified by its own live route probe; leaving it enabled here lets a
			// scheduled carrier invalidate the deliberately forced visual berth.
			g.clearTrafficPresentation();
			g.trafficSystemIndex = g.world.system.record.index;
			g.trafficActors = [];
			g.trafficTick = Math.floor(g.world.gameTime * 10);
			g.updateTrafficAuthority = () => {};
			g.updateTrafficPresentation = () => {};
			// **Leave any dock first, and this is not housekeeping.** A docked or
			// traversing session *places* the ship every frame (§12.6's
			// obligation 9), so a teleport onto another station's axis is undone
			// on the next tick — the shipyard frame came back 115 km from the
			// shipyard, with the ship still flying the trade station's launch.
			// Skipping is unconditional on both traversals since §13.3, so this
			// needs no flag.
			const dt = 1 / 60;
			for (let i = 0; i < 60 * 60 && g.dockPhase !== "flying"; i++) {
				if (g.dockPhase === "docked") g.launch();
				g.skipDockTraversal();
				g.step(dt);
			}
			if (g.dockPhase !== "flying")
				throw new Error(
					`__parkInBerth: could not leave the previous dock (${g.dockPhase})`,
				);
			const others = g
				.berthIdsOfStation(stationId)
				.filter((id) => id !== berthId);
			if (others.length + 1 !== g.berthIdsOfStation(stationId).length)
				throw new Error(
					`__parkInBerth: no berth "${berthId}" at ${stationId} — ` +
						"the view set names a berth this station does not have",
				);
			g.berthOccupancy.set(stationId, new Set(others));
			const snap = g.dockingSnapshot(stationId);
			// Outside §7's computer standoff, on the axis, co-moving.
			await window.__viewAlongAxis(stationId, snap.planeKm + 4.5, {
				comoving: true,
			});
			g.targetId = stationId;
			const requested = g.requestDockingClearance();
			if (requested.state?.clearance?.kind !== "granted")
				throw new Error(
					`__parkInBerth: clearance at ${stationId} came back ` +
						`${JSON.stringify(requested.state?.clearance)} for ${berthId}, ` +
						`occupied ${[...others].join(",")}, ` +
						`held ${requested.state?.berthId}`,
				);
			if (!g.dockingComputer.engaged) {
				// A new ship has no docking computer (#408): fit the one this flies.
				if (!g.hasDockingComputer)
					g.commander = {
						...g.commander,
						ownedEquipment: [
							...g.commander.ownedEquipment,
							g.dockingComputerName,
						],
					};
				g.toggleDockingComputer();
			}
			// Sub-stepped in sim rather than by animation frames: a capture must
			// not depend on how fast the machine renders.
			let arrivingFor = 0;
			for (let i = 0; i < 60 * 240; i++) {
				g.step(dt);
				const now = g.dockingSnapshot(stationId);
				// **Re-engage if the autopilot drops out**, which is what a player
				// would do and what §7 leaves them to do: the computer disengages
				// silently — §8's cue belongs to the HUD node — and a capture that
				// froze on the first drop-out would produce a frame of a ship
				// hanging a kilometre short of a station it was cleared for.
				if (now.dockPhase === "flying" && !now.computerEngaged) {
					if (!now.grantLive) g.requestDockingClearance();
					{
						// A new ship has no docking computer (#408): fit the one this flies.
						if (!g.hasDockingComputer)
							g.commander = {
								...g.commander,
								ownedEquipment: [
									...g.commander.ownedEquipment,
									g.dockingComputerName,
								],
							};
						g.toggleDockingComputer();
					}
				}
				if (now.dockPhase === "arriving") {
					arrivingFor += dt;
					// **The law's own duration, not the near figure.** §13.3 prices
					// a traversal on its route, so a deep berth runs about nine
					// seconds where a near one runs six — scaled by the near
					// constant, a declared `at: 0.75` to a deep berth froze at half
					// the route.
					const durationS = g.dockTraversalSeconds;
					if (
						typeof opts.stopAtArrivalFraction === "number" &&
						durationS !== null &&
						arrivingFor >= durationS * opts.stopAtArrivalFraction
					)
						break;
				}
				if (now.dockPhase === "docked") break;
			}
			const settled = g.dockingSnapshot(stationId);
			if (settled.berthId !== berthId)
				throw new Error(
					`__parkInBerth: asked for ${berthId} and got ${settled.berthId} — ` +
						"the forced occupancy did not reach the allocator",
				);
			// **The phase too, not the berth alone.** The berth is set at
			// clearance and says only that the reservation landed; a run that
			// never reached the station keeps it. That is exactly how a frame
			// went unnoticed — the assertion passed 115 km away.
			const reached =
				opts.stopAtArrivalFraction !== undefined ? "arriving" : "docked";
			if (settled.dockPhase !== reached)
				throw new Error(
					`__parkInBerth: wanted ${reached} at ${stationId} and the session ` +
						`is ${settled.dockPhase}, ${settled.rangeKm.toFixed(1)} km out; ` +
						`clearance ${settled.clearance.kind}, ` +
						`computer refused ${settled.computerRefusal ?? "-"}`,
				);
			if (opts.launch) {
				// A launch frame is of a ship that docked first: `g.launch()` is a
				// no-op from any other phase, so without the row above this would
				// capture a ship that never arrived.
				g.launch();
				for (let i = 0; i < Math.round(60 * (opts.launchSeconds ?? 2)); i++)
					g.step(dt);
				const flying = g.dockingSnapshot(stationId);
				if (flying.dockPhase !== "launching")
					throw new Error(
						`__parkInBerth: asked for a launch and the session is ` +
							`${flying.dockPhase}`,
					);
			}
			g.setHeadLook(opts.headLook ?? "forward");
			await frame();
			await frame();
			return settled.dockPhase;
		};

		/**
		 * The station workbench, framed from **inside** one role's bay.
		 *
		 * §13.6's seventh frame is an outpost interior, and no system generates
		 * an outpost (§12.7's joint 5) — so the only place one exists is
		 * `?model-viewer=station`. The stage is an orbit camera looking at the
		 * origin, and the bay spans the origin, so a small enough orbit radius
		 * puts the camera inside it looking down the lane at the end bulkhead.
		 *
		 * **Oblique, not down the axis.** The stage always looks at the origin, so
		 * a camera on the axis sees the end bulkhead square on and the bulkhead
		 * fills the frame flat — the bay is wider than it is deep. An azimuth and
		 * an elevation put the camera near a wall looking across the bay, which
		 * is the berth's own viewpoint and shows the far corner, the pads and the
		 * mouth at the edge.
		 */
		window.__frameWorkbenchInterior = async (
			asset,
			distanceRadii,
			azimuth = 0,
			elevation = 0,
			/**
			 * Which form to frame. **Named by the shot rather than left to the
			 * workbench**, which opens on the first variant in the list: the
			 * outpost frame showed the Derrick for as long as `a` was the
			 * selected form and would have gone on showing it after #257 chose
			 * `d`, so the one view of a role the game never generates would
			 * have drifted from the role.
			 */
			variant = "a",
		) => {
			const button = document.querySelector(`[data-model-asset="${asset}"]`);
			if (!button)
				throw new Error(
					`__frameWorkbenchInterior: no "${asset}" on the station workbench`,
				);
			button.click();
			const variantButton = document.querySelector(
				`[data-model-variant="${variant}"][data-model-role="${asset}"]`,
			);
			if (!variantButton)
				throw new Error(
					`__frameWorkbenchInterior: no "${asset}" variant "${variant}"`,
				);
			variantButton.click();
			const viewer = window.__seeliteModelViewer;
			if (!viewer)
				throw new Error("__frameWorkbenchInterior: the workbench is not up");
			viewer.state.distance = distanceRadii;
			viewer.state.azimuth = azimuth;
			viewer.state.elevation = elevation;
			await frame();
			await frame();
			return asset;
		};

		window.__startClockAt = async (t) => {
			window.__seelite.world.gameTime = t;
			await frame();
			await frame();
		};

		window.__bodyById = (id) =>
			window.__seelite.world.system.bodies.find((b) => b.id === id) ?? null;

		/**
		 * The radius a subject's framing is measured in.
		 *
		 * Throws on an unknown id rather than returning null, because every caller
		 * multiplies the result by a radii count: a null becomes NaN, the ship is
		 * placed at NaN, and the shot is silently garbage instead of an error
		 * naming the id that was mistyped.
		 */
		window.__radiusOf = (id) => {
			const g = window.__seelite;
			const body = window.__bodyById(id);
			if (!body)
				throw new Error(
					`__radiusOf: no body "${id}" in this system — the view set names a subject the seed does not have`,
				);
			return body.kind === "station"
				? g.visualOfStation(id).silhouetteKm
				: body.radiusKm;
		};

		/**
		 * The velocity a camera must carry to hold a framing on `bodyId`.
		 *
		 * Stations only, and that is not an omission. `Game.stationVelocity` is the
		 * one velocity the page exposes, and it is the one that matters: a 0.62 km
		 * station carried at ~30 km/s leaves frame in four frames, where a
		 * 33,000 km gas giant framed from 132,000 km moves 30 km in a second —
		 * under a pixel. Returning `undefined` for a planet is therefore the right
		 * answer rather than a missing one.
		 */
		window.__frameVelocityOf = (bodyId) => {
			const body = window.__bodyById(bodyId);
			return body && body.kind === "station"
				? window.__seelite.stationVelocity(bodyId)
				: undefined;
		};

		/** Turn the camera from where the ship already is toward a sim point. */
		window.__lookAt = async (target) => {
			const g = window.__seelite;
			const p = g.world.ship.pos;
			const d = norm({
				x: target.x - p.x,
				y: target.y - p.y,
				z: target.z - p.z,
			});
			const from = g.nearScene.position.clone().set(0, 0, -1);
			const to = g.nearScene.position.clone().set(d.x, d.y, d.z);
			g.orientation.setFromUnitVectors(from, to);
			await frame();
		};

		/**
		 * Stand `radii` subject-radii off `bodyId`, at `sunAngleDeg` between the
		 * star and the camera as seen from the subject, and look at it.
		 *
		 * Sim space is star-centred (`sim.ts` §7.4), so the subject's direction to
		 * the star is simply the reverse of its own position. Zero degrees puts
		 * the camera on the star's side and the subject fully lit; 180 puts the
		 * star beyond the subject and the subject a silhouette.
		 *
		 * **Co-moving, like `__viewAlongAxis`.** The first version of this placed
		 * the ship at rest and shipped, because the two station views it frames are
		 * at 8 radii rather than 3 and the drift was not obvious in the PNG. It is
		 * the same 30 km/s the axis placer already had to answer for; a framing
		 * held on one path and not the other is worse than one held on neither,
		 * because the sheet says both are held.
		 *
		 * The perpendicular is built from whichever world axis is least parallel
		 * to the sun line, so the frame never degenerates — a fixed choice of
		 * axis collapses for any subject that happens to lie along it, and which
		 * subjects those are is a property of the seed.
		 */
		window.__sunOffset = async (bodyId, radii, sunAngleDeg) => {
			const body = window.__bodyById(bodyId);
			const sun = norm({ x: -body.pos.x, y: -body.pos.y, z: -body.pos.z });
			const axes = [
				{ x: 1, y: 0, z: 0 },
				{ x: 0, y: 1, z: 0 },
				{ x: 0, y: 0, z: 1 },
			];
			const up = axes.reduce((best, a) =>
				Math.abs(a.x * sun.x + a.y * sun.y + a.z * sun.z) <
				Math.abs(best.x * sun.x + best.y * sun.y + best.z * sun.z)
					? a
					: best,
			);
			const perp = norm({
				x: sun.y * up.z - sun.z * up.y,
				y: sun.z * up.x - sun.x * up.z,
				z: sun.x * up.y - sun.y * up.x,
			});
			const a = (sunAngleDeg * Math.PI) / 180;
			const dir = {
				x: sun.x * Math.cos(a) + perp.x * Math.sin(a),
				y: sun.y * Math.cos(a) + perp.y * Math.sin(a),
				z: sun.z * Math.cos(a) + perp.z * Math.sin(a),
			};
			const range = window.__radiusOf(bodyId) * radii;
			await window.__placeShipAt(
				{
					x: body.pos.x + dir.x * range,
					y: body.pos.y + dir.y * range,
					z: body.pos.z + dir.z * range,
				},
				window.__frameVelocityOf(bodyId),
			);
			await window.__lookAt(body.pos);
		};

		/**
		 * Where the ship booted, remembered on first call.
		 *
		 * `deep-sky` is specified as being *at the arrival point*, and the first
		 * version only turned the camera — leaving the ship wherever the previous
		 * view had put it, which made one view of a canonical set a function of the
		 * order of the array. The arrival point is not exposed, but the ship starts
		 * on it, so it is captured before anything moves.
		 */
		window.__rememberBootPosition = () => {
			const p = window.__seelite.world.ship.pos;
			window.__bootPos = { x: p.x, y: p.y, z: p.z };
		};
		window.__returnToBootPosition = async () => {
			if (!window.__bootPos)
				throw new Error(
					"__returnToBootPosition: nothing remembered — call __rememberBootPosition before the first placement",
				);
			await window.__placeShipAt({ ...window.__bootPos });
		};

		/**
		 * The heading furthest from the star and every body, by search.
		 *
		 * Aiming at empty sky has no target to aim at, so it is found rather than
		 * computed: a Fibonacci sphere of candidate headings, scored by the
		 * closest thing in that direction, and the best kept. Cheap, and it does
		 * not care how many bodies the seed produced or where they went.
		 */
		window.__emptiestDirection = () => {
			const g = window.__seelite;
			const p = g.world.ship.pos;
			const subjects = [
				{ x: 0, y: 0, z: 0 },
				...g.world.system.bodies.map((b) => b.pos),
			];
			const dirs = subjects.map((s) =>
				norm({ x: s.x - p.x, y: s.y - p.y, z: s.z - p.z }),
			);
			const N = 512;
			const phi = Math.PI * (3 - Math.sqrt(5));
			let best = null;
			let bestScore = Number.POSITIVE_INFINITY;
			for (let i = 0; i < N; i++) {
				const y = 1 - (i / (N - 1)) * 2;
				const r = Math.sqrt(Math.max(0, 1 - y * y));
				const t = phi * i;
				const c = { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
				let worst = -1;
				for (const d of dirs) {
					const dot = c.x * d.x + c.y * d.y + c.z * d.z;
					if (dot > worst) worst = dot;
				}
				if (worst < bestScore) {
					bestScore = worst;
					best = c;
				}
			}
			return best;
		};
	});
}

/**
 * Cycle to a view through the key the player has, and stop when it arrives.
 *
 * Here rather than in each caller because #201 added two scripts that both
 * needed it and both wrote it — and the loop is not the obvious one. `v`
 * *cycles*, so a single press reaches the second view and not the named one,
 * and a third view arriving later would turn a wrong frame into a
 * `waitForFunction` timeout that reads as a hung browser rather than as the
 * one-line cause it is. The bound is what makes the failure legible.
 *
 * The key rather than `game.view =`: pressing it runs the transition the game
 * runs on a real toggle, including the head-look reset, and an assignment
 * skips both. `capture-views.mjs` has its own copy for its own reason — it
 * must not fire on the workbench page, which has no view cycle at all.
 */
export async function setView(page, want) {
	for (let i = 0; i < 8; i++) {
		if ((await page.evaluate(() => window.__seelite.view)) === want) return;
		await page.keyboard.press("v");
	}
	throw new Error(`could not reach the ${want} view in eight presses`);
}

/**
 * Let three frames go by, which is what a re-framed shot needs before it can be
 * measured.
 *
 * Three and not one: the near/far handoff has a hysteresis band and a station's
 * surface is built lazily, so the first frame after a camera move can be drawn
 * before either has caught up. `capture-views.mjs` waits the same three before
 * every shutter and says so.
 */
export function settleFrames(page, frames = 3) {
	return page.evaluate(
		(n) =>
			new Promise((done) => {
				let left = n;
				const tick = () => (left-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
		frames,
	);
}

/**
 * Stop the game's frame loop, so a measurement's arms are of one pose.
 *
 * Nothing moves between two `render(0)` calls once the loop is stopped; with
 * it running, the sim steps between evaluates and a station 30 km/s away is
 * somewhere else by the second arm. `startLoop` gives the loop back. Here
 * because #651 wrote both a probe and an instrument that needed it.
 */
export const stopLoop = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		g.animationFrame = 0;
	});

/** Restart the loop `stopLoop` stopped; a running loop is left alone. */
export const startLoop = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		if (!g.animationFrame) g.animate();
	});

/**
 * The two framings #201's probe and its cost instrument both take, in one
 * place.
 *
 * Not a third copy of the view set — `view-set.mjs` owns the canonical sheet
 * and these are not on it. What they are is a *pair* of scripts that must frame
 * the same shot: `probe-occlusion.mjs` checks what the occlusion does to a
 * frame and `measure-occlusion-cost.mjs` prices the same frame, and a receipt
 * that quotes both is only coherent if the camera was in the same place. Two
 * copies of `headLook: { yaw: -0.75, pitch: -0.2 }` is exactly how that stops
 * being true without anything going red.
 */
/**
 * @typedef {{
 *   view: string,
 *   place: (page: any) => Promise<any>,
 *   seed?: number,
 * }} Framing
 *
 * `seed` is optional and only the pad role carries one: seed 47 generates no
 * refinery (`view-set.mjs`), so that framing declares the seed it needs and the
 * runner groups by it. Typed here rather than left implicit, because a consumer
 * reading `framing.seed` off a framing that has never declared one gets
 * `undefined` and boots the default — which is a run measuring the wrong
 * station rather than an error.
 */

/** @type {Readonly<Record<string, Framing>>} */
export const OCCLUSION_FRAMINGS = Object.freeze({
	/**
	 * The arrival point, looking at nothing — `view-set.mjs`'s `sky-only`
	 * framing, and the one the principal reported at 40 fps.
	 *
	 * Here rather than only in the view set because #241 made it a *measured*
	 * framing as well as a captured one: it is where the occlusion pair doubles
	 * the frame and darkens 0.002% of it, so both the probe and the cost
	 * instrument frame it, and two copies of this placement is how that stops
	 * being the same shot.
	 */
	deepSky: {
		view: "cockpit",
		place: (page) =>
			page.evaluate(async () => {
				await window.__returnToBootPosition();
				const g = window.__seelite;
				const d = window.__emptiestDirection();
				const p = g.world.ship.pos;
				await window.__lookAt({
					x: p.x + d.x * 1e9,
					y: p.y + d.y * 1e9,
					z: p.z + d.z * 1e9,
				});
			}),
	},
	/** Five silhouette radii down a trade station's aperture axis, from inside
	 *  the cabin — `cockpit-arrival`'s framing, where about 40% of the frame is
	 *  cockpit and the ambient occlusion has fittings to find. */
	cockpit: {
		view: "cockpit",
		place: (page) =>
			page.evaluate(
				([id, radii]) =>
					window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
						comoving: true,
					}),
				["station-trade", 5],
			),
	},
	/** Docked at a trade station's overhead-near berth, looking off-axis —
	 *  `berth-free-look`'s framing. The enclosed bay is the one place in this
	 *  game where the star's shadow reads at all, and the room #201 was opened
	 *  over for its corners. */
	berth: {
		view: "chase",
		place: (page) =>
			page.evaluate(
				([id, berth, opts]) => window.__parkInBerth(id, berth, opts),
				[
					"station-trade",
					"overhead-near",
					{
						stopAtArrivalFraction: 1,
						headLook: { yaw: -0.75, pitch: -0.2 },
					},
				],
			),
	},

	/**
	 * A **shipyard**'s wall berth — the second slot role, and `shipyard-wall-berth`'s
	 * framing.
	 *
	 * #247 asks whether #242's 4.6% is a property of bays or of *that* bay, and
	 * one berth of one station cannot say. A shipyard's bay is cut into a
	 * rotating drum with a static spine (`CLAUDE.md`), so it is a differently
	 * shaped enclosure around the same aperture rule.
	 *
	 * **Parked fully docked, with no `stopAtArrivalFraction`**, which is what
	 * `shipyard-wall-berth` does and is not a style choice: the trade framing's
	 * `1` asks the traversal to stop *arriving*, and on this station it overshoots
	 * to docked and `__parkInBerth` throws. A berth's traversal length is a
	 * property of the station, so a fraction tuned on one does not carry.
	 */
	shipyardBerth: {
		view: "chase",
		place: (page) =>
			page.evaluate(
				([id, berth, opts]) => window.__parkInBerth(id, berth, opts),
				["station-shipyard", "starboard-near", {}],
			),
	},

	/**
	 * A **refinery**'s service cradle — the pad role, and `refinery-cradle-berth`'s
	 * framing.
	 *
	 * **This one needs seed 2 and the caller has to supply it.** Seed 47
	 * generates a trade station and a shipyard and nothing else
	 * (`view-set.mjs`), so a run pinned to the canonical seed cannot reach a
	 * refinery at all — which is exactly why #247's question about pad roles was
	 * open. #165 took the enclosed bay away from the pad roles: a cradle stands
	 * on an open deck with no shell, so the expectation is that the planet is
	 * far more visible here than from inside a slot role's bay, and that
	 * expectation is the thing to measure rather than to assume.
	 */
	refineryCradle: {
		view: "chase",
		seed: 2,
		place: (page) =>
			page.evaluate(
				([id, berth, opts]) => window.__parkInBerth(id, berth, opts),
				["station-refinery", "port-near", {}],
			),
	},
});

/**
 * Ordinary flight, at a range and in a view — no station anywhere near.
 *
 * **The flight regime does not enter this**, and that is worth saying because
 * #247 asks for "approach, cruise and open flight" as three framings. What a
 * coverage mask measures is what stands between the camera and the body, and
 * cruise changes the ship's speed rather than what is drawn in front of it
 * (#10 nose-locks velocity; it adds no geometry). So the two things that
 * actually vary are the **view** — cockpit, where #105's cabin is a near-layer
 * mesh in front of everything, against chase, where the hull is — and the
 * **range**, which sets how much of the frame the body fills. Those are the
 * axes here, and a cruise framing would be a fourth name for a row already in
 * the table.
 */
export const flightFraming = (bodyId, radii, view) => ({
	view,
	place: (page) =>
		page.evaluate(
			([id, r, deg]) => window.__sunOffset(id, r, deg),
			[bodyId, radii, 60],
		),
});
