/** Node #843: run the focused interior gate and cost instrument on the built
 * bundle. Run npm run build first. The preview uses the existing tree
 * declaration middleware; the ordinary probe guard and machine lock stay in
 * force. Analytics is fulfilled locally by the focused probe, never fetched.
 */
import { spawn } from "node:child_process";
import { preview } from "vite";
import { freePort } from "./lib/free-port.mjs";
import { treeDeclaration } from "./lib/tree-declaration.mjs";

const port = await freePort();
const server = await preview({
	preview: { host: "127.0.0.1", port, strictPort: true },
	plugins: [
		{
			name: "interior-cost-preview-declaration",
			configurePreviewServer(server) {
				// This hook only needs config.root and the Connect middleware stack,
				// which both Vite server kinds provide.
				treeDeclaration().configureServer(server);
			},
		},
	],
});
try {
	const child = spawn(
		process.execPath,
		[
			"scripts/probe-all.mjs",
			`http://127.0.0.1:${port}`,
			"--only",
			"probe-station-interior-kit",
		],
		{
			stdio: "inherit",
			env: {
				...process.env,
				SEELITE_PROBE_RENDERER: "hardware",
				SEELITE_INTERIOR_MEASURE: "1",
				SEELITE_INTERIOR_BUILD: "Vite production bundle",
			},
		},
	);
	process.exitCode = await new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", (code) => resolve(code ?? 1));
	});
} finally {
	await new Promise((resolve, reject) =>
		server.httpServer.close((error) => (error ? reject(error) : resolve())),
	);
}
