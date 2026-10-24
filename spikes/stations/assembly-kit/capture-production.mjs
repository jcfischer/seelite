import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = process.argv[2];
if (!base) throw Error("Pass the procedural base commit as the first argument");
const out = resolve(root, "view-set/node-1073");
const only = "assembly-approach,assembly-flank,assembly-second-layout";
const baseline = await realpath(await mkdtemp(join(tmpdir(), "seelite-1073-before-")));
const run = (command, args, options = {}) => new Promise((done, fail) => {
	const child = spawn(command, args, { stdio: "inherit", ...options });
	child.on("error", fail);
	child.on("exit", (code) => code === 0 ? done() : fail(Error(`${command} exited ${code}`)));
});
async function capture(cwd, label) {
	const previous = process.cwd();
	process.chdir(cwd);
	const server = await createServer({ root: cwd, configFile: join(cwd, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 } });
	try {
		await server.listen();
		const port = server.httpServer.address().port;
		await run(process.execPath, ["scripts/capture-views.mjs", "--label", label, "--only", only, "--out", out], { cwd, env: { ...process.env, PROBE_ORIGIN: `http://127.0.0.1:${port}`, SEELITE_PROBE_RENDERER: "hardware" } });
	} finally { await server.close(); process.chdir(previous); }
}
try {
	await rm(out, { recursive: true, force: true });
	await new Promise((done, fail) => {
		const archive = spawn("git", ["archive", base], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
		const extract = spawn("tar", ["-xf", "-", "-C", baseline], { stdio: ["pipe", "inherit", "inherit"] });
		archive.stdout.pipe(extract.stdin);
		archive.on("error", fail);
		extract.on("error", fail);
		let archived = false, extracted = false;
		const complete = () => { if (archived && extracted) done(); };
		archive.on("exit", (code) => { if (code !== 0) fail(Error(`git archive exited ${code}`)); else { archived = true; complete(); } });
		extract.on("exit", (code) => { if (code !== 0) fail(Error(`tar exited ${code}`)); else { extracted = true; complete(); } });
	});
	await mkdir(join(baseline, "node_modules"));
	for (const entry of await readdir(join(root, "node_modules"))) {
		if (entry === ".vite" || entry === ".vite-temp") continue;
		await symlink(join(root, "node_modules", entry), join(baseline, "node_modules", entry));
	}
	await cp(join(root, "scripts/lib/view-set.mjs"), join(baseline, "scripts/lib/view-set.mjs"));
	await capture(baseline, `before-${base.slice(0, 12)}`);
	await capture(root, "after-node-1073");
	console.log(`Scoped canonical before/after sheet: ${out}/index.html`);
} finally { await rm(baseline, { recursive: true, force: true }); }
