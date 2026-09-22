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
 * **Subjects are the star at the origin plus every placed body** — the set
 * `__emptiestDirection` itself scores, read from the same live record, so the rule
 * and the audit cannot disagree about what was avoided. The star is not among the
 * placed bodies: it lives in `system.contents`, and the placer adds the origin by
 * hand. If a later generator does place it too, the origin is measured twice at
 * the same angle and radius, which cannot move a minimum.
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
import { OCCLUSION_FRAMINGS, settleFrames } from "./view-placement.mjs";

/**
 * Read the clearance of whatever the camera is already pointing at, without
 * moving it.
 *
 * Split out from `emptiestClearance` so the arithmetic can be turned on a framing
 * that is *not* the emptiest heading. A gate nobody has seen go red is a belief,
 * and the only honest way to see this one red is to aim the same reading at the
 * star and watch it report a body in the frame.
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
		const subjects = [
			{
				name: star?.name ?? "star",
				pos: { x: 0, y: 0, z: 0 },
				radiusKm: star?.radiusKm ?? 0,
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
