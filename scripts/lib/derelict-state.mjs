/**
 * Natural next loss, framed through the production pose; no discovery fixture.
 *
 * `framing: "tear"` (node #735) then moves the camera to stand off the wreck's
 * most sunlit tear, read off the drawn hull's own `userData.torn`, so the
 * broken look is judged at a range where a frame member is more than a pixel.
 *
 * The tear cuts procedural lofts, and the authored Porter (node #813) has
 * none, so its wreck is whole. `"tear"` therefore stands at the first of the
 * system's derelict slots whose wreck the tear can cut, read off
 * `derelictPose` before anything moves; the plain framing keeps the first
 * slot, whatever it holds.
 */
export async function placeDerelict(page, shot = {}) {
	return page.evaluate(async (framing) => {
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
		const { key, at } = nextDerelictViewWreck(system, framing);
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
		let tear = null;
		if (framing === "tear") {
			const drawn = g.derelictMeshes.get(`${key}:${wreck.row.instanceOrdinal}`);
			const sites = drawn?.root.userData.torn?.sites ?? [];
			if (sites.length === 0) throw Error(`${pose.hull} drew no tear`);
			// The drawn root's attitude is the wreck's, so its quaternion turns
			// the hull's frame into the world's.
			const q = drawn.root.quaternion;
			const turn = ([x, y, z]) => {
				const tx = 2 * (q.y * z - q.z * y);
				const ty = 2 * (q.z * x - q.x * z);
				const tz = 2 * (q.x * y - q.y * x);
				return {
					x: x + q.w * tx + (q.y * tz - q.z * ty),
					y: y + q.w * ty + (q.z * tx - q.x * tz),
					z: z + q.w * tz + (q.x * ty - q.y * tx),
				};
			};
			const star = g.starBody?.pos ?? { x: 0, y: 0, z: 0 };
			const toStar = {
				x: star.x - pose.pos.x,
				y: star.y - pose.pos.y,
				z: star.z - pose.pos.z,
			};
			const lit = (site) => {
				const o = turn(site.outward);
				return o.x * toStar.x + o.y * toStar.y + o.z * toStar.z;
			};
			// The tear facing the star most: a hole on the night side is a black
			// shape on a black hull, which is not the look under judgement.
			const site = [...sites].sort((a, b) => lit(b) - lit(a))[0];
			const out = turn(site.outward);
			const centre = turn(site.centre);
			const nose = pose.nose;
			const at = {
				x: pose.pos.x + centre.x,
				y: pose.pos.y + centre.y,
				z: pose.pos.z + centre.z,
			};
			g.world.ship.pos = {
				x: at.x + out.x * 0.05 + nose.x * 0.02,
				y: at.y + out.y * 0.05 + nose.y * 0.02,
				z: at.z + out.z * 0.05 + nose.z * 0.02,
			};
			const look = {
				x: at.x - g.world.ship.pos.x,
				y: at.y - g.world.ship.pos.y,
				z: at.z - g.world.ship.pos.z,
			};
			g.orientation.copy(g.shotRotation({ forward: look, up: pose.up }));
			g.render(0);
			tear = site.part;
		}
		return {
			key,
			tear,
			hull: pose.hull,
			bodyId: pose.bodyId,
			at,
			instanceOrdinal: wreck.row.instanceOrdinal,
			containers: wreck.row.containers.map((c, i) => ({
				...c,
				...tetherPose(pose, i),
			})),
		};
	}, shot.framing ?? null);
}
