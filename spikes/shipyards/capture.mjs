import { mkdir, writeFile } from "node:fs/promises";
import { launchChromium, guardedOrigin } from "../../scripts/probe-guard.mjs";
import { assertBrowserRenderer } from "../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
const origin = "http://127.0.0.1:5210";
const label = process.argv[2] ?? "round-1";
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error("Invalid label");
const models = process.argv[3] ? [process.argv[3]] : ["o1", "o2", "o3"];
if (models.some((id) => !["o1", "o2", "o3"].includes(id)))
	throw Error("Invalid model");
const out = `.dream-loop/${label}`;
await mkdir(out, { recursive: true });
await guardedOrigin(origin);
const release = await holdProbeLockOrExit("three shipyard model capture");
let browser;
try {
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1586, height: 992 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`${origin}/spikes/shipyards/?model=${models[0]}`);
	await page.waitForFunction(
		() => window.__shipyards?.stats.loaded,
		{},
		{ timeout: 120000 },
	);
	const gpu = await assertBrowserRenderer(page, "shipyards capture");
	const reports = [];
	for (const id of models) {
		await page.evaluate((id) => window.__shipyards.selectModel(id), id);
		await page.waitForFunction(() => window.__shipyards.stats.loaded);
		await page.evaluate(() => window.__shipyards.capture());
		for (const view of [
			"hero",
			"front",
			"top",
			"rear",
			"detail",
			"connection",
			"under",
		]) {
			await page.evaluate((v) => window.__shipyards.setView(v), view);
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${out}/${id}-${view}.png` });
		}
		await page.evaluate(() => document.body.classList.remove("capture"));
		await page.locator("#tooling").click();
		const toolBefore = await page.evaluate(() =>
			window.__shipyards.movingTools.map((o) => [o.position.z, o.rotation.z]),
		);
		if (toolBefore.length < 8) throw Error("Missing articulated tools");
		await page.waitForTimeout(900);
		const toolAfter = await page.evaluate(() =>
			window.__shipyards.movingTools.map((o) => [o.position.z, o.rotation.z]),
		);
		if (
			toolBefore.every((v, i) =>
				v.every((x, j) => Math.abs(x - toolAfter[i][j]) < 1e-6),
			)
		)
			throw Error("Tools did not animate");
		await page.locator("#tooling").click();
		const paused = await page.evaluate(() =>
			window.__shipyards.movingTools.map((o) => [o.position.z, o.rotation.z]),
		);
		await page.waitForTimeout(200);
		if (
			JSON.stringify(paused) !==
			JSON.stringify(
				await page.evaluate(() =>
					window.__shipyards.movingTools.map((o) => [
						o.position.z,
						o.rotation.z,
					]),
				),
			)
		)
			throw Error("Tool pause failed");
		await page.evaluate(() => {
			window.__shipyards.updateTools(0);
			window.__shipyards.renderer.shadowMap.needsUpdate = true;
		});
		const geometry = await page
			.evaluate(async () => {
				const THREE = await import("/node_modules/three/build/three.module.js");
				const { ship, capsule } = window.__shipyards;
				const port = ship.getObjectByName("docking-centre");
				const bearing = ship.getObjectByName("bearing-centre");
				ship.updateMatrixWorld(true);
				const original = port.getWorldPosition(new THREE.Vector3());
				const back = bearing.getWorldPosition(new THREE.Vector3());
				const orientation = capsule.getWorldQuaternion(new THREE.Quaternion());
				const inverseOrientation = orientation.clone().invert();
				const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
				const axialError = original.clone().sub(back).cross(axis).length();
				let maxDrift = 0,
					clearanceViolations = 0;
				const collisions = {};
				const throatDepths = [];
				for (const angle of [
					0,
					Math.PI / 4,
					Math.PI / 2,
					Math.PI,
					Math.PI * 1.5,
				]) {
					capsule.rotation.z = angle;
					ship.updateMatrixWorld(true);
					const current = port.getWorldPosition(new THREE.Vector3());
					maxDrift = Math.max(maxDrift, original.distanceTo(current));
					for (const [x, y] of [
						[0, 0],
						[30, 18],
						[-30, 18],
						[30, -18],
						[-30, -18],
					]) {
						const p = new THREE.Vector3(x, y, 96).applyMatrix4(
							capsule.matrixWorld,
						);
						const origin = p.clone().addScaledVector(axis, 150);
						const ray = new THREE.Raycaster(
							origin,
							axis.clone().negate(),
							0,
							300,
						);
						const hit = ray.intersectObject(ship, true)[0];
						if (!hit) throw Error("Docking throat has no rear bulkhead");
						const insideDepth = hit.distance - 150;
						throatDepths.push(insideDepth);
						if (insideDepth < 9)
							throw Error("Blocked docking throat: " + insideDepth);
					}
				}
				capsule.rotation.z = 0;
				ship.updateMatrixWorld(true);
				window.__shipyards.renderer.shadowMap.needsUpdate = true;
				const centre = capsule.getWorldPosition(new THREE.Vector3());
				let sweepRadius = 0,
					zMin = Infinity,
					zMax = -Infinity;
				capsule.traverse((o) => {
					if (!o.isMesh) return;
					const pos = o.geometry.attributes.position;
					for (let i = 0; i < pos.count; i++) {
						const p = new THREE.Vector3()
							.fromBufferAttribute(pos, i)
							.applyMatrix4(o.matrixWorld)
							.sub(centre)
							.applyQuaternion(inverseOrientation);
						sweepRadius = Math.max(sweepRadius, Math.hypot(p.x, p.y));
						zMin = Math.min(zMin, p.z);
						zMax = Math.max(zMax, p.z);
					}
				});
				const staticMeshes = [];
				ship.traverse((o) => {
					if (!o.isMesh) return;
					let parent = o;
					while (parent && parent !== capsule) parent = parent.parent;
					if (parent === capsule) return;
					staticMeshes.push(o);
					const pos = o.geometry.attributes.position;
					for (let i = 0; i < pos.count; i++) {
						const p = new THREE.Vector3()
							.fromBufferAttribute(pos, i)
							.applyMatrix4(o.matrixWorld)
							.sub(centre)
							.applyQuaternion(inverseOrientation);
						if (
							p.z > zMin &&
							p.z < zMax &&
							Math.hypot(p.x, p.y) < sweepRadius
						) {
							clearanceViolations++;
							collisions[o.name] = (collisions[o.name] ?? 0) + 1;
						}
					}
				});
				for (const z of [zMin + 0.1, 0, zMax - 0.1])
					for (let i = 0; i < 32; i++) {
						const angle = (i * Math.PI) / 16,
							dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
						const ray = new THREE.Raycaster(
							centre.clone().addScaledVector(axis, z),
							dir.applyQuaternion(orientation),
							0,
							sweepRadius,
						);
						if (ray.intersectObjects(staticMeshes, false).length)
							clearanceViolations++;
					}
				if (axialError > 1e-5 || maxDrift > 1e-5)
					throw Error("Non-coaxial capsule");
				if (clearanceViolations)
					throw Error(
						"Static structure enters spinning capsule: " +
							clearanceViolations +
							" " +
							JSON.stringify(collisions),
					);
				return {
					axialError,
					maxDrift,
					clearanceViolations,
					minThroatDepth: Math.min(...throatDepths),
					sweepRadius,
					zMin,
					zMax,
				};
			})
			.catch((error) => ({ error: error.message }));
		await page.evaluate(() => {
			window.__shipyards.setView("hero");
			document.body.classList.remove("capture");
		});
		// Drain load and synchronous geometry checks from the viewer timing window.
		await page.evaluate(
			() =>
				new Promise((resolve) => {
					let frames = 0;
					const tick = () =>
						++frames >= 200 ? resolve() : requestAnimationFrame(tick);
					requestAnimationFrame(tick);
				}),
		);
		const metrics = await page.evaluate(() => ({
			...window.__shipyards.stats,
		}));
		reports.push({ id, ...metrics, geometry });
		await page.screenshot({ path: `${out}/${id}-viewer.png` });
	}
	for (const id of models) {
		await page.locator(`[data-model=${id}]`).click();
		await page.waitForFunction(
			(id) =>
				window.__shipyards.modelId === id && window.__shipyards.stats.loaded,
			id,
		);
	}
	const before = await page.evaluate(() =>
		window.__shipyards.camera.position.toArray(),
	);
	await page.mouse.move(730, 460);
	await page.mouse.down();
	await page.mouse.move(860, 550, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(400);
	const after = await page.evaluate(() =>
		window.__shipyards.camera.position.toArray(),
	);
	if (before.every((v, i) => Math.abs(v - after[i]) < 0.001))
		throw Error("Orbit did not move");
	const distance = await page.evaluate(() =>
		window.__shipyards.camera.position.distanceTo(
			window.__shipyards.controls.target,
		),
	);
	await page.mouse.wheel(0, 200);
	await page.waitForTimeout(400);
	if (
		await page.evaluate(
			(d) =>
				Math.abs(
					window.__shipyards.camera.position.distanceTo(
						window.__shipyards.controls.target,
					) - d,
				) < 0.001,
			distance,
		)
	)
		throw Error("Zoom did not move");
	await page.locator("#target").click();
	await page.locator("#target-dialog").waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await page.locator("#lights").click();
	if ((await page.locator("#lights").getAttribute("aria-pressed")) !== "true")
		throw Error("Lights failed");
	await page.locator("#lights").click();
	await page.locator("#spin").click();
	const rot = await page.evaluate(() => window.__shipyards.capsule.rotation.z);
	await page.waitForTimeout(350);
	if (
		await page.evaluate((v) => window.__shipyards.capsule.rotation.z === v, rot)
	)
		throw Error("Capsule spin failed");
	await page.locator("#spin").click();
	for (const view of [
		"front",
		"top",
		"rear",
		"detail",
		"connection",
		"under",
		"hero",
	])
		await page.locator(`[data-view=${view}]`).click();
	const downloadPromise = page.waitForEvent("download");
	await page.locator("#save").click();
	const download = await downloadPromise;
	if (!download.suggestedFilename().endsWith(".png"))
		throw Error("PNG export failed");
	await download.delete();
	await page.setViewportSize({ width: 900, height: 700 });
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${out}/narrow.png` });
	const report = {
		gpu,
		errors,
		models: reports,
		controls:
			"selection, full orbit, zoom, seven presets, tooling motion and pause on every captured station, work lights, capsule rotation, target dialog and PNG export passed",
	};
	await writeFile(`${out}/metrics.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	if (errors.length) throw Error("Browser errors");
	const failed = reports.filter((r) => r.geometry.error);
	if (failed.length)
		throw Error(
			JSON.stringify(
				failed.map((r) => ({ id: r.id, error: r.geometry.error })),
			),
		);
} finally {
	await browser?.close();
	release();
}
