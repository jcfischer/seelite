/**
 * Decodes each prepared model and its embedded original through the production
 * loader in a real browser, and compares the textures (#1222). The originals
 * come from git, because nothing in the tree holds them any more.
 *
 *   PROBE_ORIGIN=http://127.0.0.1:5173 node scripts/verify-shared-image-decode.mjs 625e2227
 */
import { execFileSync } from "node:child_process";
import { SHARED_MODEL_IMAGES } from "./share-model-image.mjs";
import { publicUrl } from "./lib/game-url.mjs";
import { guardedOrigin, launchChromium } from "./probe-guard.mjs";

const ref = process.argv[2];
if (!ref) throw new Error("name the commit that holds the embedded originals");
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
let failed = 0;
try {
	const page = await browser.newPage();
	page.on("pageerror", (e) => console.error("pageerror:", e.message));
	await page.route(/\/__original\//, (route) => {
		const name = new URL(route.request().url()).pathname.split("/").pop();
		route.fulfill({
			contentType: "model/gltf-binary",
			body: execFileSync("git", ["show", `${ref}:src/models/${name}`], {
				maxBuffer: 2 ** 28,
			}),
		});
	});
	await page.goto(publicUrl(origin, "about"));
	for (const model of SHARED_MODEL_IMAGES.filter(
		(image) => !process.argv[3] || image.name === process.argv[3],
	).flatMap((image) => image.models)) {
		const result = await page.evaluate(async (model) => {
			const p = await import("/scripts/fixtures/shared-image-page.ts");
			const original = await new p.GLTFLoader()
				.setMeshoptDecoder(p.MeshoptDecoder)
				.loadAsync(`/__original/${model}.glb`);
			const prepared = await p.loadShared(`/src/models/${model}.glb`);
			const facts = (t) => ({
				flipY: t.flipY,
				colorSpace: t.colorSpace,
				wrapS: t.wrapS,
				wrapT: t.wrapT,
				magFilter: t.magFilter,
				minFilter: t.minFilter,
				anisotropy: t.anisotropy,
				generateMipmaps: t.generateMipmaps,
				format: t.format,
				type: t.type,
				premultiplyAlpha: t.premultiplyAlpha,
			});
			const pixels = ({ image }) => {
				const canvas = document.createElement("canvas");
				canvas.width = image.width;
				canvas.height = image.height;
				const context = canvas.getContext("2d", { willReadFrequently: true });
				context.drawImage(image, 0, 0);
				return context.getImageData(0, 0, image.width, image.height).data;
			};
			const aa = p.mapsOf(original.scene);
			const bb = p.mapsOf(prepared.scene);
			if (aa.length !== bb.length) throw new Error("texture count changed");
			return aa.map((a, index) => {
				const b = bb[index];
				const pa = pixels(a);
				const pb = pixels(b);
				let differing = 0;
				for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) differing++;
				return {
					original: facts(a),
					prepared: facts(b),
					size: `${b.image.width}x${b.image.height}`,
					bytes: pb.length,
					differing,
					lengthsMatch: pa.length === pb.length,
					distinct: new Set(pb.subarray(0, 4096)).size,
				};
			});
		}, model);
		for (const texture of result) {
			const settings =
				JSON.stringify(texture.original) === JSON.stringify(texture.prepared);
			const ok =
				settings &&
				texture.lengthsMatch &&
				texture.differing === 0 &&
				texture.distinct > 8;
			if (!ok) failed++;
			console.log(
				`${ok ? "ok  " : "FAIL"} ${model}: ${texture.size}, ${texture.differing} of ${texture.bytes} bytes differ; settings ${settings ? "match" : `differ ${JSON.stringify(texture)}`}`,
			);
		}
	}
} finally {
	await browser.close();
}
console.log(failed ? `${failed} models differ` : "every model matches");
process.exit(failed ? 1 : 0);
