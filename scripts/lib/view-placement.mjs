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
			g.requestDockingClearance();
			if (!g.dockingComputerEngaged) g.toggleDockingComputer();
			// Sub-stepped in sim rather than by animation frames: a capture must
			// not depend on how fast the machine renders.
			let arrivingFor = 0;
			for (let i = 0; i < 60 * 180; i++) {
				g.step(dt);
				const now = g.dockingSnapshot(stationId);
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
			// never reached the station keeps it. That is exactly how the frame
			// above went unnoticed — the assertion passed 115 km away.
			// **The phase too, not the berth alone.** The berth is set at
			// clearance and says only that the reservation landed; a run that
			// never reached the station keeps it. That is exactly how a frame
			// went unnoticed — the assertion passed 115 km away.
			const reached =
				opts.stopAtArrivalFraction !== undefined ? "arriving" : "docked";
			if (settled.dockPhase !== reached)
				throw new Error(
					`__parkInBerth: wanted ${reached} at ${stationId} and the session ` +
						`is ${settled.dockPhase}, ${settled.rangeKm.toFixed(1)} km out`,
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
		) => {
			const button = document.querySelector(`[data-model-asset="${asset}"]`);
			if (!button)
				throw new Error(
					`__frameWorkbenchInterior: no "${asset}" on the station workbench`,
				);
			button.click();
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
