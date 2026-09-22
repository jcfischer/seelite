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
 * **Subjects are the origin plus `world.system.bodies`, which is what
 * `__emptiestDirection` in `view-placement.mjs` scores**: it builds its list from
 * a literal `{0,0,0}` and `world.system.bodies[].pos`, and this file rebuilds the
 * same two terms from the same live record. Stated as a rebuild rather than as
 * reading the placer's own array, because the placer exposes no list — only its
 * heading — so what makes the two agree is that both name the origin and both walk
 * `bodies`, and a future placer that scored a fourth thing would leave this file
 * silently auditing less than it avoided. The visible symptom would be a clearance
 * that reads wider than the heading deserves, which is the wrong direction to be
 * wrong in. Hence the row in `probe-sky.mjs` that aims the same arithmetic at the
 * star and requires it to report a body in frame: not a demonstration that a body
 * *will* appear at the arrival system, which nothing here can show, but that the
 * reading notices one when it is there.
 *
 * The star is measured from `system.contents.star`, which is where the generator
 * keeps it and why the placer adds the origin by hand. **A system without a star
 * throws rather than becoming a radius-zero point**: a subject silently demoted to
 * a point is a clearance computed on a set that no longer matches anyone's, and the
 * whole claim of this file is that it measures what the rule avoided. If a later
 * generator does place the star among the bodies too, the origin is measured twice
 * at the same angle and radius, which cannot move a minimum.
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
 * ## What it cannot see
 *
 * **Bloom.** It spreads outside a disc and is #98's lever rather than geometry, so
 * a body just clear of the cone can still wash the corner behind it and this
 * reading is blind to that by construction. And the cockpit's canopy covers part
 * of the rectangle, which shrinks what the player sees: every figure here is
 * therefore conservative, measuring the camera's rectangle rather than the
 * visible one.
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
 * Read the clearance of whatever the camera is already pointing at, without
 * moving it.
 *
 * Split out from `emptiestClearance` so the arithmetic can be turned on a framing
 * that is *not* the emptiest heading. A gate nobody has seen go red is a belief,
 * and the only honest way to see this one red is to aim the same reading at the
 * star and watch it report a body in the frame — which `probe-sky.mjs` now does as
 * a row of its own rather than as a run someone remembers doing.
 */
export async function measureClearance(page, askedSeed) {
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
		const subjects = [
			{
				name: star.name ?? "star",
				pos: { x: 0, y: 0, z: 0 },
				radiusKm: star.radiusKm,
			},
			...g.world.system.bodies,
		];
		const measured = subjects
			.map((s) => {
				const dx = s.pos.x - p.x;
				const dy = s.pos.y - p.y;
				const dz = s.pos.z - p.z;
				const distanceKm = Math.hypot(dx, dy, dz);
				const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / distanceKm;
				const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
				const apparent = Math.asin(Math.min(1, s.radiusKm / distanceKm));
				return {
					name: s.name ?? "star",
					distanceKm,
					angleDeg: deg(angle),
					apparentDeg: deg(apparent),
					limbDeg: deg(angle - apparent),
				};
			})
			.sort((a, b) => a.limbDeg - b.limbDeg);
		return {
			askedSeed: asked,
			worldSeed: g.world.seed,
			system: g.world.system.record.index,
			bodies: g.world.system.bodies.length,
			fovDeg: cam.fov,
			aspect: cam.aspect,
			halfHeightDeg: deg(halfHeight),
			halfDiagonalDeg: deg(halfDiagonal),
			nearest: measured[0],
			inFrame: measured.filter((m) => m.limbDeg < deg(halfDiagonal)).length,
		};
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
	await settleFrames(page, 5);
	return measureClearance(page, askedSeed);
}
