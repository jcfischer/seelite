import { spawn } from "node:child_process";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const main = await realpath(process.argv[2]);
const branch = await realpath(process.cwd());
const outRoot = resolve(process.argv[3] ?? "spikes/station-scale/evidence-ring/trade-light-controls");
await copyFile("spikes/station-scale/capture.mjs", resolve(main, "spikes/station-scale/capture.mjs"));
for (const fixture of [{ form: "c", system: 0, name: "drum" }, { form: "d", system: 5, name: "assembly" }])
	for (const [label, root] of [["before", main], ["after", branch]]) {
		const out = resolve(outRoot, fixture.name, label);
		await mkdir(out, { recursive: true });
		const code = await new Promise((done, fail) => {
			const child = spawn(process.execPath, ["spikes/station-scale/capture.mjs", out], { cwd: root, env: { ...process.env, SYSTEM: String(fixture.system), FORM: fixture.form, TYPES: "trade", SCALES: "1", CLEAN: "1", ONLY: "03-face-close,08-sun-close", SEELITE_PROBE_RENDERER: "hardware" }, stdio: "inherit" });
			child.on("error", fail);
			child.on("exit", done);
		});
		if (code !== 0) throw Error(`${fixture.name}/${label} exited ${code}`);
	}
