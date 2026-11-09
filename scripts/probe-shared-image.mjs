/**
 * One `industrial-surface` for the models that use it on a real renderer and
 * real requests: https://github.com/jcfischer/seelite/issues/1222
 *
 *   npm run probe:one probe-shared-image
 *
 * 1. **Two exteriors, one image.** Two models drawn in one renderer use one
 *    texture object and one GPU texture, from one request.
 * 2. **The interiors keep their own settings.** A third model under the
 *    interior owner adds one GPU texture and no request, and writing anisotropy
 *    on its map, as `interior-kit.ts` does, leaves the exteriors' alone.
 * 3. **Tearing one down keeps the other.** The survivor's frame reads the same
 *    bytes and the renderer still counts its texture.
 * 4. **A boot that needs the image and cannot fetch it offers Retry**, and the
 *    retry fetches it again and boots. A fresh pilot's home is always a model
 *    that uses it, so this is the failure a player meets.
 * 5. **A background model keeps its stand-in.** On the queue's seam with the real
 *    outpost loader: the entry fails, nothing goes unhandled, and a later load
 *    fetches again. A live `Game` cannot reach this without a save docked at a
 *    station that does not use the image; `probe-model-queue` holds what a
 *    `Game` does with a failed background model.
 */
import { gameUrl, publicUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const IMAGE = /\/industrial-surface[^/]*\.webp/;
const RETRY = '[data-model-load="failed"] button';
const browser = await launchChromium();
const { check, watch, exit } = tally();

const benchPage = async () => {
	const page = await browser.newPage();
	watch(page);
	await page.goto(publicUrl(ORIGIN, "about"));
	await page.evaluate(() => {
		window.__rejections = [];
		window.addEventListener("unhandledrejection", (e) =>
			window.__rejections.push(String(e.reason)),
		);
	});
	return page;
};

try {
	const bench = await benchPage();
	const requests = [];
	bench.on("request", (r) => {
		if (IMAGE.test(r.url())) requests.push(r.url());
	});
	const drawn = await bench.evaluate(async () => {
		const page = await import("/scripts/fixtures/shared-image-page.ts");
		const { THREE } = page;
		const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
		renderer.setSize(64, 64, false);
		const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
		camera.position.z = 1;
		const quad = (map) => {
			const scene = new THREE.Scene();
			scene.add(
				new THREE.Mesh(
					new THREE.PlaneGeometry(2, 2),
					new THREE.MeshBasicMaterial({ map }),
				),
			);
			return scene;
		};
		const frame = (scene) => {
			renderer.render(scene, camera);
			const gl = renderer.getContext();
			const pixels = new Uint8Array(64 * 64 * 4);
			gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			return pixels;
		};
		const count = () => renderer.info.memory.textures;
		const empty = count();
		const a = await page.loadShared(page.OUTPOST_GLB_URLS.a);
		const b = await page.loadShared(page.TRADE_GLB_URLS.b);
		const mapA = page.mapOf(a.scene);
		const mapB = page.mapOf(b.scene);
		frame(quad(mapA));
		const afterA = count();
		const scene = quad(mapB);
		const survivor = frame(scene);
		const afterB = count();
		const interior = await page.loadShared(
			page.STATION_INTERIORS_GLB_URL,
			"interior",
		);
		const mapInterior = page.mapOf(interior.scene);
		mapInterior.anisotropy = 8;
		frame(quad(mapInterior));
		const afterInterior = count();
		const report = page.disposeSubtree(a.scene);
		const again = frame(scene);
		return {
			empty,
			afterA,
			afterB,
			afterInterior,
			sameMap: mapA === mapB,
			sharedSource: mapInterior.source === mapA.source,
			ownMap: mapInterior !== mapA,
			exteriorAnisotropy: mapA.anisotropy,
			flipY: mapA.flipY,
			colorSpace: mapA.colorSpace,
			kept: report.kept.has(mapA),
			afterTeardown: count(),
			frameKept: survivor.every((v, i) => v === again[i]),
			frameLit: new Set(survivor).size > 8,
		};
	});
	check(
		"two exteriors use one texture object and one GPU texture",
		drawn.sameMap &&
			drawn.afterA === drawn.empty + 1 &&
			drawn.afterB === drawn.afterA,
		JSON.stringify(drawn),
	);
	check(
		"the interior owner adds one GPU texture over the same decoded image",
		drawn.ownMap &&
			drawn.sharedSource &&
			drawn.afterInterior === drawn.afterB + 1,
	);
	check(
		"writing the interior's anisotropy leaves the exteriors' alone",
		drawn.exteriorAnisotropy === 1,
	);
	check(
		"three models fetched the image once",
		requests.length === 1,
		requests.join(),
	);
	check(
		"tearing one model down keeps the other's texture and its frame",
		drawn.kept &&
			drawn.afterTeardown === drawn.afterInterior &&
			drawn.frameKept &&
			drawn.frameLit,
	);
	await bench.close();

	const failing = await browser.newPage();
	watch(failing);
	let bootAttempts = 0;
	let refuse = true;
	await failing.route(IMAGE, (route) => {
		bootAttempts++;
		return refuse ? route.abort() : route.continue();
	});
	await failing.addInitScript(() => {
		window.__rejections = [];
		window.addEventListener("unhandledrejection", (e) =>
			window.__rejections.push(String(e.reason)),
		);
	});
	await failing.goto(
		gameUrl(ORIGIN, {
			seed: 42,
			system: 4,
			"no-save": true,
			voices: "formant",
			raider: "off",
			"models-full": false,
			"interiors-full": false,
			"shipyards-full": false,
			"refineries-full": false,
			"outposts-full": false,
		}),
	);
	await failing.waitForSelector(RETRY, { timeout: 120000 });
	check(
		"a boot model whose image will not fetch offers Retry and builds no Game",
		bootAttempts === 1 && (await failing.evaluate(() => !window.__seelite)),
		`${bootAttempts} request(s)`,
	);
	refuse = false;
	await failing.click(RETRY);
	await bootedGame(failing, 120000);
	const retried = await failing.evaluate(() => ({
		rejections: window.__rejections,
	}));
	check(
		"Retry fetches the image again and boots, with nothing unhandled",
		bootAttempts === 2 && !retried.panel && retried.rejections.length === 0,
		JSON.stringify({ bootAttempts, ...retried }),
	);
	await failing.close();

	const background = await benchPage();
	let attempts = 0;
	let refused = true;
	await background.route(IMAGE, (route) => {
		attempts++;
		return refused ? route.abort() : route.continue();
	});
	const queued = await background.evaluate(async () => {
		const page = await import("/scripts/fixtures/shared-image-page.ts");
		window.__page = page;
		const warned = [];
		const queue = new page.ModelQueue(
			{ outpost: () => page.prepareOutpostModel("a") },
			undefined,
			(id, error, phase) => warned.push(`${id}/${phase}`),
		);
		queue.prioritize(["outpost"], []);
		await queue.wait(["outpost"]);
		await new Promise((settle) => setTimeout(settle, 0));
		return {
			state: queue.state("outpost"),
			warned,
			rejections: window.__rejections,
		};
	});
	check(
		"a background model whose image will not fetch fails in the queue with nothing unhandled and no Retry",
		queued.state === "failed" &&
			queued.warned.join() === "outpost/load" &&
			queued.rejections.length === 0 &&
			!queued.retry &&
			attempts === 1,
		JSON.stringify({ attempts, ...queued }),
	);
	refused = false;
	await background.evaluate(() => window.__page.prepareOutpostModel("a"));
	check(
		"a later load refetches rather than reusing the failed promise",
		attempts === 2,
		`${attempts} request(s)`,
	);
	await background.close();
} finally {
	await browser.close();
}
exit();
