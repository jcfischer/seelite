/**
 * One `industrial-surface` for the models that use it on a real renderer and
 * real requests: https://github.com/jcfischer/seelite/issues/1222
 *
 *   npm run probe:one probe-shared-image
 *
 * 1. **Two exteriors, one image.** Two models drawn in one renderer use one
 *    texture object and one GPU texture, from one request.
 * 2. **The interiors keep their own settings.** A third model under the
 *    interior owner adds no request. Where the exteriors draw at the
 *    interiors' anisotropy of 8 it shares their upload, and changing it adds one;
 *    otherwise it adds one GPU texture and the exteriors keep their own.
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

const blockedPage = async (pattern) => {
	const page = await browser.newPage();
	watch(page);
	let requests = 0;
	let blocked = true;
	await page.route(pattern, (route) => {
		requests++;
		return blocked ? route.abort() : route.continue();
	});
	await page.addInitScript(() => {
		window.__rejections = [];
		window.addEventListener("unhandledrejection", (event) =>
			window.__rejections.push(String(event.reason)),
		);
	});
	return {
		page,
		requests: () => requests,
		unblock: () => {
			blocked = false;
		},
	};
};

try {
	const config = await benchPage();
	const urls = await config.evaluate(async () => {
		const p = await import("/scripts/fixtures/shared-image-page.ts");
		return {
			bollard: p.BOLLARD_TUG_GLB_URL,
			refinery: p.REFINERY_GLB_URLS.a,
			outpost: p.OUTPOST_GLB_URLS.a,
			trade: p.TRADE_GLB_URLS.b,
			interior: p.STATION_INTERIORS_GLB_URL,
		};
	});
	await config.close();
	const cases = [
		{
			name: "industrial-surface",
			image: /\/industrial-surface[^/]*\.webp/,
			a: urls.outpost,
			b: urls.trade,
			owner: urls.interior,
			prepare: "prepareOutpostModel",
			prepareArgs: ["a"],
			modelsFull: false,
			anisotropy: 8,
			bootAttempts: (n) => n === 1,
		},
		{
			name: "paint-wear",
			image: /\/paint-wear[^/]*\.webp/,
			a: urls.bollard,
			b: urls.refinery,
			owner: urls.bollard,
			prepare: "prepareTugHullModel",
			prepareArgs: [],
			modelsFull: true,
			anisotropy: 1,
			bootAttempts: (n) => n >= 1,
		},
	];
	for (const { image, bootAttempts, ...modelCase } of cases) {
		console.log(`Checking ${modelCase.name}`);
		const bench = await benchPage();
		const requests = [];
		bench.on("request", (r) => {
			if (image.test(r.url())) requests.push(r.url());
		});
		const drawn = await bench.evaluate(async (modelCase) => {
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
			const a = await page.loadShared(modelCase.a);
			const b = await page.loadShared(modelCase.b);
			const mapA = page.mapOf(a.scene, modelCase.name);
			const mapB = page.mapOf(b.scene, modelCase.name);
			frame(quad(mapA));
			const afterA = count();
			const scene = quad(mapB);
			const survivor = frame(scene);
			const afterB = count();
			const interior = await page.loadShared(modelCase.owner, "interior");
			const mapInterior = page.mapOf(interior.scene, modelCase.name);
			const interiorAnisotropy = mapInterior.anisotropy;
			mapInterior.anisotropy = 8;
			frame(quad(mapInterior));
			const afterInterior = count();
			if (modelCase.anisotropy === 8) {
				mapInterior.anisotropy = 4;
				mapInterior.needsUpdate = true;
				frame(quad(mapInterior));
			}
			const afterOwnerChange = count();
			const report = page.disposeSubtree(a.scene);
			const again = frame(scene);
			return {
				empty,
				afterA,
				afterB,
				afterInterior,
				afterOwnerChange,
				interiorAnisotropy,
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
		}, modelCase);
		check(
			"two exteriors use one texture object and one GPU texture",
			drawn.sameMap &&
				drawn.afterA === drawn.empty + 1 &&
				drawn.afterB === drawn.afterA,
			JSON.stringify(drawn),
		);
		const shared = modelCase.anisotropy === 8;
		check(
			shared
				? "the interior owner shares the GPU upload at anisotropy 8"
				: "a named owner adds one GPU texture over the same decoded image",
			drawn.ownMap &&
				drawn.sharedSource &&
				(!shared || drawn.interiorAnisotropy === 8) &&
				drawn.afterInterior === drawn.afterB + (shared ? 0 : 1),
		);
		check(
			shared
				? "changing the owner's anisotropy adds an upload and leaves the exteriors at 8"
				: "writing an owner's anisotropy leaves the exteriors' alone",
			drawn.exteriorAnisotropy === modelCase.anisotropy &&
				drawn.afterOwnerChange === drawn.afterInterior + (shared ? 1 : 0),
		);
		check(
			"three models fetched the image once",
			requests.length === 1,
			requests.join(),
		);
		check(
			"tearing one model down keeps the other's texture and its frame",
			drawn.kept &&
				drawn.afterTeardown === drawn.afterOwnerChange &&
				drawn.frameKept &&
				drawn.frameLit,
		);
		await bench.close();

		const boot = await blockedPage(image);
		const failing = boot.page;
		await failing.goto(
			gameUrl(ORIGIN, {
				seed: 42,
				system: 4,
				"no-save": true,
				voices: "formant",
				raider: "off",
				"models-full": modelCase.modelsFull,
				"interiors-full": false,
				"shipyards-full": false,
				"refineries-full": false,
				"outposts-full": false,
			}),
		);
		await failing.waitForSelector(RETRY, { timeout: 120000 });
		check(
			"a boot model whose image will not fetch offers Retry and builds no Game",
			bootAttempts(boot.requests()) &&
				(await failing.evaluate(() => !window.__seelite)),
			`${boot.requests()} request(s)`,
		);
		const failedBootAttempts = boot.requests();
		boot.unblock();
		await failing.click(RETRY);
		await bootedGame(failing, 120000);
		const retried = await failing.evaluate(() => ({
			rejections: window.__rejections,
			panel: !!document.querySelector("[data-model-load]"),
		}));
		check(
			"Retry fetches the image again and boots, with nothing unhandled",
			boot.requests() === failedBootAttempts + 1 &&
				!retried.panel &&
				retried.rejections.length === 0,
			JSON.stringify({ bootAttempts: boot.requests(), ...retried }),
		);
		await failing.close();

		const backgroundLoad = await blockedPage(image);
		const background = backgroundLoad.page;
		await background.goto(publicUrl(ORIGIN, "about"));
		const queued = await background.evaluate(async (modelCase) => {
			const page = await import("/scripts/fixtures/shared-image-page.ts");
			window.__prepare = () =>
				page[modelCase.prepare](...modelCase.prepareArgs);
			const warned = [];
			const queue = new page.ModelQueue(
				{ outpost: window.__prepare },
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
		}, modelCase);
		check(
			"a background model whose image will not fetch fails in the queue with nothing unhandled",
			queued.state === "failed" &&
				queued.warned.join() === "outpost/load" &&
				queued.rejections.length === 0 &&
				backgroundLoad.requests() === 1,
			JSON.stringify({ attempts: backgroundLoad.requests(), ...queued }),
		);
		backgroundLoad.unblock();
		await background.evaluate(() => window.__prepare());
		check(
			"a later load refetches rather than reusing the failed promise",
			backgroundLoad.requests() === 2,
			`${backgroundLoad.requests()} request(s)`,
		);
		await background.close();
	}
	const liveLoad = await blockedPage(/\/paint-wear[^/]*\.webp/);
	const live = liveLoad.page;
	await live.goto(
		gameUrl(ORIGIN, {
			seed: 42,
			system: 4,
			hull: "tug",
			"no-save": true,
			voices: "formant",
			raider: "off",
			"models-full": false,
		}),
	);
	await bootedGame(live, 120000);
	await live.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
	const standin = await live.evaluate(() => ({
		authored: !!window.__seelite.shipMesh.userData.authored,
		rejections: window.__rejections,
	}));
	check(
		"a live background Bollard keeps its procedural stand-in after an image failure",
		liveLoad.requests() > 0 &&
			!standin.authored &&
			standin.rejections.length === 0,
		JSON.stringify({ requests: liveLoad.requests(), ...standin }),
	);
	const failedRequests = liveLoad.requests();
	liveLoad.unblock();
	await live.evaluate(async () => {
		const { prepareTugHullModel } = await import("/src/tug-hull.ts");
		await prepareTugHullModel();
		window.__seelite.refreshAuthoredHulls();
	});
	check(
		"a later live load refetches and installs the authored Bollard",
		liveLoad.requests() === failedRequests + 1 &&
			(await live.evaluate(
				() =>
					!!window.__seelite.shipMesh.userData.authored &&
					window.__rejections.length === 0,
			)),
	);
	await live.close();
} finally {
	await browser.close();
}
exit();
