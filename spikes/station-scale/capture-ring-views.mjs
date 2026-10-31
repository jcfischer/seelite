import { spawn } from "node:child_process";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = await realpath(process.argv[2] ?? process.cwd());
const label = process.argv[3] ?? "after";
const out = resolve(process.cwd(), "spikes/station-scale/evidence-ring/views");
await mkdir(out, { recursive: true });
if (root !== await realpath(process.cwd()))
	await copyFile("scripts/lib/view-set.mjs", resolve(root, "scripts/lib/view-set.mjs"));
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), cacheDir: resolve(root, "node_modules/.vite-ring-views"), server: { host: "127.0.0.1", port: 5197, strictPort: true } });
try {
	await server.listen();
	const code = await new Promise((done, fail) => {
		const child = spawn("npm", ["run", "views", "--", "--only", "ring-approach,ring-flank,ring-range,station-approach,station-flank,station-range,hull-chase,cockpit-backlit", "--boot-timeout-ms", "120000", "--label", label, "--out", out], { cwd: root, env: { ...process.env, PROBE_ORIGIN: "http://127.0.0.1:5197", SEELITE_PROBE_RENDERER: "hardware" }, stdio: "inherit" });
		child.on("error", fail);
		child.on("exit", done);
	});
	if (code !== 0) throw Error(`canonical capture exited ${code}`);
} finally {
	await server.close();
}
