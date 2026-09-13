/** #266: a departing Traffic hull occludes the station mouth, including bloom. */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await installViewPlacement(page);
	await page.goto(gameUrl(ORIGIN, { seed: 54 }), { waitUntil: "load" });
	await bootedGame(page);
	const stationId = await page.evaluate(
		() =>
			window.__seelite.world.system.contents.stations.find(
				(station) => station.type === "trade",
			)?.id ?? null,
	);
	if (!stationId) throw new Error("seed 54 has no trade station");
	await page.evaluate(
		(id) => window.__viewAlongAxis(id, 1.5, { comoving: true }),
		stationId,
	);

	const result = await page.evaluate(async (id) => {
		const { buildShipMesh } = await import("/src/ship-mesh.ts");
		const g = window.__seelite;
		const Vector3 = g.nearScene.position.constructor;
		cancelAnimationFrame(g.animationFrame);
		g.view = "chase";
		g.setHeadLook("forward");
		g.outputPass.setDither(false);
		g.render(0);

		const station = window.__meshOfBody(id);
		const bars = [];
		station?.traverse((child) => {
			if (child.name === "aperture-light") bars.push(child);
		});
		if (!station || bars.length !== 4)
			return { missing: true, bars: bars.length };

		// Pick the bar nearest the image centre, then put a real freighter hull on
		// the same camera ray, just in front of it. This is the exact depth relation
		// a departing ship has at the mouth without depending on one schedule tick.
		const bar = bars
			.map((candidate) => ({
				candidate,
				pos: candidate.getWorldPosition(new Vector3()),
				screen: candidate.getWorldPosition(new Vector3()).project(g.nearCamera),
			}))
			.sort(
				(a, b) =>
					a.screen.x * a.screen.x +
					a.screen.y * a.screen.y -
					(b.screen.x * b.screen.x + b.screen.y * b.screen.y),
			)[0];
		const ship = buildShipMesh("freighter", "a").root;
		ship.name = "traffic-mouth-occluder";
		ship.quaternion.setFromUnitVectors(
			new Vector3(0, 0, -1),
			bar.pos.clone().normalize().negate(),
		);
		let firstMesh = null;
		ship.traverse((child) => {
			if (!firstMesh && child.isMesh) firstMesh = child;
		});
		firstMesh.geometry.computeBoundingBox();
		const Box3 = firstMesh.geometry.boundingBox.constructor;
		const centre = new Box3().setFromObject(ship).getCenter(new Vector3());
		ship.position
			.copy(bar.pos)
			.multiplyScalar(0.5)
			.sub(centre.applyQuaternion(ship.quaternion));
		ship.traverse((child) => {
			if (child.isPoints) child.visible = false;
		});
		g.nearScene.add(ship);

		const W = 720;
		const H = 450;
		const source = g.renderer.domElement;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			g.render(0);
			ctx.drawImage(source, 0, 0, W, H);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const setBars = (visible) => {
			for (const candidate of bars) candidate.visible = visible;
		};
		const luma = (data, index) =>
			0.299 * data[index * 4] +
			0.587 * data[index * 4 + 1] +
			0.114 * data[index * 4 + 2];
		let opaqueCoverage = null;
		const read = (bloom, measureCoverage = false) => {
			g.bloomPass.enabled = bloom;
			ship.visible = false;
			setBars(true);
			const barsNoShip = frame();
			setBars(false);
			const bareNoShip = frame();
			if (measureCoverage) {
				const materials = [];
				ship.traverse((child) => {
					if (!child.isMesh) return;
					const original = child.material;
					const inspected = original.clone();
					inspected.color?.set(0xffffff);
					inspected.emissive?.set(0xffffff);
					if ("emissiveIntensity" in inspected) inspected.emissiveIntensity = 1;
					inspected.transparent = false;
					inspected.opacity = 1;
					inspected.depthTest = true;
					inspected.depthWrite = true;
					child.material = inspected;
					materials.push([child, original, inspected]);
				});
				ship.visible = true;
				const opaqueShip = frame();
				const rawCoverage = new Uint8Array(W * H);
				for (let i = 0; i < W * H; i++)
					rawCoverage[i] =
						Math.abs(luma(opaqueShip, i) - luma(bareNoShip, i)) > 24 ? 1 : 0;
				// The comparison is about solid hull, not multisampled silhouette
				// edges where both foreground and background legitimately contribute.
				opaqueCoverage = new Uint8Array(W * H);
				for (let y = 1; y < H - 1; y++) {
					for (let x = 1; x < W - 1; x++) {
						let solid = 1;
						for (let oy = -1; oy <= 1 && solid; oy++)
							for (let ox = -1; ox <= 1; ox++)
								if (!rawCoverage[(y + oy) * W + x + ox]) {
									solid = 0;
									break;
								}
						opaqueCoverage[y * W + x] = solid;
					}
				}
				for (const [child, original, inspected] of materials) {
					child.material = original;
					inspected.dispose();
				}
			}
			ship.visible = true;
			const bareWithShip = frame();
			setBars(true);
			const barsWithShip = frame();

			let overlap = 0;
			let leaked = 0;
			let maxLeak = 0;
			for (let i = 0; i < W * H; i++) {
				const barContribution = luma(barsNoShip, i) - luma(bareNoShip, i);
				if (barContribution <= 8 || !opaqueCoverage?.[i]) continue;
				overlap++;
				const residual = luma(barsWithShip, i) - luma(bareWithShip, i);
				if (residual > 4) leaked++;
				maxLeak = Math.max(maxLeak, residual);
			}
			return { overlap, leaked, maxLeak };
		};

		const direct = read(false, true);
		const bloom = read(true);
		g.bloomPass.enabled = true;
		g.outputPass.setDither(g.settings.value.dither === "on");
		setBars(true);
		g.render(0);
		window.__cleanupTrafficMouthProbe = () => {
			ship.removeFromParent();
			setBars(true);
			g.render(0);
		};
		return {
			bloom,
			direct,
			missing: false,
			barScreen: { x: bar.screen.x, y: bar.screen.y },
		};
	}, stationId);
	if (process.env.PROBE_SCREENSHOT)
		await page.screenshot({ path: process.env.PROBE_SCREENSHOT });
	await page.evaluate(() => window.__cleanupTrafficMouthProbe?.());

	check(
		"a foreground Traffic hull overlaps the rendered aperture fixture",
		!result.missing && result.direct.overlap >= 8,
		JSON.stringify(result),
	);
	check(
		"station-mouth geometry writes no pixels through the Traffic hull",
		!result.missing && result.direct.leaked === 0,
		JSON.stringify(result.direct),
	);
	check(
		"bloom does not restore the occluded mouth fixture through the hull",
		!result.missing && result.bloom.leaked === 0,
		JSON.stringify(result.bloom),
	);
} finally {
	await browser.close();
}

exit();
