import { createServer } from "vite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	launchChromium,
	guardedOrigin,
} from "../../../scripts/probe-guard.mjs";
import { assertPlayersRenderer } from "../../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../../scripts/lib/probe-lock.mjs";

const out = new URL("./evidence/", import.meta.url);
const release = await holdProbeLockOrExit("Assembly authored blocks Phase 1");
let server, browser;
try {
	server = await createServer({
		server: { host: "127.0.0.1", port: 0, strictPort: false },
	});
	await server.listen();
	const address = server.httpServer.address();
	if (!address || typeof address === "string")
		throw Error("Missing server address");
	const origin = `http://127.0.0.1:${address.port}`;
	await guardedOrigin(origin);
	browser = await launchChromium({ headless: false });
	await mkdir(out, { recursive: true });
	const rows = [],
		errors = [];
	const plans = {},
		authoredInstances = {};
	let renderer;
	for (const seed of [0, 1, 47, 1234]) {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 900 },
			deviceScaleFactor: 1,
		});
		page.on("pageerror", (e) => errors.push(e.message));
		await page.goto(`${origin}/spikes/stations/assembly-kit/`);
		await page.waitForFunction(
			() => window.__assemblyKit?.ready,
			{},
			{ timeout: 120000 },
		);
		renderer = await assertPlayersRenderer(page, "capture Assembly joints", {
			global: "__assemblyKit",
		});
		await page.evaluate(() => document.body.classList.add("capture"));
		for (const view of ["overview", "hub", "hub-quarter", "joint", "rear"]) {
			for (const authored of [false, true]) {
				const stats = await page.evaluate((s) => window.__assemblyKit.set(s), {
					seed,
					authored,
					view,
				});
				await page.evaluate(
					() =>
						new Promise((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(resolve)),
						),
				);
				const file = `seed-${seed}-${view}-${authored ? "authored" : "procedural"}.png`;
				await page.screenshot({ path: new URL(file, out).pathname });
				const { placements, instances, ...frame } = stats;
				plans[seed] = placements;
				if (authored) authoredInstances[seed] = instances;
				rows.push({ file, ...frame });
			}
		}
		await page.close();
	}
	if (errors.length) throw Error(errors.join("\n"));
	const provenance = {
		sources: Object.fromEntries(
			await Promise.all(
				[
					"blocks.ts",
					"build_kit.py",
					"../build_model.py",
					"../geometry.py",
					"../final_shapes.py",
					"../industrial-surface.png",
					"joints.ts",
					"assembly.ts",
					"prepare.ts",
					"viewer.ts",
					"index.html",
					"capture.mjs",
				].map(async (file) => [
					file,
					createHash("sha256")
						.update(await readFile(new URL(file, import.meta.url)))
						.digest("hex"),
				]),
			),
		),
		base: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		capturedAt: new Date().toISOString(),
		renderer,
		viewport: [1440, 900],
		asset: JSON.parse(
			await readFile(new URL("./asset.json", import.meta.url), "utf8"),
		),
		lighting:
			"Station study rig: ACES 1.12, room environment 0.36; key 4.5, fill 1.1, rim 1.0. Phases 0 and quarter turn (hub-quarter), studio background; no frame-time claim.",
		plans,
		authoredInstances,
		rows,
		errors,
	};
	await writeFile(
		new URL("metrics.json", out),
		`${JSON.stringify(provenance, null, 2)}\n`,
	);
	const sections = rows
		.filter((r) => !r.authored)
		.map((r) => {
			const after = rows.find(
				(a) => a.authored && a.seed === r.seed && a.view === r.view,
			);
			return `<h2>Seed ${r.seed} · ${r.view}${r.framing.joint ? ` · ${r.framing.joint.kind}` : ""}</h2><div class="pair">${[r, after].map((a) => `<figure><a href="${a.file}"><img src="${a.file}" alt="Seed ${a.seed}, ${a.view}, ${a.authored ? "authored" : "procedural"}"></a><figcaption>${a.authored ? "Authored HUB / NODE / TUBE" : "Procedural baseline"} · ${a.calls} calls · ${a.triangles.toLocaleString()} triangles</figcaption></figure>`).join("")}</div>`;
		})
		.join("\n");
	await writeFile(
		new URL("index.html", out),
		`<!doctype html><html lang="en"><meta charset="utf-8"><title>Assembly block spike · node 1057</title><style>body{background:#091015;color:#d4dcde;font:15px system-ui;margin:28px}h1{font-weight:450}h2{font-size:18px;margin-top:36px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%}figcaption{margin:8px 0;color:#a8b8bc}a{color:#d7ad72}</style><h1>Assembly authored blocks · Phase 1</h1><p>Awaiting principal approval of the look and joints. HUB, NODE and TUBE authored; all other parts are the real procedural Assembly. Same WFC placements in both arms. Click an image for 1440 × 900 pixels.</p><p>${renderer} · <a href="metrics.json">Provenance and submitted draw counters</a> · <a href="../../target-assembly.png">Approved target</a></p>${sections}</html>\n`,
	);
	console.log(`Captured ${rows.length} frames on ${renderer}`);
} finally {
	await browser?.close();
	await server?.close();
	release();
}
