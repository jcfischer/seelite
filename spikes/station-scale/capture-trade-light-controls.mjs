import { spawn } from "node:child_process";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const main = await realpath(process.argv[2]);
const branch = await realpath(process.cwd());
await copyFile("spikes/station-scale/capture.mjs", resolve(main, "spikes/station-scale/capture.mjs"));
for (const fixture of [{ form: "c", system: 0, name: "drum" }, { form: "d", system: 5, name: "assembly" }])
	for (const [label, root] of [["before", main], ["after", branch]]) {
		const out = resolve(branch, "spikes/station-scale/evidence-ring/trade-light-controls", fixture.name, label);
		await mkdir(out, { recursive: true });
		const script = `import {holdProbeLockOrExit} from "./scripts/lib/probe-lock.mjs"; const release=await holdProbeLockOrExit("node-1145-${fixture.name}-${label}"); process.argv[2]=${JSON.stringify(out)}; try {await import("./spikes/station-scale/capture.mjs");} finally {release();}`;
		const code = await new Promise((done, fail) => {
			const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: root, env: { ...process.env, SYSTEM: String(fixture.system), FORM: fixture.form, TYPES: "trade", SCALES: "1", CLEAN: "1", ONLY: "03-face-close,08-sun-close", SEELITE_PROBE_RENDERER: "hardware" }, stdio: "inherit" });
			child.on("error", fail);
			child.on("exit", done);
		});
		if (code !== 0) throw Error(`${fixture.name}/${label} exited ${code}`);
	}
