/**
 * The painted player hull read off the `hull-chase` framing, shared by the
 * two scripts that need the same reading (node #723).
 *
 * `probe-light-rig.mjs` gates #199's exposure band on it, and
 * `measure-shadow-enclosure.mjs` holds a rebalanced rig to the same median.
 * One copy, so the instrument holds exposure by the measurement the band was
 * calibrated with and not by a second reader that drifts from it.
 *
 * Moved here verbatim from `probe-light-rig.mjs`; the sample count became an
 * argument, and `mask` / `keepMask` were added for the instrument (below).
 */

/**
 * The `hull-chase` frame's painted hull peak, with canopy, exhaust and point
 * lights hidden for the measurement. The camera and lighting remain that framing's,
 * but the other scene objects are hidden against the renderer's black clear:
 * otherwise an antialiased edge blended with the bright planet behind it can
 * become the "brightest hull pixel" while barely containing any hull at all.
 * The mask still comes from subtraction: render without the ship's meshes,
 * then with only its non-emissive meshes.
 *
 * **That mask depends on the lighting**, which is why the instrument cannot use
 * it as is. A pixel within 3 codes of the black clear drops out, so a darker rig
 * drops the hull's dark facets and the median of what is left goes *up*: on
 * #723's run, the hemisphere at 0 kept 67,707 of 102,342 pixels, and sun 0.2
 * read a median of 62.95 at hemisphere 3 and 67.22 at hemisphere 0. A search
 * on that median has no direction. So `keepMask: true` returns the pixel set
 * as `mask`, and passing it back as `mask` reads every later rig over the same
 * pixels. `keepLuma: true` also returns `luma`, each kept pixel's value in
 * `mask`'s order, so a caller can split the hull into the faces the sun
 * reaches and the faces it does not. With none of the three, the reading is
 * the one `probe-light-rig.mjs` gates on.
 */
export async function measureHullChase(
	page,
	samples,
	{ mask = null, keepMask = false, keepLuma = false } = {},
) {
	const bodyId = await page.evaluate(() => {
		const planets = window.__seelite.world.system.bodies.filter(
			(body) => body.kind === "planet",
		);
		planets.sort((a, b) => b.radiusKm - a.radiusKm || (a.id < b.id ? -1 : 1));
		return planets[0].id;
	});
	await page.evaluate(
		([id, radii, deg]) => window.__sunOffset(id, radii, deg),
		[bodyId, 6, 150],
	);
	if ((await page.evaluate(() => window.__seelite.view)) !== "chase") {
		await page.keyboard.press("v");
		await page.waitForFunction(() => window.__seelite.view === "chase");
	}

	return page.evaluate(
		([sampleCount, framedBodyId, fixedMask, returnMask, returnLuma]) => {
			const game = window.__seelite;
			const ship = game.shipMesh;
			if (!ship) return { missing: true };
			const bloomEnabled = game.bloom.enabled;
			// A lamp can overlap the hull in screen space. Disable its convolution
			// while reading paint so the reported pixel is post-tone-map hull light,
			// not a neighbouring navigation-light halo.
			game.bloom.enabled = false;
			const navLights = ship.getObjectByName("nav-lights");
			const navLightsVisible = navLights?.visible ?? false;
			const canvas = game.renderer.domElement;
			const scratch = document.createElement("canvas");
			scratch.width = canvas.width;
			scratch.height = canvas.height;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			const meshes = [];
			ship.traverse((object) => {
				if (
					!object.isMesh &&
					!object.isPoints &&
					!object.isLine &&
					!object.isSprite
				)
					return;
				const materials = Array.isArray(object.material)
					? object.material
					: [object.material];
				meshes.push({
					object,
					visible: object.visible,
					painted:
						object.isMesh &&
						materials.every(
							(material) =>
								material.isMeshStandardMaterial &&
								((material.emissive?.getHex?.() ?? 0) === 0 ||
									(material.emissiveIntensity ?? 0) === 0),
						),
				});
			});
			const hidden = [];
			for (const scene of [
				game.backdropScene,
				game.farScene,
				game.approachScene,
				game.nearScene,
				game.cabinScene,
			])
				for (const object of scene.children) {
					if (object === ship || object.isLight) continue;
					hidden.push({ object, visible: object.visible });
					object.visible = false;
				}
			// And the sky's picture, which is the scene's background rather than a
			// child, so the loop above does not reach it. Since node #433 draws the
			// bake behind everything, leaving it up put the hull against a lit sky
			// instead of the black clear this reader is written for: at the ×5 sky
			// the subtraction mask kept 22,879 of the hull's 25,567 pixels (it
			// drops the dark ones, within 3 codes of the sky) and the lower quartile
			// read 51.17 against 41.69 for the same hull against black. The
			// environment still lights the hull; only the picture leaves the frame.
			const background = game.backdropScene.background;
			game.backdropScene.background = null;
			const frame = () => {
				game.render(0);
				ctx.drawImage(canvas, 0, 0);
				return ctx.getImageData(0, 0, scratch.width, scratch.height).data;
			};
			const luma = (data, i) =>
				0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
			const inFixedMask = fixedMask
				? new Uint8Array(scratch.width * scratch.height)
				: null;
			if (inFixedMask) for (const at of fixedMask) inFixedMask[at] = 1;
			let kept = [];
			let keptLuma = [];
			const summarizeDifference = (hull, withoutShip) => {
				let peak = 0;
				let peakAt = 0;
				const values = [];
				kept = [];
				keptLuma = [];
				for (let i = 0; i < hull.length; i += 4) {
					const here = luma(hull, i);
					if (inFixedMask) {
						if (!inFixedMask[i / 4]) continue;
					} else if (Math.abs(here - luma(withoutShip, i)) < 3) continue;
					if (returnMask) kept.push(i / 4);
					if (returnLuma) keptLuma.push(here);
					if (here > peak) {
						peak = here;
						peakAt = i / 4;
					}
					values.push(here);
				}
				values.sort((a, b) => a - b);
				return {
					peak,
					peakAt: {
						x: peakAt % scratch.width,
						y: Math.floor(peakAt / scratch.width),
					},
					lowerQuartile: values[Math.floor(values.length * 0.25)] ?? 0,
					median: values[Math.floor(values.length * 0.5)] ?? 0,
					pixels: values.length,
				};
			};
			const peaks = [];
			const peakAts = [];
			const medians = [];
			const lowerQuartiles = [];
			let pixels = 0;
			for (const mesh of meshes) mesh.object.visible = false;
			const withoutShip = frame();
			for (const mesh of meshes)
				mesh.object.visible = mesh.visible && mesh.painted;
			// Points are not paint. Keep this explicit even though the drawable
			// ledger above includes them: the peak pixel sits exactly where this
			// point sprite overlaps the fuselage, so a future Three.js type change
			// must not silently put the lamp back into the hull sample.
			if (navLights) navLights.visible = false;
			for (let sample = 0; sample < sampleCount; sample++) {
				const hull = frame();
				const summary = summarizeDifference(hull, withoutShip);
				peaks.push(summary.peak);
				peakAts.push(summary.peakAt);
				lowerQuartiles.push(summary.lowerQuartile);
				medians.push(summary.median);
				pixels = Math.max(pixels, summary.pixels);
			}
			for (const mesh of meshes) mesh.object.visible = mesh.visible;
			if (navLights) navLights.visible = navLightsVisible;
			for (const entry of hidden) entry.object.visible = entry.visible;
			game.backdropScene.background = background;
			game.bloom.enabled = bloomEnabled;
			game.render(0);
			return {
				missing: false,
				bodyId: framedBodyId,
				pixels,
				peaks,
				peakAts,
				lowerQuartiles,
				medians,
				exposure: game.exposure,
				finishes: game.finishes,
				...(returnMask ? { mask: kept } : {}),
				...(returnLuma ? { mask: kept, luma: keptLuma } : {}),
			};
		},
		[samples, bodyId, mask, keepMask || keepLuma, keepLuma],
	);
}
