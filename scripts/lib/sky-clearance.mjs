/**
 * What the emptiest heading actually leaves in front of the camera — the one
 * owner of that arithmetic.
 *
 * Two consumers, which is why it is a module and not a block in one file:
 * `scripts/measure-sky-clearance.mjs` sweeps worlds and prints a table for node
 * #487's receipt, and `scripts/probe-sky.mjs` holds one row of it as a gate. An
 * instrument and a gate that each carry their own copy of an angle are the setup
 * where the gate goes false-green and the instrument keeps printing a confident
 * table — which is #288's complaint about a pixel count that measured what the
 * cabin did not cover, arrived at by arithmetic instead of by pixels.
 *
 * ## What is measured, and why each piece is the piece it is
 *
 * The **framing is the shipped one** — `OCCLUSION_FRAMINGS.deepSky`, the object
 * `capture-views.mjs` frames `sky-only` with — because the claim under audit is a
 * caption on that row. Rebuilding the heading here from `__emptiestDirection`'s
 * ingredients would measure a near-miss of the row and say nothing about it, and
 * it would be a second owner of a placer, which is #430's complaint about a
 * transform derived twice.
 *
 * The **camera's forward vector is the negated third column of its own world
 * matrix**, because a three camera looks down −Z. Reading the column as it lies
 * gives the direction behind the camera: every subject would land roughly ahead,
 * the clearance would read as a fraction of what it is, and the instrument would
 * report the opposite of the truth with complete confidence. That sign is the one
 * place this file can be wrong in a way no other check would catch.
 *
 * The **bound is the rectangle's half-diagonal**, `atan(tan(halfHeight) ·
 * hypot(aspect, 1))`, and not the half-width: a subject in a corner is in frame at
 * an angle no single axis admits. Both come off the page, since a probe carrying
 * its own copy of `fov` goes falsely red the day the renderer changes it.
 *
 * A subject is a **disc, not a point**: its apparent radius `asin(radiusKm /
 * distanceKm)` is subtracted from its angle, and the number reported is the *near
 * limb*. A centre that clears the frame by ten degrees while the limb sits across
 * it is a body in the picture, which is the only question the caption asked. At
 * the arrival point the discs are tenths of a degree and the term looks idle; it
 * is what makes the same reading honest at any other place, and it is not free to
 * be dropped because it is small today.
 *
 * **The placer's own subjects are a literal origin plus `world.system.bodies`,** as
 * `__emptiestDirection` builds them in `view-placement.mjs`; this file rebuilds those
 * two terms and then *widens* the set with traffic, because the placer is answering a
 * different question from the caption — it is choosing the emptiest heading available
 * from what it scores, and the caption claims nothing is in front. Stated as a rebuild
 * rather than as reading the placer's array, because the placer exposes a heading and
 * no list, so what makes the two agree is that both name the origin and both walk
 * `bodies`. The visible symptom of drifting is a clearance reading **wider** than the
 * heading deserves, which is the wrong direction to be wrong in — hence the control row
 * in `probe-sky.mjs` requiring the same arithmetic to find bodies when aimed at the
 * star, and requiring it to find one that is *not* the injected star.
 *
 * The star is measured from `system.contents.star`. `system.bodies` carries it too,
 * as `kind: "star"`, at the same origin with the same radius, so it is dropped from the
 * bodies list rather than counted twice: the set and the minimum are unchanged, and what
 * changes is that a count printed beside a table means bodies and not bodies plus a
 * duplicate. **A system without a star throws rather than becoming a radius-zero
 * point**: a subject silently demoted to a point is a clearance computed on a set that
 * matches nobody's, and the whole claim of this file is that it measures what is in
 * front of the camera.
 *
 * ## What a consumer owes: the rectangle
 *
 * The half-diagonal is a function of the page's **aspect**, so the angle this file
 * prints is a property of the viewport the caller opened, not of the game. The
 * sheet is captured at `VIEWPORT`, 1440x900, and both consumers must boot at that
 * ratio or they are quoting a frame nobody prints: at 16:10 the half-diagonal is
 * 47.4°, and at Playwright's default 1280x720 it is 49.7°. Two thirds of a degree
 * is nothing against a 40° margin and everything against a claim that the reading
 * is of *that row* — which is #296's lesson about measuring a build that is not
 * yours, arrived at through a window size instead of a working tree.
 * `measure-sky-clearance.mjs` therefore opens its page at `VIEWPORT` rather than at
 * a default, and prints the ratio it used beside the numbers.
 *
 * ## What "nothing in front of it" covers, and what escapes it
 *
 * The caption's word is *nothing*, so the subject set has to be everything that can
 * draw between the camera and the backdrop, not merely the things the placer happens
 * to avoid. Three classes, each measured its own way:
 *
 * - **Bodies** — star, planets, moons, stations — as **discs**, because a station's
 *   limb and a planet's limb are both the edge of a thing.
 * - **Traffic** is measured as **centres**, from `game.trafficRoutes`, the game's own
 *   world-kilometre projections — the same values `updateTrafficPresentation` samples to
 *   place a mesh. Not from the scene graph: reading a position back out of an `Object3D`
 *   is the thing `CLAUDE.md` forbids, and a layer group's local coordinates would make
 *   it wrong besides. A hull has no quotable angular radius — a `TrafficActor` is a
 *   callsign, a hull and a schedule, and its drawn size is display state — so a centre
 *   inside the frame is what "standing in front of the camera" can mean here. Routes are
 *   a **superset** of what is drawn (the presentation also skips engaged carriers and
 *   ones `trafficShown` refuses), which is the conservative direction for a caption; a
 *   drawn carrier with no route is the other direction and **throws**.
 *
 *   Traffic is drawn at the shipped arrival frame — a dozen carriers, give or take, per
 *   world, which the sweep prints rather than what this sentence says. That number is why
 *   this class exists in the reading at all: the first draft asked none of these
 *   questions, read `g.flyingTraffic` as a list when it is a method, got an empty one,
 *   and reported a sky with nothing in it.
 *
 *   **And it is a moving set.** Bodies sit where the generator put them at boot; carriers
 *   fly, and the reading is taken after five settled frames, so what it holds for traffic
 *   is *this settled instant* and not the photographed one. That is enough for a margin of
 *   tens of degrees and it is not enough for a hull one degree off a corner, and a caption
 *   that wanted to survive that would have to be measured by the capture itself.
 * - **Bloom**, which this reading cannot see at all. It spreads outside a disc and is
 *   #98's lever rather than geometry: a body just clear of the cone can still wash the
 *   corner behind it. So the honest form of the caption is *nothing stands in front of
 *   the camera*, and not *no light from a thing outside the cone reaches the frame* —
 *   the second is a look judgement on the sheet, and the row does not speak to it.
 *
 * And the fixture is part of the claim. Both consumers boot with `raider: "off"`,
 * exactly as `capture-views.mjs` does, because that is the frame the caption is
 * printed on. **What is held is the captured frame, not every moment of play in that
 * system** — fly far enough and something will cross the view, and no reading of an
 * arrival point can promise otherwise.
 *
 * The cockpit's canopy covers part of the rectangle, which shrinks what the player
 * sees: every figure here is therefore conservative, measuring the camera's rectangle
 * rather than the visible one.
 */
import { gameUrl } from "./game-url.mjs";
import {
	installViewFraming,
	OCCLUSION_FRAMINGS,
	settleFrames,
} from "./view-placement.mjs";
import { bootedGame, installViewPlacement } from "../probe-guard.mjs";

/**
 * Install the page-side helpers a clearance reading needs.
 *
 * `installViewPlacement` is the primitive set the framings are written against,
 * and `__returnToBootPosition` — which is the first thing `deepSky`'s placer does
 * — reaches for `__placeShipAt` out of it. Both are `addInitScript` payloads, so
 * where this is called decides which navigations pay for them: a probe whose other
 * rows never touch a placer should call it last, not first.
 */
export async function installClearanceHooks(page) {
	await installViewPlacement(page);
	await installViewFraming(page);
}

/**
 * Boot the world a reading is taken in, at the position the sheet boots it in.
 *
 * The preamble is here rather than at each callsite because it is the part that
 * makes the reading valid, and a copy of an arithmetic that drifts out of agreement
 * with its twin is bad enough when the two also disagree about where the ship was
 * standing: `__rememberBootPosition` has to run after the boot and before the
 * placement, or `deepSky` places the camera wherever the last traversal left it and
 * every figure in the table describes a different world from the one it names.
 */
export async function bootForClearance(page, origin, seed) {
	await page.goto(gameUrl(origin, { seed, raider: "off" }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	await page.evaluate(() => window.__rememberBootPosition());
}

/**
 * Settle, then read the clearance of whatever the camera is already pointing at.
 *
 * The settle belongs *here* rather than at the callsites, because both readings
 * must share it: `__lookAt` is applied by the frame loop, so a control that aims
 * and measures in the same breath measures the basis of the framing it replaced.
 *
 * Split out from `emptiestClearance` so the arithmetic can be turned on a framing
 * that is *not* the emptiest heading. A gate nobody has seen go red is a belief,
 * and the only honest way to see this one red is to aim the same reading at the
 * star and watch it report a body in the frame — which `probe-sky.mjs` now does as
 * a row of its own rather than as a run someone remembers doing.
 */
export async function measureClearance(page, askedSeed) {
	await settleFrames(page, 5);

	return page.evaluate((asked) => {
		const g = window.__seelite;
		const cam = g.nearCamera;
		cam.updateWorldMatrix(true, false);
		const e = cam.matrixWorld.elements;
		const fwd = { x: -e[8], y: -e[9], z: -e[10] };
		const deg = (r) => (r * 180) / Math.PI;
		const tanHalfHeight = Math.tan((cam.fov * Math.PI) / 360);
		const halfHeight = Math.atan(tanHalfHeight);
		const halfDiagonal = Math.atan(tanHalfHeight * Math.hypot(cam.aspect, 1));
		const p = g.world.ship.pos;
		const star = g.world.system.contents?.star;
		if (!star)
			throw new Error(
				"sky-clearance: this system has no contents.star, and measuring it as a radius-zero point would quietly audit a set nobody aimed at — the star's disc is the largest subject in the frame wherever the frame is not empty",
			);
		// `system.bodies` carries the star too, as `kind: "star"`, at the origin and
		// with the same radius `contents.star` gives it — so it is taken from the
		// bodies list rather than counted twice. The set is unchanged and the minimum
		// cannot move; what changes is that a count printed beside a table means
		// bodies rather than bodies-plus-a-duplicate.
		const bodies = g.world.system.bodies.filter((b) => b.kind !== "star");
		// Why traffic is a subject at all, why its place comes from `trafficRoutes`
		// and not the scene graph, and why a hull is a centre, are in this file's
		// header; `collectTraffic` is that reasoning's only executable form.
		const { drawn, routes } = collectTraffic(g);
		const measured = [
			{
				name: star.name ?? "star",
				pos: { x: 0, y: 0, z: 0 },
				radiusKm: star.radiusKm,
				kind: "star",
			},
			...bodies.map((b) => ({ ...b, kind: b.kind ?? "body" })),
			...routes,
		]
			.map(measureSubject)
			.sort((a, b) => a.limbDeg - b.limbDeg);
		const bound = deg(halfDiagonal);
		const inside = measured.filter((m) => m.limbDeg < bound);
		return {
			askedSeed: asked,
			worldSeed: g.world.seed,
			system: g.world.system.record.index,
			bodies: bodies.length,
			craft: drawn.length,
			craftPlaced: routes.length,
			fovDeg: cam.fov,
			aspect: cam.aspect,
			halfHeightDeg: deg(halfHeight),
			halfDiagonalDeg: deg(halfDiagonal),
			nearest: measured[0],
			inFrame: inside.length,
			// Split by class, because the control row has to show that the reading
			// notices something other than the star it was handed by hand: a control
			// that goes green on the injected star alone proves nothing about the list
			// it is supposed to be auditing.
			inFrameBodies: inside.filter(
				(m) => m.kind !== "star" && m.kind !== "traffic",
			).length,
			inFrameTraffic: inside.filter((m) => m.kind === "traffic").length,
			inFrameStar: inside.filter((m) => m.kind === "star").length,
			// A display cap, not a total: `inFrame` is the count and this is the first
			// few of its names. Left unnamed it reads as the whole list, which is how a
			// "six of six" got into a description once.
			inFrameNames: inside.slice(0, 6).map((m) => `${m.name} (${m.kind})`),
		};

		/**
		 * Every Traffic hull the game says it draws, and every route it can place one
		 * on. See the header: routes are a superset of what is drawn, so the guard
		 * below has to be about **which** hulls have routes and never about how many.
		 */
		function collectTraffic(game) {
			if (!Array.isArray(game.trafficRoutes))
				throw new Error(
					"sky-clearance: game.trafficRoutes is not a list, so Traffic can be neither placed nor excluded and the caption's *nothing* is no longer measurable",
				);
			const drawn = [];
			for (const accessor of ["flyingTraffic", "divertedTraffic"]) {
				const listed = game[accessor];
				if (typeof listed !== "function")
					throw new Error(
						`sky-clearance: game.${accessor}() is no longer a function, so this reading cannot say how much Traffic is drawn in the frame it is auditing`,
					);
				for (const actor of listed.call(game))
					drawn.push({
						key: actor.key,
						label: actor.callsign ?? String(actor.key ?? "carrier"),
					});
			}
			const routes = [];
			for (const route of game.trafficRoutes) {
				if (!route?.pos || !Number.isFinite(route.pos.x))
					throw new Error(
						`sky-clearance: a traffic route has no usable position, so it can be neither placed nor excluded — and a subject the frame cannot evaluate is dropped by the in-frame filter rather than counted, which is a green light handed out by a blind spot`,
					);
				routes.push({
					name: route.key ?? "carrier",
					pos: route.pos,
					radiusKm: 0,
					kind: "traffic",
				});
			}
			// **By identity, not by count.** A comparison of lengths passes whenever the
			// superset is merely larger, which is its normal state — so one drawn hull
			// with no route would hide behind an undrawn route that happens to exist,
			// and go unmeasured under a green row. That is the exact shape of mistake
			// this whole section is here to stop, so the check is a key set and the
			// failure names the hulls rather than a difference of two numbers.
			const placed = new Set(routes.map((r) => r.name));
			const unplaced = drawn.filter((d) => !placed.has(d.key));
			if (unplaced.length > 0)
				throw new Error(
					`sky-clearance: ${unplaced.length} of ${drawn.length} drawn Traffic hulls have no route — ${unplaced.map((d) => d.label).join(", ")} — so this reading cannot place them, and a hull it cannot place is one the caption cannot claim is out of frame`,
				);
			return { drawn, routes };
		}

		/** One subject, from the camera's own basis. Throws rather than yielding a `NaN`. */
		function measureSubject(s) {
			const radiusKm = s.radiusKm;
			if (!Number.isFinite(radiusKm))
				throw new Error(
					`sky-clearance: subject ${s.name} has no finite radius (${String(radiusKm)}), and NaN propagates into the limb, into the sort, and into the in-frame filter — where a subject the frame cannot evaluate is dropped rather than counted, which is the green light this file exists to refuse`,
				);
			const dx = s.pos.x - p.x;
			const dy = s.pos.y - p.y;
			const dz = s.pos.z - p.z;
			const distanceKm = Math.hypot(dx, dy, dz);
			if (!(distanceKm > 0))
				throw new Error(
					`sky-clearance: subject ${s.name} is standing on the camera (distance ${distanceKm} km), so it has no bearing and no angular radius`,
				);
			const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / distanceKm;
			const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
			const apparent = Math.asin(Math.min(1, radiusKm / distanceKm));
			return {
				name: s.name ?? "unnamed",
				kind: s.kind,
				distanceKm,
				angleDeg: deg(angle),
				apparentDeg: deg(apparent),
				limbDeg: deg(angle - apparent),
			};
		}
	}, askedSeed);
}

/**
 * Frame the page the way the sheet frames `sky-only`, then read what that framing
 * leaves clear. This is the pair both real consumers want.
 *
 * `askedSeed` is passed in and echoed back rather than read off the world, so a
 * caller can see that the world it asked for is the world it measured — a sweep
 * that silently re-used one boot would otherwise print the same row eleven times
 * and read as a spread.
 */
export async function emptiestClearance(page, askedSeed) {
	await OCCLUSION_FRAMINGS.deepSky.place(page);
	return measureClearance(page, askedSeed);
}
