/**
 * What the courier's reduced level changes on screen where the detail band
 * first draws it (node #812, sage round 2).
 *
 *   node scripts/measure-courier-level-pop.mjs
 *
 * The level is made to a target geometric error of half a device pixel at
 * that range (`courierLevelErrorKm`), but its normals are recomputed and its
 * welded corners keep one texture coordinate each, and neither is held by
 * that error. So this reads the pixels: a courier on the chase camera's axis
 * just past `DETAIL_RADII.full`, drawn at `full` and at `reduced` by
 * `setShipDetail`, on one page with the clock held, at four headings.
 *
 * The footprint is every pixel the full hull moves past 24/255 against the
 * same frame without it; the figure is the share of that footprint the reduced
 * level moves past 24/255 against the full one. The control is the full hull
 * drawn twice. It is a diagnosis that asserts no threshold, and refuses a run
 * whose hull has no footprint or whose control is not still.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5197);
/** Courier reaches from the camera: just past the band's first edge. */
const RADII_PAST_EDGE = 1.02;
const HEADINGS_DEG = [0, 90, 180, 270];

const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-courier-pop",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	await page.goto(
		gameUrl(origin, {
			seed: 42,
			system: 0,
			"no-save": true,
			"coriolis-start": "approach",
		}),
	);
	await bootedGame(page, 90000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite.view === "chase");
	const rows = await page.evaluate(
		async ([pastEdge, headings]) => {
			const g = window.__seelite;
			g.clockHeld = true;
			g.chaseYaw = -0.8;
			g.chaseElevation = 0.3;
			const mesh = await import("/src/ship-mesh.ts");
			const { DETAIL_RADII } = await import("/src/detail-level.ts");
			const { markOcclusion } = await import("/src/occlusion-mesh.ts");
			const ship = g.shipMesh;
			const V = ship.position.constructor;
			const root = mesh.buildShipMesh("courier", "a").root;
			if (root.userData.authored !== true)
				throw new Error("the page's courier is not the authored model");
			markOcclusion(root);
			const range = DETAIL_RADII.full * pastEdge * mesh.HULL_REACH_KM.courier;
			g.render(0);
			const camera = g.nearCamera;
			camera.updateMatrixWorld(true);
			const eye = camera.getWorldPosition(new V());
			const forward = new V(0, 0, -1).transformDirection(camera.matrixWorld);
			const at = eye.clone().addScaledVector(forward, range);
			root.position.copy(ship.worldToLocal(at.clone()));
			const gl = g.renderer.getContext();
			const w = gl.drawingBufferWidth;
			const h = gl.drawingBufferHeight;
			// A box around the frame's centre, wide enough for the hull at
			// any heading: its reach, projected, with margin.
			const half = Math.ceil(
				((2.5 * mesh.HULL_REACH_KM.courier) /
					(2 * range * Math.tan((camera.fov * Math.PI) / 360))) *
					h,
			);
			const x0 = Math.max(0, (w >> 1) - half);
			const y0 = Math.max(0, (h >> 1) - half);
			const side = Math.min(2 * half, w - x0, h - y0);
			const frame = () => {
				g.render(0);
				const out = new Uint8Array(side * side * 4);
				gl.readPixels(x0, y0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, out);
				return out;
			};
			const moved = (a, b) => {
				const out = new Uint8Array(a.length / 4);
				for (let p = 0; p < out.length; p++)
					for (let c = 0; c < 3; c++)
						if (Math.abs(a[4 * p + c] - b[4 * p + c]) > 24) out[p] = 1;
				return out;
			};
			const out = [];
			for (const heading of headings) {
				root.rotation.set(0, (heading * Math.PI) / 180, 0);
				root.removeFromParent();
				const empty = frame();
				ship.add(root);
				mesh.setShipDetail(root, "full");
				const full = frame();
				const again = frame();
				mesh.setShipDetail(root, "reduced");
				const reduced = frame();
				const footprint = moved(empty, full);
				const control = moved(full, again);
				const popped = moved(full, reduced);
				let n = 0;
				let c = 0;
				let r = 0;
				for (let p = 0; p < footprint.length; p++) {
					if (!footprint[p]) continue;
					n++;
					c += control[p];
					r += popped[p];
				}
				out.push({ heading, footprint: n, control: c, popped: r });
			}
			root.removeFromParent();
			return { rows: out, rangeKm: range, box: side };
		},
		[RADII_PAST_EDGE, HEADINGS_DEG],
	);
	console.log(`  renderer: ${renderer}`);
	console.log(
		`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, chase, clock held`,
	);
	console.log(
		`  courier on the camera axis at ${(rows.rangeKm * 1000).toFixed(0)} m (${RADII_PAST_EDGE} x the band's first edge), read in a ${rows.box}px box`,
	);
	console.log("  heading  footprint px  control moved  reduced moved");
	for (const row of rows.rows) {
		if (row.footprint === 0)
			throw new Error(`heading ${row.heading}: the hull has no footprint`);
		if (row.control !== 0)
			throw new Error(
				`heading ${row.heading}: the control moved ${row.control} px; the frame is not still`,
			);
		const share = (row.popped / row.footprint) * 100;
		if (!Number.isFinite(share)) throw new Error("non-finite share");
		console.log(
			`  ${String(row.heading).padStart(5)}°  ${String(row.footprint).padStart(12)}  ${String(row.control).padStart(13)}  ${String(row.popped).padStart(6)} (${share.toFixed(1)}%)`,
		);
	}
} finally {
	await browser.close();
	await server.close();
}
