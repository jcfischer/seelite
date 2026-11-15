/** A cold production-loader session drawing the courier, its cockpit and Voyager: https://github.com/jcfischer/seelite/issues/1228 */
import { loadavg } from "node:os";
import { publicUrl } from "./lib/game-url.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
await holdProbeLockOrExit("measure-steel-wear-cold");
const browser = await launchChromium({ headless: false });
const { watch, exit } = tally();
const loadBefore = loadavg();
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	watch(page);
	const fetched = [];
	const sizes = [];
	page.on("requestfinished", (request) => {
		if (/\.(glb|webp)$/.test(new URL(request.url()).pathname))
			sizes.push(
				request.sizes().then(({ responseBodySize }) =>
					fetched.push({
						file: new URL(request.url()).pathname.split("/").pop(),
						bytes: responseBodySize,
					}),
				),
			);
	});
	await page.goto(publicUrl(origin, "about"));
	const renderer = await assertPlayersRenderer(page, "measure");
	const report = await page.evaluate(async () => {
		const p = await import("/scripts/fixtures/shared-image-page.ts");
		const { THREE } = p;
		const renderer = new THREE.WebGLRenderer();
		renderer.setSize(1440, 900);
		document.body.append(renderer.domElement);
		const scene = new THREE.Scene();
		scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 3));
		const camera = new THREE.PerspectiveCamera(60, 1440 / 900, 0.01, 100);
		camera.position.z = 6;
		let last;
		const gaps = [];
		let frames = 0;
		let stopped = false;
		const tick = (now) => {
			if (stopped) return;
			if (last !== undefined) gaps.push(now - last);
			last = now;
			renderer.render(scene, camera);
			frames++;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const started = performance.now();
		await Promise.all([
			p.prepareCourierHullModel(),
			p.prepareCockpitModel(),
			p.prepareVoyagerHullModel(),
		]);
		const installMs = performance.now() - started;
		const courier = p.buildShipMesh("courier", "a").root;
		const cockpit = p.buildAuthoredCabin().root;
		const voyager = p.buildShipMesh("voyager", "a").root;
		if (!courier.userData.authored || !voyager.userData.authored)
			throw new Error("procedural hull in cold fixture");
		const roots = [courier, cockpit, voyager];
		const counts = [];
		const maps = [];
		for (const [index, root] of roots.entries()) {
			const box = new THREE.Box3().setFromObject(root);
			const size = box.getSize(new THREE.Vector3());
			const scale = 1.5 / Math.max(size.x, size.y, size.z);
			const centre = box.getCenter(new THREE.Vector3());
			root.scale.multiplyScalar(scale);
			root.position.sub(centre.multiplyScalar(scale));
			root.position.x += (index - 1) * 2;
			root.traverse((object) => {
				object.frustumCulled = false;
			});
			scene.add(root);
			renderer.render(scene, camera);
			counts.push(renderer.info.memory.textures);
			maps.push(
				p
					.mapsOf(root)
					.map((map) => ({ name: map.name, anisotropy: map.anisotropy })),
			);
		}
		const fromFrame = frames;
		while (frames < fromFrame + 120)
			await new Promise((resolve) => requestAnimationFrame(resolve));
		stopped = true;
		renderer.dispose();
		const sorted = [...gaps].sort((a, b) => a - b);
		return {
			installMs,
			textureCounts: counts,
			maps,
			frames,
			maxGapMs: sorted.at(-1),
			p95GapMs: sorted[Math.floor(sorted.length * 0.95)],
			over100: gaps.filter((n) => n > 100).length,
		};
	});
	await Promise.all(sizes);
	if (
		![
			report.installMs,
			report.maxGapMs,
			report.p95GapMs,
			...report.textureCounts,
			...fetched.map((f) => f.bytes),
		].every(Number.isFinite)
	)
		throw new Error("non-finite cold measurement");
	console.log(
		JSON.stringify(
			{
				origin,
				renderer,
				loadBefore,
				loadAfter: loadavg(),
				viewport: [1440, 900],
				fetched,
				fetchedBytes: fetched.reduce((n, f) => n + f.bytes, 0),
				...report,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
exit();
